// tests/posting-reality.test.mjs — lib/posting-reality.mjs, the port of
// freehire's structural jobreality classifier
// (docs/FREEHIRE-INTEGRATION-PLAN.md Phase 3).
import { pass, fail, ROOT } from './helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nlib/posting-reality — structural signals, facts only');

try {
  const { classifyPostingReality, hasEvergreenMarker, SIGNAL_NAMES } = await import(pathToFileURL(join(ROOT, 'lib/posting-reality.mjs')).href);

  // Each signal in isolation.
  const old = classifyPostingReality({ ageDays: 90, repostCount: 1, concurrentCount: 1, evergreenText: false });
  if (old.signals.old === true && old.signalCount === 1 && !old.converged) pass('age >= 90d fires `old` alone, which does not converge');
  else fail(`old = ${JSON.stringify(old)}`);

  const young = classifyPostingReality({ ageDays: 89, repostCount: 1, concurrentCount: 1, evergreenText: false });
  if (young.signals.old === false && young.signalCount === 0) pass('age 89d does not fire `old`');
  else fail(`young = ${JSON.stringify(young.signals)}`);

  const mass = classifyPostingReality({ ageDays: 3, repostCount: 5, concurrentCount: 5, evergreenText: false });
  if (mass.signals.massPosted === true && mass.signals.reposted === false && mass.signalCount === 1) {
    pass('5 concurrent postings fire `massPosted` only — the independence rule keeps one spray from also firing `reposted`');
  } else fail(`mass = ${JSON.stringify(mass)}`);

  const churn = classifyPostingReality({ ageDays: 3, repostCount: 5, concurrentCount: 2, evergreenText: false });
  if (churn.signals.reposted === true && churn.evidence.historicalReposts === 3) pass('3 historical reposts beyond the concurrent ones fire `reposted`');
  else fail(`churn = ${JSON.stringify(churn)}`);

  // Convergence needs two independent signals.
  const both = classifyPostingReality({ ageDays: 120, repostCount: 6, concurrentCount: 2, evergreenText: false });
  if (both.converged && both.signalCount === 2) pass('two independent signals converge');
  else fail(`both = ${JSON.stringify(both)}`);

  // Unknown inputs are null, counted, never read as false-or-true.
  const sparse = classifyPostingReality({ ageDays: 100 });
  if (sparse.signals.reposted === null && sparse.signals.massPosted === null && sparse.signals.evergreenText === null
      && sparse.signalsUnknown === 3 && sparse.signalsTotal === SIGNAL_NAMES.length) {
    pass('unobserved inputs yield null signals, reported in signalsUnknown');
  } else fail(`sparse = ${JSON.stringify(sparse)}`);
  const unknownConcurrent = classifyPostingReality({ ageDays: 1, repostCount: 4 });
  if (unknownConcurrent.evidence.historicalReposts === 3 && unknownConcurrent.signals.reposted === true) {
    pass('unknown concurrent count subtracts only the posting itself');
  } else fail(`unknownConcurrent = ${JSON.stringify(unknownConcurrent)}`);
  const garbage = classifyPostingReality({ ageDays: -5, repostCount: 2.5, concurrentCount: '3' });
  if (garbage.signalsUnknown === 4 && garbage.signalCount === 0) pass('negative / non-integer / string inputs are treated as unobserved');
  else fail(`garbage = ${JSON.stringify(garbage)}`);

  // Fake freshness: old by first-seen, fresh by stated date.
  if (classifyPostingReality({ ageDays: 120, postedAgeDays: 3 }).fakeFreshness === true
      && classifyPostingReality({ ageDays: 120, postedAgeDays: 40 }).fakeFreshness === false
      && classifyPostingReality({ ageDays: 10, postedAgeDays: 3 }).fakeFreshness === false
      && classifyPostingReality({ ageDays: 120 }).fakeFreshness === false) {
    pass('fakeFreshness fires only for an old posting whose stated date is within 14 days');
  } else fail('fakeFreshness edge cases');

  // No class label anywhere in the result.
  const serialized = JSON.stringify(both);
  if (!/evergreen"|ghost|stale|fresh"|likely/i.test(serialized.replace(/evergreenText/g, '').replace(/fakeFreshness/g, ''))) {
    pass('the result carries signals and counts, never a class label');
  } else fail(`result leaks a label: ${serialized}`);

  // Evergreen dictionary: curated multi-word phrases, never single words.
  if (hasEvergreenMarker('Join our Talent Community for future openings') && hasEvergreenMarker('Мы всегда в поиске')
      && !hasEvergreenMarker('Build a data pipeline for the pool of users') && !hasEvergreenMarker(undefined)) {
    pass('hasEvergreenMarker matches curated phrases (EN + RU) and ignores "data pipeline"/"pool"');
  } else fail('hasEvergreenMarker dictionary behaviour');
} catch (e) {
  fail(`posting-reality tests crashed: ${e.message}`);
}
