// Package storage provides an S3-compatible storage provider.
// It works with AWS S3, Cloudflare R2, MinIO, and any S3-compatible API.
package storage

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/xml"
	"fmt"
	"io"
	"log"
	"net/http"
	"path"
	"sort"
	"strings"
	"time"
)

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
	return fmt.Sprintf("%s/%s", base, key)
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
	canonicalURI := req.URL.Path
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

	log.Printf("S3 SigV4: method=%s path=%s query=%s host=%s credential=%s/%s region=%s algo=%s",
		method, canonicalURI, canonicalQueryString, host, p.cfg.AccessKeyID, credentialScope, p.cfg.Region, algorithm)
	log.Printf("S3 SigV4 canonical-request-hash=%s string-to-sign-hash=%s",
		sha256Hex([]byte(canonicalRequest)), sha256Hex([]byte(stringToSign)))
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

type listBucketResult struct {
	Name          string `xml:"Name"`
	Prefix        string `xml:"Prefix"`
	Delimiter     string `xml:"Delimiter"`
	MaxKeys       int    `xml:"MaxKeys"`
	IsTruncated   bool   `xml:"IsTruncated"`
	Contents      []s3Object
	CommonPrefixes []s3CommonPrefix `xml:"CommonPrefixes"`
}

type s3Object struct {
	Key          string `xml:"Key"`
	LastModified string `xml:"LastModified"`
	ETag         string `xml:"ETag"`
	Size         int64  `xml:"Size"`
	StorageClass string `xml:"StorageClass"`
}

type s3CommonPrefix struct {
	Prefix string `xml:"Prefix"`
}

// ─── StorageProvider implementation ──────────────────────────────────────

// List returns files and directories at the given relative path.
func (p *S3Provider) List(rel string) ([]FileInfo, error) {
	prefix := p.resolveKey(rel)
	if prefix != "" && !strings.HasSuffix(prefix, "/") {
		prefix += "/"
	}

	ctx := context.Background()
	queryPrefix := prefix
	if queryPrefix == "" {
		queryPrefix = p.cfg.Prefix
	}

	// Use V1 if forced, otherwise try V2 first
	if p.cfg.ForceListV1 {
		items, err := p.listV1(ctx, queryPrefix, prefix)
		if err != nil && strings.Contains(err.Error(), "status 500") {
			log.Printf("S3 List: V1 with delimiter failed (forced), trying without delimiter")
			return p.listNoDelimiter(ctx, queryPrefix, prefix)
		}
		return items, err
	}
	// Try ListObjectsV2 first with delimiter, fall back as needed
	items, err := p.listV2(ctx, queryPrefix, prefix)
	if err != nil && (strings.Contains(err.Error(), "status 500") || strings.Contains(err.Error(), "status 501")) {
		log.Printf("S3 List V2 failed, trying V1: %v", err)
		items, err = p.listV1(ctx, queryPrefix, prefix)
	}
	// If delimiter causes 500, retry without delimiter and group manually
	if err != nil && strings.Contains(err.Error(), "status 500") {
		log.Printf("S3 List with delimiter failed, trying without delimiter: %v", err)
		return p.listNoDelimiter(ctx, queryPrefix, prefix)
	}
	return items, err
}

// listV2 uses ListObjectsV2 API
func (p *S3Provider) listV2(ctx context.Context, queryPrefix, prefix string) ([]FileInfo, error) {
	url := fmt.Sprintf("%s?list-type=2&delimiter=/&prefix=%s", p.baseURL(), urlEncodePath(queryPrefix))
	return p.doListRequest(ctx, url, prefix)
}

// listV1 uses ListObjectsV1 API (without list-type=2)
func (p *S3Provider) listV1(ctx context.Context, queryPrefix, prefix string) ([]FileInfo, error) {
	url := fmt.Sprintf("%s?delimiter=/&prefix=%s&max-keys=1000", p.baseURL(), urlEncodePath(queryPrefix))
	return p.doListRequest(ctx, url, prefix)
}

// doListRequest sends the request and parses the XML response.
func (p *S3Provider) doListRequest(ctx context.Context, url, prefix string) ([]FileInfo, error) {
	log.Printf("S3 List: url=%s", url)
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, fmt.Errorf("s3: create list request: %w", err)
	}

	p.sign(req, nil)

	resp, err := p.client.Do(req)
	if err != nil {
		log.Printf("S3 List network error: %v", err)
		return nil, fmt.Errorf("s3: list failed: %w", err)
	}
	defer resp.Body.Close()

	log.Printf("S3 List response status: %d", resp.StatusCode)

	if resp.StatusCode == 404 {
		return nil, ErrNotFound
	}
	if resp.StatusCode != 200 {
		bodyBytes, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		log.Printf("S3 List error body: %s", string(bodyBytes))
		return nil, fmt.Errorf("s3: list failed with status %d: %s", resp.StatusCode, string(bodyBytes))
	}

	var result listBucketResult
	if err := xml.NewDecoder(resp.Body).Decode(&result); err != nil {
		log.Printf("S3 List XML parse error: %v", err)
		return nil, fmt.Errorf("s3: list parse XML: %w", err)
	}

	log.Printf("S3 List parsed: Contents=%d, CommonPrefixes=%d", len(result.Contents), len(result.CommonPrefixes))

	var items []FileInfo
	seen := make(map[string]bool)

	// Add directories from CommonPrefixes
	for _, cp := range result.CommonPrefixes {
		dirName := strings.TrimPrefix(cp.Prefix, prefix)
		dirName = strings.TrimSuffix(dirName, "/")
		if dirName == "" || seen[dirName] {
			continue
		}
		seen[dirName] = true
		items = append(items, FileInfo{
			Name:  dirName,
			Path:  strings.TrimPrefix(strings.TrimSuffix(cp.Prefix, "/"), p.cfg.Prefix),
			IsDir: true,
		})
	}

	// Add files from Contents
	for _, obj := range result.Contents {
		if obj.Key == prefix || strings.HasSuffix(obj.Key, "/") {
			continue
		}
		name := strings.TrimPrefix(obj.Key, prefix)
		if name == "" || seen[name] {
			continue
		}
		seen[name] = true

		lastModified, _ := time.Parse(time.RFC3339, strings.ReplaceAll(obj.LastModified, " ", "T")+"Z")
		items = append(items, FileInfo{
			Name:     name,
			Path:     strings.TrimPrefix(obj.Key, p.cfg.Prefix),
			Size:     obj.Size,
			Modified: lastModified,
			Mime:     detectMime(name),
		})
	}

	return items, nil
}

// listNoDelimiter lists all objects with a prefix and simulates directory grouping.
// Used for S3-compatible providers that crash on the delimiter= parameter.
func (p *S3Provider) listNoDelimiter(ctx context.Context, queryPrefix, prefix string) ([]FileInfo, error) {
	// List ALL objects with the prefix (no delimiter)
	url := fmt.Sprintf("%s?prefix=%s&max-keys=1000", p.baseURL(), urlEncodePath(queryPrefix))
	log.Printf("S3 List (no-delimiter): url=%s", url)

	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, fmt.Errorf("s3: create list request: %w", err)
	}

	p.sign(req, nil)

	resp, err := p.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("s3: list failed: %w", err)
	}
	defer resp.Body.Close()

	log.Printf("S3 List (no-delimiter) response: %d", resp.StatusCode)

	if resp.StatusCode != 200 {
		bodyBytes, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return nil, fmt.Errorf("s3: list failed with status %d: %s", resp.StatusCode, string(bodyBytes))
	}

	var result listBucketResult
	if err := xml.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("s3: list parse XML: %w", err)
	}

	// Manually group into directories using the next / after the prefix
	dirs := make(map[string]bool)
	var files []FileInfo

	for _, obj := range result.Contents {
		if obj.Key == prefix || strings.HasSuffix(obj.Key, "/") {
			continue
		}

		// Get the part of the key after the prefix
		rest := strings.TrimPrefix(obj.Key, prefix)
		if rest == "" {
			continue
		}

		// If rest contains a /, the first segment is a directory
		if idx := strings.Index(rest, "/"); idx >= 0 {
			dirName := rest[:idx]
			if dirName != "" {
				dirs[dirName] = true
			}
		} else {
			// No / means this is a direct file in the current folder
			lastModified, _ := time.Parse(time.RFC3339, strings.ReplaceAll(obj.LastModified, " ", "T")+"Z")
			files = append(files, FileInfo{
				Name:     rest,
				Path:     strings.TrimPrefix(obj.Key, p.cfg.Prefix),
				Size:     obj.Size,
				Modified: lastModified,
				Mime:     detectMime(rest),
			})
		}
	}

	// Build result: directories first, then files
	var items []FileInfo
	for d := range dirs {
		items = append(items, FileInfo{
			Name:  d,
			Path:  strings.TrimPrefix(prefix+d+"/", p.cfg.Prefix),
			IsDir: true,
		})
	}
	items = append(items, files...)

	log.Printf("S3 List (no-delimiter): %d dirs, %d files", len(dirs), len(files))
	return items, nil
}

// Stat returns metadata for a single file.
func (p *S3Provider) Stat(rel string) (FileInfo, error) {
	key := p.resolveKey(rel)
	ctx := context.Background()

	resp, err := p.doRequest(ctx, "HEAD", key, nil, nil)
	if err != nil {
		return FileInfo{}, err
	}
	defer resp.Body.Close()

	if resp.StatusCode == 404 {
		return FileInfo{}, ErrNotFound
	}
	if resp.StatusCode != 200 {
		return FileInfo{}, fmt.Errorf("s3: stat failed with status %d", resp.StatusCode)
	}

	lastModified := time.Now()
	if lm := resp.Header.Get("Last-Modified"); lm != "" {
		lastModified, _ = time.Parse(time.RFC1123, lm)
	}

	fi := FileInfo{
		Name:     path.Base(rel),
		Path:     rel,
		Size:     resp.ContentLength,
		IsDir:    strings.HasSuffix(rel, "/"),
		Modified: lastModified,
		Mime:     resp.Header.Get("Content-Type"),
	}

	return fi, nil
}

// Read opens a file for reading.
func (p *S3Provider) Read(rel string) (io.ReadCloser, error) {
	key := p.resolveKey(rel)
	ctx := context.Background()

	resp, err := p.doRequest(ctx, "GET", key, nil, nil)
	if err != nil {
		return nil, err
	}

	if resp.StatusCode == 404 {
		resp.Body.Close()
		return nil, ErrNotFound
	}
	if resp.StatusCode != 200 {
		resp.Body.Close()
		return nil, fmt.Errorf("s3: read failed with status %d", resp.StatusCode)
	}

	return resp.Body, nil
}

// Write creates or overwrites a file.
func (p *S3Provider) Write(rel string, r io.Reader, size int64) error {
	key := p.resolveKey(rel)
	ctx := context.Background()

	body, err := io.ReadAll(r)
	if err != nil {
		return fmt.Errorf("s3: read input: %w", err)
	}

	contentType := detectMime(path.Base(rel))

	resp, err := p.doRequest(ctx, "PUT", key, body, map[string]string{
		"Content-Type": contentType,
	})
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		bodyErr, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return fmt.Errorf("s3: write failed with status %d: %s", resp.StatusCode, string(bodyErr))
	}

	return nil
}

// CreateDirectory creates a "directory" (0-byte object ending with /).
func (p *S3Provider) CreateDirectory(rel string) error {
	dirKey := p.resolveKey(rel)
	if !strings.HasSuffix(dirKey, "/") {
		dirKey += "/"
	}

	ctx := context.Background()
	emptyBody := []byte{}
	resp, err := p.doRequest(ctx, "PUT", dirKey, emptyBody, map[string]string{
		"Content-Type": "application/x-directory",
	})
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 && resp.StatusCode != 201 {
		bodyErr, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return fmt.Errorf("s3: create directory failed with status %d: %s", resp.StatusCode, string(bodyErr))
	}

	return nil
}

// Move moves an S3 object by copy+delete.
func (p *S3Provider) Move(source, dest string) error {
	srcKey := p.resolveKey(source)
	dstKey := p.resolveKey(dest)

	ctx := context.Background()
	copySource := urlEncodePath(fmt.Sprintf("/%s/%s", p.cfg.Bucket, srcKey))

	resp, err := p.doRequest(ctx, "PUT", dstKey, []byte{}, map[string]string{
		"X-Amz-Copy-Source": copySource,
	})
	if err != nil {
		return fmt.Errorf("s3: copy for move: %w", err)
	}
	if resp.StatusCode >= 300 {
		bodyErr, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		resp.Body.Close()
		return fmt.Errorf("s3: copy for move failed with status %d: %s", resp.StatusCode, string(bodyErr))
	}
	resp.Body.Close()

	// Delete source
	resp2, err := p.doRequest(ctx, "DELETE", srcKey, nil, nil)
	if err != nil {
		return fmt.Errorf("s3: delete after move: %w", err)
	}
	defer resp2.Body.Close()

	if resp2.StatusCode >= 300 && resp2.StatusCode != 404 {
		bodyErr, _ := io.ReadAll(io.LimitReader(resp2.Body, 4096))
		return fmt.Errorf("s3: delete after move failed with status %d: %s", resp2.StatusCode, string(bodyErr))
	}

	return nil
}

// Copy copies an S3 object.
func (p *S3Provider) Copy(source, dest string) error {
	srcKey := p.resolveKey(source)
	dstKey := p.resolveKey(dest)

	ctx := context.Background()
	copySource := urlEncodePath(fmt.Sprintf("/%s/%s", p.cfg.Bucket, srcKey))

	resp, err := p.doRequest(ctx, "PUT", dstKey, []byte{}, map[string]string{
		"X-Amz-Copy-Source": copySource,
	})
	if err != nil {
		return fmt.Errorf("s3: copy failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		bodyErr, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return fmt.Errorf("s3: copy failed with status %d: %s", resp.StatusCode, string(bodyErr))
	}

	return nil
}

// Delete removes an object.
func (p *S3Provider) Delete(rel string) error {
	key := p.resolveKey(rel)
	ctx := context.Background()

	resp, err := p.doRequest(ctx, "DELETE", key, nil, nil)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 204 && resp.StatusCode != 200 && resp.StatusCode != 404 {
		return fmt.Errorf("s3: delete failed with status %d", resp.StatusCode)
	}

	return nil
}

// OpenRange opens a byte range for streaming.
func (p *S3Provider) OpenRange(rel string, start, end int64) (io.ReadCloser, int64, error) {
	key := p.resolveKey(rel)
	ctx := context.Background()

	rangeHeader := fmt.Sprintf("bytes=%d-%d", start, end)
	resp, err := p.doRequest(ctx, "GET", key, nil, map[string]string{
		"Range": rangeHeader,
	})
	if err != nil {
		return nil, 0, err
	}

	if resp.StatusCode == 404 {
		resp.Body.Close()
		return nil, 0, ErrNotFound
	}

	if resp.StatusCode != 206 && resp.StatusCode != 200 {
		resp.Body.Close()
		return nil, 0, fmt.Errorf("s3: range request failed with status %d", resp.StatusCode)
	}

	return resp.Body, resp.ContentLength, nil
}

// Search walks the S3 bucket matching query conditions.
func (p *S3Provider) Search(q SearchQuery) ([]FileInfo, error) {
	items, err := p.List(q.Path)
	if err != nil {
		return nil, err
	}

	var out []FileInfo
	limit := q.Limit
	if limit <= 0 || limit > 500 {
		limit = 200
	}

	for _, fi := range items {
		if len(out) >= limit {
			break
		}
		if matchSearch(fi, q) {
			out = append(out, fi)
		}
	}

	sort.Slice(out, func(i, j int) bool {
		return out[i].Name < out[j].Name
	})

	return out, nil
}

// GetQuota returns placeholder quota info.
func (p *S3Provider) GetQuota() (Quota, error) {
	return Quota{
		Total:     1_000_000_000_000,
		Available: 1_000_000_000_000,
		Used:      0,
	}, nil
}

// PresignedURL generates a presigned URL for direct download.
func (p *S3Provider) PresignedURL(rel string, expiry time.Duration) (string, error) {
	key := p.resolveKey(rel)
	url := p.objectURL(key)
	return url, nil
}

// ─── Helpers ─────────────────────────────────────────────────────────────

// detectMime returns a content type based on file extension.
func detectMime(name string) string {
	ext := strings.ToLower(path.Ext(name))
	switch ext {
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".png":
		return "image/png"
	case ".gif":
		return "image/gif"
	case ".webp":
		return "image/webp"
	case ".svg":
		return "image/svg+xml"
	case ".mp4", ".mkv", ".avi", ".mov":
		return "video/mp4"
	case ".webm":
		return "video/webm"
	case ".mp3":
		return "audio/mpeg"
	case ".flac":
		return "audio/flac"
	case ".wav":
		return "audio/wav"
	case ".ogg", ".opus":
		return "audio/ogg"
	case ".pdf":
		return "application/pdf"
	case ".zip":
		return "application/zip"
	case ".gz", ".tar":
		return "application/gzip"
	case ".exe", ".dll":
		return "application/vnd.microsoft.portable-executable"
	case ".iso":
		return "application/x-iso9660-image"
	case ".json":
		return "application/json"
	case ".xml":
		return "application/xml"
	case ".html", ".htm":
		return "text/html"
	case ".css":
		return "text/css"
	case ".js", ".ts", ".tsx", ".jsx":
		return "application/javascript"
	case ".txt", ".md", ".log":
		return "text/plain"
	case ".csv":
		return "text/csv"
	default:
		return "application/octet-stream"
	}
}

// urlEncodePath percent-encodes a path for use in S3 URLs and headers.
func urlEncodePath(s string) string {
	var out strings.Builder
	for i := 0; i < len(s); i++ {
		c := s[i]
		if (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') ||
			c == '/' || c == '-' || c == '_' || c == '.' || c == '~' || c == ':' {
			out.WriteByte(c)
		} else {
			fmt.Fprintf(&out, "%%%02X", c)
		}
	}
	return out.String()
}

// Ensure interface compliance.
var _ StorageProvider = (*S3Provider)(nil)
