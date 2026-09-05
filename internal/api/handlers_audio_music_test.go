package api

import "testing"

func TestNormalizeMusicTags(t *testing.T) {
	tags := map[string]string{
		"ARTIST":      "Artist A; Artist B",
		"TITLE":       "Test Song",
		"ALBUM":       "Test Album",
		"ALBUMARTIST": "Various Artists",
		"GENRE":       "Rock, Pop",
		"DATE":        "2021-06-04",
		"TRACKNUMBER": "5/12",
		"DISCNUMBER":  "1",
		"COMPOSER":    "Composer X",
		"BPM":         "120",
	}
	m := normalizeMusicTags(tags)
	if m.Title != "Test Song" {
		t.Fatalf("title = %q", m.Title)
	}
	if m.Artist != "Artist A" {
		t.Fatalf("artist = %q", m.Artist)
	}
	if len(m.Artists) != 2 || m.Artists[1] != "Artist B" {
		t.Fatalf("artists = %v", m.Artists)
	}
	if m.Album != "Test Album" || m.AlbumArtist != "Various Artists" {
		t.Fatalf("album = %q album_artist = %q", m.Album, m.AlbumArtist)
	}
	if m.Genre != "Rock" || len(m.Genres) != 2 {
		t.Fatalf("genre = %q genres = %v", m.Genre, m.Genres)
	}
	if m.Year != 2021 {
		t.Fatalf("year = %d", m.Year)
	}
	if m.TrackNo != 5 || m.TrackTotal != 12 {
		t.Fatalf("track = %d/%d", m.TrackNo, m.TrackTotal)
	}
	if m.DiscNo != 1 {
		t.Fatalf("disc = %d", m.DiscNo)
	}
	if m.Composer != "Composer X" {
		t.Fatalf("composer = %q", m.Composer)
	}
	if m.BPM != 120 {
		t.Fatalf("bpm = %v", m.BPM)
	}
}

func TestNormalizeMusicTagsCaseInsensitive(t *testing.T) {
	m := normalizeMusicTags(map[string]string{"artist": "Solo", "track": "3 of 10", "year": "1999"})
	if m.Artist != "Solo" {
		t.Fatalf("artist = %q", m.Artist)
	}
	if m.TrackNo != 3 || m.TrackTotal != 10 {
		t.Fatalf("track = %d/%d", m.TrackNo, m.TrackTotal)
	}
	if m.Year != 1999 {
		t.Fatalf("year = %d", m.Year)
	}
}

func TestIsAudioFile(t *testing.T) {
	cases := map[string]bool{
		"song.m4b":  true,
		"track.oga": true,
		"tape.ape":  true,
		"pack.wv":   true,
		"album.tta": true,
		"movie.mka": true,
		"song.dsf":  true,
		"doc.pdf":   false,
		"pic.jpg":   false,
	}
	for name, want := range cases {
		if got := isAudioFile("application/octet-stream", name); got != want {
			t.Fatalf("isAudioFile(%s) = %v, want %v", name, got, want)
		}
	}
	if !isAudioFile("audio/mpeg", "song.bin") {
		t.Fatalf("audio/* MIME should be accepted")
	}
}

func TestHasCoverArt(t *testing.T) {
	probe := &audioProbe{Streams: []audioProbeStream{
		{CodecType: "audio", CodecName: "flac"},
		{CodecType: "video", CodecName: "mjpeg", Disposition: map[string]int{"attached_pic": 1}},
	}}
	if !hasCoverArt(probe) {
		t.Fatalf("expected cover art detection")
	}
	probe2 := &audioProbe{Streams: []audioProbeStream{{CodecType: "audio", CodecName: "mp3"}}}
	if hasCoverArt(probe2) {
		t.Fatalf("unexpected cover art")
	}
}

func TestBuildAudioInfo(t *testing.T) {
	probe := &audioProbe{
		Streams: []audioProbeStream{{
			CodecType: "audio", CodecName: "flac", SampleRate: "44100",
			Channels: 2, ChannelLayout: "stereo",
			Tags: map[string]string{"ARTIST": "A", "TITLE": "T", "ALBUM": "AL"},
		}},
		Format: audioProbeFormat{FormatName: "flac", Duration: "200"},
	}
	info, err := buildAudioInfo(probe, "music/song.flac")
	if err != nil {
		t.Fatal(err)
	}
	if info.Artist != "A" || info.Title != "T" || info.Album != "AL" {
		t.Fatalf("normalized = %+v", info)
	}
	if info.Container != "flac" || info.Extension != "flac" {
		t.Fatalf("container = %q", info.Container)
	}
}
