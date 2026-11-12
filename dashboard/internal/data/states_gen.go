// GENERATED — do not edit. Source: templates/states.yml. Regenerate: node gen-go-states.mjs
// A stale copy fails tests/go-states.test.mjs and `node gen-go-states.mjs --check`.

package data

// >>> machine:application-status:go:begin (generated from templates/states.yml by gen-go-states.mjs -- do not edit by hand)

// State is one application status of the registry.
type State struct {
	ID       string   // canonical lower-case id, as NormalizeStatus returns it
	Label    string   // exact spelling written to applications.md
	Terminal bool     // leaving it needs an explicit override (set-status --force)
	Aliases  []string // registry aliases (lower case)
	Next     []string // declared forward edges (ids)
}

// InitialStateID is the state a new application starts in.
const InitialStateID = "evaluated"

// States lists every status in registry order.
var States = []State{
	{ID: "evaluated", Label: "Evaluated", Terminal: false, Aliases: []string{"evaluada"}, Next: []string{"applied", "responded", "rejected", "discarded", "skip"}},
	{ID: "applied", Label: "Applied", Terminal: false, Aliases: []string{"aplicado", "enviada", "aplicada", "sent"}, Next: []string{"responded", "interview", "rejected", "discarded", "skip"}},
	{ID: "responded", Label: "Responded", Terminal: false, Aliases: []string{"respondido"}, Next: []string{"interview", "rejected", "discarded", "skip"}},
	{ID: "interview", Label: "Interview", Terminal: false, Aliases: []string{"entrevista"}, Next: []string{"offer", "rejected", "discarded", "hired"}},
	{ID: "offer", Label: "Offer", Terminal: false, Aliases: []string{"oferta"}, Next: []string{"hired", "rejected", "discarded"}},
	{ID: "rejected", Label: "Rejected", Terminal: true, Aliases: []string{"rechazado", "rechazada"}, Next: []string{}},
	{ID: "discarded", Label: "Discarded", Terminal: true, Aliases: []string{"descartado", "descartada", "cerrada", "cancelada"}, Next: []string{}},
	{ID: "skip", Label: "SKIP", Terminal: false, Aliases: []string{"no_aplicar", "no aplicar", "skip", "monitor"}, Next: []string{"evaluated", "discarded"}},
	{ID: "hired", Label: "Hired", Terminal: true, Aliases: []string{"contratado", "contratada", "hired", "accepted", "accept"}, Next: []string{}},
}

// <<< machine:application-status:go:end
