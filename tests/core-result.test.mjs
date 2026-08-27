// tests/core-result.test.mjs — core/shared/result.mjs (W0: Result type)
import { pass, fail } from './helpers.mjs';
import {
  ok, err, domainError, isOk, isErr, map, mapErr, flatMap,
  unwrapOr, unwrap, all, partition,
} from '../core/shared/result.mjs';

console.log('\ncore/shared/result.mjs — Result type (W0)');

try {
  // 1-2. Construction and discrimination.
  if (isOk(ok(1)) && !isErr(ok(1))) pass('ok() constructs a success');
  else fail('ok() misclassified');

  if (isErr(err('E')) && !isOk(err('E'))) pass('err() constructs a failure');
  else fail('err() misclassified');

  // 3. map transforms a success.
  const mapped = map(ok(2), (x) => x * 3);
  if (mapped.ok && mapped.value === 6) pass('map transforms a success value');
  else fail(`map: ${JSON.stringify(mapped)}`);

  // 4. map leaves a failure alone — the transform must not run.
  let ran = false;
  const untouched = map(err('E'), () => { ran = true; return 1; });
  if (!ran && !untouched.ok && untouched.error === 'E') pass('map does not run the transform on a failure');
  else fail('map ran the transform on a failure');

  // 5-6. mapErr is the mirror image.
  const remapped = mapErr(err('low'), (e) => `wrapped:${e}`);
  if (!remapped.ok && remapped.error === 'wrapped:low') pass('mapErr adds context to a failure');
  else fail(`mapErr: ${JSON.stringify(remapped)}`);

  if (mapErr(ok(5), () => 'never').value === 5) pass('mapErr leaves a success untouched');
  else fail('mapErr altered a success');

  // 7-8. flatMap chains, and short-circuits.
  const chained = flatMap(ok(4), (x) => ok(x + 1));
  if (chained.ok && chained.value === 5) pass('flatMap chains Result-returning steps');
  else fail(`flatMap: ${JSON.stringify(chained)}`);

  let chainRan = false;
  const shorted = flatMap(err('stop'), () => { chainRan = true; return ok(1); });
  if (!chainRan && !shorted.ok) pass('flatMap short-circuits on a failure');
  else fail('flatMap did not short-circuit');

  // 9-10. unwrapOr substitutes only on failure.
  if (unwrapOr(err('x'), 42) === 42 && unwrapOr(ok(7), 42) === 7) {
    pass('unwrapOr substitutes the fallback only on failure');
  } else {
    fail('unwrapOr behaved incorrectly');
  }

  // 11. unwrap throws on a failure, and the message carries the error code so a
  //     stack trace is diagnosable rather than just "unwrap failed".
  try {
    unwrap(err(domainError('CV_PARSE_FAILED', 'no headings found')));
    fail('unwrap did not throw on a failure');
  } catch (e) {
    if (e.message.includes('CV_PARSE_FAILED') && e.message.includes('no headings found')) {
      pass('unwrap throws with the error code and message');
    } else {
      fail(`unwrap threw an unhelpful message: ${e.message}`);
    }
  }

  // 12-13. all() is fail-fast and returns the FIRST error.
  const collected = all([ok(1), ok(2), ok(3)]);
  if (collected.ok && collected.value.join(',') === '1,2,3') pass('all() collects successes in order');
  else fail(`all(): ${JSON.stringify(collected)}`);

  const failed = all([ok(1), err('first'), err('second')]);
  if (!failed.ok && failed.error === 'first') pass('all() fails fast on the first error');
  else fail(`all() returned the wrong error: ${JSON.stringify(failed)}`);

  // 14. partition keeps both sides — needed to report every malformed field in
  //     one pass instead of one per round-trip.
  const split = partition([ok(1), err('a'), ok(2), err('b')]);
  if (split.values.join(',') === '1,2' && split.errors.join(',') === 'a,b') {
    pass('partition keeps every success and every failure');
  } else {
    fail(`partition: ${JSON.stringify(split)}`);
  }

  // 15. domainError shape — code is mandatory, details optional and omitted
  //     rather than set to undefined (so JSON round-trips cleanly).
  const bare = domainError('X_FAILED', 'msg');
  const withDetails = domainError('Y_FAILED', 'msg', { field: 'dates' });
  if (!('details' in bare) && withDetails.details.field === 'dates' && bare.code === 'X_FAILED') {
    pass('domainError omits details when absent, keeps them when given');
  } else {
    fail(`domainError shape: ${JSON.stringify(bare)} / ${JSON.stringify(withDetails)}`);
  }

  // 16. A realistic pipeline composes without nesting.
  const parseAge = (s) => (/^\d+$/.test(s) ? ok(Number(s)) : err(domainError('NOT_A_NUMBER', s)));
  const checkAdult = (n) => (n >= 18 ? ok(n) : err(domainError('TOO_YOUNG', String(n))));
  const good = flatMap(parseAge('30'), checkAdult);
  const bad = flatMap(parseAge('abc'), checkAdult);
  const young = flatMap(parseAge('12'), checkAdult);
  if (good.ok && good.value === 30 && !bad.ok && bad.error.code === 'NOT_A_NUMBER'
      && !young.ok && young.error.code === 'TOO_YOUNG') {
    pass('a multi-step pipeline composes and reports the right failure');
  } else {
    fail('pipeline composition produced the wrong outcome');
  }
} catch (e) {
  fail(`core-result tests crashed: ${e.message}`);
}
