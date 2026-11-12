package main

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"

	"github.com/santifer/jobber/dashboard/internal/data"
	"github.com/santifer/jobber/dashboard/internal/model"
	"github.com/santifer/jobber/dashboard/internal/theme"
	"github.com/santifer/jobber/dashboard/internal/ui/screens"
)

const mainTracker = `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
| 1 | 2026-06-01 | Acme | Backend Engineer | 4.5/5 | Interview | ✅ | [1](reports/001.md) | |
| 2 | 2026-06-02 | Beta | SRE | 4.0/5 | Rejected | ✅ | [2](reports/002.md) | |
`

func newTestAppModel(t *testing.T) appModel {
	t.Helper()
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "data"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "data", "applications.md"), []byte(mainTracker), 0o644); err != nil {
		t.Fatal(err)
	}
	apps := data.ParseApplications(dir)
	th := theme.NewTheme("catppuccin-mocha")
	return appModel{
		pipeline:   screens.NewPipelineModel(th, apps, data.ComputeMetrics(apps), dir, 140, 40),
		jobberPath: dir,
		theme:      th,
	}
}

// stubSetStatus swaps the write for the duration of a test and records its calls.
func stubSetStatus(t *testing.T, res data.SetStatusResult, err error) *[]string {
	t.Helper()
	var calls []string
	orig := setStatus
	setStatus = func(_ string, app model.CareerApplication, newStatus, note string) (data.SetStatusResult, error) {
		calls = append(calls, app.Company+"|"+newStatus+"|"+note)
		return res, err
	}
	t.Cleanup(func() { setStatus = orig })
	return &calls
}

// run feeds a message to the app and, when it returns a command, executes it and feeds the
// resulting message back (one round, which is the write -> outcome hop).
func run(t *testing.T, m appModel, msg tea.Msg) appModel {
	t.Helper()
	next, cmd := m.Update(msg)
	m = next.(appModel)
	if cmd != nil {
		if out := cmd(); out != nil {
			next, _ = m.Update(out)
			m = next.(appModel)
		}
	}
	return m
}

func TestHiredCelebrationOnlyAfterConfirmedWrite(t *testing.T) {
	app := model.CareerApplication{Number: 1, Company: "Acme", Role: "Backend Engineer", Status: "Interview"}
	req := screens.PipelineUpdateStatusMsg{JobberPath: "x", App: app, NewStatus: "Hired"}

	// Failure: no celebration, the reason is visible.
	stubSetStatus(t, data.SetStatusResult{}, &data.SetStatusError{Code: "not-found", Message: "No tracker row with #1"})
	m := run(t, newTestAppModel(t), req)
	v := m.View()
	if strings.Contains(v, "CONGRATULATIONS") {
		t.Fatal("celebration ran although the write failed")
	}
	if !strings.Contains(v, "Status not changed: No tracker row with #1") {
		t.Fatalf("write error not shown in the TUI:\n%s", v)
	}

	// Success that changed the row: celebration starts.
	stubSetStatus(t, data.SetStatusResult{Changed: true, NewStatus: "Hired"}, nil)
	m = run(t, newTestAppModel(t), req)
	if !strings.Contains(m.View(), "CONGRATULATIONS") {
		t.Fatalf("no celebration after a confirmed write:\n%s", m.View())
	}

	// Control: a successful no-op (already Hired) is not a new hire.
	stubSetStatus(t, data.SetStatusResult{Changed: false}, nil)
	m = run(t, newTestAppModel(t), req)
	if strings.Contains(m.View(), "CONGRATULATIONS") {
		t.Fatal("celebration ran for a write that changed nothing")
	}

	// Control: a successful write to another status never celebrates.
	stubSetStatus(t, data.SetStatusResult{Changed: true}, nil)
	m = run(t, newTestAppModel(t), screens.PipelineUpdateStatusMsg{JobberPath: "x", App: app, NewStatus: "Offer"})
	if strings.Contains(m.View(), "CONGRATULATIONS") {
		t.Fatal("celebration ran for a non-hired status")
	}
}

func TestTerminalRefusalShowsScriptTextInPipelineAndViewer(t *testing.T) {
	refusal := &data.SetStatusError{Code: "illegal-transition", Message: "Illegal status transition: Rejected → Interview. Rejected is a terminal state. Re-run with --force to override."}
	stubSetStatus(t, data.SetStatusResult{}, refusal)

	// Pipeline path (write requested from the pipeline screen).
	app := model.CareerApplication{Number: 2, Company: "Beta", Role: "SRE", Status: "Rejected"}
	m := run(t, newTestAppModel(t), screens.PipelineUpdateStatusMsg{JobberPath: "x", App: app, NewStatus: "Interview"})
	if !strings.Contains(m.View(), "Status not changed: Illegal status transition: Rejected") {
		t.Fatalf("refusal not shown on the pipeline screen:\n%s", m.View())
	}

	// A flash is a one-shot: the next keypress clears it.
	next, _ := m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("j")})
	if strings.Contains(next.(appModel).View(), "Status not changed") {
		t.Error("the error flash must clear on the next keypress")
	}

	// Viewer path: the footer shows it and the viewer does NOT pretend the status changed.
	m = newTestAppModel(t)
	m.state = viewReport
	m.viewer = screens.NewViewerModel(m.theme, m.jobberPath, filepath.Join(m.jobberPath, "missing.md"), "Beta", 140, 40, app)
	m = run(t, m, screens.ViewerUpdateStatusMsg{App: app, NewStatus: "Interview"})
	if m.state != viewReport {
		t.Fatal("a refused write must leave the viewer open")
	}
	if !strings.Contains(m.View(), "Status not changed: Illegal status transition: Rejected") {
		t.Fatalf("refusal not shown in the viewer footer:\n%s", m.View())
	}
}

func TestViewerStatusUpdatedOnlyOnSuccess(t *testing.T) {
	app := model.CareerApplication{Number: 1, Company: "Acme", Role: "Backend Engineer", Status: "Interview"}
	build := func() appModel {
		m := newTestAppModel(t)
		m.state = viewReport
		m.viewer = screens.NewViewerModel(m.theme, m.jobberPath, filepath.Join(m.jobberPath, "missing.md"), "Acme", 140, 40, app)
		return m
	}
	// Failure: the viewer keeps showing the old status in its picker order (Interview first).
	stubSetStatus(t, data.SetStatusResult{}, errors.New("boom"))
	m := run(t, build(), screens.ViewerUpdateStatusMsg{App: app, NewStatus: "Offer"})
	if !strings.Contains(m.View(), "Status not changed: boom") {
		t.Errorf("plain error not shown:\n%s", m.View())
	}
	// Success: no error text.
	stubSetStatus(t, data.SetStatusResult{Changed: true}, nil)
	m = run(t, build(), screens.ViewerUpdateStatusMsg{App: app, NewStatus: "Offer"})
	if strings.Contains(m.View(), "Status not changed") {
		t.Errorf("error text shown after a successful write:\n%s", m.View())
	}
}

func TestDiscardReasonCommitCarriesNote(t *testing.T) {
	calls := stubSetStatus(t, data.SetStatusResult{Changed: true}, nil)
	app := model.CareerApplication{Number: 1, Company: "Acme", Role: "Backend Engineer", Status: "Interview"}
	_ = run(t, newTestAppModel(t), screens.PipelineUpdateStatusAndNotesMsg{JobberPath: "x", App: app, NewStatus: "Discarded", NotesAppend: "DISCARD: salary_too_low"})
	if len(*calls) != 1 || (*calls)[0] != "Acme|Discarded|DISCARD: salary_too_low" {
		t.Errorf("calls = %v", *calls)
	}
}
