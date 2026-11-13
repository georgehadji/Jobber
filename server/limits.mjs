// server/limits.mjs — per-visitor daily limit and global daily spend cap.
// Needs Node >= 22.13 (node:sqlite). Stores salted hashes and money totals only:
// never a raw IP, never CV or job text.
//
// A visitor is HMAC(HMAC(secret, UTC day), ip). The key changes every day, so a
// visitor cannot be linked across days; the DB cannot be reversed to an IP
// without the secret. IPv6 addresses collapse to their /64 so rotating inside
// one subnet does not buy extra checks.

import { DatabaseSync } from 'node:sqlite';
import { createHmac, randomBytes } from 'node:crypto';
import { isIPv6 } from 'node:net';

export function normalizeIp(raw) {
  let ip = String(raw || '').split('%')[0].replace(/^::ffff:/i, '');
  if (!isIPv6(ip)) return ip;
  const [h, t = ''] = ip.split('::');
  const head = h ? h.split(':') : [];
  const tail = t ? t.split(':') : [];
  const groups = [...head, ...Array(Math.max(0, 8 - head.length - tail.length)).fill('0'), ...tail];
  return groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '').toLowerCase() || '0').join(':') + '::/64';
}

/**
 * @param {{dbPath?: string, secret?: string, dailyLimit?: number, dailyBudgetUsd?: number, now?: () => Date}} opts
 */
export function createLimits({
  dbPath = ':memory:', secret = randomBytes(32).toString('hex'),
  dailyLimit = Infinity, dailyBudgetUsd = Infinity, now = () => new Date(),
} = {}) {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS visits (day TEXT NOT NULL, visitor TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (day, visitor));
    CREATE TABLE IF NOT EXISTS spend (day TEXT PRIMARY KEY, micro INTEGER NOT NULL);
  `);
  const capMicro = dailyBudgetUsd * 1e6;
  let pending = 0; // reserved by in-flight requests, in micro-dollars

  const day = () => now().toISOString().slice(0, 10); // UTC
  const visitor = (ip) =>
    createHmac('sha256', createHmac('sha256', secret).update(day()).digest()).update(normalizeIp(ip)).digest('hex').slice(0, 32);
  const used = (id) => db.prepare('SELECT n FROM visits WHERE day = ? AND visitor = ?').get(day(), id)?.n ?? 0;
  const spentMicro = () => db.prepare('SELECT micro FROM spend WHERE day = ?').get(day())?.micro ?? 0;

  return {
    /** Read-only: has this visitor used up today's checks? */
    isOver: (ip) => used(visitor(ip)) >= dailyLimit,

    /** Count one check. Synchronous, so check-and-increment cannot interleave. */
    tryConsume(ip) {
      const d = day();
      db.prepare('DELETE FROM visits WHERE day < ?').run(d);
      const id = visitor(ip);
      if (used(id) >= dailyLimit) return false;
      db.prepare('INSERT INTO visits (day, visitor, n) VALUES (?, ?, 1) ON CONFLICT (day, visitor) DO UPDATE SET n = n + 1').run(d, id);
      return true;
    },

    /**
     * Reserve the worst-case cost of a task before it runs. Returns null when it
     * would push today's spend over the cap; zero-cost tasks always pass.
     * Call settle(actualUsd) exactly once when the task ends, success or not.
     */
    reserve(maxUsd) {
      const micro = Math.round(maxUsd * 1e6);
      if (micro > 0 && spentMicro() + pending + micro > capMicro) return null;
      pending += micro;
      let done = false;
      return {
        settle(actualUsd = 0) {
          if (done) return;
          done = true;
          pending -= micro;
          const actual = Math.round(actualUsd * 1e6);
          if (actual > 0) {
            db.prepare('INSERT INTO spend (day, micro) VALUES (?, ?) ON CONFLICT (day) DO UPDATE SET micro = micro + excluded.micro').run(day(), actual);
          }
        },
      };
    },

    spentTodayUsd: () => spentMicro() / 1e6,
    close: () => db.close(),
  };
}
