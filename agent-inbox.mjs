#!/usr/bin/env node

/**
 * agent-inbox.mjs — a tiny bridge between *looking at* the pipeline and
 * *acting on* it.
 *
 * Jobber is driven from an AI session, but there's no durable place to drop
 * a request when you're not in one — e.g. while glancing at the tracker (or a
 * dashboard) you think "evaluate this URL" or "draft a follow-up for #7". This
 * is that place: an append-only queue the agent drains at the start of a
 * session.
 *
 *   data/agent-inbox.md
 *     - [ ] <stamp> — <request>          (pending)
 *     - [x] <stamp> — <request> → result: <one line>   (resolved)
 *
 * Fully local-first and human-in-the-loop: nothing here auto-submits. Queued
 * items are *intents* for the agent to action and the user to review. Markdown
 * checklist, no database, no server, no dependencies — edit it by hand or via
 * this CLI, and any tool (a dashboard, a script, cron) can append to it. The
 * protocol an agent follows is documented in modes/agent-inbox.md.
 *
 * Usage:
 *   node agent-inbox.mjs add "evaluate https://acme.com/jobs/42"
 *   node agent-inbox.mjs list [--all]                 # pending only, or every item
 *   node agent-inbox.mjs resolve 1 [--result "scored 4.3 — report 012"]
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, rmSync } from 'fs';
import { dirname, basename, join } from 'path';
import { randomUUID } from 'crypto';
import { acquireLockSync } from './lib/file-lock.mjs';

const PATH = process.env.JOBBER_INBOX || 'data/agent-inbox.md';

// --capabilities contract (T4): machine-readable flag list for
// validate-mode-invocations.mjs — exits 0 with JSON, no inbox operations.
if (process.argv.includes('--capabilities')) {
  console.log(JSON.stringify({
    script: 'agent-inbox.mjs', version: 1,
    flags: ['list', 'resolve', '--all', '--result', '--help'],
    description: 'Append-only agent request queue',
  }));
  process.exit(0);
}

const HEADER = [
  '# Agent Inbox',
  '',
  '> **Agent protocol:** at the start of a Jobber session, read this file.',
  '> Run each unchecked item top-to-bottom. After each, mark it `[x]` and append',
  '> `→ result: <one line>`. Items that need live user input (a mock, a paste, a',
  '> decision) → ask the user to start them instead of running them.',
  '>',
  '> Nothing here auto-submits — queued items are *intents* for you to action and',
  '> the user to review. Appended by hand, by a dashboard, or by agent-inbox.mjs.',
  '',
].join('\n');

function stamp() {
  return new Date().toISOString().slice(0, 16).replace('T', ' ');
}

function ensureGitignored() {
  // The inbox is personal data. On installs whose .gitignore predates this
  // feature, make sure the default path is ignored so a first `add` can't
  // accidentally commit it. Only manages the default, non-overridden path.
  if (process.env.JOBBER_INBOX || PATH !== 'data/agent-inbox.md') return;
  try {
    if (!existsSync('.gitignore')) return; // not a git checkout we should touch
    const text = readFileSync('.gitignore', 'utf8');
    if (text.split('\n').some((l) => l.trim() === PATH)) return; // already ignored
    writeFileSync('.gitignore', text.replace(/\s*$/, '') + `\n${PATH}\n`);
  } catch { /* best effort — never block queuing on this */ }
}

function oneLine(s) {
  // markdown-checklist-safe: collapse to a single bullet line
  return String(s ?? '').replace(/\s*\n\s*/g, ' ').trim();
}

// tmp + rename, so a crash never leaves a truncated inbox (same recipe as lib/pipeline-inbox.mjs).
function writeAtomic(content) {
  const tmp = join(dirname(PATH), `.${basename(PATH)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    writeFileSync(tmp, content);
    renameSync(tmp, PATH);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}

// Shared advisory lock around a read-modify-write. fn must not call fail()/exit:
// return a message instead and let the caller fail after the lock is released.
function locked(fn) {
  mkdirSync(dirname(PATH), { recursive: true });
  const lock = acquireLockSync(PATH, { kind: 'agent-inbox', staleMs: 30_000 });
  try { return fn(); } finally { lock.release(); }
}

function ensureFile() {
  if (existsSync(PATH)) return;
  ensureGitignored();
  mkdirSync(dirname(PATH), { recursive: true });
  writeAtomic(HEADER);
}

// Parse the checklist into items, in file order.
function parseItems() {
  if (!existsSync(PATH)) return [];
  const items = [];
  readFileSync(PATH, 'utf8').split('\n').forEach((line, i) => {
    const m = /^- \[([ xX])\]\s*(.*)$/.exec(line.trim());
    if (m) items.push({ line: i, done: m[1].toLowerCase() === 'x', text: m[2] });
  });
  return items;
}

function opt(name, def = '') {
  const i = process.argv.indexOf('--' + name);
  if (i < 0) return def;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : def;
}

function add() {
  const text = oneLine(process.argv.slice(3).join(' '));
  if (!text) fail('add needs a request, e.g. node agent-inbox.mjs add "evaluate https://..."');
  locked(() => {
    ensureFile();
    const body = readFileSync(PATH, 'utf8').replace(/\s+$/, '');
    writeAtomic(`${body}\n- [ ] ${stamp()} — ${text}\n`);
  });
  process.stdout.write(`Queued: ${text}\n`);
}

function list() {
  const all = process.argv.includes('--all');
  const items = parseItems().filter((it) => all || !it.done);
  if (!items.length) return process.stdout.write(all ? 'Inbox is empty.\n' : 'No pending items.\n');
  items.forEach((it, n) => {
    process.stdout.write(`${String(n + 1).padStart(2)}. [${it.done ? 'x' : ' '}] ${it.text}\n`);
  });
}

function resolve() {
  const n = Number(process.argv[3]);
  if (!Number.isInteger(n) || n < 1) fail('resolve needs a 1-based item number (see `list`)');
  const result = oneLine(opt('result'));
  const out = existsSync(PATH) ? locked(() => {
    // Number against the pending view, so `list` then `resolve N` line up.
    const pending = parseItems().filter((it) => !it.done);
    const target = pending[n - 1];
    if (!target) return { err: `no pending item #${n} (${pending.length} pending)` };
    const lines = readFileSync(PATH, 'utf8').split('\n');
    let updated = lines[target.line].replace('[ ]', '[x]');
    if (result && !/→ result:/.test(updated)) updated += ` → result: ${result}`;
    lines[target.line] = updated;
    writeAtomic(lines.join('\n'));
    return { text: target.text };
  }) : { err: `no pending item #${n} (0 pending)` };
  if (out.err) fail(out.err);
  process.stdout.write(`Resolved #${n}: ${out.text}\n`);
}

function fail(msg) {
  process.stderr.write(`agent-inbox.mjs: ${msg}\n`);
  process.exit(1);
}

const cmd = process.argv[2];
if (cmd === 'add') add();
else if (cmd === 'list') list();
else if (cmd === 'resolve') resolve();
else {
  process.stdout.write(
    'Usage:\n' +
    '  node agent-inbox.mjs add "evaluate https://acme.com/jobs/42"\n' +
    '  node agent-inbox.mjs list [--all]\n' +
    '  node agent-inbox.mjs resolve <n> [--result "..."]\n',
  );
}
