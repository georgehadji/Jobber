#!/usr/bin/env node
// Resolves every on-X/X role pair (and the non-text outline/focus pairs) in
// src/styles/tokens.css, in both light-dark() branches, and fails under WCAG
// 4.5:1 (text) or 3:1 (non-text). spec/material-plan.md §3.6.
//
// Runs a control fixture first: a deliberately near-invisible pair must fail,
// or this script is not a gate (AGENTS.md assertion rule 5 / rule 4 sibling).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TOKENS_PATH = join(ROOT, 'src', 'styles', 'tokens.css');

// oklch(L% C H) -> linear-light sRGB [r,g,b], each roughly 0..1.
function oklchToLinearSrgb(lPct, c, hDeg) {
  const L = lPct / 100;
  const h = (hDeg * Math.PI) / 180;
  const a = c * Math.cos(h);
  const b = c * Math.sin(h);

  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;

  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;

  return [
    +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ];
}

// WCAG relative luminance is defined on linear RGB, which is exactly what the
// OKLab matrix above already produces — no gamma re-encoding needed.
function relativeLuminance([r, g, b]) {
  const clamp = (x) => Math.max(0, Math.min(1, x));
  return 0.2126 * clamp(r) + 0.7152 * clamp(g) + 0.0722 * clamp(b);
}

function contrastRatio(oklchA, oklchB) {
  const la = relativeLuminance(oklchToLinearSrgb(...oklchA));
  const lb = relativeLuminance(oklchToLinearSrgb(...oklchB));
  const [lighter, darker] = la >= lb ? [la, lb] : [lb, la];
  return (lighter + 0.05) / (darker + 0.05);
}

function parseTokens(css) {
  const roles = {};
  const lineRe = /(--[\w-]+):\s*light-dark\(\s*oklch\(([\d.]+)%\s+([\d.]+)\s+([\d.]+)\)\s*,\s*oklch\(([\d.]+)%\s+([\d.]+)\s+([\d.]+)\)\s*\)/g;
  let m;
  while ((m = lineRe.exec(css))) {
    const [, name, lL, lC, lH, dL, dC, dH] = m;
    roles[name] = {
      light: [Number(lL), Number(lC), Number(lH)],
      dark: [Number(dL), Number(dC), Number(dH)],
    };
  }
  return roles;
}

// [foreground, background, minRatio, label]
const PAIRS = [
  ['--m3-on-surface', '--m3-surface', 4.5, 'on-surface / surface'],
  ['--m3-on-surface-variant', '--m3-surface', 4.5, 'on-surface-variant / surface'],
  ['--m3-on-surface', '--m3-surface-container-low', 4.5, 'on-surface / surface-container-low'],
  ['--m3-on-surface', '--m3-surface-container-high', 4.5, 'on-surface / surface-container-high'],
  ['--m3-on-surface', '--m3-surface-container-highest', 4.5, 'on-surface / surface-container-highest'],
  ['--m3-on-primary', '--m3-primary', 4.5, 'on-primary / primary'],
  ['--m3-on-primary-container', '--m3-primary-container', 4.5, 'on-primary-container / primary-container'],
  ['--m3-on-error', '--m3-error', 4.5, 'on-error / error'],
  ['--m3-on-error-container', '--m3-error-container', 4.5, 'on-error-container / error-container'],
  ['--m3-error', '--m3-surface', 4.5, 'error text on surface (color-below-text)'],
  ['--m3-outline', '--m3-surface', 3, 'outline / surface (non-text)'],
  ['--color-focus', '--m3-surface', 3, 'focus ring / surface (non-text)'],
];

function runPairs(roles, pairs) {
  const failures = [];
  for (const [fgName, bgName, min, label] of pairs) {
    const fg = roles[fgName], bg = roles[bgName];
    if (!fg || !bg) { failures.push(`${label}: role missing (${fgName} or ${bgName} not found)`); continue; }
    for (const scheme of ['light', 'dark']) {
      const ratio = contrastRatio(fg[scheme], bg[scheme]);
      if (ratio < min) failures.push(`${label} [${scheme}]: ${ratio.toFixed(2)}:1, needs ${min}:1`);
    }
  }
  return failures;
}

// Control fixture: a near-white-on-near-white pair, built so it cannot pass by accident.
const CONTROL_ROLES = {
  '--fixture-fg': { light: [96, 0.002, 250], dark: [96, 0.002, 250] },
  '--fixture-bg': { light: [98, 0.002, 250], dark: [98, 0.002, 250] },
};
const controlFailures = runPairs(CONTROL_ROLES, [
  ['--fixture-fg', '--fixture-bg', 4.5, 'control fixture (must fail)'],
]);
if (controlFailures.length === 0) {
  console.error('CONTRAST CHECKER SELF-TEST FAILED: control fixture passed, so this script is not a gate.');
  process.exit(1);
}

const css = readFileSync(TOKENS_PATH, 'utf8');
const roles = parseTokens(css);
if (Object.keys(roles).length === 0) {
  console.error(`No light-dark() role pairs parsed from ${TOKENS_PATH}`);
  process.exit(1);
}

const failures = runPairs(roles, PAIRS);
if (failures.length > 0) {
  console.error('CONTRAST FAILURES:');
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}

console.log(`check-contrast: control fixture failed as expected; ${PAIRS.length} role pairs pass in both schemes.`);
