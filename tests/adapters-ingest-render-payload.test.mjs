// tests/adapters-ingest-render-payload.test.mjs — adapters/ingest/render-payload.mjs
//
// The render payload is the TAILORED content (modes/pdf.md step 17), so it is
// what keyword coverage should be measured against rather than the untailored
// cv.md or the downstream HTML. These tests pin the two things that make that
// safe: the produced CvDocument carries the payload's own canonical section
// keys (so coverage.mjs's evidence distinction lands on the right sections),
// and a malformed payload fails loudly instead of yielding a thin document
// that would silently report near-zero coverage.
import { pass, fail } from './helpers.mjs';
import { ingestRenderPayload } from '../adapters/ingest/render-payload.mjs';

console.log('\nadapters/ingest/render-payload.mjs — CV render payload → CvDocument');

const PAYLOAD = {
  lang: 'en',
  candidate: {
    name: 'Jane Smith',
    email: 'jane@example.com',
    phone: '+1 415 555 0100',
    location: 'San Francisco, CA',
    linkedin: { url: 'https://linkedin.com/in/janesmith', display: 'linkedin.com/in/janesmith' },
  },
  sections: { experience: 'Work Experience', skills: 'Skills', projects: 'Projects' },
  summary: 'Backend engineer focused on distributed systems.',
  competencies: ['RAG Pipelines', 'LLMOps'],
  experience: [
    { company: 'Acme', role: 'Senior Engineer', location: 'Remote', dates: '2020-2024', bullets: ['Ran services on k8s', 'Cut p99 latency by 40%'] },
  ],
  projects: [{ name: 'Recommender', badge: 'Open Source', tech: 'Python, FastAPI', description: 'Collaborative filtering.' }],
  education: [{ title: 'B.S. Computer Science', org: 'State University', year: '2018' }],
  certifications: [{ title: 'CKA', org: 'CNCF', year: '2024' }],
  skills: [
    { category: 'Languages', items: 'Python, Go' },
    { category: 'Frameworks', items: ['FastAPI', 'React'] },
  ],
};

try {
  const raw = JSON.stringify(PAYLOAD, null, 2);
  const result = ingestRenderPayload(raw);

  if (result.ok !== true) {
    fail(`valid payload failed to ingest: ${JSON.stringify(result)}`);
  } else {
    const doc = result.value;

    // 1. Title comes from candidate.name.
    if (doc.title.text === 'Jane Smith') pass('candidate.name becomes the document title');
    else fail(`title: ${JSON.stringify(doc.title)}`);

    // 2. Contact details land in the preamble, matching where a markdown CV
    //    puts them, so core/cv/score/contact.mjs sees the same shape either way.
    const contact = doc.preamble[0]?.claim?.text ?? '';
    if (contact.includes('jane@example.com') && contact.includes('linkedin.com/in/janesmith')) {
      pass('contact details become the preamble (same shape as a markdown CV)');
    } else {
      fail(`preamble: ${JSON.stringify(doc.preamble)}`);
    }

    // 3. Section keys are the payload's own keys — already canonical, so no
    //    heading-matching guesswork and no language round trip.
    const keys = doc.sections.map((s) => s.key);
    const expected = ['summary', 'competencies', 'experience', 'projects', 'education', 'certifications', 'skills'];
    if (JSON.stringify(keys) === JSON.stringify(expected)) {
      pass('sections carry canonical keys in payload order');
    } else {
      fail(`keys: ${JSON.stringify(keys)}`);
    }

    // 4. Display titles are preserved as the heading text without becoming the key.
    const experience = doc.sections.find((s) => s.key === 'experience');
    if (experience?.heading.text === 'Work Experience') {
      pass('the display title is kept as heading text while the key stays canonical');
    } else {
      fail(`heading: ${JSON.stringify(experience?.heading)}`);
    }

    // 5. Experience entries produce a heading plus its bullets.
    const expBullets = experience?.blocks.find((b) => b.kind === 'bullets')?.items ?? [];
    const expHeading = experience?.blocks.find((b) => b.kind === 'heading')?.claim?.text ?? '';
    if (expHeading.includes('Senior Engineer') && expHeading.includes('Acme') && expBullets.length === 2) {
      pass('an experience entry becomes a composed heading plus its bullets');
    } else {
      fail(`experience blocks: ${JSON.stringify(experience?.blocks)}`);
    }

    // 6. skills[].items accepts a string or an array — the schema permits both.
    const skills = doc.sections.find((s) => s.key === 'skills');
    const skillTexts = (skills?.blocks[0]?.items ?? []).map((c) => c.text);
    if (skillTexts.some((t) => t.includes('Python, Go')) && skillTexts.some((t) => t.includes('FastAPI, React'))) {
      pass('skills[].items accepts both a string and an array of strings');
    } else {
      fail(`skills: ${JSON.stringify(skillTexts)}`);
    }

    // 7. Spans point into the real file: offsets locate the text, lines are
    //    1-indexed. Without this, coverage hits could not show the user the
    //    actual sentence.
    const bullet = expBullets[0];
    const located = bullet && raw.slice(bullet.source.start, bullet.source.end) === bullet.source.text;
    if (located && bullet.source.line > 1) {
      pass('claim spans locate their text at real offsets in the payload source');
    } else {
      fail(`span: ${JSON.stringify(bullet?.source)}`);
    }

    // 8. The cursor advances, so repeated strings get distinct offsets rather
    //    than all resolving to the first occurrence.
    const starts = expBullets.map((c) => c.source.start);
    if (starts.length === 2 && starts[1] > starts[0]) {
      pass('successive claims get strictly increasing offsets (cursor advances)');
    } else {
      fail(`offsets: ${JSON.stringify(starts)}`);
    }

    // 9. An empty section is omitted rather than emitted with no blocks.
    const withEmpty = ingestRenderPayload(JSON.stringify({ ...PAYLOAD, projects: [] }));
    if (withEmpty.ok && !withEmpty.value.sections.some((s) => s.key === 'projects')) {
      pass('a section with no content is omitted rather than emitted empty');
    } else {
      fail(`empty section: ${JSON.stringify(withEmpty.ok && withEmpty.value.sections.map((s) => s.key))}`);
    }

    // 10. An unknown top-level field never becomes a section.
    const withExtra = ingestRenderPayload(JSON.stringify({ ...PAYLOAD, hobbies: ['chess'] }));
    if (withExtra.ok && !withExtra.value.sections.some((s) => s.key === 'hobbies')) {
      pass('an unrecognized top-level field is ignored, not turned into a section');
    } else {
      fail(`extra field: ${JSON.stringify(withExtra.ok && withExtra.value.sections.map((s) => s.key))}`);
    }
  }

  // 11-15. Malformed input fails loudly. A thin or empty document would report
  //     near-zero keyword coverage, which reads as "this CV matches nothing"
  //     rather than "the input was broken".
  const badInputs = [
    [42, 'PAYLOAD_NOT_A_STRING', 'non-string input'],
    ['{not json', 'PAYLOAD_INVALID_JSON', 'invalid JSON'],
    ['[1,2,3]', 'PAYLOAD_NOT_AN_OBJECT', 'a JSON array'],
    [JSON.stringify({ candidate: {}, experience: [] }), 'PAYLOAD_MISSING_NAME', 'a payload with no candidate.name'],
    [JSON.stringify({ candidate: { name: 'X' } }), 'PAYLOAD_NO_SECTIONS', 'a payload with no section content'],
  ];
  for (const [input, code, label] of badInputs) {
    const r = ingestRenderPayload(input);
    if (r.ok === false && r.error.code === code) pass(`${label} is rejected with ${code}`);
    else fail(`${label} should fail with ${code}: ${JSON.stringify(r)}`);
  }

  // 16. Oversized input is bounded, matching adapters/ingest/markdown.mjs.
  const huge = JSON.stringify({ candidate: { name: 'X' }, summary: 'y'.repeat(300 * 1024) });
  const over = ingestRenderPayload(huge);
  if (over.ok === false && over.error.code === 'PAYLOAD_TOO_LARGE') {
    pass('an oversized payload is rejected at the same 256KB ceiling as markdown ingestion');
  } else {
    fail(`oversized: ${JSON.stringify(over)}`);
  }
} catch (e) {
  fail(`adapters-ingest-render-payload tests crashed: ${e.message}\n${e.stack}`);
}
