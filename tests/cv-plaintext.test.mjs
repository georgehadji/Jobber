// tests/cv-plaintext.test.mjs — lib/cv-plaintext.mjs (A5: ATS-safe plaintext CV)
import { pass, fail } from './helpers.mjs';
import { renderPlaintextCv } from '../lib/cv-plaintext.mjs';

console.log('\nlib/cv-plaintext.mjs — ATS-safe plaintext renderer (A5)');

const PAYLOAD = {
  candidate: { name: 'Jane Smith', email: 'j@example.com', location: 'Berlin, DE', linkedin: 'in/jane', phone: '+49 000' },
  summary: 'AI engineer turned product builder.',
  competencies: ['Python', 'ML pipelines', 'Fast prototyping'],
  experience: [
    { company: 'Acme', role: 'Staff ML Engineer', dates: '2020—present', location: 'Remote', bullets: ['Shipped 3 production models', 'Drove 2x inference speedup'] },
  ],
  projects: [{ name: 'Tool', description: 'Open-source CLI', tech: 'Python' }],
  education: [{ title: 'BSc Computer Science', org: 'TU Berlin', year: '2015' }],
  certifications: ['AWS Solutions Architect'],
  skills: [{ name: 'Languages', items: ['Python', 'TypeScript'] }, { name: 'Cloud', items: ['AWS', 'GCP'] }],
};

try {
  const text = renderPlaintextCv(PAYLOAD);

  // 1. No HTML remains in the plaintext output.
  if (!/<[a-z]|<\/?[a-z]/.test(text)) {
    pass('plaintext output contains no HTML markup');
  } else {
    fail('plaintext output leaked HTML tags');
  }

  // 2. Contact fields on their own lines, raw (no escaping).
  if (text.includes('j@example.com') && text.includes('Berlin, DE') && text.includes('in/jane')) {
    pass('contact fields present as raw text');
  } else {
    fail('contact fields missing');
  }

  // 3. Experience renders bullets as "- " lines, not <li>.
  if (text.includes('- Shipped 3 production models') && text.includes('Company: Acme') && !/<li>/.test(text)) {
    pass('experience bullets are bulleted plain lines');
  } else {
    fail('experience did not render as plain bulleted lines');
  }

  // 4. Section headings present.
  if (['SUMMARY', 'CORE COMPETENCIES', 'EXPERIENCE', 'PROJECTS', 'EDUCATION', 'CERTIFICATIONS', 'SKILLS']
      .every((h) => text.includes(h))) {
    pass('all section headings present');
  } else {
    fail('a section heading is missing');
  }

  // 5. Skills render as "group: item1, item2".
  if (text.includes('Languages: Python, TypeScript')) {
    pass('skills render as comma-separated group lines');
  } else {
    fail('skills did not render as group lines');
  }

  // 6. Empty payload still renders (no throw).
  const empty = renderPlaintextCv({});
  if (typeof empty === 'string' && empty.trim() === '') {
    pass('empty payload renders to empty string without throwing');
  } else {
    fail(`empty payload: ${JSON.stringify(empty)}`);
  }
} catch (e) {
  fail(`cv-plaintext tests crashed: ${e.message}`);
}
