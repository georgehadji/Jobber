// tests/providers/adp.test.mjs — ADP Workforce Now provider.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — adp');

const CID = '8a680274-0b2e-46cf-b2cc-49bd2ef0c20f';
const CCID = '19000101_000001';
const GOOD = `https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=${CID}&ccId=${CCID}&lang=en_US`;
const check = (cond, msg, detail = '') => (cond ? pass(msg) : fail(`${msg}${detail ? ` — ${detail}` : ''}`));

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/adp.mjs')).href);
  const adp = mod.default;
  const { parseAdpResponse } = mod;

  check(adp.id === 'adp', 'adp.id is "adp"', JSON.stringify(adp.id));

  // detect: positive (control) + negatives
  const hit = adp.detect({ name: 'Acme', careers_url: GOOD });
  check(hit?.url?.startsWith('https://workforcenow.adp.com/mascsr/default/careercenter/public/events/staffing/v1/job-requisitions?')
    && hit.url.includes(`cid=${CID}`) && hit.url.includes(`ccId=${CCID}`), 'adp.detect() resolves recruitment.html cid/ccId → list API', JSON.stringify(hit));
  const negatives = {
    'wrong host': `https://example.com/mdf/recruitment/recruitment.html?cid=${CID}&ccId=${CCID}`,
    'http scheme': GOOD.replace('https:', 'http:'),
    'lookalike host (evil-)': GOOD.replace('workforcenow.adp.com', 'evil-workforcenow.adp.com'),
    'lookalike suffix': GOOD.replace('workforcenow.adp.com', 'workforcenow.adp.com.evil.test'),
    'host in path': `https://evil.test/workforcenow.adp.com/x?cid=${CID}&ccId=${CCID}`,
    'missing ccId': `https://workforcenow.adp.com/x?cid=${CID}`,
    'hostile cid chars': `https://workforcenow.adp.com/x?cid=${encodeURIComponent('a/../b')}&ccId=${CCID}`,
  };
  for (const [label, url] of Object.entries(negatives)) {
    check(adp.detect({ name: 'X', careers_url: url }) === null, `adp.detect() rejects ${label}`);
  }
  check(adp.detect({ name: 'X', careers_url: null }) === null && adp.detect({ name: 'X', careers_url: 7 }) === null,
    'adp.detect() tolerates non-string careers_url');

  // parser — shaped like the live payload (trimmed)
  const board = { cid: CID, ccId: CCID };
  const row = (over = {}) => ({
    itemID: '9201378894087_1',
    requisitionTitle: 'GTM Engineer AI & Automation',
    postDate: '2026-10-16T18:44:00.000-04:00',
    payGradeRange: { minimumRate: { amountValue: 1200000.0, currencyCode: 'MUR' }, maximumRate: { amountValue: 1400000.0, currencyCode: 'MUR' } },
    customFieldGroup: { codeFields: [{ codeValue: 'AN', shortName: 'Annually', nameCode: { codeValue: 'SalaryType' } }] },
    requisitionLocations: [{ nameCode: { shortName: ' Cybercity 72201, Ebene, MU' } }],
    ...over,
  });
  const payload = {
    jobRequisitions: [
      row(),
      row({ itemID: '2', requisitionTitle: 'Hourly Tech', payGradeRange: row().payGradeRange, customFieldGroup: { codeFields: [{ codeValue: 'HR', nameCode: { codeValue: 'SalaryType' } }] } }),
      row({ itemID: '3', requisitionTitle: 'No Pay', payGradeRange: undefined, postDate: 'garbage' }),
      row({ itemID: '', requisitionTitle: 'No Id' }),
      row({ itemID: '5', requisitionTitle: '   ' }),
      null,
    ],
    meta: { startSequence: 0, totalNumber: 6 },
  };
  const jobs = parseAdpResponse(payload, 'Acme', board);
  check(jobs.length === 3 && jobs.map(j => j.title).join('|') === 'GTM Engineer AI & Automation|Hourly Tech|No Pay',
    'parseAdpResponse keeps valid rows, drops missing id / blank title / null (by identity)', jobs.map(j => j.title).join('|'));
  check(jobs[0].url === `https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=${CID}&ccId=${CCID}&jobId=9201378894087_1&lang=en_US`,
    'parseAdpResponse builds recruitment.html job URL', jobs[0].url);
  check(jobs[0].location === 'Cybercity 72201, Ebene, MU' && jobs[0].company === 'Acme', 'parseAdpResponse trims location, uses entry name as company');
  check(jobs[0].postedAt === Date.parse('2026-10-16T18:44:00.000-04:00'), 'parseAdpResponse maps postDate to epoch ms');
  check('postedAt' in jobs[2] === false, 'parseAdpResponse omits postedAt when postDate unparseable');
  check(jobs[0].salary && jobs[0].salary.min === 1200000 && jobs[0].salary.max === 1400000 && jobs[0].salary.currency === 'MUR',
    'parseAdpResponse emits salary when period is Annually (all three keys)', JSON.stringify(jobs[0].salary));
  check(!('salary' in jobs[1]), 'parseAdpResponse omits salary when period is not annual (control for the case above)');
  check(!('salary' in jobs[2]), 'parseAdpResponse omits salary when there is no pay range');
  check(parseAdpResponse({}, 'X', board).length === 0 && parseAdpResponse({ jobRequisitions: null }, 'X', board).length === 0, 'parseAdpResponse malformed payload → []');

  // fetch() — pagination with mock ctx
  const calls = [];
  const sleeps = [];
  const mkRows = (n, base) => Array.from({ length: n }, (_, i) => row({ itemID: `${base}${i}`, requisitionTitle: `Role ${base}${i}` }));
  const pages = { 0: { jobRequisitions: mkRows(50, 'a'), meta: { totalNumber: 120 } }, 50: { jobRequisitions: mkRows(50, 'b'), meta: { totalNumber: 120 } }, 100: { jobRequisitions: mkRows(20, 'c'), meta: { totalNumber: 120 } } };
  const ctx = {
    fetchJson: async (url, opts) => {
      calls.push({ url, opts });
      const skip = Number(new URL(url).searchParams.get('$skip'));
      return pages[skip] ?? { jobRequisitions: [] };
    },
    sleep: async ms => { sleeps.push(ms); },
  };
  const all = await adp.fetch({ name: 'Acme', careers_url: GOOD }, ctx);
  check(all.length === 120 && calls.length === 3, 'adp.fetch() pages until totalNumber reached (3 calls, 120 jobs)', `jobs=${all.length} calls=${calls.length}`);
  check(calls.every(c => c.opts?.redirect === 'error' && new URL(c.url).hostname === 'workforcenow.adp.com'), 'adp.fetch() passes redirect:error on every request to the pinned host');
  check(calls.map(c => new URL(c.url).searchParams.get('$skip')).join(',') === '0,50,100', 'adp.fetch() advances $skip by page size');
  check(sleeps.length === 2, 'adp.fetch() paces between pages via ctx.sleep (not after the last)', `sleeps=${sleeps.length}`);

  calls.length = 0;
  const capped = await adp.fetch({ name: 'Acme', careers_url: GOOD }, { ...ctx, maxPages: 1 });
  check(capped.length === 50 && calls.length === 1, 'adp.fetch() honours ctx.maxPages', `jobs=${capped.length} calls=${calls.length}`);

  // empty page terminates even when total claims more
  calls.length = 0;
  const liar = await adp.fetch({ name: 'Acme', careers_url: GOOD }, { fetchJson: async (url, o) => { calls.push(url); return calls.length === 1 ? { jobRequisitions: mkRows(2, 'z'), meta: { totalNumber: 999 } } : { jobRequisitions: [] }; } });
  check(liar.length === 2 && calls.length === 2, 'adp.fetch() stops on an empty page', `jobs=${liar.length} calls=${calls.length}`);

  // SSRF: hostile careers_url never reaches the network
  let hit2 = 0;
  const spy = { fetchJson: async () => { hit2++; return {}; } };
  let threw = '';
  try { await adp.fetch({ name: 'Evil', careers_url: GOOD.replace('workforcenow.adp.com', 'evil.test') }, spy); } catch (e) { threw = e.message; }
  check(/cannot derive/.test(threw) && hit2 === 0, 'adp.fetch() rejects hostile careers_url before any request', `threw="${threw}" hits=${hit2}`);
} catch (e) {
  fail(`adp provider tests crashed: ${e.message}`);
}
