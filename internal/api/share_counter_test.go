package api

// Tests for the share download counter (Phase 2 / P1-5).
//
// The old code incremented the counter BEFORE attempting to read the file
// from storage. If the read failed (e.g. file deleted between share
// creation and access), the counter was still bumped and the user got a
// 404. Repeated failed attempts on a MaxDownloads=5 share would exhaust
// the share even though no real download ever happened.
//
// The new code wraps the response writer with countAfterFirstByte: the
// counter only increments on the first successful byte written to the
// client. This test pins the contract.

import (
	"bytes"
	"errors"
	"testing"
)

func TestCountAfterFirstByte_IncrementsOnFirstWrite(t *testing.T) {
	var calls int
	cw := &countAfterFirstByte{
		w:           &bytes.Buffer{},
		onFirstByte: func() { calls++ },
	}
	for i := 0; i < 5; i++ {
		if _, err := cw.Write([]byte("hello")); err != nil {
			t.Fatal(err)
		}
	}
	if calls != 1 {
		t.Errorf("onFirstByte called %d times, want 1", calls)
	}
}

func TestCountAfterFirstByte_DoesNotIncrementOnZeroWrite(t *testing.T) {
	var calls int
	cw := &countAfterFirstByte{
		w:           &bytes.Buffer{},
		onFirstByte: func() { calls++ },
	}
	// Zero-byte write: common when io.Copy is called on an empty source
	// or a reader that errors before producing any bytes. Must not count.
	if _, err := cw.Write(nil); err != nil {
		t.Fatal(err)
	}
	if calls != 0 {
		t.Errorf("onFirstByte called %d times for zero-byte write, want 0", calls)
	}
}

// failingWriter returns an error on every Write (simulates a disconnected
// client before any bytes reach the wire).
type failingWriter struct{}

func (failingWriter) Write(p []byte) (int, error) { return 0, errors.New("client gone") }

func TestCountAfterFirstByte_DoesNotIncrementOnImmediateError(t *testing.T) {
	var calls int
	cw := &countAfterFirstByte{
		w:           failingWriter{},
		onFirstByte: func() { calls++ },
	}
	_, err := cw.Write([]byte("hello"))
	if err == nil {
		t.Fatal("expected underlying write error to propagate")
	}
	if calls != 0 {
		t.Errorf("onFirstByte called %d times for failed write, want 0", calls)
	}
}
