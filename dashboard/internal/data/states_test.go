package data

import (
	"sort"
	"strings"
	"testing"
)

// The registry (states_gen.go) and the hand-written Go matcher/ordering must not drift.

// Every registry id, label and alias must normalise to its own id. Known conflict kept on
// purpose (decision D2): the registry says monitor -> skip, Go has always said evaluated.
func TestNormalizeStatusAgreesWithRegistry(t *testing.T) {
	knownConflicts := map[string]string{"monitor": "evaluated"}
	for _, s := range States {
		spellings := append([]string{s.ID, s.Label}, s.Aliases...)
		for _, sp := range spellings {
			want := s.ID
			if v, ok := knownConflicts[strings.ToLower(sp)]; ok {
				want = v
			}
			if got := NormalizeStatus(sp); got != want {
				t.Errorf("NormalizeStatus(%q) = %q, registry state %q wants %q", sp, got, s.ID, want)
			}
		}
	}
	// Control: the conflict table is not vacuous -- monitor really is a registry alias.
	found := false
	for _, s := range States {
		for _, a := range s.Aliases {
			if a == "monitor" {
				found = true
			}
		}
	}
	if !found {
		t.Error("control: registry no longer lists the monitor alias; drop the knownConflicts entry")
	}
}

func TestRegistryShape(t *testing.T) {
	ids := map[string]bool{}
	for _, s := range States {
		if ids[s.ID] {
			t.Errorf("duplicate registry id %q", s.ID)
		}
		ids[s.ID] = true
	}
	if !ids[InitialStateID] {
		t.Errorf("InitialStateID %q is not a registry state", InitialStateID)
	}
	for _, s := range States {
		for _, n := range s.Next {
			if !ids[n] {
				t.Errorf("state %q has an edge to unknown state %q", s.ID, n)
			}
		}
		if len(s.Next) == 0 && !s.Terminal {
			t.Errorf("state %q has no forward edges but is not terminal", s.ID)
		}
	}
	// Spot-check against the known registry facts so an empty/garbled generated table fails.
	type fact struct {
		id       string
		terminal bool
	}
	for _, f := range []fact{{"hired", true}, {"rejected", true}, {"discarded", true}, {"evaluated", false}, {"skip", false}} {
		s, ok := StateByID(f.id)
		if !ok || s.Terminal != f.terminal {
			t.Errorf("StateByID(%q) = %+v, ok=%v; want terminal=%v", f.id, s, ok, f.terminal)
		}
	}
	if _, ok := StateByID("nonsense"); ok || IsStateID("nonsense") {
		t.Error("control: an unknown id must not be a state")
	}
	if StateLabel("skip") != "SKIP" || StateLabel("nonsense") != "nonsense" {
		t.Errorf("StateLabel: skip=%q nonsense=%q", StateLabel("skip"), StateLabel("nonsense"))
	}
}

// priorityOrder + hired must be exactly the registry (as a set, no duplicates): adding a
// state to states.yml fails this until it is placed in the dashboard's sort order.
func TestPriorityOrderCoversRegistry(t *testing.T) {
	got := append(PriorityOrder(), "hired")
	var want []string
	for _, s := range States {
		want = append(want, s.ID)
	}
	sort.Strings(got)
	sort.Strings(want)
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Errorf("priorityOrder+hired = %v, registry = %v", got, want)
	}
	if StatusPriority("Interview") != 0 || StatusPriority("hired") != len(priorityOrder) || StatusPriority("zzz") != len(priorityOrder) {
		t.Errorf("StatusPriority: interview=%d hired=%d unknown=%d", StatusPriority("Interview"), StatusPriority("hired"), StatusPriority("zzz"))
	}
	// Control: the copy handed out is not the live slice.
	cp := PriorityOrder()
	cp[0] = "mutated"
	if priorityOrder[0] == "mutated" {
		t.Error("PriorityOrder must return a copy")
	}
}

func TestClosedAndDiscardPredicates(t *testing.T) {
	for _, c := range []struct {
		norm            string
		closed, discard bool
	}{
		{"skip", true, true}, {"rejected", true, false}, {"discarded", true, true},
		{"hired", false, false}, {"evaluated", false, false}, {"offer", false, false},
	} {
		if IsClosedStatus(c.norm) != c.closed || AsksDiscardReason(c.norm) != c.discard {
			t.Errorf("%s: closed=%v discard=%v, want %v/%v", c.norm, IsClosedStatus(c.norm), AsksDiscardReason(c.norm), c.closed, c.discard)
		}
	}
}
