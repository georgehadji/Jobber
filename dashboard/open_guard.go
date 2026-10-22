package main

import (
	"fmt"
	"net/url"
	"path/filepath"
	"strings"
)

// openAllowedExt is the set of local documents the dashboard hands to the OS: the CV and cover-letter
// PDFs and the markdown reports. Anything else (an .exe, a .sh, a .lnk, a script) is never opened.
var openAllowedExt = map[string]bool{".pdf": true, ".md": true}

// isWebURL reports whether s is an absolute http(s) URL with a host. A bare prefix test
// (strings.HasPrefix(s, "http")) also accepts "httpx://x" and "http.exe".
func isWebURL(s string) bool {
	u, err := url.Parse(strings.TrimSpace(s))
	if err != nil {
		return false
	}
	return (u.Scheme == "http" || u.Scheme == "https") && u.Host != ""
}

// checkOpenTarget is the one gate in front of ShellExecute / xdg-open / open. Job URLs come from
// scanned postings and report paths from tracker text, so both are untrusted: only a web URL or a
// .pdf / .md document may reach the OS opener.
func checkOpenTarget(target string) error {
	if isWebURL(target) {
		return nil
	}
	if target != "" {
		if abs, err := filepath.Abs(target); err == nil && openAllowedExt[strings.ToLower(filepath.Ext(abs))] {
			return nil
		}
	}
	return fmt.Errorf("refusing to open %q: only http(s) URLs and .pdf/.md documents can be opened", target)
}

// openChecked validates target, then opens it with the platform's default application.
func openChecked(target string) error {
	if err := checkOpenTarget(target); err != nil {
		return err
	}
	return openWithDefaultApp(target)
}
