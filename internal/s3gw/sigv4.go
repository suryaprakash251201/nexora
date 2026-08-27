// Package s3gw implements the server side of an S3-compatible endpoint.
//
// Nexora exposes every storage root as an S3 "bucket" and every file as an
// "object", so any S3 client (rclone, Cyberduck, restic, aws cli, ...) can
// read/write the workspace with zero Nexora-specific code. Authenticated with
// a personal API token (nxr_…) used as BOTH the access key id and secret.
//
// This file contains the AWS Signature Version 4 verification side. The
// canonicalization follows the AWS spec (https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html).
// We deliberately accept both the single-encoded canonical URI (hand-rolled
// clients) and the double-encoded form used by the AWS SDKs (rclone, aws cli),
// because real-world clients disagree on whether the % escapes are encoded
// twice. Trying both candidates is free (a couple of SHA-256/HMAC ops).
package s3gw

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"
)

// ErrInvalidAuth is returned when the Authorization header is malformed or
// the signature does not verify.
type ErrInvalidAuth struct{ msg string }

func (e *ErrInvalidAuth) Error() string { return "s3gw: " + e.msg }

func authErr(format string, args ...any) error {
	return &ErrInvalidAuth{msg: fmt.Sprintf(format, args...)}
}

const (
	algorithm = "AWS4-HMAC-SHA256"
	emptyHash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
)

// awsEncode percent-encodes s per AWS SigV4 rules: unreserved RFC3986
// characters (A-Z a-z 0-9 - _ . ~) are kept, everything else is %XX-encoded
// with uppercase hex, and space becomes %20 (never '+').
func awsEncode(s string) string {
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') ||
			c == '-' || c == '_' || c == '.' || c == '~':
			b.WriteByte(c)
		default:
			b.WriteByte('%')
			b.WriteByte("0123456789ABCDEF"[c>>4])
			b.WriteByte("0123456789ABCDEF"[c&0x0f])
		}
	}
	return b.String()
}

// awsEncodePath encodes each path segment, preserving '/'.
func awsEncodePath(p string) string {
	segments := strings.Split(p, "/")
	for i, s := range segments {
		segments[i] = awsEncode(s)
	}
	return strings.Join(segments, "/")
}

// canonicalQueryString sorts and encodes query params like the SDKs do:
// keys sorted, values sorted within a key, each pair awsEncode'd.
func canonicalQueryString(q map[string][]string) string {
	keys := make([]string, 0, len(q))
	for k := range q {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var pairs []string
	for _, k := range keys {
		vals := append([]string(nil), q[k]...)
		sort.Strings(vals)
		for _, v := range vals {
			pairs = append(pairs, awsEncode(k)+"="+awsEncode(v))
		}
	}
	return strings.Join(pairs, "&")
}

// canonicalHeaders renders the SignedHeaders subset with trimmed values, in
// the order the client listed them (spec: sorted by name — the client's list
// is already sorted; we keep their order and values).
func canonicalHeaders(r *http.Request, signedHeaders []string) string {
	var b strings.Builder
	for _, name := range signedHeaders {
		var v string
		switch name {
		case "host":
			v = r.Host
			if v == "" {
				v = r.Header.Get("Host")
			}
		default:
			v = strings.Join(r.Header.Values(name), ",")
		}
		v = strings.TrimSpace(v)
		b.WriteString(name)
		b.WriteByte(':')
		b.WriteString(v)
		b.WriteByte('\n')
	}
	return b.String()
}

// canonicalRequest builds the SigV4 canonical request for a given payloadHash.
func canonicalRequest(r *http.Request, payloadHash string, signedHeaders []string) string {
	path := r.URL.EscapedPath()
	if path == "" {
		path = "/"
	}
	// AWS SDKs sign the DOUBLE-encoded path; hand-rolled clients sign the
	// single-encoded one. We build the double form here and try the single
	// form as a fallback in Verify.
	canonicalURI := awsEncodePath(path) // double-encode: '%' is encoded again

	q := r.URL.Query()
	canonicalQuery := canonicalQueryString(q)

	return strings.Join([]string{
		r.Method,
		canonicalURI,
		canonicalQuery,
		canonicalHeaders(r, signedHeaders),
		strings.Join(signedHeaders, ";"),
		payloadHash,
	}, "\n")
}

// cred is a parsed AWS credential scope.
type cred struct {
	accessKey  string
	date       string // YYYYMMDD
	region     string
	service    string
	signedHdrs []string
	signature  string
}

// parseAuth extracts the fields of an AWS4 Authorization header.
func parseAuth(header string) (*cred, error) {
	if !strings.HasPrefix(header, algorithm+" ") {
		return nil, authErr("unsupported authorization scheme")
	}
	rest := strings.TrimPrefix(header, algorithm+" ")
	parts := strings.Split(rest, ",")
	var credStr, signedHdrsStr, signature string
	for _, p := range parts {
		p = strings.TrimSpace(p)
		k, v, ok := strings.Cut(p, "=")
		if !ok {
			return nil, authErr("malformed authorization field %q", p)
		}
		switch k {
		case "Credential":
			credStr = strings.TrimSpace(v)
		case "SignedHeaders":
			signedHdrsStr = strings.TrimSpace(v)
		case "Signature":
			signature = strings.TrimSpace(v)
		}
	}
	if credStr == "" || signedHdrsStr == "" || signature == "" {
		return nil, authErr("missing Credential/SignedHeaders/Signature")
	}
	// Credential = <access>/<date>/<region>/<service>/aws4_request
	scope := strings.Split(credStr, "/")
	if len(scope) != 5 || scope[4] != "aws4_request" {
		return nil, authErr("malformed credential scope")
	}
	if len(signedHdrsStr) == 0 {
		return nil, authErr("empty SignedHeaders")
	}
	return &cred{
		accessKey:  scope[0],
		date:       scope[1],
		region:     scope[2],
		service:    scope[3],
		signedHdrs: strings.Split(signedHdrsStr, ";"),
		signature:  signature,
	}, nil
}

// Verify checks a request's AWS4 signature against the given secret (the
// personal API token). Returns the parsed credential on success so callers
// can read the access key (= token) for identity lookup.
func Verify(r *http.Request, secret string) (*cred, error) {
	c, err := parseAuth(r.Header.Get("Authorization"))
	if err != nil {
		return nil, err
	}
	if c.service != "s3" {
		return nil, authErr("expected service 's3', got %q", c.service)
	}

	amzDate := r.Header.Get("X-Amz-Date")
	if amzDate == "" {
		return nil, authErr("missing X-Amz-Date")
	}
	// Scope date must match the request date (SDK behaviour).
	if len(amzDate) < 8 || c.date != amzDate[:8] {
		return nil, authErr("credential date %s does not match X-Amz-Date", c.date)
	}
	// Reject stale requests: ±24h tolerance (replay protection without
	// breaking clients with slightly wrong clocks).
	t, err := time.Parse("20060102T150405Z", amzDate)
	if err != nil {
		return nil, authErr("bad X-Amz-Date %q", amzDate)
	}
	if skew := time.Since(t); skew > 24*time.Hour || skew < -24*time.Hour {
		return nil, authErr("request timestamp outside ±24h window")
	}

	payloadHash := r.Header.Get("X-Amz-Content-Sha256")
	if payloadHash == "" {
		payloadHash = "UNSIGNED-PAYLOAD"
	}
	if !isHex64(payloadHash) && payloadHash != "UNSIGNED-PAYLOAD" {
		return nil, authErr("bad X-Amz-Content-Sha256")
	}

	// Two canonical URI candidates (see package comment).
	double := canonicalRequest(r, payloadHash, c.signedHdrs)
	var single string
	if p := r.URL.Path; p != "" {
		singleEncoded := awsEncodePath(p)
		single = strings.Replace(double, awsEncodePath(r.URL.EscapedPath()), singleEncoded, 1)
	}

	stringToSign := func(canon string) string {
		return strings.Join([]string{
			algorithm,
			amzDate,
			c.date + "/" + c.region + "/s3/aws4_request",
			hexSHA256(canon),
		}, "\n")
	}

	expected := sign(secret, c.date, c.region, stringToSign(double))
	ok := hmac.Equal([]byte(expected), []byte(c.signature))
	if !ok && single != "" {
		expected = sign(secret, c.date, c.region, stringToSign(single))
		ok = hmac.Equal([]byte(expected), []byte(c.signature))
	}
	if !ok {
		return nil, authErr("signature mismatch")
	}
	return c, nil
}

func sign(secret, date, region, stringToSign string) string {
	kDate := hmacSHA256([]byte("AWS4"+secret), date)
	kRegion := hmacSHA256(kDate, region)
	kService := hmacSHA256(kRegion, "s3")
	kSigning := hmacSHA256(kService, "aws4_request")
	return hex.EncodeToString(hmacSHA256(kSigning, stringToSign))
}

func hmacSHA256(key []byte, data string) []byte {
	h := hmac.New(sha256.New, key)
	h.Write([]byte(data))
	return h.Sum(nil)
}

func hexSHA256(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:])
}

func isHex64(s string) bool {
	if len(s) != 64 {
		return false
	}
	for _, c := range s {
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')) {
			return false
		}
	}
	return true
}

// Sign builds an AWS4 Authorization header for a request (client side).
// Used by tests — production clients (rclone, aws cli) sign with their own
// SDKs. Produces the double-encoded canonical URI form the SDKs use.
func Sign(r *http.Request, accessKey, secret, region string, body []byte) string {
	now := time.Now().UTC()
	date := now.Format("20060102")
	amzDate := now.Format("20060102T150405Z")
	r.Header.Set("X-Amz-Date", amzDate)
	if r.Header.Get("X-Amz-Content-Sha256") == "" {
		if len(body) == 0 {
			r.Header.Set("X-Amz-Content-Sha256", emptyHash)
		} else {
			h := sha256.Sum256(body)
			r.Header.Set("X-Amz-Content-Sha256", hex.EncodeToString(h[:]))
		}
	}
	payloadHash := r.Header.Get("X-Amz-Content-Sha256")

	signedHeaders := []string{"host", "x-amz-content-sha256", "x-amz-date"}
	canon := canonicalRequest(r, payloadHash, signedHeaders)
	sts := strings.Join([]string{
		algorithm,
		amzDate,
		date + "/" + region + "/s3/aws4_request",
		hexSHA256(canon),
	}, "\n")
	sig := sign(secret, date, region, sts)

	hdr := fmt.Sprintf("%s Credential=%s/%s/%s/s3/aws4_request, SignedHeaders=%s, Signature=%s",
		algorithm, accessKey, date, region, strings.Join(signedHeaders, ";"), sig)
	r.Header.Set("Authorization", hdr)
	return hdr
}
