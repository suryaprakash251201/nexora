// Package storage provides an S3-compatible storage provider.
// It works with AWS S3, Cloudflare R2, MinIO, and any S3-compatible API.
package storage

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"log"
	"net/http"
	"path"
	"sort"
	"strings"
	"time"
)

// sanitizeLog escapes newlines and control characters in a string so it
// cannot inject fake log entries (CWE-117).
func sanitizeLog(s string) string {
	s = strings.ReplaceAll(s, "\n", "\\n")
	s = strings.ReplaceAll(s, "\r", "\\r")
	return s
}

// S3Config holds configuration for an S3-compatible storage backend.

type S3Config struct {
	Endpoint        string
	Region          string
	Bucket          string
	AccessKeyID     string
	SecretAccessKey string
	UsePathStyle    bool
	Prefix          string
	ForceListV1     bool // use ListObjectsV1 instead of V2
}

// S3Provider implements StorageProvider against S3-compatible storage.

type S3Provider struct {
	cfg    S3Config
	client *http.Client
}

// NewS3Provider creates an S3-compatible storage provider.

func NewS3Provider(cfg S3Config) *S3Provider {
	// Auto-detect region from endpoint if empty or clearly wrong
	if cfg.Region == "" || strings.ToUpper(cfg.Region) == cfg.Region && len(cfg.Region) > 5 {
		autoRegion := extractRegion(cfg.Endpoint)
		if cfg.Region == "" || strings.ToUpper(cfg.Region) != cfg.Region {
			cfg.Region = autoRegion
		} else {
			log.Printf("S3: region '%s' looks uppercase, auto-detected '%s' from endpoint, using auto-detected", cfg.Region, autoRegion)
			cfg.Region = autoRegion
		}
	}
	// Normalize region to lowercase
	cfg.Region = strings.ToLower(cfg.Region)
	if cfg.Prefix != "" {
		cfg.Prefix = strings.Trim(cfg.Prefix, "/") + "/"
	}
	return &S3Provider{
		cfg: cfg,
		client: &http.Client{
			Timeout: 60 * time.Second,
		},
	}
}

// extractRegion tries to extract a region from an S3 endpoint.
// e.g., s3.in-west3.purestore.io -> in-west3, s3.us-east-1.amazonaws.com -> us-east-1

func extractRegion(endpoint string) string {
	// Strip scheme
	host := strings.TrimPrefix(endpoint, "https://")
	host = strings.TrimPrefix(host, "http://")
	// Strip trailing slash and port
	host = strings.TrimRight(host, "/")
	if idx := strings.Index(host, ":"); idx >= 0 {
		host = host[:idx]
	}
	parts := strings.Split(host, ".")
	log.Printf("S3 extractRegion: host=%s parts=%v", host, parts)
	// Look for region patterns: s3.<region>.<rest> or s3-<region>.amazonaws.com
	for i, p := range parts {
		if strings.HasPrefix(p, "s3-") {
			region := strings.TrimPrefix(p, "s3-")
			log.Printf("S3 extractRegion: found via s3- prefix: %s", region)
			return region
		}
		// Skip the "s3" subdomain prefix (s3.<region>.amazonaws.com)
		if i == 0 && p == "s3" && len(parts) > 2 {
			// If the next part looks like a region, use it
			if isRegionPart(parts[1]) {
				log.Printf("S3 extractRegion: found region after s3: %s", parts[1])
				return parts[1]
			}
			continue
		}
		if isRegionPart(p) {
			log.Printf("S3 extractRegion: found via isRegionPart: %s", p)
			return p
		}
	}
	log.Printf("S3 extractRegion: no region found, using default us-east-1")
	return "us-east-1"
}

// isRegionPart checks if a string looks like an AWS region component.

func isRegionPart(s string) bool {
	// Matches patterns like: us-east-1, eu-west-2, in-west3, ap-northeast-1
	if len(s) < 3 || len(s) > 20 {
		return false
	}
	return strings.ContainsAny(s, "-") && !strings.Contains(s, "://")
}

// sortQueryString sorts query parameters alphabetically for SigV4 canonical request.

func sortQueryString(rawQuery string) string {
	if rawQuery == "" {
		return ""
	}
	// Split by &, sort, rejoin
	pairs := strings.Split(rawQuery, "&")
	sort.Strings(pairs)
	return strings.Join(pairs, "&")
}

// resolveKey converts a relative path to an S3 object key.

func (p *S3Provider) resolveKey(rel string) string {
	rel = strings.TrimPrefix(path.Clean("/"+rel), "/")
	return p.cfg.Prefix + rel
}

// baseURL returns the S3 endpoint (with bucket prefix for virtual-hosted style).

func (p *S3Provider) baseURL() string {
	// Ensure endpoint has scheme
	endpoint := p.cfg.Endpoint
	if !strings.HasPrefix(endpoint, "https://") && !strings.HasPrefix(endpoint, "http://") {
		endpoint = "https://" + endpoint
	}
	endpoint = strings.TrimRight(endpoint, "/")

	if p.cfg.UsePathStyle {
		return fmt.Sprintf("%s/%s", endpoint, p.cfg.Bucket)
	}
	// Virtual-hosted: https://bucket.endpoint
	endpointNoScheme := strings.TrimPrefix(endpoint, "https://")
	endpointNoScheme = strings.TrimPrefix(endpointNoScheme, "http://")
	return fmt.Sprintf("https://%s.%s", p.cfg.Bucket, endpointNoScheme)
}

// objectURL returns the full URL for an S3 object key.

func (p *S3Provider) objectURL(key string) string {
	base := p.baseURL()
	// URL-encode each path segment but keep / separators
	encodedKey := urlEncodePath(key)
	return fmt.Sprintf("%s/%s", base, encodedKey)
}

// hostHeader returns the Host header value for SigV4 signing.
// For path-style: just the endpoint host (e.g., s3.amazonaws.com)
// For virtual-hosted style: bucket.endpoint

func (p *S3Provider) hostHeader() string {
	if p.cfg.UsePathStyle {
		// Path-style: host is just the endpoint without scheme
		host := strings.TrimPrefix(p.cfg.Endpoint, "https://")
		host = strings.TrimPrefix(host, "http://")
		host = strings.TrimRight(host, "/")
		return host
	}
	// Virtual-hosted style: bucket.endpoint
	host := strings.TrimPrefix(p.cfg.Endpoint, "https://")
	host = strings.TrimPrefix(host, "http://")
	host = strings.TrimRight(host, "/")
	return fmt.Sprintf("%s.%s", p.cfg.Bucket, host)
}

// ─── AWS Signature V4 Implementation ─────────────────────────────────────

// sha256Hex returns the lowercase hex SHA-256 of data.

func sha256Hex(data []byte) string {
	h := sha256.Sum256(data)
	return hex.EncodeToString(h[:])
}

// hmacSHA256 computes HMAC-SHA256 of data using the given key.

func hmacSHA256(key []byte, data []byte) []byte {
	mac := hmac.New(sha256.New, key)
	mac.Write(data)
	return mac.Sum(nil)
}

// getDate returns the YYYYMMDD and YYYYMMDD'T'HHMMSS'Z' strings for a given time.

func getDate(t time.Time) (string, string) {
	date := t.Format("20060102")
	dateTime := t.Format("20060102T150405Z")
	return date, dateTime
}

// sign builds the AWS SigV4 Authorization header and other required headers.

func (p *S3Provider) sign(req *http.Request, body []byte) {
	t := time.Now().UTC()
	dateStr, dateTimeStr := getDate(t)

	// Hash the payload
	var payloadHash string
	if body == nil {
		// For requests without a body (GET, HEAD, DELETE), use the empty-string hash
		payloadHash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
	} else {
		payloadHash = sha256Hex(body)
	}

	// Set required headers
	host := p.hostHeader()
	req.Host = host
	req.Header.Set("Host", host)
	req.Header.Set("X-Amz-Date", dateTimeStr)
	req.Header.Set("X-Amz-Content-Sha256", payloadHash)

	// Always set Content-Length for requests with a body (including empty body for PUT)
	if body != nil {
		req.Header.Set("Content-Length", fmt.Sprintf("%d", len(body)))
	}

	// 1. Create Canonical Request
	method := req.Method
	canonicalURI := req.URL.EscapedPath() // encoded form (keeps %20), not decoded Path
	canonicalQueryString := sortQueryString(req.URL.RawQuery)

	// Collect and sort headers for canonical headers + signed headers
	var headerNames []string
	headers := make(map[string]string)
	for k, v := range req.Header {
		lk := strings.ToLower(k)
		// Skip expect header that Go adds automatically
		if lk == "expect" {
			continue
		}
		headerNames = append(headerNames, lk)
		headers[lk] = strings.TrimSpace(strings.Join(v, ","))
	}
	sort.Strings(headerNames)

	var canonicalHeaders strings.Builder
	var signedHeaders strings.Builder
	for i, name := range headerNames {
		canonicalHeaders.WriteString(name)
		canonicalHeaders.WriteString(":")
		canonicalHeaders.WriteString(headers[name])
		canonicalHeaders.WriteString("\n")
		if i > 0 {
			signedHeaders.WriteString(";")
		}
		signedHeaders.WriteString(name)
	}

	canonicalRequest := method + "\n" +
		canonicalURI + "\n" +
		canonicalQueryString + "\n" +
		canonicalHeaders.String() + "\n" +
		signedHeaders.String() + "\n" +
		payloadHash

	// 2. Create String to Sign
	algorithm := "AWS4-HMAC-SHA256"
	credentialScope := dateStr + "/" + p.cfg.Region + "/s3/aws4_request"

	stringToSign := algorithm + "\n" +
		dateTimeStr + "\n" +
		credentialScope + "\n" +
		sha256Hex([]byte(canonicalRequest))

	// 3. Calculate Signature
	signingKey := p.buildSigningKey(dateStr)
	signature := hex.EncodeToString(hmacSHA256(signingKey, []byte(stringToSign)))

	// 4. Build Authorization header
	authHeader := fmt.Sprintf("%s Credential=%s/%s, SignedHeaders=%s, Signature=%s",
		algorithm, p.cfg.AccessKeyID, credentialScope, signedHeaders.String(), signature)
	req.Header.Set("Authorization", authHeader)

	// Escape newlines and control characters in user-observable values to
	// prevent log injection / log forging (CWE-117).
	safeMethod := sanitizeLog(method)
	safePath := sanitizeLog(canonicalURI)
	safeQuery := sanitizeLog(canonicalQueryString)
	safeHost := sanitizeLog(host)
	safeReqHash := sanitizeLog(sha256Hex([]byte(canonicalRequest)))
	safeSigHash := sanitizeLog(sha256Hex([]byte(stringToSign)))

	log.Printf("S3 SigV4: method=%s path=%s query=%s host=%s credential=%s/%s region=%s algo=%s",
		safeMethod, safePath, safeQuery, safeHost, p.cfg.AccessKeyID, credentialScope, p.cfg.Region, algorithm)
	log.Printf("S3 SigV4 canonical-request-hash=%s string-to-sign-hash=%s",
		safeReqHash, safeSigHash)
}

// buildSigningKey derives the AWS SigV4 signing key.

func (p *S3Provider) buildSigningKey(dateStr string) []byte {
	kSecret := []byte("AWS4" + p.cfg.SecretAccessKey)
	kDate := hmacSHA256(kSecret, []byte(dateStr))
	kRegion := hmacSHA256(kDate, []byte(p.cfg.Region))
	kService := hmacSHA256(kRegion, []byte("s3"))
	kSigning := hmacSHA256(kService, []byte("aws4_request"))
	return kSigning
}

// ─── HTTP helpers ────────────────────────────────────────────────────────

// doRequest performs an S3 API request with SigV4 signing.

func (p *S3Provider) doRequest(ctx context.Context, method, key string, body []byte, headers map[string]string) (*http.Response, error) {
	url := p.objectURL(key)
	var bodyReader io.Reader
	if len(body) > 0 {
		bodyReader = bytes.NewReader(body)
	}
	req, err := http.NewRequestWithContext(ctx, method, url, bodyReader)
	if err != nil {
		return nil, fmt.Errorf("s3: create request: %w", err)
	}

	// Set extra headers BEFORE signing so they're included in canonical headers
	for k, v := range headers {
		req.Header.Set(k, v)
	}

	p.sign(req, body)

	resp, err := p.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("s3: request failed: %w", err)
	}

	return resp, nil
}

// ─── S3 ListObjectsV2 XML response types ─────────────────────────────────
