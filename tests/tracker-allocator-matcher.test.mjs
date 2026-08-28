/**
 * tracker-allocator-matcher.test.mjs — reserve-report-num.mjs allocator,
 * the shared role matcher (role-matcher.mjs) + dedup-tracker.mjs safety,
 * find.mjs pipeline identity lookup, and dedup-tracker's Location-column
 * handling.
 *
 * Extracted verbatim from test-all.mjs (see tests/README.md — discovered
 * files are auto-run by both test-all.mjs and test-runner.mjs).
 */

import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { execFileSync, spawn } from 'child_process';
import { pathToFileURL } from 'url';
import { pass, fail, warn, run, ROOT, NODE } from './helpers.mjs';

/**
 * Read a repo-relative text file as UTF-8. Copied verbatim from test-all.mjs
 * (kept local rather than shared, since it's specific to the #1440
 * migration's single-line-symlink-redirect convention for skill entrypoints).
 *
 * @param {string} path - Path relative to the Jobber repository root.
 * @returns {string} File contents.
 */
function readFile(path) {
  const fullPath = join(ROOT, path);
  let content = readFileSync(fullPath, 'utf-8');
  if (content.trim().startsWith('..') && content.trim().split('\n').length === 1) {
    const target = join(dirname(fullPath), content.trim());
    if (existsSync(target)) {
      content = readFileSync(target, 'utf-8');
    }
  }
  return content;
}

console.log('\n🧪 Testing reserve-report-num env override and range reservation...');
try {
  const RESERVE = join(ROOT, 'reserve-report-num.mjs');
  const reserveRun = (args, dir, tracker = join(dir, 'applications.md')) => execFileSync(NODE, [RESERVE, ...args], {
    encoding: 'utf-8',
    env: { ...process.env, JOBBER_REPORTS_DIR: dir, JOBBER_TRACKER: tracker },
  }).trim();

  // Importing the module must expose the same allocator used by the CLI,
  // without running the CLI as an import side effect.
  const apiTmp = mkdtempSync(join(tmpdir(), 'jobber-reserve-api-'));
  const apiTracker = join(apiTmp, 'applications.md');
  const apiProbe = execFileSync(NODE, ['--input-type=module', '--eval', `
    const api = await import(${JSON.stringify(pathToFileURL(RESERVE).href)});
    const { existsSync, readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const nums = await api.reserveReportNumbers(1, {
      reportsDir: process.env.JOBBER_REPORTS_DIR,
      trackerPath: process.env.JOBBER_TRACKER,
    });
    const sentinel = join(process.env.JOBBER_REPORTS_DIR, '001-RESERVED.md');
    let firstToken = null;
    try { firstToken = JSON.parse(readFileSync(sentinel, 'utf-8')).token; } catch {}
    await api.releaseReportNumbers(nums, {
      reportsDir: process.env.JOBBER_REPORTS_DIR,
      trackerPath: process.env.JOBBER_TRACKER,
    });
    const replacement = await api.reserveReportNumbers(1, {
      reportsDir: process.env.JOBBER_REPORTS_DIR,
      trackerPath: process.env.JOBBER_TRACKER,
    });
    let replacementToken = null;
    try { replacementToken = JSON.parse(readFileSync(sentinel, 'utf-8')).token; } catch {}
    await api.releaseReportNumbers(nums, {
      reportsDir: process.env.JOBBER_REPORTS_DIR,
      trackerPath: process.env.JOBBER_TRACKER,
    });
    const replacementPreserved = existsSync(sentinel);
    await api.releaseReportNumbers(replacement, {
      reportsDir: process.env.JOBBER_REPORTS_DIR,
      trackerPath: process.env.JOBBER_TRACKER,
    });
    console.log(JSON.stringify({
      nums,
      formatted: api.formatReportNumber(nums[0]),
      firstToken,
      replacementToken,
      replacementPreserved,
      replacementCleaned: !existsSync(sentinel),
    }));
  `], {
    encoding: 'utf-8',
    env: { ...process.env, JOBBER_REPORTS_DIR: apiTmp, JOBBER_TRACKER: apiTracker },
  }).trim();
  let apiResult = null;
  try { apiResult = JSON.parse(apiProbe); } catch {}
  if (apiResult?.nums?.[0] === 1 && apiResult.formatted === '001'
      && apiResult.firstToken && apiResult.replacementToken
      && apiResult.firstToken !== apiResult.replacementToken
      && apiResult.replacementPreserved && apiResult.replacementCleaned) {
    pass('reserve-report-num token ownership prevents stale cleanup from deleting a replacement claim');
  } else {
    fail(`reserve-report-num import API failed: ${apiProbe}`);
  }
  rmSync(apiTmp, { recursive: true, force: true });

  const trackerParseApi = await import(pathToFileURL(join(ROOT, 'tracker-parse.mjs')).href);
  const complexLinkNums = trackerParseApi.extractTrackerReportNumbers(
    '[22](../reports/021-acme_(us)-2026-07-15.md "US role")',
  );
  const angleLinkNums = trackerParseApi.extractTrackerReportNumbers(
    '[23](<../reports/023-acme role-(eu)-2026-07-15.md> \'EU role\')',
  );
  if (complexLinkNums.join(',') === '22,21' && angleLinkNums.join(',') === '23') {
    pass('tracker report-link parsing supports balanced parentheses, spaces, and optional titles');
  } else {
    fail(`complex tracker report links parsed incorrectly: ${complexLinkNums} / ${angleLinkNums}`);
  }

  const reserveTmp = mkdtempSync(join(tmpdir(), 'jobber-reserve-'));
  const single = reserveRun([], reserveTmp);
  if (single === '001' && existsSync(join(reserveTmp, '001-RESERVED.md'))) {
    pass('JOBBER_REPORTS_DIR override redirects sentinel to temp dir');
  } else {
    fail(`env override failed: stdout=${single}, sentinel in tmp=${existsSync(join(reserveTmp, '001-RESERVED.md'))}`);
  }
  rmSync(reserveTmp, { recursive: true, force: true });

  // Tracker IDs and linked report IDs are occupied even when their report
  // files are missing (for example after a partial sync or manual archive).
  const trackerTmp = mkdtempSync(join(tmpdir(), 'jobber-reserve-tracker-'));
  const trackerFile = join(trackerTmp, 'applications.md');
  writeFileSync(trackerFile,
    '# Applications Tracker\n\n' +
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n' +
    '|---|------|---------|------|-------|--------|-----|--------|-------|\n' +
    '| 7 | 2026-01-01 | Acme | Engineer | 4.0/5 | Evaluated | ❌ | [12](../reports/012-acme-2026-01-01.md) | fixture |\n');
  const afterTracker = reserveRun([], join(trackerTmp, 'reports'), trackerFile);
  if (afterTracker === '013') {
    pass('reservation accounts for tracker row IDs and linked report IDs');
  } else {
    fail(`tracker-aware reservation produced ${afterTracker}, expected 013`);
  }
  rmSync(trackerTmp, { recursive: true, force: true });

  // Formatting is a minimum width, not a three-digit ceiling.
  const fourDigitTmp = mkdtempSync(join(tmpdir(), 'jobber-reserve-4digit-'));
  const fourDigitTracker = join(fourDigitTmp, 'applications.md');
  writeFileSync(fourDigitTracker,
    '# Applications Tracker\n\n' +
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n' +
    '|---|------|---------|------|-------|--------|-----|--------|-------|\n' +
    '| 1000 | 2026-01-01 | Acme | Engineer | 4.0/5 | Evaluated | ❌ | — | fixture |\n');
  const fourDigit = reserveRun([], join(fourDigitTmp, 'reports'), fourDigitTracker);
  if (fourDigit === '1001' && existsSync(join(fourDigitTmp, 'reports', '1001-RESERVED.md'))) {
    pass('reservation continues beyond 999 without truncation or reset');
  } else {
    fail(`four-digit reservation produced ${fourDigit}, expected 1001`);
  }
  rmSync(fourDigitTmp, { recursive: true, force: true });

  const unsafeRangeTmp = mkdtempSync(join(tmpdir(), 'jobber-reserve-unsafe-range-'));
  const unsafeRangeReports = join(unsafeRangeTmp, 'reports');
  const unsafeRangeTracker = join(unsafeRangeTmp, 'applications.md');
  mkdirSync(unsafeRangeReports);
  writeFileSync(
    join(unsafeRangeReports, `${Number.MAX_SAFE_INTEGER - 1}-existing.md`),
    '# fixture',
  );
  const allocatorApi = await import(`${pathToFileURL(RESERVE).href}?unsafe-range=${Date.now()}`);
  let unsafeRangeError = null;
  try {
    await allocatorApi.reserveReportNumbers(2, {
      reportsDir: unsafeRangeReports,
      trackerPath: unsafeRangeTracker,
    });
  } catch (err) {
    unsafeRangeError = err;
  }
  const unsafeRangeLeaked = readdirSync(unsafeRangeReports)
    .some(name => name.endsWith('-RESERVED.md'));
  if (unsafeRangeError instanceof RangeError && !unsafeRangeLeaked) {
    pass('unsafe report-number ranges fail before creating a partial sentinel');
  } else {
    fail(`unsafe range guard failed: error=${unsafeRangeError?.message}, leaked=${unsafeRangeLeaked}`);
  }
  rmSync(unsafeRangeTmp, { recursive: true, force: true });

  const evaluatorSources = ['ollama-eval.mjs', 'openai-eval.mjs', 'gemini-eval.mjs', 'openrouter-runner.mjs']
    .map(name => [name, readFile(name)]);
  const unmigratedEvaluators = evaluatorSources
    .filter(([, source]) => !/reservedNumbers\s*=\s*await\s+reserveReportNumbers\s*\(/.test(source)
      || !/await\s+releaseReportNumbers\s*\(\s*reservedNumbers\b/.test(source)
      || /function\s+nextReport(?:Number|Num)\s*\(/.test(source))
    .map(([name]) => name);
  if (unmigratedEvaluators.length === 0) {
    pass('all headless evaluators use the shared atomic report allocator');
  } else {
    fail(`headless evaluators still carry private max+1 allocators: ${unmigratedEvaluators.join(', ')}`);
  }

  // --count N: contiguous range from an empty dir.
  const rangeTmp = mkdtempSync(join(tmpdir(), 'jobber-reserve-range-'));
  const range = reserveRun(['--count', '3'], rangeTmp);
  const rangeSentinels = ['001', '002', '003']
    .every(n => existsSync(join(rangeTmp, `${n}-RESERVED.md`)));
  if (range === '001-003' && rangeSentinels) {
    pass('--count 3 reserves contiguous range and prints START-END');
  } else {
    fail(`--count 3 produced stdout=${range}, all sentinels=${rangeSentinels}`);
  }

  // --count N continues after existing reports.
  writeFileSync(join(rangeTmp, '007-acme-2026-07-02.md'), '# stub');
  const afterExisting = reserveRun(['--count', '2'], rangeTmp);
  if (afterExisting === '008-009') {
    pass('--count starts range after highest existing slot');
  } else {
    fail(`--count after existing report produced ${afterExisting}, expected 008-009`);
  }

  // --count 1 keeps the single-number output format (backwards compatible).
  const countOne = reserveRun(['--count', '1'], rangeTmp);
  if (countOne === '010') {
    pass('--count 1 prints single number without dash');
  } else {
    fail(`--count 1 produced ${countOne}, expected 010`);
  }
  rmSync(rangeTmp, { recursive: true, force: true });

  // Collision mid-range: pre-place a sentinel at 007 with existing max 005.
  // maxSlot() counts RESERVED sentinels as occupied, so a foreign sentinel at
  // 007 bases the range past it (008-) — no slot below is ever attempted.
  // (The rollback path is exercised by the next test, not this one.)
  const collideTmp = mkdtempSync(join(tmpdir(), 'jobber-reserve-collide-'));
  writeFileSync(join(collideTmp, '005-acme-2026-07-02.md'), '# stub');
  writeFileSync(join(collideTmp, '007-RESERVED.md'), '');
  const collided = reserveRun(['--count', '3'], collideTmp);
  const leaked006 = existsSync(join(collideTmp, '006-RESERVED.md'));
  const foreign007 = existsSync(join(collideTmp, '007-RESERVED.md'));
  if (collided === '008-010' && !leaked006 && foreign007) {
    pass('--count treats a foreign sentinel as occupied and bases the range past it');
  } else {
    fail(`sentinel-as-occupied: stdout=${collided} (want 008-010), 006 sentinel=${leaked006}, foreign 007 kept=${foreign007}`);
  }
  rmSync(collideTmp, { recursive: true, force: true });

  // Existing four-digit report names participate in the same occupancy scan.
  const highRangeTmp = mkdtempSync(join(tmpdir(), 'jobber-reserve-high-range-'));
  writeFileSync(join(highRangeTmp, '999-acme-2026-07-02.md'), '# stub');
  writeFileSync(join(highRangeTmp, '1001-taken.md'), '# stub');
  const highRange = reserveRun(['--count', '3'], highRangeTmp);
  const skipped1000 = !existsSync(join(highRangeTmp, '1000-RESERVED.md'));
  const blocker1001 = existsSync(join(highRangeTmp, '1001-taken.md'));
  const reservedHighRange = ['1002', '1003', '1004']
    .every(n => existsSync(join(highRangeTmp, `${n}-RESERVED.md`)));
  if (highRange === '1002-1004' && skipped1000 && blocker1001 && reservedHighRange) {
    pass('four-digit report files advance a contiguous range without truncation');
  } else {
    fail(`four-digit range: stdout=${highRange} (want 1002-1004), 1000 skipped=${skipped1000}, blocker kept=${blocker1001}, sentinels=${reservedHighRange}`);
  }
  rmSync(highRangeTmp, { recursive: true, force: true });

  // Range-vs-range: two concurrent --count 4 reservations must not overlap.
  // Terminates by construction: each restart strictly advances the base.
  let reserveRetries = 1;
  while (reserveRetries >= 0) {
    const concTmp = mkdtempSync(join(tmpdir(), 'jobber-reserve-conc-'));
    try {
      const spawnReserve = () => new Promise(resolve => {
        const child = spawn(NODE, [RESERVE, '--count', '4'], {
          env: { ...process.env, JOBBER_REPORTS_DIR: concTmp },
        });
        let stdout = '';
        child.stdout.on('data', chunk => { stdout += chunk; });
        child.on('close', () => resolve(stdout.trim()));
      });
      const [rangeX, rangeY] = await Promise.all([spawnReserve(), spawnReserve()]);
      const toNums = r => {
        const [s, e] = r.split('-').map(Number);
        return Array.from({ length: e - s + 1 }, (_, i) => s + i);
      };
      const overlap = toNums(rangeX).filter(n => toNums(rangeY).includes(n));
      if (rangeX && rangeY && overlap.length === 0) {
        pass(`concurrent --count 4 reservations are disjoint (${rangeX} vs ${rangeY})`);
      } else {
        throw new Error(`concurrent ranges overlap: ${rangeX} vs ${rangeY} share [${overlap}]`);
      }
      break;
    } catch (e) {
      if (reserveRetries > 0) {
        warn(`concurrent reservation test flaked (${e.message}). Retrying once...`);
        reserveRetries -= 1;
      } else {
        fail(`concurrent reservation test failed: ${e.message}`);
        break;
      }
    } finally {
      rmSync(concTmp, { recursive: true, force: true });
    }
  }

  // --release with a range deletes every sentinel in it.
  const reserveRunFail = (args, dir) => {
    try {
      execFileSync(NODE, [RESERVE, ...args], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, JOBBER_REPORTS_DIR: dir, JOBBER_TRACKER: join(dir, 'applications.md') },
      });
      return null;
    } catch (err) {
      return err.status;
    }
  };
  const relTmp = mkdtempSync(join(tmpdir(), 'jobber-reserve-release-'));
  reserveRun(['--count', '4'], relTmp); // reserves 001-004
  reserveRun(['--release', '001-004'], relTmp);
  const anyLeft = ['001', '002', '003', '004']
    .some(n => existsSync(join(relTmp, `${n}-RESERVED.md`)));
  if (!anyLeft) {
    pass('--release NNN-MMM deletes all sentinels in range');
  } else {
    fail('--release range left sentinels behind');
  }

  // Invalid inputs exit non-zero.
  const badCount = reserveRunFail(['--count', '0'], relTmp);
  const hugeCount = reserveRunFail(['--count', '999'], relTmp);
  const badRelease = reserveRunFail(['--release', '009-004'], relTmp);
  const hugeRelease = reserveRunFail(['--release', '1-9007199254740992'], relTmp);
  const wideRelease = reserveRunFail(['--release', '1-51'], relTmp);
  if (badCount === 1 && hugeCount === 1 && badRelease === 1
      && hugeRelease === 1 && wideRelease === 1) {
    pass('invalid counts and unsafe, inverted, or oversized release ranges exit 1');
  } else {
    fail(`validation exits: count0=${badCount}, count999=${hugeCount}, inverted=${badRelease}, unsafe=${hugeRelease}, wide=${wideRelease}`);
  }
  rmSync(relTmp, { recursive: true, force: true });
} catch (e) {
  fail(`reserve-report-num tests crashed: ${e.message}`);
}

// Moved to tests/verify-pipeline-reports.test.mjs (auto-discovered): the
// verify-pipeline duplicate/orphan report checks (#1425) and the
// duplicate tracker number check (#1704).

// ── SHARED ROLE MATCHER + DEDUP-TRACKER SAFETY (#947) ───────────
// dedup-tracker.mjs used to ship an older fuzzy role matcher than
// merge-tracker.mjs. That weaker matcher collapsed sibling roles at the same
// company when they shared generic title words such as "Full Stack Engineer",
// and could delete an already-Applied row because data/applications.md is
// normally gitignored. The matcher is now shared, and dedup protects advanced
// application states from fuzzy-only deletion.
console.log('\n🧪 Testing shared role matcher and dedup-tracker safety...');
try {
  const { roleFuzzyMatch, roleTokens } = await import(pathToFileURL(join(ROOT, 'role-matcher.mjs')).href);

  if (!roleFuzzyMatch('Full Stack Engineer, Foundation', 'Full Stack Engineer, Guarded Releases')) {
    pass('role matcher keeps Full Stack Engineer sibling teams distinct (#947)');
  } else {
    fail('role matcher still collapses distinct Full Stack Engineer sibling teams');
  }

  if (!roleFuzzyMatch('Staff Software Engineer, API', 'Staff Software Engineer, SDK')) {
    pass('role matcher keeps short-acronym sibling teams distinct');
  } else {
    fail('role matcher collapsed API and SDK sibling teams');
  }

  if (roleFuzzyMatch('Staff Software Engineer, API', 'Staff Software Engineer, API Platform')) {
    pass('role matcher still uses short specialty acronyms for true overlaps');
  } else {
    fail('role matcher ignored a real short-acronym overlap');
  }

  // 'product' is a baseline token: "ai" is dropped by the tokenizer (2-letter,
  // not in SHORT_SPECIALTY), so without this these titles collapse to
  // [product, manager] and merge-tracker skips one as a false duplicate.
  if (!roleFuzzyMatch('Product Manager - Marketplace', 'Product Manager - AI')) {
    pass('role matcher keeps Product Manager sibling specialties distinct');
  } else {
    fail('role matcher collapsed Product Manager - Marketplace into Product Manager - AI');
  }

  if (roleFuzzyMatch('Product Manager - Marketplace', 'Product Manager - Marketplace')) {
    pass('role matcher still matches identical Product Manager titles');
  } else {
    fail('role matcher rejected an identical Product Manager title');
  }

  // A generic base title (no suffix of its own) shares every one of its tokens
  // with a specialized sibling, so the shared tokens alone used to cross the
  // Jaccard threshold — even though the sibling's extra word is exactly the
  // signal that these are two different, separately-postable openings.
  if (!roleFuzzyMatch('Senior Analytics Engineer', 'Senior Analytics Engineer, People Analytics')) {
    pass('role matcher keeps a base title distinct from its specialized-suffix sibling (#1881)');
  } else {
    fail('role matcher collapsed a base title into its specialized-suffix sibling');
  }

  // A true repost of the same base title must still match.
  if (roleFuzzyMatch('Senior Analytics Engineer', 'Senior Analytics Engineer')) {
    pass('role matcher still matches an exact-title repost');
  } else {
    fail('role matcher rejected an exact-title repost');
  }

  // Seniority omitted on one side is not a specialization suffix — still a repost.
  if (roleFuzzyMatch('Data Engineer', 'Senior Data Engineer')) {
    pass('role matcher still matches when seniority is only stated on one side');
  } else {
    fail('role matcher rejected a repost that only adds a seniority word');
  }

  // A sub-baseline qualifier on ONE side is a level disagreement, not a loose
  // rewrite: the tokenizer drops seniority words as stopwords, so these pairs
  // otherwise tokenize identically and scored a perfect Jaccard ratio, silently
  // collapsing two genuinely different requisitions (#2009).
  for (const [lower, bare] of [
    ['Associate Product Manager, TeamName', 'Product Manager, TeamName'],
    ['Junior Product Manager, TeamName', 'Product Manager, TeamName'],
    ['Entry Level Data Engineer', 'Data Engineer'],
  ]) {
    if (!roleFuzzyMatch(lower, bare)) {
      pass(`role matcher keeps "${lower}" distinct from the bare title (#2009)`);
    } else {
      fail(`role matcher collapsed "${lower}" into the bare title "${bare}"`);
    }
  }

  // Direction must not matter — the lone qualifier can be on either side.
  if (!roleFuzzyMatch('Product Manager, TeamName', 'Associate Product Manager, TeamName')) {
    pass('role matcher applies the sub-baseline gate in both argument orders (#2009)');
  } else {
    fail('role matcher only applied the sub-baseline gate in one argument order');
  }

  // Both sides sub-baseline at the same level is still the same opening.
  if (roleFuzzyMatch('Associate Product Manager, TeamName', 'Associate Product Manager, TeamName')) {
    pass('role matcher still matches two same-level Associate reposts (#2009)');
  } else {
    fail('role matcher rejected a genuine Associate-level repost');
  }

  // A repost annotation is tracking metadata, not a specialization — must still match.
  if (roleFuzzyMatch('Learning Development Designer III', 'Learning Development Designer III (Repost)')) {
    pass('role matcher does not treat a "(Repost)" annotation as a specialization marker');
  } else {
    fail('role matcher wrongly treated a "(Repost)" annotation as a distinct sibling role');
  }

  // "Member of Technical Staff" is a boilerplate level-prefix used by several
  // companies for senior IC titles. Without stripping it, "member" and
  // "technical" leaked through as apparently-discriminating tokens and made two
  // genuinely different roles register as a fuzzy-match false positive.
  if (!roleFuzzyMatch('Member of Technical Staff, Connector Platform', 'Member of Technical Staff, Backend Platform')) {
    pass('role matcher keeps distinct "Member of Technical Staff" sibling roles apart');
  } else {
    fail('role matcher collapsed distinct "Member of Technical Staff" sibling roles');
  }

  if (roleFuzzyMatch('Member of Technical Staff, Connector Platform', 'Member of Technical Staff, Connector Platform')) {
    pass('role matcher still matches an exact "Member of Technical Staff" repost');
  } else {
    fail('role matcher rejected an exact "Member of Technical Staff" repost');
  }

  // The MTS fix strips the literal "member of technical staff" phrase, not a
  // blanket stopword on "member"/"technical" — those words must keep their
  // normal discriminating role in titles where the phrase isn't present.
  if (!roleFuzzyMatch('Technical Writer, API Docs', 'Technical Writer, Onboarding Guides')) {
    pass('role matcher still treats "technical" as discriminating outside the MTS phrase');
  } else {
    fail('role matcher over-stripped "technical" outside the MTS phrase');
  }

  // A blanket "technical" stopword would also break real reposts: stripped from
  // both sides here, only "recruiter" is left, which alone can't clear the
  // 2-token overlap minimum. Phrase-aware stripping keeps "technical" as a
  // normal contributing token outside the MTS phrase, so the repost still matches.
  if (roleFuzzyMatch('Senior Technical Recruiter, EMEA', 'Technical Recruiter, EMEA')) {
    pass('role matcher still matches a real repost that happens to contain "technical"');
  } else {
    fail('role matcher rejected a real repost because "technical" was over-stripped');
  }

  // Stripping the MTS phrase can leave 0-1 tokens for a bare or short-suffix
  // title, which would otherwise fall short of the 2-token overlap minimum —
  // even for an exact repost of itself. The exact-match fast path in
  // roleFuzzyMatch guards this regardless of tokenization.
  if (roleFuzzyMatch('Member of Technical Staff', 'Member of Technical Staff')) {
    pass('role matcher matches a bare "Member of Technical Staff" exact repost');
  } else {
    fail('role matcher rejected a bare "Member of Technical Staff" exact repost');
  }

  if (roleFuzzyMatch('Member of Technical Staff, Backend', 'Member of Technical Staff, Backend')) {
    pass('role matcher matches an exact repost of a short-suffix MTS title');
  } else {
    fail('role matcher rejected an exact repost of a short-suffix MTS title');
  }

  // A non-identical repost (different punctuation) with a genuinely
  // discriminating one-word suffix still needs 2+ tokens to clear the
  // overlap minimum — the "engineer" filler (a BASELINE_TOKENS entry) pads
  // that count without ever being the sole reason two titles match.
  if (roleFuzzyMatch('Member of Technical Staff, Connector', 'Member of Technical Staff - Connector')) {
    pass('role matcher matches a punctuation-variant repost of a short-suffix MTS title');
  } else {
    fail('role matcher rejected a punctuation-variant repost of a short-suffix MTS title');
  }

  if (roleFuzzyMatch('Member of Technical Staff, Connector', 'Member of Technical Staff, Backend')) {
    fail('role matcher collapsed distinct one-word-suffix MTS roles via the "engineer" filler');
  } else {
    pass('role matcher keeps distinct one-word-suffix MTS roles apart despite the "engineer" filler');
  }

  // Slashed short acronyms used to vanish in tokenization ("(CI/CD)" → "ci cd"
  // → both dropped by the length filter), so a sibling req whose ONLY
  // distinguishing qualifier is a slashed acronym tokenized identically to the
  // bare title — the #1881 subset guard never saw an extra token — and
  // merge-tracker overwrote the Applied row's title/score/report (#2165).
  if (!roleFuzzyMatch(
    'Senior Software Engineer, Infrastructure',
    'Senior Software Engineer, Infrastructure (CI/CD)'
  )) {
    pass('role matcher keeps a slash-acronym-qualified sibling req distinct (#2165)');
  } else {
    fail('role matcher still collapses sibling reqs whose only qualifier is a slashed acronym');
  }

  if (roleFuzzyMatch(
    'Senior Software Engineer, Infrastructure (CI/CD)',
    'Senior Software Engineer, Infrastructure CI/CD'
  )) {
    pass('role matcher still matches the same slash-acronym role across punctuation variants');
  } else {
    fail('role matcher stopped matching identical slash-acronym roles');
  }

  // Accented Latin titles used to split at the accent instead of folding it, so
  // "Sênior" tokenized to ["s", "nior"]: "s" fell to the length filter and
  // "nior" survived as a phantom token that is in no stopword list. Every
  // downstream rule then misfired at once (#2207).
  // Assert the whole token list, not just the absence of "nior": a fix that
  // merely deleted non-ASCII would still leave a phantom ("snior") and pass a
  // negative check.
  const accentTokens = roleTokens('Software Engineer Node.js Sênior');
  const plainTokens = roleTokens('Software Engineer Node.js Senior');
  if (JSON.stringify(accentTokens) === JSON.stringify(plainTokens)) {
    pass('role tokenizer folds accents onto the plain-ASCII token list (#2207)');
  } else {
    fail(`accented title tokenized differently from its plain spelling: ${JSON.stringify(accentTokens)} vs ${JSON.stringify(plainTokens)}`);
  }

  // Folding must delete combining marks only. Standalone characters such as
  // "·" are separators in a title; deleting them would glue two words into a
  // single token and turn a real repost into a duplicate row.
  const separatorTokens = roleTokens('Backend Engineer·Payments');
  if (separatorTokens.includes('payments') && !separatorTokens.some(w => w.includes('engineerpayments'))) {
    pass('accent folding leaves standalone separator characters splitting words (#2207)');
  } else {
    fail(`accent folding swallowed a separator character: ${JSON.stringify(separatorTokens)}`);
  }

  // The phantom token is shared by every accented title, so it acted as a
  // discriminating overlap and pushed two unrelated roles past the Jaccard
  // threshold — exactly what the baseline-token guard exists to prevent.
  if (!roleFuzzyMatch('Software Engineer Node.js Sênior', 'Software Engineer Flutter Sênior')) {
    pass('role matcher keeps accented sibling roles distinct (#2207)');
  } else {
    fail('role matcher collapsed two accented sibling roles via the phantom accent token');
  }

  // Worse than a generic collision: "Sênior" and "Júnior" both reduce to the
  // same "nior" phantom, so opposite seniority levels matched each other while
  // the seniority-disagreement gate saw no seniority token at all.
  if (!roleFuzzyMatch('Engenheiro de Dados Sênior', 'Engenheiro de Dados Júnior')) {
    pass('role matcher keeps accented Sênior and Júnior requisitions distinct (#2207)');
  } else {
    fail('role matcher merged an accented Sênior req into an accented Júnior req');
  }

  // The same defect also caused false negatives: a genuine repost written once
  // with the accent and once without tokenized differently and never matched.
  if (roleFuzzyMatch('Engenheiro de Software Sênior, Pagamentos', 'Engenheiro de Software Senior, Pagamentos')) {
    pass('role matcher matches a repost across accented and unaccented spellings (#2207)');
  } else {
    fail('role matcher missed a repost that differs only by an accent');
  }

  // Folding must not over-merge: accented specialty words have to survive as
  // their own distinct tokens, not collapse into one another.
  if (!roleFuzzyMatch('Ingeniero de Software Sênior, Búsqueda', 'Ingeniero de Software Sênior, Pagos')) {
    pass('role matcher keeps accented specialty suffixes distinct after folding (#2207)');
  } else {
    fail('accent folding collapsed two distinct accented specialty suffixes');
  }

  // Folding is what lets the seniority gate see an accented qualifier at all.
  // Before it, "Sênior"/"Júnior" both reduced to the same "nior" phantom, which
  // survived as a non-baseline token on the qualified side only — so the
  // specialization-marker rule (strict subset + extra non-baseline word) fired
  // and returned false for BOTH. The gate itself never ran: extractSeniorities
  // saw no seniority token either way. That produced a right answer for the
  // wrong reason on "Júnior" and a plain false negative on "Sênior".
  //
  // After folding, the two cases separate on their actual meaning (#2009's
  // SUB_BASELINE_SENIORITY rule): "senior" is routinely added or dropped
  // between reposts of one req, while "junior" marks a genuinely lower-level
  // req with its own scope and req ID.
  if (roleFuzzyMatch('Sênior Product Manager, Marketplace', 'Product Manager, Marketplace')) {
    pass('accent folding lets a lone accented "Sênior" be read as the same req (#2207)');
  } else {
    fail('accented "Sênior" still blocked a repost of the same requisition');
  }

  if (!roleFuzzyMatch('Júnior Product Manager, Marketplace', 'Product Manager, Marketplace')) {
    pass('accent folding routes a lone accented "Júnior" through the sub-baseline gate (#2207)');
  } else {
    fail('accented "Júnior" collapsed a sub-baseline req into the bare title');
  }

  const dedupTmp = mkdtempSync(join(tmpdir(), 'jobber-dedup-'));
  try {
    mkdirSync(join(dedupTmp, 'data'));
    const tracker = join(dedupTmp, 'data', 'applications.md');
    writeFileSync(tracker,
      '# Applications Tracker\n\n' +
      '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n' +
      '|---|------|---------|------|-------|--------|-----|--------|-------|\n' +
      '| 21 | 2026-01-08 | Acme | Full Stack Engineer, Foundation | 3.9/5 | Applied | ❌ | [21](../reports/021-foundation.md) | applied sibling |\n' +
      '| 22 | 2026-01-08 | Acme | Full Stack Engineer, Guarded Releases | 4.3/5 | Evaluated | ❌ | [22](../reports/022-guarded.md) | evaluated sibling |\n' +
      '| 23 | 2026-01-08 | Acme | Staff Software Engineer, API | 4.0/5 | Evaluated | ❌ | [23](../reports/023-api.md) | acronym sibling |\n' +
      '| 24 | 2026-01-08 | Acme | Staff Software Engineer, SDK | 4.2/5 | Evaluated | ❌ | [24](../reports/024-sdk.md) | acronym sibling |\n' +
      '| 25 | 2026-01-08 | Acme | Product Engineer, Growth | 3.8/5 | Evaluated | ❌ | [25](../reports/025-growth-old.md) | duplicate old |\n' +
      '| 26 | 2026-01-09 | Acme | Product Engineer, Growth | 4.0/5 | Evaluated | ❌ | [26](../reports/026-growth-new.md) | duplicate new |\n' +
      '| 27 | 2026-01-08 | Acme | Solutions Engineer, Revenue | 3.0/5 | Applied | ❌ | [27](../reports/027-revenue-applied.md) | applied exact-title row |\n' +
      '| 28 | 2026-01-09 | Acme | Solutions Engineer, Revenue | 4.6/5 | Evaluated | ❌ | [28](../reports/028-revenue-eval.md) | evaluated exact-title row |\n' +
      '| 29 | 2026-01-08 | Acme | Data Engineer, Search | 3.1/5 | Applied | ❌ | [29](../reports/029-search-old.md) | malformed duplicate-number old row |\n' +
      '| 29 | 2026-01-09 | Acme | Data Engineer, Search | 4.1/5 | Evaluated | ❌ | [30](../reports/030-search-new.md) | malformed duplicate-number new row |\n' +
      // Distinct sibling roles at one company that the old fuzzy matcher
      // false-merged (shared [software, engineer, infrastructure] → Jaccard 0.6).
      // Exact company+title matching must keep both openings.
      '| 31 | 2026-01-10 | Cohere | Software Engineer, Data Infrastructure | 3.4/5 | Evaluated | ❌ | [31](../reports/013-cohere-data-infra.md) | distinct role — must survive |\n' +
      '| 32 | 2026-01-10 | Cohere | Senior Software Engineer, Agent Infrastructure | 4.0/5 | Evaluated | ❌ | [32](../reports/014-cohere-agent-infra.md) | distinct role — higher score |\n' +
      // Exact company+role duplicate of #32 (same title, both Evaluated) — must
      // collapse to one, keeping the higher score.
      '| 33 | 2026-01-11 | Cohere | Senior Software Engineer, Agent Infrastructure | 3.7/5 | Evaluated | ❌ | [33](../reports/033-cohere-agent-dup.md) | exact-title duplicate |\n');

    const dedupResult = run(NODE, ['dedup-tracker.mjs'], { env: { ...process.env, JOBBER_TRACKER: tracker } });
    if (dedupResult === null) {
      fail('dedup-tracker.mjs crashed during shared role matcher safety test');
    } else {
      const deduped = readFileSync(tracker, 'utf-8');

      if (deduped.includes('Full Stack Engineer, Foundation') && deduped.includes('Full Stack Engineer, Guarded Releases')) {
        pass('dedup-tracker preserves distinct Full Stack Engineer sibling rows');
      } else {
        fail('dedup-tracker removed a distinct Full Stack Engineer sibling row');
      }

      if (deduped.includes('Staff Software Engineer, API') && deduped.includes('Staff Software Engineer, SDK')) {
        pass('dedup-tracker preserves short-acronym sibling rows');
      } else {
        fail('dedup-tracker removed a short-acronym sibling row');
      }

      const growthRows = deduped.split('\n').filter(l => l.includes('Product Engineer, Growth'));
      if (growthRows.length === 1 && growthRows[0].includes('4.0/5')) {
        pass('dedup-tracker still removes a real duplicate evaluated row');
      } else {
        fail(`dedup-tracker duplicate handling broken: ${growthRows.length} Growth rows`);
      }

      const revenueRows = deduped.split('\n').filter(l => l.includes('Solutions Engineer, Revenue'));
      if (revenueRows.length === 2 && revenueRows.some(l => l.includes('Applied'))) {
        pass('dedup-tracker never removes Applied+ rows by fuzzy title match');
      } else {
        fail('dedup-tracker removed an Applied+ row by fuzzy title match');
      }

      const searchRows = deduped.split('\n').filter(l => l.includes('Data Engineer, Search'));
      if (searchRows.length === 1 && searchRows[0].includes('4.1/5') && searchRows[0].includes('Applied')) {
        pass('dedup-tracker handles duplicate tracker numbers using row-local line indexes');
      } else {
        fail(`dedup-tracker duplicate-number handling broken: ${searchRows.length} Search rows`);
      }

      // Regression: the old fuzzy matcher scored "Software Engineer, Data
      // Infrastructure" and "Senior Software Engineer, Agent Infrastructure" at
      // Jaccard 0.6 and deleted the lower-scored distinct role. Exact
      // company+title matching must keep both openings.
      const cohereDataInfra = deduped.split('\n').filter(l => l.includes('| Software Engineer, Data Infrastructure |'));
      if (cohereDataInfra.length === 1) {
        pass('dedup-tracker keeps distinct same-company Cohere role (Data Infrastructure) — no fuzzy false-merge');
      } else {
        fail(`dedup-tracker false-merged the distinct Cohere Data Infrastructure role: ${cohereDataInfra.length} rows`);
      }

      const cohereAgentInfra = deduped.split('\n').filter(l => l.includes('| Senior Software Engineer, Agent Infrastructure |'));
      if (cohereAgentInfra.length === 1 && cohereAgentInfra[0].includes('4.0/5')) {
        pass('dedup-tracker merges an exact company+role duplicate to one (keeps highest score)');
      } else {
        fail(`dedup-tracker exact-duplicate handling broken: ${cohereAgentInfra.length} Cohere Agent Infrastructure rows`);
      }
    }
  } finally {
    rmSync(dedupTmp, { recursive: true, force: true });
  }
} catch (e) {
  fail(`shared role matcher / dedup safety tests crashed: ${e.message}`);
}

// dedup-tracker / normalize-statuses rebuilt promoted rows with
// `parts.slice(1, -1)`, which assumes the closing `|` produced a trailing empty
// cell. A valid row written WITHOUT a trailing pipe keeps its real last cell
// (the notes) at the end, so the old reconstruction silently dropped the notes
// when promoting a keeper's status during dedup. rebuildRow() now preserves it.
// Moved to tests/tracker-rebuild-parse.test.mjs (auto-discovered): the
// dedup row rebuild, tracker-utils rebuildRow() and tracker-parse column
// mapping checks.

// #1431 "Apply to #13" is ambiguous: report numbers and tracker row numbers
// diverge, and mapping company ↔ report# ↔ tracker# ↔ PDF used to require
// opening three files. find.mjs resolves a report#, tracker#, or company/role
// fragment to the full pipeline identity in one read-only lookup.
console.log('\n🧪 Testing find.mjs pipeline identity lookup...');
try {
  const { parseTrackerRows, parsePdfIndex, findMatches } = await import(pathToFileURL(join(ROOT, 'find.mjs')).href);

  // Tracker# and report# intentionally diverge: row 3 carries report 12, and a
  // different row is numbered 12 — the exact friction the tool exists to solve.
  const rows = parseTrackerRows([
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
    '|---|------|---------|------|-------|--------|-----|--------|-------|',
    '| 3 | 2026-06-01 | Acme Labs | Platform Engineer | 4.2/5 | **Applied** (2026-06-02) | ✅ | [12](reports/012-acme-labs-2026-06-01.md) | strong fit |',
    '| 12 | 2026-06-10 | Globex | Data Engineer | 3.8/5 | Evaluated | ❌ | [15](reports/015-globex-2026-06-10.md) | — |',
  ].join('\n'));
  const pdfIndex = parsePdfIndex(
    '# report\tpdf\thtml\tformat\tdate — written by generate-pdf.mjs, do not edit\n' +
    '012\toutput/cv-acme-labs.pdf\toutput/cv-acme-labs.html\tats\t2026-06-01\n');

  const byTracker = findMatches(rows, '3', pdfIndex);
  if (byTracker.length === 1 && byTracker[0].company === 'Acme Labs' &&
      byTracker[0].trackerNum === 3 && byTracker[0].reportNum === '12' &&
      byTracker[0].reportPath === 'reports/012-acme-labs-2026-06-01.md' &&
      byTracker[0].status === 'Applied' &&
      byTracker[0].pdfPath === 'output/cv-acme-labs.pdf') {
    pass('find.mjs resolves a tracker# to company, report#, canonical status, and PDF path');
  } else {
    fail(`find.mjs tracker# lookup wrong: ${JSON.stringify(byTracker)}`);
  }

  // "12" is both Acme's report# and Globex's tracker# — both rows must surface
  // (with the zero-padded "012" report-link form treated as the same number).
  const ambiguous = findMatches(rows, '012', pdfIndex);
  const companies = ambiguous.map(m => m.company).sort();
  if (ambiguous.length === 2 && companies[0] === 'Acme Labs' && companies[1] === 'Globex') {
    pass('find.mjs surfaces report#/tracker# collisions as multiple matches (zero-pad normalized)');
  } else {
    fail(`find.mjs numeric collision lookup wrong: ${JSON.stringify(ambiguous)}`);
  }

  const byFragment = findMatches(rows, 'acme', pdfIndex);
  if (byFragment.length === 1 && byFragment[0].company === 'Acme Labs') {
    pass('find.mjs matches a case-insensitive company fragment');
  } else {
    fail(`find.mjs company fragment lookup wrong: ${JSON.stringify(byFragment)}`);
  }

  // Fuzzy multi-word lookup reuses role-matcher.mjs (stopwords like "remote"
  // dropped) instead of reinventing matching.
  const byFuzzy = findMatches(rows, 'remote data engineer', pdfIndex);
  if (byFuzzy.length === 1 && byFuzzy[0].company === 'Globex' && byFuzzy[0].pdfPath === null) {
    pass('find.mjs fuzzy-matches a role phrase via role-matcher and reports a missing PDF');
  } else {
    fail(`find.mjs fuzzy role lookup wrong: ${JSON.stringify(byFuzzy)}`);
  }

  if (findMatches(rows, 'no-such-company', pdfIndex).length === 0) {
    pass('find.mjs returns zero matches cleanly for an unknown query');
  } else {
    fail('find.mjs matched a query that exists nowhere in the tracker');
  }
} catch (e) {
  fail(`find.mjs unit test crashed: ${e.message}`);
}

// dedup-tracker reads AND writes by column; with a Location column its status
// promotion must target the Status cell, not fixed parts[6].
console.log('\n🧪 Testing dedup-tracker with an inserted Location column...');
try {
  const locTmp = mkdtempSync(join(tmpdir(), 'jobber-dedup-loc-'));
  try {
    mkdirSync(join(locTmp, 'data'));
    const tracker = join(locTmp, 'data', 'applications.md');
    // Two dup rows (same company+role) with a Location column. Keeper #60 has the
    // higher score but the lower status; dedup must promote its Status cell.
    writeFileSync(tracker,
      '# Applications Tracker\n\n' +
      '| # | Date | Company | Role | Location | Score | Status | PDF | Report | Notes |\n' +
      '|---|------|---------|------|----------|-------|--------|-----|--------|-------|\n' +
      '| 60 | 2026-02-01 | Globex | Widget Engineer | Berlin | 4.5/5 | Rejected | ❌ | [60](r.md) | LOC_SENTINEL |\n' +
      '| 61 | 2026-02-02 | Globex | Widget Engineer | Berlin | 3.0/5 | Evaluated | ❌ | [61](r.md) | dup |\n');

    const r = run(NODE, ['dedup-tracker.mjs'], { env: { ...process.env, JOBBER_TRACKER: tracker } });
    if (r === null) {
      fail('dedup-tracker crashed on a Location-column tracker');
    } else {
      const out = readFileSync(tracker, 'utf-8');
      const keeper = out.split('\n').find(l => l.includes('| 60 |'));
      // Status cell promoted to Evaluated; Location (Berlin) and the score untouched.
      if (keeper && keeper.includes('Berlin') && keeper.includes('4.5/5') && keeper.includes('Evaluated') && keeper.includes('LOC_SENTINEL')) {
        pass('dedup-tracker promotes the Status cell (not a fixed index) on a Location-column tracker');
      } else {
        fail(`dedup-tracker mis-handled a Location-column row: "${keeper}"`);
      }
    }
  } finally {
    rmSync(locTmp, { recursive: true, force: true });
  }
} catch (e) {
  fail(`dedup-tracker Location-column test crashed: ${e.message}`);
}
