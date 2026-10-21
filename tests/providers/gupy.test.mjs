// tests/providers/gupy.test.mjs
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — gupy');

const check = (cond, msg) => (cond ? pass(msg) : fail(msg));

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/gupy.mjs')).href);
  const gupy = mod.default;

  check(gupy.id === 'gupy', 'gupy.id is "gupy"');

  // detect: positive (+ control: different path still claims, same board)
  const hit = gupy.detect({ name: 'Caju', careers_url: 'https://caju.gupy.io/' });
  check(hit?.url === 'https://private-api.gupy.io/job-publication/public/jobs?subdomain=caju', 'detect() resolves <board>.gupy.io → list API url');
  check(gupy.detect({ name: 'Caju', careers_url: 'https://caju.gupy.io/jobs/123' })?.url === hit?.url, 'detect() ignores the path');

  // detect: negatives
  for (const [label, url] of [
    ['wrong host', 'https://example.com/careers'],
    ['http scheme', 'http://caju.gupy.io/'],
    ['lookalike host', 'https://evil-gupy.io/'],
    ['lookalike suffix', 'https://caju.gupy.io.evil.com/'],
    ['host in path', 'https://evil.example/caju.gupy.io'],
    ['vendor subdomain', 'https://private-api.gupy.io/'],
    ['bare apex', 'https://gupy.io/'],
    ['null', null],
  ]) {
    check(gupy.detect({ name: 'X', careers_url: url }) === null, `detect() rejects ${label}`);
  }

  // parser — real payload shape (trimmed)
  const sample = {
    data: [
      { id: 12691526, name: 'Pessoa Desenvolvedora FrontEnd Sênior', addressCity: '', addressStateShortName: '', addressCountry: 'Brasil', remoteWorking: true, workplaceType: 'remote' },
      { id: 22, name: ' Analista ', addressCity: 'São Paulo', addressStateShortName: 'SP', addressCountry: 'Brasil', remoteWorking: false, workplaceType: 'on-site' },
      { id: 0, name: 'No id' },
      { id: 33, name: '   ' },
      { name: 'Missing id' },
      null,
    ],
  };
  const jobs = mod.parseGupyResponse(sample, 'caju', 'Caju');
  check(jobs.map(j => j.url).join() === 'https://caju.gupy.io/jobs/12691526,https://caju.gupy.io/jobs/22', 'parse keeps only rows with id + title (identity of urls)');
  check(jobs[0].location === 'Brasil, Remote', 'remote row: location gets "Remote" suffix');
  check(jobs[1].location === 'São Paulo, SP, Brasil' && jobs[1].title === 'Analista', 'on-site row: city/state/country joined, title trimmed (control: no Remote)');
  check(!('description' in jobs[0]) && !('postedAt' in jobs[0]) && !('salary' in jobs[0]), 'list-only fields: no description/postedAt/salary');
  check(mod.parseGupyResponse({}, 'x', 'X').length === 0 && mod.parseGupyResponse({ data: null }, 'x', 'X').length === 0, 'malformed payload → []');

  // fetch
  const calls = [];
  const ctx = { fetchJson: async (url, opts) => { calls.push({ url, opts }); return sample; } };
  const got = await gupy.fetch({ name: 'Caju', careers_url: 'https://caju.gupy.io/' }, ctx);
  check(calls.length === 1 && calls[0].url === hit.url && calls[0].opts?.redirect === 'error', 'fetch() hits the list API once with redirect:error');
  check(got.length === 2 && got[0].company === 'Caju', 'fetch() returns parsed jobs with entry.name as company');

  // SSRF
  let threw = false;
  const before = calls.length;
  try {
    await gupy.fetch({ name: 'Evil', careers_url: 'https://evil.example/x.gupy.io' }, ctx);
  } catch {
    threw = true;
  }
  check(threw && calls.length === before, 'fetch() rejects hostile careers_url without any request');
} catch (e) {
  fail(`gupy provider tests crashed: ${e.message}`);
}
