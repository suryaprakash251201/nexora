package s3gw

import (
	"strconv"
	"strings"
)

// ParseS3Range parses an HTTP Range header (single-range form) against an
// object of the given size, returning the inclusive byte window. Handles
// `bytes=start-end`, `bytes=start-` and suffix `bytes=-N`. Returns ok=false
// for malformed or out-of-range specs (caller decides whether to ignore or
// answer 416). Multi-range requests are declined (S3 serves them as the
// whole object or 416; we ignore the request header like many S3
// implementations do for multi-range).
func ParseS3Range(hdr string, size int64) (start, end int64, ok bool) {
	if !strings.HasPrefix(hdr, "bytes=") {
		return 0, 0, false
	}
	spec := strings.TrimPrefix(hdr, "bytes=")
	// Only the first range is honoured; ignore additional ranges.
	spec, _, _ = strings.Cut(spec, ",")
	a, b, found := strings.Cut(spec, "-")
	if !found {
		return 0, 0, false
	}
	if a == "" {
		// suffix: last N bytes
		n, err := strconv.ParseInt(b, 10, 64)
		if err != nil || n <= 0 {
			return 0, 0, false
		}
		if n > size {
			n = size
		}
		return size - n, size - 1, true
	}
	sa, err := strconv.ParseInt(a, 10, 64)
	if err != nil || sa < 0 || sa >= size {
		return 0, 0, false
	}
	if b == "" {
		return sa, size - 1, true
	}
	sb, err := strconv.ParseInt(b, 10, 64)
	if err != nil || sb < sa {
		return 0, 0, false
	}
	if sb >= size {
		sb = size - 1
	}
	return sa, sb, true
}
