// tests/providers/recruiterflow.test.mjs
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — recruiterflow');

const check = (cond, msg) => (cond ? pass(msg) : fail(msg));

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/recruiterflow.mjs')).href);
  const rf = mod.default;

  check(rf.id === 'recruiterflow', 'recruiterflow.id is "recruiterflow"');

  check(rf.detect({ name: 'R', careers_url: 'https://recruiterflow.com/radhires/jobs' })?.url === 'https://recruiterflow.com/radhires/jobs', 'detect() claims recruiterflow.com/<board>/jobs');
  check(rf.detect({ name: 'R', careers_url: 'https://recruiterflow.com/radhires/jobs/441' })?.url === 'https://recruiterflow.com/radhires/jobs', 'detect() maps a posting URL back to the board');
  for (const [label, url] of [
    ['wrong host', 'https://example.com/radhires/jobs'],
    ['http scheme', 'http://recruiterflow.com/radhires/jobs'],
    ['lookalike host', 'https://evil-recruiterflow.com/radhires/jobs'],
    ['lookalike suffix', 'https://recruiterflow.com.evil.com/radhires/jobs'],
    ['host in path', 'https://evil.example/recruiterflow.com/radhires/jobs'],
    ['vendor page without /jobs', 'https://recruiterflow.com/pricing'],
    ['board only', 'https://recruiterflow.com/radhires'],
    ['bad board chars', 'https://recruiterflow.com/rad%20hires/jobs'],
    ['non-string', null],
  ]) {
    check(rf.detect({ name: 'X', careers_url: url }) === null, `detect() rejects ${label}`);
  }

  // balanced extractor must ignore braces inside strings and escaped quotes
  const lit = mod.extractJsObject('x; window.jobsList = {"a": "}{\\"", "b": {"c": 1}}; other = {"z":1};', 'window.jobsList');
  check(lit === '{"a": "}{\\"", "b": {"c": 1}}', `extractJsObject is string/escape aware (got ${lit})`);
  check(mod.extractJsObject('nothing here', 'window.jobsList') === null, 'extractJsObject → null when marker absent');

  const list = {
    department: [
      ['Administration', [
        { apply_link: 'radhires/jobs/441', details: 'LATAM - Buenos Aires', employment_type: 'Part time', job_id: 441, job_name: 'Bilingual Admin Assistant', last_opened: '2026-10-16T16:03:57+0000', remote_type: 'Remote' },
        { apply_link: 'radhires/jobs/436', details: 'Remote - Philippines', job_id: 436, job_name: 'Executive Assistant', last_opened: 'garbage', remote_type: 'Remote' },
      ]],
      ['Engineering', [
        { apply_link: 'radhires/jobs/500', details: 'Austin, TX', job_id: 500, job_name: 'Engineer', last_opened: '2026-10-01T00:00:00+0000', remote_type: 'On-site' },
        { apply_link: 'radhires/jobs/441', details: 'dup', job_id: 441, job_name: 'Dup of 441' },
        { apply_link: 'https://evil.example/x/jobs/1', job_id: 1, job_name: 'Absolute link' },
        { apply_link: '../../evil', job_id: 2, job_name: 'Traversal' },
        { apply_link: 'radhires/jobs/9', job_id: 9, job_name: '  ' },
      ]],
    ],
  };
  const html = `<html><script>var x = 1;\nwindow.jobsList = ${JSON.stringify(list)};\nfoo();</script></html>`;
  const jobs = mod.parseRecruiterflowPage(html, 'radhires', 'RadHires');
  check(jobs.map(j => j.url.split('/').pop()).join() === '441,436,500', 'parse flattens departments, drops dup/absolute/traversal/blank-title rows (ids 441,436,500)');
  check(jobs[0].url === 'https://recruiterflow.com/radhires/jobs/441' && jobs[0].company === 'RadHires', 'url is origin + apply_link; company = entry name');
  check(jobs[0].location === 'LATAM - Buenos Aires, Remote' && jobs[1].location === 'Remote - Philippines' && jobs[2].location === 'Austin, TX', 'Remote appended unless already present; On-site is not (control)');
  check(jobs[0].postedAt === Date.parse('2026-10-16T16:03:57+00:00') && !('postedAt' in jobs[1]), 'postedAt parsed from last_opened; garbage → omitted');

  let threw = false;
  try {
    mod.parseRecruiterflowPage('<html>no list</html>', 'radhires', 'R');
  } catch (e) {
    threw = /no window\.jobsList/.test(e.message);
  }
  check(threw, 'missing jobsList throws (a broken board must not look empty)');
  check(mod.parseRecruiterflowPage('window.jobsList = {"department": []};', 'b', 'B').length === 0, 'empty department list → [] (control: present but empty is not an error)');

  const calls = [];
  const ctx = { fetchText: async (url, o) => { calls.push({ url, o }); return html; } };
  const got = await rf.fetch({ name: 'RadHires', careers_url: 'https://recruiterflow.com/radhires/jobs' }, ctx);
  check(calls.length === 1 && calls[0].url === 'https://recruiterflow.com/radhires/jobs' && calls[0].o?.redirect === 'error', 'fetch() requests the board page once with redirect:error');
  check(got.length === 3, 'fetch() returns parsed jobs');

  threw = false;
  const before = calls.length;
  try {
    await rf.fetch({ name: 'Evil', careers_url: 'https://evil.example/radhires/jobs' }, ctx);
  } catch {
    threw = true;
  }
  check(threw && calls.length === before, 'fetch() rejects hostile careers_url without any request');
} catch (e) {
  fail(`recruiterflow provider tests crashed: ${e.message}`);
}
