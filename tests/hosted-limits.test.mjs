// tests/hosted-limits.test.mjs — hosted API abuse controls: Turnstile, per-visitor
// daily limit, global spend cap, kill switch, and production config checks.
import { pass as emitPass, fail as emitFail, warn, ROOT, NODE } from './helpers.mjs';
import { createApp, readConfig } from '../server/index.mjs';
import { createLimits, normalizeIp } from '../server/limits.mjs';
import { createTurnstile } from '../server/turnstile.mjs';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

console.log('\nhosted server (abuse controls)');

// pass/fail print via console.log, which is silenced while requests run; queue and flush at the end.
const queued = [];
const pass = (m) => queued.push(() => emitPass(m));
const fail = (m) => queued.push(() => emitFail(m));
const realLog = console.log, realErr = console.error;
const quiet = () => { console.log = () => {}; console.error = () => {}; };
const loud = () => { console.log = realLog; console.error = realErr; };

const CV = '# Skills\nPython\n';
const JD = `# Role\n\n## Requirements\n- Python, Kubernetes\n\nThis posting is long enough to pass the minimum length check easily.`;
const IP = '203.0.113.' + '7'; // concatenated: the DB test searches for this exact string

const start = (opts) => new Promise((res) => {
  const server = createApp(opts);
  server.listen(0, '127.0.0.1', () => res({ server, base: `http://127.0.0.1:${server.address().port}` }));
});
const post = (base, { ip, bot, job = JD, bytes = Buffer.from(CV), name = 'cv.md' } = {}) => {
  const form = new FormData();
  form.set('task', 'gap');
  form.set('job', job);
  form.set('cv', new Blob([bytes]), name);
  if (bot !== undefined) form.set('cf-turnstile-response', bot);
  return fetch(`${base}/api/evaluate`, { method: 'POST', body: form, headers: ip ? { 'x-forwarded-for': ip } : {} });
};
const statuses = async (base, n, opts) => { const out = []; for (let i = 0; i < n; i++) out.push((await post(base, opts)).status); return out; };

quiet();
try {
  // 1. Turnstile module: what is sent, and every outcome. Control: success:true passes.
  try {
    const seen = [];
    const mk = (reply) => createTurnstile({ secret: 'sekret', fetchFn: async (url, init) => { seen.push({ url, body: String(init.body) }); return reply(); } });
    const json = (o, ok = true) => () => ({ ok, json: async () => o });
    const good = await mk(json({ success: true }))('tok');
    const bad = await mk(json({ success: false }))('tok');
    const down = await mk(json({}, false))('tok');
    const boom = await createTurnstile({ secret: 's', fetchFn: async () => { throw new Error('offline'); } })('tok');
    const none = await mk(json({ success: true }))('');
    const sent = new URLSearchParams(seen[0].body);
    if (good.ok && bad.reason === 'rejected' && down.reason === 'unavailable' && boom.reason === 'unavailable' && none.reason === 'missing'
      && seen.length === 3 && sent.get('secret') === 'sekret' && sent.get('response') === 'tok' && [...sent.keys()].sort().join() === 'response,secret') {
      pass('turnstile: success passes; rejected, unreachable and empty token fail closed; only secret and token are sent');
    } else fail(`turnstile outcomes: ${JSON.stringify({ good, bad, down, boom, none, calls: seen.length, keys: [...sent.keys()] })}`);
  } catch (e) { fail(`turnstile unit crashed: ${e.message}`); }

  // 2. Bot check gates the endpoint (server wiring).
  let ctx;
  try { ctx = await start({ verifyBot: async (t) => (t === 'good' ? { ok: true } : t === 'down' ? { ok: false, reason: 'unavailable' } : { ok: false, reason: 'rejected' }) }); }
  catch (e) { warn(`bot-check server could not start: ${e.message}`); }
  if (ctx) {
    try {
      const noTok = (await post(ctx.base)).status;
      const wrong = (await post(ctx.base, { bot: 'nope' })).status;
      const down = (await post(ctx.base, { bot: 'down' })).status;
      const ok = (await post(ctx.base, { bot: 'good' })).status;
      if (noTok === 403 && wrong === 403 && down === 503 && ok === 200) pass('server: missing/rejected bot token is 403, unreachable check is 503, valid token is 200');
      else fail(`bot gate: none ${noTok}, wrong ${wrong}, down ${down}, good ${ok}`);
    } finally { ctx.server.close(); }
  }

  // 3. Daily limit: 3rd check refused; other visitor unaffected; rejected uploads and bad input are free.
  ctx = undefined;
  try { ctx = await start({ limits: createLimits({ dailyLimit: 2 }), trustProxy: true }); }
  catch (e) { warn(`limit server could not start: ${e.message}`); }
  if (ctx) {
    try {
      const shortJob = (await post(ctx.base, { ip: '198.51.100.1', job: 'short' })).status;
      const badFile = (await post(ctx.base, { ip: '198.51.100.1', name: 'cv.pdf' })).status;
      const own = await statuses(ctx.base, 3, { ip: '198.51.100.1' });
      const other = (await post(ctx.base, { ip: '198.51.100.2' })).status;
      if (shortJob === 400 && badFile === 415 && own.join() === '200,200,429' && other === 200) pass('limit of 2: bad input and rejected files are free, 3rd check is 429, another visitor still gets 200');
      else fail(`limits: shortJob ${shortJob}, badFile ${badFile}, own ${own}, other ${other}`);
    } finally { ctx.server.close(); }
  }

  // 4. Without trustProxy the forwarded header is ignored (control for 3: a spoofed header must not mint new visitors).
  ctx = undefined;
  try { ctx = await start({ limits: createLimits({ dailyLimit: 1 }), trustProxy: false }); }
  catch (e) { warn(`spoof server could not start: ${e.message}`); }
  if (ctx) {
    try {
      const a = (await post(ctx.base, { ip: '198.51.100.1' })).status;
      const b = (await post(ctx.base, { ip: '198.51.100.2' })).status;
      if (a === 200 && b === 429) pass('X-Forwarded-For is ignored unless the proxy is trusted');
      else fail(`spoof: first ${a} (want 200), second with other XFF ${b} (want 429)`);
    } finally { ctx.server.close(); }
  }

  // 5. Limits unit: IPv6 /64 collapse, day rollover, no raw IP stored.
  try {
    let day = '2026-01-01T10:00:00Z';
    const dir = mkdtempSync(join(tmpdir(), 'jobber-limits-'));
    const dbPath = join(dir, 'l.db');
    const lim = createLimits({ dbPath, secret: 'a'.repeat(40), dailyLimit: 1, now: () => new Date(day) });
    const v6a = lim.tryConsume('2001:db8:1:2:aaaa::1');
    const v6same = lim.tryConsume('2001:db8:1:2:bbbb::9');      // same /64 -> shares the count
    const v6other = lim.tryConsume('2001:db8:1:3::1');          // different /64
    day = '2026-01-02T00:00:01Z';
    const next = lim.tryConsume('2001:db8:1:2:aaaa::1');        // new day -> allowed again
    lim.tryConsume(IP);
    lim.close();
    const reader = new DatabaseSync(dbPath);
    const rows = reader.prepare('SELECT day, visitor, n FROM visits').all();
    reader.close();
    const dump = JSON.stringify(rows);
    const same = normalizeIp('2001:db8:1:2:aaaa::1') === normalizeIp('2001:0DB8:1:2::7');
    if (v6a && !v6same && v6other && next && same && rows.length > 0 && !dump.includes(IP) && !dump.includes('2001') && rows.every((r) => r.day === '2026-01-02')) {
      pass('limits: IPv6 shares a /64, resets next UTC day, old days are purged, DB holds no raw IP');
    } else fail(`limits unit: ${JSON.stringify({ v6a, v6same, v6other, next, same, rows })}`);
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* temp dir cleanup is best effort */ }
  } catch (e) { fail(`limits unit crashed: ${e.message}`); }

  // 6. Spend cap: reserve over the cap is refused; in-flight reservations count; free tasks still pass.
  try {
    const lim = createLimits({ dailyBudgetUsd: 1 });
    const r1 = lim.reserve(0.6);
    const r2 = lim.reserve(0.6);                 // 0.6 pending + 0.6 > 1
    r1.settle(0.5);
    const r3 = lim.reserve(0.6);                 // spent 0.5 + 0.6 > 1
    const r4 = lim.reserve(0.4);                 // 0.5 + 0.4 <= 1
    r4.settle(0.4);
    r4.settle(5);                                // double settle is ignored
    const exhausted = lim.reserve(0.2);
    const free = lim.reserve(0);                 // a zero-cost task is never blocked
    free.settle(0);
    if (r1 && r2 === null && r3 === null && r4 && Math.abs(lim.spentTodayUsd() - 0.9) < 1e-9 && exhausted === null && free) {
      pass('spend cap: pending counts, overshoot refused, settle adds actual spend once, zero-cost tasks pass');
    } else fail(`spend: ${JSON.stringify({ r1: !!r1, r2, r3, r4: !!r4, spent: lim.spentTodayUsd(), exhausted, free: !!free })}`);
  } catch (e) { fail(`spend cap unit crashed: ${e.message}`); }

  // 7. Kill switch file: present -> 503, removed -> 200 (control).
  ctx = undefined;
  const kdir = mkdtempSync(join(tmpdir(), 'jobber-kill-'));
  const killFile = join(kdir, 'OFF');
  try { ctx = await start({ killFile }); } catch (e) { warn(`kill-switch server could not start: ${e.message}`); }
  if (ctx) {
    try {
      const before = (await post(ctx.base)).status;
      writeFileSync(killFile, '');
      const during = (await post(ctx.base)).status;
      rmSync(killFile);
      const after = (await post(ctx.base)).status;
      if (before === 200 && during === 503 && after === 200) pass('kill switch: file present refuses with 503; removing it restores service');
      else fail(`kill switch: before ${before}, during ${during}, after ${after}`);
    } finally { ctx.server.close(); rmSync(kdir, { recursive: true, force: true }); }
  }

  // 8. Production config refuses to start unless everything is set (control: complete config is accepted).
  try {
    const base = { PATH: process.env.PATH };
    const empty = readConfig(base);
    const weak = readConfig({ ...base, TURNSTILE_SECRET: 's', JOBBER_HASH_SECRET: 'short', JOBBER_DAILY_LIMIT: '5', JOBBER_DAILY_BUDGET_USD: '2', JOBBER_DB: ':memory:' });
    const good = readConfig({ ...base, TURNSTILE_SECRET: 's', JOBBER_HASH_SECRET: 'x'.repeat(40), JOBBER_DAILY_LIMIT: '5', JOBBER_DAILY_BUDGET_USD: '2', JOBBER_DB: ':memory:' });
    const dev = readConfig({ ...base, JOBBER_DEV: '1', JOBBER_DB: ':memory:' });
    const names = ['TURNSTILE_SECRET', 'JOBBER_HASH_SECRET', 'JOBBER_DAILY_LIMIT', 'JOBBER_DAILY_BUDGET_USD'];
    const missingAll = names.every((n) => empty.errors.some((e) => e.includes(n)));
    const weakOnly = weak.errors.length === 1 && weak.errors[0].includes('JOBBER_HASH_SECRET');
    if (missingAll && weakOnly && good.errors.length === 0 && good.options.verifyBot && dev.errors.length === 0 && dev.options.verifyBot === null) {
      pass('config: production needs all four settings (weak hash secret refused); dev mode needs none');
    } else fail(`config: ${JSON.stringify({ empty: empty.errors, weak: weak.errors, good: good.errors, dev: dev.errors })}`);
    good.options.limits.close(); dev.options.limits.close();
  } catch (e) { fail(`config unit crashed: ${e.message}`); }

  // 9. The real entry point exits 1 with the reason (spawned, so the message is asserted, not the source text).
  try {
    const run = (env) => spawnSync(NODE, ['server/index.mjs'], { cwd: ROOT, env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...env }, encoding: 'utf8', timeout: 4000 });
    const refused = run({});
    const started = run({ JOBBER_DEV: '1', PORT: '0', JOBBER_DB: ':memory:' }); // killed by timeout: it started and kept listening
    if (refused.status === 1 && /TURNSTILE_SECRET/.test(refused.stderr) && /jobber server on/.test(started.stdout)) pass('entry point refuses to start without config and prints why; JOBBER_DEV=1 starts');
    else fail(`entry point: refused status ${refused.status} stderr ${refused.stderr.slice(0, 120)} | dev stdout ${started.stdout.slice(0, 80)}`);
  } catch (e) { fail(`entry point spawn crashed: ${e.message}`); }
} finally {
  loud();
}

queued.forEach((f) => f());
