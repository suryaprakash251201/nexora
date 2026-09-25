package config

import "testing"

func TestParseRootsUnixPaths(t *testing.T) {
	got := parseRoots("Files:/mnt/files:false,Media:/mnt/media:true,Backups:/mnt/backups:false,Shared:/mnt/shared:false")
	want := []RootConfig{
		{Name: "Files", Path: "/mnt/files", ReadOnly: false, Indexed: true},
		{Name: "Media", Path: "/mnt/media", ReadOnly: true, Indexed: true},
		{Name: "Backups", Path: "/mnt/backups", ReadOnly: false, Indexed: true},
		{Name: "Shared", Path: "/mnt/shared", ReadOnly: false, Indexed: true},
	}
	if len(got) != len(want) {
		t.Fatalf("got %d roots, want %d: %+v", len(got), len(want), got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("root %d = %+v, want %+v", i, got[i], want[i])
		}
	}
}

func TestParseRootsWindowsPaths(t *testing.T) {
	got := parseRoots(`Files:C:\nexora\files:false,Media:D:/media:true:false,Backups:C:/backups`)
	want := []RootConfig{
		{Name: "Files", Path: `C:\nexora\files`, ReadOnly: false, Indexed: true},
		{Name: "Media", Path: "D:/media", ReadOnly: true, Indexed: false},
		{Name: "Backups", Path: "C:/backups", ReadOnly: false, Indexed: true},
	}
	if len(got) != len(want) {
		t.Fatalf("got %d roots, want %d: %+v", len(got), len(want), got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("root %d = %+v, want %+v", i, got[i], want[i])
		}
	}
}

func TestParseRootsOmitsInvalidEntries(t *testing.T) {
	got := parseRoots(",:nopath,:/only/path,,Files:")
	if len(got) != 0 {
		t.Fatalf("expected no roots, got %+v", got)
	}
}
