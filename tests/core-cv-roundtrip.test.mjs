// tests/core-cv-roundtrip.test.mjs — parse.mjs <-> render.mjs (W1: round-trip invariant)
//
// This is the property POLYTONIC-PLAN.md §W1 names as a CI gate. The exact bar
// matters: render.mjs picks ONE canonical spacing style rather than preserving
// arbitrary source formatting (blank-line placement around headings is not
// modeled — parse.mjs's own grammar comment calls it "otherwise insignificant"),
// so byte-identical round-trip against uncontrolled input is the wrong test.
// Two invariants together are the right bar:
//
//   1. STRUCTURAL round-trip: parse(md) and parse(render(parse(md))) describe
//      the same document (title, preamble, section keys, block structure,
//      claim text) — SourceSpan offsets necessarily differ, since re-rendering
//      produces a different string, so those are excluded from the comparison.
//   2. CANONICAL FIXED POINT: render.mjs's output is idempotent under a second
//      parse+render pass — feeding its own output back through does not drift.
//
// A CV authored in render.mjs's own canonical style (no blank line between a
// heading and its first block) round-trips byte-for-byte, and that stronger
// claim is tested directly wherever it's the honest bar to hold to.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pass, fail } from './helpers.mjs';
import { parseCvMarkdown } from '../core/cv/parse.mjs';
import { renderCvMarkdown } from '../core/cv/render.mjs';

console.log('\ncore/cv/parse.mjs + render.mjs — round-trip invariants (W1)');

/** @param {import('../core/cv/model.mjs').Claim} c */
const structClaim = (c) => ({ text: c.text, kind: c.kind });
/** @param {import('../core/cv/model.mjs').Block} b */
const structBlock = (b) => (
  b.kind === 'bullets' ? { kind: 'bullets', items: (b.items ?? []).map(structClaim) }
  : b.kind === 'heading' ? { kind: 'heading', level: b.level, claim: structClaim(/** @type {any} */ (b.claim)) }
  : { kind: 'paragraph', claim: structClaim(/** @type {any} */ (b.claim)) }
);
/** @param {import('../core/cv/model.mjs').CvDocument} doc */
const structDoc = (doc) => ({
  title: structClaim(doc.title),
  preamble: doc.preamble.map(structBlock),
  sections: doc.sections.map((s) => ({ key: s.key, heading: structClaim(s.heading), blocks: s.blocks.map(structBlock) })),
});

const FIXTURES = [
  '../test-fixtures/upgrade/state-v1.18/cv.md',
  '../test-fixtures/upgrade/state-v1.16/cv.md',
  '../examples/cv-example.md',
];

try {
  let structuralAllPass = true;
  let fixedPointAllPass = true;

  for (const rel of FIXTURES) {
    const path = fileURLToPath(new URL(rel, import.meta.url));
    const md = readFileSync(path, 'utf8');

    const parsed1 = parseCvMarkdown(md);
    if (!parsed1.ok) { fail(`${rel}: initial parse failed — ${JSON.stringify(parsed1.error)}`); structuralAllPass = false; continue; }

    const rendered1 = renderCvMarkdown(parsed1.value);
    const parsed2 = parseCvMarkdown(rendered1);
    if (!parsed2.ok) { fail(`${rel}: re-parsing rendered output failed — ${JSON.stringify(parsed2.error)}`); structuralAllPass = false; continue; }

    // Invariant 1: structural equality.
    const s1 = JSON.stringify(structDoc(parsed1.value));
    const s2 = JSON.stringify(structDoc(parsed2.value));
    if (s1 !== s2) { structuralAllPass = false; fail(`${rel}: structural round-trip differs`); }

    // Invariant 2: canonical fixed point.
    const rendered2 = renderCvMarkdown(parsed2.value);
    if (rendered1 !== rendered2) { fixedPointAllPass = false; fail(`${rel}: canonical form is not a fixed point`); }
  }

  if (structuralAllPass) pass(`structural round-trip holds across ${FIXTURES.length} real-world fixtures`);
  if (fixedPointAllPass) pass(`canonical rendering reaches a fixed point on all ${FIXTURES.length} fixtures`);

  // The stronger claim: a CV already written in render.mjs's own canonical style
  // (a blank line between every block, including right after a heading) round-trips
  // byte-for-byte. This is the ACTUAL convention renderBlock/renderCvMarkdown use
  // (parts.join('\n\n') uniformly) — a real fixture like state-v1.18/cv.md omits
  // some of those blank lines, which is why IT only holds to the weaker structural
  // + fixed-point invariants above, not byte-identity.
  const canonical = '# Name\n\n## Summary\n\nOne line of prose.\n\n## Experience\n\n### Role -- Company (2020-2024)\n\n- Did a thing.\n- Did another thing.\n\n## Skills\n\nPython, Go.\n';
  const parsed = parseCvMarkdown(canonical);
  if (!parsed.ok) {
    fail(`canonical-style input failed to parse: ${JSON.stringify(parsed.error)}`);
  } else {
    const rendered = renderCvMarkdown(parsed.value);
    if (rendered === canonical) {
      pass('a CV in render.mjs\'s own canonical style round-trips byte-for-byte');
    } else {
      fail(`byte round-trip on canonical-style input differs:\n  in:  ${JSON.stringify(canonical)}\n  out: ${JSON.stringify(rendered)}`);
    }
  }

  // A CV with a preamble round-trips too — preamble is real structure, not an
  // afterthought bolted onto the model after sections.
  const withPreamble = '# Alex Chen\n\n**Email:** alex@example.com\n\n## Summary\nBuilds things.\n';
  const p1 = parseCvMarkdown(withPreamble);
  if (p1.ok) {
    const r1 = renderCvMarkdown(p1.value);
    const p2 = parseCvMarkdown(r1);
    if (p2.ok && JSON.stringify(structDoc(p1.value)) === JSON.stringify(structDoc(p2.value))) {
      pass('preamble content survives a structural round-trip');
    } else {
      fail('preamble content lost or altered across round-trip');
    }
  } else {
    fail(`preamble round-trip input failed to parse: ${JSON.stringify(p1.error)}`);
  }

  // A no-op parse+render+parse must not accumulate drift over multiple passes —
  // this is the fixed-point property carried out three times instead of once,
  // to catch a slow drift that a single pass could miss.
  let doc = parseCvMarkdown(canonical);
  if (!doc.ok) {
    fail('multi-pass stability: initial parse failed');
  } else {
    let stable = true;
    let prevRendered = renderCvMarkdown(doc.value);
    for (let pass_ = 0; pass_ < 3; pass_++) {
      const reparsed = parseCvMarkdown(prevRendered);
      if (!reparsed.ok) { stable = false; break; }
      const rerendered = renderCvMarkdown(reparsed.value);
      if (rerendered !== prevRendered) { stable = false; break; }
      prevRendered = rerendered;
    }
    if (stable) pass('three successive parse+render passes produce no drift');
    else fail('drift detected across multiple parse+render passes');
  }
} catch (e) {
  fail(`core-cv-roundtrip tests crashed: ${e.message}\n${e.stack}`);
}
