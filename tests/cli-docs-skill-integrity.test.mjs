/**
 * cli-docs-skill-integrity.test.mjs — AGENTS.md required sections, the
 * CLAUDE.md/CODEX.md/OPENCODE.md thin-wrapper contract, GEMINI.md's
 * no-op Antigravity guard, Codex documentation coverage across
 * README/docs/SETUP.md/AGENTS.md, the per-CLI skill-entrypoint symlink
 * chain (canonical .agents/skills/jobber/SKILL.md → per-CLI pointers),
 * skill entrypoint materialization for symlink-unsupported filesystems
 * (#1051) including the git index-mode staging path, and the VERSION
 * file's semver contract.
 *
 * Extracted verbatim from test-all.mjs (see tests/README.md — discovered
 * files are auto-run by both test-all.mjs and test-runner.mjs).
 */

import { readFileSync, writeFileSync, mkdtempSync, rmSync, mkdirSync, realpathSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { execFileSync, execSync } from 'child_process';
import { pathToFileURL } from 'url';
import { pass, fail, fileExists, ROOT } from './helpers.mjs';

/**
 * Read a repo-relative text file as UTF-8. Copied verbatim from test-all.mjs
 * (kept local rather than shared, since it's specific to the #1440
 * migration's single-line-symlink-redirect convention for skill entrypoints).
 *
 * @param {string} path - Path relative to the Jobber repository root.
 * @returns {string} File contents.
 */
function readFile(path) {
  const fullPath = join(ROOT, path);
  let content = readFileSync(fullPath, 'utf-8');
  if (content.trim().startsWith('..') && content.trim().split('\n').length === 1) {
    const target = join(dirname(fullPath), content.trim());
    if (existsSync(target)) {
      content = readFileSync(target, 'utf-8');
    }
  }
  return content;
}

// ── 11. AGENTS.md INTEGRITY ─────────────────────────────────────

console.log('\n11. AGENTS.md integrity');

const agents = readFile('AGENTS.md');
const requiredSections = [
  'Data Contract', 'Update Check', 'Ethical Use',
  'Offer Verification', 'Canonical States', 'TSV Format',
  'First Run', 'Onboarding',
];

for (const section of requiredSections) {
  if (agents.includes(section)) {
    pass(`AGENTS.md has section: ${section}`);
  } else {
    fail(`AGENTS.md missing section: ${section}`);
  }
}

// ── 11. CLI WRAPPER FILE INTEGRITY ──────────────────────────

console.log('\n11. CLI wrapper file integrity');

const cliWrappers = ['CLAUDE.md', 'CODEX.md', 'OPENCODE.md'];
for (const f of cliWrappers) {
  if (!fileExists(f)) {
    fail(`Missing CLI wrapper: ${f}`);
    continue;
  }
  const content = readFile(f);
  if (content.includes('AGENTS.md')) {
    pass(`${f} references AGENTS.md`);
  } else {
    fail(`${f} does NOT reference AGENTS.md`);
  }
}
if (!fileExists('GEMINI.md')) {
  fail('Missing legacy Gemini context guard: GEMINI.md');
} else {
  const geminiContext = readFile('GEMINI.md');
  if (/^@(?:\.\/)?AGENTS\.md/m.test(geminiContext)) {
    fail('GEMINI.md imports AGENTS.md and duplicates Antigravity context');
  } else {
    pass('GEMINI.md is a no-op context guard for Antigravity');
  }
}

const codexWrapper = fileExists('CODEX.md') ? readFile('CODEX.md') : '';
if (/^@(?:\.\/)?AGENTS\.md/m.test(codexWrapper)) {
  pass('CODEX.md imports AGENTS.md as a thin wrapper');
} else {
  fail('CODEX.md is not a thin AGENTS.md wrapper');
}

const codexGuideDoc = fileExists('docs/CODEX.md') ? readFile('docs/CODEX.md') : '';
if (
  /AGENTS\.md/.test(codexGuideDoc) &&
  /CODEX\.md/.test(codexGuideDoc) &&
  /codex exec/.test(codexGuideDoc) &&
  /Codex/i.test(codexGuideDoc)
) {
  pass('docs/CODEX.md is a complete Codex guide');
} else {
  fail('docs/CODEX.md is missing required content');
}

const claudeWrapperLines = readFile('CLAUDE.md').trim().split(/\r?\n/);
const claudeWrapperBody = claudeWrapperLines.slice(1).filter(line => line.trim());
if (
  claudeWrapperLines[0] === '@AGENTS.md' &&
  claudeWrapperBody.length <= 1 &&
  claudeWrapperBody.every(line => { const t = line.trim(); return t.startsWith('<!--') && t.endsWith('-->'); })
) {
  pass('CLAUDE.md is a thin AGENTS.md wrapper (#1088)');
} else {
  fail('CLAUDE.md must contain only @AGENTS.md plus an optional Claude-only placeholder comment (#1088)');
}

const criticalRoutingContracts = [
  ['paste-a-JD auto-pipeline', /Pastes JD or URL\s*\|\s*auto-pipeline/],
  ['PDF mode', /generate CV\/PDF\s*\|\s*`pdf`/i],
  ['language modes_dir override', /language\.modes_dir:\s*modes\/(?:\{lang\}|de)/],
  ['doctor --json onboarding', /node doctor\.mjs --json/],
];
for (const [name, marker] of criticalRoutingContracts) {
  if (marker.test(agents)) pass(`AGENTS.md preserves ${name} routing for Claude`);
  else fail(`AGENTS.md is missing ${name} routing required by the Claude wrapper`);
}
const claudeSkillEntrypoint = readFile('.claude/skills/jobber/SKILL.md');
if (/\.agents\/skills\/jobber\/SKILL\.md/.test(claudeSkillEntrypoint) || claudeSkillEntrypoint === readFile('.agents/skills/jobber/SKILL.md')) {
  pass('Claude skill invocation resolves to the canonical Jobber router');
} else {
  fail('Claude skill invocation does not resolve to the canonical Jobber router');
}

// ── 12. SKILL SYMLINK INTEGRITY ─────────────────────────────

console.log('\n12. Skill symlink integrity');

const canonicalSkill = '.agents/skills/jobber/SKILL.md';
const symlinks = [
  '.claude/skills/jobber/SKILL.md',
  '.cursor/skills/jobber/SKILL.md',
  '.opencode/skills/jobber/SKILL.md',
  '.qwen/skills/jobber/SKILL.md',
  '.antigravitycli/skills/jobber/SKILL.md',
  '.grok/skills/jobber/SKILL.md',
];

let canonicalReal = null;
let canonicalContent = null;
try {
  canonicalReal = realpathSync(join(ROOT, canonicalSkill));
  canonicalContent = readFile(canonicalSkill);
  pass(`Canonical skill resolves: ${canonicalSkill}`);
} catch {
  fail(`Canonical skill not found: ${canonicalSkill}`);
}

for (const link of symlinks) {
  let resolved = null;
  try {
    resolved = realpathSync(join(ROOT, link));
    if (resolved !== canonicalReal) {
      const content = readFileSync(resolved, 'utf-8').trim();
      if (content.startsWith('..') && content.split('\n').length === 1) {
        resolved = realpathSync(join(dirname(join(ROOT, link)), content));
      }
    }
  } catch {
    resolved = null;
  }
  if (resolved === null) {
    fail(`Symlink missing: ${link}`);
    continue;
  }
  if (resolved === canonicalReal) {
    pass(`${link} → canonical skill`);
  } else if (canonicalContent !== null && readFile(link) === canonicalContent) {
    pass(`${link} is a materialized copy of canonical skill`);
  } else {
    fail(`${link} resolves to ${resolved}, expected ${canonicalReal} or byte-identical canonical skill copy`);
  }
}

if (
  /Codex/i.test(canonicalContent ?? '') &&
  /`codex`/.test(canonicalContent ?? '') &&
  /`codex exec/.test(canonicalContent ?? '') &&
  /prompt/i.test(canonicalContent ?? '') &&
  /\/jobber/.test(canonicalContent ?? '')
) {
  pass('Jobber skill router documents the Codex invocation model');
} else {
  fail('Jobber skill router is missing Codex invocation guidance');
}

console.log('\n12c. Codex documentation guidance');

const readmeDoc = readFile('README.md');
if (
  /CODEX\.md/.test(readmeDoc) &&
  /codex exec/.test(readmeDoc) &&
  /Codex/i.test(readmeDoc) &&
  /(slash commands?.*not guaranteed|plain language|prompt)/i.test(readmeDoc)
) {
  pass('README documents CODEX.md and Codex interactive/headless usage');
} else {
  fail('README is missing required Codex usage guidance');
}

const setupDoc = readFile('docs/SETUP.md');
if (
  /codex exec/.test(setupDoc) &&
  /Codex/i.test(setupDoc) &&
  /(slash commands?.*not guaranteed|plain language|prompt)/i.test(setupDoc)
) {
  pass('docs/SETUP.md explains the Codex invocation model');
} else {
  fail('docs/SETUP.md is missing Codex invocation guidance');
}

const agentsDoc = readFile('AGENTS.md');
if (
  /CODEX\.md/.test(agentsDoc) &&
  /codex exec/.test(agentsDoc) &&
  /Codex/i.test(agentsDoc) &&
  /(slash commands?.*not guaranteed|prompt|\/jobber.*unavailable)/i.test(agentsDoc)
) {
  pass('AGENTS.md includes CODEX.md and Codex-specific command guidance');
} else {
  fail('AGENTS.md is missing CODEX.md or Codex command guidance');
}

console.log('\n12a. Skill entrypoint materialization');

{
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'jobber-skills-'));
  try {
    const canonicalDir = join(fixtureRoot, '.agents', 'skills', 'jobber');
    const claudeDir = join(fixtureRoot, '.claude', 'skills', 'jobber');
    const opencodeDir = join(fixtureRoot, '.opencode', 'skills', 'jobber');
    mkdirSync(canonicalDir, { recursive: true });
    mkdirSync(claudeDir, { recursive: true });
    mkdirSync(opencodeDir, { recursive: true });

    const fixtureSkill = '---\nname: jobber\n---\n\n# canonical skill\n';
    const pointer = '../../../.agents/skills/jobber/SKILL.md';
    writeFileSync(join(canonicalDir, 'SKILL.md'), fixtureSkill);
    writeFileSync(join(claudeDir, 'SKILL.md'), pointer);
    writeFileSync(join(opencodeDir, 'SKILL.md'), pointer);

    const skills = await import(pathToFileURL(join(ROOT, 'scaffolder/bin/skill-entrypoints.mjs')).href);
    const materialized = skills.materializeSkillEntrypoints(fixtureRoot).sort();
    const expected = [
      '.claude/skills/jobber/SKILL.md',
      '.opencode/skills/jobber/SKILL.md',
    ];

    if (JSON.stringify(materialized) === JSON.stringify(expected)) {
      pass('update-system materializes pointer skill entrypoints');
    } else {
      fail(`unexpected materialized skill entrypoints: ${JSON.stringify(materialized)}`);
    }

    const claudeSkill = readFileSync(join(claudeDir, 'SKILL.md'), 'utf-8');
    const opencodeSkill = readFileSync(join(opencodeDir, 'SKILL.md'), 'utf-8');
    if (claudeSkill === fixtureSkill && opencodeSkill === fixtureSkill) {
      pass('materialized skill entrypoints match canonical content');
    } else {
      fail('materialized skill entrypoints do not match canonical content');
    }
  } catch (e) {
    fail(`skill entrypoint materialization test crashed: ${e.message}`);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

// Every CLI skill entrypoint tracked in git MUST also be listed in
// SKILL_ENTRYPOINTS, because that array is the only thing that materializes
// these files on filesystems without symlink support. A tracked-but-unlisted
// entrypoint checks out as a pointer text file on Windows and stays that way:
// the user opens their CLI and the skill is the literal string
// "../../../.agents/skills/jobber/SKILL.md". That is bug #1051, and it hit
// a second time because Kimi shipped after the list was written and nobody
// compared the two. Adding a CLI touches five wiring points; this asserts the
// sixth instead of trusting a reviewer to remember it.
console.log('\n12a-bis. Every tracked skill entrypoint is materializable');

{
  try {
    const tracked = execSync('git ls-files', { cwd: ROOT, encoding: 'utf-8' })
      .split('\n')
      .filter((p) => /^\.[^/]+\/skills\/jobber\/SKILL\.md$/.test(p))
      .filter((p) => !p.startsWith('.agents/')) // the canonical target, not an entrypoint
      .sort();

    // An empty list means git could not see the tree, not that there is nothing
    // to check (#2240): a guard that cannot look must never pass.
    if (tracked.length === 0) {
      fail('git ls-files returned no skill entrypoints — this check could not inspect anything');
    } else {
      const skills = await import(pathToFileURL(join(ROOT, 'scaffolder/bin/skill-entrypoints.mjs')).href);
      const listed = new Set(skills.SKILL_ENTRYPOINTS.map((e) => e.path));
      const unlisted = tracked.filter((p) => !listed.has(p));

      if (unlisted.length === 0) {
        pass(`all ${tracked.length} tracked skill entrypoints are in SKILL_ENTRYPOINTS`);
      } else {
        fail(`skill entrypoint(s) tracked in git but missing from SKILL_ENTRYPOINTS — broken on filesystems without symlinks: ${unlisted.join(', ')}`);
      }
    }
  } catch (e) {
    fail(`skill entrypoint coverage check crashed: ${e.message}`);
  }
}

console.log('\n12b. Skill entrypoint bootstrap (npx / old releases)');

{
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'jobber-ensure-skills-'));
  try {
    const canonicalDir = join(fixtureRoot, '.agents', 'skills', 'jobber');
    const claudeDir = join(fixtureRoot, '.claude', 'skills', 'jobber');
    mkdirSync(canonicalDir, { recursive: true });
    mkdirSync(claudeDir, { recursive: true });

    const fixtureSkill = '---\nname: jobber\n---\n\n# canonical skill\n';
    const pointer = '../../../.agents/skills/jobber/SKILL.md';
    writeFileSync(join(canonicalDir, 'SKILL.md'), fixtureSkill);
    writeFileSync(join(claudeDir, 'SKILL.md'), pointer);

    const skills = await import(pathToFileURL(join(ROOT, 'scaffolder/bin/skill-entrypoints.mjs')).href);
    const touched = skills.ensureSkillEntrypoints(fixtureRoot).sort();
    // Derived from SKILL_ENTRYPOINTS, never hand-listed. A literal array here is
    // a second copy of the same list, and a second copy goes stale: adding Kimi
    // to the registry turned this assertion red for the correct behaviour, which
    // teaches whoever hits it to edit the expectation without reading it. The
    // assertion that matters is "bootstraps everything in the registry", and
    // that one holds whatever the registry contains.
    const expectedTouched = skills.SKILL_ENTRYPOINTS.map((e) => e.path).sort();

    if (JSON.stringify(touched) === JSON.stringify(expectedTouched)) {
      pass('ensureSkillEntrypoints bootstraps all CLI skill entrypoints');
    } else {
      fail(`unexpected bootstrapped skill entrypoints: ${JSON.stringify(touched)}`);
    }

    const grokSkill = readFileSync(join(fixtureRoot, '.grok', 'skills', 'jobber', 'SKILL.md'), 'utf-8');
    const claudeSkill = readFileSync(join(claudeDir, 'SKILL.md'), 'utf-8');
    if (grokSkill === fixtureSkill && claudeSkill === fixtureSkill) {
      pass('ensureSkillEntrypoints materializes canonical skill content');
    } else {
      fail('bootstrapped skill entrypoints do not match canonical content');
    }
  } catch (e) {
    fail(`skill entrypoint bootstrap test crashed: ${e.message}`);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

{
  // Regression guard for #1245: the self-reexec checkout derives its file list
  // from update-system.mjs's static relative imports, so the parser must catch
  // every relative import/export form and ignore bare/package specifiers.
  try {
    const updater = await import(pathToFileURL(join(ROOT, 'update-system.mjs')).href);
    const sample = [
      "import { a } from './scaffolder/bin/skill-entrypoints.mjs';",
      'import b from "../lib/helper.mjs";',
      "export { c } from './sibling.mjs';",
      "import './side-effect.mjs';",
      "import { readFileSync } from 'node:fs';",
      "import yaml from 'js-yaml';",
    ].join('\n');
    const specs = updater.relativeImportSpecifiers(sample).sort();
    const expected = [
      '../lib/helper.mjs',
      './scaffolder/bin/skill-entrypoints.mjs',
      './sibling.mjs',
      './side-effect.mjs',
    ];
    if (JSON.stringify(specs) === JSON.stringify(expected)) {
      pass('relativeImportSpecifiers extracts relative imports, ignores bare/package (#1245)');
    } else {
      fail(`relativeImportSpecifiers mismatch: got ${JSON.stringify(specs)}`);
    }

    // #1706: update-system.mjs must be SELF-LOADING — no static (top-level)
    // relative imports. A pre-#1245 client's apply() self-reexec checks out
    // ONLY update-system.mjs before re-execing it, so a static top-level
    // relative import crashes that re-exec with ERR_MODULE_NOT_FOUND on the
    // old→new jump. Relative modules must be pulled in lazily instead. Matched
    // line-anchored (not via relativeImportSpecifiers, whose loose regex also
    // matches such specifiers inside prose/comments) so only real top-level
    // import/export statements count.
    const liveSource = readFileSync(join(ROOT, 'update-system.mjs'), 'utf-8');
    const staticRelativeImport = /^\s*(?:import|export)\b[^\n]*?\bfrom\s*['"]\.[^'"]*['"]|^\s*import\s*['"]\.[^'"]*['"]/m;
    if (!staticRelativeImport.test(liveSource)) {
      pass('update-system.mjs has no static relative imports — self-loading (#1706)');
    } else {
      fail('update-system.mjs has a static relative import that breaks old→new re-exec (#1706)');
    }
  } catch (e) {
    fail(`relativeImportSpecifiers test crashed: ${e.message}`);
  }
}

{
  // #1706 end-to-end regression: reproduce the old→new re-exec by checking out
  // ONLY update-system.mjs into an otherwise-empty dir (no scaffolder/) and
  // importing it. Before the lazy-import fix this threw ERR_MODULE_NOT_FOUND at
  // module load; it must now load standalone.
  const isolatedRoot = mkdtempSync(join(tmpdir(), 'jobber-updater-standalone-'));
  try {
    const updaterSource = readFileSync(join(ROOT, 'update-system.mjs'), 'utf-8');
    const isolatedUpdater = join(isolatedRoot, 'update-system.mjs');
    writeFileSync(isolatedUpdater, updaterSource);
    try {
      await import(pathToFileURL(isolatedUpdater).href);
      pass('update-system.mjs imports standalone without scaffolder/ present (#1706)');
    } catch (err) {
      fail(`update-system.mjs failed to import standalone (old→new re-exec crash, #1706): ${err.code || err.message}`);
    }
  } finally {
    rmSync(isolatedRoot, { recursive: true, force: true });
  }
}

{
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'jobber-skills-unreadable-'));
  try {
    const canonicalDir = join(fixtureRoot, '.agents', 'skills', 'jobber');
    const claudeDir = join(fixtureRoot, '.claude', 'skills', 'jobber');
    mkdirSync(canonicalDir, { recursive: true });
    mkdirSync(claudeDir, { recursive: true });

    const pointer = '../../../.agents/skills/jobber/SKILL.md';
    mkdirSync(join(canonicalDir, 'SKILL.md'));
    writeFileSync(join(claudeDir, 'SKILL.md'), pointer);

    const skills = await import(pathToFileURL(join(ROOT, 'scaffolder/bin/skill-entrypoints.mjs')).href);
    const materialized = skills.materializeSkillEntrypoints(fixtureRoot);
    const claudeSkill = readFileSync(join(claudeDir, 'SKILL.md'), 'utf-8');
    if (materialized.length === 0 && claudeSkill === pointer) {
      pass('update-system skips skill materialization when canonical entrypoint is unreadable');
    } else {
      fail(`unreadable canonical skill unexpectedly materialized: ${JSON.stringify(materialized)}`);
    }
  } catch (e) {
    fail(`unreadable canonical skill test crashed: ${e.message}`);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

{
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'jobber-skills-entry-dir-'));
  try {
    const canonicalDir = join(fixtureRoot, '.agents', 'skills', 'jobber');
    const claudeDir = join(fixtureRoot, '.claude', 'skills', 'jobber');
    const opencodeDir = join(fixtureRoot, '.opencode', 'skills', 'jobber');
    mkdirSync(canonicalDir, { recursive: true });
    mkdirSync(claudeDir, { recursive: true });
    mkdirSync(opencodeDir, { recursive: true });

    const fixtureSkill = '---\nname: jobber\n---\n\n# canonical skill\n';
    const pointer = '../../../.agents/skills/jobber/SKILL.md';
    writeFileSync(join(canonicalDir, 'SKILL.md'), fixtureSkill);
    mkdirSync(join(claudeDir, 'SKILL.md'));
    writeFileSync(join(opencodeDir, 'SKILL.md'), pointer);

    const skills = await import(pathToFileURL(join(ROOT, 'scaffolder/bin/skill-entrypoints.mjs')).href);
    const materialized = skills.materializeSkillEntrypoints(fixtureRoot);
    const opencodeSkill = readFileSync(join(opencodeDir, 'SKILL.md'), 'utf-8');
    if (JSON.stringify(materialized) === JSON.stringify(['.opencode/skills/jobber/SKILL.md']) && opencodeSkill === fixtureSkill) {
      pass('update-system skips non-file skill entrypoints while materializing valid pointers');
    } else {
      fail(`non-file skill entrypoint handling was unexpected: ${JSON.stringify(materialized)}`);
    }
  } catch (e) {
    fail(`non-file skill entrypoint test crashed: ${e.message}`);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

console.log('\n12c. Materialized skill index mode');

{
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'jobber-skill-git-'));
  const gitRun = (args, opts = {}) => execFileSync('git', args, {
    cwd: fixtureRoot,
    encoding: 'utf-8',
    timeout: 30000,
    ...opts,
  }).trim();
  const gitRaw = (args) => execFileSync('git', args, {
    cwd: fixtureRoot,
    encoding: 'utf-8',
    timeout: 30000,
  });

  try {
    const canonicalDir = join(fixtureRoot, '.agents', 'skills', 'jobber');
    const claudeDir = join(fixtureRoot, '.claude', 'skills', 'jobber');
    const opencodeDir = join(fixtureRoot, '.opencode', 'skills', 'jobber');
    mkdirSync(canonicalDir, { recursive: true });
    mkdirSync(claudeDir, { recursive: true });
    mkdirSync(opencodeDir, { recursive: true });

    const fixtureSkill = '---\nname: jobber\n---\n\n# canonical skill\n';
    const pointer = '../../../.agents/skills/jobber/SKILL.md';

    gitRun(['init']);
    gitRun(['config', 'core.symlinks', 'false']);
    gitRun(['config', 'user.email', 'test@example.com']);
    gitRun(['config', 'user.name', 'Test User']);

    writeFileSync(join(canonicalDir, 'SKILL.md'), fixtureSkill);
    writeFileSync(join(claudeDir, 'SKILL.md'), pointer);
    writeFileSync(join(opencodeDir, 'SKILL.md'), pointer);
    gitRun(['add', '--', '.agents/skills/jobber/SKILL.md']);

    const pointerBlob = gitRun(['hash-object', '-w', '--stdin'], { input: pointer });
    gitRun(['update-index', '--add', '--cacheinfo', `120000,${pointerBlob},.claude/skills/jobber/SKILL.md`]);
    gitRun(['update-index', '--add', '--cacheinfo', `120000,${pointerBlob},.opencode/skills/jobber/SKILL.md`]);

    const updater = await import(pathToFileURL(join(ROOT, 'update-system.mjs')).href);
    const skills = await import(pathToFileURL(join(ROOT, 'scaffolder/bin/skill-entrypoints.mjs')).href);
    const materialized = skills.materializeSkillEntrypoints(fixtureRoot);
    updater.prepareMaterializedSkillEntrypointsForStage(materialized, fixtureRoot);
    gitRun(['add', '--', '.claude/skills/', '.opencode/skills/']);

    const claudeIndex = gitRun(['ls-files', '-s', '--', '.claude/skills/jobber/SKILL.md']);
    const opencodeIndex = gitRun(['ls-files', '-s', '--', '.opencode/skills/jobber/SKILL.md']);
    if (claudeIndex.startsWith('100644 ') && opencodeIndex.startsWith('100644 ')) {
      pass('materialized skill entrypoints stage as regular files, not symlink blobs');
    } else {
      fail(`materialized skill entrypoints staged with wrong modes: ${JSON.stringify([claudeIndex, opencodeIndex])}`);
    }

    const claudeBlob = gitRaw(['show', ':.claude/skills/jobber/SKILL.md']);
    const opencodeBlob = gitRaw(['show', ':.opencode/skills/jobber/SKILL.md']);
    if (claudeBlob === fixtureSkill && opencodeBlob === fixtureSkill) {
      pass('materialized skill blobs contain canonical skill content');
    } else {
      fail('materialized skill blobs do not contain canonical skill content');
    }
  } catch (e) {
    fail(`skill entrypoint index-mode test crashed: ${e.message}`);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

// ── 14. VERSION FILE ─────────────────────────────────────────────

console.log('\n14. Version file');

if (fileExists('VERSION')) {
  // VERSION may carry a release-please marker, e.g. "1.9.0 # x-release-please-version".
  // Validate the first whitespace-delimited token, mirroring update-system.mjs parseVersionFile().
  const version = readFile('VERSION').trim().split(/\s+/)[0];
  if (/^\d+\.\d+\.\d+$/.test(version)) {
    pass(`VERSION is valid semver: ${version}`);
  } else {
    fail(`VERSION is not valid semver: "${version}"`);
  }
} else {
  fail('VERSION file missing');
}
