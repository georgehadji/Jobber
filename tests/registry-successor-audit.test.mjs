// tests/registry-successor-audit.test.mjs — two assertions in test-all.mjs §49's
// registry/audit half asserted a property without testing the thing that grants
// it (defect-hunt batch 16).
//
// As in batch 15, the production code was found correct in both cases. These
// pin the discriminating conditions the §49 assertions were not exercising.
//
// B16-D1: the successor block varies the INSTALL across three cases (no lock /
//   wrong sha / pinned sha) while holding supersedesBundled true throughout, so
//   none of them shows the flag is what grants the override. If it became
//   decorative, every registry-approved plugin installed at its pinned sha could
//   take over a bundled plugin id with all three assertions still green.
// B16-D2: the audit assertion names three distinct forbidden patterns and
//   verifies them with `findings.length >= 3` — satisfied by three findings of
//   one kind.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\ntest-all.mjs §49 — successor trust hinge and audit identity (B16)');

const eng = await import(pathToFileURL(join(ROOT, 'plugins/_engine.mjs')).href);
const lockMod = await import(pathToFileURL(join(ROOT, 'plugins/_lock.mjs')).href);
const audit = await import(pathToFileURL(join(ROOT, 'plugin-audit.mjs')).href);

// ── B16-D1: supersedesBundled is what grants the override ────────
const SHA = 'b'.repeat(40);
function fixture(registryExtra) {
  const t = mkdtempSync(join(tmpdir(), 'b16-succ-'));
  for (const root of ['plugins', 'plugins.local']) {
    mkdirSync(join(t, root, 'gmail'), { recursive: true });
    writeFileSync(join(t, root, 'gmail', 'manifest.json'), JSON.stringify({
      id: 'gmail', apiVersion: 1, description: `${root} gmail`, hooks: ['ingest'],
      requiredEnv: [], allowedHosts: [], humanInTheLoop: true,
    }));
    writeFileSync(join(t, root, 'gmail', 'index.mjs'), 'export default { ingest: async () => [] };');
  }
  writeFileSync(join(t, 'plugins-registry.json'), JSON.stringify({
    registryVersion: 1,
    plugins: [{
      name: 'career-ops-plugin-gmail', id: 'gmail', repo: 'https://github.com/a/career-ops-plugin-gmail',
      author: 'a', hooks: ['ingest'], requiredEnv: [], allowedHosts: [], license: 'MIT',
      version: '2.0.0', sha: SHA, ...registryExtra,
    }],
  }));
  // Every case below is installed at the EXACT registry-pinned sha, so the flag
  // is the only variable.
  lockMod.writeLockEntry(t, 'gmail', { source: 'local', sha: SHA, version: '2.0.0', integrity: 'x', files: {}, consent: {} });
  return t;
}

const overrides = (extra) => {
  const t = fixture(extra);
  try {
    const ids = eng.resolveSuccessorIds(t);
    const dir = eng.discoverPlugins(eng.pluginRoots(t), ids).find((m) => m.id === 'gmail')?.dir || '';
    return { resolved: ids.has('gmail'), community: dir.includes('plugins.local') };
  } finally {
    rmSync(t, { recursive: true, force: true });
  }
};

const withFlag = overrides({ supersedesBundled: true });
if (withFlag.resolved && withFlag.community) pass('successor: supersedesBundled:true at the pinned sha DOES override the bundled plugin');
else fail('successor: an approved+pinned successor should override the bundled reference');

const noFlag = overrides({});
if (!noFlag.resolved && !noFlag.community) pass('successor: WITHOUT supersedesBundled, the same approved+pinned install does NOT override');
else fail('successor: supersedesBundled is not enforced — any registry-approved plugin at its pinned sha can take over a bundled id');

const falseFlag = overrides({ supersedesBundled: false });
if (!falseFlag.resolved && !falseFlag.community) pass('successor: supersedesBundled:false does NOT override');
else fail('successor: an explicit supersedesBundled:false was treated as permission to override');

// ── B16-D2: the audit reports one finding per distinct pattern ───
const adir = mkdtempSync(join(tmpdir(), 'b16-audit-'));
try {
  const cases = [
    ['child_process import', "import cp from 'node:child_process';\nexport default {};", /child_process/],
    ['bare-specifier dependency', "import lp from 'leftpad';\nexport default {};", /bare-specifier/],
    ['direct global fetch', "await fetch('https://x');\nexport default {};", /global fetch/],
  ];
  for (const [label, src, rx] of cases) {
    writeFileSync(join(adir, 'index.mjs'), src);
    const a = audit.auditPlugin(adir);
    const issues = (a.findings || []).map((f) => String(f.issue || ''));
    if (!a.ok && issues.some((i) => rx.test(i))) pass(`audit: ${label} is flagged on its own, with its own finding`);
    else fail(`audit: ${label} produced no matching finding (ok=${a.ok}, findings=${JSON.stringify(issues).slice(0, 160)})`);
  }
} finally {
  rmSync(adir, { recursive: true, force: true });
}

// ── source: §49 carries both controls ────────────────────────────
// Checks for the corrected shapes' presence, never the absence of the old ones
// (the constraint recorded in batches 11, 12, 14 and 15).
const src = readFileSync(join(ROOT, 'test-all.mjs'), 'utf-8');
if (/delete succRegistry\.plugins\[0\]\.supersedesBundled/.test(src)) {
  pass('§49 runs the no-supersedesBundled control on the successor hinge');
} else {
  fail('§49 no longer tests what grants the successor override — supersedesBundled could become decorative unnoticed (B16-D1)');
}
if (/missedPatterns/.test(src)) {
  pass('§49 asserts the audit findings by identity rather than by count');
} else {
  fail('§49 is counting audit findings again — three findings of one kind would satisfy it (B16-D2)');
}
