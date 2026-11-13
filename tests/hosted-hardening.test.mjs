// tests/hosted-hardening.test.mjs — hosted server hardening: CSP and headers, the site's own code
// against that policy, malformed requests, no leftover CV bytes on disk, kill-switch drill,
// load and queue behaviour.
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pass as emitPass, fail as emitFail, warn } from './helpers.mjs';
import { createApp, readConfig, GAP_TASK } from '../server/index.mjs';
import { createLimits } from '../server/limits.mjs';
import { createJobIndex, createScanTask } from '../server/scan.mjs';
import { createPdfTask } from '../server/pdf.mjs';
import { createScoreTask } from '../server/score.mjs';
import { createRenderer, createSlots } from '../server/render-pdf.mjs';
import { createStore } from '../server/store.mjs';
import { TaskError } from '../server/openrouter.mjs';

console.log('\nhosted server (hardening)');

const queued = [];
const pass = (m) => queued.push(() => emitPass(m));
const fail = (m) => queued.push(() => emitFail(m));
const logged = [];
const realLog = console.log, realErr = console.error;
const quiet = () => { console.log = (...a) => logged.push(a.join(' ')); console.error = (...a) => logged.push(a.join(' ')); };
const loud = () => { console.log = realLog; console.error = realErr; };

// Markers built by concatenation so this file never contains the strings it searches for.
const CV_MARK = 'Zeb' + 'ulon' + 'Quixote';
const JOB_MARK = 'Ferd' + 'inand' + 'Plover';
const CV = `# Ada Lovelace\nada@example.org\n\n# Experience\n## Analytical Engines Ltd, Senior Data Analyst, 2019-2023\n- Built reports for ${CV_MARK}.\n\n# Education\nUniversity of London, BSc, 2018\n\n# Skills\nPython, SQL\n`;
const JOB = `Data Analyst at ${JOB_MARK} Logistics.\n\n## Requirements\n- Python, SQL, Kubernetes\n\nWe need an analyst to build weekly delivery reports for the planning team.`;
const SITE = new URL('../site/', import.meta.url);

const form = (task, { cv = CV, job = JOB, ...rest } = {}) => {
  const f = new FormData();
  f.set('task', task); f.set('cv', new Blob([cv]), 'cv.md');
  if (task !== 'scan') f.set('job', job);
  for (const [k, v] of Object.entries(rest)) f.set(k, v);
  return f;
};
const start = (opts) => new Promise((res) => { const server = createApp(opts); server.listen(0, '127.0.0.1', () => res({ server, base: `http://127.0.0.1:${server.address().port}`, port: server.address().port })); });
const raw = (port, text) => new Promise((resolve) => {
  const s = connect(port, '127.0.0.1', () => s.write(text));
  let data = ''; s.on('data', (d) => { data += d; }); s.on('close', () => resolve(data)); s.on('error', () => resolve(data));
  setTimeout(() => s.destroy(), 1500).unref();
});

const GOOD_PAYLOAD = {
  lang: 'en', candidate: { name: 'Ada Lovelace', email: 'ada@example.org' }, summary: '', competencies: [],
  experience: [{ company: 'Analytical Engines Ltd', role: 'Senior Data Analyst', dates: '2019-2023', bullets: ['Built reports.'] }],
  education: [{ title: 'BSc', org: 'University of London', year: '2018' }], skills: [{ category: 'Languages', items: ['Python', 'SQL'] }],
};
const okReply = (obj, content) => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: content ?? JSON.stringify(obj) } }], usage: { cost: 0.005 } }) });
const TINY_PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n', 'latin1');

const work = mkdtempSync(join(tmpdir(), 'jobber-hard-'));
quiet();
try {
  // 1. Headers on pages, API answers and errors; a control without them would be a different server.
  let ctx;
  try {
    ctx = await start({});
    const get = (p) => fetch(`${ctx.base}${p}`);
    const pages = [await get('/'), await get('/result.html'), await get('/styles.css'), await get('/nope'), await get('/api/result/' + 'a'.repeat(32))];
    const csp = pages[0].headers.get('content-security-policy') || '';
    const needed = ["default-src 'none'", "script-src 'self' https://challenges.cloudflare.com", "style-src 'self'", "frame-src https://challenges.cloudflare.com", "base-uri 'none'", "object-src 'none'", "frame-ancestors 'none'", "form-action 'self'"];
    const missing = needed.filter((d) => !csp.includes(d));
    const every = pages.every((r) => r.headers.get('content-security-policy') === csp && r.headers.get('x-content-type-options') === 'nosniff'
      && r.headers.get('referrer-policy') === 'no-referrer' && /camera=\(\)/.test(r.headers.get('permissions-policy') || '') && r.headers.get('cross-origin-opener-policy') === 'same-origin');
    if (missing.length === 0 && !/unsafe-inline|unsafe-eval|\*/.test(csp) && every) pass('headers: every response carries a strict CSP (no inline, no eval, no wildcard, Turnstile origin only), nosniff, no referrer, permissions and isolation policies');
    else fail(`headers: missing ${missing.join(' | ')}; csp=${csp}; every=${every}`);
  } catch (e) { fail(`headers test crashed: ${e.message}`); }
  finally { ctx?.server.close(); }

  // 2. The site's own code must satisfy that policy: no inline script/style/handlers, no off-origin loads except Turnstile.
  //    (Static text is the right tool here: the subject is the source files themselves.)
  try {
    const files = readdirSync(SITE).filter((f) => /\.(html|js)$/.test(f));
    const problems = [];
    for (const f of files) {
      const t = readFileSync(new URL(f, SITE), 'utf8');
      if (f.endsWith('.html')) {
        if (/<script(?![^>]*\bsrc=)[^>]*>/i.test(t)) problems.push(`${f}: inline script`);
        if (/<style[\s>]/i.test(t)) problems.push(`${f}: style element`);
        if (/\sstyle\s*=/i.test(t)) problems.push(`${f}: style attribute`);
        if (/\son[a-z]+\s*=/i.test(t)) problems.push(`${f}: inline event handler`);
        if (/(<script[^>]*\ssrc|<link[^>]*\shref|<img[^>]*\ssrc)\s*=\s*["']?(https?:)?\/\//i.test(t)) problems.push(`${f}: off-origin resource`);
      } else {
        if (/\.innerHTML\s*=|insertAdjacentHTML|document\.write|\beval\s*\(|new Function\s*\(/.test(t)) problems.push(`${f}: HTML or code injection sink`);
        const hosts = [...t.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map((m) => m[1]).filter((h) => h !== 'challenges.cloudflare.com');
        if (hosts.length) problems.push(`${f}: unexpected origin ${[...new Set(hosts)].join(',')}`);
      }
    }
    if (files.length >= 5 && problems.length === 0) pass(`site code: ${files.length} files have no inline script or style, no handlers, no injection sinks and no origin but Turnstile`);
    else fail(`site code vs CSP: ${files.length} files; ${problems.join('; ')}`);
  } catch (e) { fail(`site code test crashed: ${e.message}`); }

  // 3. Malformed and hostile requests: answered, never a 500, never a file outside site/, and the server keeps serving.
  try {
    ctx = await start({});
    const port = ctx.port;
    const bad = [];
    const statusOf = (r) => Number((/^HTTP\/1\.1 (\d+)/.exec(r) || [])[1]);
    const cases = {
      'bad percent escape': `GET /%E0%A4%A HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`,
      'NUL in path': `GET /index%00.html HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`,
      'encoded traversal': `GET /..%2f..%2fserver%2findex.mjs HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`,
      'dot traversal': `GET /%2e%2e/%2e%2e/package.json HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`,
      'absolute-form target': `GET http://[ HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`,
      'wrong method on api': `PUT /api/evaluate HTTP/1.1\r\nHost: x\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
    };
    for (const [name, req] of Object.entries(cases)) {
      const r = await raw(port, req);
      const s = statusOf(r);
      if (r && (s >= 500 || /createServer|process\.env|"name":\s*"jobber/.test(r))) bad.push(`${name}: ${s}`);
      if (r && !(s >= 400 && s < 500) && name !== 'absolute-form target') bad.push(`${name}: expected 4xx, got ${s}`);
    }
    const emptyBody = await fetch(`${ctx.base}/api/evaluate`, { method: 'POST', headers: { 'content-type': 'multipart/form-data; boundary=x' }, body: '' });
    const notMultipart = await fetch(`${ctx.base}/api/evaluate`, { method: 'POST', body: 'a=b' });
    const alive = await fetch(`${ctx.base}/`);
    if (bad.length === 0 && emptyBody.status === 400 && notMultipart.status === 400 && alive.status === 200) pass('hostile requests: bad escapes, NUL, traversal, junk targets, wrong methods and empty bodies get 4xx; no 5xx, no file outside site/; the server keeps serving');
    else fail(`hostile requests: ${bad.join('; ')} empty ${emptyBody.status} notMultipart ${notMultipart.status} alive ${alive.status}`);
  } catch (e) { fail(`hostile request test crashed: ${e.stack || e.message}`); }
  finally { ctx?.server.close(); }

  // 4. After every task type has run: no CV or job bytes in files written during the run, nor in logs; deleted results are gone.
  const started = Date.now() - 2000;
  let chromiumOk = true;
  try { const { chromium } = await import('playwright'); const b = await chromium.launch({ headless: true }); await b.close(); } catch { chromiumOk = false; }
  try {
    const dbDir = join(work, 'db'); mkdirSync(dbDir);
    const limits = createLimits({ dbPath: join(dbDir, 'limits.db'), dailyLimit: 100, dailyBudgetUsd: 10 });
    const scoreReply = `## Block A\nok\n\n---SCORE_SUMMARY---\nCOMPANY: X\nROLE: Analyst\nSCORE: 3.2\nARCHETYPE: A\nLEGITIMACY: High Confidence\n---END_SUMMARY---\n`;
    const model = (c) => async () => okReply(null, c);
    const renderPdf = chromiumOk ? createRenderer({ timeoutMs: 30_000 }).renderPdf : async () => ({ pdf: TINY_PDF, pages: 1, atsFindings: [] });
    const index = createJobIndex({ sources: [{ entry: { name: 'S' }, provider: { fetch: async () => [{ title: 'Senior Data Analyst', url: 'https://boards.example/1', location: 'London' }] } }], makeCtx: () => ({}), log: () => {} });
    await index.refresh();
    const store = createStore();
    ctx = await start({ store, limits, tasks: {
      gap: GAP_TASK, scan: createScanTask({ index }),
      score: createScoreTask({ apiKey: 'k', model: 'm', maxPricePerM: { prompt: 1, completion: 2 }, fetchFn: model(scoreReply) }),
      pdf: createPdfTask({ apiKey: 'k', model: 'm', maxPricePerM: { prompt: 1, completion: 2 }, fetchFn: model(JSON.stringify(GOOD_PAYLOAD)), render: renderPdf }),
    } });
    const codes = {};
    const urls = {};
    for (const t of ['gap', 'score', 'pdf', 'scan']) {
      const r = await fetch(`${ctx.base}/api/evaluate`, { method: 'POST', body: form(t) });
      codes[t] = r.status;
      if (r.ok) urls[t] = (await r.json()).resultUrl.replace('/result.html#', '/api/result/');
    }
    const found = [];
    const walk = (dir, depth) => {
      if (depth > 5) return;
      let names; try { names = readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of names) {
        const p = join(dir, e.name);
        if (e.isDirectory()) { walk(p, depth + 1); continue; }
        try {
          const st = statSync(p);
          if (st.mtimeMs < started || st.size > 20_000_000) continue;
          const buf = readFileSync(p);
          if (buf.includes(CV_MARK) || buf.includes(JOB_MARK)) found.push(p);
        } catch { /* locked or vanished: not ours */ }
      }
    };
    walk(tmpdir(), 0);
    const walkedDb = existsSync(join(dbDir, 'limits.db'));
    const text = logged.join('\n');
    const logsClean = !text.includes(CV_MARK) && !text.includes(JOB_MARK) && !text.includes('ada@example.org');
    // The kept result is the only copy: deleting it makes it unreachable (a result is the visitor's data, so this is the deletion path).
    const before = (await fetch(`${ctx.base}${urls.score}`)).status;
    await fetch(`${ctx.base}${urls.score}`, { method: 'DELETE' });
    const after = (await fetch(`${ctx.base}${urls.score}`)).status;
    if (Object.values(codes).every((c) => c === 200) && found.length === 0 && walkedDb && logsClean && before === 200 && after === 404 && store.size() === 3) {
      pass(`leak check: after gap, score, pdf${chromiumOk ? ' (real Chromium)' : ''} and scan, no CV or job bytes in any file written under the temp dir (including the limits DB) or in logs; deleting a result removes it`);
    } else fail(`leak check: codes ${JSON.stringify(codes)}, files with CV bytes: ${found.join(', ')}, db ${walkedDb}, logsClean ${logsClean}, before ${before} after ${after}, store ${store.size()}`);
    if (!chromiumOk) warn('Chromium is not installed: leak check ran the pdf task with a stand-in renderer');
    limits.close();
  } catch (e) { fail(`leak check crashed: ${e.stack || e.message}`); }
  finally { ctx?.server.close(); }

  // 4b. Behind a proxy the app listens on loopback only (X-Forwarded-For is trusted there); control: otherwise all interfaces.
  try {
    const base = { PATH: process.env.PATH, JOBBER_DEV: '1', JOBBER_DB: ':memory:', JOBBER_SCAN_ENABLED: '0' };
    const proxied = readConfig({ ...base, JOBBER_TRUST_PROXY: '1' });
    const plain = readConfig(base);
    const custom = readConfig({ ...base, JOBBER_TRUST_PROXY: '1', JOBBER_HOST: '10.0.0.5' });
    if (proxied.host === '127.0.0.1' && plain.host === undefined && custom.host === '10.0.0.5') pass('listen address: loopback only when the proxy header is trusted, all interfaces otherwise, JOBBER_HOST overrides');
    else fail(`listen host: ${proxied.host} / ${plain.host} / ${custom.host}`);
    for (const c of [proxied, plain, custom]) c.options.limits.close();
  } catch (e) { fail(`listen host test crashed: ${e.message}`); }

  // 4c. Error text never reaches the wire as markup: a task message holding HTML is escaped in the bytes and identical after parsing.
  try {
    const evil = '<img src=x onerror=alert(1)> & <script>';
    const task = { maxCostUsd: () => 0, run: async () => { throw new TaskError(503, evil); } };
    ctx = await start({ tasks: { gap: task } });
    const r = await fetch(`${ctx.base}/api/evaluate`, { method: 'POST', body: form('gap') });
    const bytes = await r.text();
    const control = JSON.stringify({ error: evil });   // what an unescaped server would have sent
    if (r.status === 503 && !/[<>&]/.test(bytes) && JSON.parse(bytes).error === evil && /[<>]/.test(control) && /^application\/json/.test(r.headers.get('content-type'))) pass('error bodies: markup characters in a message are escaped in the JSON bytes and unchanged after parsing');
    else fail(`error body escaping: ${r.status} ${bytes}`);
  } catch (e) { fail(`error escaping test crashed: ${e.message}`); }
  finally { ctx?.server.close(); }

  // 5. Kill-switch drill: on, evaluate is refused (even for a valid request) and nothing is stored; off, service resumes.
  try {
    const killFile = join(work, 'KILL');
    const store = createStore();
    ctx = await start({ killFile, store });
    const send = () => fetch(`${ctx.base}/api/evaluate`, { method: 'POST', body: form('gap') });
    const before = await send();
    writeFileSync(killFile, '');
    const during = await send();
    const body = await during.json();
    const page = await fetch(`${ctx.base}/`);
    rmSync(killFile);
    const after = await send();
    if (before.status === 200 && during.status === 503 && /switched off/.test(body.error) && page.status === 200 && after.status === 200 && store.size() === 2) {
      pass('kill switch: creating the file refuses new work at once (503, nothing stored, pages still load); deleting it resumes service without a restart');
    } else fail(`kill switch: before ${before.status}, during ${during.status}, page ${page.status}, after ${after.status}, stored ${store.size()}`);
  } catch (e) { fail(`kill switch test crashed: ${e.message}`); }
  finally { ctx?.server.close(); }

  // 6. Load: many concurrent requests all get an answer, memory stays bounded, a full store refuses without evicting.
  try {
    const store = createStore();
    ctx = await start({ store, limits: createLimits({ dailyLimit: Infinity, dailyBudgetUsd: Infinity }) });
    const rss0 = process.memoryUsage().rss;
    const t0 = [];
    const one = async () => { const s = Date.now(); const r = await fetch(`${ctx.base}/api/evaluate`, { method: 'POST', body: form('gap') }); t0.push(Date.now() - s); return r.status; };
    const statuses = await Promise.all(Array.from({ length: 80 }, one));
    const sorted = t0.sort((a, b) => a - b);
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    const grew = (process.memoryUsage().rss - rss0) / 1e6;
    if (statuses.every((s) => s === 200) && store.size() === 80 && p95 < 10_000 && grew < 250) pass(`load: 80 concurrent requests all answered 200 (p95 ${p95} ms), result store holds exactly 80, memory grew ${grew.toFixed(0)} MB`);
    else fail(`load: statuses ${[...new Set(statuses)]}, stored ${store.size()}, p95 ${p95}, grew ${grew.toFixed(0)} MB`);
  } catch (e) { fail(`load test crashed: ${e.message}`); }
  finally { ctx?.server.close(); }

  try {
    const store = createStore({ maxItems: 4 });
    ctx = await start({ store, limits: createLimits({ dailyLimit: Infinity }) });
    const out = [];
    for (let i = 0; i < 7; i++) { const r = await fetch(`${ctx.base}/api/evaluate`, { method: 'POST', body: form('gap') }); out.push([r.status, r.ok ? (await r.json()).resultUrl : null]); }
    const kept = await Promise.all(out.filter((o) => o[0] === 200).map((o) => fetch(`${ctx.base}${o[1].replace('/result.html#', '/api/result/')}`).then((r) => r.status)));
    if (out.filter((o) => o[0] === 200).length === 4 && out.filter((o) => o[0] === 503).length === 3 && kept.every((s) => s === 200)) pass('store full: the first 4 results are kept, later requests get 503, and no live result is evicted');
    else fail(`store full: ${JSON.stringify(out.map((o) => o[0]))} kept ${kept}`);
  } catch (e) { fail(`store-full test crashed: ${e.message}`); }
  finally { ctx?.server.close(); }

  // 7. PDF queue under load: only the allowed number of renders at once, the rest refused before any model spend.
  try {
    let active = 0, peak = 0, modelCalls = 0;
    const slots = createSlots({ concurrency: 1, maxPending: 2 });
    const fakeBrowser = () => ({
      newContext: async () => ({ route: async () => {}, newPage: async () => ({ setContent: async () => {}, pdf: async () => { active++; peak = Math.max(peak, active); await new Promise((r) => setTimeout(r, 60)); active--; return TINY_PDF; } }) }),
      close: async () => {},
    });
    const { renderPdf } = createRenderer({ slots, launch: async () => fakeBrowser(), timeoutMs: 5000 });
    const fetchFn = async () => { modelCalls++; await new Promise((r) => setTimeout(r, 30)); return okReply(GOOD_PAYLOAD); };
    const limits = createLimits({ dailyLimit: Infinity, dailyBudgetUsd: 10 });
    const pdf = createPdfTask({ apiKey: 'k', model: 'm', maxPricePerM: { prompt: 1, completion: 2 }, fetchFn, render: renderPdf, maxInFlight: 3 });
    ctx = await start({ limits, tasks: { gap: GAP_TASK, pdf } });
    const statuses = await Promise.all(Array.from({ length: 12 }, () => fetch(`${ctx.base}/api/evaluate`, { method: 'POST', body: form('pdf') }).then((r) => r.status)));
    const okN = statuses.filter((s) => s === 200).length;
    const refused = statuses.filter((s) => s === 400).length;
    if (statuses.every((s) => s === 200 || s === 400) && okN >= 1 && refused >= 1 && okN + refused === 12 && peak === 1 && modelCalls === okN
      && Math.abs(limits.spentTodayUsd() - 0.005 * okN) < 1e-9) pass(`pdf queue: of 12 simultaneous requests ${okN} were built (never more than 1 render at once) and ${refused} were refused before the model was called or any money was spent`);
    else fail(`pdf queue: ${JSON.stringify(statuses)} peak ${peak}, model calls ${modelCalls}, spent ${limits.spentTodayUsd()}`);
  } catch (e) { fail(`pdf queue test crashed: ${e.stack || e.message}`); }
  finally { ctx?.server.close(); }
} catch (e) {
  fail(`hosted hardening tests crashed: ${e.stack || e.message}`);
} finally {
  loud();
  try { rmSync(work, { recursive: true, force: true }); } catch { /* best effort: a locked temp dir is cleaned by the OS */ }
}

queued.forEach((f) => f());
