#!/usr/bin/env node
// batch/gen-states.mjs — (re)generate the batch-job state tables inside batch/batch-runner.sh
// from templates/machines/batch-job.yml. The runner is a self-contained bash script (it is
// copied around on its own), so the generated block lives between marker lines in the script
// itself instead of a separate sourced file; bash then validates a state with a `case`
// match and never spawns node per update_state call.
//   node batch/gen-states.mjs           rewrite the block in place
//   node batch/gen-states.mjs --check   exit 1 (and say why) when the block is stale
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { loadMachine } from '../lib/state-machine.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const BEGIN = '# >>> machine:batch-job:begin (generated from templates/machines/batch-job.yml by batch/gen-states.mjs -- do not edit by hand)';
export const END = '# <<< machine:batch-job:end';

/** The generated bash block (LF line endings, no trailing newline). */
export function renderBlock(machine) {
  const ids = machine.states.map(s => s.id);
  const edges = ids
    .filter(id => (machine.transitions[id] ?? []).length > 0)
    .map(id => `    ${machine.transitions[id].map(t => `${id}:${t}`).join('|')}) return 0 ;;`);
  return [
    BEGIN,
    `BATCH_STATES="${ids.join(' ')}"`,
    'batch_state_is_legal() {',
    '  case "$1" in',
    `    ${ids.join('|')}) return 0 ;;`,
    '    *) return 1 ;;',
    '  esac',
    '}',
    '# A self-move is a no-op and always fine; any other pair must be a declared edge.',
    'batch_transition_is_declared() {',
    '  [[ "$1" == "$2" ]] && return 0',
    '  case "$1:$2" in',
    ...edges,
    '    *) return 1 ;;',
    '  esac',
    '}',
    END,
  ].join('\n');
}

/** Replace the marked block in `source` (any EOL). Returns {text, found}; EOL style is preserved. */
export function applyBlock(source, block) {
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const lf = source.replace(/\r\n/g, '\n');
  const start = lf.indexOf('# >>> machine:batch-job:begin');
  const endMarker = lf.indexOf(END);
  if (start === -1 || endMarker === -1 || endMarker < start) return { found: false, text: source };
  const next = lf.slice(0, start) + block + lf.slice(endMarker + END.length);
  return { found: true, text: eol === '\n' ? next : next.replace(/\n/g, '\r\n') };
}

function main() {
  const runner = join(ROOT, 'batch', 'batch-runner.sh');
  const source = readFileSync(runner, 'utf-8');
  const { found, text } = applyBlock(source, renderBlock(loadMachine('batch-job', { root: ROOT })));
  if (!found) { console.error('gen-states: marker lines not found in batch/batch-runner.sh'); return 2; }
  if (process.argv.includes('--check')) {
    if (text === source) return 0;
    console.error('gen-states: batch/batch-runner.sh state tables are stale vs templates/machines/batch-job.yml. Run: node batch/gen-states.mjs');
    return 1;
  }
  if (text !== source) writeFileSync(runner, text);
  return 0;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  process.exitCode = main();
}
