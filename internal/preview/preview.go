// Package preview provides lightweight, dependency-free media helpers: on-demand
// checksums, image dimension probing, and lazily-generated, disk-cached
// thumbnails. Thumbnails are produced with the standard library only (no
// FFmpeg, no CGO) using a simple box downscale, keeping the image tiny and the
// runtime light on low-spec hardware.
package preview

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/jpeg"
	_ "image/gif"
	_ "image/png"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/nexora/nexora/internal/storage"
	"golang.org/x/sync/singleflight"
)

// ErrUnsupported is returned when a file cannot be thumbnailed/probed.
var ErrUnsupported = errors.New("preview: unsupported media type")

// thumbConcurrency bounds how many thumbnail/cover generations may run at
// once. Image decoding + JPEG encoding is CPU-heavy and runs synchronously in
// the request handler; a folder full of images can otherwise saturate the CPU
// when the browser opens it for the first time. Requests wait on the gate
// instead of competing for cores.
const thumbConcurrency = 4

// Service generates and caches previews.
type Service struct {
	cacheDir string
	maxSize  int64
	ttl      time.Duration

	// gate serializes thumbnail/cover generation work.
	gate chan struct{}

	// inflight deduplicates concurrent generations of the SAME cache key.
	// A media player fires 2-3 parallel <img> requests per track (mini bar,
	// blurred backdrop, artwork); without this, each one queued its own
	// full-file scan through the gate — tripling IO and latency on first
	// play, and leaving the UI staring at a blank cover box.
	inflight singleflight.Group
}

// NewService creates a preview service.
func NewService(cacheDir string, maxSize int64, ttl time.Duration) *Service {
	_ = os.MkdirAll(cacheDir, 0o755)
	return &Service{cacheDir: cacheDir, maxSize: maxSize, ttl: ttl, gate: make(chan struct{}, thumbConcurrency)}
}

// UpdateConfig hot-reloads thumbnail limits from the effective config.
func (s *Service) UpdateConfig(maxSize int64, ttl time.Duration) {
	s.maxSize = maxSize
	s.ttl = ttl
}

// Checksum computes the SHA-256 of a file via its provider reader. Only called
// on explicit request (never during listing) to avoid unnecessary IO.
func (s *Service) Checksum(provider storage.StorageProvider, rel string) (string, error) {
	rc, err := provider.Read(rel)
	if err != nil {
		return "", err
	}
	defer rc.Close()
	h := sha256.New()
	if _, err := io.Copy(h, rc); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// Dimensions returns image width/height without fully decoding pixels.
func (s *Service) Dimensions(provider storage.StorageProvider, rel string) (int, int, error) {
	if !IsThumbnailable(rel) {
		return 0, 0, ErrUnsupported
	}
	rc, err := provider.Read(rel)
	if err != nil {
		return 0, 0, err
	}
	defer rc.Close()
	cfg, _, err := image.DecodeConfig(rc)
	if err != nil {
		return 0, 0, ErrUnsupported
	}
	return cfg.Width, cfg.Height, nil
}

// IsThumbnailable reports whether a filename is a raster image we can decode.
func IsThumbnailable(name string) bool {
	switch storage.Ext(name) {
	case "jpg", "jpeg", "png", "gif":
		return true
	default:
		return false
	}
}

// Thumbnail returns a cached JPEG thumbnail for an image, generating it lazily.
// The cache key incorporates size + modtime so stale thumbnails self-invalidate.
func (s *Service) Thumbnail(provider storage.StorageProvider, rootID, rel string, maxDim int) ([]byte, error) {
	if !IsThumbnailable(rel) {
		return nil, ErrUnsupported
	}
	if maxDim <= 0 || maxDim > 1024 {
		maxDim = 256
	}
	info, err := provider.Stat(rel)
	if err != nil {
		return nil, err
	}
	if info.Size > s.maxSize {
		return nil, ErrUnsupported
	}
	key := cacheKey(rootID, rel, info.Size, info.Modified, maxDim)
	cachePath := filepath.Join(s.cacheDir, key+".jpg")

	// Single-flight: concurrent requests for the same image share ONE
	// generation instead of each queueing its own pass through the gate.
	v, err, _ := s.inflight.Do("thumb-"+key, func() (interface{}, error) {
		if data, err := os.ReadFile(cachePath); err == nil {
			return data, nil
		}

		// Cap concurrent decode+encode work so a first folder visit with dozens of
		// images doesn't saturate the CPU (each request handler blocks on this gate).
		s.gate <- struct{}{}
		defer func() { <-s.gate }()

		rc, err := provider.Read(rel)
		if err != nil {
			return nil, err
		}
		defer rc.Close()
		img, _, err := image.Decode(rc)
		if err != nil {
			return nil, ErrUnsupported
		}
		thumb := downscale(img, maxDim)

		// Encode once: serve these bytes and persist them to the cache.
		return encodeAndCache(thumb, cachePath, 80)
	})
	if err != nil {
		return nil, err
	}
	data, ok := v.([]byte)
	if !ok {
		return nil, ErrUnsupported
	}
	return data, nil
}

// encodeAndCache JPEG-encodes thumb a single time and returns the encoded
// bytes, also persisting them to cachePath via an atomic temp-file rename. A
// failed cache write is non-fatal — the caller still gets fresh bytes.
func encodeAndCache(thumb image.Image, cachePath string, quality int) ([]byte, error) {
	buf := &byteBuffer{}
	if err := jpeg.Encode(buf, thumb, &jpeg.Options{Quality: quality}); err != nil {
		return nil, err
	}
	writeCacheFile(cachePath, buf.data)
	return buf.data, nil
}

// writeCacheFile writes data to cachePath through a temp file in the same
// directory so the final rename is atomic on POSIX filesystems. All errors are
// swallowed: caching is best-effort and must never fail a request.
func writeCacheFile(cachePath string, data []byte) {
	tmp, err := os.CreateTemp(filepath.Dir(cachePath), "cache-*.jpg")
	if err != nil {
		return
	}
	_, werr := tmp.Write(data)
	cerr := tmp.Close()
	if werr != nil || cerr != nil {
		os.Remove(tmp.Name())
		return
	}
	if err := os.Rename(tmp.Name(), cachePath); err != nil {
		os.Remove(tmp.Name())
	}
}

// PurgeStale removes cached thumbnails older than the configured TTL.
func (s *Service) PurgeStale() {
	if s.ttl <= 0 {
		return
	}
	cutoff := time.Now().Add(-s.ttl)
	entries, err := os.ReadDir(s.cacheDir)
	if err != nil {
		return
	}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		if info.ModTime().Before(cutoff) {
			_ = os.Remove(filepath.Join(s.cacheDir, e.Name()))
		}
	}
}

// downscale resizes an image so its longest side is <= maxDim using an
// area-average box filter. Pure Go, no external deps.
func downscale(src image.Image, maxDim int) image.Image {
	b := src.Bounds()
	sw, sh := b.Dx(), b.Dy()
	if sw <= maxDim && sh <= maxDim {
		return src
	}
	scale := float64(maxDim) / float64(max(sw, sh))
	dw := int(float64(sw) * scale)
	dh := int(float64(sh) * scale)
	if dw < 1 {
		dw = 1
	}
	if dh < 1 {
		dh = 1
	}
	dst := image.NewRGBA(image.Rect(0, 0, dw, dh))
	// Simple, fast nearest-neighbor sampling into an averaged box.
	xRatio := float64(sw) / float64(dw)
	yRatio := float64(sh) / float64(dh)
	for y := 0; y < dh; y++ {
		sy0 := int(float64(y) * yRatio)
		sy1 := int(float64(y+1) * yRatio)
		if sy1 <= sy0 {
			sy1 = sy0 + 1
		}
		for x := 0; x < dw; x++ {
			sx0 := int(float64(x) * xRatio)
			sx1 := int(float64(x+1) * xRatio)
			if sx1 <= sx0 {
				sx1 = sx0 + 1
			}
			var rSum, gSum, bSum, aSum, n uint64
			for sy := sy0; sy < sy1; sy++ {
				for sx := sx0; sx < sx1; sx++ {
					r, g, bl, a := src.At(b.Min.X+sx, b.Min.Y+sy).RGBA()
					rSum += uint64(r >> 8)
					gSum += uint64(g >> 8)
					bSum += uint64(bl >> 8)
					aSum += uint64(a >> 8)
					n++
				}
			}
			if n == 0 {
				n = 1
			}
			dst.Set(x, y, color.RGBA{
				R: uint8(rSum / n),
				G: uint8(gSum / n),
				B: uint8(bSum / n),
				A: uint8(aSum / n),
			})
		}
	}
	// Composite onto white to flatten transparency for JPEG output.
	out := image.NewRGBA(dst.Bounds())
	draw.Draw(out, out.Bounds(), &image.Uniform{color.White}, image.Point{}, draw.Src)
	draw.Draw(out, out.Bounds(), dst, image.Point{}, draw.Over)
	return out
}

func cacheKey(rootID, rel string, size int64, mod time.Time, dim int) string {
	h := sha256.Sum256([]byte(fmt.Sprintf("%s|%s|%d|%d|%d", rootID, rel, size, mod.UnixNano(), dim)))
	return hex.EncodeToString(h[:16])
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}

// byteBuffer is a tiny io.Writer collecting bytes (avoids bytes.Buffer import churn).
type byteBuffer struct{ data []byte }

func (b *byteBuffer) Write(p []byte) (int, error) {
	b.data = append(b.data, p...)
	return len(p), nil
}

// EditableExtensions lists formats the built-in editor may open. Kept here so
// both preview and editor handlers agree on the policy.
var EditableExtensions = map[string]bool{
	"txt": true, "md": true, "markdown": true, "json": true, "yaml": true,
	"yml": true, "toml": true, "ini": true, "env": true, "conf": true,
	"js": true, "jsx": true, "ts": true, "tsx": true, "html": true, "htm": true,
	"css": true, "scss": true, "py": true, "go": true, "sh": true, "bash": true,
	"rs": true, "java": true, "c": true, "cpp": true, "h": true, "sql": true,
	"csv": true, "log": true, "xml": true, "dockerfile": true, "gitignore": true,
	"lrc": true, // synced lyrics — editable so users can author/tweak cues
}

// IsEditable reports whether a filename may be edited in the text editor.
func IsEditable(name string) bool {
	lower := strings.ToLower(name)
	if lower == "dockerfile" || strings.HasSuffix(lower, ".dockerfile") ||
		lower == "docker-compose.yml" || lower == "docker-compose.yaml" ||
		lower == ".gitignore" || lower == ".env" || lower == "makefile" {
		return true
	}
	return EditableExtensions[storage.Ext(name)]
}
