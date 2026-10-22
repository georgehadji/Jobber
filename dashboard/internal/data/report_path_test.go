package data

import (
	"os"
	"path/filepath"
	"testing"
)

func TestResolveReportPathStaysInsideTheJobberRoot(t *testing.T) {
	jobber, tracker := writeTracker(t, insertedColumnTracker)
	if err := os.MkdirAll(filepath.Join(jobber, "reports"), 0o755); err != nil {
		t.Fatalf("mkdir reports: %v", err)
	}
	if err := os.WriteFile(filepath.Join(jobber, "reports", "001-a.md"), []byte("# report"), 0o644); err != nil {
		t.Fatalf("write report: %v", err)
	}

	// Control: a normal tracker-relative report link resolves to its root-relative path.
	want := filepath.Join("reports", "001-a.md")
	if got := resolveReportPath(jobber, tracker, "../reports/001-a.md"); got != want {
		t.Fatalf("resolveReportPath(valid link) = %q, want %q", got, want)
	}

	for _, link := range []string{
		"../../outside.md",
		"../../../.ssh/id_rsa",
		"../reports/../../x.md",
		"../reports/notes.txt",
		"../reports/no-extension",
	} {
		if got := resolveReportPath(jobber, tracker, link); got != "" {
			t.Errorf("resolveReportPath(%q) = %q, want \"\" (outside the root or not a markdown report)", link, got)
		}
	}
}

func TestParseApplicationsSkipsSpacedSeparatorRows(t *testing.T) {
	body := `# Applications Tracker

| # | Date | Company | Role | Location | Score | Status | PDF | Report | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 2026-06-01 | Acme | VP Marketing | Remote | 4.5/5 | Applied | ✅ | [1](reports/001.md) | hot lead |
|:---|:---:|---:|---|---|---|---|---|---|---|
`
	jobber, _ := writeTracker(t, body)
	apps := ParseApplications(jobber)
	if len(apps) != 1 {
		t.Fatalf("ParseApplications returned %d rows, want 1 (separator rows are not applications): %+v", len(apps), apps)
	}
	if apps[0].Company != "Acme" || apps[0].Number != 1 {
		t.Fatalf("unexpected row: %+v", apps[0])
	}
}

func TestSeparatorRowPattern(t *testing.T) {
	for _, line := range []string{"|---|---|", "| --- | --- |", "|:---|---:|", "| :---: | --- |"} {
		if !reSeparatorRow.MatchString(line) {
			t.Errorf("%q should be a separator row", line)
		}
	}
	for _, line := range []string{"| 1 | Acme | --- |", "| # | Date |", "| -- not a sep | x |"} {
		if reSeparatorRow.MatchString(line) {
			t.Errorf("%q should not be a separator row", line)
		}
	}
}
