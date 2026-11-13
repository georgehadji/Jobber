// tests/notion-status.test.mjs — the Notion plugin resolves tracker statuses through the registry
// (STATE-MACHINES-PLAN M30) and never sends an unknown one silently.
//   - canonicalStatus: exact label/alias, **bold**, dated cell, extra spellings -> label; junk -> null
//   - export (mock fetch, no network): a known status is pushed as a select; an unknown one is pushed
//     WITHOUT a Status property, logged with the row, and reported in the result
import { pass, fail } from './helpers.mjs';
import notion from '../plugins/notion/index.mjs';
import { canonicalStatus, statusLabels } from '../plugins/notion/_notion.mjs';

console.log('\nnotion plugin: status canonicalisation through the registry');

// [raw, expected label or null]
const CASES = [
  ['Applied', 'Applied'], ['applied', 'Applied'], ['**Interview**', 'Interview'], ['aplicado', 'Applied'],
  ['Rejected 2026-02-01', 'Rejected'], ['Hired 2026-03-01', 'Hired'],
  ['condicional', 'Evaluated'], ['hold', 'Evaluated'], ['geo blocker', 'SKIP'],
  ['xyzzy', null], ['', null], [undefined, null], ['Rejected geo blocker', null],
];
const bad = CASES.filter(([raw, want]) => canonicalStatus(raw) !== want).map(([raw, want]) => `${JSON.stringify(raw)} -> ${JSON.stringify(canonicalStatus(raw))} (want ${JSON.stringify(want)})`);
if (bad.length) fail(`canonicalStatus: ${bad.join('; ')}`); else pass(`canonicalStatus: ${CASES.length} spellings resolve as expected (known, dated, bold, extra, junk)`);

const labels = statusLabels();
if (labels.includes('Evaluated') && labels.includes('Hired') && labels.length >= 9) pass('statusLabels comes from the registry'); else fail(`statusLabels: ${JSON.stringify(labels)}`);

// ── export with a mock Notion ───────────────────────────────────────────────
const writes = [];
const mockFetch = async (url, opts) => {
  const path = url.replace('https://api.notion.com/v1/', '');
  const body = opts?.body ? JSON.parse(opts.body) : null;
  const json = d => ({ ok: true, json: async () => d });
  if (path.startsWith('blocks/')) return json({ results: [{ type: 'child_database', id: 'db1', child_database: { title: 'Applications' } }], has_more: false });
  if (path === 'databases/db1') return json({ data_sources: [{ id: 'ds1' }] });
  if (path === 'data_sources/ds1/query') return json({ results: [], has_more: false });
  if (path === 'pages') { writes.push(body.properties); return json({ id: 'p' }); }
  throw new Error(`unexpected request ${path}`);
};
const logs = [];
const ctx = { env: { NOTION_ACCESS_TOKEN: 't', NOTION_PARENT_PAGE_ID: 'parent' }, fetch: mockFetch, log: m => logs.push(m), dryRun: false };
const snapshot = { applications: [
  { company: 'Acme', role: 'Engineer', status: 'Rejected 2026-02-01', score: '4.2/5' },
  { company: 'Beta', role: 'Analyst', status: 'xyzzy', score: '3.0/5' },
  { company: 'Gamma', role: 'Lead', status: '', score: '4.0/5' },
] };

let res = null;
try { res = await notion.export(snapshot, ctx); } catch (e) { fail(`export with mock fetch threw: ${e.message}`); }
if (res) {
  const problems = [];
  if (res.pushed !== 3) problems.push(`pushed ${res.pushed} (want 3)`);
  if (writes[0]?.Status?.select?.name !== 'Rejected') problems.push(`dated cell sent as ${JSON.stringify(writes[0]?.Status)} (want select Rejected)`);
  if (writes[1] && 'Status' in writes[1]) problems.push('unknown status must not be sent');
  if (writes[2] && 'Status' in writes[2]) problems.push('blank status must not be sent');
  if (JSON.stringify(res.unknownStatuses) !== JSON.stringify(['xyzzy'])) problems.push(`unknownStatuses ${JSON.stringify(res.unknownStatuses)} (want ["xyzzy"], blank is not a warning)`);
  const warns = logs.filter(l => /unknown status/.test(l));
  if (warns.length !== 1 || !warns[0].includes('Beta') || !warns[0].includes('xyzzy')) problems.push(`log warnings ${JSON.stringify(warns)}`);
  if (problems.length) fail(`export: ${problems.join('; ')}`); else pass('export: known status sent, unknown/blank omitted, unknown warned once and reported');
}
