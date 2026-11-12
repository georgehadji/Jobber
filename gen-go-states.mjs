#!/usr/bin/env node
// gen-go-states.mjs — generate the dashboard's Go view of the application-status registry
// (STATE-MACHINES-PLAN §4.4, Phase 4.2) from templates/states.yml.
//   node gen-go-states.mjs                 rewrite dashboard/internal/data/states_gen.go
//   node gen-go-states.mjs --check         exit 1 (and say why) when the file is stale or missing
//   node gen-go-states.mjs --root DIR      use DIR instead of the repo root (tests)
// The Go dashboard cannot parse YAML (no dependency, by design), so this file is the only
// bridge: ids, labels, terminal flags, aliases and declared forward edges, in registry order.
// Aliases are carried for tests and tooling; NormalizeStatus keeps its own matcher (it also
// does substring and Turkish matching the registry does not model).
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { loadMachine } from './lib/state-machine.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const OUT_REL = 'dashboard/internal/data/states_gen.go';

const q = s => JSON.stringify(String(s)); // Go string literal syntax is a superset-compatible for these values
const strs = list => `[]string{${list.map(q).join(', ')}}`;

/** The generated Go source (LF endings, trailing newline). `machine` is loadMachine('application-status'). */
export function renderGo(machine) {
  const rows = machine.states.map(s =>
    `\t{ID: ${q(s.id)}, Label: ${q(s.label)}, Terminal: ${s.terminal}, Aliases: ${strs(s.aliases)}, Next: ${strs(machine.transitions[s.id] ?? [])}},`);
  return [
    '// GENERATED — do not edit. Source: templates/states.yml. Regenerate: node gen-go-states.mjs',
    '// A stale copy fails tests/go-states.test.mjs and `node gen-go-states.mjs --check`.',
    '',
    'package data',
    '',
    '// >>> machine:application-status:go:begin (generated from templates/states.yml by gen-go-states.mjs -- do not edit by hand)',
    '',
    '// State is one application status of the registry.',
    'type State struct {',
    '\tID       string   // canonical lower-case id, as NormalizeStatus returns it',
    '\tLabel    string   // exact spelling written to applications.md',
    '\tTerminal bool     // leaving it needs an explicit override (set-status --force)',
    '\tAliases  []string // registry aliases (lower case)',
    '\tNext     []string // declared forward edges (ids)',
    '}',
    '',
    '// InitialStateID is the state a new application starts in.',
    `const InitialStateID = ${q(machine.initial)}`,
    '',
    '// States lists every status in registry order.',
    'var States = []State{',
    ...rows,
    '}',
    '',
    '// <<< machine:application-status:go:end',
    '',
  ].join('\n');
}

const normalize = text => text.replace(/\r\n/g, '\n');

function main(argv) {
  const rootIdx = argv.indexOf('--root');
  const root = rootIdx >= 0 ? argv[rootIdx + 1] : HERE;
  const want = renderGo(loadMachine('application-status', { root }));
  const target = join(root, OUT_REL);
  const have = existsSync(target) ? normalize(readFileSync(target, 'utf-8')) : null;
  if (argv.includes('--check')) {
    if (have === want) return 0;
    console.error(`gen-go-states: ${OUT_REL} is ${have === null ? 'missing' : 'stale vs templates/states.yml'}. Run: node gen-go-states.mjs`);
    return 1;
  }
  if (have !== want) writeFileSync(target, want);
  return 0;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  process.exitCode = main(process.argv.slice(2));
}
