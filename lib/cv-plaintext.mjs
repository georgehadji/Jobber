// lib/cv-plaintext.mjs — ATS-safe plaintext CV renderer (#improvement-plan A5)
//
// The HTML and LaTeX builders are the visual formats. But the genuinely
// ATS-safe format is plain text: no columns, no tables, no markup — just
// one-line fields and bulleted lists that an applicant-tracking system's text
// extractor cannot mangle. This renderer produces exactly that from the SAME
// payload model the visual builders consume (candidate/contact, summary,
// competencies, experience, projects, education, certifications, skills), so a
// plaintext CV is always in lock-step with the HTML one and needs no refactor
// of the visual path.
//
// Pure module: no side effects, no process.exit, no I/O at import
// (#improvement-plan A7).
//
// ATS conventions honoured:
//   - no tab-formatted tables, no columns — every field is its own line;
//   - bullets are "- " prefixed, one per line (ATS and humans both parse this);
//   - company/role/dates on distinct lines so a parser keys each cleanly;
//   - no em-dash column separators, no HTML entity escaping (raw text).

function line(s) {
  return String(s ?? '').replace(/[\r\n]+/g, ' ').trim();
}

function bulletLines(entries) {
  const out = [];
  for (const e of Array.isArray(entries) ? entries : []) {
    const t = line(e);
    if (t) out.push(`- ${t}`);
  }
  return out;
}

function renderContact(candidate = {}) {
  const fields = [
    candidate.name, candidate.headline, candidate.phone, candidate.email,
    candidate.location, candidate.linkedin, candidate.portfolio_url, candidate.github,
  ];
  const present = fields.map(line).filter(Boolean);
  return present;
}

function renderExperience(experience = []) {
  const out = [];
  for (const e of experience) {
    if (!e || typeof e !== 'object') continue;
    const company = line(e.company);
    const role = line(e.role);
    const period = line(e.dates || e.period);
    const location = line(e.location);
    if (role) out.push(role);
    if (period) out.push(period);
    if (company) out.push(`Company: ${company}`);
    if (location) out.push(`Location: ${location}`);
    out.push(...bulletLines(e.bullets));
    out.push('');
  }
  return out;
}

function renderEducation(education = []) {
  const out = [];
  for (const e of education) {
    if (!e || typeof e !== 'object') continue;
    const parts = [line(e.title), line(e.org), line(e.year)].filter(Boolean);
    if (parts.length) out.push(parts.join(' — '));
    const desc = line(e.description);
    if (desc) out.push(desc);
    out.push('');
  }
  return out.map(s => s); // return as-is; description may already be bullets-free
}

function renderProjects(projects = []) {
  const out = [];
  for (const e of projects) {
    if (!e || typeof e !== 'object') continue;
    const name = line(e.name);
    if (name) out.push(name);
    const desc = Array.isArray(e.bullets) ? e.bullets : ([e.description].filter(Boolean));
    out.push(...bulletLines(desc));
    if (e.tech) out.push(`Tech: ${line(e.tech)}`);
    out.push('');
  }
  return out;
}

function renderCertifications(certifications = []) {
  return certifications
    .map((c) => (typeof c === 'string' ? line(c) : line(c?.name || c?.title)))
    .filter(Boolean);
}

function renderSkills(skills = []) {
  const out = [];
  for (const group of skills) {
    if (!group || typeof group !== 'object') continue;
    const name = line(group.name || group.category);
    const items = Array.isArray(group.items) ? group.items : [];
    if (name && items.length) out.push(`${name}: ${items.map(line).filter(Boolean).join(', ')}`);
  }
  return out;
}

/**
 * Render a CV payload to ATS-safe plain text.
 *
 * @param {object} payload - The CV payload the HTML/LaTeX builders consume.
 * @param {object} [opts]
 * @param {object} [opts.titles] - Optional localized section headings (same
 *   shape as payload.sections). Falls back to English.
 * @returns {string} The rendered plaintext CV.
 */
export function renderPlaintextCv(payload = {}) {
  const titles = { ...DEFAULT_SECTION_TITLES, ...(payload.sections || {}) };
  const blocks = [];

  const contact = renderContact(payload.candidate);
  if (contact.length) blocks.push(contact.join('\n'));

  if (line(payload.summary)) {
    blocks.push(`${titles.summary}\n${line(payload.summary)}`);
  }

  const competencies = bulletLines(payload.competencies);
  if (competencies.length) blocks.push(`${titles.competencies}\n${competencies.join('\n')}`);

  if (Array.isArray(payload.experience) && payload.experience.length) {
    blocks.push(`${titles.experience}\n${renderExperience(payload.experience).join('\n').replace(/\n{3,}/g, '\n\n')}`);
  }

  if (Array.isArray(payload.projects) && payload.projects.length) {
    blocks.push(`${titles.projects}\n${renderProjects(payload.projects).join('\n').replace(/\n{3,}/g, '\n\n')}`);
  }

  if (Array.isArray(payload.education) && payload.education.length) {
    blocks.push(`${titles.education}\n${renderEducation(payload.education).join('\n').replace(/\n{3,}/g, '\n\n')}`);
  }

  const certs = renderCertifications(payload.certifications);
  if (certs.length) blocks.push(`${titles.certifications}\n${certs.join('\n')}`);

  const skillsLines = renderSkills(payload.skills);
  if (skillsLines.length) blocks.push(`${titles.skills}\n${skillsLines.join('\n')}`);

  return blocks.join('\n\n') + '\n';
}

const DEFAULT_SECTION_TITLES = {
  summary: 'SUMMARY',
  competencies: 'CORE COMPETENCIES',
  experience: 'EXPERIENCE',
  projects: 'PROJECTS',
  education: 'EDUCATION',
  certifications: 'CERTIFICATIONS',
  skills: 'SKILLS',
};
