package preview

import (
	"bytes"
	"testing"
)

// tinyJPEG is a minimal valid JPEG (1x1 black pixel) used as embedded art.
var tinyJPEG = []byte{
	0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 'J', 'F', 'I', 'F', 0x00, 0x01, 0x01, 0x00,
	0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xFF, 0xD9,
}

// box builds an MP4 box with the given type and payload.
func box(typ string, payload []byte) []byte {
	b := make([]byte, 0, 8+len(payload))
	b = append(b,
		byte((len(payload)+8)>>24), byte((len(payload)+8)>>16),
		byte((len(payload)+8)>>8), byte(len(payload)+8))
	b = append(b, typ...)
	return append(b, payload...)
}

// dataBox builds an MP4 'data' FullBox carrying raw image bytes.
func dataBox(img []byte) []byte {
	body := make([]byte, 0, 8+len(img))
	body = append(body, 0, 0, 0, 0, 0, 0, 0, 0) // version/flags + reserved
	body = append(body, img...)
	return box("data", body)
}

func TestExtractM4ACover(t *testing.T) {
	// Build: ftyp + moov/udta/meta/ilst/covr/data(<jpeg>)
	covr := box("covr", dataBox(tinyJPEG))
	ilst := box("ilst", covr)
	meta := append([]byte{0, 0, 0, 0}, ilst...) // meta is a FullBox
	udta := box("udta", box("meta", meta))
	moov := box("moov", udta)
	m4a := append(box("ftyp", []byte("M4A ")), moov...)

	got, err := extractM4ACover(m4a)
	if err != nil {
		t.Fatalf("extractM4ACover: %v", err)
	}
	if !bytes.Equal(got, tinyJPEG) {
		t.Fatalf("extracted art mismatch: got %d bytes, want %d", len(got), len(tinyJPEG))
	}
}

func TestExtractM4ACoverNoMeta(t *testing.T) {
	// A bare file with no cover must return ErrUnsupported, not panic.
	plain := box("ftyp", []byte("M4A "))
	if _, err := extractM4ACover(plain); err != ErrUnsupported {
		t.Fatalf("expected ErrUnsupported, got %v", err)
	}
}

func TestExtractM4ACoverMoovWithoutUdta(t *testing.T) {
	// Some files put meta directly under moov.
	covr := box("covr", dataBox(tinyJPEG))
	ilst := box("ilst", covr)
	meta := append([]byte{0, 0, 0, 0}, ilst...)
	moov := box("moov", box("meta", meta))
	got, err := extractM4ACover(append(box("ftyp", []byte("M4A ")), moov...))
	if err != nil {
		t.Fatalf("extractM4ACover: %v", err)
	}
	if !bytes.Equal(got, tinyJPEG) {
		t.Fatalf("extracted art mismatch")
	}
}

func TestExtractM4ACoverRawCovr(t *testing.T) {
	// Writer stored the picture directly in the covr payload.
	covr := box("covr", tinyJPEG)
	ilst := box("ilst", covr)
	meta := append([]byte{0, 0, 0, 0}, ilst...)
	moov := box("moov", box("meta", meta))
	got, err := extractM4ACover(append(box("ftyp", []byte("M4A ")), moov...))
	if err != nil {
		t.Fatalf("extractM4ACover: %v", err)
	}
	if !bytes.Equal(got, tinyJPEG) {
		t.Fatalf("extracted art mismatch")
	}
}
