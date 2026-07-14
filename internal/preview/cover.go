package preview

import (
	"bytes"
	"image"
	"image/jpeg"
	"io"
	"os"
	"path/filepath"

	"github.com/nexora/nexora/internal/storage"
)

// maxCoverFile is the largest audio file we will scan for embedded art.
// Embedded pictures live near the start of MP3/FLAC files, so this cap keeps
// memory bounded while still catching essentially all real-world tags.
const maxCoverFile = 60 << 20

// Cover returns a cached JPEG thumbnail derived from embedded album art inside
// an MP3 (ID3v2 APIC) or FLAC (PICTURE) file. It returns ErrUnsupported when
// the file has no usable embedded picture.
func (s *Service) Cover(provider storage.StorageProvider, rootID, rel string, maxDim int) ([]byte, error) {
	ext := storage.Ext(rel)
	if ext != "mp3" && ext != "flac" {
		return nil, ErrUnsupported
	}
	if maxDim <= 0 || maxDim > 1024 {
		maxDim = 256
	}
	info, err := provider.Stat(rel)
	if err != nil {
		return nil, err
	}
	if info.Size > maxCoverFile {
		return nil, ErrUnsupported
	}

	key := "cover-" + cacheKey(rootID, rel, info.Size, info.Modified, maxDim)
	cachePath := filepath.Join(s.cacheDir, key+".jpg")
	if data, err := os.ReadFile(cachePath); err == nil {
		return data, nil
	}

	rc, err := provider.Read(rel)
	if err != nil {
		return nil, err
	}
	defer rc.Close()

	raw, err := extractCover(rc, ext)
	if err != nil {
		return nil, err
	}
	img, _, err := image.Decode(bytes.NewReader(raw))
	if err != nil {
		return nil, ErrUnsupported
	}
	thumb := downscale(img, maxDim)

	if tmp, err := os.CreateTemp(s.cacheDir, "cover-*.jpg"); err == nil {
		_ = jpeg.Encode(tmp, thumb, &jpeg.Options{Quality: 82})
		tmp.Close()
		_ = os.Rename(tmp.Name(), cachePath)
	}
	buf := &byteBuffer{}
	if err := jpeg.Encode(buf, thumb, &jpeg.Options{Quality: 82}); err != nil {
		return nil, err
	}
	return buf.data, nil
}

// HasCover reports whether we should attempt cover extraction for a file.
func HasCover(name string) bool {
	switch storage.Ext(name) {
	case "mp3", "flac":
		return true
	default:
		return false
	}
}

// extractCover reads the audio bytes and returns the raw embedded image bytes.
func extractCover(r io.Reader, ext string) ([]byte, error) {
	data, err := io.ReadAll(io.LimitReader(r, maxCoverFile+1))
	if err != nil {
		return nil, err
	}
	if len(data) > maxCoverFile {
		return nil, ErrUnsupported
	}
	if ext == "mp3" {
		return extractID3Cover(data)
	}
	return extractFLACCover(data)
}

// --- MP3 / ID3v2 -----------------------------------------------------------

func extractID3Cover(data []byte) ([]byte, error) {
	if len(data) < 10 || string(data[0:3]) != "ID3" {
		return nil, ErrUnsupported
	}
	major := data[3]
	flags := data[5]
	tagSize := syncsafe(data[6:10])
	if tagSize <= 0 || 10+tagSize > len(data) {
		tagSize = len(data) - 10
		if tagSize <= 0 {
			return nil, ErrUnsupported
		}
	}
	payload := data[10 : 10+tagSize]
	// Reverse unsynchronisation across the whole payload if flagged.
	if flags&0x80 != 0 {
		payload = deunsync(payload)
	}

	switch major {
	case 2:
		return parseID3v2Frames(payload, 3, false)
	case 3, 4:
		syncSafe := major == 4
		return parseID3v2Frames(payload, 4, syncSafe)
	default:
		return nil, ErrUnsupported
	}
}

func parseID3v2Frames(p []byte, idSize int, syncSafe bool) ([]byte, error) {
	i := 0
	for i+idSize+4 <= len(p) {
		id := string(p[i : i+idSize])
		if idSize == 3 && (id[0] == 0) {
			break
		}
		i += idSize
		var size int
		if idSize == 3 {
			size = int(p[i])<<16 | int(p[i+1])<<8 | int(p[i+2])
			i += 3
		} else {
			if syncSafe {
				size = syncsafe(p[i : i+4])
			} else {
				size = int(p[i])<<24 | int(p[i+1])<<16 | int(p[i+2])<<8 | int(p[i+3])
			}
			i += 4
			if syncSafe {
				i += 2 // flags
			} else {
				i += 2
			}
		}
		if size <= 0 || i+size > len(p) {
			break
		}
		frame := p[i : i+size]
		i += size
		switch id {
		case "APIC":
			if img, ok := parseAPIC(frame); ok {
				return img, nil
			}
		case "PIC": // ID3v2.2
			if img, ok := parsePIC(frame); ok {
				return img, nil
			}
		}
	}
	return nil, ErrUnsupported
}

func parseAPIC(f []byte) ([]byte, bool) {
	if len(f) < 2 {
		return nil, false
	}
	enc := f[0]
	pos := 1
	// MIME type is null-terminated (1 byte for UTF-16 it may be 2 bytes, but
	// MIME is ASCII so a single 0x00 ends it).
	for pos < len(f) && f[pos] != 0 {
		pos++
	}
	if pos >= len(f) {
		return nil, false
	}
	pos++ // skip null
	if pos >= len(f) {
		return nil, false
	}
	pos++ // picture type byte
	// description (null-terminated, 2 bytes if UTF-16)
	pos = skipID3Text(f, pos, enc)
	if pos >= len(f) {
		return nil, false
	}
	return f[pos:], true
}

func parsePIC(f []byte) ([]byte, bool) {
	if len(f) < 2 {
		return nil, false
	}
	enc := f[0]
	pos := 1
	if pos+3 > len(f) {
		return nil, false
	}
	pos += 3 // 3-byte image format
	if pos >= len(f) {
		return nil, false
	}
	pos++ // picture type
	pos = skipID3Text(f, pos, enc)
	if pos >= len(f) {
		return nil, false
	}
	return f[pos:], true
}

// skipID3Text advances past a null-terminated ID3 text field. UTF-16 encodings
// use a 2-byte terminator.
func skipID3Text(f []byte, pos int, enc byte) int {
	switch enc {
	case 1, 2: // UTF-16 (with or without BOM)
		for pos+1 < len(f) {
			if f[pos] == 0 && f[pos+1] == 0 {
				return pos + 2
			}
			pos += 2
		}
		return len(f)
	default:
		for pos < len(f) && f[pos] != 0 {
			pos++
		}
		if pos < len(f) {
			pos++
		}
		return pos
	}
}

// --- FLAC ----------------------------------------------------------------

func extractFLACCover(data []byte) ([]byte, error) {
	if len(data) < 4 || string(data[0:4]) != "fLaC" {
		return nil, ErrUnsupported
	}
	i := 4
	for i < len(data) {
		if i+4 > len(data) {
			break
		}
		b := data[i]
		last := b&0x80 != 0
		typ := b & 0x7f
		length := int(data[i+1])<<16 | int(data[i+2])<<8 | int(data[i+3])
		i += 4
		if i+length > len(data) {
			break
		}
		block := data[i : i+length]
		i += length
		if typ == 6 { // PICTURE
			if img, ok := parseFLACPicture(block); ok {
				return img, nil
			}
		}
		if last {
			break
		}
	}
	return nil, ErrUnsupported
}

func parseFLACPicture(b []byte) ([]byte, bool) {
	if len(b) < 32 {
		return nil, false
	}
	pos := 4 // picture type
	mimeLen := int(b[pos])<<24 | int(b[pos+1])<<16 | int(b[pos+2])<<8 | int(b[pos+3])
	pos += 4
	if pos+mimeLen+4 > len(b) {
		return nil, false
	}
	pos += mimeLen // mime
	descLen := int(b[pos])<<24 | int(b[pos+1])<<16 | int(b[pos+2])<<8 | int(b[pos+3])
	pos += 4
	if pos+descLen+16 > len(b) {
		return nil, false
	}
	pos += descLen + 16 // skip description + width/height/depth/colors
	if pos+4 > len(b) {
		return nil, false
	}
	dataLen := int(b[pos])<<24 | int(b[pos+1])<<16 | int(b[pos+2])<<8 | int(b[pos+3])
	pos += 4
	if pos+dataLen > len(b) || dataLen == 0 {
		return nil, false
	}
	return b[pos : pos+dataLen], true
}

// --- helpers --------------------------------------------------------------

func syncsafe(b []byte) int {
	n := 0
	for _, c := range b {
		n = (n << 7) | int(c&0x7f)
	}
	return n
}

// deunsync reverses ID3 unsynchronisation: a 0x00 following 0xFF is discarded.
func deunsync(p []byte) []byte {
	out := make([]byte, 0, len(p))
	for i := 0; i < len(p); i++ {
		if i+1 < len(p) && p[i] == 0xFF && p[i+1] == 0x00 {
			out = append(out, 0xFF)
			i++
			continue
		}
		out = append(out, p[i])
	}
	return out
}
