package api

import "testing"

func TestParseLRC(t *testing.T) {
	raw := `[ti:Song Title]
[ar:Some Artist]
[al:Album Name]
[offset:200]
[00:01.00]first line
[00:03.50][00:05.00]repeated line
[00:07.25]
plain unsynced line`

	meta, cues, synced := parseLRC(raw)

	if !synced {
		t.Fatal("expected synced=true")
	}
	if meta.Title != "Song Title" || meta.Artist != "Some Artist" || meta.Album != "Album Name" {
		t.Fatalf("metadata not parsed: %+v", meta)
	}
	// offset:200ms → 0.2s subtracted from every timed cue. Unsynced (-1)
	// lines sort to the top, so find the first timed cue.
	var firstTimed lyricCue
	for _, c := range cues {
		if c.Time >= 0 {
			firstTimed = c
			break
		}
	}
	if firstTimed.Time < 0.79 || firstTimed.Time > 0.81 {
		t.Fatalf("offset not applied to first timed cue: %+v", firstTimed)
	}
	if firstTimed.Text != "first line" {
		t.Fatalf("first timed cue text wrong: %q", firstTimed.Text)
	}
	// The line with two time tags yields two cues.
	repeated := 0
	for _, c := range cues {
		if c.Text == "repeated line" {
			repeated++
		}
	}
	if repeated != 2 {
		t.Fatalf("expected 2 cues for the repeated line, got %d", repeated)
	}
	// Empty timed line.
	hasEmpty := false
	for _, c := range cues {
		if c.Text == "" && c.Time > 0 {
			hasEmpty = true
		}
	}
	if !hasEmpty {
		t.Fatal("expected an empty timed cue")
	}
	// Plain (unsynced) line → time -1, preserved as a cue.
	var plain lyricCue
	for _, c := range cues {
		if c.Text == "plain unsynced line" {
			plain = c
		}
	}
	if plain.Time != -1 {
		t.Fatalf("plain line should be unsynced: %+v", plain)
	}
	// Cues sorted ascending by time.
	for i := 1; i < len(cues); i++ {
		if cues[i-1].Time > cues[i].Time {
			t.Fatalf("cues not sorted at %d: %+v", i, cues)
		}
	}
}

func TestParseLRCPlain(t *testing.T) {
	meta, cues, synced := parseLRC("just words\nmore words")
	if synced {
		t.Fatal("plain text should not be synced")
	}
	if len(cues) != 2 || cues[0].Time != -1 || cues[1].Time != -1 {
		t.Fatalf("plain cues should be unsynced: %+v", cues)
	}
	if meta.Title != "" {
		t.Fatal("no metadata expected")
	}
}
