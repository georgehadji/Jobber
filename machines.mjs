#!/usr/bin/env node
// machines.mjs — ask "what are the states, and is this move legal?" for any declared machine.
//   node machines.mjs list [--json]
//   node machines.mjs describe <id> [--json|--mermaid]
//   node machines.mjs check <id> <from> <to> [--json]
// Exit: 0 ok (incl. unknown-from, which warns), 1 move refused, 2 usage / unknown machine / unknown state.
// Read-only: never writes any file. Machines live in templates/states.yml (application-status)
// and templates/machines/<id>.yml. See lib/state-machine.mjs for the schema.
import { listMachines, loadMachine, describe, check, toMermaid } from './lib/state-machine.mjs';

const argv = process.argv.slice(2);
const flags = new Set(argv.filter(a => a.startsWith('--')));
const args = argv.filter(a => !a.startsWith('--'));
const json = flags.has('--json');
const out = v => console.log(json ? JSON.stringify(v, null, 2) : v);

function usage(msg) {
  const text = `${msg ? msg + '\n' : ''}Usage:\n  node machines.mjs list [--json]\n  node machines.mjs describe <id> [--json|--mermaid]\n  node machines.mjs check <id> <from> <to> [--json]`;
  if (json) console.log(JSON.stringify({ ok: false, code: 'usage', message: msg || 'usage', usage: text }));
  else console.error(text);
  process.exit(2);
}

function fatal(e) {
  const known = e.known ?? undefined;
  if (json) console.log(JSON.stringify({ ok: false, code: e.code ?? 'error', message: e.message, ...(known && { known }), ...(e.legal && { legal: e.legal }) }));
  else console.error(e.message);
  process.exit(2);
}

const [cmd, id, from, to] = args;
const known = new Set(['--json', '--mermaid']);
const unknownFlag = [...flags].find(f => !known.has(f));
if (unknownFlag) usage(`Unknown flag ${unknownFlag}`);

try {
  if (cmd === 'list') {
    const rows = listMachines().map(mid => { const m = loadMachine(mid); return { id: m.id, states: m.states.length, persisted_in: m.persisted_in }; });
    out(json ? rows : rows.map(r => `${r.id}\t${r.states} states\t${r.persisted_in ?? ''}`).join('\n'));
  } else if (cmd === 'describe') {
    if (!id) usage('describe needs a machine id');
    if (json && flags.has('--mermaid')) usage('--json and --mermaid are mutually exclusive');
    const m = loadMachine(id);
    if (flags.has('--mermaid')) console.log(toMermaid(m));
    else if (json) out(describe(m));
    else {
      const d = describe(m);
      const lines = [`${d.id}${d.persisted_in ? `  (persisted in ${d.persisted_in})` : ''}`, `initial: ${d.initial}`, 'states:'];
      for (const s of d.states) {
        lines.push(`  ${s.label} [${s.id}]${s.terminal ? ' TERMINAL' : ''}  -> ${d.transitions[s.id].join(', ') || '(none)'}`);
        if (s.aliases.length) lines.push(`    aliases: ${s.aliases.join(', ')}`);
      }
      lines.push(`policy: ${Object.entries(d.policy).map(([k, v]) => `${k}=${v}`).join(' ')}`, `writers: ${d.writers.join(', ') || '(not declared)'}`);
      console.log(lines.join('\n'));
    }
  } else if (cmd === 'check') {
    if (!id || from === undefined || to === undefined) usage('check needs <id> <from> <to>');
    const r = check(loadMachine(id), from, to);
    if (json) console.log(JSON.stringify(r, null, 2));
    else if (r.kind === 'unknown-to') { console.error(r.message); }
    else console.log(`${r.ok ? 'OK' : 'REFUSED'} ${r.kind}: ${r.message}`);
    process.exit(r.kind === 'unknown-to' ? 2 : r.ok ? 0 : 1);
  } else {
    usage(cmd ? `Unknown command "${cmd}"` : 'No command given');
  }
} catch (e) {
  fatal(e);
}
