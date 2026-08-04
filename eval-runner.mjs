#!/usr/bin/env node

/**
 * eval-runner.mjs — shared evaluation pipeline helpers for the standalone
 * evaluators (gemini-eval.mjs, ollama-eval.mjs, openai-eval.mjs).
 *
 * The three evaluators used to each carry a private copy of the same
 * scaffolding: context-file reading, score-summary parsing, report content
 * assembly, company slugging, and tracker-cell normalization. That tripled
 * every fix and let the copies drift (the audit flagged ~70% duplication).
 *
 * This module extracts ONLY the byte-identical shared logic as pure
 * functions — no provider-specific calls, no I/O beyond what a helper is
 * documented to do. The provider call paths (Gemini SDK, Ollama fetch,
 * OpenAI fetch) deliberately stay in their own scripts because they differ
 * in shape (systemInstruction caching, loopback guards, HTTPS enforcement,
 * tracker merge vs print-only). Golden output must be byte-identical, so
 * the shared pieces here are the ones that were already identical.
 *
 * Import-safe: no top-level side effects, no process.exit, main-guarded.
 */

import { existsSync, readFileSync } from 'fs';

/**
 * Read a file and return its trimmed contents, or a placeholder when missing.
 * Emits a console warning so the user knows context is incomplete.
 *
 * @param {string} path - Absolute path to the file.
 * @param {string} label - Human-readable label used in the warning/placeholder.
 * @returns {string} File contents or a "[label not found]" placeholder.
 */
export function readContextFile(path, label) {
  if (!existsSync(path)) {
    console.warn(`⚠️   ${label} not found at: ${path}`);
    return `[${label} not found — skipping]`;
  }
  return readFileSync(path, 'utf-8').trim();
}

/**
 * Parse the ---SCORE_SUMMARY--- block from an evaluation response.
 *
 * All three evaluators emit (and expect) the same machine-readable block;
 * this is the single parser for it. Handles both the block-split style
 * (gemini) and the per-key regex style (ollama/openai) uniformly.
 *
 * @param {string} text - Full evaluation text.
 * @returns {{company: string, role: string, score: string, archetype: string, legitimacy: string}}
 */
export function parseScoreSummary(text) {
  const fallback = { company: 'unknown', role: 'unknown', score: '?', archetype: 'unknown', legitimacy: 'unknown' };
  const match = text.match(/---SCORE_SUMMARY---\s*([\s\S]*?)---END_SUMMARY---/);
  if (!match) return fallback;
  const block = match[1];
  const extract = (key) => {
    const lineMatch = block.split('\n').map(l => l.trimStart()).find(l => l.startsWith(`${key}:`));
    if (lineMatch) return lineMatch.slice(key.length + 1).trim();
    const regexMatch = block.match(new RegExp(`${key}:\\s*(.+)`));
    return regexMatch ? regexMatch[1].trim() : 'unknown';
  };
  return {
    company: extract('COMPANY'),
    role: extract('ROLE'),
    score: extract('SCORE'),
    archetype: extract('ARCHETYPE'),
    legitimacy: extract('LEGITIMACY'),
  };
}

/**
 * Strip the score-summary block from the evaluation body for the report.
 *
 * @param {string} text - Full evaluation text.
 * @returns {string} Evaluation body without the summary block.
 */
export function stripScoreSummary(text) {
  return text.replace(/---SCORE_SUMMARY---[\s\S]*?---END_SUMMARY---/, '').trim();
}

/**
 * Build the markdown report content shared by all evaluators.
 *
 * @param {object} p - Report fields.
 * @param {string} p.company - Company name from the score summary.
 * @param {string} p.role - Role title from the score summary.
 * @param {string} p.archetype - Detected archetype.
 * @param {string} p.score - Score (e.g. "3.8").
 * @param {string} p.legitimacy - Legitimacy tier.
 * @param {string} p.evaluationText - Full evaluation text (summary stripped).
 * @param {string} p.tool - Tool label, e.g. "Gemini (gemini-2.5-flash)".
 * @returns {string} Markdown report body.
 */
export function buildReportContent({ company, role, archetype, score, legitimacy, evaluationText, tool }) {
  return `# Evaluation: ${company} — ${role}

**Date:** ${new Date().toISOString().split('T')[0]}
**Archetype:** ${archetype}
**Score:** ${score}/5
**Legitimacy:** ${legitimacy}
**PDF:** pending
**Tool:** ${tool}

---

${stripScoreSummary(evaluationText)}
`;
}

/**
 * Slugify a company name for filenames.
 *
 * @param {string} value - Raw company name.
 * @returns {string} Lowercase, hyphenated, alphanumeric slug.
 */
export function slugifyCompany(value) {
  return String(value || 'unknown').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unknown';
}

/**
 * Make a value safe for a TSV cell (tabs/newlines flattened).
 *
 * @param {string} value - Raw cell value.
 * @returns {string} Single-line TSV-safe value.
 */
export function tsvSafe(value) {
  return String(value ?? '').replace(/\t/g, ' ').replace(/\n/g, ' ').trim();
}

/**
 * Normalize a score string to the tracker's canonical form ("X.X/5").
 * Score "?" or non-numeric falls back to "0.0/5" so the tracker row is
 * always parseable.
 *
 * @param {string} value - Raw score from the summary block.
 * @returns {string} Normalized tracker score cell.
 */
export function normalizedTrackerScore(value) {
  const m = String(value ?? '').match(/([\d.]+)/);
  const n = m ? parseFloat(m[1]) : 0;
  return `${n.toFixed(1)}/5`;
}
