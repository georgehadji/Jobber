package screens

import (
	"strings"
	"testing"

	"github.com/charmbracelet/lipgloss"

	"github.com/santifer/jobber/dashboard/internal/data"
	"github.com/santifer/jobber/dashboard/internal/i18n"
	"github.com/santifer/jobber/dashboard/internal/model"
	"github.com/santifer/jobber/dashboard/internal/theme"
)

func TestEveryRegistryStateHasATab(t *testing.T) {
	have := map[string]string{}
	for _, tab := range getPipelineTabs() {
		have[tab.filter] = tab.label
	}
	for _, s := range data.States {
		if have[s.ID] == "" {
			t.Errorf("registry state %q has no pipeline tab (or an empty label)", s.ID)
		}
	}
	for _, f := range []string{filterAll, filterTop} {
		if _, ok := have[f]; !ok {
			t.Errorf("tab %q missing", f)
		}
	}
	if have[filterOffer] != i18n.Current.TabOffer || have[filterHired] != i18n.Current.TabHired {
		t.Errorf("offer/hired tabs carry the wrong labels: %q %q", have[filterOffer], have[filterHired])
	}
}

// A state the hand-ordered list never heard of still gets a tab (control for the guarantee).
func TestWithRegistryTabsAppendsMissingStates(t *testing.T) {
	known := []pipelineTab{{filterAll, "ALL"}, {"evaluated", "EVALUATED"}}
	got := withRegistryTabs(known, []data.State{{ID: "evaluated", Label: "Evaluated"}, {ID: "ghosting", Label: "Ghosting"}})
	if len(got) != 3 || got[2].filter != "ghosting" || got[2].label != "GHOSTING" {
		t.Errorf("tabs = %+v", got)
	}
	if again := withRegistryTabs(got, []data.State{{ID: "ghosting", Label: "Ghosting"}}); len(again) != 3 {
		t.Errorf("a state that already has a tab must not get a second one: %+v", again)
	}
}

func TestOfferAndHiredTabsFilter(t *testing.T) {
	apps := []model.CareerApplication{
		{Company: "A", Role: "r", Status: "Offer", Score: 4.5},
		{Company: "B", Role: "r", Status: "Hired", Score: 4.8},
		{Company: "C", Role: "r", Status: "Applied", Score: 4.0},
		{Company: "D", Role: "r", Status: "Contratado", Score: 3.0},
	}
	pm := NewPipelineModel(theme.NewTheme("catppuccin-mocha"), apps, model.PipelineMetrics{Total: len(apps)}, "..", 120, 40)
	for filter, want := range map[string][]string{filterOffer: {"A"}, filterHired: {"B", "D"}} {
		pm.activeTab = tabIndexForFilter(t, filter)
		pm.applyFilterAndSort()
		var got []string
		for _, a := range pm.filtered {
			got = append(got, a.Company)
		}
		if strings.Join(got, ",") != strings.Join(want, ",") && strings.Join(reverse(got), ",") != strings.Join(want, ",") {
			t.Errorf("tab %s shows %v, want %v", filter, got, want)
		}
		if n := pm.countForFilter(filter); n != len(want) {
			t.Errorf("tab %s counts %d, want %d", filter, n, len(want))
		}
	}
}

func reverse(s []string) []string {
	out := make([]string, len(s))
	for i, v := range s {
		out[len(s)-1-i] = v
	}
	return out
}

func TestVisibleTabRange(t *testing.T) {
	w := []int{10, 10, 10, 10, 10, 10}
	if lo, hi := visibleTabRange(w, 2, 60); lo != 0 || hi != 6 {
		t.Errorf("everything fits: got %d..%d", lo, hi)
	}
	// 35 columns - 2 for markers = 33: three tabs fit; the active one is always inside.
	for active := range w {
		lo, hi := visibleTabRange(w, active, 35)
		if active < lo || active >= hi || hi-lo != 3 {
			t.Errorf("active %d: window %d..%d", active, lo, hi)
		}
	}
	// control: a single tab wider than the terminal is still shown (alone), not dropped.
	if lo, hi := visibleTabRange([]int{50, 50}, 1, 20); lo != 1 || hi != 2 {
		t.Errorf("oversize tab: %d..%d", lo, hi)
	}
}

func TestTabRowNeverExceedsTheTerminalWidth(t *testing.T) {
	for _, width := range []int{60, 80, 100, 120, 160} {
		for active := range getPipelineTabs() {
			m := goldenModel()
			m.width = width
			m.activeTab = active
			m.applyFilterAndSort()
			first := strings.Split(m.renderTabs(), "\n")[0]
			if w := lipgloss.Width(first); w > width {
				t.Errorf("width %d active %d: tab row is %d columns wide", width, active, w)
			}
			if !strings.Contains(first, getPipelineTabs()[active].label) {
				t.Errorf("width %d: active tab %q not visible in %q", width, getPipelineTabs()[active].label, first)
			}
		}
	}
	// control: a wide terminal shows every tab and no markers.
	m := goldenModel()
	m.width = 200
	row := strings.Split(m.renderTabs(), "\n")[0]
	if strings.ContainsAny(row, "‹›") || !strings.Contains(row, "DISCARDED") || !strings.Contains(row, "HIRED") {
		t.Errorf("wide row = %q", row)
	}
}
