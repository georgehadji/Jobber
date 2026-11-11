// lib/state-machine.mjs — declarative state-machine runtime (STATE-MACHINES-PLAN §4.1/§4.2).
//
// A machine is a YAML file that follows the schema of templates/states.yml, extended
// additively. The registry:
//   id `application-status` -> templates/states.yml (the EXISTING file, unchanged)
//   any other id             -> templates/machines/<id>.yml
//
// Schema (everything but `states` is optional):
//   id, persisted_in, initial,
//   states:      [{id, label, aliases[], description, terminal?}]
//   transitions: {fromId: [toId...]}   forward edges; a state with no/empty list is TERMINAL
//                                      unless the state sets `terminal:` explicitly
//   policy:      {backward_between_live: correction|forbidden,
//                 unknown_input: reject|flag|map:<id>, exit_terminal: force|forbidden}
//   writers:     [script names]
//
// This module is pure (no writes, no process exit). It reads only the machine file.
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import * as yaml from 'js-yaml';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const APPLICATION_STATUS = 'application-status';

// states.yml predates the schema extension, so its machine-level fields live here.
const BUILTIN = {
  [APPLICATION_STATUS]: {
    persisted_in: 'data/applications.md (Status column) + data/status-log.tsv',
    initial: 'evaluated',
  },
};
const DEFAULT_POLICY = { backward_between_live: 'correction', unknown_input: 'reject', exit_terminal: 'force' };
const POLICY_VALUES = {
  backward_between_live: v => v === 'correction' || v === 'forbidden',
  unknown_input: v => v === 'reject' || v === 'flag' || /^map:[a-z][a-z0-9_-]*$/.test(v),
  exit_terminal: v => v === 'force' || v === 'forbidden',
};

export class MachineSchemaError extends Error {
  constructor(machineId, problems) {
    super(`Invalid state machine "${machineId}": ${problems.join('; ')}`);
    this.name = 'MachineSchemaError';
    this.code = 'invalid-machine';
    this.machineId = machineId;
    this.problems = problems;
  }
}

export class UnknownMachineError extends Error {
  constructor(id, known) {
    super(`Unknown state machine "${id}". Known machines: ${known.join(', ') || '(none)'}.`);
    this.name = 'UnknownMachineError';
    this.code = 'unknown-machine';
    this.machineId = id;
    this.known = known;
  }
}

export class UnknownStateError extends Error {
  constructor(machine, raw) {
    const legal = machine.states.map(s => s.label);
    super(`Unknown ${machine.id} state "${raw}". Valid states: ${legal.join(', ')}.`);
    this.name = 'UnknownStateError';
    this.code = 'unknown-state';
    this.machineId = machine.id;
    this.raw = raw;
    this.legal = legal;
  }
}

/** Same normalisation resolveCanonicalState has always used: drop `**`, trim, lowercase. */
export const normalizeStateInput = raw => String(raw ?? '').replace(/\*\*/g, '').trim().toLowerCase();

/**
 * Match raw text against a plain states array ({id,label,aliases}) in declaration order:
 * per state, label then id then aliases. Case-insensitive. This is the exact lookup
 * tracker-utils.resolveCanonicalState had; it is shared so the two can never diverge.
 * @returns {{id:string,label:string,matchedAlias:string|null}|null}
 */
export function findState(states, raw) {
  const clean = normalizeStateInput(raw);
  if (!clean) return null;
  for (const s of states) {
    if (s.label.toLowerCase() === clean || s.id.toLowerCase() === clean) return { id: s.id, label: s.label, matchedAlias: null };
    const alias = s.aliases.find(a => a.toLowerCase() === clean);
    if (alias !== undefined) return { id: s.id, label: s.label, matchedAlias: alias };
  }
  return null;
}

/** Whether `to` is a declared forward edge of `from` in a {fromId: [toId]} table. */
export function isForwardEdge(transitions, fromId, toId) {
  return Array.isArray(transitions[fromId]) && transitions[fromId].includes(toId);
}

const ID_RE = /^[a-z][a-z0-9-]*$/;
const cache = new Map();

function machinePath(root, id) {
  return id === APPLICATION_STATUS ? join(root, 'templates', 'states.yml') : join(root, 'templates', 'machines', `${id}.yml`);
}

/** Ids of every declared machine, sorted. `root` defaults to the repo root. */
export function listMachines({ root = ROOT } = {}) {
  const ids = [];
  if (existsSync(machinePath(root, APPLICATION_STATUS))) ids.push(APPLICATION_STATUS);
  const dir = join(root, 'templates', 'machines');
  if (existsSync(dir)) {
    for (const f of readdirSync(dir)) if (f.endsWith('.yml') && ID_RE.test(f.slice(0, -4))) ids.push(f.slice(0, -4));
  }
  return ids.sort();
}

function validate(id, doc) {
  const problems = [];
  const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  if (!isObj(doc)) throw new MachineSchemaError(id, ['file is not a YAML mapping']);
  if (doc.id !== undefined && doc.id !== id) problems.push(`id "${doc.id}" does not match the file's machine id "${id}"`);
  if (!Array.isArray(doc.states) || doc.states.length === 0) {
    throw new MachineSchemaError(id, [...problems, 'expected a non-empty top-level "states" list']);
  }
  const states = [];
  const ids = new Set();
  const tokens = new Map(); // normalised label/id/alias -> owning state id
  for (const [i, s] of doc.states.entries()) {
    if (!isObj(s) || typeof s.id !== 'string' || !s.id.trim() || typeof s.label !== 'string' || !s.label.trim()) {
      problems.push(`states[${i}] needs string "id" and "label"`);
      continue;
    }
    if (ids.has(s.id)) problems.push(`duplicate state id "${s.id}"`);
    ids.add(s.id);
    if (s.aliases !== undefined && (!Array.isArray(s.aliases) || s.aliases.some(a => typeof a !== 'string'))) {
      problems.push(`state "${s.id}": aliases must be a list of strings`);
    }
    if (s.terminal !== undefined && typeof s.terminal !== 'boolean') problems.push(`state "${s.id}": terminal must be true or false`);
    const aliases = Array.isArray(s.aliases) ? s.aliases.filter(a => typeof a === 'string') : [];
    for (const t of new Set([s.label, s.id, ...aliases].map(normalizeStateInput))) {
      if (tokens.has(t) && tokens.get(t) !== s.id) problems.push(`"${t}" names both "${tokens.get(t)}" and "${s.id}"`);
      tokens.set(t, s.id);
    }
    states.push({ id: s.id, label: s.label, aliases, description: typeof s.description === 'string' ? s.description : '', terminalFlag: s.terminal });
  }
  const transitions = {};
  if (doc.transitions !== undefined && !isObj(doc.transitions)) problems.push('transitions must be a mapping');
  else for (const [from, targets] of Object.entries(doc.transitions ?? {})) {
    if (!ids.has(from)) problems.push(`transitions: unknown source state "${from}"`);
    if (!Array.isArray(targets)) { problems.push(`transitions.${from} must be a list`); continue; }
    for (const t of targets) if (!ids.has(String(t))) problems.push(`transitions.${from}: unknown target state "${t}"`);
    transitions[from] = targets.map(String);
  }
  const base = BUILTIN[id] ?? {};
  const initial = doc.initial ?? base.initial ?? states[0]?.id;
  if (!ids.has(initial)) problems.push(`initial "${initial}" is not a declared state`);
  const policy = { ...DEFAULT_POLICY };
  if (doc.policy !== undefined && !isObj(doc.policy)) problems.push('policy must be a mapping');
  else for (const [k, v] of Object.entries(doc.policy ?? {})) {
    if (!(k in POLICY_VALUES)) problems.push(`policy: unknown key "${k}"`);
    else if (typeof v !== 'string' || !POLICY_VALUES[k](v)) problems.push(`policy.${k}: invalid value ${JSON.stringify(v)}`);
    else policy[k] = v;
  }
  if (policy.unknown_input.startsWith('map:') && !ids.has(policy.unknown_input.slice(4))) problems.push(`policy.unknown_input maps to unknown state "${policy.unknown_input.slice(4)}"`);
  if (doc.writers !== undefined && (!Array.isArray(doc.writers) || doc.writers.some(w => typeof w !== 'string'))) problems.push('writers must be a list of strings');
  if (problems.length) throw new MachineSchemaError(id, problems);

  return {
    id,
    persisted_in: doc.persisted_in ?? base.persisted_in ?? null,
    initial,
    states: states.map(({ terminalFlag, ...s }) => ({
      ...s,
      // Terminal = explicit flag, else "no forward edges" (the states.yml convention).
      terminal: terminalFlag ?? (transitions[s.id] ?? []).length === 0,
    })),
    transitions,
    policy,
    writers: doc.writers ?? [],
  };
}

/**
 * Load, validate and cache a machine. Throws UnknownMachineError / MachineSchemaError.
 * @param {string} id
 * @param {{root?: string}} [opts] root override (tests); defaults to the repo root.
 */
export function loadMachine(id, { root = ROOT } = {}) {
  const key = `${root}\0${id}`;
  if (cache.has(key)) return cache.get(key);
  if (typeof id !== 'string' || !ID_RE.test(id) || !existsSync(machinePath(root, id))) {
    throw new UnknownMachineError(String(id), listMachines({ root }));
  }
  let doc;
  try { doc = yaml.load(readFileSync(machinePath(root, id), 'utf-8')); } catch (e) { throw new MachineSchemaError(id, [`YAML parse error: ${e.message}`]); }
  const machine = validate(id, doc);
  for (const s of machine.states) Object.freeze(s);
  Object.freeze(machine.states);
  cache.set(key, Object.freeze(machine));
  return machine;
}

/**
 * Map raw text to a state of the machine.
 * Non-strict (default): returns {id,label,matchedAlias} or null when unknown.
 * Strict: throws UnknownStateError instead of returning null.
 */
export function canonicalize(machine, raw, { strict = false } = {}) {
  const hit = findState(machine.states, raw);
  if (hit === null && strict) throw new UnknownStateError(machine, raw);
  return hit;
}

/**
 * Judge a move `from` -> `to`. Both are canonicalized (aliases, `**`, whitespace) first.
 * Returns {ok, kind, from, to, legal, forward, message, warning?}:
 *   noop          from == to (always ok; nothing to write)
 *   forward       declared edge
 *   correction    live -> live move that is not a declared edge (free by policy; the ledger records it)
 *   terminal-exit leaving a terminal state; ok:false (set-status needs --force)
 *   unknown-from  `from` is not a state of the machine; ok:true with a warning, NEVER treated as terminal
 *   unknown-to    `to` is not a state; ok:false
 *   illegal       policy forbids it (backward_between_live: forbidden)
 * `legal` = labels the machine allows from `from` (self excluded); `forward` = declared edges only.
 */
export function check(machine, from, to) {
  const all = machine.states.map(s => s.label);
  const label = id => machine.states.find(s => s.id === id).label;
  const target = canonicalize(machine, to);
  if (!target) {
    const message = `Unknown ${machine.id} state "${to}". Valid states: ${all.join(', ')}.`;
    return { ok: false, kind: 'unknown-to', from: String(from), to: String(to), legal: all, forward: [], message };
  }
  const src = canonicalize(machine, from);
  if (!src) {
    const warning = `"${from}" is not a ${machine.id} state; treating it as a live row (not terminal). Valid states: ${all.join(', ')}.`;
    return { ok: true, kind: 'unknown-from', from: String(from), to: target.label, legal: all, forward: [], message: warning, warning };
  }
  const st = machine.states.find(s => s.id === src.id);
  const fwdIds = machine.transitions[src.id] ?? [];
  const forward = fwdIds.map(label);
  const res = (ok, kind, legal, message) => ({ ok, kind, from: src.label, to: target.label, legal, forward, message });
  if (src.id === target.id) return res(true, 'noop', [], `${src.label} is already ${src.label}; nothing to change.`);
  if (st.terminal) {
    // Staying put is always legal; so are declared edges (an explicit terminal flag may keep some).
    const legal = [src.label, ...forward];
    if (fwdIds.includes(target.id)) return res(true, 'forward', forward, `${src.label} -> ${target.label} is a declared move.`);
    return res(false, 'terminal-exit', legal,
      `Illegal transition ${src.label} -> ${target.label}: ${src.label} is a terminal state of ${machine.id}. Legal moves from ${src.label}: ${legal.join(' · ')}.` +
      (machine.policy.exit_terminal === 'force' ? ' An explicit override (--force) is required.' : ' No override is allowed.'));
  }
  if (fwdIds.includes(target.id)) return res(true, 'forward', all.filter(l => l !== src.label), `${src.label} -> ${target.label} is a declared move.`);
  if (machine.policy.backward_between_live === 'forbidden') {
    return res(false, 'illegal', forward, `Illegal transition ${src.label} -> ${target.label}. Legal moves from ${src.label}: ${forward.join(' · ') || '(none)'}.`);
  }
  return res(true, 'correction', all.filter(l => l !== src.label), `${src.label} -> ${target.label} is not a declared move; allowed as a correction.`);
}

/** Plain-JSON description for agents/UI. */
export function describe(machine) {
  return {
    id: machine.id,
    persisted_in: machine.persisted_in,
    initial: machine.initial,
    states: machine.states.map(s => ({ id: s.id, label: s.label, aliases: [...s.aliases], description: s.description, terminal: s.terminal })),
    transitions: Object.fromEntries(machine.states.map(s => [s.id, [...(machine.transitions[s.id] ?? [])]])),
    terminal: machine.states.filter(s => s.terminal).map(s => s.id),
    policy: { ...machine.policy },
    writers: [...machine.writers],
  };
}

/** Mermaid stateDiagram-v2 source. */
export function toMermaid(machine) {
  const lines = ['stateDiagram-v2'];
  for (const s of machine.states) lines.push(`  state "${s.label}" as ${s.id.replace(/[^A-Za-z0-9_]/g, '_')}`);
  const mid = id => id.replace(/[^A-Za-z0-9_]/g, '_');
  lines.push(`  [*] --> ${mid(machine.initial)}`);
  for (const s of machine.states) for (const t of machine.transitions[s.id] ?? []) lines.push(`  ${mid(s.id)} --> ${mid(t)}`);
  for (const s of machine.states) if (s.terminal) lines.push(`  ${mid(s.id)} --> [*]`);
  return lines.join('\n');
}
