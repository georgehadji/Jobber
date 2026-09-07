#!/usr/bin/env node
// Workler site build. No framework, no dependencies.
//
// Why no framework (the /build skill asks for the choice and the reason):
// eleven static pages, zero interactivity, zero client-side state. Astro would ship
// the same 0KB of JS and add a dependency tree to install, audit and keep current.
// The whole build is the ~120 lines below, it runs in milliseconds, and it cannot rot.
// If this site ever grows an application surface, that is the moment to reach for a
// framework — not before.
//
// Enforces the three build-time rules from spec/ia.md §5:
//   1. every page has an answer block of 40–60 words
//   2. every claim-with-receipt has a resolving href
//   3. the report demo set contains one below-threshold record and one legitimacy flag
// Rule 3 is a warning by default and an error under --strict (the launch gate), because
// the demo records are still [CLIENT INPUT REQUIRED] and a build that cannot run is a
// build nobody checks.

import { readFileSync, writeFileSync, readdirSync, mkdirSync, rmSync, cpSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';

const ROOT = import.meta.dirname;
const SRC = join(ROOT, 'src');
const OUT = join(ROOT, 'dist');
const STRICT = process.argv.includes('--strict');
const SITE = process.env.SITE_ORIGIN || 'https://workler.example';
// The placeholder origin is baked into every canonical, og:url and JSON-LD @id. A deploy
// that forgets SITE_ORIGIN would publish structured data pointing at a domain nobody owns,
// so the launch gate refuses it (spec/qa-report.md D4).
const PLACEHOLDER_ORIGIN = !process.env.SITE_ORIGIN;

let warnings = 0;
let errors = 0;
const warn = (m) => { warnings++; console.warn(`  warn  ${m}`); };
const fail = (m) => { errors++; console.error(`  FAIL  ${m}`); };

// ── read ────────────────────────────────────────────────────────────────────
const layout = readFileSync(join(SRC, 'layout.html'), 'utf8');
const pageFiles = readdirSync(join(SRC, 'pages')).filter((f) => f.endsWith('.html'));

const META_RE = /^<!--meta\s*([\s\S]*?)-->\s*/;

const pages = pageFiles.map((file) => {
  const raw = readFileSync(join(SRC, 'pages', file), 'utf8');
  const m = raw.match(META_RE);
  if (!m) throw new Error(`${file}: missing leading <!--meta {...}--> block`);
  let meta;
  try {
    meta = JSON.parse(m[1]);
  } catch (e) {
    throw new Error(`${file}: meta block is not valid JSON — ${e.message}`);
  }
  return { file, meta, body: raw.slice(m[0].length) };
});

// ── validate ────────────────────────────────────────────────────────────────
// Rule 1: answer block 40–60 words. The point of the rule is that the block survives
// being quoted with no page around it; too short says nothing, too long is not quotable.
for (const p of pages) {
  const words = (p.meta.answer_block || '').trim().split(/\s+/).filter(Boolean).length;
  if (!p.meta.answer_block) {
    (p.meta.blocked ? warn : fail)(`${p.file}: no answer_block`);
  } else if (words < 40 || words > 60) {
    fail(`${p.file}: answer_block is ${words} words, needs 40–60`);
  }
  if (!p.meta.title || p.meta.title.length > 60) fail(`${p.file}: title missing or over 60 chars`);
  if (!p.meta.description || p.meta.description.length > 155) {
    (p.meta.blocked ? warn : fail)(`${p.file}: description missing or over 155 chars`);
  }
}

// Rule 2: a claim without a receipt cannot be published. This is spec/brief.md §4's proof
// mechanism enforced as a build step rather than as writing discipline.
for (const p of pages) {
  for (const claim of p.body.matchAll(/<p class="claim"(?![^>]*data-receipt=)/g)) {
    void claim;
    fail(`${p.file}: a .claim element has no data-receipt`);
  }
  for (const [, href] of p.body.matchAll(/data-receipt="([^"]*)"/g)) {
    if (!href.trim() || href.includes('CLIENT INPUT')) {
      warn(`${p.file}: claim receipt is unresolved (${href.slice(0, 40)})`);
    }
  }
}

// Rule 3: the demo set must be able to show the product saying no.
const demoPath = join(SRC, 'data', 'demo-records.json');
let demos = [];
if (existsSync(demoPath)) demos = JSON.parse(readFileSync(demoPath, 'utf8'));
const hasBelow = demos.some((d) => d.score < 4.0 && d.recommendation === 'do-not-apply');
const hasFlag = demos.some((d) => d.legitimacy_flag === true);
if (!demos.length) {
  (STRICT ? fail : warn)('no demo records — the proof section renders as CLIENT INPUT REQUIRED');
} else if (!hasBelow || !hasFlag) {
  fail('demo set must include one record below 4.0 with do-not-apply, and one legitimacy flag');
}

// Launch gate: no [CLIENT INPUT REQUIRED] marker may survive into a deployed build.
// A warning is right during construction and useless at deploy time — the whole failure
// mode of this project is a placeholder that looks like finished copy.
for (const p of pages) {
  const markers = (p.body.match(/CLIENT INPUT REQUIRED/g) || []).length;
  if (markers) (STRICT ? fail : warn)(`${p.file}: ${markers} unanswered CLIENT INPUT REQUIRED marker(s)`);
}

if (PLACEHOLDER_ORIGIN) {
  (STRICT ? fail : warn)(`SITE_ORIGIN is unset — building against the placeholder ${SITE}`);
}

// ── render ──────────────────────────────────────────────────────────────────
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const nav = [
  ['/how-it-works', 'How it works'],
  ['/ghost-jobs', 'Ghost jobs'],
  ['/open-source', 'Open source'],
  ['/pricing', 'Pricing'],
];

const navHtml = (current) =>
  nav
    .map(([href, label]) =>
      `<li><a href="${href}"${href === current ? ' aria-current="page"' : ''}>${label}</a></li>`)
    .join('\n          ');

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

for (const p of pages) {
  const slug = basename(p.file, '.html');
  const url = slug === 'index' ? '/' : `/${slug}`;
  const dir = slug === 'index' ? OUT : join(OUT, slug);
  mkdirSync(dir, { recursive: true });

  const html = layout
    .replaceAll('{{lang}}', p.meta.lang || 'en')
    .replaceAll('{{title}}', esc(p.meta.title))
    .replaceAll('{{description}}', esc(p.meta.description || ''))
    .replaceAll('{{canonical}}', SITE + url)
    .replaceAll('{{robots}}', p.meta.blocked ? '\n<meta name="robots" content="noindex">' : '')
    .replaceAll('{{nav}}', navHtml(url))
    .replaceAll('{{jsonld}}', JSON.stringify(p.meta.jsonld || { '@context': 'https://schema.org', '@type': 'WebPage', name: p.meta.title, url: SITE + url }))
    .replaceAll('{{body}}', p.body)
    .replaceAll('{{year}}', String(new Date().getFullYear()));

  writeFileSync(join(dir, 'index.html'), html);
}

cpSync(join(SRC, 'styles'), join(OUT, 'styles'), { recursive: true });
if (existsSync(join(ROOT, 'public'))) cpSync(join(ROOT, 'public'), OUT, { recursive: true });

// Blocked pages are excluded from the sitemap as well as noindexed. Submitting a
// placeholder for indexing is a trust cost, not just an SEO one.
const urls = pages
  .filter((p) => !p.meta.blocked)
  .map((p) => {
    const slug = basename(p.file, '.html');
    return slug === 'index' ? '/' : `/${slug}`;
  });

writeFileSync(
  join(OUT, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
    .map((u) => `  <url><loc>${SITE}${u}</loc></url>`)
    .join('\n')}\n</urlset>\n`
);

// robots.txt does not block AI crawlers. If the client ever decides otherwise that is a
// decision to record in spec/growth-plan.md, not a default to inherit.
writeFileSync(join(OUT, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`);

console.log(`built ${pages.length} pages → dist/  (${warnings} warnings, ${errors} errors)`);
if (errors) process.exit(1);
