/**
 * portals-config-validator.test.mjs — validate-portals.mjs schema checks
 * (title/content/visa filter empty-keyword rejection, unknown provider,
 * duplicate tracked_companies, dead by_title_keyword warning) and
 * fix-slugs.mjs's ATS-slug auto-fixer (dry-run safety, idempotence, no
 * mutation of its input text).
 *
 * Extracted verbatim from test-all.mjs (see tests/README.md — discovered
 * files are auto-run by both test-all.mjs and test-runner.mjs).
 */

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFileSync } from 'child_process';
import { pathToFileURL } from 'url';
import yaml from 'js-yaml';
import { classifyFetchError } from '../lib/http-errors.mjs';
import { pass, fail, ROOT, NODE, run } from './helpers.mjs';

// ── 10. PORTALS CONFIG VALIDATOR ────────────────────────────────

console.log('\n10. Portals config validator');

try {
  const tmp = mkdtempSync(join(tmpdir(), 'jobber-portals-validator-'));
  const validPath = join(tmp, 'valid.yml');
  const validProviderPluginPath = join(tmp, 'valid-provider-plugin.yml');
  const invalidProviderPath = join(tmp, 'invalid-provider.yml');
  const emptyKeywordPath = join(tmp, 'empty-keyword.yml');
  const duplicateCompanyPath = join(tmp, 'duplicate-company.yml');
  const badContentFilterPath = join(tmp, 'bad-content-filter.yml');
  const deadByTitleKeywordPath = join(tmp, 'dead-by-title-keyword.yml');
  const badVisaFilterPath = join(tmp, 'bad-visa-filter.yml');

  writeFileSync(validPath, `
title_filter:
  positive: ["AI"]
  negative: ["Intern"]
tracked_companies:
  - name: "Acme"
    careers_url: "https://jobs.lever.co/acme"
`, 'utf-8');

  writeFileSync(validProviderPluginPath, `
title_filter:
  positive: ["AI"]
tracked_companies:
  - name: "Apify Source"
    provider: "apify"
`, 'utf-8');

  writeFileSync(invalidProviderPath, `
title_filter:
  positive: ["AI"]
tracked_companies:
  - name: "Acme"
    provider: "missing-provider"
    careers_url: "https://jobs.lever.co/acme"
`, 'utf-8');

  writeFileSync(emptyKeywordPath, `
title_filter:
  positive: ["AI", "   "]
tracked_companies:
  - name: "Acme"
    careers_url: "https://jobs.lever.co/acme"
`, 'utf-8');

  writeFileSync(duplicateCompanyPath, `
title_filter:
  positive: ["AI"]
tracked_companies:
  - name: "Acme"
    careers_url: "https://jobs.lever.co/acme"
  - name: " acme "
    careers_url: "https://jobs.lever.co/acme2"
`, 'utf-8');

  // content_filter with an empty-string keyword must be rejected, same as
  // title/location filters (an empty keyword would match every description).
  writeFileSync(badContentFilterPath, `
title_filter:
  positive: ["AI"]
content_filter:
  positive: ["rust", "   "]
tracked_companies:
  - name: "Acme"
    careers_url: "https://jobs.lever.co/acme"
`, 'utf-8');

  // by_title_keyword.<kw> that doesn't match any title_filter.positive entry
  // (typo, or a keyword later removed from title_filter) is dead config — it
  // will never fire. Should warn, not error (#1636 CodeRabbit follow-up).
  writeFileSync(deadByTitleKeywordPath, `
title_filter:
  positive: ["AI Engineer"]
content_filter:
  by_title_keyword:
    "AI Enginer":
      positive: ["gpt"]
tracked_companies:
  - name: "Acme"
    careers_url: "https://jobs.lever.co/acme"
`, 'utf-8');

  // visa_filter with an empty-string keyword or a non-boolean require_mention
  // must be rejected (an empty keyword would match every description).
  writeFileSync(badVisaFilterPath, `
title_filter:
  positive: ["AI"]
visa_filter:
  require_mention: "yes"
  positive: ["h-1b", "   "]
tracked_companies:
  - name: "Acme"
    careers_url: "https://jobs.lever.co/acme"
`, 'utf-8');

  const validResult = run(NODE, ['validate-portals.mjs', '--file', validPath]);
  if (validResult !== null && validResult.includes('0 errors')) {
    pass('validate-portals accepts a minimal valid portals file');
  } else {
    fail('validate-portals should accept a minimal valid portals file');
  }

  const validProviderPluginResult = run(NODE, ['validate-portals.mjs', '--file', validProviderPluginPath]);
  if (validProviderPluginResult !== null && validProviderPluginResult.includes('0 errors')) {
    pass('validate-portals accepts bundled provider-plugin ids');
  } else {
    fail('validate-portals should accept bundled provider-plugin ids');
  }

  const exampleResult = run(NODE, ['validate-portals.mjs', '--file', 'templates/portals.example.yml']);
  if (exampleResult !== null && exampleResult.includes('0 errors')) {
    pass('validate-portals accepts templates/portals.example.yml');
  } else {
    fail('validate-portals should accept templates/portals.example.yml');
  }

  const invalidProviderResult = run(NODE, ['validate-portals.mjs', '--file', invalidProviderPath]);
  if (invalidProviderResult === null) {
    pass('validate-portals rejects unknown explicit providers');
  } else {
    fail('validate-portals should reject unknown explicit providers');
  }

  const emptyKeywordResult = run(NODE, ['validate-portals.mjs', '--file', emptyKeywordPath]);
  if (emptyKeywordResult === null) {
    pass('validate-portals rejects empty title/location keywords');
  } else {
    fail('validate-portals should reject empty title/location keywords');
  }

  const duplicateCompanyResult = run(NODE, ['validate-portals.mjs', '--file', duplicateCompanyPath]);
  if (duplicateCompanyResult !== null && duplicateCompanyResult.includes('1 warning')) {
    pass('validate-portals warns on duplicate enabled company names');
  } else {
    fail('validate-portals should warn on duplicate enabled company names');
  }

  const badContentFilterResult = run(NODE, ['validate-portals.mjs', '--file', badContentFilterPath]);
  if (badContentFilterResult === null) {
    pass('validate-portals rejects empty content_filter keywords');
  } else {
    fail('validate-portals should reject empty content_filter keywords');
  }

  const deadByTitleKeywordResult = run(NODE, ['validate-portals.mjs', '--file', deadByTitleKeywordPath]);
  if (deadByTitleKeywordResult !== null && deadByTitleKeywordResult.includes('1 warning')) {
    pass('validate-portals warns on a by_title_keyword entry with no matching title_filter.positive keyword');
  } else {
    fail('validate-portals should warn (not error) on a dead by_title_keyword entry');
  }

  const badVisaFilterResult = run(NODE, ['validate-portals.mjs', '--file', badVisaFilterPath]);
  if (badVisaFilterResult === null) {
    pass('validate-portals rejects invalid visa_filter (empty keyword / non-boolean require_mention)');
  } else {
    fail('validate-portals should reject invalid visa_filter');
  }

  rmSync(tmp, { recursive: true, force: true });
} catch (e) {
  fail(`portals validator tests crashed: ${e.message}`);
}

// ── 10b. PORTAL SLUG VALIDATOR (verify-portals.mjs) ─────────────

console.log('\n10b. Portal slug validator');

try {
  const { deriveSlugCandidates, parseAtsSlug, verifyCompanies } =
    await import(pathToFileURL(join(ROOT, 'verify-portals.mjs')).href);

  const slugs = deriveSlugCandidates('Acme Corp!');
  const baseSlugs = ['acmecorp', 'acme-corp', 'acme_corp', 'acme'];
  if (baseSlugs.every((s) => slugs.includes(s)) && slugs.includes('acmeai') && slugs.includes('acme.tech')) {
    pass('verify-portals derives slug candidates from a company name');
  } else {
    fail(`verify-portals slug candidates wrong: ${JSON.stringify(slugs)}`);
  }

  if (deriveSlugCandidates('Deepset').includes('deepsetai')) {
    pass('verify-portals derives common slug suffixes (e.g. deepsetai)');
  } else {
    fail('verify-portals missing deepsetai suffix for Deepset');
  }

  if (
    classifyFetchError({ status: 404 }) === 'slug_gone' &&
    classifyFetchError({ name: 'AbortError' }) === 'network' &&
    classifyFetchError({ status: 503 }) === 'server'
  ) {
    pass('verify-portals classifies fetch errors by kind');
  } else {
    fail('verify-portals classifyFetchError misclassified HTTP errors');
  }

  if (
    parseAtsSlug('https://job-boards.greenhouse.io/acme')?.ats === 'greenhouse' &&
    parseAtsSlug('https://jobs.ashbyhq.com/acme')?.ats === 'ashby' &&
    parseAtsSlug('https://api.lever.co/v0/postings/acme')?.slug === 'acme' &&
    parseAtsSlug('https://openai.com/careers') === null
  ) {
    pass('verify-portals recognizes ATS slugs and skips branded URLs');
  } else {
    fail('verify-portals parseAtsSlug misclassified an ATS or branded URL');
  }

  const leverSlug = parseAtsSlug('https://jobs.lever.co/acme');
  if (leverSlug?.ats === 'lever' && leverSlug?.slug === 'acme' && !leverSlug?.eu) {
    pass('verify-portals parseAtsSlug extracts lever slug from jobs.lever.co URL');
  } else {
    fail(`verify-portals parseAtsSlug lever: ${JSON.stringify(leverSlug)}`);
  }

  const leverEuSlug = parseAtsSlug('https://jobs.eu.lever.co/acme-eu');
  if (leverEuSlug?.ats === 'lever' && leverEuSlug?.slug === 'acme-eu' && leverEuSlug?.eu === true) {
    pass('verify-portals parseAtsSlug extracts lever-eu slug and sets eu:true from jobs.eu.lever.co URL');
  } else {
    fail(`verify-portals parseAtsSlug lever-eu: ${JSON.stringify(leverEuSlug)}`);
  }

  // Mock fetchJson: 200+jobs → live, 200+empty → empty, otherwise 404 → missing.
  const mockFetch = async (url) => {
    if (url.includes('/boards/live/jobs')) return { jobs: [{}, {}] };
    if (url.includes('/boards/empty/jobs')) return { jobs: [] };
    if (url.includes('/posting-api/job-board/deepsetai')) return { jobs: [{}] };
    if (url.includes('api.lever.co/v0/postings/acme-lv')) return [{}];
    if (url.includes('api.eu.lever.co/v0/postings/acme-eu')) return [{}, {}, {}];
    if (url === 'https://api.eu.lever.co/v0/postings/diabolocom') return [{}, {}];
    const err = new Error('HTTP 404'); err.status = 404; throw err;
  };
  const results = await verifyCompanies([
    { name: 'Live', careers_url: 'https://job-boards.greenhouse.io/live' },
    { name: 'Empty', careers_url: 'https://job-boards.greenhouse.io/empty' },
    { name: 'Typo', careers_url: 'https://job-boards.greenhouse.io/nope' },
    { name: 'Deepset', careers_url: 'https://job-boards.greenhouse.io/deepset' },
    { name: 'Branded', careers_url: 'https://acme.com/careers' },
    { name: 'Off', enabled: false, careers_url: 'https://job-boards.greenhouse.io/live' },
    { name: 'Lever Live', careers_url: 'https://jobs.lever.co/acme-lv' },
    { name: 'Lever EU Live', careers_url: 'https://jobs.eu.lever.co/acme-eu' },
    { name: 'Diabolocom EU Discovery', careers_url: 'https://job-boards.greenhouse.io/does-not-exist-diabolocom' },
  ], { fetchJson: mockFetch });
  const byName = Object.fromEntries(results.map((r) => [r.name, r]));
  if (
    results.length === 8 &&
    byName.Live.status === 'live' && byName.Empty.status === 'empty' &&
    byName.Typo.status === 'missing' && byName.Typo.errorKind === 'slug_gone' &&
    byName.Branded.status === 'skipped' &&
    byName['Lever Live'].status === 'live' &&
    byName['Lever EU Live'].status === 'live' &&
    byName.Deepset.suggested?.ats === 'ashby' && byName.Deepset.suggested?.slug === 'deepsetai' &&
    byName['Diabolocom EU Discovery'].suggested?.ats === 'lever' &&
    byName['Diabolocom EU Discovery'].suggested?.slug === 'diabolocom' &&
    byName['Diabolocom EU Discovery'].suggested?.url === 'https://api.eu.lever.co/v0/postings/diabolocom'
  ) {
    pass('verify-portals classifies live / empty / unresolved / non-ATS (disabled excluded)');
  } else {
    fail(`verify-portals classification wrong: ${JSON.stringify(byName)} (${results.length} rows)`);
  }

  // Tier 2: non-ATS companies are probed through the scanner's provider layer,
  // bounded to a few requests. Fake providers stand in for Workday/SF/etc.
  const fakeCtx = { transport: 'http', fetchJson: async () => ({}), fetchText: async () => ['x'] };
  const fakeProviders = new Map([
    ['fakeats', {
      id: 'fakeats',
      detect: (e) => (/fakeats\.io/.test(e.careers_url || '') ? { url: e.careers_url } : null),
      fetch: async (e, ctx) => {
        // The probe MUST bound pagination — a provider is never asked to walk a
        // whole board for a health check.
        if (ctx.maxPages !== 1) throw new Error('probe did not pass maxPages=1');
        if (e.careers_url.includes('/full')) return [{ title: 'A' }, { title: 'B' }];
        if (e.careers_url.includes('/empty')) return [];
        const err = new Error('HTTP 404'); err.status = 404; throw err;
      },
    }],
    ['pager', {
      // Ignores maxPages and paginates forever; the probe's request budget must
      // still cut it off after the budgeted pages and classify it live.
      id: 'pager',
      detect: (e) => (/pager\.io/.test(e.careers_url || '') ? { url: e.careers_url } : null),
      fetch: async (e, ctx) => {
        const jobs = [];
        for (let p = 0; p < 50; p++) jobs.push(...(await ctx.fetchText(`u?p=${p}`)));
        return jobs;
      },
    }],
    ['swallower', {
      // Mimics SuccessFactors CSB: burns the whole budget on discovery/locale
      // requests that yield no jobs, swallowing every fetch error internally
      // (per-locale try/catch). The probe must read "budget tripped + 0 jobs"
      // as live/partial — the endpoint answered fine — never as 'empty'.
      id: 'swallower',
      detect: (e) => (/swallower\.io/.test(e.careers_url || '') ? { url: e.careers_url } : null),
      fetch: async (e, ctx) => {
        for (let p = 0; p < 50; p++) {
          try { await ctx.fetchJson(`u?p=${p}`); } catch { break; }
        }
        return [];
      },
    }],
  ]);
  const provResults = await verifyCompanies([
    { name: 'PFull', careers_url: 'https://fakeats.io/full' },
    { name: 'PEmpty', careers_url: 'https://fakeats.io/empty' },
    { name: 'PDead', careers_url: 'https://fakeats.io/dead' },
    { name: 'PPager', careers_url: 'https://pager.io/board' },
    { name: 'PSwallow', careers_url: 'https://swallower.io/board' },
    { name: 'NoProv', careers_url: 'https://unknown.example/careers' },
  ], { fetchJson: mockFetch, providers: fakeProviders, httpCtx: fakeCtx });
  const pv = Object.fromEntries(provResults.map((r) => [r.name, r]));
  if (
    pv.PFull?.status === 'live' && pv.PFull?.jobCount === 2 &&
    pv.PEmpty?.status === 'empty' &&
    pv.PDead?.status === 'missing' && pv.PDead?.errorKind === 'slug_gone' &&
    pv.PPager?.status === 'live' && pv.PPager?.partial === true &&
    pv.PSwallow?.status === 'live' && pv.PSwallow?.partial === true &&
    pv.NoProv?.status === 'skipped'
  ) {
    pass('verify-portals probes non-ATS boards via providers, bounded to a request budget');
  } else {
    fail(`verify-portals provider-fallback wrong: ${JSON.stringify(pv)}`);
  }

  // Without a providers map, non-ATS entries must stay skipped (unchanged CLI
  // behavior for the ATS-only unit path).
  const noProv = await verifyCompanies(
    [{ name: 'X', careers_url: 'https://fakeats.io/full' }],
    { fetchJson: mockFetch },
  );
  if (noProv[0]?.status === 'skipped') {
    pass('verify-portals stays skipped for non-ATS when no providers are supplied');
  } else {
    fail(`verify-portals should skip non-ATS without providers: ${JSON.stringify(noProv)}`);
  }
} catch (e) {
  fail(`portal slug validator tests crashed: ${e.message}`);
}

// ── 10c. SLUG AUTO-FIXER (fix-slugs.mjs) ─────────────────────────

console.log('\n10c. Slug auto-fixer');

try {
  const { splitCompanyBlocks, computeFixes } = await import(
    pathToFileURL(join(ROOT, 'fix-slugs.mjs')).href
  );

  const fixture = [
    'tracked_companies:',
    '',
    '  # A live company — must stay untouched',
    '  - name: Live Co',
    '    careers_url: https://job-boards.greenhouse.io/livewco',
    '    api: https://boards-api.greenhouse.io/v1/boards/livewco/jobs',
    '    notes: "Some notes here."',
    '    enabled: true',
    '',
    '  - name: Migrated Co',
    '    careers_url: https://jobs.lever.co/migratedco',
    '    notes: "Old lever board."',
    '    enabled: true',
    '',
    '  - name: Unresolved Co',
    '    careers_url: https://job-boards.greenhouse.io/typo-slug',
    '    enabled: true',
    '',
    '  - name: No Notes Co',
    '    careers_url: https://jobs.ashbyhq.com/nonotesco',
    '    enabled: true',
    '',
  ].join('\n');

  const { blocks } = splitCompanyBlocks(fixture);
  const blockNames = blocks.map((b) => b.name);
  if (
    blockNames.length === 4 &&
    blockNames.includes('Live Co') &&
    blockNames.includes('Migrated Co') &&
    blockNames.includes('Unresolved Co') &&
    blockNames.includes('No Notes Co')
  ) {
    pass('fix-slugs splits portals.yml text into per-company blocks (comments excluded)');
  } else {
    fail(`fix-slugs splitCompanyBlocks wrong: ${JSON.stringify(blockNames)}`);
  }

  // Mock verify-portals results: one resolvable ATS migration (lever->ashby),
  // one resolvable migration into Greenhouse for an entry with no api/notes
  // fields yet, one genuinely unresolved slug, and one already-live entry.
  const mockResults = [
    { name: 'Live Co', status: 'live', ats: 'greenhouse', slug: 'livewco' },
    {
      name: 'Migrated Co',
      status: 'missing',
      ats: 'lever',
      slug: 'migratedco',
      errorKind: 'slug_gone',
      suggested: { ats: 'ashby', slug: 'top-hat' },
    },
    {
      name: 'Unresolved Co',
      status: 'missing',
      ats: 'greenhouse',
      slug: 'typo-slug',
      errorKind: 'slug_gone',
      // no `suggested` — nothing resolved
    },
    {
      name: 'No Notes Co',
      status: 'missing',
      ats: 'ashby',
      slug: 'nonotesco',
      errorKind: 'slug_gone',
      suggested: { ats: 'greenhouse', slug: 'nonotesnew' },
    },
  ];

  const { text: fixedText, fixes } = computeFixes(fixture, mockResults, { dateStr: '2026-07-08' });
  const fixedByName = Object.fromEntries(fixes.map((f) => [f.name, f]));

  if (
    fixes.length === 2 &&
    fixedByName['Migrated Co']?.newAts === 'ashby' &&
    fixedByName['Migrated Co']?.careersUrlNew === 'https://jobs.ashbyhq.com/top-hat' &&
    fixedByName['No Notes Co']?.newAts === 'greenhouse' &&
    fixedByName['No Notes Co']?.careersUrlNew === 'https://job-boards.greenhouse.io/nonotesnew'
  ) {
    pass('fix-slugs computeFixes resolves only entries with a suggested alternate');
  } else {
    fail(`fix-slugs computeFixes wrong fix set: ${JSON.stringify(fixedByName)}`);
  }

  const parsedFixed = yaml.load(fixedText);
  const byNameFixed = Object.fromEntries(parsedFixed.tracked_companies.map((c) => [c.name, c]));
  if (
    byNameFixed['Live Co'].careers_url === 'https://job-boards.greenhouse.io/livewco' &&
    byNameFixed['Live Co'].notes === 'Some notes here.' &&
    byNameFixed['Migrated Co'].careers_url === 'https://jobs.ashbyhq.com/top-hat' &&
    !('api' in byNameFixed['Migrated Co']) &&
    byNameFixed['Migrated Co'].notes.includes('slug migrated lever->ashby 2026-07-08, verify-portals') &&
    byNameFixed['Unresolved Co'].careers_url === 'https://job-boards.greenhouse.io/typo-slug' &&
    byNameFixed['No Notes Co'].careers_url === 'https://job-boards.greenhouse.io/nonotesnew' &&
    byNameFixed['No Notes Co'].api === 'https://boards-api.greenhouse.io/v1/boards/nonotesnew/jobs' &&
    byNameFixed['No Notes Co'].notes.includes('slug migrated ashby->greenhouse 2026-07-08, verify-portals')
  ) {
    pass('fix-slugs writes resolved careers_url/api/notes and re-parses as valid YAML');
  } else {
    fail(`fix-slugs fixed-text YAML wrong: ${JSON.stringify(byNameFixed)}`);
  }

  // A resolvable-but-untouched control: an unresolved entry (no `suggested`)
  // must come out of computeFixes byte-for-byte identical to its input block.
  if (fixedText.includes('  - name: Unresolved Co\n    careers_url: https://job-boards.greenhouse.io/typo-slug\n    enabled: true')) {
    pass('fix-slugs leaves an unresolved entry (no suggestion) completely untouched');
  } else {
    fail('fix-slugs modified an unresolved entry it should have left alone');
  }

  // Bottom-to-top processing: fixing an earlier-in-file company must not
  // corrupt the line ranges of a later-in-file company still pending, even
  // when the earlier fix inserts new lines (new `api:` field, new `notes:`
  // field) that shift every line number below it.
  const orderFixture = [
    'tracked_companies:',
    '',
    '  - name: First Co',
    '    careers_url: https://jobs.lever.co/firstco',
    '    enabled: true',
    '',
    '  - name: Second Co',
    '    careers_url: https://jobs.lever.co/secondco',
    '    enabled: true',
    '',
    '  - name: Third Co',
    '    careers_url: https://jobs.lever.co/thirdco',
    '    enabled: true',
    '',
  ].join('\n');
  const orderResults = [
    { name: 'First Co', status: 'missing', ats: 'lever', slug: 'firstco', suggested: { ats: 'greenhouse', slug: 'first-gh' } },
    { name: 'Second Co', status: 'missing', ats: 'lever', slug: 'secondco', suggested: { ats: 'greenhouse', slug: 'second-gh' } },
    { name: 'Third Co', status: 'missing', ats: 'lever', slug: 'thirdco', suggested: { ats: 'ashby', slug: 'third-ashby' } },
  ];
  const { text: orderedText } = computeFixes(orderFixture, orderResults, { dateStr: '2026-07-09' });
  const orderedParsed = yaml.load(orderedText);
  const orderedByName = Object.fromEntries(orderedParsed.tracked_companies.map((c) => [c.name, c]));
  if (
    orderedByName['First Co'].careers_url === 'https://job-boards.greenhouse.io/first-gh' &&
    orderedByName['First Co'].api === 'https://boards-api.greenhouse.io/v1/boards/first-gh/jobs' &&
    orderedByName['Second Co'].careers_url === 'https://job-boards.greenhouse.io/second-gh' &&
    orderedByName['Second Co'].api === 'https://boards-api.greenhouse.io/v1/boards/second-gh/jobs' &&
    orderedByName['Third Co'].careers_url === 'https://jobs.ashbyhq.com/third-ashby' &&
    !('api' in orderedByName['Third Co'])
  ) {
    pass('fix-slugs applies fixes bottom-to-top so earlier line-count shifts never corrupt a later block');
  } else {
    fail(`fix-slugs multi-company ordering wrong: ${JSON.stringify(orderedByName)}`);
  }

  // notes: edge cases — block scalar and embedded/single quotes must not
  // corrupt the surrounding YAML.
  const notesFixture = [
    'tracked_companies:',
    '',
    '  - name: Block Co',
    '    careers_url: https://jobs.lever.co/blockco',
    '    notes: |',
    '      Line one of notes.',
    '      Line two of notes.',
    '    enabled: true',
    '',
    '  - name: Quote Co',
    '    careers_url: https://jobs.lever.co/quoteco',
    '    notes: Some "quoted" unquoted text',
    '    enabled: true',
    '',
    "  - name: Single Co",
    '    careers_url: https://jobs.lever.co/singleco',
    "    notes: 'It''s a single-quoted note'",
    '    enabled: true',
    '',
    '  - name: Commented Co',
    '    careers_url: https://jobs.lever.co/commentedco',
    '    notes: "Existing note" # do not remove this line',
    '    enabled: true',
    '',
  ].join('\n');
  const notesResults = [
    { name: 'Block Co', status: 'missing', ats: 'lever', slug: 'blockco', suggested: { ats: 'ashby', slug: 'block-ashby' } },
    { name: 'Quote Co', status: 'missing', ats: 'lever', slug: 'quoteco', suggested: { ats: 'ashby', slug: 'quote-ashby' } },
    { name: 'Single Co', status: 'missing', ats: 'lever', slug: 'singleco', suggested: { ats: 'ashby', slug: 'single-ashby' } },
    { name: 'Commented Co', status: 'missing', ats: 'lever', slug: 'commentedco', suggested: { ats: 'ashby', slug: 'commented-ashby' } },
  ];
  const { text: notesText } = computeFixes(notesFixture, notesResults, { dateStr: '2026-07-09' });
  const notesParsed = yaml.load(notesText);
  const notesByName = Object.fromEntries(notesParsed.tracked_companies.map((c) => [c.name, c]));
  if (
    notesByName['Block Co'].notes.includes('Line one of notes.') &&
    notesByName['Block Co'].notes.includes('Line two of notes.') &&
    notesByName['Block Co'].notes.includes('slug migrated lever->ashby 2026-07-09, verify-portals') &&
    notesByName['Quote Co'].notes === 'Some "quoted" unquoted text (slug migrated lever->ashby 2026-07-09, verify-portals)' &&
    notesByName['Single Co'].notes === "It's a single-quoted note (slug migrated lever->ashby 2026-07-09, verify-portals)" &&
    notesByName['Commented Co'].notes === 'Existing note (slug migrated lever->ashby 2026-07-09, verify-portals)'
  ) {
    pass('fix-slugs safely appends notes to block-scalar and quote-embedded values');
  } else {
    fail(`fix-slugs notes edge cases produced invalid/wrong content: ${JSON.stringify(notesByName)}`);
  }

  // A quoted notes value followed by a trailing `# comment` must keep that
  // comment as a real YAML comment (outside the rewritten quoted scalar),
  // not swallow it into the value — regression guard for the quote-type
  // check running before the comment was split off.
  if (notesText.includes('# do not remove this line')) {
    pass('fix-slugs preserves a trailing inline comment on a quoted notes value');
  } else {
    fail(`fix-slugs lost the trailing comment on Commented Co's notes line: ${JSON.stringify(notesText)}`);
  }

  // Regression guard: when `api:` already exists and is rewritten in place
  // (not newly inserted), a subsequently-inserted `notes:` field must land
  // AFTER it, not before it — `insertAfter` has to advance to the existing
  // api line's position, not stay pinned at careers_url.
  const apiOrderFixture = [
    'tracked_companies:',
    '',
    '  - name: Renamed GH Co',
    '    careers_url: https://job-boards.greenhouse.io/oldslug',
    '    api: https://boards-api.greenhouse.io/v1/boards/oldslug/jobs',
    '    enabled: true',
    '',
  ].join('\n');
  const apiOrderResults = [
    { name: 'Renamed GH Co', status: 'missing', ats: 'greenhouse', slug: 'oldslug', suggested: { ats: 'greenhouse', slug: 'newslug' } },
  ];
  const { text: apiOrderText } = computeFixes(apiOrderFixture, apiOrderResults, { dateStr: '2026-07-09' });
  const apiLineIdx = apiOrderText.split('\n').findIndex((l) => l.trim().startsWith('api:'));
  const notesLineIdx = apiOrderText.split('\n').findIndex((l) => l.trim().startsWith('notes:'));
  if (apiLineIdx !== -1 && notesLineIdx !== -1 && notesLineIdx > apiLineIdx) {
    pass('fix-slugs inserts a new notes field after an existing rewritten-in-place api field');
  } else {
    fail(`fix-slugs inserted notes before the existing api field: ${JSON.stringify(apiOrderText)}`);
  }

  // --dry-run must never mutate the file: computeFixes is pure (it only
  // returns text), so a caller doing dry-run simply never calls writeFileSync.
  // Verify that guarantee holds by calling computeFixes twice on the SAME base
  // input and deep-equality-checking the two independently-returned outputs —
  // comparing the input string to itself would prove nothing (strings are
  // immutable in JS; that reference can never change no matter what the
  // function does internally).
  const runA = computeFixes(fixture, mockResults, { dateStr: '2026-07-08' });
  const runB = computeFixes(fixture, mockResults, { dateStr: '2026-07-08' });
  if (runA.text === runB.text && JSON.stringify(runA.fixes) === JSON.stringify(runB.fixes)) {
    pass('fix-slugs computeFixes does not mutate its input text (dry-run safe)');
  } else {
    fail('fix-slugs computeFixes produced different output across two calls on the same input');
  }

  // End-to-end CLI --dry-run must not write to disk.
  const dryRunTmp = mkdtempSync(join(tmpdir(), 'jobber-fix-slugs-dryrun-'));
  const dryRunPortals = join(dryRunTmp, 'portals.yml');
  writeFileSync(dryRunPortals, fixture);
  const beforeDryRun = readFileSync(dryRunPortals, 'utf-8');
  try {
    execFileSync(NODE, [join(ROOT, 'fix-slugs.mjs'), '--file', dryRunPortals, '--dry-run'], {
      cwd: ROOT,
      timeout: 15000,
    });
  } catch {
    // Network is reachable-or-not in CI; either way, no write should occur.
  }
  const afterDryRun = readFileSync(dryRunPortals, 'utf-8');
  if (afterDryRun === beforeDryRun) {
    pass('fix-slugs.mjs --dry-run (default) never writes to portals.yml');
  } else {
    fail('fix-slugs.mjs --dry-run wrote to portals.yml — must require --fix/--apply');
  }
  rmSync(dryRunTmp, { recursive: true, force: true });
} catch (e) {
  fail(`slug auto-fixer tests crashed: ${e.message}`);
}
