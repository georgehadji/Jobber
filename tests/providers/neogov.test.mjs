// tests/providers/neogov.test.mjs
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — neogov');

const check = (cond, msg, detail = '') => (cond ? pass(msg) : fail(`${msg}${detail ? ` — ${detail}` : ''}`));

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/neogov.mjs')).href);
  const neogov = mod.default;
  const { parseNeogovListing, parseAnnualSalary } = mod;

  check(neogov.id === 'neogov', 'neogov.id is "neogov"', JSON.stringify(neogov.id));

  const school = neogov.detect({ name: 'Cochise', careers_url: 'https://www.schooljobs.com/careers/cochisecollege' });
  check(school?.url === 'https://www.schooljobs.com/careers/cochisecollege', 'detect() resolves schooljobs.com/careers/<agency>', JSON.stringify(school));
  const gov = neogov.detect({ name: 'LA', careers_url: 'https://governmentjobs.com/careers/lacounty/jobs/123/x' });
  check(gov?.url === 'https://www.governmentjobs.com/careers/lacounty', 'detect() resolves governmentjobs.com (www optional) and reduces a job URL to the agency', JSON.stringify(gov));
  const neg = {
    'wrong host': 'https://example.com/careers/lacounty',
    'http scheme': 'http://www.governmentjobs.com/careers/lacounty',
    'lookalike evil-governmentjobs.com': 'https://evil-governmentjobs.com/careers/lacounty',
    'lookalike governmentjobs.com.evil.com': 'https://www.governmentjobs.com.evil.com/careers/lacounty',
    'other subdomain': 'https://jobs.governmentjobs.com/careers/lacounty',
    'host in path': 'https://evil.example/www.schooljobs.com/careers/x',
    'platform landing /careers/home': 'https://www.governmentjobs.com/careers/home',
    'no agency': 'https://www.schooljobs.com/careers',
    'bad agency chars': 'https://www.schooljobs.com/careers/a%20b',
  };
  for (const [label, u] of Object.entries(neg)) {
    check(neogov.detect({ name: 'X', careers_url: u }) === null, `detect() rejects ${label}`, JSON.stringify(neogov.detect({ name: 'X', careers_url: u })));
  }
  check(neogov.detect({ name: 'X', careers_url: null }) === null && neogov.detect({ name: 'X', careers_url: 7 }) === null, 'detect() tolerates non-string careers_url');

  // parseAnnualSalary — only an explicit "Annually" period is returned
  const s1 = parseAnnualSalary('Full-time - $50,585.60 - $57,657.60 Annually');
  check(s1?.min === 50585.6 && s1?.max === 57657.6 && s1?.currency === 'USD', 'parseAnnualSalary: range + Annually → annual USD bounds', JSON.stringify(s1));
  const s2 = parseAnnualSalary('Full time - $84,000 Annually');
  check(s2?.min === 84000 && s2?.max === null && 'max' in s2 && 'currency' in s2, 'parseAnnualSalary: single figure → max null (never 0), all three keys present', JSON.stringify(s2));
  check(parseAnnualSalary('Part-time - $22.50 - $30.00 Hourly') === undefined && parseAnnualSalary('Full-time - $5,000 Monthly') === undefined && parseAnnualSalary('Full-time') === undefined,
    'parseAnnualSalary: hourly / monthly / no figure → undefined (never a raw non-annual rate)');

  // Parser — trimmed shape of the real XHR partial
  const card = (id, href, title, metaLis, entry) =>
    `<li class="list-item" data-job-id="${id}"><h3 class="job-item-link-container">` +
    `<a aria-label="x Link will be opened in a flyout." class="item-details-link" data-department-name="D" href="${href}" rel="">${title}</a></h3>` +
    `<ul class="list-meta">${metaLis.map((m) => `<li>${m}</li>`).join('')}</ul>` +
    `<div class="list-entry">${entry}</div><div class="list-published"><span>Posted more than 30 days ago</span></div></li>`;
  const fragment = '<span id="job-postings-number">\n 26 </span><ul>' +
    card('5408589', '/careers/cochisecollege/jobs/5408589/ft-credentials-evaluator', 'FT Credentials Evaluator',
      ['Sierra Vista Campus, AZ', 'Full-time <span>-</span> $50,585.60 - $57,657.60 Annually', 'Category: Student Services', 'Division: FT--Student Services'],
      'Position Summary: evaluates &amp; processes transcripts&#160;...') +
    card('5182001', '/careers/lacounty/jobs/5182001/accountant-i', 'ACCOUNTANT I', ['Temporary - $64,628.88 - $74,012.88 Annually', 'Category: Accounting', 'Department: MENTAL HEALTH'], '') +
    card('777', '/careers/cochisecollege/jobs/777/hourly', 'Hourly Aide', ['Phoenix, AZ', 'Part-time - $20.00 Hourly'], 'x') +
    '<li class="list-item" data-job-id="999"><p>No results placeholder</p></li>' +
    card('888', '//evil.example/steal', 'Hostile href', ['X'], 'x') +
    card('889', 'https://evil.example/careers/x/jobs/1/y', 'Absolute off-host href', ['X'], 'x') +
    card('890', '/careers/cochisecollege/jobs/890/blank', '   ', ['X'], 'x') +
    '</ul>';
  const { jobs, total } = parseNeogovListing(fragment, 'schooljobs.com', 'Cochise');
  check(total === 26, 'parser reads the open-postings total', String(total));
  check(jobs.length === 3, 'parser keeps cards with an id, safe /careers/<agency>/jobs/<id> href and title; drops placeholder / hostile / blank', jobs.map((j) => j.title).join('|'));
  check(jobs[0].title === 'FT Credentials Evaluator' && jobs[0].url === 'https://www.schooljobs.com/careers/cochisecollege/jobs/5408589/ft-credentials-evaluator' && jobs[0].company === 'Cochise'
    && jobs[0].location === 'Sierra Vista Campus, AZ' && jobs[0].description === 'Position Summary: evaluates & processes transcripts ...' && jobs[0].salary?.max === 57657.6,
    'parser maps title, url, company, location, description (entities decoded), annual salary', JSON.stringify(jobs[0]));
  check(jobs[1].location === '' && jobs[1].salary?.min === 64628.88 && !('description' in jobs[1]),
    'parser: no real location line (employment/salary/category lines skipped) → ""; empty snippet → no description', JSON.stringify(jobs[1]));
  check(jobs[2].location === 'Phoenix, AZ' && !('salary' in jobs[2]), 'parser: hourly pay → salary omitted entirely', JSON.stringify(jobs[2]));
  check(parseNeogovListing('', 'schooljobs.com', 'A').jobs.length === 0 && parseNeogovListing('<html>SPA shell</html>', 'schooljobs.com', 'A').total === null, 'parser: empty input / SPA shell → no jobs, null total');

  // fetch() — paged XHR partial; needs X-Requested-With on every request
  const pages = {
    1: '<span id="job-postings-number">3</span>' + card('1', '/careers/acme/jobs/1/a', 'One', ['Town'], 'x') + card('2', '/careers/acme/jobs/2/b', 'Two', ['Town'], 'x'),
    2: '<span id="job-postings-number">3</span>' + card('3', '/careers/acme/jobs/3/c', 'Three', ['Town'], 'x'),
    3: card('4', '/careers/acme/jobs/4/d', 'Never requested', ['Town'], 'x'),
  };
  const calls = [];
  const ctx = {
    sleep: async () => {},
    fetchText: async (url, opts) => { calls.push({ url, opts }); return pages[new URL(url).searchParams.get('page')] ?? ''; },
  };
  const entry = { name: 'Acme', careers_url: 'https://www.governmentjobs.com/careers/acme' };
  const got = await neogov.fetch(entry, ctx);
  check(got.map((j) => j.title).join('|') === 'One|Two|Three', 'fetch() accumulates pages', got.map((j) => j.title).join('|'));
  check(calls.length === 2 && calls[0].url === 'https://www.governmentjobs.com/careers/home/index?agency=acme&sort=PositionTitle&isDescendingSort=false&page=1',
    'fetch() requests the careers/home/index XHR partial and stops at the stated total (page 3 never requested)', calls.map((c) => c.url).join(' '));
  check(calls.every((c) => c.opts?.redirect === 'error' && c.opts?.headers?.['X-Requested-With'] === 'XMLHttpRequest'), 'fetch() sends redirect:"error" and X-Requested-With on every request');
  calls.length = 0;
  await neogov.fetch(entry, { ...ctx, maxPages: 1 });
  check(calls.length === 1, 'fetch() honours ctx.maxPages = 1', `${calls.length} requests`);
  calls.length = 0;
  const loop = await neogov.fetch(entry, { ...ctx, fetchText: async (url) => { calls.push(url); return card('1', '/careers/acme/jobs/1/a', 'Same', ['T'], 'x'); } });
  check(loop.length === 1 && calls.length === 2, 'fetch() stops when a page adds nothing new', `${loop.length} jobs, ${calls.length} requests`);

  // SSRF
  for (const u of ['https://evil-governmentjobs.com/careers/acme', 'http://www.schooljobs.com/careers/acme', 'http://169.254.169.254/careers/acme', 'https://www.governmentjobs.com/careers/home']) {
    let called = false;
    let rejected = false;
    try {
      await neogov.fetch({ name: 'Evil', careers_url: u }, { fetchText: async () => { called = true; return ''; } });
    } catch {
      rejected = true;
    }
    check(rejected && !called, `fetch() rejects hostile careers_url ${u} without any request`);
  }
} catch (e) {
  fail(`neogov provider tests crashed: ${e.message}`);
}
