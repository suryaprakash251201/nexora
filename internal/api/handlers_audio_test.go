package api

import (
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func skipIfNoFfmpeg(t *testing.T) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg not available on this host")
	}
}

// TestComputeWaveform generates a known sine-wave WAV and checks the peak
// extraction returns sane, bounded values with the expected bucket count.
func TestComputeWaveform(t *testing.T) {
	skipIfNoFfmpeg(t)

	// Synthesize a 2-second 440Hz sine at 0.5 amplitude as a WAV file.
	wav, err := makeSineWav(2, 440, 0.5, 8000)
	if err != nil {
		t.Fatalf("makeSineWav: %v", err)
	}
	dir := t.TempDir()
	path := filepath.Join(dir, "sine.wav")
	if err := os.WriteFile(path, wav, 0o644); err != nil {
		t.Fatalf("write wav: %v", err)
	}

	peaks, duration, err := computeWaveform("ffmpeg", path, nil)
	if err != nil {
		t.Fatalf("computeWaveform: %v", err)
	}
	if len(peaks) != waveformBuckets {
		t.Fatalf("expected %d buckets, got %d", waveformBuckets, len(peaks))
	}
	if duration < 1.9 || duration > 2.1 {
		t.Fatalf("expected ~2s duration, got %v", duration)
	}
	// A 0.5-amplitude sine has peak amplitude 0.5 → peaks should be ≈0.5
	// (within a reasonable tolerance) and never exceed 1.0.
	var maxPeak float64
	for _, p := range peaks {
		if p > maxPeak {
			maxPeak = p
		}
		if p < 0 || p > 1.0 {
			t.Fatalf("peak out of range: %v", p)
		}
	}
	if maxPeak < 0.4 || maxPeak > 0.6 {
		t.Fatalf("expected ~0.5 peak, got %v", maxPeak)
	}
}

// makeSineWav synthesizes a mono 16-bit WAV file with the given duration,
// frequency, and amplitude (0..1).
func makeSineWav(seconds int, freqHz float64, amplitude float64, sampleRate int) ([]byte, error) {
	const (
		headerSize = 44
		bitsPer    = 16
	)
	numSamples := seconds * sampleRate
	dataSize := numSamples * 2
	buf := make([]byte, headerSize+dataSize)

	copy(buf[0:4], "RIFF")
	buf[4] = byte((dataSize + headerSize - 8) & 0xff)
	buf[5] = byte(((dataSize + headerSize - 8) >> 8) & 0xff)
	buf[6] = byte(((dataSize + headerSize - 8) >> 16) & 0xff)
	buf[7] = byte(((dataSize + headerSize - 8) >> 24) & 0xff)
	copy(buf[8:12], "WAVE")
	copy(buf[12:16], "fmt ")
	buf[16], buf[17], buf[18], buf[19] = 16, 0, 0, 0
	buf[20], buf[21] = 1, 0 // PCM
	buf[22], buf[23] = 1, 0 // mono
	buf[24] = byte(sampleRate & 0xff)
	buf[25] = byte((sampleRate >> 8) & 0xff)
	buf[26] = byte((sampleRate >> 16) & 0xff)
	buf[27] = byte((sampleRate >> 24) & 0xff)
	byteRate := sampleRate * bitsPer / 8
	buf[28] = byte(byteRate & 0xff)
	buf[29] = byte((byteRate >> 8) & 0xff)
	buf[30] = byte((byteRate >> 16) & 0xff)
	buf[31] = byte((byteRate >> 24) & 0xff)
	buf[32], buf[33] = byte(bitsPer/8), 0 // block align
	buf[34], buf[35] = byte(bitsPer), 0   // bits per sample
	copy(buf[36:40], "data")
	buf[40] = byte(dataSize & 0xff)
	buf[41] = byte((dataSize >> 8) & 0xff)
	buf[42] = byte((dataSize >> 16) & 0xff)
	buf[43] = byte((dataSize >> 24) & 0xff)

	off := headerSize
	for i := 0; i < numSamples; i++ {
		v := int16(amplitude * 32767 * math.Sin(2*math.Pi*freqHz*float64(i)/float64(sampleRate)))
		buf[off] = byte(v & 0xff)
		buf[off+1] = byte((v >> 8) & 0xff)
		off += 2
	}
	return buf, nil
}
