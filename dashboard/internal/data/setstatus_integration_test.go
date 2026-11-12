package data

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

const gateTracker = `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
| 1 | 2026-06-01 | Acme | VP Marketing | 4.5/5 | Applied | ✅ | [1](reports/001.md) | hot lead |
| 2 | 2026-06-02 | Beta | Engineer | 4.0/5 | Rejected | ✅ | [2](reports/002.md) | |
`

// End to end through the REAL set-status.mjs (the script that owns the gate): the tracker is
// redirected with JOBBER_TRACKER, so the repo's own data is never touched. Skipped when node or
// the script is unavailable (the unit tests with a fake runner cover the Go side alone).
func TestSetStatusAgainstRealScript(t *testing.T) {
	if _, err := exec.LookPath("node"); err != nil {
		t.Skip("node not on PATH")
	}
	repo, err := filepath.Abs("../../..")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(repo, "set-status.mjs")); err != nil {
		t.Skip("set-status.mjs not found next to the dashboard")
	}
	tempDir, trackerPath := writeTracker(t, gateTracker)
	t.Setenv("JOBBER_TRACKER", trackerPath)
	t.Setenv("JOBBER_TRACKER_LOCK", "")
	apps := ParseApplications(tempDir)
	if len(apps) != 2 {
		t.Fatalf("fixture parsed %d rows", len(apps))
	}

	// Allowed move: row changes, ledger line appended, note joined with "; ".
	res, err := SetStatus(repo, apps[0], "Interview", "intro call booked")
	if err != nil {
		t.Fatalf("Applied -> Interview: %v", err)
	}
	if !res.Changed || res.Num != 1 || res.OldStatus != "Applied" || res.NewStatus != "Interview" {
		t.Errorf("result = %+v", res)
	}
	body, _ := os.ReadFile(trackerPath)
	if !strings.Contains(string(body), "| Interview |") || !strings.Contains(string(body), "hot lead; intro call booked") {
		t.Errorf("tracker not updated as expected:\n%s", body)
	}
	if ledger, err := os.ReadFile(filepath.Join(filepath.Dir(trackerPath), "status-log.tsv")); err != nil || !strings.Contains(string(ledger), "\tApplied\tInterview\tset-status") {
		t.Errorf("status-log.tsv missing the transition (err=%v):\n%s", err, ledger)
	}

	// Gated move: leaving a terminal state is refused with the script's own text, row untouched.
	before, _ := os.ReadFile(trackerPath)
	_, err = SetStatus(repo, apps[1], "Interview", "")
	var se *SetStatusError
	if !errors.As(err, &se) || !se.IsTerminalRefusal() || !strings.Contains(se.Message, "Rejected") {
		t.Fatalf("Rejected -> Interview should be refused as a terminal exit, got %v", err)
	}
	after, _ := os.ReadFile(trackerPath)
	if string(before) != string(after) {
		t.Error("a refused move must not touch the tracker")
	}

	// Control: a row the tracker does not have is a different failure, not a terminal refusal.
	_, err = SetStatus(repo, apps[0], "Applied", "")
	if err != nil {
		t.Errorf("moving back to Applied is a live correction and must be allowed: %v", err)
	}
	ghost := apps[0]
	ghost.Number, ghost.ReportNumber, ghost.Company = 99, "", "NoSuchCo"
	if _, err = SetStatus(repo, ghost, "Applied", ""); !errors.As(err, &se) || se.IsTerminalRefusal() || se.Code != "not-found" {
		t.Errorf("unknown row: want not-found, got %v", err)
	}
}
