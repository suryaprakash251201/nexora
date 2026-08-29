package api

import (
	"net"
	"testing"
)

func TestIsBlockedIP(t *testing.T) {
	blocked := []string{
		"127.0.0.1", "127.255.255.255",
		"10.0.0.1", "172.16.0.1", "192.168.0.1",
		"169.254.169.254", "169.254.0.1",
		"::1", "fc00::1", "fe80::1", "224.0.0.1", "0.0.0.0",
	}
	for _, s := range blocked {
		ip := net.ParseIP(s)
		if ip == nil {
			t.Fatalf("net.ParseIP(%q) returned nil", s)
		}
		if !isBlockedIP(ip) {
			t.Errorf("isBlockedIP(%s) = false, want true", s)
		}
	}

	allowed := []string{
		"8.8.8.8", "1.1.1.1", "9.9.9.9",
		"2606:4700:4700::1111",
	}
	for _, s := range allowed {
		ip := net.ParseIP(s)
		if ip == nil {
			t.Fatalf("net.ParseIP(%q) returned nil", s)
		}
		if isBlockedIP(ip) {
			t.Errorf("isBlockedIP(%s) = true, want false", s)
		}
	}
}

func TestValidateWebhookURL_LiteralIPs(t *testing.T) {
	// Literal-IP cases don't need DNS so they are deterministic across
	// CI environments.
	cases := []struct {
		name string
		url  string
		ok   bool
	}{
		// Loopback (literal)
		{"loopback v4", "http://127.0.0.1:8080/abc", false},
		{"loopback v6", "http://[::1]:8080/abc", false},
		// Private RFC1918
		{"rfc1918 10/8", "http://10.0.0.5/x", false},
		{"rfc1918 172.16/12", "http://172.16.0.1/x", false},
		{"rfc1918 192.168/16", "http://192.168.1.1/x", false},
		// Link-local (cloud metadata)
		{"metadata 169.254.169.254", "http://169.254.169.254/latest", false},
		// IPv6 unique-local
		{"ipv6 ul", "http://[fc00::1]/x", false},
		// Multicast / unspecified
		{"multicast", "http://224.0.0.1/x", false},
		{"zero", "http://0.0.0.0/x", false},
		// Bad URL
		{"empty", "", false},
		{"missing scheme", "example.com/abc", false},
		{"bad scheme", "javascript:alert(1)", false},
		{"file scheme", "file:///etc/passwd", false},
		{"public literal", "https://8.8.8.8/abc", true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := validateWebhookURL(tc.url)
			got := err == nil
			if got != tc.ok {
				t.Fatalf("validateWebhookURL(%q) ok=%v err=%v, want ok=%v", tc.url, got, err, tc.ok)
			}
		})
	}
}

func TestValidateWebhookURL_HostnameRejectsLoopback(t *testing.T) {
	// "localhost" is a well-known loopback alias and resolves to 127.0.0.1
	// on every CI image we've seen. We use it to assert the hostname
	// branch of validateWebhookURL also enforces the block.
	if err := validateWebhookURL("http://localhost:8080/x"); err == nil {
		t.Fatal("expected localhost to be rejected, got nil")
	}
}
