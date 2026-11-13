// server/index.mjs — hosted Jobber API. Plain node:http. Needs Node >= 22.13.
//   POST   /api/evaluate      multipart: cv (file), task, job, cf-turnstile-response -> 200 {resultUrl}
//   GET    /api/result/:token -> 200 {expiresAt, result}
//   DELETE /api/result/:token -> 204
// Also serves ../site for local runs (production puts Caddy in front).
//
// Privacy rules enforced here: the CV is held in memory only for the request;
// only the finished result is kept (store.mjs, memory, TTL); logs carry
// route, status and duration only — never bodies, text, results or IPs.
//
// Config (environment). Production refuses to start unless all of these are set;
// JOBBER_DEV=1 relaxes that for local runs (no bot check, no limits).
//   TURNSTILE_SECRET         Cloudflare Turnstile secret key
//   JOBBER_HASH_SECRET       long random string; keeps visitor hashes stable across restarts
//   JOBBER_DAILY_LIMIT       checks per visitor per UTC day (positive integer)
//   JOBBER_DAILY_BUDGET_USD  global spend cap per UTC day for paid (LLM) tasks
// Optional: PORT (8787), JOBBER_RESULT_TTL_MS (30 min), JOBBER_DB (server/data/limits.db),
//   JOBBER_KILL_FILE (if this file exists every request is refused with 503),
//   JOBBER_TRUST_PROXY=1 (read the client IP from the last X-Forwarded-For entry; set only behind Caddy)

import { createServer } from 'node:http';
import { existsSync, mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCv, MAX_CV_BYTES } from './cv.mjs';
import { runGap } from './gap.mjs';
import { createLimits } from './limits.mjs';
import { createStore, TOKEN_RE } from './store.mjs';
import { createTurnstile } from './turnstile.mjs';

const SITE_DIR = resolve(fileURLToPath(new URL('../site/', import.meta.url)));
const MAX_BODY = MAX_CV_BYTES + 256 * 1024; // CV + job text + multipart framing
const MIN_JOB = 80;
const MAX_JOB = 50_000;
// Each task returns {result, costUsd}. score, pdf and scan are added in later steps.
const TASKS = { gap: async (cv, job) => ({ result: runGap(cv, job), costUsd: 0 }) };
// Worst-case cost reserved against the daily budget before a task runs.
const MAX_COST_USD = { gap: 0 };
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

/** Refuse before reading the body. Drain briefly so the client can read the reply
 *  (closing with unread data resets the connection), then cut it off after 5 s. */
function refuse(req, res, status, error) {
  req.resume();
  setTimeout(() => req.destroy(), 5000).unref();
  fail(res, status, error);
}

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

function clientIp(req, trustProxy) {
  if (trustProxy) {
    const last = String(req.headers['x-forwarded-for'] || '').split(',').pop().trim();
    if (last) return last;
  }
  return req.socket.remoteAddress || '';
}

async function evaluate(req, res, { store, limits, verifyBot, trustProxy, killFile }) {
  if (killFile && existsSync(killFile)) return refuse(req, res, 503, 'Jobber is switched off for now. Try again later.');
  const type = req.headers['content-type'] || '';
  if (!/^multipart\/form-data;/i.test(type)) return fail(res, 400, 'Send your CV as a file upload.');

  const body = await readBody(req);
  if (body === null) return refuse(req, res, 413, 'That upload is too large. The limit is 5 MB.');

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
  const bytes = Buffer.from(await file.arrayBuffer());

  // Bot check before any parsing of the upload, so a bot cannot make us parse PDFs.
  if (verifyBot) {
    const v = await verifyBot(String(form.get('cf-turnstile-response') ?? ''));
    if (!v.ok) {
      return v.reason === 'unavailable'
        ? fail(res, 503, 'We could not run the bot check. Try again in a minute.')
        : fail(res, 403, 'The bot check did not pass. Complete it and try again.');
    }
  }

  // From here to the result, everything up to the awaited task is synchronous,
  // so concurrent requests cannot both slip under a limit.
  const ip = clientIp(req, trustProxy);
  const spend = limits.reserve(MAX_COST_USD[task]);
  if (!spend) return fail(res, 503, 'The free service has reached its budget for today. Try again tomorrow.');
  let costUsd = 0;
  try {
    const tooMany = 'You have used today’s free checks. Come back tomorrow.';
    if (limits.isOver(ip)) return fail(res, 429, tooMany);
    const cv = readCv(bytes, file.name);
    if (!cv.ok) return fail(res, cv.status, cv.error); // a rejected upload does not use a check
    if (!limits.tryConsume(ip)) return fail(res, 429, tooMany);

    const out = await TASKS[task](cv.text, job);
    costUsd = out.costUsd;
    const token = store.put(out.result);
    if (!token) return fail(res, 503, 'The service is busy right now. Try again in a few minutes.');
    sendJson(res, 200, { resultUrl: `/result.html#${token}` });
  } finally {
    spend.settle(costUsd);
  }
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

/**
 * Defaults are permissive (no bot check, no limits) so tests stay simple;
 * the entry point below is what enforces production config.
 */
export function createApp({
  store = createStore(), limits = createLimits(), verifyBot = null, trustProxy = false, killFile = null,
} = {}) {
  const ctx = { store, limits, verifyBot, trustProxy, killFile };
  const server = createServer(async (req, res) => {
    const started = Date.now();
    const { pathname } = new URL(req.url, 'http://x');
    let task = '-';
    try {
      const result = /^\/api\/result\/([^/]+)$/.exec(pathname);
      if (pathname === '/api/evaluate') {
        task = 'evaluate';
        if (req.method !== 'POST') return send(res, 405, '', { Allow: 'POST' });
        await evaluate(req, res, ctx);
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

/** Read and validate production config. Returns {errors} or {options}. */
export function readConfig(env) {
  const dev = env.JOBBER_DEV === '1';
  const errors = [];
  const limit = Number(env.JOBBER_DAILY_LIMIT);
  const budget = Number(env.JOBBER_DAILY_BUDGET_USD);
  if (!dev) {
    if (!env.TURNSTILE_SECRET) errors.push('TURNSTILE_SECRET is not set');
    if (!env.JOBBER_HASH_SECRET || env.JOBBER_HASH_SECRET.length < 32) errors.push('JOBBER_HASH_SECRET must be set to at least 32 characters');
    if (!Number.isInteger(limit) || limit < 1) errors.push('JOBBER_DAILY_LIMIT must be a positive integer');
    if (!(budget > 0)) errors.push('JOBBER_DAILY_BUDGET_USD must be a number above 0');
  }
  if (errors.length) return { errors };

  const dbPath = env.JOBBER_DB || fileURLToPath(new URL('./data/limits.db', import.meta.url));
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
  return {
    errors,
    port: Number(env.PORT ?? 8787),
    options: {
      store: createStore({ ttlMs: Number(env.JOBBER_RESULT_TTL_MS) || 30 * 60 * 1000 }),
      limits: createLimits({
        dbPath, secret: env.JOBBER_HASH_SECRET || undefined,
        dailyLimit: dev && !env.JOBBER_DAILY_LIMIT ? Infinity : limit,
        dailyBudgetUsd: dev && !env.JOBBER_DAILY_BUDGET_USD ? Infinity : budget,
      }),
      verifyBot: env.TURNSTILE_SECRET ? createTurnstile({ secret: env.TURNSTILE_SECRET }) : null,
      trustProxy: env.JOBBER_TRUST_PROXY === '1',
      killFile: env.JOBBER_KILL_FILE || null,
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const cfg = readConfig(process.env);
  if (cfg.errors.length) {
    console.error('Refusing to start:\n  ' + cfg.errors.join('\n  ') + '\n(Set JOBBER_DEV=1 for a local run without a bot check or limits.)');
    process.exit(1);
  }
  const server = createApp(cfg.options);
  server.listen(cfg.port, () => console.log(`jobber server on :${server.address().port}${process.env.JOBBER_DEV === '1' ? ' (dev: no bot check or limits unless configured)' : ''}`));
}
