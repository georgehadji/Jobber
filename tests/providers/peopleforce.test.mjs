// tests/providers/peopleforce.test.mjs — fixture shaped like live gigacloud.peopleforce.io/careers markup (2026-10-21), trimmed.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — peopleforce');
const ok = (c, m) => (c ? pass(m) : fail(m));

const card = (id, slug, title, dept, type, loc) => `
  <div class="tw-p-4 tw-relative"><h4 class="tw-text-medium tw-mb-2">
    <a class="stretched-link tw-text-black" data-turbo-frame="_top" href="/careers/v/${id}-${slug}">${title}</a></h4>
    <div class="tw-flex tw-flex-wrap">
      <div class="tw-flex"><i class="fas fa-briefcase fa-fw tw-me-1" aria-hidden="true"></i>${dept}</div>
      <div class="tw-flex"><i class="fas fa-clock fa-fw tw-me-1" aria-hidden="true"></i>${type}</div>
      <div class="tw-flex"><i class="fas fa-map-marker-alt fa-fw tw-me-1" aria-hidden="true"></i>${loc}
      </div></div></div>`;
const nav = (...pages) => `<nav>${pages.map(n => `<a href="/careers?page=${n}">${n}</a>`).join('')}</nav>`;

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/peopleforce.mjs')).href);
  const p = mod.default;
  ok(p.id === 'peopleforce', 'peopleforce.id is "peopleforce"');

  ok(p.detect({ name: 'G', careers_url: 'https://gigacloud.peopleforce.io/careers' })?.url === 'https://gigacloud.peopleforce.io/careers?page=1', 'detect() tenant careers URL');
  ok(p.detect({ name: 'G', careers_url: 'https://gigacloud.peopleforce.io/careers/v/226791-security-auditor' }) !== null, 'detect() accepts job URL');
  ok(p.detect({ name: 'G', careers_url: 'http://gigacloud.peopleforce.io/careers' }) === null, 'detect() rejects http');
  ok(p.detect({ name: 'G', careers_url: 'https://evil-peopleforce.io/careers' }) === null, 'detect() rejects lookalike evil-peopleforce.io');
  ok(p.detect({ name: 'G', careers_url: 'https://gigacloud.peopleforce.io.evil.example/careers' }) === null, 'detect() rejects suffix-spoofed host');
  ok(p.detect({ name: 'G', careers_url: 'https://evil.example/gigacloud.peopleforce.io/careers' }) === null, 'detect() rejects path-spoofed URL');
  ok(p.detect({ name: 'G', careers_url: 'https://www.peopleforce.io/careers' }) === null, 'detect() rejects vendor www host');
  ok(p.detect({ name: 'G' }) === null, 'detect() null without careers_url');

  const page1 = `<div>Displaying 1 - 3 of 5</div>${
    card(226791, 'security-auditor', 'Security Auditor', 'Information Security', 'Full-time', 'Kyiv')
  }${card(226792, 'devops-engineer', 'DevOps &amp; SRE', 'Eng', 'Contract', 'Remote, Poland')
  }${card(226791, 'security-auditor', 'Security Auditor (dup)', 'x', 'y', 'z')
  }<a href="/careers/v/999-blank"> </a>
    <a href="https://evil.example/careers/v/555-offsite">Offsite</a>
    <a href="/careers/other/777">Not a job</a>${nav(1, 2)}`;
  const jobs = mod.parsePeopleForceListing(page1, 'gigacloud', 'GigaCloud');
  ok(jobs.length === 2, `parsePeopleForceListing keeps 2 cards (got ${jobs.length})`);
  ok(jobs[0].url === 'https://gigacloud.peopleforce.io/careers/v/226791-security-auditor' && jobs[0].title === 'Security Auditor', 'absolute url + title from anchor');
  ok(jobs[0].location === 'Kyiv' && jobs[1].location === 'Remote, Poland', 'location from the map-marker row of each card (not the neighbour)');
  ok(jobs[1].title === 'DevOps & SRE' && jobs[1].company === 'GigaCloud', 'title entity-decoded; company set');
  ok(!jobs.some(j => /evil|blank|Offsite|Not a job/.test(j.url + j.title)), 'blank-title / off-host / non-job links dropped; duplicate id collapsed');
  ok(!('description' in jobs[0]) && !('postedAt' in jobs[0]), 'no description / postedAt (not free in list)');
  ok(mod.parsePeopleForceListing('', 'g', 'G').length === 0 && mod.parsePeopleForceListing(null, 'g', 'G').length === 0, 'empty / null html -> []');
  ok(mod.hasPageAfter(nav(1, 2), 1) === true, 'hasPageAfter true when nav names a later page');
  ok(mod.hasPageAfter(nav(1, 2), 2) === false && mod.hasPageAfter('<p>no nav</p>', 1) === false, 'hasPageAfter false on last page / no nav (control)');

  // fetch: page1 names page 2, page 2 is last -> exactly 2 requests (clamping would otherwise loop)
  const page2 = `${card(300, 'last-job', 'Last Job', 'd', 't', 'Lviv')}${nav(1, 2)}`;
  const calls = [];
  const sleeps = [];
  const ctx = {
    sleep: async ms => { sleeps.push(ms); },
    fetchText: async (url, opts) => { calls.push({ url, opts }); return url.endsWith('page=1') ? page1 : page2; },
  };
  const entry = { name: 'GigaCloud', careers_url: 'https://gigacloud.peopleforce.io/careers' };
  const all = await p.fetch(entry, ctx);
  ok(calls.length === 2 && calls[1].url === 'https://gigacloud.peopleforce.io/careers?page=2', `fetch stops when nav names no later page (calls=${calls.length})`);
  ok(calls.every(c => c.opts?.redirect === 'error'), "every request passes redirect:'error'");
  ok(all.length === 3 && all.every(j => j.company === 'GigaCloud'), 'fetch returns 3 jobs');
  ok(sleeps.length === 1, 'paces between pages');

  calls.length = 0;
  const one = await p.fetch(entry, { ...ctx, maxPages: 1 });
  ok(calls.length === 1 && one.length === 2, 'ctx.maxPages=1 stops after first page');

  calls.length = 0;
  const empty = await p.fetch(entry, { ...ctx, fetchText: async url => { calls.push(url); return `${nav(1, 2, 3)}`; } });
  ok(calls.length === 1 && empty.length === 0, 'page with no cards ends the walk even if nav names more');

  let threw = false;
  try { await p.fetch({ name: 'E', careers_url: 'https://evil.example/careers' }, ctx); } catch { threw = true; }
  ok(threw && calls.length === 1, 'fetch rejects hostile careers_url without any request');
} catch (e) {
  fail(`peopleforce provider tests crashed: ${e.message}`);
}
