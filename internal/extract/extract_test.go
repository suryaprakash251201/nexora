package extract

import (
	"bytes"
	"io"
	"strings"
	"testing"
)

// buildPDF constructs a one-page PDF whose single content stream draws the
// given ASCII text with a standard Type1 font. Xref offsets are computed so
// the file is structurally valid for strict parsers.
func buildPDF(t *testing.T, text string) []byte {
	t.Helper()
	objs := []string{
		"<< /Type /Catalog /Pages 2 0 R >>",
		"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
		"<< /Length %d >>\nstream\nBT /F1 12 Tf 72 720 Td (%s) Tj ET\nendstream",
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
	}
	var b bytes.Buffer
	b.WriteString("%PDF-1.4\n")
	offsets := make([]int, len(objs))
	for i, body := range objs {
		offsets[i] = b.Len()
		var header string
		if i == 3 {
			stream := "BT /F1 12 Tf 72 720 Td (" + text + ") Tj ET\n"
			header = "<< /Length " + itoa(len(stream)) + " >>\nstream\n" + stream + "endstream"
		} else {
			header = body
		}
		b.WriteString(itoa(i+1) + " 0 obj\n" + header + "\nendobj\n")
	}
	xrefPos := b.Len()
	b.WriteString("xref\n0 6\n0000000000 65535 f \n")
	for _, off := range offsets {
		b.WriteString(pad10(off) + " 00000 n \n")
	}
	b.WriteString("trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n" + itoa(xrefPos) + "\n%%EOF\n")
	return b.Bytes()
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var d []byte
	for n > 0 {
		d = append([]byte{byte('0' + n%10)}, d...)
		n /= 10
	}
	return string(d)
}

func pad10(n int) string {
	s := itoa(n)
	for len(s) < 10 {
		s = "0" + s
	}
	return s
}

func TestExtractPDF(t *testing.T) {
	data := buildPDF(t, "Hello Nexora PDF")
	out, err := ExtractText("pdf", bytes.NewReader(data), int64(len(data)), Config{})
	if err != nil {
		t.Fatalf("extract pdf: %v", err)
	}
	if !strings.Contains(out, "Hello Nexora PDF") {
		t.Fatalf("pdf text missing phrase: %q", out)
	}
}

func TestExtractPlainText(t *testing.T) {
	body := "line one\nline two\n\tindented\n"
	out, err := ExtractText("md", strings.NewReader(body), int64(len(body)), Config{})
	if err != nil {
		t.Fatalf("extract text: %v", err)
	}
	if !strings.Contains(out, "line two") {
		t.Fatalf("missing content: %q", out)
	}
	// Tabs become spaces; CRLF normalizes.
	out2, err := ExtractText("log", strings.NewReader("a\r\nb\r\n"), 7, Config{})
	if err != nil || out2 != "a\nb" {
		t.Fatalf("crlf normalize: %q err=%v", out2, err)
	}
}

func TestExtractRejectsBinary(t *testing.T) {
	binary := append([]byte("not text at all"), 0x00, 0x01, 0x02)
	_, err := ExtractText("txt", bytes.NewReader(binary), int64(len(binary)), Config{})
	if err != ErrNotExtractable {
		t.Fatalf("expected ErrNotExtractable, got %v", err)
	}
}

func TestExtractTooLarge(t *testing.T) {
	_, err := ExtractText("md", strings.NewReader("x"), 11<<20, Config{MaxFileSize: 10 << 20})
	if err != ErrTooLarge {
		t.Fatalf("expected ErrTooLarge, got %v", err)
	}
}

func TestExtractTruncates(t *testing.T) {
	body := strings.Repeat("héllo ", 10000) // ~60k runes
	out, err := ExtractText("txt", strings.NewReader(body), int64(len(body)), Config{MaxTextLen: 1000})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, "[truncated]") {
		t.Fatalf("expected truncation marker")
	}
	if len(out) > 2000 {
		t.Fatalf("truncation ineffective: %d bytes", len(out))
	}
}

func TestExtractOCRDisabled(t *testing.T) {
	_, err := ExtractText("png", strings.NewReader("fakeimage"), 10, Config{OCRBin: ""})
	if err != ErrNotExtractable {
		t.Fatalf("expected ErrNotExtractable without OCR, got %v", err)
	}
}

func TestExtractUnknownType(t *testing.T) {
	_, err := ExtractText("zip", strings.NewReader("x"), 1, Config{})
	if err != ErrNotExtractable {
		t.Fatalf("expected ErrNotExtractable, got %v", err)
	}
}

func TestSanitize(t *testing.T) {
	got := sanitizeText("\r\n  hello \r\n\r\n\r\n\r\nworld  \n")
	if got != "hello\n\nworld" {
		t.Fatalf("sanitize: %q", got)
	}
}

func TestNormalizeTerm(t *testing.T) {
	terms := NormalizeTerm("  Hello, WORLD! pdf ", 2)
	if len(terms) != 3 || terms[0] != "hello" || terms[1] != "world" || terms[2] != "pdf" {
		t.Fatalf("terms: %v", terms)
	}
	if got := NormalizeTerm("a b", 2); len(got) != 0 {
		t.Fatalf("short terms should be dropped: %v", got)
	}
}

var _ io.Reader = (*bytes.Reader)(nil)
