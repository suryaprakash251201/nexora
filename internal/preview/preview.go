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
)

// ErrUnsupported is returned when a file cannot be thumbnailed/probed.
var ErrUnsupported = errors.New("preview: unsupported media type")

// Service generates and caches previews.
type Service struct {
	cacheDir string
	maxSize  int64
	ttl      time.Duration
}

// NewService creates a preview service.
func NewService(cacheDir string, maxSize int64, ttl time.Duration) *Service {
	_ = os.MkdirAll(cacheDir, 0o755)
	return &Service{cacheDir: cacheDir, maxSize: maxSize, ttl: ttl}
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

	if data, err := os.ReadFile(cachePath); err == nil {
		return data, nil
	}

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

	tmp, err := os.CreateTemp(s.cacheDir, "thumb-*.jpg")
	if err == nil {
		_ = jpeg.Encode(tmp, thumb, &jpeg.Options{Quality: 80})
		tmp.Close()
		_ = os.Rename(tmp.Name(), cachePath)
	}
	// Return freshly encoded bytes regardless of cache write success.
	buf := &byteBuffer{}
	if err := jpeg.Encode(buf, thumb, &jpeg.Options{Quality: 80}); err != nil {
		return nil, err
	}
	return buf.data, nil
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
