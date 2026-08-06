package api

import "testing"

// TestParseRange covers RFC 9110 byte-range parsing, including suffix ranges
// ("bytes=-N") which iOS AVPlayer and Android ExoPlayer use to read the MP4
// moov atom when it sits at the end of the file. Returning the wrong bytes
// there breaks video playback entirely.
func TestParseRange(t *testing.T) {
	const total = int64(1_000_000) // 1 MB

	cases := []struct {
		header      string
		start, end  int64
		satisfiable bool
	}{
		{"", 0, total - 1, true},                 // no range → whole file
		{"bytes=0-1", 0, 1, true},                // AVPlayer/ExoPlayer probe
		{"bytes=0-", 0, total - 1, true},         // full range
		{"bytes=100-", 100, total - 1, true},     // open-ended
		{"bytes=500000-600000", 500000, 600000, true},
		{"bytes=-500000", 500000, total - 1, true}, // suffix: last N bytes
		{"bytes=-1", total - 1, total - 1, true},   // last byte only
		{"bytes=-2000000", 0, total - 1, true},     // suffix larger than file → whole file
		{"bytes=0-999999999", 0, total - 1, true},  // end past EOF → clamped
		{"bytes=600000-100", 0, total - 1, true},   // start > end → whole file fallback
		{"bytes=2000000-3000000", 0, 0, false},     // starts past EOF → 416
	}

	for _, tc := range cases {
		start, end, ok := parseRange(tc.header, total)
		if ok != tc.satisfiable {
			t.Errorf("parseRange(%q): satisfiable = %v, want %v", tc.header, ok, tc.satisfiable)
			continue
		}
		if ok && (start != tc.start || end != tc.end) {
			t.Errorf("parseRange(%q) = %d..%d, want %d..%d", tc.header, start, end, tc.start, tc.end)
		}
	}
}
