// tests/check-liveness.test.mjs — structural coverage for check-liveness.mjs.
// The file has no direct-invocation guard (main() runs unconditionally on
// import, unlike browser-extract.mjs), so it can't be imported here without
// running a real CLI invocation — this checks the source shape instead.
import { pass, fail, ROOT } from './helpers.mjs';
import { join } from 'path';
import { readFileSync } from 'fs';

console.log('\ncheck-liveness.mjs (resource-lifecycle wiring)');

try {
  const source = readFileSync(join(ROOT, 'check-liveness.mjs'), 'utf-8');

  // B6-D2: the browser/headed-page lifecycle must be closed from a finally
  // block, not from plain post-loop statements — otherwise an error thrown
  // mid-loop (e.g. the browser crashing between ensureBrowser()'s launch()
  // and newContext()) leaks the already-open Chromium process, since
  // main().catch() only logs and exits. Confirmed live: launching a real
  // browser, closing it out from under ensureBrowser() to force
  // newLivenessPage() to throw, and observing browser.close() never ran on
  // that path (see docs/DEFECT-HUNT-LEDGER.md B6-D2) — not repeated here
  // per guardrail #3 (no real browser in the automated suite); this locks
  // the wiring so the finally can't silently get dropped again.
  const finallyBlock = source.match(/\}\s*finally\s*\{([\s\S]*?)\n  \}/);
  const closesBrowserInFinally = !!finallyBlock
    && /headed\.close\(\)/.test(finallyBlock[1])
    && /browser\.close\(\)/.test(finallyBlock[1]);
  if (closesBrowserInFinally) {
    pass('check-liveness.mjs closes headed/browser from a finally block around the URL loop');
  } else {
    fail(`check-liveness.mjs's browser cleanup is not inside a finally block (found finally: ${!!finallyBlock})`);
  }
} catch (e) {
  fail(`check-liveness.mjs structural tests crashed: ${e.message}`);
}
