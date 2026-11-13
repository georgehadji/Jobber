// tests/notion-single-query.test.mjs — the Notion export lists the Applications DB ONCE per run
// (STATE-MACHINES-PLAN follow-up to the Notion upsert lock). It used to query the whole DB for every
// tracker row, so N rows cost N full paginated reads. Matching is now in memory, and a page created
// during the run joins that list, so a repeated company+role in the tracker updates it, not duplicates it.
// Mock fetch, no network. Each case has a control that shows the fixture can fail.
import { pass, fail } from './helpers.mjs';
import notion from '../plugins/notion/index.mjs';

console.log('\nnotion plugin: export reads the database once per run');

const eq = (label, got, want) => (JSON.stringify(got) === JSON.stringify(want) ? pass(label) : fail(`${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`));
const row = (id, company, role) => ({ id, properties: { Company: { rich_text: [{ plain_text: company }] }, Role: { title: [{ plain_text: role }] } } });
const uniq = () => `ds${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function mockNotion(ds, initial = [], pageSize = 100) {
  const db = [...initial];
  const log = { queries: 0, creates: 0, patches: [] };
  const fetch = async (url, opts) => {
    const path = url.replace('https://api.notion.com/v1/', '');
    const json = (d) => ({ ok: true, json: async () => d });
    if (path.startsWith('blocks/')) return json({ results: [{ type: 'child_database', id: 'db1', child_database: { title: 'Applications' } }], has_more: false });
    if (path === 'databases/db1') return json({ data_sources: [{ id: ds }] });
    if (path === `data_sources/${ds}/query`) {
      log.queries++;
      const start = Number(JSON.parse(opts.body).start_cursor ?? 0);
      const next = start + pageSize;
      return json({ results: db.slice(start, next), has_more: next < db.length, next_cursor: String(next) });
    }
    if (path === 'pages') {
      const p = JSON.parse(opts.body).properties;
      log.creates++;
      db.push(row(`new${log.creates}`, p.Company.rich_text[0].text.content, p.Role.title[0].text.content));
      return json({ id: `new${log.creates}` });
    }
    const m = path.match(/^pages\/(.+)$/);
    if (m && opts.method === 'PATCH') { log.patches.push(m[1]); return json({ id: m[1] }); }
    throw new Error(`unexpected request ${opts?.method} ${path}`);
  };
  return { fetch, log };
}
const ctxFor = (fetch, extra = {}) => ({ env: { NOTION_ACCESS_TOKEN: 't', NOTION_PARENT_PAGE_ID: 'parent' }, fetch, log: () => {}, dryRun: false, ...extra });
const app = (company, role) => ({ company, role, status: 'Applied', score: '4.0/5' });

// ── 1. N rows, one read ────────────────────────────────────────────────────
try {
  const m = mockNotion(uniq(), [row('e1', 'Acme', 'Engineer'), row('e2', 'Beta', 'Analyst')]);
  const snap = { applications: [app('Acme', 'Engineer'), app('Beta', 'Analyst'), app('Gamma', 'Lead')] };
  const r = await notion.export(snap, ctxFor(m.fetch));
  eq('3 rows -> the database is read once; 2 existing updated, 1 created', [m.log.queries, m.log.patches.sort(), m.log.creates, r.pushed], [1, ['e1', 'e2'], 1, 3]);

  // control: with a page size of 1 the read paginates, so "queries" counts pages, and the count moves. The single-read claim is real
  const m2 = mockNotion(uniq(), [row('e1', 'Acme', 'Engineer'), row('e2', 'Beta', 'Analyst')], 1);
  await notion.export({ applications: [app('Acme', 'Engineer'), app('Beta', 'Analyst'), app('Gamma', 'Lead')] }, ctxFor(m2.fetch));
  eq('control: a 2-page database costs 2 queries for the whole run (pagination, not one per row)', m2.log.queries, 2);
} catch (e) { fail(`single-read case threw: ${e.message}`); }

// ── 2. a repeated company+role in one tracker snapshot ─────────────────────
try {
  const m = mockNotion(uniq());
  const r = await notion.export({ applications: [app('Acme', 'Engineer'), app('acme', 'ENGINEER')] }, ctxFor(m.fetch));
  eq('the same company+role twice in the tracker: created once, then updated (the new page is in the in-memory list)', [m.log.creates, m.log.patches, m.log.queries, r.pushed], [1, ['new1'], 1, 2]);
  // control: two different roles are two creates, so the single create above is the match, not a blanket skip
  const m2 = mockNotion(uniq());
  await notion.export({ applications: [app('Acme', 'Engineer'), app('Acme', 'Designer')] }, ctxFor(m2.fetch));
  eq('control: two different roles are two creates and no update', [m2.log.creates, m2.log.patches.length], [2, 0]);
} catch (e) { fail(`repeat case threw: ${e.message}`); }

// ── 3. a dry run never reads Notion rows ───────────────────────────────────
try {
  const m = mockNotion(uniq(), [row('e1', 'Acme', 'Engineer')]);
  const r = await notion.export({ applications: [app('Acme', 'Engineer')] }, ctxFor(m.fetch, { dryRun: true }));
  eq('dry run: no query, no write', [m.log.queries, m.log.creates, m.log.patches.length, r.pushed], [0, 0, 0, 1]);
} catch (e) { fail(`dry-run case threw: ${e.message}`); }
