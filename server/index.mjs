// server/index.mjs — hosted Jobber API. Plain node:http, no dependencies.
//   POST   /api/evaluate      multipart: cv (file), task, job  -> 200 {resultUrl}
//   GET    /api/result/:token -> 200 {expiresAt, result}
//   DELETE /api/result/:token -> 204
// Also serves ../site for local runs (production puts Caddy in front).
//
// Privacy rules enforced here: the CV is held in memory only for the request;
// only the finished result is kept (store.mjs, memory, TTL); logs carry
// task, status and duration only — never bodies, text, results or IPs.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCv, MAX_CV_BYTES } from './cv.mjs';
import { runGap } from './gap.mjs';
import { createStore, TOKEN_RE } from './store.mjs';

const SITE_DIR = resolve(fileURLToPath(new URL('../site/', import.meta.url)));
const MAX_BODY = MAX_CV_BYTES + 256 * 1024; // CV + job text + multipart framing
const MIN_JOB = 80;
const MAX_JOB = 50_000;
const TASKS = { gap: runGap };            // score, pdf, scan are added in later steps
const KNOWN_TASKS = new Set(['score', 'gap', 'pdf', 'scan']);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml',
};

const SECURITY = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
const PRIVATE = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' };

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...SECURITY, ...headers });
  res.end(body);
}
const sendJson = (res, status, obj, headers = {}) =>
  send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8', ...PRIVATE, ...headers });
const fail = (res, status, error) => sendJson(res, status, { error });

/** Read the request body up to MAX_BODY. Resolves null when it is too large. */
function readBody(req) {
  return new Promise((resolveBody, reject) => {
    if (Number(req.headers['content-length']) > MAX_BODY) return resolveBody(null);
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { chunks.length = 0; req.removeAllListeners('data'); resolveBody(null); return; }
      chunks.push(c);
    });
    req.on('end', () => resolveBody(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function evaluate(req, res, store) {
  const type = req.headers['content-type'] || '';
  if (!/^multipart\/form-data;/i.test(type)) return fail(res, 400, 'Send your CV as a file upload.');

  const body = await readBody(req);
  if (body === null) {
    // Drain the rest briefly so the client can read the 413 (closing with unread data resets
    // the connection); cut it off after 5 s so this cannot become a bandwidth sink.
    req.resume();
    setTimeout(() => req.destroy(), 5000).unref();
    return fail(res, 413, 'That upload is too large. The limit is 5 MB.');
  }

  let form;
  try { form = await new Response(body, { headers: { 'content-type': type } }).formData(); }
  catch { return fail(res, 400, 'We could not read that upload. Try again.'); }

  const task = String(form.get('task') ?? '');
  if (!KNOWN_TASKS.has(task)) return fail(res, 400, 'Choose what you want to do.');
  if (!TASKS[task]) return fail(res, 503, 'That option is not available yet. Try “Check the skill gap”.');

  const job = String(form.get('job') ?? '').trim();
  if (job.length < MIN_JOB) return fail(res, 400, 'Paste the full job description. It looks too short to use.');
  if (job.length > MAX_JOB) return fail(res, 413, 'That job description is too long. The limit is 50,000 characters.');

  const file = form.get('cv');
  if (!file || typeof file === 'string') return fail(res, 400, 'Choose your CV first.');
  const cv = readCv(Buffer.from(await file.arrayBuffer()), file.name);
  if (!cv.ok) return fail(res, cv.status, cv.error);

  const token = store.put(TASKS[task](cv.text, job));
  if (!token) return fail(res, 503, 'The service is busy right now. Try again in a few minutes.');
  sendJson(res, 200, { resultUrl: `/result.html#${token}` });
}

async function serveStatic(pathname, res) {
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const file = normalize(join(SITE_DIR, rel));
  if (file !== SITE_DIR && !file.startsWith(SITE_DIR + sep)) return fail(res, 404, 'Not found.');
  try {
    const data = await readFile(file);
    send(res, 200, data, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
  } catch { fail(res, 404, 'Not found.'); }
}

export function createApp({ store = createStore() } = {}) {
  const server = createServer(async (req, res) => {
    const started = Date.now();
    const { pathname } = new URL(req.url, 'http://x');
    let task = '-';
    try {
      const result = /^\/api\/result\/([^/]+)$/.exec(pathname);
      if (pathname === '/api/evaluate') {
        task = 'evaluate';
        if (req.method !== 'POST') return send(res, 405, '', { Allow: 'POST' });
        await evaluate(req, res, store);
      } else if (result) {
        task = 'result';
        const token = result[1];
        const entry = TOKEN_RE.test(token) ? store.get(token) : null;
        if (!entry) return fail(res, 404, 'This result has expired or does not exist.');
        if (req.method === 'GET') {
          send(res, 200, `{"expiresAt":${entry.expires},"result":${entry.body}}`,
            { 'Content-Type': 'application/json; charset=utf-8', ...PRIVATE });
        } else if (req.method === 'DELETE') {
          store.delete(token);
          send(res, 204, '', PRIVATE);
        } else send(res, 405, '', { Allow: 'GET, DELETE' });
      } else if (req.method === 'GET' || req.method === 'HEAD') {
        await serveStatic(pathname, res);
      } else send(res, 405, '');
    } catch (err) {
      if (!res.headersSent) fail(res, 500, 'Something went wrong on our side. Try again.');
      console.error(`error ${err?.name || 'Error'}`); // never log err.message: it can echo CV text
    } finally {
      console.log(JSON.stringify({ route: task, status: res.statusCode, ms: Date.now() - started }));
    }
  });
  server.requestTimeout = 60_000;
  const sweeper = setInterval(store.sweep, 60_000);
  sweeper.unref();
  server.on('close', () => clearInterval(sweeper));
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 8787;
  const ttlMs = Number(process.env.JOBBER_RESULT_TTL_MS) || 30 * 60 * 1000;
  createApp({ store: createStore({ ttlMs }) }).listen(port, () => console.log(`jobber server on :${port}`));
}
