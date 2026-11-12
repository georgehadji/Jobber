// lib/status-extra-aliases.mjs — status spellings that scripts accept but templates/states.yml does not define.
//
// STATE-MACHINES-PLAN Phase 3.3 / constraint 3 ("aliases are a superset, never an intersection"):
// scripts resolve a status through the registry (lib/state-machine.mjs canonicalize) first and
// fall back to this table, so moving a script onto the registry never loses a spelling it accepted.
//
// PENDING DECISION D2: whether these belong in states.yml itself is the owner's call. Do NOT add
// entries here to widen what a script accepts, and do NOT move them into states.yml without D2.
// Keys are lower-case; values are state ids of the application-status machine.
export const EXTRA_STATUS_ALIASES = Object.freeze({
  condicional: 'evaluated', // pending decision D2
  hold: 'evaluated', // pending decision D2
  evaluar: 'evaluated', // pending decision D2
  verificar: 'evaluated', // pending decision D2
  'geo blocker': 'skip', // pending decision D2
});

/** State id for an extra spelling (already lower-cased/trimmed by the caller), or null. */
export const extraStatusId = clean => (Object.hasOwn(EXTRA_STATUS_ALIASES, clean) ? EXTRA_STATUS_ALIASES[clean] : null);
