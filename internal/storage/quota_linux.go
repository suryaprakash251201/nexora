//go:build linux

package storage

import (
	"syscall"
)

func quotaFor(rootPath string) (Quota, error) {
	var st syscall.Statfs_t
	if err := syscall.Statfs(rootPath, &st); err != nil {
		return Quota{}, err
	}
	total := int64(st.Blocks) * int64(st.Bsize)
	available := int64(st.Bavail) * int64(st.Bsize)
	used := total - int64(st.Bfree)*int64(st.Bsize)
	return Quota{
		Total:     total,
		Available: available,
		Used:      used,
	}, nil
}
