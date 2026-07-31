package api

import (
	"strings"
	"testing"
)

// TestCheckCodecSupportAllowsALAC guards the ALAC regression: .m4a files with
// Apple Lossless audio must be allowed through the transcode pipeline so the
// browser can play them via ffmpeg re-encode (ALAC -> AAC). Browsers cannot
// decode ALAC natively, so blocking it here made every ALAC .m4a unplayable.
func TestCheckCodecSupportAllowsALAC(t *testing.T) {
	probe := &ffprobeOutput{
		Streams: []ffprobeStream{
			{Index: 0, CodecType: "audio", CodecName: "alac", CodecLongName: "ALAC (Apple Lossless Audio Codec)"},
			{Index: 1, CodecType: "video", CodecName: "mjpeg", CodecLongName: "Motion JPEG"},
		},
	}
	s := &Server{}
	err := s.checkCodecSupport(probe)
	if err != nil {
		t.Fatalf("ALAC m4a must be transcodeable, got error: %v", err)
	}
}

// TestCheckCodecSupportStillRejectsTrueUnsupported keeps the existing guard
// behavior for codecs FFmpeg genuinely cannot decode.
func TestCheckCodecSupportStillRejectsTrueUnsupported(t *testing.T) {
	probe := &ffprobeOutput{
		Streams: []ffprobeStream{
			{Index: 0, CodecType: "audio", CodecName: "dts", CodecLongName: "DTS (DTS Coherent Acoustics)"},
		},
	}
	s := &Server{}
	err := s.checkCodecSupport(probe)
	if err == nil {
		t.Fatal("DTS must still be rejected by the pre-flight check")
	}
	if !strings.Contains(err.Error(), "DTS") {
		t.Fatalf("expected DTS error message, got: %v", err)
	}
}
