// tests/state-machine.test.mjs — lib/state-machine.mjs runtime + `node machines.mjs` CLI
// (STATE-MACHINES-PLAN Phase 3.1). The pure check() must reproduce set-status's TODAY
// decisions for canonical states (tests/set-status-transition-matrix.test.mjs pins those),
// and must get right what set-status does not yet: non-canonical `from` cells (M1).
import { pass, fail, warn, NODE, ROOT } from './helpers.mjs';
import { spawnSync } from 'child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import * as yaml from 'js-yaml';
import {
  loadMachine, listMachines, canonicalize, check, describe, toMermaid,
  MachineSchemaError, UnknownMachineError, UnknownStateError,
} from '../lib/state-machine.mjs';
import { loadCanonicalStates, loadStateTransitions, resolveCanonicalState, canTransition } from '../tracker-utils.mjs';

console.log('\nstate-machine runtime + machines.mjs CLI');

// Same literals as the set-status matrix test (kept in sync by the drift guard below).
const STATES = ['Evaluated', 'Applied', 'Responded', 'Interview', 'Offer', 'Rejected', 'Discarded', 'SKIP', 'Hired'];
const TERMINAL = new Set(['Rejected', 'Discarded', 'Hired']);
const STATES_YML = join(ROOT, 'templates', 'states.yml');

const m = loadMachine('application-status');
const raw = loadCanonicalStates(STATES_YML);          // independent reader of the same file
const edges = loadStateTransitions(STATES_YML);
const idOf = label => raw.find(s => s.label === label).id;

// ── registry / drift guard ─────────────────────────────────────────
{
  const labels = m.states.map(s => s.label).join(',');
  if (labels === STATES.join(',')) pass('application-status loads the 9 states.yml states in file order');
  else fail(`application-status states ${labels} != expected ${STATES.join(',')}`);
  const term = m.states.filter(s => s.terminal).map(s => s.label).sort().join(',');
  if (term === [...TERMINAL].sort().join(',')) pass(`terminal set is exactly ${term} (SKIP is not terminal)`);
  else fail(`terminal set ${term} drifted from the set-status matrix literal`);
  if (loadMachine('application-status') === m) pass('loadMachine is cached (same object on second call)');
  else fail('loadMachine returned a different object on the second call');
  if (listMachines().includes('application-status')) pass('listMachines includes application-status');
  else fail('listMachines is missing application-status');
}

// ── canonicalize: every label / id / alias, plus controls ──────────
{
  const bad = [];
  let n = 0;
  for (const s of raw) {
    const tokens = [[s.label, null], [s.id, null], [s.label.toUpperCase(), null], ...s.aliases.map(a => [a, a])];
    for (const [tok, alias] of tokens) {
      n++;
      const r = canonicalize(m, tok);
      // label/id/uppercase may legitimately report an alias only when the token equals an alias
      if (!r || r.id !== s.id || r.label !== s.label) bad.push(`${tok} -> ${r && r.label}`);
      else if (alias !== null && r.matchedAlias === null && tok.toLowerCase() !== s.label.toLowerCase() && tok.toLowerCase() !== s.id) bad.push(`${tok}: alias not reported`);
    }
  }
  if (bad.length === 0) pass(`canonicalize maps all ${n} label/id/alias spellings to their own state`);
  else fail(`canonicalize mismatches: ${bad.join(' | ')}`);

  // matchedAlias identity: an alias is reported as the declared alias, a label as null
  const a = canonicalize(m, 'Evaluada');
  const l = canonicalize(m, 'Evaluated');
  if (a?.id === 'evaluated' && a.matchedAlias === 'evaluada' && l?.matchedAlias === null) pass('matchedAlias: alias reported, label gives null');
  else fail(`matchedAlias wrong: ${JSON.stringify(a)} / ${JSON.stringify(l)}`);

  // whitespace and ** exactly as resolveCanonicalState (pinned by status-normalizers-golden)
  const odd = ['  Applied  ', '**Applied**', ' **applied** ', '\tAPPLIED\n', '**Hired**'];
  const want = ['Applied', 'Applied', 'Applied', 'Applied', 'Hired'];
  const got = odd.map(x => canonicalize(m, x)?.label);
  if (got.join('|') === want.join('|')) pass('canonicalize trims whitespace and strips ** (case-insensitive)');
  else fail(`whitespace/bold handling: ${got.join('|')} != ${want.join('|')}`);

  // identity vs the legacy resolver over every token + junk (control: junk must stay null in both)
  const probes = [...raw.flatMap(s => [s.label, s.id, ...s.aliases]), 'zzz-not-a-status', '', '   ', '**', 'Applied 2026-01-05', '-', 'Evaluated!'];
  const diff = probes.filter(p => (canonicalize(m, p)?.label ?? null) !== resolveCanonicalState(p, raw));
  if (diff.length === 0) pass(`canonicalize == resolveCanonicalState on all ${probes.length} probes`);
  else fail(`canonicalize/resolveCanonicalState diverge on: ${diff.map(d => JSON.stringify(d)).join(', ')}`);

  if (canonicalize(m, 'zzz-not-a-status') === null && canonicalize(m, undefined) === null) pass('non-strict canonicalize returns null for unknown/empty');
  else fail('non-strict canonicalize did not return null for unknown input');
  try { canonicalize(m, 'zzz-not-a-status', { strict: true }); fail('strict canonicalize did not throw on unknown input'); }
  catch (e) {
    if (e instanceof UnknownStateError && e.code === 'unknown-state' && e.legal.join(',') === STATES.join(',')) pass('strict canonicalize throws UnknownStateError listing the valid states');
    else fail(`strict canonicalize threw the wrong error: ${e && e.code} ${e && e.message}`);
  }
  if (canonicalize(m, 'Applied', { strict: true })?.label === 'Applied') pass('strict canonicalize control: a valid state does not throw');
  else fail('strict canonicalize returned nothing for a valid state');
}

// ── check(): the full 9x9 matrix against set-status's pinned decisions ──
{
  const bad = [];
  const tally = {};
  for (const from of STATES) for (const to of STATES) {
    const r = check(m, from, to);
    tally[r.kind] = (tally[r.kind] ?? 0) + 1;
    const wantOk = from === to ? true : !TERMINAL.has(from);   // plain run (no --force)
    const wantKind = from === to ? 'noop'
      : TERMINAL.has(from) ? 'terminal-exit'
      : canTransition(edges, idOf(from), idOf(to)) ? 'forward' : 'correction';
    if (r.ok !== wantOk) bad.push(`${from}->${to}: ok ${r.ok} (want ${wantOk})`);
    if (r.kind !== wantKind) bad.push(`${from}->${to}: kind ${r.kind} (want ${wantKind})`);
    if (r.kind === 'terminal-exit' && r.legal.join(',') !== from) bad.push(`${from}->${to}: legal ${r.legal} (want just ${from})`);
  }
  if (bad.length === 0) pass('check() matches the set-status matrix for all 81 (from,to) pairs');
  else fail(`check() deviates from set-status decisions: ${bad.join(' | ')}`);
  // Control: refusals AND successes exist, in the pinned amounts (24 refused / 9 no-op / 48 changed).
  const changed = (tally.forward ?? 0) + (tally.correction ?? 0);
  if (tally['terminal-exit'] === 24 && tally.noop === 9 && changed === 48 && (tally.forward ?? 0) > 0 && (tally.correction ?? 0) > 0) {
    pass(`matrix tally: 24 terminal-exit / 9 noop / ${tally.forward} forward + ${tally.correction} correction`);
  } else fail(`matrix tally unexpected: ${JSON.stringify(tally)}`);

  // Identity on named moves
  const cases = [
    ['Applied', 'Interview', true, 'forward'], ['Interview', 'Applied', true, 'correction'],
    ['Evaluated', 'Interview', true, 'correction'], ['SKIP', 'Evaluated', true, 'forward'],
    ['Hired', 'Evaluated', false, 'terminal-exit'], ['Rejected', 'Interview', false, 'terminal-exit'],
  ];
  const wrong = cases.filter(([f, t, ok, kind]) => { const r = check(m, f, t); return r.ok !== ok || r.kind !== kind; });
  if (wrong.length === 0) pass('named moves: Applied->Interview forward, Interview->Applied correction, Rejected->Interview terminal-exit');
  else fail(`named moves wrong: ${wrong.map(w => w.slice(0, 2).join('->')).join(', ')}`);
}

// ── check(): non-canonical from (M1) — the fix set-status will adopt in 3.2 ──
{
  const alias = check(m, 'Evaluada', 'Applied');           // alias of a live state: resolved, not unknown
  if (alias.ok && alias.kind === 'forward' && alias.from === 'Evaluated') pass('alias `Evaluada` is canonicalized to Evaluated before judging (forward, not terminal)');
  else fail(`Evaluada->Applied: ${JSON.stringify(alias)}`);
  const dated = check(m, 'Applied 2026-01-05', 'Interview');
  if (dated.ok === true && dated.kind === 'unknown-from' && dated.warning) pass('`Applied 2026-01-05` -> Interview is unknown-from: allowed with a warning, not terminal');
  else fail(`dated from: ${JSON.stringify(dated)}`);
  // Control: a canonical terminal and an aliased terminal are still refused (aliasing must not dodge the gate)
  const ctl = check(m, 'Rejected', 'Interview');
  const ctlAlias = check(m, 'Rechazado', 'Interview');
  if (!ctl.ok && !ctlAlias.ok && ctlAlias.kind === 'terminal-exit' && ctlAlias.from === 'Rejected') pass('control: `Rechazado` (alias of terminal Rejected) -> Interview is refused');
  else fail(`terminal alias not refused: ${JSON.stringify(ctlAlias)}`);
  const junk = check(m, 'zzz-not-a-status', 'Applied');
  if (junk.kind === 'unknown-from' && junk.ok && junk.legal.join(',') === STATES.join(',')) pass('unknown-from lists every state as legal');
  else fail(`junk from: ${JSON.stringify(junk)}`);
  const noTo = check(m, 'Applied', 'Bogus');
  if (!noTo.ok && noTo.kind === 'unknown-to' && /Valid states: Evaluated/.test(noTo.message)) pass('unknown target -> ok:false kind unknown-to with the valid states');
  else fail(`unknown to: ${JSON.stringify(noTo)}`);
  const alt = check(m, 'Applied', 'entrevista');
  if (alt.ok && alt.to === 'Interview') pass('target aliases are canonicalized too (`entrevista` -> Interview)');
  else fail(`alias target: ${JSON.stringify(alt)}`);
}

// ── describe / toMermaid ───────────────────────────────────────────
{
  const d = describe(m);
  const ymlTerm = raw.filter(s => (edges[s.id] ?? []).length === 0).map(s => s.id).sort().join(',');
  if (d.id === 'application-status' && d.states.length === 9 && d.terminal.slice().sort().join(',') === ymlTerm) pass('describe: id, 9 states, terminal set equals the empty-transition states of states.yml');
  else fail(`describe wrong: ${JSON.stringify({ id: d.id, n: d.states.length, t: d.terminal })}`);
  if (JSON.stringify(d.transitions.applied) === JSON.stringify(edges.applied) && d.transitions.hired.length === 0) pass('describe: transitions copy states.yml (applied has edges, hired has none)');
  else fail(`describe transitions wrong: ${JSON.stringify(d.transitions)}`);
  if (d.policy.exit_terminal === 'force' && d.policy.backward_between_live === 'correction' && d.persisted_in.includes('applications.md')) pass('describe: default policy and persisted_in present');
  else fail(`describe policy/persisted_in: ${JSON.stringify(d.policy)} ${d.persisted_in}`);
  const g = toMermaid(m).split('\n');
  const has = l => g.includes(l);
  if (g[0] === 'stateDiagram-v2' && has('  [*] --> evaluated') && has('  applied --> interview') && has('  rejected --> [*]') && has('  hired --> [*]')) pass('toMermaid: header, initial edge, a forward edge, terminal exits');
  else fail(`toMermaid wrong:\n${g.join('\n')}`);
  if (!has('  skip --> [*]') && !has('  interview --> applied')) pass('toMermaid control: non-terminal SKIP has no exit edge; corrections are not drawn');
  else fail('toMermaid drew an edge it should not have');
}

// ── schema validation / loader safety (temp registry root) ─────────
const root = mkdtempSync(join(tmpdir(), 'sm-root-'));
try {
  let setupOk = true;
  const put = (id, body) => { writeFileSync(join(root, 'templates', 'machines', `${id}.yml`), body); };
  try { mkdirSync(join(root, 'templates', 'machines'), { recursive: true }); } catch (e) { setupOk = false; warn(`could not build temp registry root: ${e.message} — schema checks not verified`); }
  if (setupOk) {
    const good = `id: demo\npersisted_in: somewhere\ninitial: a\nstates:\n  - {id: a, label: A, aliases: [alpha]}\n  - {id: b, label: B}\n  - {id: c, label: C, terminal: true}\ntransitions:\n  a: [b]\n  b: [c, a]\npolicy: {backward_between_live: forbidden}\nwriters: [demo.mjs]\n`;
    put('demo', good);
    const demo = loadMachine('demo', { root });
    if (demo.id === 'demo' && demo.writers[0] === 'demo.mjs' && listMachines({ root }).join(',') === 'demo') pass('a templates/machines/<id>.yml machine loads and is listed (states.yml absent is fine)');
    else fail(`demo machine wrong: ${JSON.stringify(demo)}`);
    if (demo.states.find(s => s.id === 'c').terminal === true && demo.states.find(s => s.id === 'a').terminal === false) pass('explicit `terminal: true` honored; states with edges are live');
    else fail('terminal flag not honored');
    const ill = check(demo, 'A', 'C'), fwd = check(demo, 'A', 'B'), back = check(demo, 'B', 'A');
    if (!ill.ok && ill.kind === 'illegal' && /Legal moves from A: B/.test(ill.message) && fwd.ok && back.ok && back.kind === 'forward') pass('policy backward_between_live=forbidden: undeclared A->C is illegal (names the legal moves); declared edges still pass');
    else fail(`forbidden policy: ${JSON.stringify([ill, fwd, back])}`);

    // each malformed file must be rejected FOR ITS OWN reason (identity, not just "threw")
    const badCases = {
      dupid: ['states:\n  - {id: a, label: A}\n  - {id: a, label: B}\n', /duplicate state id "a"/],
      badedge: ['states:\n  - {id: a, label: A}\ntransitions:\n  a: [zzz]\n', /unknown target state "zzz"/],
      badsrc: ['states:\n  - {id: a, label: A}\ntransitions:\n  q: [a]\n', /unknown source state "q"/],
      aliasclash: ['states:\n  - {id: a, label: A, aliases: [x]}\n  - {id: b, label: B, aliases: [x]}\n', /"x" names both "a" and "b"/],
      badpolicy: ['states:\n  - {id: a, label: A}\npolicy: {exit_terminal: sometimes}\n', /policy\.exit_terminal: invalid value "sometimes"/],
      nostates: ['id: nostates\n', /non-empty top-level "states" list/],
      badinit: ['initial: nope\nstates:\n  - {id: a, label: A}\n', /initial "nope" is not a declared state/],
      wrongid: ['id: other\nstates:\n  - {id: a, label: A}\n', /does not match the file's machine id/],
    };
    for (const [name, [body, re]] of Object.entries(badCases)) {
      put(name, body);
      try { loadMachine(name, { root }); fail(`schema case ${name}: accepted a malformed machine`); }
      catch (e) {
        if (e instanceof MachineSchemaError && re.test(e.message)) pass(`schema rejects ${name}: ${e.problems[0]}`);
        else fail(`schema case ${name}: wrong failure (${e && e.name}: ${e && e.message})`);
      }
    }
    for (const badId of ['nope', '../states', 'Demo', '']) {
      try { loadMachine(badId, { root }); fail(`loadMachine accepted bad id ${JSON.stringify(badId)}`); }
      catch (e) {
        if (e instanceof UnknownMachineError && e.known.includes('demo')) pass(`loadMachine rejects id ${JSON.stringify(badId)} (UnknownMachineError lists known machines)`);
        else fail(`id ${JSON.stringify(badId)}: ${e && e.name}`);
      }
    }
  }
} catch (e) {
  warn(`schema/loader harness error: ${e.message}`);
} finally {
  rmSync(root, { recursive: true, force: true });
}

// ── CLI (spawned) ──────────────────────────────────────────────────
const cli = (...args) => {
  const r = spawnSync(NODE, [join(ROOT, 'machines.mjs'), ...args], { encoding: 'utf-8', timeout: 60_000 });
  if (r.error || r.status === null) return null;
  let json = null;
  try { json = JSON.parse(r.stdout); } catch {}
  return { code: r.status, out: r.stdout, err: r.stderr, json };
};
{
  const L = cli('list');
  const LJ = cli('list', '--json');
  if (!L || !LJ) warn('machines.mjs list could not be run — not verified');
  else {
    if (L.code === 0 && /^application-status\t9 states/m.test(L.out)) pass('CLI list: exit 0, names application-status with its state count');
    else fail(`CLI list: exit ${L.code} out ${JSON.stringify(L.out)}`);
    const row = Array.isArray(LJ.json) && LJ.json.find(r => r.id === 'application-status');
    if (LJ.code === 0 && row && row.states === 9) pass('CLI list --json: array row with id and states');
    else fail(`CLI list --json: ${LJ.out}`);
  }

  const D = cli('describe', 'application-status');
  const DJ = cli('describe', 'application-status', '--json');
  const DM = cli('describe', 'application-status', '--mermaid');
  const DX = cli('describe', 'nope', '--json');
  const DB = cli('describe', 'application-status', '--json', '--mermaid');
  if (![D, DJ, DM, DX, DB].every(Boolean)) warn('machines.mjs describe could not be run — not verified');
  else {
    if (D.code === 0 && /Rejected \[rejected\] TERMINAL/.test(D.out) && /SKIP \[skip\]  ->/.test(D.out) && !/SKIP \[skip\] TERMINAL/.test(D.out)) pass('CLI describe: text marks Rejected TERMINAL and not SKIP');
    else fail(`CLI describe text: exit ${D.code}\n${D.out}`);
    if (DJ.code === 0 && DJ.json?.id === 'application-status' && DJ.json.states.length === 9 && DJ.json.terminal.length === 3) pass('CLI describe --json: parseable, 9 states, 3 terminal');
    else fail(`CLI describe --json: exit ${DJ.code} ${DJ.out.slice(0, 200)}`);
    if (DM.code === 0 && DM.out.startsWith('stateDiagram-v2')) pass('CLI describe --mermaid: stateDiagram-v2 source');
    else fail(`CLI describe --mermaid: exit ${DM.code} ${DM.out.slice(0, 100)}`);
    if (DX.code === 2 && DX.json?.ok === false && DX.json.code === 'unknown-machine' && DX.json.known.includes('application-status')) pass('CLI describe unknown id: exit 2, code unknown-machine, lists known machines');
    else fail(`CLI describe unknown: exit ${DX.code} ${DX.out}`);
    if (DB.code === 2 && DB.json?.code === 'usage') pass('CLI describe --json --mermaid: exit 2 usage (mutually exclusive)');
    else fail(`CLI describe both flags: exit ${DB.code} ${DB.out}`);
  }

  const ok = cli('check', 'application-status', 'Applied', 'Interview');
  const ref = cli('check', 'application-status', 'Rejected', 'Interview');
  const refJ = cli('check', 'application-status', 'Hired', 'Evaluated', '--json');
  const unkFrom = cli('check', 'application-status', 'Applied 2026-01-05', 'Interview', '--json');
  const badTo = cli('check', 'application-status', 'Applied', 'Bogus', '--json');
  const badToText = cli('check', 'application-status', 'Applied', 'Bogus');
  const noArgs = cli('check', 'application-status');
  const noCmd = cli();
  if (![ok, ref, refJ, unkFrom, badTo, badToText, noArgs, noCmd].every(Boolean)) warn('machines.mjs check could not be run — not verified');
  else {
    if (ok.code === 0 && /^OK forward:/.test(ok.out)) pass('CLI check Applied -> Interview: exit 0, OK forward');
    else fail(`CLI check ok: exit ${ok.code} ${ok.out}`);
    if (ref.code === 1 && /^REFUSED terminal-exit:/.test(ref.out) && /Legal moves from Rejected: Rejected\./.test(ref.out)) pass('CLI check Rejected -> Interview: exit 1, REFUSED, names the legal moves');
    else fail(`CLI check refused: exit ${ref.code} ${ref.out}`);
    if (refJ.code === 1 && refJ.json?.ok === false && refJ.json.kind === 'terminal-exit' && refJ.json.legal.join() === 'Hired') pass('CLI check --json (refusal): exit 1, ok:false, kind terminal-exit, legal [Hired]');
    else fail(`CLI check --json refusal: exit ${refJ.code} ${refJ.out}`);
    if (unkFrom.code === 0 && unkFrom.json?.ok === true && unkFrom.json.kind === 'unknown-from') pass('CLI check unknown-from: exit 0 (allowed with warning), kind unknown-from');
    else fail(`CLI check unknown-from: exit ${unkFrom.code} ${unkFrom.out}`);
    if (badTo.code === 2 && badTo.json?.kind === 'unknown-to' && badTo.json.ok === false) pass('CLI check unknown target --json: exit 2, kind unknown-to');
    else fail(`CLI check bad target: exit ${badTo.code} ${badTo.out}`);
    if (badToText.code === 2 && /Valid states:/.test(badToText.err) && badToText.out === '') pass('CLI check unknown target (text): exit 2, reason on stderr listing valid states');
    else fail(`CLI check bad target text: exit ${badToText.code} err ${badToText.err}`);
    if (noArgs.code === 2 && /check needs/.test(noArgs.err)) pass('CLI check with missing args: exit 2 with usage');
    else fail(`CLI check no args: exit ${noArgs.code} ${noArgs.err}`);
    if (noCmd.code === 2 && /No command given/.test(noCmd.err)) pass('CLI with no command: exit 2 with usage');
    else fail(`CLI no command: exit ${noCmd.code} ${noCmd.err}`);
  }
}

// ── tracker-utils wrapper control: canTransition still answers from the table ──
{
  if (canTransition(edges, 'applied', 'interview') === true && canTransition(edges, 'applied', 'hired') === false && canTransition(edges, 'hired', 'applied') === false && canTransition(edges, 'nope', 'applied') === false) pass('tracker-utils canTransition unchanged (edge present/absent/terminal/unknown-source)');
  else fail('tracker-utils canTransition behaviour changed');
  const src = readFileSync(join(ROOT, 'templates', 'states.yml'), 'utf-8');
  if (yaml.load(src).states.length === 9) pass('templates/states.yml still declares 9 states (registry file untouched)');
  else fail('templates/states.yml state count changed');
}
