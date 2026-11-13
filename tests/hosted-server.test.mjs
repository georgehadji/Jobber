// tests/hosted-server.test.mjs — hosted API (server/): gap task end to end, upload
// validation by content, result retention/expiry, and "no CV text in logs".
import { pass as emitPass, fail as emitFail, warn } from './helpers.mjs';
import { createApp } from '../server/index.mjs';
import { createStore } from '../server/store.mjs';

console.log('\nhosted server (gap task)');

// pass/fail print via console.log, which is captured while requests run; queue and flush at the end.
const queued = [];
const pass = (m) => queued.push(() => emitPass(m));
const fail = (m) => queued.push(() => emitFail(m));

// Built by concatenation so this file never contains its own marker twice as one literal.
const MARK = 'Zeb' + 'ulon' + 'Quixote';
const CV = `# Skills\nPython, Docker\n\n# Experience\nDeployed ${MARK} services onto Kubernetes clusters.\n`;
const JD = `# Role\n\n## Requirements\n- Python, Kubernetes, Rust\n- Experience with Docker\n\nThis posting is long enough to pass the minimum length check easily.`;

const start = (opts) => new Promise((res) => {
  const server = createApp(opts);
  server.listen(0, '127.0.0.1', () => res({ server, base: `http://127.0.0.1:${server.address().port}` }));
});

const post = (base, { task = 'gap', job = JD, name = 'cv.md', bytes = Buffer.from(CV) } = {}) => {
  const form = new FormData();
  form.set('task', task);
  if (job !== null) form.set('job', job);
  if (bytes !== null) form.set('cv', new Blob([bytes]), name);
  return fetch(`${base}/api/evaluate`, { method: 'POST', body: form });
};

// Capture console output without touching real stdout (the server logs one JSON line per request).
const logged = [];
const realLog = console.log, realErr = console.error;
const capture = () => { console.log = (...a) => logged.push(a.join(' ')); console.error = (...a) => logged.push(a.join(' ')); };
const release = () => { console.log = realLog; console.error = realErr; };

let ctx;
try { ctx = await start({}); } catch (e) { warn(`hosted server could not start: ${e.message}`); }

if (ctx) {
  const { server, base } = ctx;
  try {
    capture();

    // 1. Happy path + classification (identity, not count): each bucket must hold the right skill.
    const ok = await post(base);
    const { resultUrl } = await ok.json();
    const token = resultUrl?.split('#')[1];
    const got = await fetch(`${base}/api/result/${token}`);
    const body = await got.json();
    const r = body.result || {};
    if (ok.status === 200 && got.status === 200
      && r.existing?.includes('Python') && r.supportedByResume?.includes('Kubernetes')
      && r.gap?.includes('Rust') && !r.existing?.includes('Rust')) pass('gap: Python existing, Kubernetes in prose, Rust a real gap');
    else fail(`gap classification wrong: status ${ok.status}/${got.status}, ${JSON.stringify(r)}`);

    if (got.headers.get('cache-control') === 'no-store' && got.headers.get('x-robots-tag') === 'noindex') pass('result responses are no-store and noindex');
    else fail('result response is missing no-store / noindex');

    // 2. Content sniffing: .pdf name + text bytes -> 415; control: same bytes as .txt -> 200.
    const fakePdf = await post(base, { name: 'cv.pdf' });
    const asTxt = await post(base, { name: 'cv.txt' });
    if (fakePdf.status === 415 && asTxt.status === 200) pass('.pdf name with non-PDF bytes is rejected (415); same bytes as .txt accepted');
    else fail(`sniffing: fake pdf ${fakePdf.status} (want 415), as txt ${asTxt.status} (want 200)`);

    // 3. PDF header but no readable text -> 422 (not 415, not 200).
    const badPdf = await post(base, { name: 'cv.pdf', bytes: Buffer.from('%PDF-1.4\nnot really a pdf\n') });
    if (badPdf.status === 422) pass('unreadable PDF returns 422 with a reason');
    else fail(`unreadable PDF returned ${badPdf.status}, want 422`);

    // 4. Wrong extension, binary content.
    const exe = await post(base, { name: 'cv.exe' });
    const bin = await post(base, { name: 'cv.txt', bytes: Buffer.from([0xff, 0xfe, 0x00, 0x80, 0x81]) });
    if (exe.status === 415 && bin.status === 415) pass('unsupported extension and invalid UTF-8 are rejected (415)');
    else fail(`exe ${exe.status}, binary ${bin.status}, want 415 for both`);

    // 5. Oversize body -> 413.
    let big;
    try { big = (await post(base, { bytes: Buffer.alloc(5.5 * 1024 * 1024, 97) })).status; } catch (e) { big = `network error: ${e.cause?.code || e.message}`; }
    if (big === 413) pass('oversize upload is rejected with 413');
    else fail(`oversize upload gave ${big}, want 413`);

    // 6. Input validation: short job, missing file, unknown task; unimplemented task is 503 (control: gap is 200).
    const short = await post(base, { job: 'too short' });
    const noFile = await post(base, { bytes: null });
    const badTask = await post(base, { task: 'nope' });
    const later = await post(base, { task: 'score' });
    if (short.status === 400 && noFile.status === 400 && badTask.status === 400 && later.status === 503) pass('short job, missing CV, unknown task are 400; unbuilt task is 503');
    else fail(`validation: short ${short.status}, noFile ${noFile.status}, badTask ${badTask.status}, score ${later.status}`);

    // 7. A JD with no requirements list must say so (0 skills), not look like "no gaps".
    const none = await post(base, { job: 'We are hiring a person to do great work with a great team. '.repeat(3) });
    const noneBody = await (await fetch(`${base}${(await none.json()).resultUrl.replace('/result.html#', '/api/result/')}`)).json();
    if (noneBody.result?.jobSkillCount === 0 && noneBody.result?.gap?.length === 0) pass('JD without a requirements list reports jobSkillCount 0');
    else fail(`empty-skills JD result: ${JSON.stringify(noneBody)}`);

    // 8. Delete removes the result; bad and unknown tokens are 404.
    const del = await fetch(`${base}/api/result/${token}`, { method: 'DELETE' });
    const after = await fetch(`${base}/api/result/${token}`);
    const junk = await fetch(`${base}/api/result/not-a-token`);
    if (del.status === 204 && after.status === 404 && junk.status === 404) pass('DELETE removes the result; unknown token is 404');
    else fail(`delete ${del.status}, after ${after.status}, junk ${junk.status}`);

    // 9. Static serving stays inside site/.
    const trav = await fetch(`${base}/..%2Fpackage.json`);
    const home = await fetch(`${base}/`);
    if (trav.status === 404 && home.status === 200) pass('path traversal is blocked; the landing page is served');
    else fail(`traversal ${trav.status} (want 404), home ${home.status} (want 200)`);

    // 10. Logs carry no CV text, and do carry the request line (control: logging is on).
    const text = logged.join('\n');
    if (!text.includes(MARK) && /"status":200/.test(text)) pass('logs have request lines and none of the CV text');
    else fail(`log check: marker leaked=${text.includes(MARK)}, request lines present=${/"status":200/.test(text)}`);
  } catch (e) {
    release();
    fail(`hosted server test crashed: ${e.stack || e.message}`);
  } finally {
    release();
    server.close();
  }
}

// Expiry and capacity use their own stores so the clock and limits can be controlled.
try {
  let t = 1000;
  const store = createStore({ ttlMs: 100, maxItems: 1, now: () => t });
  const a = store.put({ n: 1 });
  const full = store.put({ n: 2 });
  const live = store.get(a) !== null;
  t += 101;
  const expired = store.get(a) === null;
  const reuse = store.put({ n: 3 }) !== null;
  if (a && full === null && live && expired && reuse) pass('store: refuses when full, expires after the TTL, frees space after expiry');
  else fail(`store: token ${!!a}, full->${full}, live ${live}, expired ${expired}, reuse ${reuse}`);
} catch (e) { fail(`store test crashed: ${e.message}`); }

queued.forEach((f) => f());
