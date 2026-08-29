package api

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"net/http"
	"path"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/nexora/nexora/internal/auth"
	"github.com/nexora/nexora/internal/events"
	"github.com/nexora/nexora/internal/s3gw"
	"github.com/nexora/nexora/internal/storage"
	"github.com/nexora/nexora/internal/util"
)

// ─── S3-compatible gateway ──────────────────────────────────────────────────
//
// Mounted at /s3 (see server.go). Buckets are storage roots (by name or ID);
// objects are files; credentials are personal API tokens (nxr_…) used as BOTH
// access key id and secret access key, so existing tokens work with any S3
// client:
//
//	rclone config:
//	  type = s3
//	  provider = Other
//	  endpoint = https://files.example.com/s3
//	  access_key_id = nxr_...
//	  secret_access_key = nxr_...     (same value)
//	  force_path_style = true
//
// Reads require read access to the root; writes require write access. Every
// write path shares Nexora behaviour: search index update, recent list, audit,
// and automatic version snapshots on overwrite.

const s3MpuNamespace = storage.SystemMpuDir // .nexora-mpu

// s3AccessKeyFromAuth extracts the access key (== the nxr_ token) from the
// AWS4 Authorization header.
func s3AccessKeyFromAuth(r *http.Request) string {
	hdr := r.Header.Get("Authorization")
	if !strings.HasPrefix(hdr, "AWS4-HMAC-SHA256 Credential=") {
		return ""
	}
	rest := strings.TrimPrefix(hdr, "AWS4-HMAC-SHA256 Credential=")
	// Credential=<access>/<date>/<region>/s3/aws4_request, ...
	scope, _, _ := strings.Cut(rest, ",")
	parts := strings.Split(strings.TrimSpace(scope), "/")
	if len(parts) < 1 {
		return ""
	}
	return parts[0]
}

// s3AuthMiddleware authenticates S3-style requests. The access key id IS the
// personal API token (nxr_...); the signature must verify with the same token
// as the secret. The resolved user is stamped into the context exactly like
// SessionAuth does, so resolveAccess and every other handler works unchanged.
func (s *Server) s3AuthMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		accessKey := s3AccessKeyFromAuth(r)
		if accessKey == "" || !strings.HasPrefix(accessKey, "nxr_") {
			s3gw.WriteError(w, http.StatusForbidden, s3gw.ErrCodeInvalidAccessKeyID,
				"Access key id must be a personal API token (nxr_...). Create one in Settings → Security → API tokens.")
			return
		}
		uid, ok := s.Tokens.Lookup(accessKey)
		if !ok {
			s3gw.WriteError(w, http.StatusForbidden, s3gw.ErrCodeInvalidAccessKeyID, "Unknown or expired API token")
			return
		}
		u, ok, _ := s.Users.GetByID(uid)
		if !ok || !u.IsAuthorized() {
			s3gw.WriteError(w, http.StatusForbidden, s3gw.ErrCodeAccessDenied, "User account is disabled")
			return
		}
		// Verify the SigV4 signature using the token as the HMAC secret.
		// This proves the client actually holds the token (not just a copy of
		// someone's Authorization header value).
		if _, err := s3gw.Verify(r, accessKey); err != nil {
			s3gw.WriteError(w, http.StatusForbidden, s3gw.ErrCodeSignatureDoesNotMatch,
				"Signature verification failed (check secret_access_key and system clock)")
			return
		}
		next.ServeHTTP(w, r.WithContext(auth.WithUser(r.Context(), u)))
	})
}

// s3AuthRequired rejects S3 requests without an authenticated user.
func (s *Server) s3AuthRequired(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, ok := auth.UserFromContext(r.Context()); !ok {
			s3gw.WriteError(w, http.StatusForbidden, s3gw.ErrCodeInvalidAccessKeyID, "Missing credentials")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// resolveS3Bucket maps a bucket name to a storage root, checking the user has
// read access. Accepts the root's display name (case-sensitive, then
// case-insensitive) or its ID.
func (s *Server) resolveS3Bucket(r *http.Request, bucket string, write bool) (storage.Root, storage.StorageProvider, bool) {
	user, ok := auth.UserFromContext(r.Context())
	if !ok {
		return storage.Root{}, nil, false
	}
	roots, err := s.StorageRoots.List()
	if err != nil {
		return storage.Root{}, nil, false
	}
	lookup := strings.ToLower(bucket)
	var root storage.Root
	found := false
	for _, rr := range roots {
		if rr.ID == bucket || rr.Name == bucket || strings.ToLower(rr.Name) == lookup {
			root = rr
			found = true
			break
		}
	}
	if !found || !root.Enabled {
		return storage.Root{}, nil, false
	}
	perm, allowed, _ := s.StorageRoots.UserPermission(user.ID, user.Role == "admin", root.ID)
	if !allowed {
		return storage.Root{}, nil, false
	}
	if write && (root.ReadOnly || perm != storage.PermWrite) {
		return storage.Root{}, nil, false
	}
	return root, s.StorageRoots.ProviderFor(root), true
}

// s3KeyToRel converts an S3 object key to a root-relative path.
func s3KeyToRel(key string) (string, error) {
	if key == "" {
		return "", fmt.Errorf("empty key")
	}
	rel := strings.TrimPrefix(key, "/")
	rel, err := storage.CleanRelative(rel)
	if err != nil {
		return "", err
	}
	if storage.IsSystemPath(rel) {
		return "", fmt.Errorf("reserved path")
	}
	return rel, nil
}

// ─── Buckets ───────────────────────────────────────────────────────────────

func (s *Server) handleS3ListBuckets(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.UserFromContext(r.Context())
	if !ok {
		s3gw.WriteError(w, http.StatusForbidden, s3gw.ErrCodeInvalidAccessKeyID, "Missing credentials")
		return
	}
	roots, err := s.StorageRoots.List()
	if err != nil {
		s3gw.WriteError(w, http.StatusInternalServerError, "InternalError", "could not list roots")
		return
	}
	res := s3gw.ListBucketsResult{Owner: s3gw.Owner{ID: user.ID, DisplayName: user.Username}}
	for _, rr := range roots {
		if !rr.Enabled {
			continue
		}
		_, allowed, _ := s.StorageRoots.UserPermission(user.ID, user.Role == "admin", rr.ID)
		if !allowed {
			continue
		}
		created, _ := time.Parse(time.RFC3339, rr.CreatedAt)
		if rr.CreatedAt == "" {
			created = time.Time{}
		}
		res.Buckets = append(res.Buckets, s3gw.Bucket{Name: rr.Name, CreationDate: created})
	}
	if res.Buckets == nil {
		res.Buckets = []s3gw.Bucket{}
	}
	s3gw.WriteXML(w, http.StatusOK, res)
}

// handleS3PutBucket answers CreateBucket. Nexora roots are admin-managed, so
// this is a no-op success for any root the user can write — clients like
// rclone call CreateBucket before every upload unless told not to.
func (s *Server) handleS3PutBucket(w http.ResponseWriter, r *http.Request) {
	bucket := chi.URLParam(r, "bucket")
	_, _, ok := s.resolveS3Bucket(r, bucket, true)
	if !ok {
		s3gw.WriteError(w, http.StatusNotFound, s3gw.ErrCodeNoSuchBucket, "bucket not found or no write access")
		return
	}
	w.WriteHeader(http.StatusOK)
}

// handleS3DeleteBucket answers DeleteBucket. Only allowed when the root has no
// files (S3 semantics); the root itself is never removed.
func (s *Server) handleS3DeleteBucket(w http.ResponseWriter, r *http.Request) {
	bucket := chi.URLParam(r, "bucket")
	_, prov, ok := s.resolveS3Bucket(r, bucket, true)
	if !ok {
		s3gw.WriteError(w, http.StatusNotFound, s3gw.ErrCodeNoSuchBucket, "bucket not found or no write access")
		return
	}
	entries, err := prov.List("")
	if err == nil {
		for _, e := range entries {
			if !storage.IsHiddenName(e.Name) {
				s3gw.WriteError(w, http.StatusConflict, "BucketNotEmpty", "root contains files; delete them first")
				return
			}
		}
	}
	w.WriteHeader(http.StatusNoContent)
}

// ─── Object listing ─────────────────────────────────────────────────────────

// collectS3Objects walks the provider collecting every file under `prefix`
// (root-relative). Directories become CommonPrefixes when delimiter is set.
// Keys are returned in S3 lexicographic order (filesystem order is not
// guaranteed, so we sort).
func collectS3Objects(prov storage.StorageProvider, prefix string, delimiter string) (objs []s3gw.Object, prefixes []string) {
	if delimiter == "/" {
		// Level-by-level: only one directory depth is needed.
		dir := prefix
		if i := strings.LastIndex(dir, "/"); i >= 0 {
			dir = dir[:i+1]
		} else {
			dir = ""
		}
		entries, err := prov.List(dir)
		if err != nil {
			return nil, nil
		}
		for _, e := range entries {
			if storage.IsSystemPath(e.Path) {
				continue
			}
			key := e.Path
			if e.IsDir {
				key += "/"
				if strings.HasPrefix(key, prefix) && len(key) > len(prefix) {
					prefixes = append(prefixes, key)
				}
				continue
			}
			if strings.HasPrefix(key, prefix) {
				objs = append(objs, s3ObjectFromInfo(e))
			}
		}
	} else {
		// No delimiter: full recursive walk (S3 semantics — everything under
		// the prefix, including nested folders, as flat keys).
		files, err := prov.Search(storage.SearchQuery{Path: prefixDir(prefix), Limit: 10_000})
		if err != nil {
			return nil, nil
		}
		for _, fi := range files {
			if fi.IsDir || storage.IsSystemPath(fi.Path) {
				continue
			}
			if strings.HasPrefix(fi.Path, prefix) {
				objs = append(objs, s3ObjectFromInfo(fi))
			}
		}
	}
	sort.Slice(objs, func(i, j int) bool { return objs[i].Key < objs[j].Key })
	sort.Strings(prefixes)
	return objs, prefixes
}

func prefixDir(prefix string) string {
	if i := strings.LastIndex(prefix, "/"); i >= 0 {
		return prefix[:i+1]
	}
	return ""
}

func s3ObjectFromInfo(fi storage.FileInfo) s3gw.Object {
	return s3gw.Object{
		Key:          fi.Path,
		LastModified: fi.Modified,
		ETag:         s3gw.ETagFor(fi.Size, fi.Modified),
		Size:         fi.Size,
		StorageClass: "STANDARD",
	}
}

func (s *Server) handleS3ListObjects(w http.ResponseWriter, r *http.Request) {
	bucket := chi.URLParam(r, "bucket")
	_, prov, ok := s.resolveS3Bucket(r, bucket, false)
	if !ok {
		s3gw.WriteError(w, http.StatusNotFound, s3gw.ErrCodeNoSuchBucket, "bucket not found or no access")
		return
	}
	q := r.URL.Query()
	prefix := q.Get("prefix")
	if prefix != "" {
		prefix = strings.TrimPrefix(prefix, "/")
	}
	delimiter := q.Get("delimiter")
	maxKeys := 1000
	if v := q.Get("max-keys"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			maxKeys = n
		}
	}
	// Continuation token: opaque base64 of the last key returned so far
	// (S3 marker semantics).
	marker := ""
	if ct := q.Get("continuation-token"); ct != "" {
		dec, err := decodeContinuationToken(ct)
		if err != nil {
			s3gw.WriteError(w, http.StatusBadRequest, s3gw.ErrCodeInvalidArgument, "invalid continuation-token")
			return
		}
		marker = dec
	}

	objs, prefixes := collectS3Objects(prov, prefix, delimiter)

	// Apply marker (keys strictly greater).
	if marker != "" {
		cut := sort.Search(len(objs), func(i int) bool { return objs[i].Key > marker })
		objs = objs[cut:]
		cutP := sort.Search(len(prefixes), func(i int) bool { return prefixes[i] > marker })
		prefixes = prefixes[cutP:]
	}

	res := s3gw.ListObjectsV2Result{
		Name:        bucket,
		Prefix:      q.Get("prefix"),
		Delimiter:   delimiter,
		MaxKeys:     maxKeys,
		IsTruncated: false,
	}
	// Fill contents up to maxKeys, then CommonPrefixes; truncate state.
	remaining := maxKeys
	for i := 0; i < len(objs) && remaining > 0; i++ {
		res.Contents = append(res.Contents, objs[i])
		remaining--
	}
	consumed := len(res.Contents)
	for i := 0; i < len(prefixes) && remaining > 0; i++ {
		res.CommonPrefixes = append(res.CommonPrefixes, s3gw.CommonPrefix{Prefix: prefixes[i]})
		remaining--
		consumed++
	}
	truncated := consumed < len(objs)+len(prefixes)
	res.IsTruncated = truncated
	if truncated {
		lastKey := ""
		if len(res.Contents) > 0 {
			lastKey = res.Contents[len(res.Contents)-1].Key
		} else if len(res.CommonPrefixes) > 0 {
			lastKey = res.CommonPrefixes[len(res.CommonPrefixes)-1].Prefix
		}
		res.NextContinuationToken = encodeContinuationToken(lastKey)
	}
	res.KeyCount = len(res.Contents) + len(res.CommonPrefixes)
	if res.Contents == nil {
		res.Contents = []s3gw.Object{}
	}
	if res.CommonPrefixes == nil {
		res.CommonPrefixes = []s3gw.CommonPrefix{}
	}
	s3gw.WriteXML(w, http.StatusOK, res)
}

func encodeContinuationToken(lastKey string) string {
	return base64.RawURLEncoding.EncodeToString([]byte(lastKey))
}
func decodeContinuationToken(tok string) (string, error) {
	b, err := base64.RawURLEncoding.DecodeString(tok)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// ─── Get / Head object ──────────────────────────────────────────────────────

func (s *Server) handleS3GetObject(w http.ResponseWriter, r *http.Request) {
	bucket := chi.URLParam(r, "bucket")
	key := chi.URLParam(r, "*")
	// ListParts: GET ?uploadId=...
	if uid := r.URL.Query().Get("uploadId"); uid != "" {
		s.handleS3ListParts(w, r, bucket, key, uid)
		return
	}
	root, prov, ok := s.resolveS3Bucket(r, bucket, false)
	if !ok {
		s3gw.WriteError(w, http.StatusNotFound, s3gw.ErrCodeNoSuchBucket, "bucket not found")
		return
	}
	_ = root
	rel, err := s3KeyToRel(key)
	if err != nil {
		s3gw.WriteError(w, http.StatusBadRequest, s3gw.ErrCodeInvalidArgument, "invalid key")
		return
	}
	info, err := prov.Stat(rel)
	if err != nil {
		if err == storage.ErrNotFound {
			s3gw.WriteError(w, http.StatusNotFound, s3gw.ErrCodeNoSuchKey, "no such key: "+key)
			return
		}
		s3gw.WriteError(w, http.StatusInternalServerError, "InternalError", "stat failed")
		return
	}
	if info.IsDir {
		// S3 has no directories; GET on a "folder" key is a 404.
		s3gw.WriteError(w, http.StatusNotFound, s3gw.ErrCodeNoSuchKey, "no such key: "+key)
		return
	}

	// Range support (rclone + streaming players rely on it).
	rangeHdr := r.Header.Get("Range")
	start, end := int64(0), info.Size-1
	status := http.StatusOK
	if rangeHdr != "" && info.Size > 0 {
		if fs, fe, ok := s3gw.ParseS3Range(rangeHdr, info.Size); ok {
			start, end = fs, fe
			status = http.StatusPartialContent
		}
	}
	rc, _, err := prov.OpenRange(rel, start, end)
	if err != nil {
		if err == storage.ErrNotFound {
			s3gw.WriteError(w, http.StatusNotFound, s3gw.ErrCodeNoSuchKey, "no such key: "+key)
			return
		}
		s3gw.WriteError(w, http.StatusInternalServerError, "InternalError", "read failed")
		return
	}
	defer rc.Close()

	w.Header().Set("Content-Type", contentTypeFor(info.Name))
	w.Header().Set("ETag", s3gw.ETagFor(info.Size, info.Modified))
	w.Header().Set("Last-Modified", info.Modified.UTC().Format(http.TimeFormat))
	w.Header().Set("Accept-Ranges", "bytes")
	// x-amz-meta-mtime lets rclone round-trip mtimes (Unix seconds is its
	// canonical encoding and the format it parses first).
	w.Header().Set("x-amz-meta-mtime", strconv.FormatInt(info.Modified.Unix(), 10))
	if status == http.StatusPartialContent {
		w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, end, info.Size))
	}
	w.Header().Set("Content-Length", strconv.FormatInt(end-start+1, 10))
	w.WriteHeader(status)
	_, _ = io.Copy(w, rc)
}

func (s *Server) handleS3HeadObject(w http.ResponseWriter, r *http.Request) {
	bucket := chi.URLParam(r, "bucket")
	key := chi.URLParam(r, "*")
	_, prov, ok := s.resolveS3Bucket(r, bucket, false)
	if !ok {
		s3gw.WriteError(w, http.StatusNotFound, s3gw.ErrCodeNoSuchBucket, "bucket not found")
		return
	}
	rel, err := s3KeyToRel(key)
	if err != nil {
		s3gw.WriteError(w, http.StatusBadRequest, s3gw.ErrCodeInvalidArgument, "invalid key")
		return
	}
	info, err := prov.Stat(rel)
	if err != nil || info.IsDir {
		if err == storage.ErrNotFound || info.IsDir {
			s3gw.WriteError(w, http.StatusNotFound, s3gw.ErrCodeNoSuchKey, "no such key: "+key)
			return
		}
		s3gw.WriteError(w, http.StatusInternalServerError, "InternalError", "stat failed")
		return
	}
	w.Header().Set("Content-Type", contentTypeFor(info.Name))
	w.Header().Set("ETag", s3gw.ETagFor(info.Size, info.Modified))
	w.Header().Set("Last-Modified", info.Modified.UTC().Format(http.TimeFormat))
	w.Header().Set("Content-Length", strconv.FormatInt(info.Size, 10))
	w.Header().Set("Accept-Ranges", "bytes")
	w.Header().Set("x-amz-meta-mtime", strconv.FormatInt(info.Modified.Unix(), 10))
	w.WriteHeader(http.StatusOK)
}

func contentTypeFor(name string) string {
	if ct := mime.TypeByExtension(strings.ToLower(path.Ext(name))); ct != "" {
		return ct
	}
	return "application/octet-stream"
}

// ─── Put object (upload) ────────────────────────────────────────────────────

func (s *Server) handleS3PutObject(w http.ResponseWriter, r *http.Request) {
	bucket := chi.URLParam(r, "bucket")
	key := chi.URLParam(r, "*")
	q := r.URL.Query()

	// CreateMultipartUpload: POST is used by some SDKs, but aws-cli and
	// rclone use POST /{key}?uploads — however we route POST to
	// handleS3PostObject. Chi: both PUT and POST hit their own handlers, and
	// the create-multipart call is actually POST with ?uploads, so it lands
	// in handleS3PostObject. This branch exists for clients that PUT with
	// ?uploads (rare).
	if q.Has("uploads") {
		s.handleS3CreateMultipart(w, r, bucket, key)
		return
	}
	// UploadPart: PUT ?partNumber=N&uploadId=U
	if q.Get("partNumber") != "" && q.Get("uploadId") != "" {
		s.handleS3UploadPart(w, r, bucket, key, q.Get("uploadId"), q.Get("partNumber"))
		return
	}
	// Plain PutObject.
	root, prov, ok := s.resolveS3Bucket(r, bucket, true)
	if !ok {
		s3gw.WriteError(w, http.StatusForbidden, s3gw.ErrCodeAccessDenied, "write access denied")
		return
	}
	rel, err := s3KeyToRel(key)
	if err != nil {
		s3gw.WriteError(w, http.StatusBadRequest, s3gw.ErrCodeInvalidArgument, "invalid key")
		return
	}

	// Preserve rclone's mtime if the client sent it. rclone merges multiple
	// x-amz-meta-mtime values (source metadata + the fresh mtime), so we
	// must look at ALL of them, not just the first — its canonical encoding
	// is Unix seconds ("1704198896"), which we prefer over RFC3339 forms.
	var metaMtime time.Time
	for _, v := range r.Header.Values("X-Amz-Meta-Mtime") {
		if secs, err := strconv.ParseInt(v, 10, 64); err == nil {
			metaMtime = time.Unix(secs, 0).UTC()
			break
		}
		if t, err := time.Parse(time.RFC3339Nano, v); err == nil {
			metaMtime = t
			break
		}
		if t, err := time.Parse(time.RFC3339, v); err == nil {
			metaMtime = t
			break
		}
	}

	// Auto-snapshot before overwriting an existing file (same as uploads).
	if existing, serr := prov.Stat(rel); serr == nil && !existing.IsDir {
		s.snapshotIfEnabled(r, root.ID, rel, existing.Size)
	}

	// Stream with implicit size discovery (local) or declared size (S3).
	var size int64
	if r.ContentLength > 0 {
		size = r.ContentLength
	}
	if err := prov.Write(rel, r.Body, size); err != nil {
		s3gw.WriteError(w, http.StatusInternalServerError, "InternalError", "write failed")
		return
	}
	info, err := prov.Stat(rel)
	if err != nil {
		s3gw.WriteError(w, http.StatusInternalServerError, "InternalError", "stat failed")
		return
	}

	// Apply the client-provided mtime (rclone round-trip) for local roots.
	if !metaMtime.IsZero() && root.Type == "local" {
		_ = setFileMtime(root, prov, rel, metaMtime)
		info, _ = prov.Stat(rel)
	}

	s.indexUpsert(root.ID, prov, rel)
	s.recordRecent(r, root.ID, rel, "add")
	s.audit(r, "s3_put", rel, "via S3 gateway")
	s.emit(events.EventFileCreated, r, root.ID, rel, info.Size)

	w.Header().Set("ETag", s3gw.ETagFor(info.Size, info.Modified))
	w.WriteHeader(http.StatusOK)
}

// setFileMtime applies an mtime to a local file after a write. For S3-backed
// roots there is no mtime concept; the client can fall back to Last-Modified.
func setFileMtime(root storage.Root, prov storage.StorageProvider, rel string, t time.Time) error {
	type chtimer interface {
		Chtimes(rel string, t time.Time) error
	}
	if c, ok := prov.(chtimer); ok {
		return c.Chtimes(rel, t)
	}
	return nil
}

// ─── Multipart uploads ──────────────────────────────────────────────────────

func mpuPartKey(uploadID string, partNum string) string {
	return s3MpuNamespace + "/" + uploadID + "/" + partNum
}

func (s *Server) handleS3CreateMultipart(w http.ResponseWriter, r *http.Request, bucket, key string) {
	user, ok := auth.UserFromContext(r.Context())
	if !ok {
		s3gw.WriteError(w, http.StatusForbidden, s3gw.ErrCodeInvalidAccessKeyID, "Missing credentials")
		return
	}
	root, _, ok := s.resolveS3Bucket(r, bucket, true)
	if !ok {
		s3gw.WriteError(w, http.StatusForbidden, s3gw.ErrCodeAccessDenied, "write access denied")
		return
	}
	rel, err := s3KeyToRel(key)
	if err != nil {
		s3gw.WriteError(w, http.StatusBadRequest, s3gw.ErrCodeInvalidArgument, "invalid key")
		return
	}
	uploadID := util.NewID("mpu_", 14)
	if _, err := s.DB.Exec(
		`INSERT INTO s3_uploads (id, user_id, root_id, key, etags, created_at) VALUES (?, ?, ?, ?, '{}', ?)`,
		uploadID, user.ID, root.ID, rel, time.Now().UTC().Format(time.RFC3339),
	); err != nil {
		s3gw.WriteError(w, http.StatusInternalServerError, "InternalError", "could not start multipart upload")
		return
	}
	s3gw.WriteXML(w, http.StatusOK, s3gw.InitiateMultipartUploadResult{
		Bucket: bucket, Key: key, UploadID: uploadID,
	})
}

// s3UploadRow is the DB state of a multipart upload.
type s3UploadRow struct {
	UserID string
	RootID string
	Key    string
	ETags  map[string]string
}

func (s *Server) loadS3Upload(r *http.Request, uploadID string) (*s3UploadRow, bool) {
	// Authenticated request is required; without a user we cannot enforce
	// ownership of this upload session.
	user, ok := auth.UserFromContext(r.Context())
	if !ok || user.ID == "" {
		return nil, false
	}
	var uid, rootID, key, etags string
	err := s.DB.QueryRow(`SELECT user_id, root_id, key, etags FROM s3_uploads WHERE id = ?`, uploadID).
		Scan(&uid, &rootID, &key, &etags)
	if err != nil {
		return nil, false
	}
	// IDOR defense: only the creator of the multipart upload (or an admin) may
	// complete, abort, or upload parts against it. Without this check, any
	// authenticated user who learned another user's `mpu_…` ID could write
	// arbitrary bytes into the victim's root.
	if uid != user.ID && user.Role != auth.RoleAdmin {
		return nil, false
	}
	m := map[string]string{}
	_ = json.Unmarshal([]byte(etags), &m)
	return &s3UploadRow{UserID: uid, RootID: rootID, Key: key, ETags: m}, true
}

func (s *Server) saveS3Upload(uploadID string, row *s3UploadRow) {
	b, _ := json.Marshal(row.ETags)
	_, _ = s.DB.Exec(`UPDATE s3_uploads SET etags = ? WHERE id = ?`, string(b), uploadID)
}

func (s *Server) handleS3UploadPart(w http.ResponseWriter, r *http.Request, bucket, key, uploadID, partNum string) {
	row, ok := s.loadS3Upload(r, uploadID)
	if !ok {
		s3gw.WriteError(w, http.StatusNotFound, s3gw.ErrCodeNoSuchUpload, "no such upload: "+uploadID)
		return
	}
	_, prov, ok := s.resolveS3Bucket(r, row.RootID, true)
	if !ok {
		s3gw.WriteError(w, http.StatusForbidden, s3gw.ErrCodeAccessDenied, "write access denied")
		return
	}
	pn, err := strconv.Atoi(partNum)
	if err != nil || pn < 1 || pn > 10000 {
		s3gw.WriteError(w, http.StatusBadRequest, s3gw.ErrCodeInvalidArgument, "invalid partNumber")
		return
	}

	partKey := mpuPartKey(uploadID, fmt.Sprintf("%06d", pn))
	if err := prov.Write(partKey, r.Body, r.ContentLength); err != nil {
		s3gw.WriteError(w, http.StatusInternalServerError, "InternalError", "could not store part")
		return
	}
	info, err := prov.Stat(partKey)
	if err != nil {
		s3gw.WriteError(w, http.StatusInternalServerError, "InternalError", "could not stat part")
		return
	}
	// ETag for the part (stable opaque tag; the client echoes it back on
	// Complete, which we use for a loose consistency check).
	etag := `"` + fmt.Sprintf("%x", info.Modified.UnixNano()^info.Size)[:16] + `"`
	row.ETags[strconv.Itoa(pn)] = etag
	s.saveS3Upload(uploadID, row)

	w.Header().Set("ETag", etag)
	w.WriteHeader(http.StatusOK)
}

// completeS3Upload assembles all staged parts into the final object. Parts
// must be present for every number 1..N (rclone uploads in order, then
// completes with the full part list).
func (s *Server) completeS3Upload(w http.ResponseWriter, r *http.Request, uploadID string, row *s3UploadRow, bucket, key string) {
	_, prov, ok := s.resolveS3Bucket(r, row.RootID, true)
	if !ok {
		s3gw.WriteError(w, http.StatusForbidden, s3gw.ErrCodeAccessDenied, "write access denied")
		return
	}
	// The Complete XML lists PartNumber+ETag; we honour the part numbers and
	// require them to be contiguous from 1 (S3 semantics for a valid upload).
	partNums := make([]int, 0, len(row.ETags))
	for pn := range row.ETags {
		n, _ := strconv.Atoi(pn)
		partNums = append(partNums, n)
	}
	sort.Ints(partNums)
	if len(partNums) == 0 {
		s3gw.WriteError(w, http.StatusBadRequest, s3gw.ErrCodeInvalidPartOrder, "no parts uploaded")
		return
	}
	for i, n := range partNums {
		if n != i+1 {
			s3gw.WriteError(w, http.StatusBadRequest, s3gw.ErrCodeInvalidPartOrder, "part numbers must be contiguous from 1")
			return
		}
	}

	// Auto-snapshot before overwriting an existing file.
	if existing, serr := prov.Stat(row.Key); serr == nil && !existing.IsDir {
		s.snapshotIfEnabled(r, row.RootID, row.Key, existing.Size)
	}

	// Assemble: stream all parts through a MultiReader into a staging key,
	// then atomically move onto the final key.
	readers := make([]io.Reader, 0, len(partNums))
	closers := make([]io.Closer, 0, len(partNums))
	var total int64
	for _, n := range partNums {
		rc, err := prov.Read(mpuPartKey(uploadID, fmt.Sprintf("%06d", n)))
		if err != nil {
			for _, c := range closers {
				_ = c.Close()
			}
			s3gw.WriteError(w, http.StatusBadRequest, s3gw.ErrCodeInvalidPart, fmt.Sprintf("part %d missing", n))
			return
		}
		closers = append(closers, rc)
		readers = append(readers, rc)
		fi, _ := prov.Stat(mpuPartKey(uploadID, fmt.Sprintf("%06d", n)))
		total += fi.Size
	}
	stream := io.MultiReader(readers...)

	staging := row.Key + ".s3mpu"
	if err := prov.Write(staging, stream, total); err != nil {
		for _, c := range closers {
			_ = c.Close()
		}
		_ = prov.Delete(staging)
		s3gw.WriteError(w, http.StatusInternalServerError, "InternalError", "could not assemble object")
		return
	}
	for _, c := range closers {
		_ = c.Close()
	}
	if err := prov.Move(staging, row.Key); err != nil {
		_ = prov.Delete(staging)
		s3gw.WriteError(w, http.StatusInternalServerError, "InternalError", "could not finalize object")
		return
	}

	// Clean up staged parts + row. The whole upload staging dir goes too
	// (part files are already gone; the empty parent would otherwise linger).
	for _, n := range partNums {
		_ = prov.Delete(mpuPartKey(uploadID, fmt.Sprintf("%06d", n)))
	}
	_ = prov.Delete(s3MpuNamespace + "/" + uploadID)
	_, _ = s.DB.Exec(`DELETE FROM s3_uploads WHERE id = ?`, uploadID)

	info, err := prov.Stat(row.Key)
	if err == nil {
		s.indexUpsert(row.RootID, prov, row.Key)
		s.recordRecent(r, row.RootID, row.Key, "add")
		s.audit(r, "s3_put", row.Key, "multipart via S3 gateway")
		s.emit(events.EventFileCreated, r, row.RootID, row.Key, info.Size)
	}

	s3gw.WriteXML(w, http.StatusOK, s3gw.CompleteMultipartUploadResult{
		Location: "/" + bucket + "/" + key,
		Bucket:   bucket,
		Key:      key,
		ETag:     s3gw.ETagFor(info.Size, info.Modified),
	})
}

func (s *Server) handleS3PostObject(w http.ResponseWriter, r *http.Request) {
	bucket := chi.URLParam(r, "bucket")
	key := chi.URLParam(r, "*")
	q := r.URL.Query()
	if q.Has("uploads") {
		s.handleS3CreateMultipart(w, r, bucket, key)
		return
	}
	uploadID := q.Get("uploadId")
	if uploadID == "" {
		s3gw.WriteError(w, http.StatusBadRequest, s3gw.ErrCodeInvalidRequest, "missing uploadId")
		return
	}
	row, ok := s.loadS3Upload(r, uploadID)
	if !ok {
		s3gw.WriteError(w, http.StatusNotFound, s3gw.ErrCodeNoSuchUpload, "no such upload: "+uploadID)
		return
	}
	s.completeS3Upload(w, r, uploadID, row, bucket, key)
}

func (s *Server) handleS3DeleteObject(w http.ResponseWriter, r *http.Request) {
	bucket := chi.URLParam(r, "bucket")
	key := chi.URLParam(r, "*")
	// AbortMultipartUpload: DELETE ?uploadId=
	if uid := r.URL.Query().Get("uploadId"); uid != "" {
		row, ok := s.loadS3Upload(r, uid)
		if !ok {
			s3gw.WriteError(w, http.StatusNotFound, s3gw.ErrCodeNoSuchUpload, "no such upload: "+uid)
			return
		}
		_, prov, ok := s.resolveS3Bucket(r, row.RootID, true)
		if !ok {
			s3gw.WriteError(w, http.StatusForbidden, s3gw.ErrCodeAccessDenied, "write access denied")
			return
		}
		// Remove any staged parts (we don't track the count in the row; walk
		// the known etags), then the upload staging dir itself.
		for pn := range row.ETags {
			_ = prov.Delete(mpuPartKey(uid, fmt.Sprintf("%06d", mustAtoi(pn))))
		}
		_ = prov.Delete(s3MpuNamespace + "/" + uid)
		_, _ = s.DB.Exec(`DELETE FROM s3_uploads WHERE id = ?`, uid)
		s.audit(r, "s3_mpu_abort", key, "upload="+uid)
		w.WriteHeader(http.StatusNoContent)
		return
	}

	// Plain DeleteObject. S3 delete is immediate (no trash) — tools expect it.
	root, prov, ok := s.resolveS3Bucket(r, bucket, true)
	if !ok {
		s3gw.WriteError(w, http.StatusForbidden, s3gw.ErrCodeAccessDenied, "write access denied")
		return
	}
	rel, err := s3KeyToRel(key)
	if err != nil {
		s3gw.WriteError(w, http.StatusBadRequest, s3gw.ErrCodeInvalidArgument, "invalid key")
		return
	}
	if err := prov.Delete(rel); err != nil && err != storage.ErrNotFound {
		s3gw.WriteError(w, http.StatusInternalServerError, "InternalError", "delete failed")
		return
	}
	// S3 delete is idempotent: no error even if the key didn't exist.
	s.indexRemove(root.ID, rel)
	s.audit(r, "s3_delete", rel, "via S3 gateway")
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleS3ListParts(w http.ResponseWriter, r *http.Request, bucket, key, uploadID string) {
	row, ok := s.loadS3Upload(r, uploadID)
	if !ok {
		s3gw.WriteError(w, http.StatusNotFound, s3gw.ErrCodeNoSuchUpload, "no such upload: "+uploadID)
		return
	}
	_, prov, ok := s.resolveS3Bucket(r, row.RootID, false)
	if !ok {
		s3gw.WriteError(w, http.StatusForbidden, s3gw.ErrCodeAccessDenied, "access denied")
		return
	}
	res := s3gw.ListPartsResult{Xmlns: "http://s3.amazonaws.com/doc/2006-03-01/", Bucket: bucket, Key: key, UploadID: uploadID}
	nums := make([]int, 0, len(row.ETags))
	for pn := range row.ETags {
		if n, err := strconv.Atoi(pn); err == nil {
			nums = append(nums, n)
		}
	}
	sort.Ints(nums)
	for _, n := range nums {
		fi, err := prov.Stat(mpuPartKey(uploadID, fmt.Sprintf("%06d", n)))
		if err != nil {
			continue
		}
		res.Parts = append(res.Parts, s3gw.Part{
			PartNumber:   n,
			LastModified: fi.Modified,
			ETag:         row.ETags[strconv.Itoa(n)],
			Size:         fi.Size,
		})
	}
	if res.Parts == nil {
		res.Parts = []s3gw.Part{}
	}
	s3gw.WriteXML(w, http.StatusOK, res)
}

func mustAtoi(s string) int {
	n, _ := strconv.Atoi(s)
	return n
}
