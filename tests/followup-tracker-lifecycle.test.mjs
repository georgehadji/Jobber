/**
 * followup-tracker-lifecycle.test.mjs — followup-cadence.mjs date helpers,
 * contact extraction, and cadence CLI (incl. an --config-driven e2e run in
 * an isolated copy); tracker report-link normalization (root-relative to
 * tracker-relative rewriting, #760); and the deterministic cold-start
 * onboarding-state detector.
 *
 * Extracted verbatim from test-all.mjs (see tests/README.md — discovered
 * files are auto-run by both test-all.mjs and test-runner.mjs).
 */

import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync, mkdirSync, realpathSync, copyFileSync, symlinkSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { execFileSync } from 'child_process';
import { pathToFileURL } from 'url';
import { pass, fail, ROOT, NODE, run } from './helpers.mjs';

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

// ── 12. FOLLOW-UP CADENCE LOGIC ─────────────────────────────────

console.log('\n12. Follow-up cadence logic');

try {
  const cadence = await import(pathToFileURL(join(ROOT, 'followup-cadence.mjs')).href);

  // CLI regression: the import.meta.url guard must still let the module run as a CLI.
  // Data-independent — default mode emits the result as JSON: a `metadata` object when
  // the tracker has applications, or an `{error}` object (exit 1) when it is empty.
  // Empty output would mean the guard wrongly suppressed main().
  let cliOut = '';
  try {
    cliOut = execFileSync(NODE, [join(ROOT, 'followup-cadence.mjs')], { cwd: ROOT, encoding: 'utf-8', timeout: 30000 });
  } catch (cliErr) {
    cliOut = `${cliErr.stdout || ''}`; // exit 1 on an empty tracker is expected; keep stdout
  }
  let cliJson = null;
  try { cliJson = JSON.parse(cliOut.trim()); } catch { /* leave null → fail below */ }
  if (cliJson && typeof cliJson === 'object' && ('metadata' in cliJson || 'error' in cliJson)) {
    pass('CLI still executes under the import.meta.url guard (emits result JSON)');
  } else {
    fail('CLI produced no structured JSON when run directly — import.meta.url guard may be broken');
  }

  // Date helpers
  if (cadence.addDays(cadence.parseDate('2026-05-01'), 7) === '2026-05-08') {
    pass('addDays advances a parsed date by N days (UTC)');
  } else {
    fail(`addDays produced ${cadence.addDays(cadence.parseDate('2026-05-01'), 7)}`);
  }
  if (cadence.daysBetween(cadence.parseDate('2026-05-01'), cadence.parseDate('2026-05-08')) === 7) {
    pass('daysBetween counts whole days between two dates');
  } else {
    fail('daysBetween miscounted');
  }
  if (cadence.parseDate('not-a-date') === null && cadence.parseDate('2026-05-01') instanceof Date) {
    pass('parseDate rejects malformed input and accepts ISO dates');
  } else {
    fail('parseDate validation wrong');
  }

  // extractContacts — recorded outreach is usually a NAME (LinkedIn produces no
  // email), so an email-only parser reports contacts: [] for rows that do have a
  // human attached. "no contact" then reads identically to "contact with no
  // email on file", which inverts the meaning of the field.
  {
    const nameOnly = cadence.extractContacts('reached out to recruiter Julia Masera (LinkedIn)');
    if (nameOnly.length === 1 && nameOnly[0].name === 'Julia Masera' && nameOnly[0].email === null) {
      pass('extractContacts finds a name-only contact with no email on file');
    } else {
      fail(`extractContacts name-only got ${JSON.stringify(nameOnly)}`);
    }
    if (nameOnly[0] && nameOnly[0].channel === 'linkedin') {
      pass('extractContacts carries the channel through when the notes name one');
    } else {
      fail(`extractContacts should report channel 'linkedin', got ${JSON.stringify(nameOnly[0])}`);
    }

    const emailed = cadence.extractContacts('Emailed Jane Doe at jane.doe@acme.com');
    if (emailed.length === 1 && emailed[0].email === 'jane.doe@acme.com' && emailed[0].channel === 'email') {
      pass('extractContacts still resolves an email contact (regression)');
    } else {
      fail(`extractContacts email-case got ${JSON.stringify(emailed)}`);
    }

    if (cadence.extractContacts('On-archetype fit; no submission yet').length === 0) {
      pass('extractContacts reports no contact when the notes carry none');
    } else {
      fail('extractContacts should find nothing in notes with no outreach');
    }

    // A bare capitalized word pair must not be mistaken for a contact — only a
    // named outreach verb qualifies, or the field fills with company names.
    if (cadence.extractContacts('Strong fit for Acme Corp; Series B').length === 0) {
      pass('extractContacts does not treat a capitalized company name as a contact');
    } else {
      fail(`extractContacts false-positived on a company name: ${JSON.stringify(cadence.extractContacts('Strong fit for Acme Corp; Series B'))}`);
    }

    // MULTIPLICITY: two contacts in one note, reached on DIFFERENT channels.
    // A whole-note channel scan tags both with whichever channel word appears
    // first, so the second contact is silently attributed to the wrong channel.
    {
      const two = cadence.extractContacts('Messaged recruiter Asha Beirne on LinkedIn; called hiring manager Bob Smith');
      const asha = two.find(c => c.name === 'Asha Beirne');
      const bob = two.find(c => c.name === 'Bob Smith');
      if (two.length === 2 && asha && bob) {
        pass('extractContacts finds both contacts when one note names two people');
      } else {
        fail(`extractContacts two-contact case got ${JSON.stringify(two)}`);
      }
      if (asha?.channel === 'linkedin' && bob?.channel === 'phone') {
        pass('extractContacts derives each contact channel from its own statement, not the whole note');
      } else {
        fail(`per-contact channel wrong: asha=${JSON.stringify(asha?.channel)} bob=${JSON.stringify(bob?.channel)}`);
      }
    }

    // MERGE: one outreach statement naming a person AND their email is ONE
    // contact, not an email-only contact plus a separate name-only duplicate.
    {
      const merged = cadence.extractContacts('contacted Jane Doe at jane.doe@acme.com');
      if (merged.length === 1 && merged[0].name === 'Jane Doe' && merged[0].email === 'jane.doe@acme.com') {
        pass('extractContacts merges a name and email from the same outreach statement');
      } else {
        fail(`extractContacts merge-case got ${JSON.stringify(merged)}`);
      }
    }

    // DEDUP: the same address repeated in a note is one contact, not two.
    {
      const repeated = cadence.extractContacts('emailed jane.doe@acme.com; followed up jane.doe@acme.com');
      if (repeated.length === 1) {
        pass('extractContacts deduplicates a repeated email address');
      } else {
        fail(`extractContacts repeated-email got ${JSON.stringify(repeated)}`);
      }
      // Address case must not defeat the dedup.
      const cased = cadence.extractContacts('emailed Jane.Doe@Acme.com; then jane.doe@acme.com again');
      if (cased.length === 1) {
        pass('extractContacts deduplicates emails case-insensitively');
      } else {
        fail(`extractContacts case-variant email got ${JSON.stringify(cased)}`);
      }
    }

    // The same person named twice across statements stays one contact.
    {
      const dup = cadence.extractContacts('messaged recruiter Ryan Hill; recruiter Ryan Hill replied');
      if (dup.length === 1 && dup[0].name === 'Ryan Hill') {
        pass('extractContacts does not double-count a person named in two statements');
      } else {
        fail(`extractContacts repeated-name got ${JSON.stringify(dup)}`);
      }
    }

    // LATE BRIDGE: a name-only and an email-only record can be recorded
    // separately, then a later statement names BOTH and proves they are one
    // person. Leaving two records behind reports two contacts where the note
    // itself says there is one.
    {
      const bridged = cadence.extractContacts('recruiter Ann Lee; emailed ann.lee@acme.com; contacted Ann Lee at ann.lee@acme.com');
      if (bridged.length === 1 && bridged[0].name === 'Ann Lee' && bridged[0].email === 'ann.lee@acme.com') {
        pass('extractContacts coalesces name-only and email-only records once a later statement bridges them');
      } else {
        fail(`extractContacts late-bridge got ${JSON.stringify(bridged)}`);
      }
    }

    // A hyphenated or apostrophed name is still a name. Dropping it reports
    // "no contact" for a row that names a person, which is the exact silence
    // this parser exists to remove.
    {
      const punct = cadence.extractContacts('reached out to recruiter Mary-Jane O’Brien (LinkedIn)');
      if (punct.length === 1 && punct[0].name === 'Mary-Jane O’Brien') {
        pass('extractContacts handles hyphenated and apostrophed names');
      } else {
        fail(`extractContacts punctuated-name got ${JSON.stringify(punct)}`);
      }
    }

    // An email with no name attached still yields a contact (name null).
    {
      const bare = cadence.extractContacts('sent CV to careers@acme.com');
      if (bare.length === 1 && bare[0].email === 'careers@acme.com' && bare[0].name === null) {
        pass('extractContacts keeps a bare email contact with no name');
      } else {
        fail(`extractContacts bare-email got ${JSON.stringify(bare)}`);
      }
    }

    // The summary printer reads contacts[0].email directly; a name-only contact
    // must not surface as a literal "null" in that column.
    const label = cadence.contactLabel(cadence.extractContacts('messaged recruiter Asha Beirne')[0]);
    if (label === 'Asha Beirne') {
      pass('contactLabel shows the name when the contact has no email');
    } else {
      fail(`contactLabel should fall back to the name, got ${JSON.stringify(label)}`);
    }
  }

  // parseAppliedDate — extracts the real submission date from notes (the
  // tracker `date` column is the evaluation date), case-insensitive.
  if (cadence.parseAppliedDate('Applied 2026-06-09 via Personio; raised part-time') === '2026-06-09') {
    pass('parseAppliedDate extracts "Applied YYYY-MM-DD" from notes');
  } else {
    fail(`parseAppliedDate got ${JSON.stringify(cadence.parseAppliedDate('Applied 2026-06-09 via Personio; raised part-time'))}`);
  }
  if (cadence.parseAppliedDate('APPLIED 2026-06-17 (German CV; jobId=104170)') === '2026-06-17') {
    pass('parseAppliedDate is case-insensitive (APPLIED)');
  } else {
    fail('parseAppliedDate should match uppercase APPLIED');
  }
  // First "Applied" date wins even when a later status date follows.
  if (cadence.parseAppliedDate('Applied 2026-06-09. No response; discarded 2026-06-18.') === '2026-06-09') {
    pass('parseAppliedDate takes the first applied date, not a later status date');
  } else {
    fail('parseAppliedDate should take the first applied date');
  }
  if (cadence.parseAppliedDate('On-archetype fit; no submission yet') === null && cadence.parseAppliedDate('') === null) {
    pass('parseAppliedDate returns null when notes carry no applied date');
  } else {
    fail('parseAppliedDate should return null without an applied date');
  }
  // "reapplied" must not be mistaken for an applied date (word boundary).
  if (cadence.parseAppliedDate('reapplied 2026-06-09 after rejection') === null) {
    pass('parseAppliedDate does not match inside "reapplied"');
  } else {
    fail('parseAppliedDate should not match the date inside "reapplied"');
  }
  // An estimated apply date is written "Applied ~YYYY-MM-DD". Without tolerating
  // the tilde the note is skipped and the cadence silently falls back to the
  // evaluation date — the same wrong-age failure the notes lookup exists to fix.
  if (cadence.parseAppliedDate('Applied ~2026-06-09 (date estimated)') === '2026-06-09') {
    pass('parseAppliedDate tolerates an estimated "Applied ~YYYY-MM-DD" date');
  } else {
    fail(`parseAppliedDate should tolerate "~", got ${JSON.stringify(cadence.parseAppliedDate('Applied ~2026-06-09 (date estimated)'))}`);
  }
  if (cadence.parseAppliedDate('reapplied ~2026-06-09 after rejection') === null) {
    pass('parseAppliedDate still refuses "reapplied" when a tilde is present');
  } else {
    fail('parseAppliedDate must not match inside "reapplied" even with a tilde');
  }
  // A malformed value must be rejected, not silently truncated to a plausible
  // date. Truncating "2026-06-091" to "2026-06-09" would be reported as a
  // measured application date and quietly shift the whole cadence — worse than
  // the honest evaluation-date fallback, because nothing marks it as a guess.
  const trailingJunk = [
    ['Applied 2026-06-091', 'a trailing digit'],
    ['Applied ~2026-06-091', 'a trailing digit after a tilde'],
    ['Applied 2026-06-09-foo', 'a hyphenated suffix'],
    ['Applied 2026-06-09foo', 'an unseparated word suffix'],
    ['Applied 2026-06-09_v2', 'an underscore suffix'],
    ['Applied 2026-06-09-2026-06-10', 'an ambiguous date range'],
  ];
  for (const [notes, label] of trailingJunk) {
    if (cadence.parseAppliedDate(notes) === null) {
      pass(`parseAppliedDate rejects ${label} instead of truncating (${notes})`);
    } else {
      fail(`parseAppliedDate should reject ${label}, got ${JSON.stringify(cadence.parseAppliedDate(notes))} from ${JSON.stringify(notes)}`);
    }
  }
  // A leading digit is the mirror-image malformation and must fail the same way.
  if (cadence.parseAppliedDate('Applied 12026-06-09') === null) {
    pass('parseAppliedDate rejects a leading extra digit');
  } else {
    fail(`parseAppliedDate should reject "Applied 12026-06-09", got ${JSON.stringify(cadence.parseAppliedDate('Applied 12026-06-09'))}`);
  }
  // Rejecting a malformed candidate must not swallow a valid one later in the
  // note — the scan has to continue past the bad match, not stop at it.
  if (cadence.parseAppliedDate('Applied 2026-06-091 (typo); Applied 2026-06-17 for real') === '2026-06-17') {
    pass('parseAppliedDate skips a malformed date and takes the next valid one');
  } else {
    fail(`parseAppliedDate should skip the malformed date, got ${JSON.stringify(cadence.parseAppliedDate('Applied 2026-06-091 (typo); Applied 2026-06-17 for real'))}`);
  }
  // A date can match the token shape and still not exist. These must not be
  // returned as MEASURED application dates: parseDate() rolls them over
  // (2026-06-31 -> 2026-07-01), so an impossible date silently becomes a real
  // but wrong one and shifts the cadence by days. The honest
  // evaluation-date fallback is strictly better than a fabricated date.
  const impossibleDates = [
    ['Applied 2026-06-31', 'a 31st in a 30-day month'],
    ['Applied 2026-02-30', 'a 30th in February'],
    ['Applied 2026-02-29', 'a 29th of February in a non-leap year'],
    ['Applied 2026-13-01', 'a 13th month'],
    ['Applied 2026-00-10', 'a zero month'],
    ['Applied 2026-06-00', 'a zero day'],
  ];
  const VALIDATE = { requireValidCalendarDate: true };
  for (const [notes, label] of impossibleDates) {
    if (cadence.parseAppliedDate(notes, VALIDATE) === null) {
      pass(`parseAppliedDate rejects ${label} when calendar validation is requested (${notes})`);
    } else {
      fail(`parseAppliedDate should reject ${label}, got ${JSON.stringify(cadence.parseAppliedDate(notes, VALIDATE))} from ${JSON.stringify(notes)}`);
    }
  }
  // Validation is OPT-IN. followup-seed.mjs depends on receiving the raw
  // candidate so it can throw INVALID_DATE and make the user fix the typo;
  // filtering unconditionally would turn that loud, fixable error into a
  // silent wrong answer.
  if (cadence.parseAppliedDate('Applied 2026-06-31') === '2026-06-31') {
    pass('parseAppliedDate returns the raw candidate by default so callers can reject it loudly');
  } else {
    fail(`parseAppliedDate default mode must not swallow an impossible date, got ${JSON.stringify(cadence.parseAppliedDate('Applied 2026-06-31'))}`);
  }
  // A real leap day must still be accepted — the validity check must not
  // over-reject.
  if (cadence.parseAppliedDate('Applied 2024-02-29', VALIDATE) === '2024-02-29') {
    pass('parseAppliedDate accepts a real leap day under validation');
  } else {
    fail(`parseAppliedDate should accept 2024-02-29, got ${JSON.stringify(cadence.parseAppliedDate('Applied 2024-02-29', VALIDATE))}`);
  }
  // The continued-scan contract applies to calendar-invalid candidates too.
  if (cadence.parseAppliedDate('Applied 2026-06-31; corrected: Applied 2026-06-30', VALIDATE) === '2026-06-30') {
    pass('parseAppliedDate skips an impossible date and takes the next valid one');
  } else {
    fail(`parseAppliedDate should skip the impossible date, got ${JSON.stringify(cadence.parseAppliedDate('Applied 2026-06-31; corrected: Applied 2026-06-30', VALIDATE))}`);
  }
  // isRealCalendarDate is exported so callers share one definition of validity.
  if (cadence.isRealCalendarDate('2024-02-29') && !cadence.isRealCalendarDate('2026-02-29') && !cadence.isRealCalendarDate('nope')) {
    pass('isRealCalendarDate distinguishes a real leap day from an impossible one');
  } else {
    fail('isRealCalendarDate mis-classifies a calendar date');
  }
  // Date.UTC() maps years 0-99 onto 1900-1999, so a literal ISO year below
  // 0100 would be validated against the wrong year entirely.
  if (cadence.isRealCalendarDate('0096-02-29') && !cadence.isRealCalendarDate('0097-02-29')) {
    pass('isRealCalendarDate preserves a literal ISO year below 0100');
  } else {
    fail(`isRealCalendarDate mishandles a sub-0100 year: 0096-02-29=${cadence.isRealCalendarDate('0096-02-29')} 0097-02-29=${cadence.isRealCalendarDate('0097-02-29')}`);
  }
  // And the source must degrade to the fallback, not report a fabricated date.
  {
    const r = cadence.resolveAppliedDate({ date: '2026-06-01', notes: 'Applied 2026-06-31' });
    if (r.appliedDate === '2026-06-01' && r.appDateSource === 'evaluation-date-fallback') {
      pass('resolveAppliedDate falls back when the notes date is not a real calendar date');
    } else {
      fail(`resolveAppliedDate impossible-date case got ${JSON.stringify(r)}`);
    }
  }
  if (cadence.parseAppliedDate('Reapplied 2026-06-09; applied 2026-06-17') === '2026-06-17') {
    pass('parseAppliedDate skips a "reapplied" match and takes the next valid one');
  } else {
    fail(`parseAppliedDate should skip "reapplied" and continue, got ${JSON.stringify(cadence.parseAppliedDate('Reapplied 2026-06-09; applied 2026-06-17'))}`);
  }
  // Two valid dates: the first still wins (already covered for a status date;
  // this pins it for two literal "applied" mentions).
  if (cadence.parseAppliedDate('Applied 2026-06-09, then applied 2026-07-01 to a second req') === '2026-06-09') {
    pass('parseAppliedDate keeps the first of two "applied" dates');
  } else {
    fail(`parseAppliedDate should keep the first applied date, got ${JSON.stringify(cadence.parseAppliedDate('Applied 2026-06-09, then applied 2026-07-01 to a second req'))}`);
  }
  // Reverse ordering: a later malformed candidate must not disturb the earlier
  // valid match the scan already found.
  if (cadence.parseAppliedDate('Applied 2026-06-09; Applied 2026-06-171 (typo)') === '2026-06-09') {
    pass('parseAppliedDate keeps a valid first date despite a later malformed one');
  } else {
    fail(`parseAppliedDate should keep the valid first date, got ${JSON.stringify(cadence.parseAppliedDate('Applied 2026-06-09; Applied 2026-06-171 (typo)'))}`);
  }
  // Boundary characters that legitimately terminate a date must keep matching —
  // a boundary guard that also rejects these would break real tracker notes.
  const validTerminators = [
    ['Applied 2026-06-09', 'end of string'],
    ['Applied 2026-06-09.', 'a period'],
    ['Applied 2026-06-09; noted', 'a semicolon'],
    ['Applied 2026-06-09)', 'a closing paren'],
    ['Applied 2026-06-09\nvia Personio', 'a newline'],
  ];
  for (const [notes, label] of validTerminators) {
    if (cadence.parseAppliedDate(notes) === '2026-06-09') {
      pass(`parseAppliedDate still matches a date terminated by ${label}`);
    } else {
      fail(`parseAppliedDate should match with ${label}, got ${JSON.stringify(cadence.parseAppliedDate(notes))} from ${JSON.stringify(notes)}`);
    }
  }
  // Nullish notes must not throw (the tracker's Notes cell can be absent).
  if (cadence.parseAppliedDate(null) === null && cadence.parseAppliedDate(undefined) === null) {
    pass('parseAppliedDate returns null for nullish notes');
  } else {
    fail('parseAppliedDate should return null for null/undefined notes');
  }

  // resolveAppliedDate — reports WHICH date the cadence is measured from, so a
  // consumer can tell a real application date from the evaluation-date proxy.
  // Without it a fallback age is indistinguishable from a measured one.
  {
    const measured = cadence.resolveAppliedDate({ date: '2026-06-01', notes: 'Applied 2026-06-09 via Personio' });
    if (measured.appliedDate === '2026-06-09' && measured.appDateSource === 'notes') {
      pass('resolveAppliedDate reports source "notes" when the apply date is recorded');
    } else {
      fail(`resolveAppliedDate notes-case got ${JSON.stringify(measured)}`);
    }

    const inferred = cadence.resolveAppliedDate({ date: '2026-06-01', notes: 'On-archetype fit; no submission yet' });
    if (inferred.appliedDate === '2026-06-01' && inferred.appDateSource === 'evaluation-date-fallback') {
      pass('resolveAppliedDate flags the evaluation-date proxy as a fallback, not a measured date');
    } else {
      fail(`resolveAppliedDate fallback-case got ${JSON.stringify(inferred)}`);
    }

    const estimated = cadence.resolveAppliedDate({ date: '2026-06-01', notes: 'Applied ~2026-06-09' });
    if (estimated.appliedDate === '2026-06-09' && estimated.appDateSource === 'notes') {
      pass('resolveAppliedDate treats an estimated "~" apply date as a recorded date, not a fallback');
    } else {
      fail(`resolveAppliedDate estimated-case got ${JSON.stringify(estimated)}`);
    }

    // A malformed note must degrade to the honest fallback, not to a truncated
    // date wearing the "notes" provenance label.
    const malformed = cadence.resolveAppliedDate({ date: '2026-06-01', notes: 'Applied 2026-06-091 (typo)' });
    if (malformed.appliedDate === '2026-06-01' && malformed.appDateSource === 'evaluation-date-fallback') {
      pass('resolveAppliedDate falls back rather than trusting a truncated apply date');
    } else {
      fail(`resolveAppliedDate malformed-case got ${JSON.stringify(malformed)}`);
    }
  }

  // analyze() output contract: every emitted entry must carry appDateSource, and
  // the value must match how the date was actually obtained. The unit tests above
  // only cover the helper — this pins the field on the JSON consumers read, which
  // is where a silently-inferred age would actually do damage.
  {
    // realpath: on macOS the tmpdir is a symlink, and followup-cadence.mjs's
    // CLI guard compares import.meta.url (realpath-resolved) against argv[1].
    // A symlinked path silently suppresses main() and yields empty stdout.
    const e2eTmp = realpathSync(mkdtempSync(join(tmpdir(), 'co-cadence-e2e-')));
    try {
      copyFileSync(join(ROOT, 'followup-cadence.mjs'), join(e2eTmp, 'followup-cadence.mjs'));
      copyFileSync(join(ROOT, 'tracker-parse.mjs'), join(e2eTmp, 'tracker-parse.mjs'));
      copyFileSync(join(ROOT, 'tracker-aliases.json'), join(e2eTmp, 'tracker-aliases.json'));
      symlinkSync(join(ROOT, 'node_modules'), join(e2eTmp, 'node_modules'), 'dir');
      mkdirSync(join(e2eTmp, 'data'), { recursive: true });
      writeFileSync(join(e2eTmp, 'data', 'applications.md'), [
        '# Applications Tracker',
        '',
        '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
        '|---|------|---------|------|-------|--------|-----|--------|-------|',
        '| 901 | 2026-06-01 | ExactCo | Head of AI | 4.5/5 | Applied | ✅ | [901](reports/901-exactco-2026-06-01.md) | Applied 2026-06-09 via Personio |',
        '| 902 | 2026-06-02 | EstimateCo | Head of AI | 4.4/5 | Applied | ✅ | [902](reports/902-estimateco-2026-06-02.md) | Applied ~2026-06-10 (date estimated) |',
        '| 903 | 2026-06-03 | FallbackCo | Head of AI | 4.3/5 | Applied | ✅ | [903](reports/903-fallbackco-2026-06-03.md) | On-archetype fit; no apply date recorded |',
        '| 904 | 2026-06-04 | TypoCo | Head of AI | 4.2/5 | Applied | ✅ | [904](reports/904-typoco-2026-06-04.md) | Applied 2026-06-091 typo in the tracker |',
        '',
      ].join('\n'), 'utf-8');

      const e2eOut = execFileSync(NODE, [join(e2eTmp, 'followup-cadence.mjs')], {
        cwd: e2eTmp,
        encoding: 'utf-8',
        timeout: 30000,
        env: { ...process.env, JOBBER_PROFILE: '' },
      });
      const e2e = JSON.parse(e2eOut.trim());
      const byNum = new Map((e2e.entries || []).map(entry => [entry.num, entry]));

      const e2eCases = [
        [901, '2026-06-09', 'notes', 'an exact "Applied YYYY-MM-DD" note'],
        [902, '2026-06-10', 'notes', 'an estimated "Applied ~YYYY-MM-DD" note'],
        [903, '2026-06-03', 'evaluation-date-fallback', 'notes with no apply date'],
        [904, '2026-06-04', 'evaluation-date-fallback', 'a malformed apply date in the notes'],
      ];
      for (const [num, expectedDate, expectedSource, label] of e2eCases) {
        const entry = byNum.get(num);
        if (entry && entry.appliedDate === expectedDate && entry.appDateSource === expectedSource) {
          pass(`analyze() emits appDateSource "${expectedSource}" for ${label}`);
        } else {
          fail(`analyze() entry #${num} (${label}) got ${JSON.stringify(entry && { appliedDate: entry.appliedDate, appDateSource: entry.appDateSource })}`);
        }
      }

      const missingSource = (e2e.entries || []).filter(entry => !['notes', 'evaluation-date-fallback'].includes(entry.appDateSource));
      if ((e2e.entries || []).length === 4 && missingSource.length === 0) {
        pass('analyze() stamps every emitted entry with a known appDateSource');
      } else {
        fail(`analyze() emitted ${(e2e.entries || []).length} entries, ${missingSource.length} without a known appDateSource`);
      }
    } catch (e2eErr) {
      fail(`analyze() appDateSource end-to-end check crashed: ${e2eErr.message}`);
    } finally {
      rmSync(e2eTmp, { recursive: true, force: true });
    }
  }

  // Status normalization (strips bold + trailing date, lowercases, maps aliases)
  if (cadence.normalizeStatus('**Applied** 2026-05-01') === 'applied') {
    pass('normalizeStatus strips bold + trailing date and lowercases');
  } else {
    fail(`normalizeStatus produced ${cadence.normalizeStatus('**Applied** 2026-05-01')}`);
  }

  const cadenceTmp = mkdtempSync(join(tmpdir(), 'co-cadence-'));
  const profilePath = join(cadenceTmp, 'profile.yml');
  writeFileSync(profilePath, [
    'followup_cadence:',
    '  applied_first_days: 11',
    '  applied_subsequent_days: 5',
    '  applied_max_followups: 4',
    '  responded_initial_days: 2',
    '  responded_subsequent_days: 6',
    '  interview_thankyou_days: 3',
  ].join('\n'));

  const profileCadence = cadence.resolveCadenceConfig({ profilePath });
  if (
    profileCadence.applied_first === 11 &&
    profileCadence.applied_subsequent === 5 &&
    profileCadence.applied_max_followups === 4 &&
    profileCadence.responded_initial === 2 &&
    profileCadence.responded_subsequent === 6 &&
    profileCadence.interview_thankyou === 3
  ) {
    pass('follow-up cadence reads profile.yml overrides');
  } else {
    fail(`profile cadence override failed: ${JSON.stringify(profileCadence)}`);
  }

  const cliCadence = cadence.resolveCadenceConfig({ profilePath, appliedDays: 9 });
  if (cliCadence.applied_first === 9 && cliCadence.applied_subsequent === 5) {
    pass('follow-up cadence CLI override wins over profile applied_first');
  } else {
    fail(`CLI cadence override failed: ${JSON.stringify(cliCadence)}`);
  }

  const malformedProfile = join(cadenceTmp, 'malformed.yml');
  writeFileSync(malformedProfile, 'followup_cadence: [');
  const fallbackCadence = cadence.resolveCadenceConfig({ profilePath: malformedProfile });
  if (fallbackCadence.applied_first === cadence.DEFAULT_CADENCE.applied_first) {
    pass('follow-up cadence ignores malformed optional profile config');
  } else {
    fail(`malformed profile did not fall back to defaults: ${JSON.stringify(fallbackCadence)}`);
  }

  rmSync(cadenceTmp, { recursive: true, force: true });

  // Urgency decision tree (CADENCE defaults: applied_first=7, max_followups=2, responded_initial=1, interview_thankyou=1)
  const urgencyCases = [
    [['applied', 7, null, 0], 'overdue', 'applied past applied_first → overdue'],
    [['applied', 3, null, 0], 'waiting', 'applied within window → waiting'],
    [['applied', 30, null, 2], 'cold', 'applied at max follow-ups → cold'],
    [['responded', 0, null, 0], 'urgent', 'responded before responded_initial → urgent'],
    [['interview', 1, null, 0], 'overdue', 'interview past thank-you window → overdue'],
  ];
  for (const [args, expected, label] of urgencyCases) {
    const got = cadence.computeUrgency(...args);
    if (got === expected) pass(`computeUrgency: ${label}`);
    else fail(`computeUrgency ${label}: expected ${expected}, got ${got}`);
  }

  // Next follow-up date scheduling
  const nextCases = [
    [['applied', '2026-05-01', null, 0], '2026-05-08', 'first applied follow-up = appDate + applied_first'],
    [['applied', '2026-05-01', null, 2], null, 'cold (max follow-ups) → null'],
    [['interview', '2026-05-01', null, 0], '2026-05-02', 'interview = appDate + interview_thankyou'],
  ];
  for (const [args, expected, label] of nextCases) {
    const got = cadence.computeNextFollowupDate(...args);
    if (got === expected) pass(`computeNextFollowupDate: ${label}`);
    else fail(`computeNextFollowupDate ${label}: expected ${expected}, got ${got}`);
  }
} catch (e) {
  fail(`follow-up cadence module crashed: ${e.message}`);
}

// ── 14b. ADD-ENTRY (/jobber add) ────────────────────────────────

console.log('\n14b. add-entry.mjs (dedup + insertion)');

try {
  const addMod = await import(pathToFileURL(join(ROOT, 'add-entry.mjs')).href);
  const { normalizeKey, locateSection, cvHasEntry, insertIntoCvSection, articleDigestHasEntry, applyAdd } = addMod;

  if (normalizeKey('Fraud-Shield!') === 'fraudshield') pass('normalizeKey strips punctuation/case');
  else fail(`normalizeKey => ${normalizeKey('Fraud-Shield!')}`);

  const sampleCv = [
    '# CV -- Test',
    '',
    '## Work Experience',
    '',
    '### Acme -- Remote',
    '',
    '**Engineer**',
    '2020-2022',
    '',
    '- Did things',
    '',
    '## Projects',
    '',
    '- **Existing** (OSS) -- already here',
    '',
    '## Education',
    '',
    '- BS CS',
    '',
  ].join('\n');

  // locateSection isolates the right block
  const loc = locateSection(sampleCv, 'Projects');
  if (loc && loc.body.includes('Existing') && !loc.body.includes('BS CS')) pass('locateSection isolates the Projects block');
  else fail(`locateSection => ${JSON.stringify(loc && loc.body)}`);

  // insertion appends within section and preserves later sections
  const inserted = insertIntoCvSection(sampleCv, 'Projects', '- **FraudShield** (OSS) -- fraud detection');
  if (inserted.includes('- **Existing**') && inserted.includes('- **FraudShield**') &&
      inserted.indexOf('FraudShield') < inserted.indexOf('## Education') &&
      inserted.includes('## Education')) {
    pass('insertIntoCvSection appends under Projects and keeps Education intact');
  } else {
    fail('insertIntoCvSection placement wrong');
  }

  // missing section is created at EOF
  const withPubs = insertIntoCvSection(sampleCv, 'Publications', '- **A Paper** (2026) -- venue');
  if (withPubs.includes('## Publications') && withPubs.includes('- **A Paper**')) pass('insertIntoCvSection creates a missing section');
  else fail('insertIntoCvSection did not create missing section');

  // dedup detection is punctuation/case-insensitive
  if (cvHasEntry(sampleCv, 'Projects', 'existing') && !cvHasEntry(sampleCv, 'Projects', 'FraudShield')) {
    pass('cvHasEntry detects an existing entry and misses a new one');
  } else {
    fail('cvHasEntry dedup logic wrong');
  }

  // applyAdd: fresh add to cv + article-digest (article-digest absent → created)
  const added = applyAdd(
    {
      cv: { section: 'Projects', dedupKey: 'FraudShield', entry: '- **FraudShield** (OSS) -- fraud detection' },
      articleDigest: { dedupKey: 'FraudShield', entry: '## FraudShield -- Detection\n\n**Hero metrics:** 99.7%' },
    },
    { cvText: sampleCv, articleText: null },
  );
  if (added.result.cv.status === 'added' && added.result.articleDigest.status === 'created' &&
      added.cv.includes('FraudShield') && added.articleDigest.includes('## FraudShield')) {
    pass('applyAdd adds a new CV entry and creates article-digest.md when absent');
  } else {
    fail(`applyAdd fresh-add => ${JSON.stringify(added.result)}`);
  }

  // applyAdd: idempotent — same payload against updated files is a no-op
  const again = applyAdd(
    {
      cv: { section: 'Projects', dedupKey: 'FraudShield', entry: '- **FraudShield** (OSS) -- fraud detection' },
      articleDigest: { dedupKey: 'FraudShield', entry: '## FraudShield -- Detection\n\n**Hero metrics:** 99.7%' },
    },
    { cvText: added.cv, articleText: added.articleDigest },
  );
  if (again.result.cv.status === 'duplicate' && again.result.articleDigest.status === 'duplicate') {
    pass('applyAdd is idempotent (duplicate/duplicate on re-run)');
  } else {
    fail(`applyAdd re-run => ${JSON.stringify(again.result)}`);
  }

  if (articleDigestHasEntry(added.articleDigest, 'fraud shield')) pass('articleDigestHasEntry matches normalized heading');
  else fail('articleDigestHasEntry failed to match');

  // guardrails: cv add against a missing cv.md throws; empty payload throws
  let threwNoCv = false;
  try { applyAdd({ cv: { section: 'Projects', dedupKey: 'X', entry: '- x' } }, { cvText: null }); } catch { threwNoCv = true; }
  if (threwNoCv) pass('applyAdd refuses to add to a missing cv.md');
  else fail('applyAdd should throw when cv.md is absent');

  let threwEmpty = false;
  try { applyAdd({}, { cvText: sampleCv }); } catch { threwEmpty = true; }
  if (threwEmpty) pass('applyAdd rejects an empty payload');
  else fail('applyAdd should reject an empty payload');

  // dedupKey is required — idempotency depends on it, so a missing one fails fast.
  let threwNoKey = false;
  try { applyAdd({ cv: { section: 'Projects', entry: '- **X** -- y' } }, { cvText: sampleCv }); } catch { threwNoKey = true; }
  if (threwNoKey) pass('applyAdd requires a dedupKey for a cv target');
  else fail('applyAdd should throw when cv.dedupKey is missing');

  // Short-key dedup must NOT collide with unrelated substrings (e.g. "ai" in a
  // bullet that mentions "email"). Regression for the identifier-based matcher.
  const cvWithEmail = '# CV\n\n## Projects\n\n- **Mailer** (OSS) -- sends email digests\n';
  if (!cvHasEntry(cvWithEmail, 'Projects', 'AI')) pass('cvHasEntry does not false-match a short key against unrelated text');
  else fail('cvHasEntry should not match "AI" against "email"');
  if (cvHasEntry(cvWithEmail, 'Projects', 'Mailer')) pass('cvHasEntry still matches the real bold identifier');
  else fail('cvHasEntry should match the bold entry name');

  // Same collision guard for article-digest headings (name before the dash).
  const adWithMailer = '# Article Digest\n\n---\n\n## Mailer -- Email digests\n\n**Hero metrics:** x\n';
  if (!articleDigestHasEntry(adWithMailer, 'AI')) pass('articleDigestHasEntry does not false-match a short key against a heading');
  else fail('articleDigestHasEntry should not match "AI" against the "Mailer -- Email digests" heading');
  if (articleDigestHasEntry(adWithMailer, 'Mailer')) pass('articleDigestHasEntry matches the real heading name');
  else fail('articleDigestHasEntry should match the heading name before the dash');

  // CLI wiring: --dry-run reports without writing; a real run writes and is then
  // idempotent. Exercised against isolated fixture files via env overrides.
  const cliTmp = mkdtempSync(join(tmpdir(), 'jobber-add-cli-'));
  try {
    const cvPath = join(cliTmp, 'cv.md');
    const adPath = join(cliTmp, 'article-digest.md');
    writeFileSync(cvPath, '# CV\n\n## Projects\n\n- **Existing** (OSS) -- here\n');
    const payloadPath = join(cliTmp, 'p.json');
    writeFileSync(payloadPath, JSON.stringify({
      cv: { section: 'Projects', dedupKey: 'CliProj', entry: '- **CliProj** (OSS) -- desc' },
      articleDigest: { dedupKey: 'CliProj', entry: '## CliProj -- Tagline\n\n**Hero metrics:** x' },
    }));
    const env = { ...process.env, JOBBER_CV: cvPath, JOBBER_ARTICLE_DIGEST: adPath };

    execFileSync(NODE, [join(ROOT, 'add-entry.mjs'), payloadPath, '--dry-run'], { env, encoding: 'utf-8' });
    if (!readFileSync(cvPath, 'utf-8').includes('CliProj') && !existsSync(adPath)) pass('add-entry CLI --dry-run writes nothing');
    else fail('add-entry CLI --dry-run should not write');

    const realOut = JSON.parse(execFileSync(NODE, [join(ROOT, 'add-entry.mjs'), payloadPath], { env, encoding: 'utf-8' }));
    if (realOut.cv.status === 'added' && realOut.articleDigest.status === 'created' &&
        readFileSync(cvPath, 'utf-8').includes('- **CliProj**') && readFileSync(adPath, 'utf-8').includes('## CliProj')) {
      pass('add-entry CLI real run writes cv.md + creates article-digest.md');
    } else {
      fail(`add-entry CLI real run => ${JSON.stringify(realOut)}`);
    }

    const rerun = JSON.parse(execFileSync(NODE, [join(ROOT, 'add-entry.mjs'), payloadPath], { env, encoding: 'utf-8' }));
    if (rerun.cv.status === 'duplicate' && rerun.articleDigest.status === 'duplicate') pass('add-entry CLI re-run is idempotent');
    else fail(`add-entry CLI re-run => ${JSON.stringify(rerun)}`);
  } finally {
    rmSync(cliTmp, { recursive: true, force: true });
  }

} catch (e) {
  fail(`add-entry tests crashed: ${e.message}`);
}

// ── 12. TRACKER REPORT LINK NORMALIZATION (#760) ────────────────

console.log('\n12. Tracker report-link normalization');

try {
  const { normalizeReportLink } = await import(pathToFileURL(join(ROOT, 'tracker-links.mjs')).href);
  const repo = '/repo';
  const dataDir = join(repo, 'data');

  // data/ layout: root-relative TSV link → ../reports/...
  const fromTsv = normalizeReportLink('[12](reports/012-acme-2026-01-04.md)', dataDir, repo);
  if (fromTsv === '[12](../reports/012-acme-2026-01-04.md)') {
    pass('data/ layout: root-relative link rewritten to ../reports/...');
  } else {
    fail(`data/ layout normalization wrong: ${fromTsv}`);
  }

  // Idempotent: re-running on an already-normalized link must not double-prefix
  const twice = normalizeReportLink(fromTsv, dataDir, repo);
  if (twice === fromTsv) {
    pass('normalization is idempotent (no double-prefix on re-run)');
  } else {
    fail(`normalization not idempotent: ${twice}`);
  }

  // Root layout: tracker at repo root → link stays reports/...
  const atRoot = normalizeReportLink('[12](reports/012-acme-2026-01-04.md)', repo, repo);
  if (atRoot === '[12](reports/012-acme-2026-01-04.md)') {
    pass('root layout: link stays root-relative reports/...');
  } else {
    fail(`root layout normalization wrong: ${atRoot}`);
  }

  // Non-report links are left untouched — including external URLs that happen
  // to contain an embedded "/reports/" segment (must not be rewritten).
  const other = normalizeReportLink('[site](https://example.com/reports/foo.md)', dataDir, repo);
  if (other === '[site](https://example.com/reports/foo.md)') {
    pass('non-report links (incl. URLs with embedded /reports/) are left untouched');
  } else {
    fail(`non-report link altered: ${other}`);
  }

  const pipelineProcessed = normalizeReportLink('[12](reports/012-acme-2026-01-04.md)', join(repo, 'data'), repo);
  if (pipelineProcessed === '[12](../reports/012-acme-2026-01-04.md)') {
    pass('pipeline processed links are relative to data/pipeline.md (#1126)');
  } else {
    fail(`pipeline processed link normalization wrong (#1126): ${pipelineProcessed}`);
  }

  // End-to-end migration against a fictional fixture tracker (no personal data)
  const tmpDir = mkdtempSync(join(tmpdir(), 'jobber-migrate-'));
  try {
    mkdirSync(join(tmpDir, 'data'));
    mkdirSync(join(tmpDir, 'reports'));
    writeFileSync(join(tmpDir, 'reports', '012-acme-2026-01-04.md'), '# fixture\n');
    const tracker = join(tmpDir, 'data', 'applications.md');
    writeFileSync(tracker,
      '# Applications Tracker\n\n' +
      '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n' +
      '|---|------|---------|------|-------|--------|-----|--------|-------|\n' +
      '| 12 | 2026-01-04 | Acme | Engineer | 4.2/5 | Evaluated | ✅ | [12](reports/012-acme-2026-01-04.md) | ok |\n');

    // Migrate by pointing the script at the fixture tracker via env override.
    run(NODE, ['merge-tracker.mjs', '--migrate'], { env: { ...process.env, JOBBER_TRACKER: tracker } });
    const after = readFileSync(tracker, 'utf-8');
    if (after.includes('[12](../reports/012-acme-2026-01-04.md)')) {
      pass('migration rewrites fixture tracker links to ../reports/...');
    } else {
      fail('migration did not rewrite fixture tracker link');
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }

  const { resolveReportPath } = await import(pathToFileURL(join(ROOT, 'followup-cadence.mjs')).href);
  const followupTmp = mkdtempSync(join(tmpdir(), 'jobber-followup-link-'));
  try {
    mkdirSync(join(followupTmp, 'data'), { recursive: true });
    mkdirSync(join(followupTmp, 'reports'), { recursive: true });
    const reportFile = join(followupTmp, 'reports', '012-acme-2026-01-04.md');
    writeFileSync(reportFile, '# fixture\n');
    const appsFile = join(followupTmp, 'data', 'applications.md');
    const resolved = resolveReportPath('[12](../reports/012-acme-2026-01-04.md)', appsFile, followupTmp);
    if (resolved === 'reports/012-acme-2026-01-04.md') {
      pass('follow-up reportPath is repo-root relative for data/ tracker links (#1126)');
    } else {
      fail(`follow-up reportPath wrong (#1126): ${resolved}`);
    }
    const escaped = resolveReportPath('[99](../../outside.md)', appsFile, followupTmp);
    if (escaped === null) {
      pass('follow-up reportPath rejects links outside reports/ (#1126)');
    } else {
      fail(`follow-up reportPath allowed escaped link (#1126): ${escaped}`);
    }
  } finally {
    rmSync(followupTmp, { recursive: true, force: true });
  }
} catch (e) {
  fail(`tracker-link normalization tests crashed: ${e.message}`);
}

// ── RESERVE-REPORT-NUM RANGE RESERVATION (#1426) ────────────────
// Manual multi-agent fan-outs need N report numbers up front. --count N
// reserves a contiguous range (per-slot atomic sentinels); tests run against
// a temp dir via the JOBBER_REPORTS_DIR override.
// Moved to tests/tracker-allocator-matcher.test.mjs and
// tests/merge-tracker-regressions.test.mjs (auto-discovered): reserve-report-num
// allocator, shared role matcher + dedup-tracker safety, find.mjs, dedup-tracker
// Location handling, and the merge-tracker regression fixtures (#751, #1603,
// #1427, #1429, #912, #1704, #1733, #2265, #1524, concurrent writes).

// ── 12. COLD-START TRIGGER ──────────────────────────────────────

console.log('\n12. Cold-start trigger (deterministic onboarding state)');

try {
  // Virgin env: none of the 4 user-layer prerequisites present → must onboard.
  const virgin = mkdtempSync(join(tmpdir(), 'co-cold-'));
  const v = JSON.parse(run(NODE, ['doctor.mjs', '--json', '--target', virgin]) || '{}');
  if (
    v.onboardingNeeded === true &&
    Array.isArray(v.missing) &&
    v.missing.length === 4 &&
    Array.isArray(v.warnings)
  ) {
    pass('Virgin env → onboarding triggered (4 prerequisites missing)');
  } else {
    fail(`Virgin env not flagged for onboarding: ${JSON.stringify(v)}`);
  }
  rmSync(virgin, { recursive: true, force: true });

  // Fully provisioned env: all 4 present → must NOT onboard.
  const ready = mkdtempSync(join(tmpdir(), 'co-ready-'));
  mkdirSync(join(ready, 'config'), { recursive: true });
  mkdirSync(join(ready, 'modes'), { recursive: true });
  for (const f of ['cv.md', 'config/profile.yml', 'modes/_profile.md', 'portals.yml']) {
    writeFileSync(join(ready, f), 'x');
  }
  const r = JSON.parse(run(NODE, ['doctor.mjs', '--json', '--target', ready]) || '{}');
  if (r.onboardingNeeded === false && Array.isArray(r.warnings)) {
    pass('Provisioned env → no onboarding');
  } else {
    fail(`Provisioned env falsely flagged for onboarding: ${JSON.stringify(r)}`);
  }
  rmSync(ready, { recursive: true, force: true });

  // Auto-copy template: when modes/_profile.md or modes/_custom.md is missing but template exists,
  // doctor --json auto-copies them, records them in autoCopied, and does not report them as missing (#1369).
  const autoCopy = mkdtempSync(join(tmpdir(), 'co-autocopy-'));
  mkdirSync(join(autoCopy, 'config'), { recursive: true });
  mkdirSync(join(autoCopy, 'modes'), { recursive: true });
  for (const f of ['cv.md', 'config/profile.yml', 'portals.yml']) {
    writeFileSync(join(autoCopy, f), 'x');
  }
  writeFileSync(join(autoCopy, 'modes/_profile.template.md'), '# profile template\n');
  writeFileSync(join(autoCopy, 'modes/_custom.template.md'), '# custom template\n');
  const ac = JSON.parse(run(NODE, ['doctor.mjs', '--json', '--target', autoCopy]) || '{}');
  if (
    ac.onboardingNeeded === false &&
    Array.isArray(ac.missing) &&
    ac.missing.length === 0 &&
    Array.isArray(ac.autoCopied) &&
    ac.autoCopied.includes('modes/_profile.md') &&
    ac.autoCopied.includes('modes/_custom.md') &&
    existsSync(join(autoCopy, 'modes/_profile.md')) &&
    readFileSync(join(autoCopy, 'modes/_profile.md'), 'utf-8') === '# profile template\n' &&
    existsSync(join(autoCopy, 'modes/_custom.md')) &&
    readFileSync(join(autoCopy, 'modes/_custom.md'), 'utf-8') === '# custom template\n'
  ) {
    pass('Auto-copy template → modes/_profile.md and modes/_custom.md copied silently in --json mode (#1369)');
  } else {
    fail(`Auto-copy template failed in --json mode: ${JSON.stringify(ac)}`);
  }
  rmSync(autoCopy, { recursive: true, force: true });

  const claudeDoc = readFile('CLAUDE.md');
  const agentsDoc = readFile('AGENTS.md');
  const claudeWrapperLines = claudeDoc.trim().split(/\r?\n/).filter(Boolean);
  if (
    /node\s+doctor\.mjs\s+--json/.test(agentsDoc) &&
    /"warnings"\s*:\s*\[\.\.\.\]/.test(agentsDoc) &&
    /"autoCopied"\s*:\s*\[\.\.\.\]/.test(agentsDoc) &&
    claudeWrapperLines[0] === '@AGENTS.md' &&
    claudeWrapperLines.length <= 8 &&
    !/Does\s+`cv\.md`\s+exist\?/i.test(claudeDoc)
  ) {
    pass('AGENTS.md delegates onboarding state and autoCopied to doctor --json; CLAUDE.md stays thin');
  } else {
    fail('AGENTS.md misses onboarding state docs or CLAUDE.md is not a thin wrapper');
  }
} catch (e) {
  fail(`Cold-start trigger test crashed: ${e.message}`);
}

// Moved to tests/tracker-derived-index.test.mjs (auto-discovered): the
// tracker.mjs SQLite derived-index round trip, corruption detection, staleness
// auto-resync, and status_events history (#918 phase 1).

// ── 12b. PLAYWRIGHT MCP DETECTION WARNING (#522) ────────────────

console.log('\n12d. Playwright MCP detection warning');

try {
  const doctorScript = readFile('doctor.mjs');
  if (
    !/Claude Code config/i.test(doctorScript) &&
    /project-level MCP config/i.test(doctorScript) &&
    /\.mcp\.json/.test(doctorScript) &&
    /\.claude\/settings\.json/.test(doctorScript) &&
    /\.claude\/settings\.local\.json/.test(doctorScript)
  ) {
    pass('doctor Playwright MCP guidance is agent-neutral and keeps conservative config detection');
  } else {
    fail('doctor Playwright MCP guidance is still Claude-specific or lost config detection');
  }

  // No project MCP config → doctor surfaces a (non-fatal) warning instead of
  // letting SPA job boards fail silently.
  const noMcp = mkdtempSync(join(tmpdir(), 'co-nomcp-'));
  const a = JSON.parse(run(NODE, ['doctor.mjs', '--json', '--target', noMcp]) || '{}');
  if (Array.isArray(a.warnings) && a.warnings.some((w) => /playwright mcp/i.test(w))) {
    pass('No Playwright MCP config → warning surfaced');
  } else {
    fail(`Expected a Playwright MCP warning, got: ${JSON.stringify(a.warnings)}`);
  }
  rmSync(noMcp, { recursive: true, force: true });

  // A project that registers a Playwright MCP server → no warning.
  const withMcp = mkdtempSync(join(tmpdir(), 'co-mcp-'));
  mkdirSync(join(withMcp, '.claude'), { recursive: true });
  writeFileSync(
    join(withMcp, '.claude', 'settings.json'),
    JSON.stringify({ mcpServers: { playwright: { command: 'npx', args: ['@playwright/mcp', '--headless'] } } }),
  );
  const b = JSON.parse(run(NODE, ['doctor.mjs', '--json', '--target', withMcp]) || '{}');
  if (Array.isArray(b.warnings) && !b.warnings.some((w) => /playwright mcp/i.test(w))) {
    pass('Playwright MCP configured → no warning');
  } else {
    fail(`Did not expect a Playwright MCP warning, got: ${JSON.stringify(b.warnings)}`);
  }
  rmSync(withMcp, { recursive: true, force: true });

  // Local Claude settings should also count as a valid MCP registration.
  const withLocalMcp = mkdtempSync(join(tmpdir(), 'co-local-mcp-'));
  mkdirSync(join(withLocalMcp, '.claude'), { recursive: true });
  writeFileSync(
    join(withLocalMcp, '.claude', 'settings.local.json'),
    JSON.stringify({ mcpServers: { browser: { command: 'npx', args: ['@playwright/mcp'] } } }),
  );
  const c = JSON.parse(run(NODE, ['doctor.mjs', '--json', '--target', withLocalMcp]) || '{}');
  if (Array.isArray(c.warnings) && !c.warnings.some((w) => /playwright mcp/i.test(w))) {
    pass('Playwright MCP configured via .claude/settings.local.json → no warning');
  } else {
    fail(`Did not expect a Playwright MCP warning for settings.local.json, got: ${JSON.stringify(c.warnings)}`);
  }
  rmSync(withLocalMcp, { recursive: true, force: true });
} catch (e) {
  fail(`Playwright MCP detection test crashed: ${e.message}`);
}

const applyModeText = readFile('modes/apply.md');
if (!/Claude can interact/i.test(applyModeText)) {
  pass('apply mode wording is agent-neutral');
} else {
  fail('apply mode still uses Claude-specific wording');
}
