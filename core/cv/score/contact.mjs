// @ts-check
// core/cv/score/contact.mjs — contact-block completeness.
//
// Checks whether an email address (and, as a bonus signal, a phone number or
// a profile/portfolio link) is locatable in the places a CV conventionally
// puts contact information: the preamble (a contact block directly under the
// title, e.g. examples/cv-example.md's "**Location:** ... **Email:** ..."
// lines), the title line itself, and the first section. A CV with no locatable
// email is close to unusable regardless of content quality — a recruiter or
// an ATS import that cannot find a way to reach the candidate stops there.
//
// This is deliberately a PRESENCE/completeness check, not a validity/security
// check. build-cv-html.mjs's sanitizeUrl() answers a different question (is it
// safe to put this string into rendered HTML as a link) and stays where it is,
// in the rendering adapter — that is a security boundary concern (§4.5),
// this is a content-completeness signal. Duplicating scheme-injection
// defenses into core/ would conflate two different jobs.
//
// Pure module: no side effects, no process.exit, no I/O at import.

// A pragmatic email pattern, not a full RFC 5322 implementation — this is
// scoring a CV's completeness, not validating a login form. It will pass
// "name@example.com" and reject "not an email", which is the bar that matters
// here.
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[a-zA-Z]{2,}/;

// Loosely matches a run of digit groups joined by common phone punctuation
// (+, spaces, dashes, parens) — deliberately permissive across international
// formats, deliberately not a validator. The separator between groups is
// MANDATORY, not optional: an optional separator lets regex backtracking
// carve any unbroken digit run into fake "groups" with nothing actually
// separating them, which is exactly how an early version of this pattern
// matched CV date ranges like "(2020-2024)" as if they were a phone number —
// caught by testing against a real fixture, not a hypothetical. Requiring a
// real separator character between every group closes that: a bare
// "YYYY-YYYY" only has one hyphen, so it can supply at most one group
// transition, one short of PHONE_RE's minimum of two.
const PHONE_RE = /(?:\+\d{1,3}[\s.-]?)?\(?\d{2,4}\)?(?:[\s.-]\d{2,4}){2,4}/;

// A bare domain-like token (linkedin.com/in/x, alexchen.dev) or a scheme'd URL.
// Global (/g): findLink() below needs every link-shaped substring in a claim,
// not just the first — see its own comment for why.
const LINK_RE = /(?:https?:\/\/)?(?:[\w-]+\.)+[a-z]{2,}(?:\/[\w./-]*)?/gi;

/**
 * Find the first claim (in candidate order) whose text contains a
 * link-shaped substring that is NOT simply the domain half of an email
 * address also present in the CV.
 *
 * Why this needs a real scan rather than `Array.prototype.find` plus a
 * non-global regex test: a contact block is very commonly ONE merged claim —
 * parse.mjs merges consecutive non-blank lines with no blank separator into a
 * single paragraph, and examples/cv-example.md's five "**Label:** value"
 * contact lines are exactly this — so the email and a genuinely separate
 * LinkedIn/portfolio link often live in the SAME claim, not different ones.
 * And within that one claim, a non-global `.match(LINK_RE)` returns the FIRST
 * link-shaped substring scanning left to right, which for
 * "...alex@example.com **LinkedIn:** linkedin.com/in/alexchen..." is
 * "example.com" — the email's own domain, matched starting right after the
 * '@' — not the LinkedIn URL appearing later in the same string. Only a
 * global scan that skips matches equal to the email's own domain finds the
 * real, separate link. Caught by testing against examples/cv-example.md, not
 * a hypothetical.
 *
 * @param {import('../model.mjs').Claim[]} candidates
 * @param {string|undefined} emailDomain - lowercased host part of the found email, if any
 * @returns {{ claim: import('../model.mjs').Claim, matchText: string } | null}
 */
function findLink(candidates, emailDomain) {
  for (const claim of candidates) {
    for (const match of claim.text.matchAll(LINK_RE)) {
      if (!emailDomain || match[0].toLowerCase() !== emailDomain) {
        return { claim, matchText: match[0] };
      }
    }
  }
  return null;
}

/**
 * @param {import('../model.mjs').CvDocument} doc
 * @returns {import('./rubric.mjs').DimensionScore}
 */
export function scoreContact(doc) {
  /** @type {import('../model.mjs').Claim[]} */
  const candidates = [doc.title];
  for (const block of doc.preamble) {
    if (block.kind === 'bullets') candidates.push(...(block.items ?? []));
    else if (block.claim) candidates.push(block.claim);
  }
  const firstSection = doc.sections[0];
  if (firstSection) {
    for (const block of firstSection.blocks) {
      if (block.kind === 'bullets') candidates.push(...(block.items ?? []));
      else if (block.claim) candidates.push(block.claim);
    }
  }

  const emailMatch = candidates.find((c) => EMAIL_RE.test(c.text));
  const phoneMatch = candidates.find((c) => PHONE_RE.test(c.text));
  const emailDomain = emailMatch ? (emailMatch.text.match(EMAIL_RE)?.[0].split('@')[1] ?? '').toLowerCase() : undefined;
  const linkFound = findLink(candidates, emailDomain);
  const linkMatch = linkFound?.claim;

  /** @type {string[]} */
  const findings = [];
  /** @type {import('../model.mjs').SourceSpan[]} */
  const evidence = [];
  let score = 0;

  if (emailMatch) {
    score += 0.6;
    findings.push('Email address found.');
    evidence.push(emailMatch.source);
  } else {
    findings.push('No email address found in the title, preamble, or opening section — a recruiter or ATS import may have no way to reach this candidate.');
  }

  if (phoneMatch || linkMatch) {
    score += 0.4;
    const parts = [];
    if (phoneMatch) { parts.push('phone number'); evidence.push(phoneMatch.source); }
    if (linkMatch) { parts.push('profile or portfolio link'); evidence.push(linkMatch.source); }
    findings.push(`${parts.join(' and ')} also found.`);
  } else {
    findings.push('No phone number or profile/portfolio link found (optional, but strengthens reachability).');
  }

  return { key: 'contact', score, findings, evidence };
}
