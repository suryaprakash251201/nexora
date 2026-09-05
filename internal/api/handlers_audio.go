package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"

	"github.com/nexora/nexora/internal/middleware"
	"github.com/nexora/nexora/internal/storage"
)

// ── Audio metadata (ffprobe) ────────────────────────────────────────────────

// flexInt unmarshals JSON numbers AND numeric strings, because ffprobe output
// is inconsistent between versions (bits_per_raw_sample comes as "16",
// bits_per_sample as 16, and "N/A" for some codecs).
type flexInt int

func (f *flexInt) UnmarshalJSON(b []byte) error {
	*f = 0
	if len(b) == 0 || string(b) == "null" {
		return nil
	}
	var n float64
	if err := json.Unmarshal(b, &n); err == nil {
		*f = flexInt(n)
		return nil
	}
	var s string
	if err := json.Unmarshal(b, &s); err == nil {
		if v, perr := strconv.ParseFloat(strings.TrimSpace(s), 64); perr == nil {
			*f = flexInt(v)
		}
	}
	return nil // tolerate "N/A" and other non-numeric markers
}

type audioProbeStream struct {
	CodecType        string            `json:"codec_type"`
	CodecName        string            `json:"codec_name"`
	CodecLongName    string            `json:"codec_long_name"`
	SampleRate       string            `json:"sample_rate"`
	BitsPerRawSample flexInt           `json:"bits_per_raw_sample"`
	BitsPerSample    flexInt           `json:"bits_per_sample"`
	Channels         int               `json:"channels"`
	ChannelLayout    string            `json:"channel_layout"`
	BitRate          string            `json:"bit_rate"`
	Duration         string            `json:"duration"`
	Disposition      map[string]int    `json:"disposition"`
	Tags             map[string]string `json:"tags"`
}

type audioProbeFormat struct {
	FormatName string            `json:"format_name"`
	Duration   string            `json:"duration"`
	BitRate    string            `json:"bit_rate"`
	Tags       map[string]string `json:"tags"`
}

type audioProbe struct {
	Streams []audioProbeStream `json:"streams"`
	Format  audioProbeFormat   `json:"format"`
}

// probeAudio runs a rich ffprobe (streams + format) on the given input.
func probeAudio(ffprobe, input string) (*audioProbe, error) {
	cmd := exec.Command(ffprobe,
		"-v", "quiet",
		"-print_format", "json",
		"-show_streams",
		"-show_format",
		input,
	)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("ffprobe failed: %w — %s", err, strings.TrimSpace(stderr.String()))
	}
	var out audioProbe
	if err := json.Unmarshal(stdout.Bytes(), &out); err != nil {
		return nil, fmt.Errorf("ffprobe JSON parse error: %w", err)
	}
	return &out, nil
}

// audioInfo is the JSON response of GET /audio/info.
//
// The low-level ffprobe fields (codec, sample_rate, …) are kept for backwards
// compatibility. The normalized music fields (title, artist, album, …) are
// what the music player song container should render: ffprobe tag keys vary
// by container (ID3 "TPE1" vs Vorbis "ARTIST" vs MP4 "©ART", plus arbitrary
// casing), so the server normalizes them once instead of every client
// re-implementing the mapping.
type audioInfo struct {
	Codec         string            `json:"codec"`
	CodecLong     string            `json:"codec_long"`
	SampleRate    int               `json:"sample_rate"`
	BitDepth      int               `json:"bit_depth"`
	Channels      int               `json:"channels"`
	ChannelLayout string            `json:"channel_layout"`
	BitRate       int64             `json:"bit_rate"`
	Duration      float64           `json:"duration"`
	Format        string            `json:"format"`
	Tags          map[string]string `json:"tags"`
	Lossless      bool              `json:"lossless"`

	// ── Normalized song container / artist extraction ──
	Container   string   `json:"container"`    // lower-case extension without dot, e.g. "flac"
	Extension   string   `json:"extension"`    // alias of Container (client convenience)
	Title       string   `json:"title"`
	Artist      string   `json:"artist"`       // display string (first artist)
	Artists     []string `json:"artists"`      // split multi-artist values
	Album       string   `json:"album"`
	AlbumArtist string   `json:"album_artist"`
	Genre       string   `json:"genre"` // display string (first genre)
	Genres      []string `json:"genres"`
	Year        int      `json:"year"` // 4-digit year, 0 when unknown
	Date        string   `json:"date"` // raw date tag as stored
	TrackNo     int      `json:"track_no"`
	TrackTotal  int      `json:"track_total"`
	DiscNo      int      `json:"disc_no"`
	DiscTotal   int      `json:"disc_total"`
	Composer    string   `json:"composer"`
	Performer   string   `json:"performer"`
	Publisher   string   `json:"publisher"`
	BPM         float64  `json:"bpm"`
	MusicalKey  string   `json:"musical_key"`
	Comment     string   `json:"comment"`
	HasCover    bool     `json:"has_cover"` // embedded picture stream present
}

var losslessCodecs = map[string]bool{
	"flac": true, "alac": true, "wav": true, "pcm_s16le": true,
	"pcm_s24le": true, "pcm_s32le": true, "aiff": true, "ape": true,
	"wavpack": true, "tta": true, "pcm_f32le": true, "pcm_f64le": true,
}

// ── Supported song containers ───────────────────────────────────────────────
// audioExtensions is the canonical set of song containers the music API
// accepts. The storage MIME sniffers only cover the common cases, so the
// audio endpoints accept by extension as well — otherwise valid tracks like
// .m4b audiobooks, .oga, .ape or .wv would be rejected as "not audio"
// depending on which provider served the Stat.
var audioExtensions = map[string]bool{
	"mp3": true, "flac": true, "wav": true, "ogg": true, "oga": true,
	"opus": true, "m4a": true, "m4b": true, "aac": true, "wma": true,
	"aiff": true, "aif": true, "alac": true, "ape": true, "wv": true,
	"tta": true, "mka": true, "mp4": true, "dsf": true, "dff": true,
}

// isAudioFile reports whether a stat result looks like a playable song
// container: audio/* MIME or a known audio extension. Extension fallback
// matters for containers the MIME tables miss (.m4b, .oga, .ape, .wv…).
func isAudioFile(mime, rel string) bool {
	if strings.HasPrefix(strings.ToLower(mime), "audio/") {
		return true
	}
	return audioExtensions[strings.ToLower(storage.Ext(rel))]
}
// resolveAudioInput validates the request and returns an ffmpeg-friendly input
// argument ("pipe:0" or a real seekable path), the open reader (which must be
// closed unless it was converted to a real path), and the file info.
func (s *Server) resolveAudioInput(r *http.Request) (string, io.ReadCloser, storage.FileInfo, error) {
	rootID := queryParam(r, "root", "")
	rel, err := storage.CleanRelative(queryParam(r, "path", ""))
	if err != nil || rel == "" {
		return "", nil, storage.FileInfo{}, errInvalidAudioPath
	}
	acc, err := s.resolveAccess(r, rootID, false)
	if err != nil {
		return "", nil, storage.FileInfo{}, err
	}
	info, err := acc.provider.Stat(rel)
	if err != nil {
		return "", nil, storage.FileInfo{}, err
	}
	if info.IsDir {
		return "", nil, storage.FileInfo{}, errIsDirectory
	}
	if !isAudioFile(info.Mime, rel) {
		return "", nil, storage.FileInfo{}, errNotAudio
	}
	rc, err := acc.provider.Read(rel)
	if err != nil {
		return "", nil, storage.FileInfo{}, err
	}
	inputArg := "pipe:0"
	if f, ok := rc.(*os.File); ok {
		inputArg = f.Name()
		rc.Close()
	}
	return inputArg, rc, info, nil
}

var (
	errInvalidAudioPath = fmt.Errorf("invalid audio path")
	errNotAudio         = fmt.Errorf("not an audio file")
	errIsDirectory      = fmt.Errorf("path is a directory")
)

func (s *Server) writeAudioInputError(w http.ResponseWriter, r *http.Request, err error) {
	rid := middleware.GetRequestID(r.Context())
	switch err {
	case errInvalidAudioPath:
		writeError(w, http.StatusBadRequest, "invalid_path", "invalid path", rid)
	case errNotAudio:
		writeError(w, http.StatusUnsupportedMediaType, "not_audio", "file is not audio", rid)
	case errIsDirectory:
		writeError(w, http.StatusBadRequest, "is_directory", "cannot read audio metadata for a directory", rid)
	default:
		s.writeProviderError(w, r, err)
	}
}

// handleAudioInfo returns rich ffprobe metadata (codec, sample rate, bit depth,
// channels, tags, duration) for the audio file at root+path, plus normalized
// music fields (title/artist/album/…) extracted from the container tags so the
// music player song container can render without its own tag-mapping table.
//
// Results are memoized per resolved input + size + modtime: the client probes
// every ambiguous .m4a/.m4b on first play, and multiple clients (or a cleared
// browser cache) would otherwise respawn ffprobe for identical files. A
// replaced file gets a new size/mtime and re-probes naturally.
var (
	audioInfoCache   sync.Map // string -> audioInfo
	audioInfoCacheN  atomic.Int64
	audioInfoCacheMax = 4096
)

// buildAudioInfo converts a raw ffprobe result into the enriched audioInfo
// response, extracting the normalized artist/container fields. rel is only
// used to derive the container extension (no I/O).
func buildAudioInfo(probe *audioProbe, rel string) (audioInfo, error) {
	var st *audioProbeStream
	for i := range probe.Streams {
		if probe.Streams[i].CodecType == "audio" {
			st = &probe.Streams[i]
			break
		}
	}
	if st == nil {
		return audioInfo{}, fmt.Errorf("no audio stream found")
	}
	tags := st.Tags
	if len(tags) == 0 {
		tags = probe.Format.Tags
	}
	if tags == nil {
		tags = map[string]string{}
	}
	info := audioInfo{
		Codec:         st.CodecName,
		CodecLong:     st.CodecLongName,
		SampleRate:    parseIntSafe(st.SampleRate),
		BitDepth:      firstPositive(int(st.BitsPerRawSample), int(st.BitsPerSample)),
		Channels:      st.Channels,
		ChannelLayout: st.ChannelLayout,
		BitRate:       parseInt64Safe(firstNonEmpty(st.BitRate, probe.Format.BitRate)),
		Duration:      parseFloatSafe(firstNonEmpty(st.Duration, probe.Format.Duration)),
		Format:        probe.Format.FormatName,
		Tags:          tags,
		Lossless:      losslessCodecs[st.CodecName],
		Container:     strings.ToLower(storage.Ext(rel)),
	}
	info.Extension = info.Container
	m := normalizeMusicTags(tags)
	info.Title = m.Title
	info.Artist = m.Artist
	info.Artists = m.Artists
	info.Album = m.Album
	info.AlbumArtist = m.AlbumArtist
	info.Genre = m.Genre
	info.Genres = m.Genres
	info.Year = m.Year
	info.Date = m.Date
	info.TrackNo = m.TrackNo
	info.TrackTotal = m.TrackTotal
	info.DiscNo = m.DiscNo
	info.DiscTotal = m.DiscTotal
	info.Composer = m.Composer
	info.Performer = m.Performer
	info.Publisher = m.Publisher
	info.BPM = m.BPM
	info.MusicalKey = m.MusicalKey
	info.Comment = m.Comment
	info.HasCover = hasCoverArt(probe)
	return info, nil
}

// audioInfoCacheStore bounds the memo map (wipe-and-restart when full).
func audioInfoCacheStore(key string, info audioInfo) {
	if audioInfoCacheN.Add(1) > int64(audioInfoCacheMax) {
		audioInfoCache.Range(func(k, _ any) bool {
			audioInfoCache.Delete(k)
			return true
		})
		audioInfoCacheN.Store(0)
	}
	audioInfoCache.Store(key, info)
}

func (s *Server) handleAudioInfo(w http.ResponseWriter, r *http.Request) {
	inputArg, rc, fi, err := s.resolveAudioInput(r)
	if err != nil {
		s.writeAudioInputError(w, r, err)
		return
	}
	defer func() {
		if rc != nil {
			rc.Close()
		}
	}()

	// Freshness-aware cache key from root|path|size|modtime (NOT inputArg:
	// non-local inputs all resolve to "pipe:0"). Unknown stat info skips
	// caching rather than serving potentially stale metadata forever.
	var cacheKey string
	cacheable := !fi.Modified.IsZero() || fi.Size != 0
	if cacheable {
		cacheKey = fmt.Sprintf("%s|%s|%d|%d",
			queryParam(r, "root", ""), queryParam(r, "path", ""), fi.Size, fi.Modified.Unix())
		if cached, ok := audioInfoCache.Load(cacheKey); ok {
			writeJSON(w, http.StatusOK, cached.(audioInfo))
			return
		}
	}

	ffp, ffprobeP, err := detectFfmpeg()
	if err != nil {
		writeError(w, http.StatusNotImplemented, "transcode_unavailable", "audio metadata requires ffmpeg on the server", middleware.GetRequestID(r.Context()))
		return
	}
	_ = ffp

	probe, err := probeAudio(ffprobeP, inputArg)
	if err != nil {
		s.Log.Warn("audio/info: ffprobe failed", "error", err)
		writeError(w, http.StatusUnprocessableEntity, "probe_failed", "could not read audio metadata", middleware.GetRequestID(r.Context()))
		return
	}

	rel := queryParam(r, "path", "")
	info, err := buildAudioInfo(probe, rel)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, "no_audio_stream", "no audio stream found", middleware.GetRequestID(r.Context()))
		return
	}
	if cacheable {
		audioInfoCacheStore(cacheKey, info)
	}
	writeJSON(w, http.StatusOK, info)
}

// ── Server capabilities ─────────────────────────────────────────────────────

// handleAudioFormats reports what the server can do for audio playback so the
// frontend can adapt (e.g. hide the lossless toggle when ffmpeg is missing).
func (s *Server) handleAudioFormats(w http.ResponseWriter, r *http.Request) {
	_, _, ffmpegErr := detectFfmpeg()
	containers := make([]string, 0, len(audioExtensions))
	for ext := range audioExtensions {
		containers = append(containers, ext)
	}
	// Deterministic order for clients that render the list.
	for i := 1; i < len(containers); i++ {
		for j := i; j > 0 && containers[j] < containers[j-1]; j-- {
			containers[j], containers[j-1] = containers[j-1], containers[j]
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ffmpeg":    ffmpegErr == nil,
		"transcode": ffmpegErr == nil,
		"formats":   []string{"aac", "flac", "flac24", "wav"},
		// Song containers the music API accepts (extension allowlist used by
		// /audio/info and /audio/info/batch when MIME sniffing is ambiguous).
		"containers": containers,
		"lossless":   []string{"flac", "alac", "wav", "aiff", "ape", "wavpack", "tta"},
	})
}

// ── Batch music metadata (song containers) ──────────────────────────────────

// audioBatchItem is one entry of POST /audio/info/batch. The music player
// song container (queue/playlist) posts the visible tracks once instead of
// firing N sequential GET /audio/info requests.
type audioBatchItem struct {
	Root string `json:"root"`
	Path string `json:"path"`
}

type audioBatchResult struct {
	Root  string     `json:"root"`
	Path  string     `json:"path"`
	OK    bool       `json:"ok"`
	Info  *audioInfo `json:"info,omitempty"`
	Error string     `json:"error,omitempty"`
}

// handleAudioInfoBatch returns enriched audioInfo for up to 50 tracks in one
// round-trip. Each item is access-checked independently; failures are reported
// per-item so one bad path never fails the whole queue. Cache and ffprobe
// behavior match GET /audio/info.
func (s *Server) handleAudioInfoBatch(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	var req struct {
		Items []audioBatchItem `json:"items"`
	}
	if err := decodeJSONLimit(r, &req, 1<<20); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", err.Error(), middleware.GetRequestID(r.Context()))
		return
	}
	if len(req.Items) == 0 {
		writeError(w, http.StatusBadRequest, "empty_batch", "items must not be empty", middleware.GetRequestID(r.Context()))
		return
	}
	if len(req.Items) > 50 {
		writeError(w, http.StatusBadRequest, "batch_too_large", "at most 50 items per batch", middleware.GetRequestID(r.Context()))
		return
	}
	_, ffprobeP, ferr := detectFfmpeg()
	if ferr != nil {
		writeError(w, http.StatusNotImplemented, "transcode_unavailable", "audio metadata requires ffmpeg on the server", middleware.GetRequestID(r.Context()))
		return
	}
	results := make([]audioBatchResult, 0, len(req.Items))
	for _, it := range req.Items {
		res := audioBatchResult{Root: it.Root, Path: it.Path}
		rel, cerr := storage.CleanRelative(it.Path)
		if cerr != nil || rel == "" {
			res.Error = "invalid path"
			results = append(results, res)
			continue
		}
		acc, aerr := s.resolveAccess(r, it.Root, false)
		if aerr != nil {
			res.Error = "access denied"
			results = append(results, res)
			continue
		}
		fi, serr := acc.provider.Stat(rel)
		if serr != nil {
			res.Error = "not found"
			results = append(results, res)
			continue
		}
		if fi.IsDir || !isAudioFile(fi.Mime, rel) {
			res.Error = "not an audio file"
			results = append(results, res)
			continue
		}
		cacheKey := ""
		cacheable := !fi.Modified.IsZero() || fi.Size != 0
		if cacheable {
			cacheKey = fmt.Sprintf("%s|%s|%d|%d", it.Root, rel, fi.Size, fi.Modified.Unix())
			if cached, ok := audioInfoCache.Load(cacheKey); ok {
				cachedInfo := cached.(audioInfo)
				res.OK = true
				res.Info = &cachedInfo
				results = append(results, res)
				continue
			}
		}
		rc, rerr := acc.provider.Read(rel)
		if rerr != nil {
			res.Error = "cannot read file"
			results = append(results, res)
			continue
		}
		inputArg := "pipe:0"
		if f, ok := rc.(*os.File); ok {
			inputArg = f.Name()
			rc.Close()
			rc = nil
		}
		probe, perr := probeAudio(ffprobeP, inputArg)
		if rc != nil {
			rc.Close()
		}
		if perr != nil {
			s.Log.Warn("audio/info/batch: ffprobe failed", "path", rel, "error", perr)
			res.Error = "could not read audio metadata"
			results = append(results, res)
			continue
		}
		info, berr := buildAudioInfo(probe, rel)
		if berr != nil {
			res.Error = "no audio stream found"
			results = append(results, res)
			continue
		}
		if cacheable {
			audioInfoCacheStore(cacheKey, info)
		}
		res.OK = true
		res.Info = &info
		results = append(results, res)
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": results, "count": len(results)})
}

// ── Normalized music-tag extraction ─────────────────────────────────────────

// musicMeta is the normalized artist/container view derived from raw ffprobe
// tags. Field mapping covers the three major tag families:
//
//   - ID3v2 (MP3): TIT2/TPE1/TALB/TCON/TYER+TDAT/TRCK/TPOS/TCOM/TPE2/TPUB/TBPM/TKEY
//     — ffprobe already translates frame IDs to names ("title", "artist", …),
//     but version drift and custom TXXX frames still surface raw.
//   - Vorbis (FLAC/OGG/Opus): TITLE/ARTIST/ALBUM/GENRE/DATE/TRACKNUMBER/…,
//     casing varies by tagger.
//   - MP4/iTunes (M4A/M4B): ©nam/©ART/©alb/©gen/trkn/disk/… — ffprobe maps
//     most to the same lowercase names, but some writers emit raw atoms.
//
// Lookup is therefore case-insensitive with per-field alias lists.
type musicMeta struct {
	Title       string
	Artist      string
	Artists     []string
	Album       string
	AlbumArtist string
	Genre       string
	Genres      []string
	Year        int
	Date        string
	TrackNo     int
	TrackTotal  int
	DiscNo      int
	DiscTotal   int
	Composer    string
	Performer   string
	Publisher   string
	BPM         float64
	MusicalKey  string
	Comment     string
}

// lowerTagMap folds tag keys to lower-case once per response.
func lowerTagMap(tags map[string]string) map[string]string {
	out := make(map[string]string, len(tags))
	for k, v := range tags {
		lk := strings.ToLower(strings.TrimSpace(k))
		if _, exists := out[lk]; !exists {
			out[lk] = v
		}
	}
	return out
}

func lookupTag(m map[string]string, keys ...string) string {
	for _, k := range keys {
		if v, ok := m[k]; ok && strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

// splitList splits multi-value tag content ("Artist1; Artist2 / Artist3").
// Separators: semicolon, slash, backslash, null, pipe. Commas are NOT split
// for artists (they break "Last, First") but ARE split for genres where
// "Rock, Pop" unambiguously means two genres.
func splitList(s string, splitComma bool) []string {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	sep := func(r rune) bool {
		switch r {
		case ';', '/', '\\', '|', '\x00':
			return true
		case ',':
			return splitComma
		}
		return false
	}
	// Also split common featuring joins into separate artists.
	normalized := s
	for _, join := range []string{" feat. ", " ft. ", " featuring ", " & ", " and ", " + ", " vs. ", " vs "} {
		normalized = strings.ReplaceAll(normalized, join, ";")
	}
	var out []string
	for _, part := range strings.FieldsFunc(normalized, sep) {
		part = strings.TrimSpace(part)
		if part != "" {
			out = append(out, part)
		}
	}
	return out
}

// parseCountField parses "5", "5/12" or "5 of 12" into (no, total).
func parseCountField(s string) (int, int) {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0, 0
	}
	// "5 of 12" form.
	if strings.Contains(strings.ToLower(s), " of ") {
		parts := strings.SplitN(strings.ToLower(s), " of ", 2)
		return parseIntSafe(strings.TrimSpace(parts[0])), parseIntSafe(strings.TrimSpace(parts[1]))
	}
	if strings.Contains(s, "/") {
		parts := strings.SplitN(s, "/", 2)
		return parseIntSafe(strings.TrimSpace(parts[0])), parseIntSafe(strings.TrimSpace(parts[1]))
	}
	return parseIntSafe(s), 0
}

// parseYear extracts a 4-digit year from free-form date tags ("2021",
// "2021-06-04", "2021/06/04", "June 2021", "© 1999").
func parseYear(date string) int {
	date = strings.TrimSpace(date)
	if date == "" {
		return 0
	}
	// Fast path: leading 4-digit year.
	if len(date) >= 4 {
		if y := parseIntSafe(date[:4]); y >= 1000 && y <= 2999 {
			return y
		}
	}
	// Scan for any embedded 4-digit year.
	for i := 0; i+4 <= len(date); i++ {
		chunk := date[i : i+4]
		isDigits := true
		for _, c := range chunk {
			if c < '0' || c > '9' {
				isDigits = false
				break
			}
		}
		if isDigits {
			if y := parseIntSafe(chunk); y >= 1000 && y <= 2999 {
				return y
			}
		}
	}
	return 0
}

// normalizeMusicTags folds raw ffprobe tags into the player-ready musicMeta.
func normalizeMusicTags(tags map[string]string) musicMeta {
	m := lowerTagMap(tags)
	var out musicMeta
	out.Title = lookupTag(m, "title", "tit2", "©nam", "song", "tracktitle")
	artistRaw := lookupTag(m, "artist", "tpe1", "©art", "artists", "album artist")
	// Some taggers only set performer.
	if artistRaw == "" {
		artistRaw = lookupTag(m, "performer", "tpe2")
	}
	out.Artists = splitList(artistRaw, false)
	if len(out.Artists) > 0 {
		out.Artist = out.Artists[0]
	} else {
		out.Artist = artistRaw
	}
	out.Album = lookupTag(m, "album", "talb", "©alb")
	out.AlbumArtist = lookupTag(m, "album_artist", "albumartist", "album artist", "ensemble", "tpe2", "©aart")
	genreRaw := lookupTag(m, "genre", "tcon", "©gen")
	out.Genres = splitList(genreRaw, true)
	if len(out.Genres) > 0 {
		out.Genre = out.Genres[0]
	} else {
		out.Genre = genreRaw
	}
	out.Date = lookupTag(m, "date", "year", "tyer", "tdat", "tdor", "originaldate", "origyear", "©day", "creation_time")
	out.Year = parseYear(out.Date)
	if out.Year == 0 {
		// Fallback: some containers only carry year inside "creation_time".
		out.Year = parseYear(lookupTag(m, "creation_time"))
	}
	trackRaw := lookupTag(m, "track", "tracknumber", "trck", "trkn", "track_number", "track total")
	out.TrackNo, out.TrackTotal = parseCountField(trackRaw)
	if out.TrackTotal == 0 {
		out.TrackTotal = parseIntSafe(lookupTag(m, "tracktotal", "track_total", "totaltracks"))
	}
	if out.TrackNo == 0 {
		out.TrackNo = parseIntSafe(lookupTag(m, "track_no"))
	}
	discRaw := lookupTag(m, "disc", "discnumber", "disc_number", "tpos", "disk")
	out.DiscNo, out.DiscTotal = parseCountField(discRaw)
	if out.DiscTotal == 0 {
		out.DiscTotal = parseIntSafe(lookupTag(m, "disctotal", "disc_total", "totaldiscs"))
	}
	out.Composer = lookupTag(m, "composer", "tcom", "©wrt", "writer")
	out.Performer = lookupTag(m, "performer", "performers")
	out.Publisher = lookupTag(m, "publisher", "label", "organization", "tpub", "©pub", "record_label")
	out.BPM = parseFloatSafe(lookupTag(m, "bpm", "tbpm", "tempo"))
	out.MusicalKey = lookupTag(m, "key", "initialkey", "initial_key", "musical_key", "tkey")
	out.Comment = lookupTag(m, "comment", "comm", "description", "©cmt")
	return out
}

// hasCoverArt reports whether ffprobe found an embedded picture stream
// (ID3 APIC / FLAC PICTURE / MP4 covr surface as an attached_pic video
// stream or mjpeg/png codec).
func hasCoverArt(probe *audioProbe) bool {
	for i := range probe.Streams {
		st := &probe.Streams[i]
		if st.Disposition != nil && st.Disposition["attached_pic"] == 1 {
			return true
		}
		// ffprobe marks attached pictures via disposition or codec.
		codec := strings.ToLower(st.CodecName)
		if codec == "mjpeg" || codec == "png" || codec == "bmp" || codec == "gif" {
			return true
		}
		for k, v := range st.Tags {
			lk := strings.ToLower(k)
			lv := strings.ToLower(v)
			if strings.Contains(lk, "attached_pic") || strings.Contains(lv, "attached_pic") ||
				strings.Contains(lk, "cover") || lk == "picture" {
				return true
			}
		}
	}
	return false
}

// ── small helpers ───────────────────────────────────────────────────────────
//
// parseIntSafe / parseInt64Safe / parseFloatSafe are intentionally
// permissive: they parse ffprobe's stdout (a trusted local subprocess)
// where a missing or non-numeric field just means "not applicable" and
// should default to 0. User-supplied query strings are NOT passed to
// these helpers — those are parsed with explicit error returns at the
// call site (e.g. handlers_preview, handlers_saved_searches).

func parseIntSafe(s string) int {
	v, _ := strconv.Atoi(s)
	return v
}

func parseInt64Safe(s string) int64 {
	v, _ := strconv.ParseInt(s, 10, 64)
	return v
}

func parseFloatSafe(s string) float64 {
	v, _ := strconv.ParseFloat(s, 64)
	return v
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}

func firstPositive(vals ...int) int {
	for _, v := range vals {
		if v > 0 {
			return v
		}
	}
	return 0
}
