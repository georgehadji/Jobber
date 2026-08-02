// tests/score-summary.test.mjs — lib/score-summary.mjs (M2: one evaluator contract)
import { pass, fail } from './helpers.mjs';
import { parse, serialize } from '../lib/score-summary.mjs';

console.log('\nlib/score-summary.mjs — SCORE_SUMMARY wire format (M2)');

// The exact wire block the evaluators emit (frozen: this IS the contract that
// must not drift across gemini/ollama/openai + eval-golden). Assert shape, not
// the numeric value, so a score change never reds the gate.
const FROZEN_BLOCK = '---SCORE_SUMMARY---\n' +
  'COMPANY: Acme\n' +
  'ROLE: Platform Engineer\n' +
  'SCORE: 3.8\n' +
  'ARCHETYPE: ai platform / llmops\n' +
  'LEGITIMACY: High Confidence\n' +
  '---END_SUMMARY---';

// A realistic report body with the block at the end, as a model would output it.
const FROZEN_OUTPUT = `## A) Role Summary
... prose ...

## G) Posting Legitimacy
...
${FROZEN_BLOCK}`;

try {
  // 1. parse() extracts every field from the frozen block.
  const p = parse(FROZEN_OUTPUT);
  if (p.company === 'Acme' && p.role === 'Platform Engineer') {
    pass('parse extracts company and role');
  } else {
    fail(`parse company/role: ${JSON.stringify(p)}`);
  }
  if (p.score === 3.8) {
    pass('parse extracts the numeric score');
  } else {
    fail(`parse score: ${p.score}`);
  }
  if (p.archetype === 'ai platform / llmops' && p.legitimacy === 'High Confidence') {
    pass('parse extracts archetype (lowercased) and legitimacy');
  } else {
    fail(`parse archetype/legitimacy: ${JSON.stringify(p)}`);
  }

  // 2. serialize() re-emits the exact wire format.
  const s = serialize({ company: 'Acme', role: 'Platform Engineer', score: 3.8, archetype: 'ai platform / llmops', legitimacy: 'High Confidence' });
  if (s === FROZEN_BLOCK) {
    pass('serialize emits the exact frozen wire block');
  } else {
    fail(`serialize drifted from the contract:\n${s}`);
  }

  // 3. parse(serialize(x)) round-trips (shape preserved).
  const obj = { company: 'Beta', role: 'Designer', score: 2.4, archetype: 'Graphic / Visual Designer', legitimacy: 'Proceed with Caution' };
  const back = parse(serialize(obj));
  if (back.company === obj.company && back.role === obj.role && back.score === obj.score
      && back.archetype === obj.archetype.toLowerCase() && back.legitimacy === obj.legitimacy) {
    pass('parse(serialize(obj)) round-trips every field');
  } else {
    fail(`round-trip mismatch: ${JSON.stringify(back)}`);
  }

  // 4. Tolerant on a missing block (NaN score, empty strings), never throws.
  const empty = parse('no summary here');
  if (Number.isNaN(empty.score) && empty.archetype === 'unknown' && empty.company === '') {
    pass('parse is tolerant of a missing/unparseable block');
  } else {
    fail(`parse tolerance: ${JSON.stringify(empty)}`);
  }
} catch (e) {
  fail(`score-summary tests crashed: ${e.message}`);
}
