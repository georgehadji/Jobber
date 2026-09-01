// tests/providers/apec.test.mjs
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';

console.log('\nProvider — apec');

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/apec.mjs')).href);
  const provider = mod.default;
  const { parseApecConfig, parseApecSalary, normalizeJob } = mod;

  if (provider.id === 'apec') pass('apec.id is "apec"');
  else fail(`apec.id is ${JSON.stringify(provider.id)}`);

  // detect() — explicit-only
  if (provider.detect({ provider: 'apec' })?.url && provider.detect({ careers_url: 'https://example.invalid' }) === null) {
    pass('detect() claims only an explicit provider:"apec" entry');
  } else {
    fail('detect() should be explicit-only');
  }

  // parseApecConfig — defaults + clamping
  const def = parseApecConfig({});
  if (def.keywords.length === 0 && def.pageSize === 100 && def.typeClient === 'CADRE') {
    pass('parseApecConfig applies defaults (pageSize 100, typeClient CADRE)');
  } else {
    fail(`parseApecConfig defaults = ${JSON.stringify(def)}`);
  }
  const cfg = parseApecConfig({ apec: { keywords: ['  ML  ', '', 'NLP'], page_size: 500, type_client: ' JEUNE_DIPLOME ' } });
  if (cfg.keywords.length === 2 && cfg.pageSize === 100 && cfg.typeClient === 'JEUNE_DIPLOME') {
    pass('parseApecConfig trims keywords, clamps page_size to API max 100, and trims type_client');
  } else {
    fail(`parseApecConfig sanitized = ${JSON.stringify(cfg)}`);
  }

  // parseApecSalary — only an explicit "brut annuel" k€ figure is trusted
  const range = parseApecSalary('45 - 55 k€ brut annuel');
  if (range && range.min === 45000 && range.max === 55000 && range.currency === 'EUR') {
    pass('parseApecSalary parses an explicit annual-gross k€ range');
  } else {
    fail(`parseApecSalary range = ${JSON.stringify(range)}`);
  }
  const single = parseApecSalary('60 k€ brut annuel');
  if (single && single.min === 60000 && single.max === 60000 && single.currency === 'EUR') {
    pass('parseApecSalary parses a single annual-gross k€ figure as min===max');
  } else {
    fail(`parseApecSalary single = ${JSON.stringify(single)}`);
  }
  if (parseApecSalary('3 500 € brut mensuel') === undefined) pass('parseApecSalary rejects a monthly figure');
  else fail('parseApecSalary should reject "brut mensuel"');
  if (parseApecSalary('TJM 500€') === undefined) pass('parseApecSalary rejects a TJM (day-rate) figure');
  else fail('parseApecSalary should reject a TJM figure');
  if (parseApecSalary('Selon profil') === undefined && parseApecSalary(null) === undefined && parseApecSalary('') === undefined) {
    pass('parseApecSalary returns undefined for free text with no interval word, and for null/empty');
  } else {
    fail('parseApecSalary should return undefined for unparseable/empty input');
  }

  // normalizeJob — happy path, uses intitule (not the highlighted variant)
  const norm = normalizeJob({
    intitule: 'Machine Learning Engineer',
    intituleSurbrillance: 'Machine <em>Learning</em> Engineer',
    numeroOffre: '179283743W',
    nomCommercial: 'PMEJOB',
    lieuTexte: 'Lille - 59',
    texteOffre: 'En tant que consultant...',
    datePublication: '2026-08-20T00:32:28.000+0000',
    salaireTexte: '45 - 55 k€ brut annuel',
  });
  if (norm && norm.title === 'Machine Learning Engineer'
      && norm.url === 'https://www.apec.fr/candidat/recherche-emploi.html/emploi/detail-offre/179283743W'
      && norm.company === 'PMEJOB' && norm.location === 'Lille - 59'
      && norm.description === 'En tant que consultant...'
      && Number.isFinite(norm.postedAt)
      && norm.salary && norm.salary.min === 45000 && norm.salary.max === 55000) {
    pass('normalizeJob builds the detail URL from numeroOffre, prefers plain intitule, and parses salary');
  } else {
    fail(`normalizeJob = ${JSON.stringify(norm)}`);
  }

  // normalizeJob — rejects missing/malformed numeroOffre
  if (normalizeJob({ intitule: 'X' }) === null) pass('normalizeJob drops a hit with no numeroOffre');
  else fail('normalizeJob should require a numeroOffre');
  if (normalizeJob({ intitule: 'X', numeroOffre: '../../etc/passwd' }) === null) {
    pass('normalizeJob rejects a numeroOffre that fails the strict id pattern');
  } else {
    fail('normalizeJob should validate numeroOffre against NUMERO_OFFRE_RE');
  }

  // fetch() — pagination via totalCount, dedup across keywords, partial-failure tolerance
  const mkHit = (id, title) => ({ intitule: title, numeroOffre: id, nomCommercial: 'Co', lieuTexte: 'Paris' });
  const fetched = await provider.fetch(
    { name: 'APEC', apec: { keywords: ['ML', 'NLP'], page_size: 2 } },
    {
      fetchJson: async (url, opts) => {
        const { motsCles, pagination } = JSON.parse(opts.body);
        if (motsCles === 'ML') {
          return pagination.startIndex === 0
            ? { resultats: [mkHit('1', 'ML Engineer')], totalCount: 1 }
            : { resultats: [], totalCount: 1 };
        }
        // NLP: two pages of results (totalCount forces a second page fetch).
        return pagination.startIndex === 0
          ? { resultats: [mkHit('1', 'ML Engineer'), mkHit('2', 'NLP A')], totalCount: 3 }
          : { resultats: [mkHit('3', 'NLP B')], totalCount: 3 };
      },
    },
  );
  if (fetched.length === 3 && new Set(fetched.map(j => j.url)).size === 3) {
    pass('apec.fetch() paginates using totalCount and dedups by url across keywords');
  } else {
    fail(`apec.fetch() returned ${JSON.stringify(fetched.map(j => j.url))}`);
  }

  // fetch() — sends POST with expected body shape
  let sentMethod = null, sentBody = null;
  await provider.fetch(
    { name: 'APEC', apec: { keywords: ['ML'] } },
    { fetchJson: async (url, opts) => { sentMethod = opts.method; sentBody = JSON.parse(opts.body); return { resultats: [], totalCount: 0 }; } },
  );
  if (sentMethod === 'POST' && sentBody.motsCles === 'ML' && sentBody.typeClient === 'CADRE') {
    pass('apec.fetch() POSTs the expected rechercheOffre request body');
  } else {
    fail(`apec.fetch() request = method=${sentMethod}, body=${JSON.stringify(sentBody)}`);
  }

  // fetch() — profile.yml fallback (hermetic tmp cwd)
  {
    const withTmpCwd = async (setup, run) => {
      const tmp = mkdtempSync(join(tmpdir(), 'jobber-apec-fallback-'));
      const cwdBefore = process.cwd();
      try {
        setup(tmp);
        process.chdir(tmp);
        return await run();
      } finally {
        process.chdir(cwdBefore);
      }
    };

    let sentMotsCles = null;
    await withTmpCwd(
      (tmp) => {
        mkdirSync(join(tmp, 'config'));
        writeFileSync(join(tmp, 'config', 'profile.yml'), 'target_roles:\n  primary:\n    - Data Engineer\n');
      },
      () => provider.fetch(
        { name: 'APEC', apec: {} },
        { fetchJson: async (url, opts) => { sentMotsCles = JSON.parse(opts.body).motsCles; return { resultats: [], totalCount: 0 }; } },
      ),
    );
    if (sentMotsCles === 'Data Engineer') pass('apec.fetch() falls back to config/profile.yml target_roles');
    else fail(`apec.fetch() fallback motsCles = ${JSON.stringify(sentMotsCles)}`);

    let threw = false;
    try {
      await withTmpCwd(() => {}, () => provider.fetch({ name: 'APEC empty', apec: {} }, { fetchJson: async () => ({ resultats: [], totalCount: 0 }) }));
    } catch { threw = true; }
    if (threw) pass('apec.fetch() throws when no keywords are available from any source');
    else fail('apec.fetch() should throw without keywords');
  }

  // fetch() — total outage throws; partial success does not
  let outage = false;
  try {
    await provider.fetch({ name: 'APEC', apec: { keywords: ['ML'] } }, { fetchJson: async () => { throw new Error('HTTP 503'); } });
  } catch { outage = true; }
  if (outage) pass('apec.fetch() throws when every keyword request fails');
  else fail('apec.fetch() should throw on total outage');

  let partialThrew = false;
  let partial;
  try {
    partial = await provider.fetch(
      { name: 'APEC', apec: { keywords: ['OK', 'BAD'] } },
      { fetchJson: async (url, opts) => {
          if (JSON.parse(opts.body).motsCles === 'BAD') throw new Error('HTTP 503');
          return { resultats: [], totalCount: 0 };
        } },
    );
  } catch { partialThrew = true; }
  if (!partialThrew && Array.isArray(partial) && partial.length === 0) {
    pass('apec.fetch() does not throw when one keyword succeeds empty and another fails');
  } else {
    fail(`apec.fetch() partial-success threw=${partialThrew}, result=${JSON.stringify(partial)}`);
  }
} catch (e) {
  fail(`apec provider tests crashed: ${e.message}`);
}
