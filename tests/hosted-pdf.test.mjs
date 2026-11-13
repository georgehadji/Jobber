// tests/hosted-pdf.test.mjs — hosted "pdf" task: tailoring payload verification, render queue,
// hardened Chromium settings, cost accounting on late failures, one real Chromium render, config.
import { pass as emitPass, fail as emitFail, warn } from './helpers.mjs';
import { createApp, readConfig, GAP_TASK } from '../server/index.mjs';
import { createLimits } from '../server/limits.mjs';
import { TaskError } from '../server/openrouter.mjs';
import { createPdfTask, parseModelJson, verifyPayload } from '../server/pdf.mjs';
import { createRenderer, createSlots } from '../server/render-pdf.mjs';

console.log('\nhosted server (pdf task)');

const queued = [];
const pass = (m) => queued.push(() => emitPass(m));
const fail = (m) => queued.push(() => emitFail(m));
const logged = [];
const realLog = console.log, realErr = console.error, realWarn = console.warn;
const quiet = () => { console.log = (...a) => logged.push(a.join(' ')); console.error = (...a) => logged.push(a.join(' ')); console.warn = (...a) => logged.push(a.join(' ')); };
const loud = () => { console.log = realLog; console.error = realErr; console.warn = realWarn; };
const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

// Markers built by concatenation so this file never contains the strings it searches for.
const CV_MARK = 'Zeb' + 'ulon' + 'Quixote';
const PRICE = { prompt: 1, completion: 2 };
const CV = `# Ada Lovelace
ada@example.org | +44 7700 900123 | London, UK
https://github.com/ada-l

# Experience
## Analytical Engines Ltd, Senior Engineer, 2019-2023
- Cut report time by 40% for the planning team (${CV_MARK}).
- Built dashboards in Python and SQL.

# Education
University of London, BSc Mathematics, 2018

# Skills
Python, SQL, Tableau
`;
const JOB = `Data Analyst at Northfield Logistics.\n\n## Requirements\n- Python, SQL, Kubernetes\n\nWe need an analyst to build weekly delivery reports for the planning team.`;

const GOOD = {
  lang: 'en',
  candidate: { name: 'Ada Lovelace', email: 'ada@example.org', phone: '+44 7700 900123', location: 'London, UK', github: { url: 'https://github.com/ada-l' } },
  summary: 'Engineer who cut report time by 40% for planning teams.',
  competencies: ['Python reporting', 'SQL dashboards'],
  experience: [{ company: 'Analytical Engines Ltd', role: 'Senior Engineer', dates: '2019-2023', bullets: ['Cut report time by 40% for the planning team.', 'Built dashboards in Python and SQL.'] }],
  education: [{ title: 'BSc Mathematics', org: 'University of London', year: '2018' }],
  skills: [{ category: 'Languages', items: ['Python', 'SQL'] }],
};
const clone = (o) => JSON.parse(JSON.stringify(o));

// The tiniest PDF the page counter and text extractor accept, for the fake-browser tests.
const TINY_PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n', 'latin1');

const okReply = (obj, usage = { cost: 0.005 }) => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: typeof obj === 'string' ? obj : JSON.stringify(obj) } }], usage }) });
const recorder = (reply = () => okReply(GOOD)) => { const calls = []; const fetchFn = async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return reply(); }; return { calls, fetchFn }; };
const fakeRender = async () => ({ pdf: Buffer.from('%PDF-fake'), pages: 1, atsFindings: [] });
const mk = (over = {}) => createPdfTask({ apiKey: 'k', model: 'vendor/m', maxPricePerM: PRICE, render: fakeRender, ...over });

quiet();
try {
  // 1. Model JSON parsing.
  try {
    const a = parseModelJson('```json\n{"a":1}\n```');
    const b = parseModelJson('Here you go: {"a":2} hope that helps');
    if (a?.a === 1 && b?.a === 2 && parseModelJson('no json here') === null && parseModelJson('{broken') === null && parseModelJson('[1,2]') === null) pass('model JSON: fenced and padded replies parse; prose, broken JSON and arrays are rejected');
    else fail(`parseModelJson: ${JSON.stringify({ a, b })}`);
  } catch (e) { fail(`parse test crashed: ${e.message}`); }

  // 2. verifyPayload keeps true content (control) and removes every fabrication by identity.
  try {
    const ok = verifyPayload(clone(GOOD), CV);
    const kept = ok.payload && ok.removed.length === 0 && ok.payload.experience[0].bullets.length === 2
      && ok.payload.skills[0].items.join() === 'Python,SQL' && ok.payload.candidate.email === 'ada@example.org' && ok.payload.candidate.github?.url === 'https://github.com/ada-l';

    const bad = clone(GOOD);
    bad.candidate.email = 'ada@elsewhere.test';
    bad.candidate.phone = '+44 1234 000999';
    bad.candidate.location = 'Mars';
    bad.candidate.github = { url: 'https://github.com/not-ada' };
    bad.candidate.linkedin = { url: 'https://linkedin.com/in/someone-else' };
    bad.summary = 'Led 500 engineers across 12 countries.';
    bad.experience.push({ company: 'Fictional Corp', role: 'CTO', dates: '2020-2022', bullets: ['x'] });
    bad.experience.push({ company: 'Analytical Engines Ltd', role: 'Chief Wizard', dates: '2019-2023', bullets: ['x'] });
    bad.experience.push({ company: 'Analytical Engines Ltd', role: 'Senior Engineer', dates: '2005-2007', bullets: ['x'] });
    bad.experience[0].bullets.push('Saved the company 2.5 million dollars.');
    bad.skills[0].items.push('Kubernetes', 'Rust');
    bad.competencies.push('Kubernetes orchestration');
    bad.education.push({ title: 'PhD', org: 'Imaginary Institute', year: '2020' });
    bad.certifications = [{ title: 'Certified Wizard', org: 'Hogwarts', year: '2021' }];
    bad.projects = [{ name: 'Phantom Project', description: 'x' }];
    const r = verifyPayload(bad, CV);
    const p = r.payload;
    const all = JSON.stringify(p);
    const gone = ['ada@elsewhere.test', '1234 000999', 'Mars', 'not-ada', 'someone-else', 'Led 500', 'Fictional Corp', 'Chief Wizard', '2005', '2.5 million', 'Kubernetes', 'Rust', 'Imaginary', 'Wizard', 'Phantom']
      .filter((t) => all.includes(t));
    const notes = r.removed.join('\n');
    const noted = ['elsewhere', 'Mars', 'Fictional', 'Chief Wizard', '2005', 'Kubernetes', 'Rust', 'Imaginary', 'Wizard', 'Phantom'].filter((t) => !notes.includes(t));
    if (kept && gone.length === 0 && noted.length === 0 && p.experience.length === 1 && p.candidate.name === 'Ada Lovelace') {
      pass('verifyPayload: true content is kept; made-up contact details, links, employers, titles, dates, numbers, skills, schools and projects are removed and listed');
    } else fail(`verifyPayload: kept=${kept}, still present: ${gone.join(', ')}, not noted: ${noted.join(', ')}, jobs ${p.experience.length}`);

    const noName = verifyPayload({ ...clone(GOOD), candidate: { name: 'Grace Hopper' } }, CV);
    const empty = verifyPayload({ candidate: { name: 'Ada Lovelace' }, experience: [{ company: 'Nowhere', role: 'x' }] }, CV);
    if (noName.error && /name/.test(noName.error) && empty.error) pass('verifyPayload: a name that is not in the CV, or no matching history, gives an error instead of a PDF');
    else fail(`verifyPayload errors: ${JSON.stringify({ noName: noName.error, empty: empty.error })}`);
  } catch (e) { fail(`verifyPayload test crashed: ${e.stack || e.message}`); }

  // 3. Slots: concurrency, order, and refusal beyond the waiting line (control: capacity frees up).
  try {
    const slots = createSlots({ concurrency: 1, maxPending: 1 });
    const r1 = await slots.acquire();
    let second = false;
    const p2 = slots.acquire().then((rel) => { second = true; return rel; });
    await tick();
    const waitingWhileFull = slots.stats();
    let refused = null;
    try { await slots.acquire(); } catch (e) { refused = e; }
    r1();
    const r2 = await p2;
    const afterFirst = { second, ...slots.stats() };
    r2();
    const free = slots.stats();
    const r3 = await slots.acquire(); r3();
    if (!second === false && waitingWhileFull.active === 1 && waitingWhileFull.waiting === 1 && refused instanceof TaskError && refused.status === 503
      && afterFirst.second && afterFirst.active === 1 && afterFirst.waiting === 0 && free.active === 0) {
      pass('slots: one render at a time, one may wait, the next is refused with 503, and capacity returns when renders finish');
    } else fail(`slots: ${JSON.stringify({ waitingWhileFull, refused: refused?.status, afterFirst, free })}`);
  } catch (e) { fail(`slots test crashed: ${e.message}`); }

  // 4. Renderer hardening with a fake browser: JS off, network aborted except data:, always closed, no leaks.
  try {
    const seen = { ctxOpts: null, handler: null, closed: 0, html: '' };
    const browser = (pdf) => ({
      newContext: async (o) => { seen.ctxOpts = o; return { route: async (_p, fn) => { seen.handler = fn; }, newPage: async () => ({ setContent: async (h) => { seen.html = h; }, pdf: async () => pdf() }) }; },
      close: async () => { seen.closed++; },
    });
    const renderer = createRenderer({ launch: async () => browser(() => TINY_PDF), timeoutMs: 2000 });
    const out = await renderer.renderPdf('<html><head></head><body>hi</body></html>', 'a4');
    const routeCalls = [];
    const mkRoute = (url) => ({ request: () => ({ url: () => url }), abort: () => routeCalls.push(`abort ${url}`), continue: () => routeCalls.push(`continue ${url}`) });
    seen.handler(mkRoute('https://evil.test/x.png')); seen.handler(mkRoute('file:///etc/passwd')); seen.handler(mkRoute('data:font/woff2;base64,AAAA'));
    if (seen.ctxOpts.javaScriptEnabled === false && seen.ctxOpts.offline === true && out.pdf.length > 0 && out.pages === 1 && seen.closed === 1
      && routeCalls[0].startsWith('abort https') && routeCalls[1].startsWith('abort file') && routeCalls[2].startsWith('continue data') && /@page/.test(seen.html)) {
      pass('renderer: JavaScript off, offline, only data: URLs load, print CSS injected, browser closed after the render');
    } else fail(`renderer hardening: ${JSON.stringify({ o: seen.ctxOpts, closed: seen.closed, routeCalls, pages: out.pages })}`);

    // Failure and timeout paths: generic 503, browser still closed, slot released (the next render works).
    const secret = CV_MARK;
    const crashing = createRenderer({ launch: async () => ({ newContext: async () => { throw new Error(`boom ${secret}`); }, close: async () => { seen.closed++; } }), timeoutMs: 2000 });
    const before = seen.closed;
    let e1 = null; try { await crashing.renderPdf('<p></p>'); } catch (e) { e1 = e; }
    const hanging = createRenderer({ launch: async () => ({ newContext: async () => new Promise(() => {}), close: async () => { seen.closed++; } }), timeoutMs: 50 });
    let e2 = null; try { await hanging.renderPdf('<p></p>'); } catch (e) { e2 = e; }
    const again = await crashing.slots.acquire(); again();
    if (e1 instanceof TaskError && e1.status === 503 && !e1.message.includes(secret) && !e1.message.includes('boom') && e2 instanceof TaskError && e2.status === 503
      && seen.closed === before + 2 && crashing.slots.stats().active === 0) pass('renderer: a crash or a hang becomes a generic 503, the browser is closed and the slot is released');
    else fail(`renderer failure: ${JSON.stringify({ e1: e1?.message, e2: e2?.message, closed: seen.closed - before, stats: crashing.slots.stats() })}`);
  } catch (e) { fail(`renderer test crashed: ${e.stack || e.message}`); }

  // 5. Task: request shape, verified payload reaches the template, escaping, result fields, costs.
  try {
    const r = recorder();
    let html = '';
    const evil = clone(GOOD);
    evil.experience[0].bullets = ['Built dashboards in Python and SQL <script>alert(1)</script>.'];
    const task = mk({ fetchFn: recorder(() => okReply(evil)).fetchFn, render: async (h) => { html = h; return fakeRender(); } });
    await task.run(CV, JOB);
    const t2 = mk({ fetchFn: r.fetchFn });
    const out = await t2.run(CV, JOB);
    const c = r.calls[0].body;
    const [sys, user] = c.messages;
    const reserved = t2.maxCostUsd(CV, JOB);
    const res = out.result;
    if (c.provider.data_collection === 'deny' && c.max_tokens === 4000 && !sys.content.includes(CV_MARK) && user.content.includes(CV_MARK) && user.content.includes('Northfield')
      && /untrusted/i.test(sys.content) && res.task === 'pdf' && res.filename === 'tailored-cv.pdf' && Buffer.from(res.pdf, 'base64').toString().startsWith('%PDF')
      && res.pages === 1 && Array.isArray(res.removed) && out.costUsd === 0.005 && reserved > 0.005) {
      pass('pdf task: privacy routing and untrusted markers as for score; result holds the PDF, page count and removal notes; usage.cost is charged');
    } else fail(`pdf task shape: ${JSON.stringify({ p: c.provider, mt: c.max_tokens, task: res.task, cost: out.costUsd, reserved })}`);
    if (html.includes('Ada Lovelace') && html.includes('Analytical Engines Ltd') && !html.includes('<script>alert') && html.includes('&lt;script&gt;')) pass('template: verified content is rendered and model text is HTML-escaped');
    else fail('template output missing content or leaves the script tag unescaped');
    const noCost = await mk({ fetchFn: recorder(() => okReply(GOOD, {})).fetchFn }).run(CV, JOB);
    if (noCost.costUsd === reserved) pass('pdf task: missing usage.cost charges the full reservation');
    else fail(`missing cost charged ${noCost.costUsd}, reserved ${reserved}`);
  } catch (e) { fail(`pdf task test crashed: ${e.stack || e.message}`); }

  // 6. Failures after the model was paid still carry the cost; failures before it carry none.
  try {
    const cases = {
      'invalid JSON': { reply: () => okReply('Sorry, I cannot do that.'), paid: true, status: 503 },
      'name not in CV': { reply: () => okReply({ ...clone(GOOD), candidate: { name: 'Grace Hopper' } }), paid: true, status: 422 },
      'upstream 500': { reply: () => ({ ok: false, status: 500, json: async () => ({}) }), paid: false, status: 503 },
    };
    const bad = [];
    for (const [name, c] of Object.entries(cases)) {
      try { await mk({ fetchFn: async () => c.reply() }).run(CV, JOB); bad.push(`${name}: no error`); }
      catch (e) {
        if (!(e instanceof TaskError) || e.status !== c.status || (c.paid ? e.costUsd !== 0.005 : e.costUsd !== 0) || e.message.includes(CV_MARK)) bad.push(`${name}: ${e.status} cost ${e.costUsd}`);
        if (!/did not use one of your checks/.test(e.message)) bad.push(`${name}: message does not say the check was kept`);
      }
    }
    let renderErr = null;
    try { await mk({ fetchFn: recorder().fetchFn, render: async () => { throw new TaskError(503, 'render down'); } }).run(CV, JOB); } catch (e) { renderErr = e; }
    if (!(renderErr instanceof TaskError) || renderErr.costUsd !== 0.005) bad.push(`render failure cost ${renderErr?.costUsd}`);
    if (bad.length === 0) pass('pdf failures: unusable model reply, unknown name and render failure keep the model cost; an upstream error costs nothing; all say the check is kept');
    else fail(`pdf failure accounting: ${bad.join('; ')}`);
  } catch (e) { fail(`pdf failure test crashed: ${e.message}`); }

  // 7. Through the server: a paid failure is charged to the budget and the check is refunded; a busy line is refused before paying.
  const form = (task) => { const f = new FormData(); f.set('task', task); f.set('job', JOB); f.set('cv', new Blob([CV]), 'cv.md'); return f; };
  const start = (opts) => new Promise((res) => { const server = createApp(opts); server.listen(0, '127.0.0.1', () => res({ server, base: `http://127.0.0.1:${server.address().port}` })); });
  let ctx;
  try {
    const limits = createLimits({ dailyLimit: 1, dailyBudgetUsd: 1 });
    let mode = 'badjson';
    const pdf = mk({ fetchFn: async () => (mode === 'badjson' ? okReply('nope') : okReply(GOOD)) });
    ctx = await start({ limits, tasks: { gap: GAP_TASK, pdf } });
    const failed = await fetch(`${ctx.base}/api/evaluate`, { method: 'POST', body: form('pdf') });
    const spentAfterFail = limits.spentTodayUsd();
    mode = 'ok';
    const good = await fetch(`${ctx.base}/api/evaluate`, { method: 'POST', body: form('pdf') });   // limit 1: needs the refund
    const url = (await good.json()).resultUrl;
    const stored = await (await fetch(`${ctx.base}${url.replace('/result.html#', '/api/result/')}`)).json();
    if (failed.status === 503 && Math.abs(spentAfterFail - 0.005) < 1e-9 && good.status === 200 && stored.result.task === 'pdf') {
      pass('server: an unusable model reply is charged to the spend cap but the visitor keeps the check; the retry delivers a PDF');
    } else fail(`server pdf flow: failed ${failed.status} spent ${spentAfterFail}, good ${good.status}`);
  } catch (e) { fail(`server pdf flow crashed: ${e.message}`); }
  finally { ctx?.server.close(); }

  try {
    const limits = createLimits({ dailyLimit: 5, dailyBudgetUsd: 1 });
    const r = recorder();
    ctx = await start({ limits, tasks: { gap: GAP_TASK, pdf: mk({ fetchFn: r.fetchFn, isBusy: () => true }) } });
    const res = await fetch(`${ctx.base}/api/evaluate`, { method: 'POST', body: form('pdf') });
    const body = await res.json();
    if (res.status === 400 && /Too many CVs/.test(body.error) && r.calls.length === 0 && limits.spentTodayUsd() === 0) pass('server: when the render line is full the request is refused before the model is called');
    else fail(`busy refusal: ${res.status} calls ${r.calls.length} spent ${limits.spentTodayUsd()}`);
  } catch (e) { fail(`busy test crashed: ${e.message}`); }
  finally { ctx?.server.close(); }

  const text = logged.join('\n');
  if (!text.includes(CV_MARK) && !text.includes('Ada Lovelace') && !text.includes('Northfield')) pass('logs hold none of the CV, job or model reply');
  else fail('logs leaked CV, job or reply text');

  // 8. One real Chromium render with the real template: a valid 1-page PDF whose text layer holds the name.
  let chromiumOk = true;
  try {
    const { chromium } = await import('playwright');
    const b = await chromium.launch({ headless: true });
    await b.close();
  } catch { chromiumOk = false; }
  if (!chromiumOk) warn('Chromium is not installed: real render test skipped (npx playwright install chromium)');
  else {
    try {
      const { renderPdf } = createRenderer({ timeoutMs: 30_000 });
      const task = mk({ fetchFn: recorder().fetchFn, render: renderPdf });
      const { result } = await task.run(CV, JOB);
      const buf = Buffer.from(result.pdf, 'base64');
      const { extractPdfText } = await import('../lib/pdf-text.mjs');
      const text = extractPdfText(buf).text;
      if (buf.subarray(0, 5).toString() === '%PDF-' && result.pages === 1 && text.includes('Ada Lovelace') && text.includes('Analytical Engines') && result.atsFindings.length === 0) pass('real Chromium: end-to-end PDF is valid, one page, with the name and employer in the text layer and no reading findings');
      else fail(`real render: ${JSON.stringify({ head: buf.subarray(0, 5).toString(), pages: result.pages, findings: result.atsFindings, text: text.slice(0, 120) })}`);
    } catch (e) { fail(`real render crashed: ${e.stack || e.message}`); }
  }

  // 9. Config: the pdf task follows the score task; its own settings are validated; it can be switched off.
  try {
    const base = { PATH: process.env.PATH, JOBBER_DEV: '1', JOBBER_DB: ':memory:', OPENROUTER_API_KEY: 'k', JOBBER_SCORE_MODEL: 'm', JOBBER_SCORE_MAX_PRICE_PROMPT: '1', JOBBER_SCORE_MAX_PRICE_COMPLETION: '2' };
    const on = readConfig(base);
    const off = readConfig({ ...base, JOBBER_PDF_ENABLED: '0' });
    const noKey = readConfig({ PATH: process.env.PATH, JOBBER_DEV: '1', JOBBER_DB: ':memory:' });
    const badConc = readConfig({ ...base, JOBBER_PDF_CONCURRENCY: '0' });
    const badFmt = readConfig({ ...base, JOBBER_PDF_FORMAT: 'a5' });
    const badPrice = readConfig({ ...base, JOBBER_PDF_MAX_PRICE_PROMPT: '0' });
    if (typeof on.options.tasks.pdf?.run === 'function' && !off.options.tasks.pdf && off.options.tasks.score && !noKey.options.tasks.pdf
      && badConc.errors.some((e) => e.includes('CONCURRENCY')) && badFmt.errors.some((e) => e.includes('FORMAT')) && badPrice.errors.some((e) => e.includes('PDF_MAX_PRICE'))) {
      pass('config: pdf is on with the score config, off without a key or when disabled; concurrency, format and prices are validated');
    } else fail(`pdf config: ${JSON.stringify({ on: Object.keys(on.options?.tasks ?? {}), off: Object.keys(off.options?.tasks ?? {}), errs: [badConc.errors, badFmt.errors, badPrice.errors] })}`);
    for (const c of [on, off, noKey]) c.options.limits.close();
  } catch (e) { fail(`pdf config test crashed: ${e.message}`); }
} catch (e) {
  fail(`hosted pdf tests crashed: ${e.stack || e.message}`);
} finally {
  loud();
}

queued.forEach((f) => f());
