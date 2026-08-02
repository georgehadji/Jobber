// lib/score-summary.mjs — one output contract for the evaluators (#improvement-plan M2)
//
// gemini-eval.mjs, ollama-eval.mjs, openai-eval.mjs and the interactive
// modes/oferta.md path all claim to produce the same report, tied together by
// a `---SCORE_SUMMARY--- / ---END_SUMMARY---` string convention that each file
// emitted and parsed with its own copy of the same regex. Two plain functions
// remove the real duplication — the wire format — while leaving each evaluator
// readable top to bottom. (The plan deliberately avoids a Template Method
// evaluator abstraction: three implementations do not justify inversion of
// control.)
//
// Pure module: no side effects, no process.exit, no I/O at import
// (#improvement-plan A7).

const FIELD_ORDER = ['COMPANY', 'ROLE', 'SCORE', 'ARCHETYPE', 'LEGITIMACY'];

/** Extract one `KEY: value` line from a raw summary block. */
function field(raw, key) {
  const re = new RegExp(`^\\s*${key}:\\s*(.+)$`, 'm');
  const m = raw && raw.match(re);
  return m ? m[1].trim() : '';
}

/**
 * Parse a `---SCORE_SUMMARY---` block out of raw model output.
 *
 * @param {string} text - Raw evaluator output containing the summary block.
 * @returns {{company:string,role:string,score:number,archetype:string,legitimacy:string}}
 *   score is NaN and strings default to ''/unknown when the block is missing or
 *   a field is absent — same tolerant contract eval-golden.mjs already relied on.
 */
export function parse(text) {
  const block = String(text ?? '').match(/---SCORE_SUMMARY---\s*([\s\S]*?)---END_SUMMARY---/);
  const raw = block ? block[1] : '';
  return {
    company: field(raw, 'COMPANY'),
    role: field(raw, 'ROLE'),
    score: parseFloat(field(raw, 'SCORE')),
    archetype: (field(raw, 'ARCHETYPE') || 'unknown').toLowerCase(),
    legitimacy: field(raw, 'LEGITIMACY'),
  };
}

/**
 * Serialize a score summary to the exact wire block the evaluators emit.
 *
 * @param {object} s
 * @param {string} s.company - Company name (or "Unknown").
 * @param {string} s.role - Role title.
 * @param {number} s.score - Global score as a decimal (use a tenth, e.g. 3.8).
 * @param {string} s.archetype - Detected archetype.
 * @param {string} s.legitimacy - One of "High Confidence" | "Proceed with Caution" | "Suspicious".
 * @returns {string} The fenced SCORE_SUMMARY block.
 */
export function serialize(s) {
  const values = {
    COMPANY: s.company ?? 'Unknown',
    ROLE: s.role ?? '',
    SCORE: s.score,
    ARCHETYPE: s.archetype ?? '',
    LEGITIMACY: s.legitimacy ?? '',
  };
  const lines = FIELD_ORDER.map((k) => `${k}: ${values[k]}`);
  return `---SCORE_SUMMARY---\n${lines.join('\n')}\n---END_SUMMARY---`;
}
