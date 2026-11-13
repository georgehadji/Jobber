// tests/legitimacy-interview-machines.test.mjs — STATE-MACHINES-PLAN Phase 4.5 (M32, M34, M35).
// Parity: every legitimacy tier / interview round / round-outcome spelling that the code and the
// mode files use today is a state, label or alias of the declared machine. Declaring is
// behaviour-neutral, so nothing here changes a writer or a mode.
//
// Method (AGENTS.md "Writing Assertions"):
//  - runtime where an entry point is importable (eval-runner, lib/score-summary fallbacks);
//  - source/mode-text extraction otherwise. Each extractor is checked by IDENTITY (the exact tokens
//    it must find, and which are missing) and has a CONTROL: a bogus word is not resolved, and an
//    extractor run over a synthetic text with a bogus token reports exactly that token.
//  - needles are built by concatenation where the test file would otherwise match itself (rule 6).
import { pass, fail, ROOT } from './helpers.mjs';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { loadMachine, canonicalize, check } from '../lib/state-machine.mjs';
import { parseScoreSummary } from '../eval-runner.mjs';
import { parse as parseSummaryBlock } from '../lib/score-summary.mjs';

console.log('\nlegitimacy-tier / interview-round / interview-round-outcome machines (Phase 4.5)');

const eq = (label, got, want) => (JSON.stringify(got) === JSON.stringify(want) ? pass(label) : fail(`${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`));
const read = rel => readFileSync(join(ROOT, rel), 'utf-8').replace(/\r\n/g, '\n');

const LEG = loadMachine('legitimacy-tier');
const ROUND = loadMachine('interview-round');
const OUTCOME = loadMachine('interview-round-outcome');
const BOGUS = 'definitely' + '-not-a-spelling';

/** Tokens in `tokens` that the machine cannot resolve (order and duplicates preserved). */
const unresolved = (machine, tokens) => tokens.filter(t => canonicalize(machine, t) === null);
/** Assert exact identity of what an extractor found, then that all of it resolves. */
function parity(label, machine, found, expected) {
  const missing = expected.filter(t => !found.includes(t));
  const extra = found.filter(t => !expected.includes(t));
  eq(`${label}: extractor found exactly the expected tokens (missing ${JSON.stringify(missing)}, unexpected ${JSON.stringify(extra)})`, [missing, extra], [[], []]);
  eq(`${label}: every token resolves to a state`, unresolved(machine, found), []);
}

// ── loads valid, shape ─────────────────────────────────────────────────────
eq('legitimacy-tier states', LEG.states.map(s => s.id), ['unconfirmed', 'high-confidence', 'proceed-with-caution', 'suspicious']);
eq('legitimacy-tier English labels', LEG.states.map(s => s.label), ['Unconfirmed', 'High Confidence', 'Proceed with Caution', 'Suspicious']);
eq('interview-round states', ROUND.states.map(s => s.id), ['screen', 'hiring-manager', 'technical', 'system-design', 'behavioral', 'onsite', 'final']);
eq('interview-round-outcome states', OUTCOME.states.map(s => s.id), ['pending', 'moved-forward', 'rejected']);
eq('control: a bogus word resolves in none of the three machines', [LEG, ROUND, OUTCOME].map(m => canonicalize(m, BOGUS)), [null, null, null]);
eq('aliases resolve to the right state (spot check across languages)', [
  canonicalize(LEG, 'Güvenilir')?.id, canonicalize(LEG, 'Dikkatli İlerle')?.id, canonicalize(LEG, 'Підозріло')?.id,
  canonicalize(LEG, '疑似虛假／已過期')?.id, canonicalize(LEG, 'proceed_with_caution')?.id, canonicalize(LEG, 'unknown')?.id,
  canonicalize(ROUND, 'recruiter-screen')?.id, canonicalize(ROUND, 'design-case-study')?.id, canonicalize(ROUND, 'panel-mixed')?.id,
  canonicalize(OUTCOME, 'moved forward')?.id, canonicalize(OUTCOME, 'avanzó')?.id, canonicalize(OUTCOME, 'en attente')?.id,
], ['high-confidence', 'proceed-with-caution', 'suspicious', 'suspicious', 'proceed-with-caution', 'unconfirmed',
  'screen', 'system-design', 'onsite', 'moved-forward', 'moved-forward', 'pending']);
eq('control: a different state does not match (Güvenilir is not suspicious)', canonicalize(LEG, 'Güvenilir')?.id === 'suspicious', false);
// the check() gate: an assessed tier is reachable from the fallback, and a tier re-derivation is a correction (never a refusal)
eq('legitimacy: unconfirmed -> tier is a declared move', check(LEG, 'unknown', 'Suspicious').kind, 'forward');
eq('legitimacy: tier -> tier is a correction, ok', [check(LEG, 'Suspicious', 'High Confidence').ok, check(LEG, 'Suspicious', 'High Confidence').kind], [true, 'correction']);
eq('round: recruiter-screen -> technical resolves through aliases and is a declared move', check(ROUND, 'recruiter-screen', 'peer-tech').kind, 'forward');
eq('round: final is terminal (exit needs an override)', check(ROUND, 'final', 'screen').kind, 'terminal-exit');
eq('outcome: pending -> rejected is a declared move, rejected -> pending is refused', [check(OUTCOME, 'pending', 'rejected').kind, check(OUTCOME, 'rejected', 'pending').kind], ['forward', 'terminal-exit']);

// ── legitimacy: extractors over mode/code text ─────────────────────────────
// Template alternations: `{A | B | C}` / `<A | B | C>` after a legitimacy key.
const ALT_RE = /(?:\*\*Legitimacy:\*\*|\*\*Meşruiyet:\*\*|legitimacy_tier:|LEGITIMACY:|"?legitimacy"?:)\s*"?[{<]([^}>"\n]+)[}>]/gi;
const altTokens = text => [...text.matchAll(ALT_RE)].flatMap(m => m[1].split('|').map(s => s.trim()).filter(Boolean));
// Plain values: `legitimacy_tier: "High Confidence"`, `legitimacy: high_confidence`, `**Legitimacy:** High Confidence`.
const PLAIN_RE = /^\s*(?:legitimacy_tier|legitimacy):\s*"?([^"\n{<$]+?)"?\s*$|^\*\*Legitimacy:\*\*\s*([^\n{<$]+?)\s*$/gim;
const plainTokens = text => [...text.matchAll(PLAIN_RE)].map(m => (m[1] ?? m[2]).trim());

{ // control: the extractors work, and a bogus token is reported as exactly that token
  const synthetic = `**Legitimacy:** {High Confidence | ${BOGUS}}\nlegitimacy_tier: "{Suspicious | Proceed with Caution}"\nlegitimacy: nope_${BOGUS}\n`;
  eq('control: alternation extractor splits a synthetic template and the bogus token is the only unresolved one',
    [altTokens(synthetic), unresolved(LEG, altTokens(synthetic))], [['High Confidence', BOGUS, 'Suspicious', 'Proceed with Caution'], [BOGUS]]);
  eq('control: plain extractor finds the synthetic plain value and it does not resolve', [plainTokens(synthetic), unresolved(LEG, plainTokens(synthetic))], [[`nope_${BOGUS}`], [`nope_${BOGUS}`]]);
}

const ENG = ['High Confidence', 'Proceed with Caution', 'Suspicious'];
const SNAKE = ['high_confidence', 'proceed_with_caution', 'suspicious'];
// English template alternations, one per writer/prompt (identity: the exact set each file offers)
parity('modes/oferta.md **Legitimacy:** header', LEG, altTokens(read('modes/oferta.md')), ENG);
parity('modes/ja/kyujin.md **Legitimacy:** header', LEG, altTokens(read('modes/ja/kyujin.md')), ENG);
parity('modes/ar/fursah.md **Legitimacy:** header', LEG, altTokens(read('modes/ar/fursah.md')), ENG);
parity('gemini-eval.mjs LEGITIMACY: prompt', LEG, altTokens(read('gemini-eval.mjs')), ENG);
parity('ollama-eval.mjs LEGITIMACY: prompt', LEG, altTokens(read('ollama-eval.mjs')), ENG);
parity('openai-eval.mjs LEGITIMACY: prompt', LEG, altTokens(read('openai-eval.mjs')), ENG);
// batch prompt: legitimacy_tier x2, risk_summary.legitimacy (snake_case) x2, JSON "legitimacy" x1
parity('batch/batch-prompt.md alternations', LEG, altTokens(read('batch/batch-prompt.md')), [...ENG, ...SNAKE, ...ENG, ...SNAKE, ...ENG].filter((t, i, a) => a.indexOf(t) === i));
{
  const batch = altTokens(read('batch/batch-prompt.md'));
  const absentBatch = [...ENG, ...SNAKE].filter(t => !batch.includes(t));
  eq('batch/batch-prompt.md: both vocabularies are present (English tiers and snake_case); absent ' + JSON.stringify(absentBatch), absentBatch, []);
}
// translated writer headers (tr/zh/zh-TW use translated labels in the header template)
parity('modes/tr/is-ilani.md **Meşruiyet:** header', LEG, altTokens(read('modes/tr/is-ilani.md')), ['Güvenilir', 'Dikkatli İlerle', 'Şüpheli']);
parity('modes/zh/oferta.md **Legitimacy:** header', LEG, altTokens(read('modes/zh/oferta.md')), ['高置信度', '谨慎推进', '疑似虚假']);
parity('modes/zh-TW/oferta.md **Legitimacy:** header', LEG, altTokens(read('modes/zh-TW/oferta.md')), ['高信心', '審慎推進', '疑似虛假']);

// tier bullet lists in the _shared.md files: presence in the file (so a rewording is noticed) AND resolution
const SHARED = {
  'modes/_shared.md': ENG,
  'modes/ja/_shared.md': ENG,
  'modes/tr/_shared.md': ['Güvenilir', 'Dikkatli İlerle', 'Şüpheli'],
  'modes/ua/_shared.md': ['Висока впевненість', 'Обережно', 'Підозріло'],
  'modes/zh/_shared.md': ['高置信度', '谨慎推进', '疑似虚假/已过期'],
  'modes/zh-TW/_shared.md': ['高信心', '審慎推進', '疑似虛假／已過期'],
  'modes/ar/_shared.md': ['High Confidence', 'Proceed with Caution', 'Suspicious', 'ثقة عالية', 'تقدم بحذر', 'مشبوهة'],
};
for (const [file, tokens] of Object.entries(SHARED)) {
  const text = read(file);
  const absent = tokens.filter(t => !text.includes(`**${t}`) && !text.includes(`${t}**`) && !text.includes(`(${t})`));
  eq(`${file}: each tier label is present as a bold bullet (absent ${JSON.stringify(absent)})`, absent, []);
  eq(`${file}: each tier label resolves to a state`, unresolved(LEG, tokens), []);
}
// the tr evaluation mode repeats the tr tier list at 213-215
parity('modes/tr/is-ilani.md bold tier bullets', LEG, [...read('modes/tr/is-ilani.md').matchAll(/^- \*\*([^*]+)\*\* — /gm)].map(m => m[1]).filter(t => !t.startsWith('Sürekli')), ['Güvenilir', 'Dikkatli İlerle', 'Şüpheli']);

// plain values in code/tests that exist today
parity('analyze-patterns.mjs plain legitimacy values', LEG, plainTokens(read('analyze-patterns.mjs')).filter((t, i, a) => a.indexOf(t) === i), ['High Confidence', 'high_confidence']);
{ // writers' fallbacks, by RUNTIME where possible
  const evalFallback = parseScoreSummary('no summary block here at all').legitimacy;
  eq('eval-runner.mjs fallback (no SCORE_SUMMARY block) is `unconfirmed` (D13: was `unknown`)', [evalFallback, canonicalize(LEG, evalFallback)?.id], ['unconfirmed', 'unconfirmed']);
  const missingKey = parseScoreSummary('---SCORE_SUMMARY---\nCOMPANY: A\nROLE: B\nSCORE: 4.0\nARCHETYPE: x\n---END_SUMMARY---').legitimacy;
  eq('eval-runner.mjs per-key miss (block present, LEGITIMACY: absent) is also `unconfirmed` (D13)', [missingKey, canonicalize(LEG, missingKey)?.id], ['unconfirmed', 'unconfirmed']);
  const missingOther = parseScoreSummary('---SCORE_SUMMARY---\nCOMPANY: A\nROLE: B\nSCORE: 4.0\nLEGITIMACY: High Confidence\n---END_SUMMARY---').archetype;
  eq('control: a missing non-legitimacy key still falls back to `unknown` (only LEGITIMACY changed)', missingOther, 'unknown');
  const tier = parseScoreSummary('---SCORE_SUMMARY---\nCOMPANY: A\nROLE: B\nSCORE: 4.0\nARCHETYPE: x\nLEGITIMACY: Proceed with Caution\n---END_SUMMARY---').legitimacy;
  eq('control: eval-runner.mjs passes a real tier through unchanged and it resolves to its own state', [tier, canonicalize(LEG, tier)?.id], ['Proceed with Caution', 'proceed-with-caution']);
  // openrouter-runner.mjs cannot be imported without running it: source-text, with a control
  const OR = read('openrouter-runner.mjs');
  const orFallback = [...OR.matchAll(/'\*\*Legitimacy:\*\*\s*([^']+)'/g)].map(m => m[1].trim());
  eq('openrouter-runner.mjs fallback literal is `unconfirmed` (the canonical Unconfirmed state)', [orFallback, orFallback.map(t => canonicalize(LEG, t)?.id)], [['unconfirmed'], ['unconfirmed']]);
  eq('control: the openrouter extractor does not match a different quoted header', [...'x = \'**Other:** unconfirmed\''.matchAll(/'\*\*Legitimacy:\*\*\s*([^']+)'/g)].length, 0);
  eq('the two writers now emit the SAME fallback string (D13), so analyze-patterns groups them together', [evalFallback === orFallback[0], missingKey === orFallback[0]], [true, true]);
  eq('control: the legacy spelling `unknown` is still a declared alias of the same state (old reports keep resolving)', canonicalize(LEG, 'unknown')?.id, 'unconfirmed');
}
// Strings the machine CANNOT express — pinned so a future fix is noticed rather than silent.
{
  const empty = parseSummaryBlock('no block').legitimacy;
  eq('KNOWN GAP: lib/score-summary.mjs parse() yields the empty string when LEGITIMACY: is absent; it resolves to no state', [empty, canonicalize(LEG, empty)], ['', null]);
  eq('KNOWN GAP: the rendered rows `✅ High Confidence` / `⚠️ Suspicious — reason` (prefix/suffix) are not exact-match spellings', [canonicalize(LEG, '✅ High Confidence'), canonicalize(LEG, '⚠️ Suspicious — reason')], [null, null]);
  eq('KNOWN GAP: web legitimacyTone() substring tests (e.g. Spanish `Alta confianza`) are not exact-match spellings', canonicalize(LEG, 'Alta confianza'), null);
  const batch = read('batch/batch-prompt.md');
  eq('KNOWN GAP: the batch failure record carries JSON null for legitimacy (not a string; no state)', /"legitimacy": null,/.test(batch), true);
}

// ── interview round ────────────────────────────────────────────────────────
const MIRRORS = ['', 'de/', 'es/', 'fr/', 'pt/', 'zh/'];
const ROUND_ENUM = ['screen', 'hiring-manager', 'technical', 'system-design', 'behavioral', 'onsite', 'final'];
const ROUND_TYPE = ['screening', 'technical', 'design-case-study', 'behavioral'];
const frontEnum = text => [...text.matchAll(/^round: \[([^\]]+)\]/gm)].flatMap(m => m[1].split('|').map(s => s.trim()));
const roundType = text => [...text.matchAll(/^\*\*(?:Round type|Type de round) ?:\*\* \[([^\]]+)\]/gm)].flatMap(m => m[1].split('/').map(s => s.trim()));
const mapped = text => [...text.matchAll(/→ `([a-z-]+)`/g)].map(m => m[1]);
{ // control
  const synthetic = `round: [screen | ${BOGUS}]\n**Round type:** [screening / ${BOGUS}]\nHM screen → \`${BOGUS}\`\n`;
  eq('control: round extractors report a bogus token as the one unresolved', [unresolved(ROUND, frontEnum(synthetic)), unresolved(ROUND, roundType(synthetic)), unresolved(ROUND, mapped(synthetic))], [[BOGUS], [BOGUS], [BOGUS]]);
}
for (const lang of MIRRORS) {
  for (const f of ['debrief', 'practice']) {
    const file = `modes/${lang}interview/${f}.md`;
    if (!existsSync(join(ROOT, file))) { fail(`${file} is missing`); continue; }
    const text = read(file);
    parity(`${file} round: frontmatter enum`, ROUND, frontEnum(text), ROUND_ENUM);
    parity(`${file} Round type template`, ROUND, roundType(text), ROUND_TYPE);
  }
}
// the round-type -> enum mapping sentences (English + zh carry them; every target must resolve)
parity('modes/interview/debrief.md mapping targets', ROUND, mapped(read('modes/interview/debrief.md')), ['screen', 'hiring-manager', 'technical', 'system-design']);
parity('modes/interview/practice.md mapping targets', ROUND, mapped(read('modes/interview/practice.md')), ['screen', 'hiring-manager', 'technical', 'system-design', 'behavioral']);
// audience set in interview-prep.md: table rows, the Audience Map example, per-audience headings
{
  const ip = read('modes/interview-prep.md');
  const table = [...ip.matchAll(/^\| `([a-z-]+)`\s*\|/gm)].map(m => m[1]);
  parity('modes/interview-prep.md audience table', ROUND, table, ['recruiter-screen', 'hiring-manager', 'peer-tech', 'panel-mixed']);
  const headings = [...ip.matchAll(/^### Audience: `([a-z-]+)`/gm)].map(m => m[1]);
  eq('modes/interview-prep.md per-audience headings resolve (found ' + JSON.stringify(headings) + ')', [headings.length > 0, unresolved(ROUND, headings)], [true, []]);
  parity('modes/interview-prep.md Audience Map example targets', ROUND, mapped(ip), ['recruiter-screen', 'peer-tech', 'hiring-manager', 'panel-mixed']);
  eq('the four audiences resolve to screen / hiring-manager / technical / onsite (no accidental collapse)',
    ['recruiter-screen', 'hiring-manager', 'peer-tech', 'panel-mixed'].map(t => canonicalize(ROUND, t)?.id), ['screen', 'hiring-manager', 'technical', 'onsite']);
}

// ── round outcome ──────────────────────────────────────────────────────────
const OUT = {
  '': ['moved forward', 'rejected', 'pending'],
  'de/': ['weiter', 'abgelehnt', 'offen'],
  'es/': ['avanzó', 'rechazado', 'pendiente'],
  'pt/': ['avançou', 'rejeitado', 'pendente'],
  'fr/': ['avance', 'rejeté', 'en attente'],
  'zh/': ['moved forward', 'rejected', 'pending'],
};
const inputsLine = text => (text.match(/^3\. \*\*[^*]+\*\*[^—\n]*—\s*(.+)$/m) ?? [])[1]?.split('/').map(s => s.trim()) ?? [];
const outcomeLine = text => [...text.matchAll(/^\*\*(?:Outcome|Résultat) ?:\*\* \[([^\]]+)\]/gm)].flatMap(m => m[1].split('/').map(s => s.trim()));
{ // control
  const synthetic = `3. **Round outcome** (if known) — pending / ${BOGUS}\n**Outcome:** [pending / ${BOGUS}]\n`;
  eq('control: outcome extractors report a bogus token as the one unresolved', [unresolved(OUTCOME, inputsLine(synthetic)), unresolved(OUTCOME, outcomeLine(synthetic))], [[BOGUS], [BOGUS]]);
}
for (const [lang, want] of Object.entries(OUT)) {
  const file = `modes/${lang}interview/debrief.md`;
  const text = read(file);
  parity(`${file} inputs line 3 (round outcome)`, OUTCOME, inputsLine(text), want);
  // the Outcome template line is English in every mirror (fr translates the label only)
  parity(`${file} Outcome template line`, OUTCOME, outcomeLine(text), ['pending', 'moved forward', 'rejected']);
}
