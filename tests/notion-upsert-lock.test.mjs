// tests/notion-upsert-lock.test.mjs — the Notion export upsert (STATE-MACHINES-PLAN follow-up to M30).
//   1. find-then-create is serialised per Applications DB: two exports at once create the row ONCE and
//      the second one updates it (before: both missed the row and created it twice).
//   2. several rows for the same company+role are ALL updated (before: only dupes[0], an arbitrary
//      one, so a different stale copy was left each run), with one warning; a near-match is untouched.
// Mock fetch, no network. Each case has a control that shows the fixture can fail.
import { pass, fail } from './helpers.mjs';
import { existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import notion from '../plugins/notion/index.mjs';

console.log('\nnotion plugin: export upsert is serialised and updates every duplicate');

const eq = (label, got, want) => (JSON.stringify(got) === JSON.stringify(want) ? pass(label) : fail(`${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`));
const row = (id, company, role) => ({ id, properties: { Company: { rich_text: [{ plain_text: company }] }, Role: { title: [{ plain_text: role }] } } });

/** A stateful mock Notion: pages created become query results, so a second export can see them. */
function mockNotion(ds, initial = []) {
  const db = [...initial];
  const log = { creates: 0, patches: [], lockSeenDuringWrite: [] };
  const lockDir = join(tmpdir(), `jobber-notion-${ds}.lock`);
  const fetch = async (url, opts) => {
    const path = url.replace('https://api.notion.com/v1/', '');
    const json = (d) => ({ ok: true, json: async () => d });
    if (path.startsWith('blocks/')) return json({ results: [{ type: 'child_database', id: 'db1', child_database: { title: 'Applications' } }], has_more: false });
    if (path === 'databases/db1') return json({ data_sources: [{ id: ds }] });
    if (path === `data_sources/${ds}/query`) { await new Promise((r) => setTimeout(r, 30)); return json({ results: [...db], has_more: false }); }
    if (path === 'pages') {
      const p = JSON.parse(opts.body).properties;
      log.lockSeenDuringWrite.push(existsSync(lockDir));
      await new Promise((r) => setTimeout(r, 30)); // widen the window between "not found" and "created"
      log.creates++;
      db.push(row(`new${log.creates}`, p.Company.rich_text[0].text.content, p.Role.title[0].text.content));
      return json({ id: `new${log.creates}` });
    }
    const m = path.match(/^pages\/(.+)$/);
    if (m && opts.method === 'PATCH') { log.patches.push(m[1]); log.lockSeenDuringWrite.push(existsSync(lockDir)); return json({ id: m[1] }); }
    throw new Error(`unexpected request ${opts?.method} ${path}`);
  };
  return { fetch, log, lockDir };
}
const ctxFor = (fetch, extra = {}) => ({ env: { NOTION_ACCESS_TOKEN: 't', NOTION_PARENT_PAGE_ID: 'parent' }, fetch, log: () => {}, dryRun: false, ...extra });
const snap = { applications: [{ company: 'Acme', role: 'Engineer', status: 'Applied', score: '4.0/5' }] };
const uniq = () => `ds${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// ── 1. two exports at once ─────────────────────────────────────────────────
try {
  const ds = uniq();
  const m = mockNotion(ds);
  const [a, b] = await Promise.all([notion.export(snap, ctxFor(m.fetch)), notion.export(snap, ctxFor(m.fetch))]);
  eq('two concurrent exports: the row is created once and updated once (no duplicate)', [m.log.creates, m.log.patches.length], [1, 1]);
  eq('both exports report the row as pushed', [a.pushed, b.pushed], [1, 1]);
  eq('the advisory lock is held while writing', m.log.lockSeenDuringWrite.every(Boolean) && m.log.lockSeenDuringWrite.length === 2, true);
  eq('the lock is released afterwards (a third export is not blocked)', existsSync(m.lockDir), false);
  // control: the fixture really does see a row as soon as one exists, so a second sequential export updates it
  const m2 = mockNotion(uniq());
  await notion.export(snap, ctxFor(m2.fetch));
  await notion.export(snap, ctxFor(m2.fetch));
  eq('control: two SEQUENTIAL exports also give one create + one update (fixture state is real)', [m2.log.creates, m2.log.patches.length], [1, 1]);
} catch (e) { fail(`concurrent export case threw: ${e.message}`); }

// ── control: a dry run writes nothing and takes no lock ────────────────────
try {
  const ds = uniq();
  const m = mockNotion(ds);
  const r = await notion.export(snap, ctxFor(m.fetch, { dryRun: true, log: () => {} }));
  eq('control: dry run pushes nothing and leaves no lock behind', [r.pushed, m.log.creates, m.log.patches.length, existsSync(m.lockDir)], [1, 0, 0, false]);
} catch (e) { fail(`dry-run control threw: ${e.message}`); }

// ── 2. duplicates ──────────────────────────────────────────────────────────
try {
  const ds = uniq();
  const logs = [];
  const m = mockNotion(ds, [row('d1', 'Acme', 'Engineer'), row('d2', 'acme', 'ENGINEER'), row('n1', 'Acme', 'Engineer Lead')]);
  const r = await notion.export(snap, ctxFor(m.fetch, { log: (l) => logs.push(l) }));
  eq('duplicates: every exact company+role row is updated, the near-match is not, nothing is created', [m.log.patches.sort(), m.log.creates, r.pushed], [['d1', 'd2'], 0, 1]);
  eq('duplicates: one warning names the count', logs.filter((l) => /2 duplicate Notion rows/.test(l)).length, 1);
  const ds1 = uniq();
  const one = mockNotion(ds1, [row('s1', 'Acme', 'Engineer')]);
  const logs1 = [];
  await notion.export(snap, ctxFor(one.fetch, { log: (l) => logs1.push(l) }));
  eq('control: a single existing row is updated once, with no duplicate warning', [one.log.patches, one.log.creates, logs1.filter((l) => /duplicate/.test(l)).length], [['s1'], 0, 0]);
} catch (e) { fail(`duplicate case threw: ${e.message}`); }
