/**
 * batch-url-rediscovery-misc.test.mjs — scan.mjs's URL rediscovery
 * fallback (careers-domain extraction, DuckDuckGo redirect unwrapping,
 * look-alike-hostname rejection), batch-runner.sh's --strict-mcp-config
 * MCP isolation (#506), and update-system.mjs's SEMVER_RE parsing (#923).
 *
 * Split out of the (too-slow-for-one-file, #506 subprocess-heavy) batch
 * cluster extracted verbatim from test-all.mjs — the subprocess-spawning
 * parts live in tests/batch-rate-limit-pause.test.mjs and
 * tests/batch-spend-tier-routing.test.mjs instead, so no single
 * discovered file exceeds test-runner.mjs's per-file timeout under
 * --parallel contention (see tests/README.md — discovered files are
 * auto-run by both test-all.mjs and test-runner.mjs).
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\n15. URL rediscovery fallback');

try {
  const { extractCareersUrlDomain, pickRediscoveredUrl } = await import(
    pathToFileURL(join(ROOT, 'scan.mjs')).href
  );

  // extractCareersUrlDomain — pure hostname extraction, null on missing/invalid
  if (extractCareersUrlDomain('https://job-boards.greenhouse.io/anthropic') === 'job-boards.greenhouse.io') {
    pass('extractCareersUrlDomain pulls hostname from a careers URL');
  } else {
    fail('extractCareersUrlDomain failed on a valid URL');
  }
  if (extractCareersUrlDomain(null) === null) {
    pass('extractCareersUrlDomain returns null for missing careers_url');
  } else {
    fail('extractCareersUrlDomain did not return null for null input');
  }
  if (extractCareersUrlDomain('not-a-url') === null) {
    pass('extractCareersUrlDomain returns null for an unparseable URL');
  } else {
    fail('extractCareersUrlDomain did not return null for a bad URL');
  }

  // pickRediscoveredUrl — first search hit whose hostname exactly matches domain
  const domain = 'job-boards.greenhouse.io';
  const hrefs = [
    'https://duckduckgo.com/l/?uddg=ad',          // search-engine chrome / noise
    'https://other-board.lever.co/acme/123',      // wrong domain
    'https://job-boards.greenhouse.io/acme/456',  // first real match
    'https://job-boards.greenhouse.io/acme/789',  // later match
  ];
  if (pickRediscoveredUrl(hrefs, domain) === 'https://job-boards.greenhouse.io/acme/456') {
    pass('pickRediscoveredUrl returns the first same-domain result');
  } else {
    fail(`pickRediscoveredUrl picked the wrong URL: ${pickRediscoveredUrl(hrefs, domain)}`);
  }
  if (pickRediscoveredUrl(['https://elsewhere.com/x'], domain) === null) {
    pass('pickRediscoveredUrl returns null when no result matches the domain');
  } else {
    fail('pickRediscoveredUrl did not return null for no domain match');
  }
  if (pickRediscoveredUrl([], domain) === null) {
    pass('pickRediscoveredUrl returns null for an empty result set');
  } else {
    fail('pickRediscoveredUrl did not return null for empty input');
  }
  // Redirect unwrapping is restricted to real DuckDuckGo hosts: a look-alike
  // host must not get its uddg target unwrapped (and its own hostname does not
  // match the careers domain, so the result is null).
  const lookAlike = `https://evil-duckduckgo.com/l/?uddg=${encodeURIComponent('https://job-boards.greenhouse.io/acme/456')}`;
  if (pickRediscoveredUrl([lookAlike], domain) === null) {
    pass('pickRediscoveredUrl ignores uddg redirects from look-alike hosts');
  } else {
    fail('pickRediscoveredUrl unwrapped a redirect from a look-alike host');
  }
  // DuckDuckGo HTML wraps each result in a /l/?uddg= redirect — must be
  // unwrapped, otherwise every hostname looks like duckduckgo.com and nothing
  // ever matches the careers domain (the fallback would silently never fire).
  const ddg = ['//duckduckgo.com/l/?uddg=' + encodeURIComponent('https://job-boards.greenhouse.io/acme/999')];
  if (pickRediscoveredUrl(ddg, domain) === 'https://job-boards.greenhouse.io/acme/999') {
    pass('pickRediscoveredUrl unwraps DuckDuckGo redirect links');
  } else {
    fail(`pickRediscoveredUrl did not unwrap DDG redirect: ${pickRediscoveredUrl(ddg, domain)}`);
  }
  // A look-alike host that merely contains the domain as a substring must not match.
  if (pickRediscoveredUrl(['https://job-boards.greenhouse.io.attacker.com/x'], domain) === null) {
    pass('pickRediscoveredUrl rejects look-alike hostnames');
  } else {
    fail('pickRediscoveredUrl accepted a look-alike hostname');
  }
} catch (e) {
  fail(`URL rediscovery tests crashed: ${e.message}`);
}

console.log('\n15. Batch runner MCP isolation');

try {
  const batchRunner = readFileSync(join(ROOT, 'batch', 'batch-runner.sh'), 'utf-8');
  // Workers must be spawned with --strict-mcp-config so they don't inherit the
  // parent session's MCP servers (e.g. Playwright) and deadlock fighting over a
  // single browser when --parallel > 1 (issue #506).
  const claudeArgsLine = batchRunner
    .split('\n')
    .find(l => l.includes('claude_args=('));
  if (claudeArgsLine && claudeArgsLine.includes('--strict-mcp-config')) {
    pass('batch workers spawn with --strict-mcp-config (no inherited MCP)');
  } else {
    fail('batch-runner.sh worker spawn missing --strict-mcp-config (issue #506 regression)');
  }
} catch (e) {
  fail(`Batch runner MCP isolation test crashed: ${e.message}`);
}

console.log('\n16. update-system SEMVER_RE');

try {
  // Importing must not trigger the CLI (the import.meta.url guard); it
  // exposes SEMVER_RE, which the releases-API fallback uses on release.tag_name.
  const { SEMVER_RE } = await import(pathToFileURL(join(ROOT, 'update-system.mjs')).href);
  const parse = (tag) => String(tag).trim().match(SEMVER_RE)?.[1] ?? null;

  // Release Please tags carry the component prefix (jobber-v1.9.0); the
  // prefix must be stripped or the releases-API fallback is dead code (#923).
  if (parse('jobber-v1.9.0') === '1.9.0') {
    pass('SEMVER_RE parses Release Please component-prefixed tag (jobber-v1.9.0 → 1.9.0)');
  } else {
    fail(`SEMVER_RE failed on jobber-v1.9.0 (got ${parse('jobber-v1.9.0')}) — releases-API fallback is dead code (#923)`);
  }

  // No regression on plain tags.
  if (parse('v1.9.0') === '1.9.0' && parse('1.9.0') === '1.9.0') {
    pass('SEMVER_RE still parses plain v-prefixed and bare semver tags');
  } else {
    fail(`SEMVER_RE regressed on plain tags (v1.9.0 → ${parse('v1.9.0')}, 1.9.0 → ${parse('1.9.0')})`);
  }

  // Non-semver input must not match.
  if (parse('jobber') === null && parse('v1.9') === null) {
    pass('SEMVER_RE rejects non-semver input');
  } else {
    fail(`SEMVER_RE matched non-semver input (Jobber → ${parse('jobber')}, v1.9 → ${parse('v1.9')})`);
  }
} catch (e) {
  fail(`update-system SEMVER_RE test crashed: ${e.message}`);
}
