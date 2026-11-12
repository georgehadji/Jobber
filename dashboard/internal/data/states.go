package data

// Hand-written helpers over the generated registry (states_gen.go).

// StateByID returns the registry entry for a canonical id (as NormalizeStatus returns it).
func StateByID(id string) (State, bool) {
	for _, s := range States {
		if s.ID == id {
			return s, true
		}
	}
	return State{}, false
}

// IsStateID reports whether id is a canonical registry state id.
func IsStateID(id string) bool {
	_, ok := StateByID(id)
	return ok
}

// StateLabel returns the registry label (the spelling written to applications.md)
// for a canonical id, or the id itself when it is not a registry state.
func StateLabel(id string) string {
	if s, ok := StateByID(id); ok {
		return s.Label
	}
	return id
}

// AsksDiscardReason reports whether moving to this normalized status opens the discard
// reason picker (Issue 1380) before the write.
func AsksDiscardReason(norm string) bool {
	return norm == "discarded" || norm == "skip"
}
