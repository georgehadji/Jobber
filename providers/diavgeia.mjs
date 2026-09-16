// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Diavgeia (Δι@ύγεια) provider — the Greek government transparency register.
// Every Greek public body must publish its hiring announcements here, so this
// is the canonical feed for public-sector vacancies (research centres,
// universities, municipalities, ministries).
//
// Endpoint: /luminapi/api/search — the one the Diavgeia web UI itself calls.
// NOT /opendata/search: that endpoint currently answers 200 with every filter
// silently ignored (a nonsense query and a real one both return the same ~3M
// rows), so anything built on it looks like it works and returns noise.
//
// Wire in via a tracked_companies entry with `provider: diavgeia` and an
// `organizationUid`. Find a body's uid from any of its decisions:
//   https://diavgeia.gov.gr/opendata/decisions/{ADA}.json → organizationId
//
// KNOWN CEILING: Diavgeia publishes the announcement's *subject*, which for
// research bodies is the funding project's title, never the role. The actual
// specialty ("software engineer", "chemist") lives only inside the attached
// PDF προκήρυξη. So title keyword filtering cannot narrow these by role —
// scope with organizationUid and triage the results by hand.

const SEARCH_URL = 'https://diavgeia.gov.gr/luminapi/api/search';

// Γ.3.1 = ΠΡΟΚΗΡΥΞΗ ΠΛΗΡΩΣΗΣ ΘΕΣΕΩΝ (vacancy announcement). Full list:
// https://diavgeia.gov.gr/opendata/types.json
const DEFAULT_DECISION_TYPES = ['Γ.3.1'];
const DEFAULT_SIZE = 50;
const MAX_SIZE = 200;
const MAX_TITLE_CHARS = 180;

// portals.yml is not a fully trusted input (it ships as a shared template), and
// these values are interpolated into a Lucene query string. Allow only the
// shapes the register actually uses so a crafted value cannot inject clauses.
function safeOrgUid(value) {
  const uid = String(value ?? '').trim();
  if (!/^[0-9]{1,20}$/.test(uid)) {
    throw new Error(`diavgeia: organizationUid must be digits, got: ${JSON.stringify(value)}`);
  }
  return uid;
}

function safeUnitUid(value) {
  const uid = String(value ?? '').trim();
  if (!/^[0-9]{1,20}$/.test(uid)) {
    throw new Error(`diavgeia: unitUid must be digits, got: ${JSON.stringify(value)}`);
  }
  return uid;
}

function safeDecisionTypeUid(value) {
  const uid = String(value ?? '').trim();
  // Decision type uids are dotted Greek-letter/number codes, e.g. "Γ.3.1".
  if (!/^[A-Za-zΑ-Ωα-ω0-9]+(\.[A-Za-zΑ-Ωα-ω0-9]+)*$/.test(uid)) {
    throw new Error(`diavgeia: decisionTypeUid has unexpected characters: ${JSON.stringify(value)}`);
  }
  return uid;
}

// "15/09/2026 03:00:00" → epoch ms. Returns undefined rather than an Invalid
// Date so an unparseable value leaves the job undated instead of poisoning it.
function parseGreekDate(value) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}):(\d{2}))?$/.exec(String(value ?? '').trim());
  if (!m) return undefined;
  const [, dd, mm, yyyy, hh = '00', mi = '00', ss = '00'] = m;
  const ms = Date.UTC(+yyyy, +mm - 1, +dd, +hh, +mi, +ss);
  return Number.isFinite(ms) ? ms : undefined;
}

// The subject of a research-centre announcement runs to ~300 characters of
// statutory boilerplate. Keep it readable in the tracker.
function compactTitle(subject, protocolNumber) {
  let text = String(subject ?? '').replace(/\s+/g, ' ').trim();
  if (text.length > MAX_TITLE_CHARS) text = `${text.slice(0, MAX_TITLE_CHARS - 1).trimEnd()}…`;
  const ref = String(protocolNumber ?? '').trim();
  return ref ? `[${ref}] ${text}` : text;
}

function buildQuery(entry) {
  const org = safeOrgUid(entry.organizationUid);
  const rawTypes = Array.isArray(entry.decisionTypeUids) && entry.decisionTypeUids.length
    ? entry.decisionTypeUids
    : DEFAULT_DECISION_TYPES;
  const types = rawTypes.map(safeDecisionTypeUid);
  const typeClause = types.map(t => `decisionTypeUid:"${t}"`).join(' OR ');
  let query = `organizationUid:"${org}" AND (${typeClause})`;

  // Optional: narrow to specific departments/institutes within the body. This is
  // the only role-adjacent filter the register offers — a research centre's IT
  // institute publishes the software roles, its chemistry institute does not.
  // Find a unit id the same way as the org id, from a decision's `unitIds`.
  if (Array.isArray(entry.unitUids) && entry.unitUids.length) {
    const unitClause = entry.unitUids.map(u => `unitUid:"${safeUnitUid(u)}"`).join(' OR ');
    query += ` AND (${unitClause})`;
  }

  return query;
}

/** @type {Provider} */
export default {
  id: 'diavgeia',

  detect(entry) {
    if (entry?.provider === 'diavgeia') return { url: SEARCH_URL };
    const url = String(entry?.careers_url || '');
    return /^https?:\/\/(www\.)?diavgeia\.gov\.gr\//i.test(url) ? { url: SEARCH_URL } : null;
  },

  /**
   * @param {{ name?: string, organizationUid?: string|number, decisionTypeUids?: string[], unitUids?: Array<string|number>, size?: number }} entry
   * @param {{ fetchJson: (url: string, opts?: { redirect?: 'error'|'follow'|'manual' }) => Promise<any> }} ctx
   * @returns {Promise<Array<{title: string, url: string, company: string, location: string, postedAt?: number}>>}
   */
  async fetch(entry, ctx) {
    const size = Math.min(Math.max(Number(entry.size) || DEFAULT_SIZE, 1), MAX_SIZE);
    const params = new URLSearchParams({
      page: '0',
      size: String(size),
      sort: 'recent',
      q: buildQuery(entry),
    });

    // redirect:'error' prevents SSRF via server-side redirects
    const json = await ctx.fetchJson(`${SEARCH_URL}?${params}`, { redirect: 'error' });
    if (!json || !Array.isArray(json.decisions)) {
      throw new Error(`diavgeia: unexpected API response — expected { decisions: [...] }, got keys: [${json ? Object.keys(json).join(', ') : 'null'}]`);
    }

    return json.decisions
      .filter(d => d && typeof d === 'object' && d.subject && d.ada)
      .map(d => {
        const job = {
          title: compactTitle(d.subject, d.protocolNumber),
          // documentUrl is the permalink; rebuild it from the ADA when absent.
          url: String(d.documentUrl || `https://diavgeia.gov.gr/doc/${encodeURIComponent(d.ada)}`),
          company: String(entry.name || d.organization?.label || 'Diavgeia').trim(),
          // The register carries no work location — the posting body's own site does.
          location: '',
        };
        const postedAt = parseGreekDate(d.publishTimestamp) ?? parseGreekDate(d.issueDate);
        if (postedAt !== undefined) job.postedAt = postedAt;
        return job;
      })
      .filter(j => j.title && /^https?:\/\//i.test(j.url));
  },
};
