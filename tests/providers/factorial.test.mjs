// tests/providers/factorial.test.mjs
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — factorial');

const check = (cond, msg) => (cond ? pass(msg) : fail(msg));

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/factorial.mjs')).href);
  const factorial = mod.default;

  check(factorial.id === 'factorial', 'factorial.id is "factorial"');

  // detect: positives across both base domains / TLD shapes
  for (const host of ['muffin.factorial.it', 'highbras.factorialhr.com.br', '4farma.factorialhr.pt', 'acme.factorialhr.com']) {
    check(factorial.detect({ name: 'X', careers_url: `https://${host}/` })?.url === `https://${host}/`, `detect() claims ${host}`);
  }
  for (const [label, url] of [
    ['wrong host', 'https://example.com/careers'],
    ['http scheme', 'http://muffin.factorial.it/'],
    ['lookalike host', 'https://evil-factorial.it/'],
    ['lookalike subdomain', 'https://muffin.evil-factorial.it/'],
    ['lookalike suffix', 'https://muffin.factorial.it.evil.com/'],
    ['unknown TLD', 'https://muffin.factorial.xyz/'],
    ['host in path', 'https://evil.example/muffin.factorial.it'],
    ['vendor app host', 'https://app.factorialhr.com/'],
    ['bare apex', 'https://factorialhr.com/'],
    ['non-string', 7],
  ]) {
    check(factorial.detect({ name: 'X', careers_url: url }) === null, `detect() rejects ${label}`);
  }

  const H = 'muffin.factorial.it';
  const li = (url, title, remote = 'false') => `<li class='job-offer-item w-full' data-action='click-&gt;x' data-contract-type='indefinite' data-controller='job-postings' data-is-remote='${remote}' data-job-postings-url='${url}' data-location-id='1' role='button'>
<div class='mb-4'><span class='md:w-3/6'><div class="text-sm font-bold factorial__headingFontFamily">${title}
</div></span><div class='flex-grow'><div class="text-sm text-gray-350">SALES (S)</div></div>
<a class='font-bold' href='${url}'>Apply</a></div></li>`;
  const html = [
    li(`https://${H}/job_posting/partnership-success-manager-305055`, 'Partnership Success Manager'),
    li(`https://${H}/job_posting/business-consultant-287662`, 'Business &amp; Consultant', 'true'),
    li(`https://${H}/job_posting/partnership-success-manager-305055`, 'Duplicate under another team'),
    li(`https://${H}/job_posting/no-id-here`, 'No Id'),
    li(`https://evil.example/job_posting/trap-111`, 'Foreign host'),
    li(`http://${H}/job_posting/insecure-222`, 'Insecure'),
    li(`https://${H}/apply`, 'Candidatura espontanea'),
  ].join('\n');

  const jobs = mod.parseFactorialListing(html, H, 'Muffin');
  check(jobs.map(j => j.url).join() === `https://${H}/job_posting/partnership-success-manager-305055,https://${H}/job_posting/business-consultant-287662`, 'parse keeps valid unique /job_posting/<slug>-<id> rows (identity of urls)');
  check(jobs[0].title === 'Partnership Success Manager' && jobs[1].title === 'Business & Consultant', 'titles trimmed and entity-decoded; first occurrence wins on duplicate');
  check(jobs[0].location === '' && jobs[1].location === 'Remote', 'data-is-remote=true → "Remote" (control: false → empty)');
  check(jobs[0].company === 'Muffin', 'company = entry name');
  check(mod.parseFactorialListing('<html>no list</html>', H, 'M').length === 0, 'no list items → []');

  const calls = [];
  const ctx = { fetchText: async (url, o) => { calls.push({ url, o }); return html; } };
  const got = await factorial.fetch({ name: 'Muffin', careers_url: `https://${H}/` }, ctx);
  check(calls.length === 1 && calls[0].url === `https://${H}/` && calls[0].o?.redirect === 'error', 'fetch() requests the careers root once with redirect:error');
  check(got.length === 2, 'fetch() returns parsed jobs');

  let threw = false;
  const before = calls.length;
  try {
    await factorial.fetch({ name: 'Evil', careers_url: 'https://evil.example/' }, ctx);
  } catch {
    threw = true;
  }
  check(threw && calls.length === before, 'fetch() rejects hostile careers_url without any request');
} catch (e) {
  fail(`factorial provider tests crashed: ${e.message}`);
}
