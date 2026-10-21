// tests/ats-detect.test.mjs — lib/ats-detect.mjs + discover-ats.mjs website scan
// (docs/FREEHIRE-INTEGRATION-PLAN.md Phase 7). No network: real provider
// registry for routing, stubbed fetch for pages and boards.
import { pass, fail, ROOT } from './helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nATS detection — careers page → supported provider');

const lib = await import(pathToFileURL(join(ROOT, 'lib/ats-detect.mjs')).href);
const { loadProviders } = await import(pathToFileURL(join(ROOT, 'providers/_registry.mjs')).href);
const { resolveCompany, resolveFromWebsite } = await import(pathToFileURL(join(ROOT, 'discover-ats.mjs')).href);
const { assertPublicHttpsUrl, candidatePages, extractCandidateUrls, detectBoard, detectSelfHosted, fetchPage } = lib;

/** Minimal Response stand-in for fetchPage's injected fetchImpl. */
const response = (status, body = '', location = null) => ({
  status, ok: status >= 200 && status < 300,
  headers: { get: (h) => (h.toLowerCase() === 'location' ? location : null) },
  text: async () => body,
});

// --- assertPublicHttpsUrl: public https names pass, everything else throws (control first) ---
{
  let okPublic = false;
  try { okPublic = assertPublicHttpsUrl('https://careers.example.com/jobs').hostname === 'careers.example.com'; } catch { okPublic = false; }
  if (okPublic) pass('assertPublicHttpsUrl accepts a public https name');
  else fail('assertPublicHttpsUrl rejected a public https name');
  const bad = ['http://example.com', 'https://127.0.0.1/', 'https://[::1]/', 'https://localhost/', 'https://intranet.corp/',
    'https://user:pw@example.com/', 'https://example.com:8443/', 'not a url'];
  const accepted = bad.filter((u) => { try { assertPublicHttpsUrl(u); return true; } catch { return false; } });
  if (accepted.length === 0) pass('assertPublicHttpsUrl rejects http, IP literals, localhost, internal suffixes, userinfo and ports');
  else fail(`assertPublicHttpsUrl accepted: ${accepted.join(', ')}`);
}

// --- candidatePages ---
{
  const pages = candidatePages('mollie.com');
  if (pages.join(' ') === 'https://mollie.com/ https://mollie.com/careers https://mollie.com/jobs') pass('candidatePages adds https:// to a bare domain and tries /careers and /jobs');
  else fail(`candidatePages = ${JSON.stringify(pages)}`);
  if (candidatePages('http://mollie.com').length === 0 && candidatePages('').length === 0) pass('candidatePages refuses http and empty input');
  else fail('candidatePages should refuse http/empty');
}

// --- extractCandidateUrls ---
{
  const html = `<a href="/about">About</a><a href="https://boards.greenhouse.io/acme">Jobs</a>
    <iframe src="https://recruiting.ultipro.com/van5000vcscu/JobBoard/a46cbdaa-ca2c-49b6-8d2b-e0ceaafa0e25#top"></iframe>
    <a href="mailto:hr@acme.com">mail</a><a href="javascript:void(0)">x</a><a href="http://insecure.example/jobs">x</a>
    <script>window.cfg={"url":"https:\\/\\/acme.bamboohr.com\\/careers"}</script>`;
  const urls = extractCandidateUrls(html, 'https://acme.com/careers');
  const want = ['https://acme.com/careers', 'https://acme.com/about', 'https://job-boards.greenhouse.io/acme',
    'https://recruiting.ultipro.com/van5000vcscu/JobBoard/a46cbdaa-ca2c-49b6-8d2b-e0ceaafa0e25', 'https://acme.bamboohr.com/careers'];
  const missing = want.filter((u) => !urls.includes(u));
  if (missing.length === 0) pass('extractCandidateUrls resolves relative links, strips fragments and unescapes URLs inside scripts');
  else fail(`extractCandidateUrls missing ${missing.join(', ')} from ${JSON.stringify(urls)}`);
  if (!urls.some((u) => /^(mailto|javascript|http):/.test(u))) pass('extractCandidateUrls drops mailto/javascript/http links');
  else fail(`extractCandidateUrls kept a non-https link: ${JSON.stringify(urls)}`);
  const embed = extractCandidateUrls('<script src="https://boards.greenhouse.io/embed/job_board/js?for=acmeco"></script>', 'https://acme.com/');
  const bareEmbed = extractCandidateUrls('<script src="https://boards.greenhouse.io/embed/job_board/js"></script>', 'https://acme.com/');
  if (embed.includes('https://job-boards.greenhouse.io/acmeco') && !bareEmbed.some((u) => u.startsWith('https://job-boards.'))) {
    pass('legacy Greenhouse board and embed links become job-boards.greenhouse.io/<slug>; an embed without for= is left alone');
  } else fail(`greenhouse canonicalization = ${JSON.stringify({ embed, bareEmbed })}`);
}

// --- detectBoard through the REAL provider registry ---
{
  const providers = await loadProviders(join(ROOT, 'providers'));
  const ukg = detectBoard(['https://acme.com/careers', 'https://recruiting.ultipro.com/van5000vcscu/JobBoard/a46cbdaa-ca2c-49b6-8d2b-e0ceaafa0e25'], providers);
  if (ukg?.provider === 'ukg') pass('detectBoard routes a linked UKG board through the registry (a ported provider, no extra table)');
  else fail(`detectBoard UKG = ${JSON.stringify(ukg)}`);
  const gh = detectBoard(['https://job-boards.greenhouse.io/acme', 'https://acme.bamboohr.com/careers'], providers);
  if (gh?.provider === 'greenhouse') pass('detectBoard returns the first claimed link in page order');
  else fail(`detectBoard order = ${JSON.stringify(gh)}`);
  const root = detectBoard(['https://jobs.ashbyhq.com/notion/05e14247-17c4-4e98-9a13-53828a4e2f13', 'https://jobs.ashbyhq.com/notion'], providers);
  if (root?.provider === 'ashby' && root.careers_url === 'https://jobs.ashbyhq.com/notion') pass('detectBoard prefers the board root over a posting URL of the same provider');
  else fail(`detectBoard root = ${JSON.stringify(root)}`);
  if (detectBoard(['https://acme.com/careers', 'https://www.google.com/', 'https://evil-boards.greenhouse.io.example.com/acme'], providers) === null) {
    pass('detectBoard claims nothing for plain and look-alike URLs');
  } else fail('detectBoard matched a non-ATS URL');
}

// --- detectSelfHosted: hint from markup, never on the vendor's own domain ---
{
  if (detectSelfHosted('<script src="/js/talentbrew.min.js"></script>', 'https://jobs.acme.com/')?.provider === 'radancy') pass('detectSelfHosted spots a Radancy (TalentBrew) bundle');
  else fail('detectSelfHosted missed talentbrew');
  if (detectSelfHosted('<p>Powered by phenompeople</p>', 'https://www.phenompeople.com/') === null
      && detectSelfHosted('<p>plain careers page</p>', 'https://acme.com/') === null) {
    pass('detectSelfHosted stays silent on the vendor domain and on plain pages');
  } else fail('detectSelfHosted false positive');
}

// --- fetchPage: manual redirects, each hop validated ---
{
  const calls = [];
  const okImpl = async (url, opts) => {
    calls.push([url, opts.redirect]);
    if (url === 'https://acme.com/') return response(301, '', 'https://www.acme.com/');
    return response(200, '<html>ok</html>');
  };
  const page = await fetchPage('https://acme.com/', { fetchImpl: okImpl });
  if (page.url === 'https://www.acme.com/' && page.html.includes('ok') && calls.every(([, r]) => r === 'manual')) {
    pass('fetchPage follows a public redirect by hand (redirect:manual on every hop)');
  } else fail(`fetchPage redirect = ${JSON.stringify({ page, calls })}`);

  let blocked = null;
  try {
    await fetchPage('https://acme.com/', { fetchImpl: async () => response(302, '', 'https://127.0.0.1/admin') });
  } catch (err) { blocked = err.message; }
  if (blocked && /IP-literal/.test(blocked)) pass('fetchPage refuses a redirect into an IP literal');
  else fail(`fetchPage redirect to 127.0.0.1: ${blocked}`);

  let looped = null;
  try {
    await fetchPage('https://acme.com/a', { fetchImpl: async (u) => response(302, '', u.endsWith('a') ? 'https://acme.com/b' : 'https://acme.com/a') });
  } catch (err) { looped = err.message; }
  if (looped && /redirects/.test(looped)) pass('fetchPage stops after MAX_REDIRECTS hops');
  else fail(`fetchPage redirect loop: ${looped}`);
}

// --- discover-ats integration: website scan resolves a board the slug probes cannot ---
{
  const stub = {
    id: 'stubats',
    detect: (e) => (/^https:\/\/stub-ats\.example\.com\/acme$/.test(e.careers_url || '') ? { url: e.careers_url } : null),
    fetch: async (_e, ctx) => (ctx.maxPages === 1 ? [{ title: 'Engineer', url: 'https://stub-ats.example.com/acme/1' }] : []),
  };
  const providers = new Map([['stubats', stub]]);
  const pages = {
    'https://acme.com/': '<a href="/careers">Careers</a>',
    'https://acme.com/careers': '<a href="https://stub-ats.example.com/acme">Open roles</a>',
  };
  const fetchImpl = async (url) => (pages[url] ? response(200, pages[url]) : response(404));
  const r = await resolveCompany({ name: 'Acme', website: 'acme.com' }, { vendors: [], includeWorkday: false, providers, fetchImpl, ctx: {} });
  if (r.resolved?.vendor === 'stubats' && r.resolved.careers_url === 'https://stub-ats.example.com/acme' && r.resolved.via === 'website' && r.resolved.jobCount === 1) {
    pass('resolveCompany finds the ATS linked from /careers and confirms it with a one-page probe');
  } else fail(`resolveCompany website = ${JSON.stringify(r)}`);

  // Control: the same company with no website never scans and stays unresolved.
  let fetched = false;
  const none = await resolveCompany({ name: 'Acme' }, { vendors: [], includeWorkday: false, providers, fetchImpl: async () => { fetched = true; return response(200, ''); }, ctx: {} });
  if (none.unresolved && !fetched && /website:/.test(none.unresolved.reason)) pass('without website: no page is fetched and the reason says how to enable the scan');
  else fail(`no-website control = ${JSON.stringify(none)} fetched=${fetched}`);

  const hinted = await resolveFromWebsite({ name: 'Brand', website: 'jobs.brand.com' }, {
    providers, ctx: {}, fetchImpl: async () => response(200, '<script src="https://cdn.brand.com/talentbrew.js"></script>'),
  });
  if (hinted.status === 'none' && hinted.hint?.provider === 'radancy') pass('resolveFromWebsite returns a self-hosted hint when no board link exists');
  else fail(`self-hosted hint = ${JSON.stringify(hinted)}`);

  // One unreadable page among readable ones is not a probe error; all unreadable is.
  const partly = await resolveFromWebsite({ name: 'P', website: 'acme.com' }, {
    providers, ctx: {}, fetchImpl: async (u) => (u.endsWith('/jobs') ? response(404) : response(200, '<p>no ats</p>')),
  });
  const allDown = await resolveFromWebsite({ name: 'D', website: 'acme.com' }, { providers, ctx: {}, fetchImpl: async () => response(503) });
  if (partly.errors.length === 0 && allDown.errors.length === 3) pass('page errors are reported only when no candidate page could be read');
  else fail(`errors partly=${partly.errors.length} allDown=${allDown.errors.length}`);
}
