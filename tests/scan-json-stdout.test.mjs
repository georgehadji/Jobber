// tests/scan-json-stdout.test.mjs — scan.mjs must keep stdout clean so that
// --json output stays machine-parseable (issue #1906).
//
// The original offender was dotenv: scan.mjs loaded it at module top level and
// dotenv v17 printed a startup banner to stdout, gated on its `quiet` option
// rather than on isTTY, so it fired even into a pipe. scan.mjs now uses
// process.loadEnvFile(), which prints nothing, so that specific banner is gone.
// The guard stays because the hazard is structural: scan-ats-full.mjs imports
// scan.mjs, so the import alone can put output on the channel --json reserves
// for a single JSON object, and consumers that accumulate stdout and
// JSON.parse it fail on anything that leads.
//
// Both checks run scan.mjs in a child process: stdout has to be measured on a
// real pipe, and the parent's own stdout carries the suite log.
import { pass, fail, run, NODE, ROOT } from './helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nscan.mjs — --json stdout stays machine-parseable (#1906)');

try {
  const scanUrl = JSON.stringify(pathToFileURL(join(ROOT, 'scan.mjs')).href);

  // This used to be gated on dotenv being installed, because dotenv's banner
  // was the known way to dirty stdout and without it the checks proved nothing.
  // dotenv is gone, and the gate had to go with it: left in place it would have
  // been permanently false, turning both checks into a silent skip. The property
  // is broader than one dependency anyway — any module-level write to stdout
  // breaks a --json consumer, so the checks now always run.
  {
    // Importing scan.mjs must be silent on stdout. scan.mjs guards its CLI
    // entry point, so the import runs module top level only.
    const importOut = run(NODE, ['-e', `await import(${scanUrl})`]);
    if (importOut === '') {
      pass('importing scan.mjs writes nothing to stdout');
    } else if (importOut === null) {
      fail('importing scan.mjs failed');
    } else {
      fail(`importing scan.mjs wrote to stdout: ${JSON.stringify(importOut.slice(0, 80))}`);
    }

    // The contract a --json consumer depends on: accumulate the child's stdout,
    // JSON.parse it, get the object back. Emitting the JSON after the import
    // reproduces the ordering that scan-ats-full.mjs --json produces.
    const jsonOut = run(NODE, [
      '-e',
      `await import(${scanUrl}); process.stdout.write(JSON.stringify({ date: '2026-01-01', offers: [] }));`,
    ]);
    if (jsonOut === null) {
      fail('child emitting JSON after importing scan.mjs failed');
    } else {
      try {
        const parsed = JSON.parse(jsonOut);
        if (parsed.date === '2026-01-01' && Array.isArray(parsed.offers)) {
          pass('stdout of a --json run parses as a single JSON object');
        } else {
          fail(`parsed stdout is not the emitted object: ${JSON.stringify(parsed).slice(0, 80)}`);
        }
      } catch (e) {
        fail(`stdout of a --json run does not parse as JSON: ${e.message}`);
      }
    }
  }
} catch (e) {
  fail(`scan --json stdout tests crashed: ${e.message}`);
}
