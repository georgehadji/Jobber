// tests/scan-posting-history.test.mjs — external posting-history evidence
// (docs/FREEHIRE-INTEGRATION-PLAN.md Phase 2): Job.postingHistory /
// Job.externalRef persist to scan-history cols 12-16 and a labeled
// `history:` pipeline segment, without disturbing any existing column.
import { pass, fail, ROOT } from './helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nScan — external posting history (cols 12-16, history: segment)');

try {
  const {
    formatScanHistoryRow, formatPipelineOffer, formatHistorySegment, validPostingHistory, SCAN_HISTORY_HEADER,
  } = await import(pathToFileURL(join(ROOT, 'scan.mjs')).href);

  const base = { url: 'https://jobs.example/1', source: 'freehire', title: 'Platform Engineer', company: 'Tomra', location: 'Berlin' };
  const withHistory = {
    ...base,
    externalRef: { source: 'freehire', id: 'platform-engineer-tomra-oujimwaz' },
    postingHistory: { source: 'freehire', ageDays: 74, repostCount: 3, concurrentCount: 2, fakeFreshness: true },
  };

  // Header names every column the row writer emits.
  const headerCols = SCAN_HISTORY_HEADER.split('\t');
  const plainCols = formatScanHistoryRow(base, '2026-10-21').split('\t');
  if (headerCols.length === 17 && plainCols.length === headerCols.length
      && headerCols.slice(12).join(',') === 'external_ref,ext_age_days,ext_repost_count,ext_concurrent_count,ext_fake_freshness') {
    pass('SCAN_HISTORY_HEADER names all 17 columns the row writer emits, new ones trailing');
  } else fail(`header/row width mismatch: header=${headerCols.length} row=${plainCols.length}`);

  if (plainCols.slice(12).every((c) => c === '')) pass('a provider with no postingHistory leaves cols 12-16 empty');
  else fail(`cols 12-16 without history = ${JSON.stringify(plainCols.slice(12))}`);

  const histCols = formatScanHistoryRow(withHistory, '2026-10-21').split('\t');
  if (histCols[12] === 'freehire:platform-engineer-tomra-oujimwaz' && histCols[13] === '74'
      && histCols[14] === '3' && histCols[15] === '2' && histCols[16] === '1') {
    pass('postingHistory + externalRef persist to cols 12-16');
  } else fail(`cols 12-16 = ${JSON.stringify(histCols.slice(12))}`);

  // Existing columns are byte-identical with or without the new fields.
  if (plainCols.slice(0, 12).join('\t') === histCols.slice(0, 12).join('\t')) {
    pass('cols 0-11 are unchanged by the new trailing columns');
  } else fail('adding postingHistory shifted an existing column');

  // Unknown counts stay empty, never 0.
  const partial = formatScanHistoryRow({ ...base, postingHistory: { ageDays: 5 } }, '2026-10-21').split('\t');
  if (partial[13] === '5' && partial[14] === '' && partial[15] === '' && partial[16] === '') {
    pass('unknown repost/concurrent counts stay empty (not 0)');
  } else fail(`partial history cols = ${JSON.stringify(partial.slice(12))}`);

  // Malformed evidence writes nothing.
  if (validPostingHistory({ postingHistory: { ageDays: -1 } }) === null
      && validPostingHistory({ postingHistory: 'old' }) === null
      && validPostingHistory({}) === null) {
    pass('validPostingHistory rejects a negative/missing age and non-object evidence');
  } else fail('validPostingHistory should reject malformed evidence');

  // Tab/newline injection through the external reference is neutralized.
  const hostile = formatScanHistoryRow({ ...base, externalRef: { source: 'freehire', id: 'a\tb\nc' } }, '2026-10-21').split('\t');
  if (hostile.length === 17) pass('a tab/newline inside externalRef cannot forge a column');
  else fail(`hostile externalRef produced ${hostile.length} columns`);

  // Pipeline segment: facts only, ordered after trust: and before note:.
  const seg = formatHistorySegment(withHistory);
  if (seg === 'history: open 74d, 3 postings, 2 concurrent, date restated (freehire)') pass('history: segment states the facts and their source');
  else fail(`history segment = ${JSON.stringify(seg)}`);
  if (!/ghost|risk|evergreen|fake/i.test(seg)) pass('history: segment carries no verdict word');
  else fail(`history segment uses a verdict word: ${seg}`);
  if (formatHistorySegment(base) === '') pass('no postingHistory → no history: segment');
  else fail('history segment should be empty without postingHistory');

  const line = formatPipelineOffer({ ...withHistory, postedAt: Date.parse('2026-10-01'), trustScore: 60, trustFlags: ['missing_apply_url'], note: 'curated' });
  const iPosted = line.indexOf('| posted:');
  const iTrust = line.indexOf('| trust:');
  const iHistory = line.indexOf('| history:');
  const iNote = line.indexOf('| note:');
  if (iPosted > 0 && iPosted < iTrust && iTrust < iHistory && iHistory < iNote) pass('pipeline segment order is posted: → trust: → history: → note:');
  else fail(`pipeline line order wrong: ${line}`);
  if (formatPipelineOffer(base) === '- [ ] https://jobs.example/1 | Tomra | Platform Engineer | Berlin') {
    pass('an offer without postingHistory produces a byte-identical pipeline line');
  } else fail(`plain pipeline line = ${formatPipelineOffer(base)}`);
} catch (e) {
  fail(`scan posting-history tests crashed: ${e.message}`);
}
