// tests/providers/deel.test.mjs
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — deel');

const check = (cond, msg, detail = '') => (cond ? pass(msg) : fail(`${msg}${detail ? ` — ${detail}` : ''}`));

/** Wrap a flight string into a Next.js page, split into several push chunks (as the real page does). */
function page(flight, chunks = 3) {
  const size = Math.ceil(flight.length / chunks);
  let html = '<html><body><script>self.__next_f.push([0])</script>';
  for (let i = 0; i < flight.length; i += size) html += `<script>self.__next_f.push([1,${JSON.stringify(flight.slice(i, i + size))}])</script>`;
  return `${html}</body></html>`;
}

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/deel.mjs')).href);
  const deel = mod.default;
  const { parseDeelBoard, bracketSlice, decodeNextFlight } = mod;

  check(deel.id === 'deel', 'deel.id is "deel"', JSON.stringify(deel.id));

  const hit = deel.detect({ name: 'Klarna', careers_url: 'https://jobs.deel.com/klarna' });
  check(hit?.url === 'https://jobs.deel.com/klarna', 'detect() resolves jobs.deel.com/<org>', JSON.stringify(hit));
  check(deel.detect({ name: 'K', careers_url: 'https://jobs.deel.com/klarna/job-details/abc/overview' })?.url === 'https://jobs.deel.com/klarna',
    'detect() reduces a job-details URL to the org board');
  const neg = {
    'wrong host': 'https://example.com/klarna',
    'http scheme': 'http://jobs.deel.com/klarna',
    'lookalike evil-jobs.deel.com': 'https://evil-jobs.deel.com/klarna',
    'lookalike jobs.deel.com.evil.com': 'https://jobs.deel.com.evil.com/klarna',
    'sibling host www.deel.com': 'https://www.deel.com/klarna',
    'host in path': 'https://evil.example/jobs.deel.com/klarna',
    'no org segment': 'https://jobs.deel.com/',
    'bad org chars': 'https://jobs.deel.com/a%20b',
  };
  for (const [label, u] of Object.entries(neg)) {
    check(deel.detect({ name: 'X', careers_url: u }) === null, `detect() rejects ${label}`, JSON.stringify(deel.detect({ name: 'X', careers_url: u })));
  }
  check(deel.detect({ name: 'X', careers_url: null }) === null && deel.detect({ name: 'X', careers_url: 7 }) === null, 'detect() tolerates non-string careers_url');

  // bracketSlice — brackets and escaped quotes inside string values must not unbalance the scan
  const tricky = 'x"a":[{"t":"[EMEA] \\"Eng\\" ]"},{"t":"b"}],"b":1';
  check(bracketSlice(tricky, '"a":', '[', ']') === '[{"t":"[EMEA] \\"Eng\\" ]"},{"t":"b"}]', 'bracketSlice ignores brackets inside JSON strings', bracketSlice(tricky, '"a":', '[', ']'));
  check(bracketSlice('nothing', '"a":', '[', ']') === null && bracketSlice('"a":[1,2', '"a":', '[', ']') === null, 'bracketSlice: missing key / unbalanced → null');

  // Board page in the live shape (trimmed): jobPostings with "$N" description refs, careerPageSettings
  const posting = (id, title, extra = {}) => ({
    id, jobId: `job-${id}`, title, richtextDescription: '$1a', createdAt: '2026-10-13T09:48:15.992Z',
    job: { workArrangementEnum: 'HYBRID', jobLocations: [{ location: { name: 'London' } }, { location: { name: 'Stockholm' } }], currentCompensation: { currencyIsoCode: 'GBP', minAmount: 71559, maxAmount: 80147 } },
    ...extra,
  });
  const postings = [
    posting('ac7a2eff-0b54-434b-be33-ec9adc1b247a', '[EMEA] Senior Compliance Specialist'),
    posting('21584046-56d5-44c4-8b18-7e15dc659827', 'Remote Engineer', { createdAt: 'garbage', job: { workArrangementEnum: 'REMOTE', jobLocations: [] } }),
    posting('', 'No id'),
    posting('bad id/../x', 'Unsafe id'),
    posting('3333', '   '),
  ];
  const flight = `0:["$","div",null,{}]\n1b:{"careerPageSettings":{"urlSlug":"klarna","preferredOrganizationName":"Klarna AB","title":"Make [x] matter"},"jobPostings":${JSON.stringify(postings)},"other":1}\n`;
  const html = page(flight, 4);
  check(decodeNextFlight(html) === flight, 'decodeNextFlight concatenates and decodes every chunk');

  const jobs = parseDeelBoard(html, 'klarna', 'Fallback Co');
  check(jobs.length === 2, 'parser keeps rows with a safe id and a title, drops empty-id / unsafe-id / blank-title', jobs.map((j) => j.title).join('|'));
  check(jobs[0].title === '[EMEA] Senior Compliance Specialist' && jobs[0].url === 'https://jobs.deel.com/klarna/job-details/ac7a2eff-0b54-434b-be33-ec9adc1b247a/overview'
    && jobs[0].company === 'Klarna AB' && jobs[0].location === 'London, Stockholm' && jobs[0].postedAt === Date.parse('2026-10-13T09:48:15.992Z'),
    'parser maps title (bracket-safe), url, org name, joined locations, postedAt', JSON.stringify(jobs[0]));
  check(!('salary' in jobs[0]) && !('description' in jobs[0]), 'parser omits salary (period unstated) and description');
  check(jobs[1].location === 'Remote' && !('postedAt' in jobs[1]), 'parser: REMOTE arrangement with no places → "Remote"; unparseable date → no postedAt', JSON.stringify(jobs[1]));
  const noSettings = parseDeelBoard(page(`1:{"jobPostings":${JSON.stringify([posting('p1', 'T')])}}`), 'acme', 'Fallback Co');
  check(noSettings[0].company === 'Fallback Co', 'parser falls back to the configured name when careerPageSettings is absent');
  check(parseDeelBoard(page('1:{"jobPostings":[]}'), 'acme', 'A').length === 0, 'parser: empty jobPostings array is valid → []');
  let threw = false;
  try {
    parseDeelBoard('<html>no flight here</html>', 'acme', 'A');
  } catch (e) {
    threw = /no jobPostings/.test(e.message);
  }
  check(threw, 'parser throws (not silent []) when the page has no jobPostings array — markup change must surface');

  // fetch()
  const calls = [];
  const ctx = { fetchText: async (url, opts) => { calls.push({ url, opts }); return html; } };
  const fetched = await deel.fetch({ name: 'Klarna', careers_url: 'https://jobs.deel.com/klarna' }, ctx);
  check(fetched.length === 2 && calls.length === 1 && calls[0].url === 'https://jobs.deel.com/klarna' && calls[0].opts?.redirect === 'error',
    'fetch() makes one board request with redirect:"error" and returns jobs', JSON.stringify(calls));

  // SSRF
  for (const u of ['https://evil-jobs.deel.com/klarna', 'http://jobs.deel.com/klarna', 'http://169.254.169.254/klarna', 'https://www.deel.com/klarna']) {
    let called = false;
    let rejected = false;
    try {
      await deel.fetch({ name: 'Evil', careers_url: u }, { fetchText: async () => { called = true; return ''; } });
    } catch {
      rejected = true;
    }
    check(rejected && !called, `fetch() rejects hostile careers_url ${u} without any request`);
  }
} catch (e) {
  fail(`deel provider tests crashed: ${e.message}`);
}
