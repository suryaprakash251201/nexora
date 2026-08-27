// Package extract pulls searchable text out of files: PDF text layers
// (pure Go), plain-text bodies, and — when a Tesseract binary is present —
// OCR for raster images. It is intentionally dependency-light: PDF parsing
// uses dslipak/pdf (no cgo), text files are read directly, and OCR shells
// out to tesseract rather than linking OCR SDKs into the server binary.
//
// Extraction is best-effort by design: a file that cannot be parsed yields
// an error the caller may log and skip; the search index simply won't
// contain its contents.
package extract

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/dslipak/pdf"
)

// Config controls what gets extracted and how.
type Config struct {
	// MaxFileSize skips files larger than this (default 10 MiB).
	MaxFileSize int64
	// MaxTextLen truncates stored text to this many runes (default 512 KiB).
	MaxTextLen int
	// OCRBin is the tesseract executable; "" disables OCR.
	OCRBin string
	// OCRTimeout bounds a single tesseract invocation.
	OCRTimeout time.Duration
}

// Defaults fills zero values.
func (c *Config) Defaults() {
	if c.MaxFileSize <= 0 {
		c.MaxFileSize = 10 << 20
	}
	if c.MaxTextLen <= 0 {
		c.MaxTextLen = 512 << 10
	}
	if c.OCRTimeout <= 0 {
		c.OCRTimeout = 2 * time.Minute
	}
}

// imageExts are raster formats tesseract can OCR.
var imageExts = map[string]bool{
	"jpg": true, "jpeg": true, "png": true, "webp": true,
	"bmp": true, "tif": true, "tiff": true, "pnm": true,
}

// textExts are treated as plain text. Keeping an explicit allow-list avoids
// accidentally indexing binary blobs that merely carry a text-ish extension.
var textExts = map[string]bool{
	"txt": true, "md": true, "markdown": true, "lrc": true, "csv": true,
	"log": true, "json": true, "jsonc": true, "yaml": true, "yml": true,
	"toml": true, "ini": true, "cfg": true, "conf": true, "env": true,
	"xml": true, "html": true, "htm": true, "css": true, "scss": true,
	"js": true, "mjs": true, "cjs": true, "ts": true, "mts": true, "cts": true,
	"tsx": true, "jsx": true, "go": true, "py": true, "sh": true, "bash": true,
	"zsh": true, "fish": true, "rs": true, "java": true, "c": true, "cpp": true,
	"h": true, "rb": true, "php": true, "swift": true, "kt": true, "lua": true,
	"r": true, "sql": true, "svg": true, "editorconfig": true, "lock": true,
}

// Ext is searchable via extraction? (PDF, plain text, or OCR-able image).
func Ext(ext string) bool {
	ext = strings.ToLower(strings.TrimPrefix(ext, "."))
	return ext == "pdf" || textExts[ext] || imageExts[ext]
}

// ErrTooLarge marks files skipped because of MaxFileSize.
var ErrTooLarge = errors.New("extract: file too large")

// ErrNotExtractable marks files whose type we cannot parse.
var ErrNotExtractable = errors.New("extract: not extractable")

// ExtractText reads content from r and returns normalized, searchable text.
// ext is the file extension WITHOUT the leading dot ("" for unknown).
func ExtractText(ext string, r io.Reader, size int64, cfg Config) (string, error) {
	cfg.Defaults()
	if size > cfg.MaxFileSize {
		return "", ErrTooLarge
	}
	ext = strings.ToLower(strings.TrimPrefix(ext, "."))

	switch {
	case ext == "pdf":
		return extractPDF(r)
	case textExts[ext]:
		return extractPlain(r, cfg.MaxTextLen)
	case imageExts[ext]:
		return extractOCR(r, ext, cfg)
	default:
		return "", ErrNotExtractable
	}
}

// extractPDF pulls the text layer out of a PDF. dslipak/pdf decodes content
// streams (including ToUnicode CMaps) so accented and CJK text survives.
func extractPDF(r io.Reader) (string, error) {
	// pdf.NewReader needs io.ReaderAt; buffer the (bounded) file in memory.
	data, err := io.ReadAll(io.LimitReader(r, maxPDFBytes+1))
	if err != nil {
		return "", err
	}
	if len(data) > maxPDFBytes {
		return "", ErrTooLarge
	}
	pr, err := pdf.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return "", fmt.Errorf("extract: pdf: %w", err)
	}
	var b strings.Builder
	for i := 1; i <= pr.NumPage(); i++ {
		page := pr.Page(i)
		text, err := page.GetPlainText(nil)
		if err != nil {
			continue // a page that fails to parse shouldn't kill the file
		}
		b.WriteString(text)
		b.WriteByte('\n')
	}
	return sanitizeText(b.String()), nil
}

// maxPDFBytes bounds how much of the PDF file we buffer (10 MiB).
const maxPDFBytes = 10 << 20

// extractPlain reads a text body, validating it looks like text (rejecting
// binary with NUL bytes) and truncating to MaxTextLen runes.
func extractPlain(r io.Reader, maxLen int) (string, error) {
	data, err := io.ReadAll(r)
	if err != nil {
		return "", err
	}
	if bytes.IndexByte(data, 0) >= 0 {
		// NUL bytes in the first chunk means binary, not text.
		return "", ErrNotExtractable
	}
	s := string(data)
	if !utf8.ValidString(s) {
		// Loose fix: drop invalid sequences instead of rejecting entirely
		// (legacy ISO-8859-1 files are common in home libraries).
		s = strings.ToValidUTF8(s, "\uFFFD")
	}
	return sanitizeText(truncateRunes(s, maxLen)), nil
}

// extractOCR runs tesseract on the image bytes via a temp file. Returns
// ErrNotExtractable when OCR is disabled or the binary is missing.
func extractOCR(r io.Reader, ext string, cfg Config) (string, error) {
	if cfg.OCRBin == "" {
		return "", ErrNotExtractable
	}
	if _, err := exec.LookPath(cfg.OCRBin); err != nil {
		return "", ErrNotExtractable
	}
	tmp, err := os.CreateTemp("", "nexora-ocr-*."+ext)
	if err != nil {
		return "", err
	}
	defer os.Remove(tmp.Name())
	if _, err := io.Copy(tmp, r); err != nil {
		tmp.Close()
		return "", err
	}
	if err := tmp.Close(); err != nil {
		return "", err
	}

	ctx, cancel := context.WithTimeout(context.Background(), cfg.OCRTimeout)
	defer cancel()
	out := tmp.Name() + ".out" // tesseract appends ".txt"
	cmd := exec.CommandContext(ctx, cfg.OCRBin, tmp.Name(), strings.TrimSuffix(out, ".txt"),
		"--psm", "3", "-l", "eng+osd")
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			return "", fmt.Errorf("extract: ocr: timeout")
		}
		return "", fmt.Errorf("extract: ocr: %w: %s", err, strings.TrimSpace(stderr.String()))
	}
	data, err := os.ReadFile(out)
	os.Remove(out)
	if err != nil {
		return "", err
	}
	return sanitizeText(string(data)), nil
}

// truncateRunes caps s to maxLen runes, appending an ellipsis marker so
// truncated content is distinguishable in search results.
func truncateRunes(s string, maxLen int) string {
	if utf8.RuneCountInString(s) <= maxLen {
		return s
	}
	var b strings.Builder
	for i, r := range s {
		if i >= maxLen {
			break
		}
		b.WriteRune(r)
	}
	return b.String() + "\n…[truncated]"
}

// sanitizeText normalizes extracted text for indexing: converts CRLF and
// tabs to plain whitespace, trims each line, collapses runs of blank lines,
// and trims the result. Keeps newline structure (log files benefit).
func sanitizeText(s string) string {
	s = strings.ReplaceAll(s, "\r\n", "\n")
	s = strings.ReplaceAll(s, "\r", "\n")
	s = strings.ReplaceAll(s, "\t", " ")
	lines := strings.Split(s, "\n")
	var out []string
	blank := 0
	for _, ln := range lines {
		ln = strings.TrimSpace(ln)
		if ln == "" {
			blank++
			if blank <= 1 {
				out = append(out, "")
			}
			continue
		}
		blank = 0
		out = append(out, ln)
	}
	for len(out) > 0 && out[len(out)-1] == "" {
		out = out[:len(out)-1]
	}
	return strings.TrimSpace(strings.Join(out, "\n"))
}

// NormalizeTerm splits a user query into lowercase, whitespace-delimited
// terms suitable for LIKE matching. Terms shorter than minLen are dropped
// (indexes this shallow can't meaningfully match "a" or "to").
func NormalizeTerm(raw string, minLen int) []string {
	if minLen <= 0 {
		minLen = 2
	}
	fields := strings.FieldsFunc(strings.ToLower(raw), func(r rune) bool {
		return unicode.IsSpace(r) || unicode.IsPunct(r)
	})
	out := make([]string, 0, len(fields))
	for _, f := range fields {
		if utf8.RuneCountInString(f) >= minLen {
			out = append(out, f)
		}
	}
	return out
}
