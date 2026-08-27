// tests/core-purity.test.mjs — validate-core-purity.mjs (W0: the domain-core guard)
//
// The guard is only worth having if it actually fires. These tests are written
// adversarially: each violation class gets a fixture that must be caught, and
// the same forbidden tokens appear inside comments and string literals to prove
// they do NOT trip it. A guard with false positives gets disabled by the first
// contributor it blocks unfairly, which is the same as not having one.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pass, fail } from './helpers.mjs';
import { auditModule, stripCommentsAndStrings, extractImports } from '../validate-core-purity.mjs';

console.log('\nvalidate-core-purity.mjs — domain core purity guard (W0)');

// Derived from this file's own location, never hardcoded: auditModule resolves
// the escapes-core check relative to the path it is given, so a literal path
// would report bogus violations on any checkout that is not this one — i.e. on
// every CI runner in the 3-OS matrix.
const CORE_FILE = fileURLToPath(new URL('../core/example.mjs', import.meta.url));
const RESULT_FILE = fileURLToPath(new URL('../core/shared/result.mjs', import.meta.url));
const kinds = (src) => auditModule(CORE_FILE, src).map((v) => v.kind);

try {
  // 1. Node builtin imports are rejected — this is the I/O escape hatch.
  if (kinds("import { readFileSync } from 'node:fs';").includes('builtin-import')) {
    pass('rejects a Node builtin import (node:fs)');
  } else {
    fail('did not reject node:fs');
  }

  // 2. Bare builtin specifiers too, not just the node: prefix.
  if (kinds("import { join } from 'path';").includes('builtin-import')) {
    pass('rejects a bare builtin specifier (path)');
  } else {
    fail('did not reject bare "path"');
  }

  // 3. Third-party packages are rejected — the core has no dependencies.
  if (kinds("import yaml from 'js-yaml';").includes('package-import')) {
    pass('rejects a third-party package import (js-yaml)');
  } else {
    fail('did not reject js-yaml');
  }

  // 4. A relative import climbing out of core/ would bypass 1-3.
  if (kinds("import { escapeLatex } from '../../lib/latex-escape.mjs';").includes('escapes-core')) {
    pass('rejects a relative import that escapes core/');
  } else {
    fail('did not reject an import escaping core/');
  }

  // 5. Relative imports that stay inside core/ are the supported case.
  if (auditModule(CORE_FILE, "import { ok } from './shared/result.mjs';").length === 0) {
    pass('allows a relative import that stays inside core/');
  } else {
    fail('wrongly rejected an in-core relative import');
  }

  // 6. Ambient non-determinism, each form separately.
  const nondeterminism = [
    ['const t = Date.now();', 'Date.now()'],
    ['const d = new Date();', 'new Date()'],
    ['const r = Math.random();', 'Math.random()'],
    ['const e = process.env.HOME;', 'process.env'],
    ['const id = crypto.randomUUID();', 'crypto.randomUUID()'],
    ['const res = await fetch(url);', 'fetch()'],
  ];
  let caught = 0;
  for (const [src, label] of nondeterminism) {
    if (kinds(src).includes('non-determinism')) caught++;
    else fail(`did not flag ${label}`);
  }
  if (caught === nondeterminism.length) {
    pass(`flags all ${caught} forms of ambient non-determinism`);
  }

  // 7. new Date(arg) is deterministic and must stay allowed, or every date
  //    parser in the core becomes impossible to write.
  if (auditModule(CORE_FILE, "const d = new Date(isoString);").length === 0) {
    pass('allows new Date(arg) — deterministic, unlike new Date()');
  } else {
    fail('wrongly rejected new Date(arg)');
  }

  // 8. No false positives from comments or string literals.
  const innocent = [
    '// never call Date.now() or Math.random() in here',
    "/* import { readFileSync } from 'node:fs'; */",
    "const doc = 'we forbid process.env and fetch( in core';",
    'const tpl = `Math.random() referenced in a template`;',
    "import { ok } from './shared/result.mjs';",
  ].join('\n');
  const fp = auditModule(CORE_FILE, innocent);
  if (fp.length === 0) {
    pass('no false positives from comments or string literals');
  } else {
    fail(`false positives: ${fp.map((v) => `${v.kind}:${v.detail}`).join(', ')}`);
  }

  // 9. The scrubber preserves line numbers, so reported lines are usable.
  const multiline = "const a = 1;\n/* comment\n   spanning\n   lines */\nconst b = 2;";
  if (stripCommentsAndStrings(multiline).split('\n').length === multiline.split('\n').length) {
    pass('scrubber preserves line count for accurate reporting');
  } else {
    fail('scrubber altered line count');
  }

  // 10. Quote delimiters survive scrubbing — without them the import regexes
  //     cannot anchor, which silently disabled every import check once already.
  if (extractImports(stripCommentsAndStrings("import x from 'js-yaml';"), "import x from 'js-yaml';")
        .some((i) => i.spec === 'js-yaml')) {
    pass('extractImports still resolves specifiers after scrubbing');
  } else {
    fail('extractImports lost the specifier — scrubber blanked the quotes');
  }

  // 11. Dynamic import and require are covered too.
  if (kinds("const fs = await import('node:fs');").includes('builtin-import')
      && kinds("const y = require('js-yaml');").includes('package-import')) {
    pass('covers dynamic import() and require()');
  } else {
    fail('missed dynamic import() or require()');
  }

  // 12. The real core/ tree is clean.
  if (auditModule(RESULT_FILE, readFileSync(RESULT_FILE, 'utf8')).length === 0) {
    pass('core/shared/result.mjs is clean under its own guard');
  } else {
    fail('core/shared/result.mjs violates the purity guard');
  }
} catch (e) {
  fail(`core-purity tests crashed: ${e.message}`);
}
