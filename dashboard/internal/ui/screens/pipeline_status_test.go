package screens

import (
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"

	"github.com/santifer/jobber/dashboard/internal/data"
)

// Choosing Hired in the status picker must only REQUEST the write; the celebration starts
// later, from the confirmed outcome (main.go), never from the picker itself.
func TestStatusPickerHiredDoesNotCelebrateBeforeTheWrite(t *testing.T) {
	m := goldenModel()
	m = key(m, "c") // picker open on the Interview row (its own status leads the list)
	var hiredIdx = -1
	for i, p := range m.currentStatusPairs() {
		if data.NormalizeStatus(p.Canonical) == "hired" {
			hiredIdx = i
		}
	}
	if hiredIdx < 0 {
		t.Fatal("status picker has no Hired entry")
	}
	for i := 0; i < hiredIdx; i++ {
		m = key(m, "j")
	}
	m, cmd := m.Update(tea.KeyMsg{Type: tea.KeyEnter})
	if m.overlay != overlayNone || m.hiredStep != 0 {
		t.Fatalf("picking Hired opened an overlay before the write: overlay=%v step=%d", m.overlay, m.hiredStep)
	}
	if strings.Contains(view(m), "CONGRATULATIONS") {
		t.Fatal("celebration rendered before the write was confirmed")
	}
	if cmd == nil {
		t.Fatal("expected a command requesting the status write")
	}
	req, ok := cmd().(PipelineUpdateStatusMsg)
	if !ok || data.NormalizeStatus(req.NewStatus) != "hired" || req.App.Company != "Acme" {
		t.Fatalf("expected a PipelineUpdateStatusMsg to hired for Acme, got %#v", cmd())
	}

	// Control: StartHiredFlow (what main calls on success) does open the celebration.
	started, _ := m.StartHiredFlow(req.App)
	if started.overlay != overlayHired || !strings.Contains(view(started), "CONGRATULATIONS") {
		t.Fatal("StartHiredFlow must open the celebration overlay")
	}
}

// Esc in the discard picker still commits the status without a reason (documented behaviour).
func TestDiscardPickerEscCommitsWithoutReason(t *testing.T) {
	base := goldenModel()
	m, _ := base.Update(pipelineStartDiscardPickerMsg{app: base.apps[1], newStatus: "Discarded"})
	if m.overlay != overlayDiscard {
		t.Fatal("setup: discard picker not open")
	}
	m, cmd := m.Update(tea.KeyMsg{Type: tea.KeyEsc})
	if m.overlay != overlayNone || cmd == nil {
		t.Fatalf("Esc: overlay=%v cmd=%v", m.overlay, cmd)
	}
	if req, ok := cmd().(PipelineUpdateStatusMsg); !ok || req.NewStatus != "Discarded" {
		t.Fatalf("Esc must commit a plain status change, got %#v", cmd())
	}
}

func TestSetFlashFitsOneLine(t *testing.T) {
	m := goldenModel() // width 120
	m.SetFlash(strings.Repeat("long error text ", 40))
	if len([]rune(m.flash)) > m.width-4 || !strings.HasSuffix(m.flash, "…") {
		t.Errorf("flash not truncated to one line: %d runes", len([]rune(m.flash)))
	}
	m.SetFlash("short\nmessage")
	if m.flash != "short message" {
		t.Errorf("flash = %q, want newlines collapsed", m.flash)
	}
	if !strings.Contains(view(m), "short message") {
		t.Error("flash is not rendered in the help bar")
	}
}
