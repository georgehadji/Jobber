// Pure, node-free model of the application-status machine (STATE-MACHINES-PLAN §4.4 / Phase 4.1).
// No fs/path imports, so client components can use it. The DATA comes from templates/states.yml
// through lib/core/states.ts (the only reader); this file only interprets it. It mirrors
// lib/state-machine.mjs describe()/check() — web/test-state-model.mjs cross-checks the two.

export type MachineState = {
  id: string;
  label: string;
  aliases: string[];
  description: string;
  terminal: boolean;
};

export type StateMachineView = {
  id: string;
  initial: string;
  states: MachineState[];
  /** forward edges: state id -> target state ids */
  transitions: Record<string, string[]>;
  /** ids of terminal states */
  terminal: string[];
  policy: { backward_between_live: string; unknown_input: string; exit_terminal: string };
};

const DEFAULT_POLICY = { backward_between_live: "correction", unknown_input: "reject", exit_terminal: "force" };

/** Build the view from a parsed templates/states.yml document. Null if it has no usable states. */
export function machineFromDoc(doc: unknown): StateMachineView | null {
  const d = (doc ?? {}) as { states?: unknown; transitions?: unknown; initial?: unknown; policy?: unknown };
  if (!Array.isArray(d.states)) return null;
  const rawEdges = d.transitions && typeof d.transitions === "object" ? (d.transitions as Record<string, unknown>) : {};
  const ids = new Set<string>();
  const parsed: { s: Omit<MachineState, "terminal">; flag: boolean | undefined }[] = [];
  for (const s of d.states as Record<string, unknown>[]) {
    if (!s || typeof s.label !== "string") continue;
    const id = typeof s.id === "string" ? s.id : s.label.toLowerCase();
    ids.add(id);
    parsed.push({
      s: {
        id,
        label: s.label,
        aliases: Array.isArray(s.aliases) ? s.aliases.filter((a): a is string => typeof a === "string") : [],
        description: typeof s.description === "string" ? s.description : "",
      },
      flag: typeof s.terminal === "boolean" ? s.terminal : undefined,
    });
  }
  if (!parsed.length) return null;
  const transitions: Record<string, string[]> = {};
  for (const { s } of parsed) {
    const t = rawEdges[s.id];
    transitions[s.id] = Array.isArray(t) ? t.map(String).filter((x) => ids.has(x)) : [];
  }
  // Terminal = explicit flag, else "no forward edges" (the states.yml convention, as in the core).
  const states = parsed.map(({ s, flag }) => ({ ...s, terminal: flag ?? transitions[s.id].length === 0 }));
  const initial = typeof d.initial === "string" && ids.has(d.initial) ? d.initial : states[0].id;
  const policy = { ...DEFAULT_POLICY, ...(d.policy && typeof d.policy === "object" ? (d.policy as Record<string, string>) : {}) };
  return { id: "application-status", initial, states, transitions, terminal: states.filter((s) => s.terminal).map((s) => s.id), policy };
}

const norm = (raw: string) => String(raw ?? "").replace(/\*\*/g, "").trim().toLowerCase();

/** Label / id / alias lookup, case-insensitive, `**` stripped (same order as the core's findState). */
export function findState(machine: StateMachineView, raw: string): MachineState | null {
  const q = norm(raw);
  if (!q) return null;
  for (const s of machine.states) {
    if (s.label.toLowerCase() === q || s.id.toLowerCase() === q || s.aliases.some((a) => a.toLowerCase() === q)) return s;
  }
  return null;
}

// Same decoration lib/status-gate.mjs strips from an existing tracker cell.
const TRAILING_DATE_RE = /\s+\(?\d{4}-\d{2}-\d{2}\)?.*$/;
const ANY_DATE_RE = /\(?\d{4}-\d{2}-\d{2}\)?/g;

/** Resolve an existing (possibly decorated: `Applied 2026-01-05`, `**Rejected**`) Status cell. */
export function resolveCell(machine: StateMachineView, raw: string): MachineState | null {
  const exact = findState(machine, raw);
  if (exact) return exact;
  const stripped = String(raw ?? "").replace(/\*\*/g, "").replace(TRAILING_DATE_RE, "").replace(ANY_DATE_RE, "").trim();
  return stripped ? findState(machine, stripped) : null;
}

// Spellings the web has always accepted for DISPLAY that templates/states.yml does not define
// (they mirror lib/status-extra-aliases.mjs plus a few Spanish/legacy ones). Pending owner
// decision D2 — do NOT widen this table; values are state ids.
const EXTRA_DISPLAY_ALIASES: Record<string, string> = {
  evaluado: "evaluated",
  condicional: "evaluated",
  hold: "evaluated",
  evaluar: "evaluated",
  verificar: "evaluated",
  respondida: "responded",
  contestada: "responded",
  duplicado: "discarded",
  repost: "discarded",
};

/** Display token for a raw status: the canonical label UPPERCASED; unknown text is just uppercased. */
export function canonStatus(machine: StateMachineView, s: string): string {
  const k = s.trim().toLowerCase();
  if (k === "" || k === "—" || k === "-") return "DISCARDED";
  const hit = findState(machine, k);
  if (hit) return hit.label.toUpperCase();
  const extra = Object.hasOwn(EXTRA_DISPLAY_ALIASES, k) ? EXTRA_DISPLAY_ALIASES[k] : null;
  const viaExtra = extra && machine.states.find((x) => x.id === extra);
  return viaExtra ? viaExtra.label.toUpperCase() : s.toUpperCase();
}

/**
 * States in display order. states.yml declares `hired` last (it was appended in #2050) but the
 * dashboard has always shown it as the funnel's success step, right after `offer`. This one local
 * tweak keeps that order; delete it if states.yml is reordered.
 */
export function displayStates(machine: StateMachineView): MachineState[] {
  const list = machine.states.filter((s) => s.id !== "hired");
  const hired = machine.states.find((s) => s.id === "hired");
  if (!hired) return [...machine.states];
  const at = list.findIndex((s) => s.id === "offer");
  list.splice(at < 0 ? list.length : at + 1, 0, hired);
  return list;
}

export const displayLabels = (machine: StateMachineView) => displayStates(machine).map((s) => s.label);

/** Pipeline tab values: INBOX, ALL, then every state UPPERCASED. */
export const tabValues = (machine: StateMachineView): string[] => ["INBOX", "ALL", ...displayLabels(machine).map((l) => l.toUpperCase())];

/** Analytics funnel stages: every state except SKIP (a shelved row is not a funnel stage). Local choice. */
export function funnelStages(machine: StateMachineView): { key: string; label: string }[] {
  return displayStates(machine).filter((s) => s.id !== "skip").map((s) => ({ key: s.label.toUpperCase(), label: s.label }));
}

export type LegalMoves = {
  /** the resolved current state, or null if the cell is not a state of the machine */
  current: MachineState | null;
  /** moves the server takes without ceremony (declared edges; for an unknown cell, every state) */
  forward: MachineState[];
  /** LIVE states only: every other state, allowed after an explicit confirm (D1). Empty if policy
   *  forbids it. Always empty for a terminal state: /api/status never passes --force, so the
   *  server would refuse the move (see terminalHint). */
  corrections: MachineState[];
  terminal: boolean;
};

/** What the status control should offer from `currentStatus` (any raw cell text). */
export function legalMoves(machine: StateMachineView, currentStatus: string): LegalMoves {
  const order = displayStates(machine);
  const cur = resolveCell(machine, currentStatus);
  // Unknown cell: the core treats it as a live row and accepts any state (kind 'unknown-from').
  if (!cur) return { current: null, forward: order, corrections: [], terminal: false };
  const edges = new Set(machine.transitions[cur.id] ?? []);
  const forward = order.filter((s) => edges.has(s.id));
  const corrections = cur.terminal || machine.policy.backward_between_live === "forbidden" ? [] : order.filter((s) => s.id !== cur.id && !edges.has(s.id));
  return { current: cur, forward, corrections, terminal: cur.terminal };
}

/** Confirmation text for a correction of a LIVE status (a move outside the declared forward edges). */
export function correctionPrompt(moves: LegalMoves, targetLabel: string): string {
  const from = moves.current?.label ?? "this status";
  return `${from} → ${targetLabel} is not a regular next step. It will be recorded as a correction. Continue?`;
}

/** Inline hint for a terminal status (null otherwise): the web cannot change it, the CLI can. */
export function terminalHint(moves: LegalMoves, n: string): string | null {
  if (!moves.terminal || !moves.current) return null;
  return `${moves.current.label} is a final state. To correct it, run: node set-status.mjs ${n} <State> --force`;
}

/** Prose for the assistant prompt: "Evaluated, Applied, ..." */
export const statesProse = (machine: StateMachineView) => displayLabels(machine).join(", ");
