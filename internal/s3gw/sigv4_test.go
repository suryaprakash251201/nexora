package s3gw

import (
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestVerify_ValidSignature(t *testing.T) {
	req, _ := http.NewRequest("PUT", "http://example.com/s3/Files/hello%20world.txt", strings.NewReader("hello body"))
	req.Header.Set("Content-Type", "text/plain")
	req.Host = "example.com"
	Sign(req, "nxr_testtoken123", "nxr_testtoken123", "us-east-1", []byte("hello body"))

	c, err := Verify(req, "nxr_testtoken123")
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if c.accessKey != "nxr_testtoken123" {
		t.Fatalf("access key: %s", c.accessKey)
	}
}

func TestVerify_WrongSecret(t *testing.T) {
	req, _ := http.NewRequest("GET", "http://example.com/s3/Files/a.txt", nil)
	req.Host = "example.com"
	Sign(req, "nxr_token", "nxr_token", "us-east-1", nil)

	if _, err := Verify(req, "WRONG"); err == nil {
		t.Fatal("expected verification failure with wrong secret")
	}
}

func TestVerify_TamperedBody(t *testing.T) {
	// Sign a request for body "AAA" but send "BBB" without updating the
	// X-Amz-Content-Sha256 header — the payload hash won't match the body.
	req, _ := http.NewRequest("PUT", "http://example.com/s3/Files/a.txt", strings.NewReader("AAA"))
	req.Host = "example.com"
	Sign(req, "nxr_t", "nxr_t", "us-east-1", []byte("AAA"))
	// Finger the body AFTER signing (the signature covers the declared hash).
	if _, err := Verify(req, "nxr_t"); err != nil {
		t.Fatalf("verify with declared hash: %v", err)
	}
	// Now tamper the hash header itself (simulates a changed body).
	req.Header.Set("X-Amz-Content-Sha256", "de"+"adbeef"+strings.Repeat("0", 54))
	if _, err := Verify(req, "nxr_t"); err == nil {
		t.Fatal("expected failure after tampering content-sha256")
	}
}

func TestVerify_TamperedHeader(t *testing.T) {
	req, _ := http.NewRequest("GET", "http://example.com/s3/Files/a.txt", nil)
	req.Host = "example.com"
	Sign(req, "nxr_t", "nxr_t", "us-east-1", nil)
	// Tamper a signed header AFTER signing.
	req.Header.Set("X-Amz-Date", "20200101T000000Z")
	if _, err := Verify(req, "nxr_t"); err == nil {
		t.Fatal("expected failure after tampering X-Amz-Date")
	}
}

func TestVerify_MissingHeaders(t *testing.T) {
	req, _ := http.NewRequest("GET", "http://example.com/s3/Files/a.txt", nil)
	req.Host = "example.com"
	if _, err := Verify(req, "nxr_t"); err == nil {
		t.Fatal("expected failure without Authorization header")
	}
}

func TestVerify_WrongService(t *testing.T) {
	req, _ := http.NewRequest("GET", "http://example.com/", nil)
	req.Host = "example.com"
	// Manually craft a header claiming service = ec2.
	hdr := strings.Replace(SignHeader(req, "nxr_t", "nxr_t"), "/s3/", "/ec2/", 1)
	req.Header.Set("Authorization", hdr)
	if _, err := Verify(req, "nxr_t"); err == nil {
		t.Fatal("expected failure for non-s3 service scope")
	}
}

func TestVerify_RangeQueryAndPathEncoding(t *testing.T) {
	// Realistic rclone-style request: query params + encoded key + Range.
	req, _ := http.NewRequest("GET", "http://example.com/s3/Media/music/a%20b.flac?partNumber=1&uploadId=mpu_123", nil)
	req.Host = "example.com"
	req.Header.Set("Range", "bytes=0-99")
	Sign(req, "nxr_t", "nxr_t", "auto", nil) // region string doesn't matter

	if _, err := Verify(req, "nxr_t"); err != nil {
		t.Fatalf("verify: %v", err)
	}
}

func TestVerify_SingleEncodedFallback(t *testing.T) {
	// A hand-rolled client that signs the single-encoded path must also pass.
	req, _ := http.NewRequest("GET", "http://example.com/s3/Files/my%20doc.pdf", nil)
	req.Host = "example.com"
	now := time.Now().UTC()
	date := now.Format("20060102")
	amzDate := now.Format("20060102T150405Z")
	req.Header.Set("X-Amz-Date", amzDate)
	req.Header.Set("X-Amz-Content-Sha256", emptyHash)
	signedHeaders := []string{"host", "x-amz-content-sha256", "x-amz-date"}
	// AWS-spec canonical request (note the blank line between the headers
	// block and the SignedHeaders line — matches the docs example).
	canon := "GET\n" + awsEncodePath(req.URL.Path) + "\n\n" +
		canonicalHeaders(req, signedHeaders) + "\n" + strings.Join(signedHeaders, ";") + "\n" + emptyHash
	sts := strings.Join([]string{algorithm, amzDate, date + "/us-east-1/s3/aws4_request", hexSHA256(canon)}, "\n")
	req.Header.Set("Authorization", algorithm+" Credential=nxr_t/"+date+"/us-east-1/s3/aws4_request, SignedHeaders="+
		strings.Join(signedHeaders, ";")+", Signature="+sign("nxr_t", date, "us-east-1", sts))

	if _, err := Verify(req, "nxr_t"); err != nil {
		t.Fatalf("single-encoded signature should verify: %v", err)
	}
}

// SignHeader is Sign but returns the header string (helper for tests).
func SignHeader(req *http.Request, accessKey, secret string) string {
	return Sign(req, accessKey, secret, "us-east-1", nil)
}

func TestCanonicalQuerySorting(t *testing.T) {
	q := map[string][]string{
		"b": {"2", "1"},
		"a": {"x"},
	}
	got := canonicalQueryString(q)
	if got != "a=x&b=1&b=2" {
		t.Fatalf("canonical query: %q", got)
	}
}

func TestAwsEncode(t *testing.T) {
	cases := map[string]string{
		"a b": "a%20b",
		"a+b": "a%2Bb",
		"a~b": "a~b",   // ~ is unreserved
		"a/b": "a%2Fb", // raw encoding DOES escape / (query form)
	}
	for in, want := range cases {
		if got := awsEncode(in); got != want {
			t.Fatalf("awsEncode(%q) = %q, want %q", in, got, want)
		}
	}
	// awsEncodePath is the path form: '/' survives.
	if got := awsEncodePath("my dir/a~b/täck.txt"); got != "my%20dir/a~b/t%C3%A4ck.txt" {
		t.Fatalf("awsEncodePath = %q", got)
	}
}

func TestParseS3Range(t *testing.T) {
	const size = 1000
	cases := []struct {
		hdr        string
		start, end int64
		ok         bool
	}{
		{"bytes=0-99", 0, 99, true},
		{"bytes=100-", 100, 999, true},
		{"bytes=-50", 950, 999, true},
		{"bytes=0-0", 0, 0, true},
		{"bytes=999-1000", 999, 999, true}, // end clamped
		{"bytes=1000-", 0, 0, false},       // start beyond size
		{"items=0-9", 0, 0, false},
		{"bytes=5-2", 0, 0, false}, // inverted
		{"", 0, 0, false},
	}
	for _, c := range cases {
		start, end, ok := ParseS3Range(c.hdr, size)
		if ok != c.ok || (ok && (start != c.start || end != c.end)) {
			t.Fatalf("ParseS3Range(%q) = (%d,%d,%v), want (%d,%d,%v)", c.hdr, start, end, ok, c.start, c.end, c.ok)
		}
	}
}
