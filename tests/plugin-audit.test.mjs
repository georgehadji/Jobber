// tests/plugin-audit.test.mjs — plugin-audit.mjs's manifest check (Phase 8,
// docs/AI-JOB-SEARCH-PORT-PLAN.md): a community plugin's package.json may not
// ship an npm/bun lifecycle script or trustedDependencies. No test existed
// for plugin-audit.mjs before this addition; scoped here to the new check.
import { mkdtempSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { pass, fail } from './helpers.mjs';
import { auditPlugin } from '../plugin-audit.mjs';

console.log('\nplugin-audit.mjs — package.json lifecycle-script guard');

function pluginDir(pkg) {
  const dir = mkdtempSync(join(tmpdir(), 'plugin-audit-test-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg), 'utf-8');
  // Deliberately no "fetch" identifier — auditPlugin's global-fetch() heuristic
  // can't distinguish a method definition from a call, so this stub avoids
  // that unrelated pre-existing ambiguity and stays focused on the manifest
  // check this test file actually covers.
  writeFileSync(join(dir, 'index.mjs'), 'export default { id: "x" };\n', 'utf-8');
  return dir;
}

try {
  // 1. A clean manifest passes.
  const clean = auditPlugin(pluginDir({ name: 'career-ops-plugin-clean', version: '1.0.0' }));
  if (clean.ok && clean.findings.length === 0) {
    pass('a package.json with no lifecycle scripts audits clean');
  } else {
    fail(`clean manifest wrongly flagged: ${JSON.stringify(clean)}`);
  }

  // 2. Every lifecycle script name is caught individually.
  for (const name of ['preinstall', 'install', 'postinstall', 'prepare', 'prepack']) {
    const result = auditPlugin(pluginDir({ name: 'x', scripts: { [name]: 'echo hi' } }));
    if (!result.ok && result.findings.some((f) => f.issue.includes(`"${name}"`))) {
      pass(`auditPlugin flags a "${name}" lifecycle script`);
    } else {
      fail(`auditPlugin missed a "${name}" lifecycle script: ${JSON.stringify(result)}`);
    }
  }

  // 3. trustedDependencies is flagged.
  const trusted = auditPlugin(pluginDir({ name: 'x', trustedDependencies: ['some-native-pkg'] }));
  if (!trusted.ok && trusted.findings.some((f) => f.issue.includes('trustedDependencies'))) {
    pass('auditPlugin flags trustedDependencies');
  } else {
    fail(`auditPlugin missed trustedDependencies: ${JSON.stringify(trusted)}`);
  }

  // 4. An empty-string script value is not a script (some manifests carry a
  //    placeholder "" as a no-op) — must not false-positive on that.
  const emptyScript = auditPlugin(pluginDir({ name: 'x', scripts: { postinstall: '' } }));
  if (emptyScript.ok) {
    pass('an empty-string lifecycle script value is not flagged (no-op placeholder)');
  } else {
    fail(`an empty-string script value was wrongly flagged: ${JSON.stringify(emptyScript)}`);
  }

  // 5. A malformed package.json is reported, not thrown.
  const badJsonDir = mkdtempSync(join(tmpdir(), 'plugin-audit-test-'));
  writeFileSync(join(badJsonDir, 'package.json'), '{not valid json', 'utf-8');
  const badJson = auditPlugin(badJsonDir);
  if (!badJson.ok && badJson.findings.some((f) => /not valid JSON/.test(f.issue))) {
    pass('a malformed package.json is reported as a finding, not thrown');
  } else {
    fail(`malformed package.json was not handled gracefully: ${JSON.stringify(badJson)}`);
  }

  // 6. A package.json nested under a subdirectory (e.g. cli/package.json,
  //    the shape ai-job-search's portal skills use) is still audited.
  const nestedDir = mkdtempSync(join(tmpdir(), 'plugin-audit-test-'));
  mkdirSync(join(nestedDir, 'cli'), { recursive: true });
  writeFileSync(join(nestedDir, 'cli', 'package.json'), JSON.stringify({ name: 'x', scripts: { postinstall: 'evil' } }), 'utf-8');
  const nested = auditPlugin(nestedDir);
  if (!nested.ok && nested.findings.some((f) => f.file === 'cli/package.json')) {
    pass('a package.json nested under a subdirectory is still audited');
  } else {
    fail(`nested package.json was not audited: ${JSON.stringify(nested)}`);
  }
} catch (e) {
  fail(`plugin-audit tests crashed: ${e.message}`);
}
