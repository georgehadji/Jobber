package main

import (
	"path/filepath"
	"testing"
)

func TestCheckOpenTargetAllowsWebURLsAndDocuments(t *testing.T) {
	dir := t.TempDir()
	allowed := []string{
		"https://example.com/jobs?id=1&next=2",
		"http://example.com/a",
		"https://jobber.org/manifesto?utm_source=dashboard-shortcut",
		filepath.Join(dir, "output", "cv-jane-acme-2026-10-01.pdf"),
		filepath.Join(dir, "reports", "001-acme-2026-10-01.md"),
		filepath.Join(dir, "output", "COVER.PDF"),
	}
	for _, target := range allowed {
		if err := checkOpenTarget(target); err != nil {
			t.Errorf("checkOpenTarget(%q) = %v, want nil", target, err)
		}
	}
}

func TestCheckOpenTargetRejectsEverythingElse(t *testing.T) {
	dir := t.TempDir()
	rejected := []string{
		"",
		"httpx://example.com/x",
		"http.exe",
		"http",
		"file:///etc/passwd",
		"javascript:alert(1)",
		"ms-msdt:/id PCWDiagnostic",
		"https://",
		"//example.com/x",
		filepath.Join(dir, "tools", "calc.exe"),
		filepath.Join(dir, "run.sh"),
		filepath.Join(dir, "shortcut.lnk"),
		filepath.Join(dir, "no-extension"),
		`C:\Windows\System32\calc.exe`,
	}
	for _, target := range rejected {
		if err := checkOpenTarget(target); err == nil {
			t.Errorf("checkOpenTarget(%q) = nil, want an error", target)
		}
	}
}

func TestOpenCheckedDoesNotReachTheOpenerForARejectedTarget(t *testing.T) {
	// A rejected target must fail before openWithDefaultApp: if it did reach it, this would try to
	// launch the file. The error text proves the guard, not the platform opener, produced the failure.
	err := openChecked(filepath.Join(t.TempDir(), "calc.exe"))
	if err == nil {
		t.Fatal("openChecked returned nil for an .exe target")
	}
	if got := err.Error(); len(got) < 8 || got[:8] != "refusing" {
		t.Fatalf("error = %q, want it to come from the guard (start with \"refusing\")", got)
	}
}
