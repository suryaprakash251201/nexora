package s3gw

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/xml"
	"fmt"
	"net/http"
	"time"
)

// XML response types mirroring the S3 API surface Nexora implements:
// ListBuckets, ListObjectsV2, multipart upload lifecycle, and errors.

type Owner struct {
	ID          string `xml:"ID"`
	DisplayName string `xml:"DisplayName"`
}

type Bucket struct {
	Name         string    `xml:"Name"`
	CreationDate time.Time `xml:"CreationDate"`
}

type ListBucketsResult struct {
	XMLName xml.Name `xml:"ListAllMyBucketsResult"`
	Xmlns   string   `xml:"xmlns,attr"`
	Owner   Owner    `xml:"Owner"`
	Buckets []Bucket `xml:"Buckets>Bucket"`
}

type Object struct {
	Key          string    `xml:"Key"`
	LastModified time.Time `xml:"LastModified"`
	ETag         string    `xml:"ETag"`
	Size         int64     `xml:"Size"`
	StorageClass string    `xml:"StorageClass"`
}

type CommonPrefix struct {
	Prefix string `xml:"Prefix"`
}

type ListObjectsV2Result struct {
	XMLName               xml.Name       `xml:"ListBucketResult"`
	Xmlns                 string         `xml:"xmlns,attr"`
	Name                  string         `xml:"Name"`
	Prefix                string         `xml:"Prefix"`
	MaxKeys               int            `xml:"MaxKeys"`
	KeyCount              int            `xml:"KeyCount"`
	Delimiter             string         `xml:"Delimiter,omitempty"`
	IsTruncated           bool           `xml:"IsTruncated"`
	NextContinuationToken string         `xml:"NextContinuationToken,omitempty"`
	Contents              []Object       `xml:"Contents"`
	CommonPrefixes        []CommonPrefix `xml:"CommonPrefixes"`
}

type InitiateMultipartUploadResult struct {
	XMLName  xml.Name `xml:"InitiateMultipartUploadResult"`
	Xmlns    string   `xml:"xmlns,attr"`
	Bucket   string   `xml:"Bucket"`
	Key      string   `xml:"Key"`
	UploadID string   `xml:"UploadId"`
}

type Part struct {
	PartNumber   int       `xml:"PartNumber"`
	LastModified time.Time `xml:"LastModified"`
	ETag         string    `xml:"ETag"`
	Size         int64     `xml:"Size"`
}

type CompleteMultipartUploadResult struct {
	XMLName  xml.Name `xml:"CompleteMultipartUploadResult"`
	Xmlns    string   `xml:"xmlns,attr"`
	Location string   `xml:"Location"`
	Bucket   string   `xml:"Bucket"`
	Key      string   `xml:"Key"`
	ETag     string   `xml:"ETag"`
}

type ListPartsResult struct {
	XMLName  xml.Name `xml:"ListPartsResult"`
	Xmlns    string   `xml:"xmlns,attr"`
	Bucket   string   `xml:"Bucket"`
	Key      string   `xml:"Key"`
	UploadID string   `xml:"UploadId"`
	Parts    []Part   `xml:"Part"`
}

type DeleteResult struct {
	XMLName xml.Name `xml:"DeleteResult"`
	Xmlns   string   `xml:"xmlns,attr"`
}

// S3Error is the canonical S3 error envelope.
type S3Error struct {
	XMLName   xml.Name `xml:"Error"`
	Code      string   `xml:"Code"`
	Message   string   `xml:"Message"`
	Resource  string   `xml:"Resource,omitempty"`
	RequestID string   `xml:"RequestId,omitempty"`
}

// WriteError writes an S3-style XML error. S3 clients read the <Code> field
// for programmatic handling; HTTP status is still respected by most tools.
func WriteError(w http.ResponseWriter, status int, code, message string) {
	w.Header().Set("Content-Type", "application/xml")
	w.Header().Set("x-amz-request-id", "nexora")
	w.WriteHeader(status)
	_ = xml.NewEncoder(w).Encode(S3Error{Code: code, Message: message})
}

// WriteXML writes any of the result structs above.
func WriteXML(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/xml")
	w.Header().Set("x-amz-request-id", "nexora")
	w.WriteHeader(status)
	_ = xml.NewEncoder(w).Encode(v)
}

// Common S3 error codes we emit.
const (
	ErrCodeNoSuchBucket          = "NoSuchBucket"
	ErrCodeNoSuchKey             = "NoSuchKey"
	ErrCodeNoSuchUpload          = "NoSuchUpload"
	ErrCodeAccessDenied          = "AccessDenied"
	ErrCodeInvalidAccessKeyID    = "InvalidAccessKeyId"
	ErrCodeSignatureDoesNotMatch = "SignatureDoesNotMatch"
	ErrCodeInvalidRequest        = "InvalidRequest"
	ErrCodeInvalidArgument       = "InvalidArgument"
	ErrCodePreconditionFailed    = "PreconditionFailed"
	ErrCodeEntityTooLarge        = "EntityTooLarge"
	ErrCodeNotImplemented        = "NotImplemented"
	ErrCodeInvalidPartOrder      = "InvalidPartOrder"
	ErrCodeInvalidPart           = "InvalidPart"
)

// MaxS3PartSize is the per-part cap for the S3 multipart gateway. It mirrors
// the 5 GiB S3 minimum-part-maximum spec but stays well below the per-upload
// MaxUploadSize cap from config so a single misbehaving client cannot
// exhaust the disk via repeated large parts.
const MaxS3PartSize = 5 << 30 // 5 GiB


// ETagFor builds a stable opaque object tag from the file info we have
// (size + mtime). Nexora does not store content hashes, so the tag is
// deterministic per file state — enough for change detection when combined
// with size, and cheap (no body read on GET/HEAD).
func ETagFor(size int64, modTime time.Time) string {
	sum := sha256.Sum256([]byte(fmt.Sprintf("%d|%d", size, modTime.UnixNano())))
	h := hex.EncodeToString(sum[:])
	return `"` + h[:16] + `"`
}
