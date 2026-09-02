// tests/sunset-policy.test.mjs — lib/sunset-policy.mjs (M5: right to an ending)
import { pass, fail } from './helpers.mjs';
import { isStale, isSunsetEligibleStatus, resolveSunsetAfterDays } from '../lib/sunset-policy.mjs';

console.log('\nlib/sunset-policy.mjs — staleness predicate (M5)');

// Reference: 2026-08-01. A row applied 2026-02-01 is 181 days old.
const NOW = '2026-08-01';

try {
  // 1. An old, unanswered Applied row is stale.
  const stale = isStale(
    { num: 1, date: '2026-02-01', status: 'Applied' },
    [],
    { sunset_after_days: 45, now: NOW },
  );
  if (stale.stale === true && stale.reason === 'Applied-unanswered-at-45d' && stale.daysSilent >= 181) {
    pass('old unanswered Applied row is stale with the right reason');
  } else {
    fail(`stale Applied not detected: ${JSON.stringify(stale)}`);
  }

  // 2. A recent Applied row is not stale.
  const fresh = isStale(
    { num: 2, date: '2026-07-20', status: 'Applied' },
    [],
    { sunset_after_days: 45, now: NOW },
  );
  if (fresh.stale === false && Number.isFinite(fresh.daysSilent)) {
    pass('a recent Applied row is not stale');
  } else {
    fail(`fresh Applied flagged stale: ${JSON.stringify(fresh)}`);
  }

  // 3. A terminal status is never a sunset candidate.
  const terminal = isStale(
    { num: 3, date: '2026-02-01', status: 'Rejected' },
    [],
    { sunset_after_days: 10, now: NOW },
  );
  if (terminal.stale === false) {
    pass('a terminal status (Rejected) is not a sunset candidate');
  } else {
    fail(`terminal row flagged stale: ${JSON.stringify(terminal)}`);
  }

  // 4. Recent ledger activity resets the clock: an old Applied row that got a
  //    Responded entry last week is silent only since that entry.
  const active = isStale(
    { num: 4, date: '2026-02-01', status: 'Responded' },
    [{ num: 4, date: '2026-07-28', from: 'Applied', to: 'Responded' }],
    { sunset_after_days: 45, now: NOW },
  );
  if (active.stale === false && active.daysSilent <= 5) {
    pass('recent ledger activity resets the silence clock');
  } else {
    fail(`ledger-reset not honoured: ${JSON.stringify(active)}`);
  }

  // 5. Old ledger activity does NOT reset: an Applied row whose last ledger
  //    event was 2026-02-01 is still silent.
  const silent = isStale(
    { num: 5, date: '2026-02-01', status: 'Applied' },
    [{ num: 5, date: '2026-02-01', from: 'Evaluated', to: 'Applied' }],
    { sunset_after_days: 45, now: NOW },
  );
  if (silent.stale === true && silent.daysSilent >= 181) {
    pass('an old ledger event does not reset the silence clock');
  } else {
    fail(`old-ledger silence not detected: ${JSON.stringify(silent)}`);
  }

  // 6. Threshold honored: only marks when silence >= sunset_after_days.
  const edge60 = isStale(
    { num: 6, date: '2026-05-01', status: 'Applied' },
    [],
    { sunset_after_days: 60, now: NOW },
  );
  const edge120 = isStale(
    { num: 6, date: '2026-05-01', status: 'Applied' },
    [],
    { sunset_after_days: 120, now: NOW },
  );
  if (edge60.stale === true && edge120.stale === false) {
    pass('threshold is honoured (60d silent marked; not yet at 120d)');
  } else {
    fail(`threshold mismatch: ${JSON.stringify(edge60)} / ${JSON.stringify(edge120)}`);
  }

  // 7. Eligible-status helper.
  if (isSunsetEligibleStatus('Applied') && isSunsetEligibleStatus('Responded')
      && !isSunsetEligibleStatus('Evaluated') && !isSunsetEligibleStatus('Hired')) {
    pass('isSunsetEligibleStatus covers Applied/Responded only');
  } else {
    fail('isSunsetEligibleStatus is wrong');
  }

  // 8. resolveSunsetAfterDays (defect-hunt batch 2, D1): an explicit 0 must
  //    be honored, not silently replaced by the fallback (`Number(x) || y`
  //    treats 0 as falsy; `Number.isFinite` does not).
  if (resolveSunsetAfterDays(0) === 0) {
    pass('resolveSunsetAfterDays(0) honors an explicit zero');
  } else {
    fail(`resolveSunsetAfterDays(0) should be 0, got ${resolveSunsetAfterDays(0)}`);
  }
  if (resolveSunsetAfterDays(undefined) === 45 && resolveSunsetAfterDays(null) === 45) {
    pass('resolveSunsetAfterDays falls back to 45 when unset');
  } else {
    fail(`resolveSunsetAfterDays should default to 45 when unset: ${resolveSunsetAfterDays(undefined)} / ${resolveSunsetAfterDays(null)}`);
  }
  if (resolveSunsetAfterDays(90) === 90 && resolveSunsetAfterDays(-5) === -5) {
    pass('resolveSunsetAfterDays honors any other configured finite number');
  } else {
    fail(`resolveSunsetAfterDays should pass through finite numbers unchanged: ${resolveSunsetAfterDays(90)} / ${resolveSunsetAfterDays(-5)}`);
  }
  if (resolveSunsetAfterDays('not-a-number') === 45) {
    pass('resolveSunsetAfterDays falls back to 45 for a non-numeric value');
  } else {
    fail(`resolveSunsetAfterDays should default to 45 for garbage input, got ${resolveSunsetAfterDays('not-a-number')}`);
  }
} catch (e) {
  fail(`sunset-policy tests crashed: ${e.message}`);
}
