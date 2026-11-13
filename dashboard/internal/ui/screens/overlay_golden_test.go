package screens

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"

	"github.com/santifer/jobber/dashboard/internal/data"
	"github.com/santifer/jobber/dashboard/internal/model"
	"github.com/santifer/jobber/dashboard/internal/theme"
)

// Golden View() output for every overlay of the pipeline screen, driven only through
// Update(tea.KeyMsg) (plus the two public/internal entry messages the app itself sends).
// The goldens were captured from the pre-refactor flag-based code, so the single-overlay
// refactor is held to byte-identical rendering. Regenerate deliberately with
// UPDATE_GOLDEN=1 go test ./internal/ui/screens -run TestOverlayGolden.

const goldenPath = "testdata/overlays.golden"

var ansiRe = regexp.MustCompile("\x1b\\[[0-9;?]*[ -/]*[@-~]|\x1b\\][^\x07\x1b]*(\x07|\x1b\\\\)")

func goldenModel() PipelineModel {
	apps := []model.CareerApplication{
		{Number: 1, Company: "Acme", Role: "Backend Engineer", Status: "Interview", Score: 4.6, Date: "2026-06-01", Notes: "remote"},
		{Number: 2, Company: "Beta", Role: "Platform Engineer", Status: "Applied", Score: 4.2, Date: "2026-06-02"},
		{Number: 3, Company: "Gamma", Role: "SRE", Status: "Evaluated", Score: 3.9, Date: "2026-06-03"},
		{Number: 4, Company: "Delta", Role: "Data Engineer", Status: "Rejected", Score: 3.1, Date: "2026-06-04", Notes: "no budget"},
		{Number: 5, Company: "Epsilon", Role: "Staff Engineer", Status: "Hired", Score: 4.8, Date: "2026-05-20"},
	}
	byStatus := map[string]int{}
	for _, a := range apps {
		byStatus[data.NormalizeStatus(a.Status)]++
	}
	return NewPipelineModel(theme.NewTheme("catppuccin-mocha"), apps, model.PipelineMetrics{Total: len(apps), ByStatus: byStatus}, "..", 120, 40)
}

func key(m PipelineModel, ks ...string) PipelineModel {
	for _, k := range ks {
		var msg tea.KeyMsg
		switch k {
		case "esc":
			msg = tea.KeyMsg{Type: tea.KeyEsc}
		case "enter":
			msg = tea.KeyMsg{Type: tea.KeyEnter}
		case "backspace":
			msg = tea.KeyMsg{Type: tea.KeyBackspace}
		case "down":
			msg = tea.KeyMsg{Type: tea.KeyDown}
		case " ":
			msg = tea.KeyMsg{Type: tea.KeySpace, Runes: []rune{' '}}
		default:
			msg = tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune(k)}
		}
		m, _ = m.Update(msg)
	}
	return m
}

func view(m PipelineModel) string { return ansiRe.ReplaceAllString(m.View(), "") }

// goldenCases builds every named screen state. Each uses a fresh model.
func goldenCases() []struct{ name, out string } {
	var out []struct{ name, out string }
	add := func(name string, m PipelineModel) { out = append(out, struct{ name, out string }{name, view(m)}) }

	base := goldenModel()
	add("base", base)

	// column picker
	m := key(base, "C")
	add("col/open", m)
	m = key(m, "j", "j", " ")
	add("col/moved+toggled", m)
	add("col/closed-esc", key(m, "esc"))
	add("col/closed-C", key(m, "C"))

	// status picker
	m = key(base, "c")
	add("status/open", m)
	add("status/moved", key(m, "j", "j"))
	add("status/closed-esc", key(m, "esc"))
	add("status/closed-q", key(m, "q"))

	// search input
	m = key(base, "/")
	add("search/open", m)
	m = key(m, "a", "c")
	add("search/typed", m)
	add("search/backspaced", key(m, "backspace"))
	add("search/committed", key(m, "enter"))
	add("search/cancelled", key(m, "esc"))

	// discard picker (entry message is what startDiscardFlow sends)
	m, _ = base.Update(pipelineStartDiscardPickerMsg{app: base.apps[1], newStatus: "Discarded", predictedReasons: []string{"salary_too_low", "custom_reason"}})
	add("discard/open", m)
	add("discard/moved", key(m, "j", "j"))
	other := key(m, "G") // not bound; stay put
	add("discard/unbound-key", other)
	for i := 0; i < 12; i++ {
		other = key(other, "j")
	}
	add("discard/at-other", other)
	custom := key(other, "enter")
	add("discard/custom-input-empty", custom)
	custom = key(custom, "x", "y")
	add("discard/custom-input-typed", custom)
	add("discard/custom-esc-back-to-list", key(custom, "esc"))

	// hired flow (public entry the app uses)
	m, _ = base.StartHiredFlow(base.apps[4])
	add("hired/step1", m)
	m = key(m, "enter")
	add("hired/step2", m)
	m = key(m, "n")
	add("hired/step3", m)
	add("hired/done", key(m, "n"))

	// flash line
	f, _ := base.Update(PipelinePDFGeneratedMsg{Err: "boom"})
	add("flash/pdf-error", f)
	return out
}

func TestOverlayGolden(t *testing.T) {
	cases := goldenCases()
	var b strings.Builder
	for _, c := range cases {
		fmt.Fprintf(&b, "=== %s ===\n%s\n", c.name, strings.ReplaceAll(c.out, "\r\n", "\n"))
	}
	got := b.String()

	if os.Getenv("UPDATE_GOLDEN") != "" {
		if err := os.MkdirAll(filepath.Dir(goldenPath), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(goldenPath, []byte(got), 0o644); err != nil {
			t.Fatal(err)
		}
		t.Logf("wrote %s (%d cases)", goldenPath, len(cases))
		return
	}
	raw, err := os.ReadFile(goldenPath)
	if err != nil {
		t.Fatalf("golden missing (%v); capture with UPDATE_GOLDEN=1", err)
	}
	want := strings.ReplaceAll(string(raw), "\r\n", "\n")
	if got == want {
		return
	}
	// Report the first differing case, not a wall of text.
	gs, ws := splitCases(got), splitCases(want)
	for _, c := range cases {
		if gs[c.name] != ws[c.name] {
			t.Errorf("overlay %q renders differently from the golden:\n--- got ---\n%s\n--- want ---\n%s", c.name, gs[c.name], ws[c.name])
			return
		}
	}
	t.Errorf("golden and output differ outside any named case (case list changed?)")
}

// Control: the golden is not vacuous -- distinct overlays render distinct screens, and the
// overlay screens differ from the base screen.
func TestOverlayGoldenCasesAreDistinct(t *testing.T) {
	cases := goldenCases()
	byName := map[string]string{}
	for _, c := range cases {
		byName[c.name] = c.out
	}
	for _, n := range []string{"col/open", "status/open", "search/open", "discard/open", "hired/step1", "pdf/open"} {
		if byName[n] == byName["base"] {
			t.Errorf("%s renders the same as the base screen -- overlay not rendered", n)
		}
	}
	seen := map[string]string{}
	for _, n := range []string{"col/open", "status/open", "search/open", "discard/open", "hired/step1", "pdf/open"} {
		if prev, dup := seen[byName[n]]; dup {
			t.Errorf("%s and %s render identically", n, prev)
		}
		seen[byName[n]] = n
	}
	if !strings.Contains(byName["hired/step1"], "CONGRATULATIONS") || !strings.Contains(byName["discard/open"], "salary_too_low") {
		t.Error("expected overlay content missing from rendered screens")
	}
	if strings.Contains(byName["base"], "ago") {
		t.Error("base screen has a relative-time string; goldens would be clock-dependent")
	}
}

func splitCases(s string) map[string]string {
	out := map[string]string{}
	parts := strings.Split(s, "=== ")
	for _, p := range parts[1:] {
		name, body, _ := strings.Cut(p, " ===\n")
		out[name] = body
	}
	return out
}
