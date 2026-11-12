package i18n

import (
	"reflect"
	"strings"
	"testing"

	"github.com/santifer/jobber/dashboard/internal/data"
)

func title(id string) string { return strings.ToUpper(id[:1]) + id[1:] }

// Every state of the generated registry needs a status label and a tab label in every
// language: a state added to templates/states.yml fails here until its strings exist.
func TestEveryRegistryStateHasLabels(t *testing.T) {
	for lang, c := range map[string]*Catalog{"en": &En, "tr": &Tr, "es": &Es} {
		v := reflect.ValueOf(c).Elem()
		for _, s := range data.States {
			for _, prefix := range []string{"Status", "Tab"} {
				f := v.FieldByName(prefix + title(s.ID))
				if !f.IsValid() || f.String() == "" {
					t.Errorf("%s catalog has no %s%s for registry state %q", lang, prefix, title(s.ID), s.ID)
				}
			}
			if got := c.StatusLabel(s.ID); got == s.ID {
				t.Errorf("%s: StatusLabel(%q) fell through to the raw id", lang, s.ID)
			}
		}
	}
}

func TestStatusLabelHiredAndFallback(t *testing.T) {
	if En.StatusLabel("hired") != "Hired" || Tr.StatusLabel(" Hired ") != "İşe Alındı" || Es.StatusLabel("hired") != "Contratada" {
		t.Errorf("hired labels: %q %q %q", En.StatusLabel("hired"), Tr.StatusLabel(" Hired "), Es.StatusLabel("hired"))
	}
	// Control: ids with no Status<Id> field (and empty input) come back unchanged, never a panic.
	for _, raw := range []string{"", "unknown", "Weird Thing", "ı"} {
		if got := En.StatusLabel(raw); got != raw {
			t.Errorf("StatusLabel(%q) = %q, want it unchanged", raw, got)
		}
	}
}
