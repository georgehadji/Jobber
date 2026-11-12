// tests/agent-inbox-lock.test.mjs — STATE-MACHINES-PLAN 5.4 (M16/M22): agent-inbox takes the shared
// lib/file-lock.mjs lock around its read-modify-write and writes atomically.
import { pass, fail, warn, ROOT, NODE } from './helpers.mjs';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { spawn } from 'child_process';

console.log('\nagent-inbox lock (5.4 / M16)');

let tmp;
try { tmp = mkdtempSync(join(tmpdir(), 'jobber-inbox-lock-')); } catch (e) { warn(`agent-inbox lock sandbox could not be built: ${e.message}`); }
if (tmp) {
  try {
    const file = join(tmp, 'agent-inbox.md');
    const lockDir = `${file}.lock`;
    const env = { ...process.env, JOBBER_INBOX: file };
    const cli = (...args) => new Promise((res) => {
      const c = spawn(NODE, [join(ROOT, 'agent-inbox.mjs'), ...args], { cwd: tmp, env });
      let err = '';
      c.stderr.on('data', (d) => { err += d; });
      c.on('close', (code) => res({ code, err }));
    });
    const items = () => readFileSync(file, 'utf-8').split('\n').filter((l) => /^- \[.\]/.test(l));

    // 1. Held lock blocks a writer (control: the same call succeeds once released).
    mkdirSync(lockDir);
    writeFileSync(join(lockDir, 'owner.json'), JSON.stringify({ pid: process.pid, token: 'test-holder', started_at: new Date().toISOString() }));
    const blocked = cli('add', 'while held');
    let finished = false;
    blocked.then(() => { finished = true; });
    await new Promise((r) => setTimeout(r, 1500));
    if (!finished && !existsSync(file)) pass('add waits while another live process holds the lock (nothing written)');
    else fail(`add did not wait for the held lock (finished=${finished}, file exists=${existsSync(file)})`);
    rmSync(lockDir, { recursive: true, force: true });
    const r1 = await blocked;
    if (r1.code === 0 && items().length === 1 && items()[0].includes('while held')) pass('control: add completes once the lock is released');
    else fail(`control: add after release — code ${r1.code}, items ${JSON.stringify(items())}, stderr ${r1.err}`);

    // 2. Parallel appends all survive, no lock or tmp debris is left behind.
    const N = 8;
    const results = await Promise.all(Array.from({ length: N }, (_, i) => cli('add', `parallel ${i}`)));
    const got = items();
    const missing = Array.from({ length: N }, (_, i) => `parallel ${i}`).filter((t) => !got.some((l) => l.endsWith(t)));
    if (results.every((r) => r.code === 0) && missing.length === 0) pass(`${N} parallel appends all survive`);
    else fail(`parallel appends lost items: missing ${JSON.stringify(missing)}, exit codes ${results.map((r) => r.code)}`);
    const debris = readdirSync(tmp).filter((n) => n.endsWith('.lock') || n.endsWith('.tmp'));
    if (debris.length === 0) pass('no lock directory or tmp file left behind');
    else fail(`debris left behind: ${JSON.stringify(debris)}`);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}
