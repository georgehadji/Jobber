// tests/hosted-scan.test.mjs — hosted "scan" task: role derivation, matching, source list,
// background job index, the task through the server, config.
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pass as emitPass, fail as emitFail, warn } from './helpers.mjs';
import { createApp, readConfig, GAP_TASK } from '../server/index.mjs';
import { createLimits } from '../server/limits.mjs';
import { createJobIndex, createScanTask, deriveRoles, loadSources, matchJobs, parseTerms } from '../server/scan.mjs';

console.log('\nhosted server (scan task)');

const queued = [];
const pass = (m) => queued.push(() => emitPass(m));
const fail = (m) => queued.push(() => emitFail(m));
const logged = [];
const realLog = console.log, realErr = console.error;
const quiet = () => { console.log = (...a) => logged.push(a.join(' ')); console.error = (...a) => logged.push(a.join(' ')); };
const loud = () => { console.log = realLog; console.error = realErr; };

// Markers built by concatenation so this file never contains the strings it searches for.
const CV_MARK = 'Zeb' + 'ulon' + 'Quixote';
const ROLE_MARK = 'Hippo' + 'griff' + ' Wrangler';
const CV = `# Ada Lovelace\n\n# Experience\n## Analytical Engines Ltd, Senior Data Analyst, 2019-2023\n- Built reports (${CV_MARK}).\n## Babbage & Co, Data Analyst, 2016-2019\n- Weekly dashboards.\n## Earlier, Operations Manager, 2012-2016\n`;
const J = (title, company, location = 'London, UK', url) => ({ title, url: url ?? `https://boards.example/${company}/${title}`.replace(/\s+/g, '-'), company, location });
const JOBS = [
  J('Senior Data Analyst', 'Acme'), J('Data Analysts', 'Beta', 'Remote - Europe'), J('Data Engineer', 'Gamma'),
  J('Operations Manager', 'Delta', 'Berlin, Germany'), J('Nurse Practitioner', 'Epsilon', ''), J('Data Analyst', 'Acme', 'New York, NY'),
];
const URLS = JOBS.map((j) => j.url);

quiet();
try {
  // 1. Role derivation and term parsing.
  try {
    const roles = deriveRoles(CV);
    const noise = deriveRoles('The Manager did things. A Developer. Our Team Lead. Managed a team.');
    const terms = parseTerms(' data analyst,\nOperations Manager ; ; x ,' + 'y'.repeat(100) + ', data analyst');
    if (roles[0] === 'Data Analyst' && roles.includes('Operations Manager') && !roles.some((r) => /senior/i.test(r)) && noise.length === 0
      && terms.length === 3 && terms[0] === 'data analyst' && terms[2].length === 60) {
      pass('roles: titles come from the CV most frequent first without seniority words; a bare noun gives nothing; typed terms are split, deduplicated and capped');
    } else fail(`roles: ${JSON.stringify({ roles, noise, terms })}`);
  } catch (e) { fail(`roles test crashed: ${e.message}`); }

  // 2. Matching: identity of what matched, plural tolerance, location, dedupe (controls: partial words and other roles must not match).
  try {
    const titles = (r) => r.matches.map((m) => `${m.company}:${m.title}`);
    const a = matchJobs(JOBS, ['data analyst'], '');
    const b = matchJobs(JOBS, ['data analyst'], 'london');
    const c = matchJobs(JOBS, ['data analyst'], 'remote');
    const d = matchJobs(JOBS, ['analyst', 'operations manager'], '');
    const e = matchJobs(JOBS, ['data'], 'nowhere');
    const dup = matchJobs([JOBS[0], JOBS[0]], ['data analyst'], '');
    const capped = matchJobs(JOBS, ['data'], '', 2);
    const aSet = titles(a).sort().join('|');
    if (aSet === ['Acme:Data Analyst', 'Acme:Senior Data Analyst', 'Beta:Data Analysts'].sort().join('|')
      && titles(b).join('|') === 'Acme:Senior Data Analyst' && titles(c).join('|') === 'Beta:Data Analysts'
      && d.matches.length === 4 && d.total === 4 && e.total === 0 && dup.total === 1 && capped.matches.length === 2 && capped.total === 4) {
      pass('matching: every word of a term must be in the title (plural ok, "Data Engineer" excluded); location filters; duplicates collapse; the cap keeps the true total');
    } else fail(`matching: ${JSON.stringify({ a: titles(a), b: titles(b), c: titles(c), d: d.total, e: e.total, dup: dup.total, capped: [capped.matches.length, capped.total] })}`);
    // Ranking: a job matching two terms comes before one matching one term.
    const r = matchJobs([J('Data Analyst', 'Zed'), J('Senior Operations Data Analyst', 'Aaa')], ['data analyst', 'operations'], '');
    if (r.matches[0].company === 'Aaa') pass('matching: more matched terms ranks first');
    else fail(`ranking: ${titles(r).join('|')}`);
  } catch (e) { fail(`matching test crashed: ${e.message}`); }

  // 3. Source list: the real shipped list loads and holds only supported boards.
  const dir = mkdtempSync(join(tmpdir(), 'jobber-scan-'));
  try {
    const real = loadSources(new URL('../templates/portals.example.yml', import.meta.url));
    const names = real.map((s) => s.entry.name);
    const yml = join(dir, 's.yml');
    writeFileSync(yml, `tracked_companies:\n  - name: Off\n    api: https://boards-api.greenhouse.io/v1/boards/off/jobs\n    enabled: false\n  - name: On\n    api: https://boards-api.greenhouse.io/v1/boards/on/jobs\n  - name: Evil\n    api: https://evil.test/v1/boards/x/jobs\n  - name: Plain\n    careers_url: https://example.com/careers\n`);
    const small = loadSources(yml).map((s) => s.entry.name);
    if (real.length > 20 && real.every((s) => ['greenhouse', 'lever', 'ashby'].includes(s.provider.id)) && !names.includes('OpenAI') && small.join() === 'On') {
      pass(`sources: shipped list gives ${real.length} supported boards; disabled, off-allowlist and non-board entries are skipped`);
    } else fail(`sources: ${real.length} boards, small=${small.join()}`);
  } catch (e) { fail(`sources test crashed: ${e.stack || e.message}`); }
  finally { rmSync(dir, { recursive: true, force: true }); }

  // 4. Job index with fake providers.
  const board = (name, impl) => ({ entry: { name }, provider: { id: 'fake', fetch: impl } });
  try {
    let live = 0, peak = 0;
    const slow = (jobs) => async () => { live++; peak = Math.max(peak, live); await new Promise((r) => setTimeout(r, 15)); live--; return jobs; };
    const sources = [
      board('A', slow([{ title: 'Data Analyst', url: 'https://a.test/1', location: 'X' }, { title: 'Bad scheme', url: 'javascript:alert(1)' }, { title: 'Insecure', url: 'http://a.test/2' }, { title: '', url: 'https://a.test/3' }, { title: 'Garbage url', url: 'not a url' }])),
      board('B', slow([{ title: 'Nurse', url: 'https://b.test/1' }])),
      board('Broken', async () => { throw new Error(`boom ${CV_MARK}`); }),
      board('Hung', () => new Promise(() => {})),
      board('C', slow([])), board('D', slow([])),
    ];
    const index = createJobIndex({ sources, concurrency: 2, boardTimeoutMs: 80, makeCtx: () => ({}), log: () => {} });
    const before = index.ready();
    const first = index.refresh();
    const same = index.refresh() === first;      // overlapping refresh shares one run
    await first;
    const snap = index.snapshot();
    const urls = snap.jobs.map((j) => j.url).sort().join();
    if (!before && same && index.ready() && urls === 'https://a.test/1,https://b.test/1' && snap.boards === 4 && peak <= 2 && snap.jobs.every((j) => j.company)) {
      pass('index: only https postings with a title are kept; a failing or hung board is skipped; concurrency is bounded; overlapping refreshes share one run');
    } else fail(`index: ${JSON.stringify({ before, same, urls, boards: snap.boards, peak })}`);

    // A total outage must keep the last good index.
    let down = false;
    const flaky = createJobIndex({ sources: [board('F', async () => { if (down) throw new Error('x'); return [{ title: 'Ok', url: 'https://f.test/1' }]; })], makeCtx: () => ({}), log: () => {} });
    await flaky.refresh(); down = true; await flaky.refresh();
    if (flaky.snapshot().jobs.length === 1 && flaky.ready()) pass('index: when every board fails the previous index stays in use');
    else fail('index lost its data on a total outage');
  } catch (e) { fail(`index test crashed: ${e.stack || e.message}`); }

  // 5. Task: not ready, no terms, run output.
  const readyIndex = async (jobs = JOBS) => { const i = createJobIndex({ sources: [board('S', async () => jobs)], makeCtx: () => ({}), log: () => {} }); await i.refresh(); return i; };
  try {
    const cold = createJobIndex({ sources: [], log: () => {} });
    const coldTask = createScanTask({ index: cold });
    const t = createScanTask({ index: await readyIndex() });
    const notReady = coldTask.check(CV, '', {});
    const noTerms = t.check('No titles anywhere in this text.', '', {});
    const ok = t.check(CV, '', {});
    const given = await t.run(CV, '', { roles: 'nurse', location: '' });
    const derived = await t.run(CV, '', {});
    if (notReady?.status === 503 && /did not use one of your checks/.test(notReady.error) && typeof noTerms === 'string' && /roles box/.test(noTerms) && ok === null
      && given.costUsd === 0 && given.result.derived === false && given.result.matches.map((m) => m.title).join() === 'Nurse Practitioner'
      && derived.result.derived === true && derived.result.searched.includes('Data Analyst') && derived.result.total >= 3 && t.maxCostUsd() === 0 && t.needsJob === false) {
      pass('task: waits for the index (503 that keeps the check), asks for roles when the CV has none, typed roles beat derived ones, costs nothing');
    } else fail(`task: ${JSON.stringify({ notReady, noTerms, ok, given: given.result.matches.length, derived: derived.result.searched })}`);
  } catch (e) { fail(`task test crashed: ${e.stack || e.message}`); }

  // 6. Through the server: no job text needed, roles reach the task, other tasks still need a job, not-ready keeps the check.
  const form = (task, fields = {}, withJob = false) => {
    const f = new FormData();
    f.set('task', task); f.set('cv', new Blob([CV]), 'cv.md');
    if (withJob) f.set('job', 'x'.repeat(100));
    for (const [k, v] of Object.entries(fields)) f.set(k, v);
    return f;
  };
  const start = (opts) => new Promise((res) => { const server = createApp(opts); server.listen(0, '127.0.0.1', () => res({ server, base: `http://127.0.0.1:${server.address().port}` })); });
  let ctx;
  try {
    const limits = createLimits({ dailyLimit: 2 });
    const cold = createJobIndex({ sources: [board('S', async () => JOBS)], makeCtx: () => ({}), log: () => {} });
    ctx = await start({ limits, tasks: { gap: GAP_TASK, scan: createScanTask({ index: cold }) } });
    const post = (f) => fetch(`${ctx.base}/api/evaluate`, { method: 'POST', body: f });
    const early = await post(form('scan'));
    await cold.refresh();
    const typed = await post(form('scan', { roles: ROLE_MARK + ', nurse', location: '' }));
    const url = (await typed.json()).resultUrl;
    const stored = await (await fetch(`${ctx.base}${url.replace('/result.html#', '/api/result/')}`)).json();
    const another = await post(form('scan'));                // second delivered check: limit is 2, so the early 503 did not use one
    const gapNoJob = await post(form('gap'));                // control: other tasks still need the job text
    if (early.status === 503 && typed.status === 200 && stored.result.task === 'scan' && stored.result.searched.join() === `${ROLE_MARK},nurse`
      && stored.result.matches.map((m) => m.title).join() === 'Nurse Practitioner' && another.status === 200 && gapNoJob.status === 400) {
      pass('server: scan works without a job, uses the typed roles, a not-ready index does not use a check, and gap still requires the job text');
    } else fail(`server scan flow: early ${early.status}, typed ${typed.status}, another ${another.status}, gapNoJob ${gapNoJob.status}, searched ${stored?.result?.searched}`);
  } catch (e) { fail(`server scan flow crashed: ${e.stack || e.message}`); }
  finally { ctx?.server.close(); }

  const text = logged.join('\n');
  if (!text.includes(CV_MARK) && !text.includes(ROLE_MARK) && /"status":200/.test(text)) pass('logs hold request lines and neither the CV nor the typed roles');
  else fail('logs leaked CV or typed roles, or no request lines were logged');

  // 7. Config: scan is on by default and does not start the index; it can be turned off; bad values are named.
  try {
    const base = { PATH: process.env.PATH, JOBBER_DEV: '1', JOBBER_DB: ':memory:' };
    const on = readConfig(base);
    const off = readConfig({ ...base, JOBBER_SCAN_ENABLED: '0' });
    const badHours = readConfig({ ...base, JOBBER_SCAN_REFRESH_HOURS: '0' });
    const badSrc = readConfig({ ...base, JOBBER_SCAN_SOURCES: join(tmpdir(), 'no-such-sources.yml') });
    if (typeof on.options.tasks.scan?.run === 'function' && on.index && !on.index.ready() && !off.options.tasks.scan && off.index === null
      && badHours.errors.some((e) => e.includes('REFRESH_HOURS')) && badSrc.errors.some((e) => e.includes('JOBBER_SCAN_SOURCES'))) {
      pass('config: scan is on by default with the shipped list and nothing starts until the entry point asks; it can be disabled; bad values are named');
    } else fail(`scan config: ${JSON.stringify({ on: Object.keys(on.options?.tasks ?? {}), ready: on.index?.ready(), off: Object.keys(off.options?.tasks ?? {}), errs: [badHours.errors, badSrc.errors] })}`);
    on.options.limits.close(); off.options.limits.close();
  } catch (e) { fail(`scan config test crashed: ${e.message}`); }
} catch (e) {
  fail(`hosted scan tests crashed: ${e.stack || e.message}`);
} finally {
  loud();
}

queued.forEach((f) => f());
