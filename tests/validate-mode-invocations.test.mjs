// tests/validate-mode-invocations.test.mjs — regression coverage for
// validate-mode-invocations.mjs.
//
// The validator is import-safe (main guard), so these tests exercise the
// exported validateInvocations() directly with synthetic invocation lists.
// No network, no real modes/ scan — deterministic.
import { pass, fail } from './helpers.mjs';
import { validateInvocations, collectInvocations, INVOCATION_RE, FLAG_RE } from '../validate-mode-invocations.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

console.log('\nvalidate-mode-invocations.mjs — tiers');

try {
  // Tier 1: missing script → ERROR (hard).
  {
    const { errors, warnings, infos } = validateInvocations([
      { file: 'modes/test.md', script: 'definitely-missing-xyz.mjs', flags: [] },
    ]);
    if (errors.length === 1 && warnings.length === 0 && infos.length === 0
        && errors[0].script === 'definitely-missing-xyz.mjs') {
      pass('missing script → ERROR (hard fail in --ci)');
    } else {
      fail(`missing script should be a single error, got ${JSON.stringify({ errors, warnings, infos })}`);
    }
  }

  // Existing scripts never error.
  {
    const { errors } = validateInvocations([
      { file: 'modes/test.md', script: 'stats.mjs', flags: [] },
      { file: 'modes/test.md', script: 'merge-tracker.mjs', flags: [] },
    ]);
    if (errors.length === 0) {
      pass('existing scripts → no errors');
    } else {
      fail(`existing scripts produced errors: ${JSON.stringify(errors)}`);
    }
  }

  // Tier 2: flag not in --help output → WARNING (only for scripts with --help).
  {
    const { warnings } = validateInvocations([
      { file: 'modes/test.md', script: 'browser-extract.mjs', flags: ['--mode', '--bogus-flag'] },
    ]);
    const bogus = warnings.find(w => w.flags?.includes('--bogus-flag'));
    if (bogus) {
      pass(`undocumented flag on --help-capable script → WARNING (${bogus.message.slice(0, 60)}…)`);
    } else {
      fail(`expected a WARNING for --bogus-flag on browser-extract.mjs, got ${JSON.stringify(warnings)}`);
    }
  }

  // T4: --capabilities contract is preferred over --help parsing.
  // merge-tracker.mjs implements --capabilities (JSON flags) — its flags
  // must come from the contract, not help-text heuristics.
  {
    const { warnings, errors } = validateInvocations([
      { file: 'modes/test.md', script: 'merge-tracker.mjs', flags: ['--dry-run', '--strict'] },
    ]);
    // Both --dry-run and --strict are in merge-tracker's capabilities list,
    // so a clean result proves the capabilities path was used (the --help
    // heuristic would also accept them, but the contract is authoritative).
    if (errors.length === 0 && warnings.length === 0) {
      pass('--capabilities contract supplies documented flags (merge-tracker)');
    } else {
      fail(`capabilities path wrong: ${JSON.stringify({ errors, warnings })}`);
    }
  }

  // T4: a flag NOT in the capabilities contract is still a WARNING.
  {
    const { warnings } = validateInvocations([
      { file: 'modes/test.md', script: 'merge-tracker.mjs', flags: ['--not-a-real-flag'] },
    ]);
    if (warnings.length === 1 && warnings[0].flags?.includes('--not-a-real-flag')) {
      pass('flag outside the capabilities contract → WARNING');
    } else {
      fail(`capabilities flag validation wrong: ${JSON.stringify(warnings)}`);
    }
  }

  // Documented flags on a --help-capable script → no warning.
  {
    const { warnings } = validateInvocations([
      { file: 'modes/test.md', script: 'browser-extract.mjs', flags: ['--mode', '--max-chars'] },
    ]);
    if (warnings.length === 0) {
      pass('documented flags on --help-capable script → no warning');
    } else {
      fail(`documented flags produced warnings: ${JSON.stringify(warnings)}`);
    }
  }

  // Tier 3: script without --help → INFO, not error/warning.
  {
    const { errors, warnings, infos } = validateInvocations([
      { file: 'modes/test.md', script: 'stats.mjs', flags: ['--summary'] },
    ]);
    if (errors.length === 0 && warnings.length === 0 && infos.length === 1) {
      pass('script without --help → INFO (existence checked, flags not)');
    } else {
      fail(`no-help script expected 1 INFO, got ${JSON.stringify({ errors, warnings, infos })}`);
    }
  }

  // No flags → nothing beyond existence check (no noise).
  {
    const { errors, warnings, infos } = validateInvocations([
      { file: 'modes/test.md', script: 'browser-extract.mjs', flags: [] },
    ]);
    if (errors.length === 0 && warnings.length === 0 && infos.length === 0) {
      pass('invocation without flags → no findings (existence only)');
    } else {
      fail(`flagless invocation should be clean, got ${JSON.stringify({ errors, warnings, infos })}`);
    }
  }

  // SE-01: path traversal — a crafted script name escaping the repo root must
  // be an ERROR, not silently accepted.
  {
    const { errors } = validateInvocations([
      { file: 'modes/test.md', script: '../../evil.mjs', flags: [] },
    ]);
    if (errors.length === 1 && /escapes the repo root/.test(errors[0].message)) {
      pass('path-traversal script name (../../evil.mjs) → ERROR');
    } else {
      fail(`path-traversal guard failed: ${JSON.stringify(errors)}`);
    }
  }

  // SE-01: a valid flat script name inside the repo still passes.
  {
    const { errors } = validateInvocations([
      { file: 'modes/test.md', script: 'stats.mjs', flags: [] },
    ]);
    if (errors.length === 0) {
      pass('flat in-repo script name → no error (guard is not over-eager)');
    } else {
      fail(`in-repo script wrongly rejected: ${JSON.stringify(errors)}`);
    }
  }

  // M-01: collectInvocations() extracts real invocations from a temp modes dir.
  {
    const dir = mkdtempSync(join(tmpdir(), 'vmi-collect-'));
    try {
      mkdirSync(join(dir, 'de'), { recursive: true });
      writeFileSync(join(dir, 'test.md'),
        'Run: `node real-script.mjs --mode jd --max 3`\nAnd: `node other.mjs`\n');
      writeFileSync(join(dir, 'de', 'test.md'),
        'Run: `node real-script.mjs --mode jd`\n');
      const found = collectInvocations(dir);
      const scripts = found.map(i => i.script);
      // The root test.md carries --mode AND --max; the de/ copy only --mode.
      // Assert on the union so directory ordering can't flake the test.
      const rootInv = found.find(i => i.script === 'real-script.mjs' && !i.file.includes('/de/'));
      const allFlags = found.flatMap(i => i.flags);
      if (scripts.includes('real-script.mjs') && scripts.includes('other.mjs')
          && scripts.length === 3
          && rootInv?.flags.includes('--mode') && rootInv?.flags.includes('--max')
          && allFlags.includes('--max') && !allFlags.includes('--max-chars')) {
        pass(`collectInvocations extracts real invocations + flags (${found.length} found)`);
      } else {
        fail(`collectInvocations extraction wrong: ${JSON.stringify(found)}`);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  // M-01: placeholders ({###}, <url>) are NOT extracted as flags.
  {
    const line = 'node reserve-report-num.mjs --count {###} and <url> and $VAR';
    const flags = [...line.matchAll(FLAG_RE)].map(m => m[0]);
    if (flags.includes('--count') && !flags.some(f => /[<{$]/.test(f))) {
      pass('placeholder tokens ({###}, <url>, $VAR) not captured as flags');
    } else {
      fail(`placeholder filtering wrong: ${JSON.stringify(flags)}`);
    }
  }

  // M-01: INVOCATION_RE does not match `npm run` (different resolution path).
  {
    const m = [...'npm run scan.mjs'.matchAll(INVOCATION_RE)];
    if (m.length === 0) {
      pass('INVOCATION_RE ignores npm run invocations');
    } else {
      fail(`INVOCATION_RE wrongly matched npm run: ${JSON.stringify(m)}`);
    }
  }
} catch (e) {
  fail(`validate-mode-invocations tests crashed: ${e.message}`);
}
