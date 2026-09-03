#!/usr/bin/env node

/**
 * build-cv-plaintext.mjs — emit an ATS-safe plaintext CV from the same payload
 * the HTML/LaTeX builders consume (#improvement-plan A5).
 *
 * ATS extractors routinely mangle col/table layouts (the HTML template) and
 * are indifferent to LaTeX; plain text is the one format every ATS reads
 * byte-faithfully. This is a thin shell over the pure renderer in
 * lib/cv-plaintext.mjs — argument parsing + file I/O, no CV logic (see
 * CONTRIBUTING.md for the lib/-vs-root rule).
 *
 * Usage:
 *   node build-cv-plaintext.mjs <input.json> <output.txt>
 *   node build-cv-plaintext.mjs --test
 */

import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderPlaintextCv } from './lib/cv-plaintext.mjs';
import { assertFacts } from './verify-cv-facts.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));

async function runSelfTest() {
  const payload = {
    candidate: { name: 'Jane Smith', email: 'jane@example.com', location: 'Berlin, DE', linkedin: 'in/janesmith' },
    summary: 'AI engineer turned product builder.',
    competencies: ['Python', 'ML pipelines', 'Fast prototyping'],
    experience: [{ company: 'Acme', role: 'Staff ML Engineer', dates: '2020—present', bullets: ['Shipped 3 production models'] }],
    projects: [{ name: 'Tool', description: 'Open-source CLI', tech: 'Python' }],
    education: [{ title: 'BSc Computer Science', year: '2015' }],
    skills: [{ name: 'Languages', items: ['Python', 'TypeScript'] }],
  };
  const text = renderPlaintextCv(payload);
  const checks = [
    ['contact line', text.includes('Jane Smith') && text.includes('jane@example.com')],
    ['experience bullet', text.includes('- Shipped 3 production models')],
    ['ATS-safe (no HTML)', !/<[a-z]|<\/?[a-z]/.test(text)],
    ['competency listed', text.includes('Python')],
  ];
  let failed = 0;
  for (const [label, ok] of checks) {
    console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`);
    if (!ok) failed++;
  }
  console.log(okBanner(failed));
  process.exit(failed ? 1 : 0);
}

function okBanner(failed) {
  return failed === 0 ? '\n✅ plaintext CV renderer self-test passed' : `\n❌ ${failed} self-test check(s) failed`;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('--help')) {
    console.error('Usage: node build-cv-plaintext.mjs <input.json> <output.txt>');
    process.exit(1);
  }
  if (args.includes('--test')) {
    await runSelfTest();
    return;
  }
  const [inputPath, outputPath] = args;
  if (!inputPath || !outputPath) {
    console.error('Usage: node build-cv-plaintext.mjs <input.json> <output.txt>');
    process.exit(1);
  }
  const absInput = resolve(ROOT, inputPath);
  const absOutput = resolve(ROOT, outputPath);

  let payload;
  try {
    payload = JSON.parse(await readFile(absInput, 'utf-8'));
  } catch (err) {
    console.error(`Failed to read/parse input JSON: ${err.message}`);
    process.exit(1);
  }
  const text = renderPlaintextCv(payload);
  // Same code-level gate the other two CV output paths apply (B7-D1, B7-D3) —
  // this plaintext path had no fact check at all before writing the file.
  try {
    assertFacts(text, { label: 'CV (plaintext)' });
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
  try {
    await writeFile(absOutput, text, 'utf-8');
  } catch (err) {
    console.error(`Failed to write ${absOutput}: ${err.message}`);
    process.exit(1);
  }
  console.log(`✅ Plaintext CV written to ${absOutput}`);
}

main();
