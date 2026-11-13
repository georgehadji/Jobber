// tests/openrouter-evaluate-e2e.test.mjs — cmdEvaluate end to end (STATE-MACHINES-PLAN follow-up to the cmdPipeline seam).
// The runner takes a fake model call, a fake page fetch and a temp project root, so no live API is hit and
// nothing lands in the real reports/ or batch/. The REAL report-number allocator and file writers run, so
// this pins what a user gets: a numbered report with URL + Legitimacy headers, a tracker-additions TSV in the
// documented 9-column shape (status Evaluated), and the reservation released afterwards.
import { pass, fail } from './helpers.mjs';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { cmdEvaluate } from '../openrouter-runner.mjs';

console.log('\nopenrouter-runner cmdEvaluate: end to end with a fake model');

const eq = (label, got, want) => (JSON.stringify(got) === JSON.stringify(want) ? pass(label) : fail(`${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`));
const quiet = async (fn) => {
  const log = console.log, err = console.error, out = process.stdout.write.bind(process.stdout);
  console.log = () => {}; console.error = () => {}; process.stdout.write = () => true;
  try { return await fn(); } finally { console.log = log; console.error = err; process.stdout.write = out; }
};
const newRoot = () => { const r = mkdtempSync(join(tmpdir(), 'or-eval-')); mkdirSync(join(r, 'reports')); mkdirSync(join(r, 'modes')); return r; };
const ctx = { cv: 'cv', profile: '', shared: '', profileMode: '' };
const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 };
const URL = 'https://jobs.example/acme/123';
const roots = [];
const root = () => { const r = newRoot(); roots.push(r); return r; };

try {
  // success: URL input -> fetched page -> model -> report + tracker TSV
  const r1 = root();
  const prompts = [];
  const call = async (sys, user) => { prompts.push(user); return { content: 'Role at Acme\n**Legitimacy:** High Confidence\nScore: 4.2/5\n', usage }; };
  const fetchPage = async (u) => `page text for ${u}`;
  const rel = await quiet(() => cmdEvaluate(URL, ctx, { call, fetchPage, rootDir: r1 }));
  const today = new Date().toISOString().split('T')[0];
  eq('returns the relative report path (numbered, slugged, dated)', rel, `reports/001-acme-${today}.md`);
  eq('the fetched page, not the bare URL, is what the model sees', prompts[0].includes('page text for ' + URL), true);
  const report = readFileSync(join(r1, rel), 'utf8');
  eq('report header carries the URL then the model Legitimacy tier', report.split('\n').slice(0, 2), [`**URL:** ${URL}`, '**Legitimacy:** High Confidence']);
  const tsvName = readdirSync(join(r1, 'batch', 'tracker-additions'))[0];
  const row = readFileSync(join(r1, 'batch', 'tracker-additions', tsvName), 'utf8').split('\n')[1].split('\t');
  eq('tracker TSV: status Evaluated, score 4.2/5, root-relative report link', [row.length, row[4], row[5], row[7]], [9, 'Evaluated', '4.2/5', `[001](reports/001-acme-${today}.md)`]);
  eq('the report-number reservation is released: only the report remains, no -RESERVED sentinel', readdirSync(join(r1, 'reports')), [`001-acme-${today}.md`]);

  // control: a model reply with no Legitimacy line falls back to unconfirmed, so the High line above came from the model
  const r2 = root();
  const rel2 = await quiet(() => cmdEvaluate(URL, ctx, { call: async () => ({ content: 'Role at Acme\nScore: 3.0/5', usage }), fetchPage, rootDir: r2 }));
  eq('control: no Legitimacy in the reply -> unconfirmed', readFileSync(join(r2, rel2), 'utf8').split('\n')[1], '**Legitimacy:** unconfirmed');

  // failure: a model error returns null and writes nothing
  const r3 = root();
  const out3 = await quiet(() => cmdEvaluate(URL, ctx, { call: async () => { throw new Error('boom'); }, fetchPage, rootDir: r3 }));
  eq('a model error returns null and writes no report or TSV', [out3, readdirSync(join(r3, 'reports')), existsSync(join(r3, 'batch'))], [null, [], false]);

  // failure: a page fetch error returns null before the model is called
  const r4 = root();
  let modelCalled = 0;
  const out4 = await quiet(() => cmdEvaluate(URL, ctx, { call: async () => { modelCalled++; return { content: 'x', usage }; }, fetchPage: async () => { throw new Error('fetch failed'); }, rootDir: r4 }));
  eq('a fetch error returns null and never calls the model', [out4, modelCalled], [null, 0]);

  // numbering: a second run in the same root takes the next number (the real allocator is in play)
  const rel5 = await quiet(() => cmdEvaluate(URL, ctx, { call, fetchPage, rootDir: r1 }));
  eq('the next evaluation in the same root gets the next number', rel5.startsWith('reports/002-'), true);
} catch (e) {
  fail(`cmdEvaluate end-to-end threw: ${e.message}`);
} finally {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
}
