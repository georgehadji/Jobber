#!/usr/bin/env node
// gen-machine-docs.mjs — regenerate the state-machine blocks embedded in Markdown files.
//   node gen-machine-docs.mjs                   rewrite stale blocks in place
//   node gen-machine-docs.mjs --check           write nothing; exit 1 and name each stale block
//   node gen-machine-docs.mjs [--check] FILE... only these files (relative to --root or the cwd)
//   node gen-machine-docs.mjs --root DIR        use DIR as the repo root (tests)
// A block is the text between `<!-- machine:<id>[:<view>] begin -->` and the matching `end` marker;
// content comes from lib/state-machine.mjs describe(). Views: see VIEWS in lib/machine-blocks.mjs.
// Only the text between markers is rewritten; the file's line endings are preserved.
// Default scan: root *.md, modes/**/*.md, docs/*.md (only files that contain a marker are touched).
// Exit: 0 fresh/written, 1 stale (--check), 2 usage or marker/machine error (nothing written for that file).
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join, dirname, resolve, relative } from 'path';
import { fileURLToPath } from 'url';
import { loadMachine, describe } from './lib/state-machine.mjs';
import { regenerate, hasMarkers, MarkerError } from './lib/machine-blocks.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

function walkMd(dir, recurse) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) { if (recurse && e.name !== 'node_modules') out.push(...walkMd(full, true)); }
    else if (e.name.endsWith('.md')) out.push(full);
  }
  return out;
}

/** Files a default run looks at (sorted, absolute). */
export function defaultTargets(root) {
  return [...walkMd(root, false), ...walkMd(join(root, 'modes'), true), ...walkMd(join(root, 'docs'), false)].sort();
}

/**
 * Process one file. Never writes when `check` is true. Throws MarkerError (message prefixed
 * with the file) on a bad marker; nothing is written in that case.
 * @returns {{file:string, stale:{id:string,view:string,line:number}[], blocks:number, wrote:boolean}}
 */
export function processFile(file, { root = HERE, check = false } = {}) {
  const rel = relative(root, file).replace(/\\/g, '/');
  const text = readFileSync(file, 'utf-8');
  if (!hasMarkers(text)) return { file: rel, stale: [], blocks: 0, wrote: false };
  let res;
  try { res = regenerate(text, id => describe(loadMachine(id, { root }))); } catch (e) {
    throw new MarkerError(`${rel}: ${e.message}`);
  }
  const stale = res.blocks.filter(b => b.stale).map(({ id, view, line }) => ({ id, view, line }));
  let wrote = false;
  if (!check && res.text !== text) { writeFileSync(file, res.text); wrote = true; }
  return { file: rel, stale, blocks: res.blocks.length, wrote };
}

function main(argv) {
  const check = argv.includes('--check');
  const rootIdx = argv.indexOf('--root');
  const root = rootIdx !== -1 ? resolve(argv[rootIdx + 1] ?? '') : HERE;
  const files = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--root');
  const unknown = argv.filter(a => a.startsWith('--') && !['--check', '--root'].includes(a));
  if (unknown.length || (rootIdx !== -1 && (!argv[rootIdx + 1] || !existsSync(root)))) {
    console.error(`Usage: node gen-machine-docs.mjs [--check] [--root DIR] [FILE...]${unknown.length ? `\nUnknown flag ${unknown[0]}` : '\n--root needs an existing directory'}`);
    return 2;
  }
  const targets = files.length ? files.map(f => resolve(root, f)) : defaultTargets(root);
  let staleCount = 0, errors = 0, blocks = 0, written = 0;
  for (const f of targets) {
    if (!existsSync(f) || !statSync(f).isFile()) { console.error(`${f}: no such file`); errors++; continue; }
    try {
      const r = processFile(f, { root, check });
      blocks += r.blocks;
      if (r.wrote) { written++; console.log(`updated ${r.file}: ${r.stale.map(b => `machine:${b.id}:${b.view}`).join(', ')}`); }
      for (const b of check ? r.stale : []) { staleCount++; console.error(`stale: ${r.file}:${b.line} machine:${b.id}:${b.view} — run: node gen-machine-docs.mjs`); }
    } catch (e) {
      errors++;
      console.error(e instanceof MarkerError ? `error: ${e.message}` : `error: ${f}: ${e.message}`);
    }
  }
  if (errors) return 2;
  if (check && staleCount) return 1;
  console.log(check ? `machine blocks fresh (${blocks} block${blocks === 1 ? '' : 's'})` : `machine blocks up to date (${blocks} block${blocks === 1 ? '' : 's'}, ${written} file${written === 1 ? '' : 's'} rewritten)`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
