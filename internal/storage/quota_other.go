//go:build !linux

package storage

func quotaFor(rootPath string) (Quota, error) {
	return Quota{}, nil
}
