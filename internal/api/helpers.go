package api

import (
	"net/http"

	"github.com/nexora/nexora/internal/storage"
)

// requireFile resolves the storage access for rootID, validates the relative path,
// and stats the file. It centralises the CleanRelative → resolveAccess → Stat
// prologue that was previously copy-pasted across ~10 handlers.
// On error the caller should translate err via s.writeProviderError / writeError.
func (s *Server) requireFile(r *http.Request, rootID, rawPath string, needWrite bool) (access, string, storage.FileInfo, error) {
	rel, err := storage.CleanRelative(rawPath)
	if err != nil {
		return access{}, "", storage.FileInfo{}, err
	}
	acc, err := s.resolveAccess(r, rootID, needWrite)
	if err != nil {
		return access{}, "", storage.FileInfo{}, err
	}
	info, err := acc.provider.Stat(rel)
	if err != nil {
		return access{}, "", storage.FileInfo{}, err
	}
	return acc, rel, info, nil
}
