// tests/providers/inhire.test.mjs
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — inhire');

const check = (cond, msg) => (cond ? pass(msg) : fail(msg));

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/inhire.mjs')).href);
  const inhire = mod.default;

  check(inhire.id === 'inhire', 'inhire.id is "inhire"');

  check(inhire.detect({ name: 'CA', careers_url: 'https://contaazul.inhire.app/vagas' })?.url === 'https://api.inhire.app/job-posts/public/pages', 'detect() claims <tenant>.inhire.app');
  for (const [label, url] of [
    ['wrong host', 'https://example.com/careers'],
    ['http scheme', 'http://contaazul.inhire.app/'],
    ['lookalike host', 'https://evil-inhire.app/'],
    ['lookalike suffix', 'https://contaazul.inhire.app.evil.com/'],
    ['host in path', 'https://evil.example/contaazul.inhire.app'],
    ['api host (not a tenant)', 'https://api.inhire.app/'],
    ['bare apex', 'https://inhire.app/'],
    ['null', null],
  ]) {
    check(inhire.detect({ name: 'X', careers_url: url }) === null, `detect() rejects ${label}`);
  }

  check(mod.slugify('Consultor(a) Sênior') === 'consultor-a-senior', 'slugify transliterates accents');
  check(mod.slugify('!!!') === 'vaga', 'slugify falls back to "vaga" (control: normal title is not the fallback)');

  const sample = {
    tenantName: 'Conta Azul',
    jobsPage: [
      { jobId: '1d94d33c-84a5-4ef0-aa2e-ec08178c938e', displayName: ' Analista de Onboarding | Customer Success', status: 'published', workplaceType: 'Hybrid', location: 'Joinville, SC, BR' },
      { jobId: 'aaaa1111-0000', displayName: 'Dev', status: 'published', workplaceType: 'Remote', location: 'Brasil' },
      { jobId: 'bbbb2222-0000', displayName: 'Closed', status: 'closed', location: 'X' },
      { jobId: '', displayName: 'No id' },
      { jobId: 'cccc3333-0000', displayName: '  ' },
      { jobId: '../evil', displayName: 'Path trick' },
    ],
  };
  const jobs = mod.parseInhireResponse(sample, 'contaazul', 'Conta Azul');
  check(jobs.map(j => j.url).join() === 'https://contaazul.inhire.app/vagas/1d94d33c-84a5-4ef0-aa2e-ec08178c938e/analista-de-onboarding-customer-success,https://contaazul.inhire.app/vagas/aaaa1111-0000/dev', 'parse keeps only published rows with valid id + title (identity of urls)');
  check(jobs[0].location === 'Joinville, SC, BR' && jobs[1].location === 'Brasil, Remote', 'Remote workplaceType appended (control: Hybrid is not)');
  check(mod.parseInhireResponse(sample, 'x', '').every(j => j.company === 'Conta Azul'), 'falls back to tenantName when entry.name is empty');
  check(mod.parseInhireResponse({}, 'x', 'X').length === 0, 'malformed payload → []');

  const calls = [];
  const ctx = { fetchJson: async (url, opts) => { calls.push({ url, opts }); return sample; } };
  const got = await inhire.fetch({ name: 'CA', careers_url: 'https://contaazul.inhire.app/vagas' }, ctx);
  check(calls.length === 1 && calls[0].url === 'https://api.inhire.app/job-posts/public/pages', 'fetch() calls the fixed API host');
  check(calls[0].opts?.redirect === 'error' && calls[0].opts?.headers?.['X-Tenant'] === 'contaazul', 'fetch() sends redirect:error and X-Tenant: <tenant>');
  check(got.length === 2 && got[0].company === 'CA', 'fetch() returns parsed jobs');

  let threw = false;
  const before = calls.length;
  try {
    await inhire.fetch({ name: 'Evil', careers_url: 'https://evil.example/' }, ctx);
  } catch {
    threw = true;
  }
  check(threw && calls.length === before, 'fetch() rejects hostile careers_url without any request');
} catch (e) {
  fail(`inhire provider tests crashed: ${e.message}`);
}
