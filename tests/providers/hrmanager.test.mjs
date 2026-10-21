// tests/providers/hrmanager.test.mjs — fixture shaped like live api.hr-manager.net energinet positionlist (2026-10-21), trimmed.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — hrmanager');
const ok = (c, m) => (c ? pass(m) : fail(m));

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/hrmanager.mjs')).href);
  const p = mod.default;
  ok(p.id === 'hrmanager', 'hrmanager.id is "hrmanager"');

  const API = 'https://api.hr-manager.net/jobportal.svc/energinet/positionlist/json/?incads=1&take=1000';
  ok(p.detect({ name: 'E', careers_url: 'https://candidate.hr-manager.net/vacancies/list.aspx?customer=energinet' })?.url === API, 'detect() vacancies list URL (customer=alias)');
  ok(p.detect({ name: 'E', careers_url: 'https://api.hr-manager.net/JobPortal.svc/energinet/PositionList/json/' })?.url === API, 'detect() api JobPortal.svc URL (case-insensitive path)');
  ok(p.detect({ name: 'E', provider: 'hrmanager', board: 'energinet' })?.url === API, 'detect() honours explicit provider + board');
  ok(p.detect({ name: 'E', board: 'energinet' }) === null, 'detect() ignores board without explicit provider (control)');
  ok(p.detect({ name: 'E', provider: 'hrmanager', board: '../x' }) === null, 'detect() rejects malformed explicit board');
  ok(p.detect({ name: 'E', careers_url: 'https://candidate.hr-manager.net/ApplicationInit.aspx?cid=316&ProjectId=1' }) === null, 'detect() null for posting URL (numeric cid is not an alias)');
  ok(p.detect({ name: 'E', careers_url: 'https://candidate.hr-manager.net/vacancies/list.aspx?customer=316' }) === null, 'detect() null for all-digit customer');
  ok(p.detect({ name: 'E', careers_url: 'http://candidate.hr-manager.net/vacancies/list.aspx?customer=energinet' }) === null, 'detect() rejects http');
  ok(p.detect({ name: 'E', careers_url: 'https://evil-hr-manager.net/vacancies/list.aspx?customer=energinet' }) === null, 'detect() rejects lookalike host');
  ok(p.detect({ name: 'E', careers_url: 'https://candidate.hr-manager.net.evil.example/vacancies/list.aspx?customer=energinet' }) === null, 'detect() rejects suffix-spoofed host');
  ok(p.detect({ name: 'E', careers_url: 'https://evil.example/x?customer=energinet&h=candidate.hr-manager.net' }) === null, 'detect() rejects query-spoofed URL');

  ok(mod.parseDotNetDate('/Date(1791377991000+0200)/') === 1791377991000, 'parseDotNetDate reads epoch ms');
  ok(mod.parseDotNetDate('/Date(-62135596800000)/') === null && mod.parseDotNetDate('/Date(0)/') === null && mod.parseDotNetDate('nope') === null, 'parseDotNetDate: MinValue / zero / garbage -> null');

  const okStatus = { Description: 'The operation completed successfully.', StatusCode: 0 };
  const sample = {
    CustomerAlias: 'energinet', TransactionStatus: okStatus, PositionCountSearch: 5, PositionCountList: 5,
    Items: [
      {
        Id: 188952, Name: '  Administrerende   direktør ', ProjectType: 'RecruitmentProject',
        AdvertisementUrl: 'https://candidate.hr-manager.net/ApplicationInit.aspx?cid=316&ProjectId=188952&DepartmentId=9728&MediaId=5',
        Published: '/Date(1791377991000+0200)/', Created: '/Date(1791275444000+0200)/', WorkPlace: 'Fredericia / Ballerup',
        PositionLocationMultiSelection: [{ Name: 'Fredericia' }, { Name: 'Ballerup' }], Department: { City: 'Fredericia' },
        Advertisements: [{ Introduction: '<p>Intro</p>', Content: '<p>Build &amp; run</p>' }],
      },
      { Id: 2, Name: 'No workplace', AdvertisementUrl: 'https://candidate.hr-manager.net/ApplicationInit.aspx?cid=316&ProjectId=2', Published: '/Date(0)/', Created: '/Date(1791275444000+0200)/', PositionLocationMultiSelection: [{ Name: 'Aarhus' }, { Name: 'Odense' }], Advertisements: [] },
      { Id: 3, Name: 'City only', AdvertisementUrl: 'https://candidate.hr-manager.net/ApplicationInit.aspx?cid=316&ProjectId=3', Department: { City: 'Viborg' } },
      { Id: 4, Name: 'Open application', ProjectType: 'OpenApplication', AdvertisementUrl: 'https://candidate.hr-manager.net/ApplicationInit.aspx?cid=316&ProjectId=4' },
      { Id: 5, Name: 'Evil host', AdvertisementUrl: 'https://evil.example/ApplicationInit.aspx?cid=316' },
      { Id: 6, Name: 'http only', AdvertisementUrl: 'http://candidate.hr-manager.net/x' },
      { Id: 0, Name: 'Zero id', AdvertisementUrl: 'https://candidate.hr-manager.net/x' },
      { Id: 7, Name: ' ', AdvertisementUrl: 'https://candidate.hr-manager.net/x' },
    ],
  };
  const jobs = mod.parseHrManagerList(sample, 'energinet', 'Energinet');
  ok(jobs.length === 3, `parseHrManagerList keeps 3 valid rows (got ${jobs.length})`);
  ok(jobs[0].title === 'Administrerende direktør', 'title whitespace normalised');
  ok(jobs[0].url.startsWith('https://candidate.hr-manager.net/ApplicationInit.aspx?cid=316&ProjectId=188952'), 'url is the AdvertisementUrl');
  ok(jobs[0].location === 'Fredericia / Ballerup' && jobs[0].company === 'Energinet', 'WorkPlace wins for location; company set');
  ok(jobs[0].description === 'Intro\nBuild & run', `description = introduction + content, stripped (got ${JSON.stringify(jobs[0].description)})`);
  ok(jobs[0].postedAt === 1791377991000, 'postedAt from Published');
  ok(jobs[1].location === 'Aarhus; Odense' && jobs[1].postedAt === 1791275444000 && !('description' in jobs[1]), 'location from picklist; postedAt falls back to Created; empty ad -> no description');
  ok(jobs[2].location === 'Viborg' && !('postedAt' in jobs[2]), 'location falls back to department city; no date -> omitted');
  ok(!jobs.some(j => /Open application|Evil host|http only|Zero id/.test(j.title)), 'OpenApplication / off-host / http / zero-id rows dropped');

  const throws = (fn) => { try { fn(); return ''; } catch (e) { return e.message; } };
  ok(/status 1/.test(throws(() => mod.parseHrManagerList({ TransactionStatus: { StatusCode: 1, Description: 'Value cannot be null' }, Items: [] }, 'x', 'X'))), 'API error status throws (not an empty board)');
  ok(/names customer/.test(throws(() => mod.parseHrManagerList({ ...sample, CustomerAlias: 'other' }, 'energinet', 'E'))), 'mismatched CustomerAlias throws');
  ok(mod.parseHrManagerList({ ...sample, CustomerAlias: 'ENERGINET' }, 'energinet', 'E').length === 3, 'alias comparison is case-insensitive (control)');
  ok(throws(() => mod.parseHrManagerList(null, 'x', 'X')) !== '', 'null payload throws');

  const calls = [];
  const ctx = { fetchJson: async (url, opts) => { calls.push({ url, opts }); return sample; } };
  const fetched = await p.fetch({ name: 'Energinet', careers_url: 'https://candidate.hr-manager.net/vacancies/list.aspx?customer=energinet' }, ctx);
  ok(calls.length === 1 && calls[0].url === API, 'fetch makes one positionlist request');
  ok(calls[0].opts?.redirect === 'error', "fetch passes redirect:'error'");
  ok(fetched.length === 3, 'fetch returns parsed jobs');

  let threw = false;
  try { await p.fetch({ name: 'E', careers_url: 'https://evil.example/JobPortal.svc/energinet' }, ctx); } catch { threw = true; }
  ok(threw && calls.length === 1, 'fetch rejects hostile careers_url without any request');
} catch (e) {
  fail(`hrmanager provider tests crashed: ${e.message}`);
}
