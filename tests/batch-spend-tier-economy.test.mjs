/**
 * batch-spend-tier-economy.test.mjs — split out of a too-slow-for-one-file batch cluster extracted
 * verbatim from test-all.mjs, kept to a single subprocess spawn so it
 * comfortably finishes under test-runner.mjs's per-file timeout under
 * --parallel contention (see tests/batch-url-rediscovery-misc.test.mjs
 * and tests/README.md).
 *
 * Economy spend_tier must resolve to claude-haiku-4-5.
 */

import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync, mkdirSync, copyFileSync } from 'fs';
import { join, delimiter } from 'path';
import { tmpdir } from 'os';
import { execFileSync } from 'child_process';
import { pass, fail, ROOT, run, getBash, toBashPath } from './helpers.mjs';

/**
 * Create a fully isolated tmp fixture for one spend_tier sub-test. Each
 * sub-test gets its own mkdtempSync so no batch-state.tsv from a prior
 * sub-test can bleed in, regardless of OS-level I/O ordering.
 *
 * @param {string} profileYml - config/profile.yml content for this fixture.
 * @returns {{tmp: string, batchDir: string, fakeBin: string}}
 */
function makeTierFixture(profileYml) {
  const tmp = mkdtempSync(join(tmpdir(), 'co-batch-tier-'));
  const batchDir = join(tmp, 'batch');
  const fakeBin = join(tmp, 'bin');
  const configDir = join(tmp, 'config');
  mkdirSync(batchDir, { recursive: true });
  mkdirSync(configDir, { recursive: true });
  mkdirSync(join(tmp, 'reports'), { recursive: true });
  mkdirSync(join(tmp, 'data'), { recursive: true });
  mkdirSync(fakeBin, { recursive: true });

  writeFileSync(join(batchDir, 'batch-runner.sh'), readFileSync(join(ROOT, 'batch/batch-runner.sh'), 'utf-8').replace(/\r\n/g, '\n'));
  if (process.platform === 'win32') {
    try { execFileSync(getBash(), ['-c', 'chmod +x batch/batch-runner.sh'], { cwd: tmp }); } catch {}
  } else {
    execFileSync('chmod', ['+x', join(batchDir, 'batch-runner.sh')]);
  }
  writeFileSync(join(tmp, 'merge-tracker.mjs'), 'console.log("merge fixture");\n');
  writeFileSync(join(tmp, 'verify-pipeline.mjs'), 'console.log("verify fixture");\n');
  // batch-runner.sh resolves spend_tier -> model by shelling out to the single
  // source of truth rather than restating the table in bash, so the fixture
  // needs the real module (a stub would defeat the point of the assertions).
  mkdirSync(join(tmp, 'lib'), { recursive: true });
  copyFileSync(join(ROOT, 'lib/llm-providers.mjs'), join(tmp, 'lib', 'llm-providers.mjs'));
  writeFileSync(join(batchDir, 'batch-prompt.md'), 'URL={{URL}}\nJD={{JD_FILE}}\nREPORT={{REPORT_NUM}}\n');
  writeFileSync(join(batchDir, 'batch-input.tsv'), [
    'id\turl\tsource\tnotes',
    '1\thttps://example.com/one\tfixture\t-',
  ].join('\n') + '\n');
  writeFileSync(join(configDir, 'profile.yml'), profileYml);
  writeFileSync(join(fakeBin, 'claude'), [
    '#!/usr/bin/env bash',
    'printf "%s\\n" "$@" > "$BATCH_ARG_FILE"',
    'exit 0',
  ].join('\n') + '\n');
  if (process.platform === 'win32') {
    try { execFileSync(getBash(), ['-c', 'chmod +x bin/claude'], { cwd: tmp }); } catch {}
  } else {
    execFileSync('chmod', ['+x', join(fakeBin, 'claude')]);
  }
  return { tmp, batchDir, fakeBin };
}

console.log('\n14. Batch spend_tier model routing (economy)');

try {
  const { tmp, batchDir, fakeBin } = makeTierFixture('spend_tier: economy\n');
  const argFile = join(tmp, 'claude-argv.txt');
  const env = { ...process.env, PATH: `${fakeBin}${delimiter}${process.env.PATH}`, BATCH_ARG_FILE: argFile };
  const out = run(getBash(), [toBashPath(join(batchDir, 'batch-runner.sh')), '--parallel', '1'], { cwd: tmp, env, stdio: ['pipe', 'pipe', 'pipe'] }) || '';
  const argv = existsSync(argFile) ? readFileSync(argFile, 'utf-8') : '';
  if (argv.includes('--model') && argv.includes('claude-haiku-4-5') && out.includes('spend_tier=economy')) {
    pass('economy spend_tier resolves to claude-haiku-4-5');
  } else {
    fail(`economy spend_tier did not route to haiku: argv=${JSON.stringify(argv)}, out=${JSON.stringify(out.slice(-240))}`);
  }
  try { rmSync(tmp, { recursive: true, force: true }); } catch {}
} catch (e) { fail(`Batch spend_tier routing test crashed (economy): ${e.message}`); }
