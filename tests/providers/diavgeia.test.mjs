// tests/providers/diavgeia.test.mjs — Greek public-sector register (Δι@ύγεια).
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — diavgeia');

const mod = await import(pathToFileURL(join(ROOT, 'providers/diavgeia.mjs')).href);
const diavgeia = mod.default;

if (diavgeia.id === 'diavgeia') pass('diavgeia.id is "diavgeia"');
else fail(`diavgeia.id is ${JSON.stringify(diavgeia.id)}`);

// Records the URL the provider builds so the Lucene query can be asserted
// without a network call.
function ctxCapturing(payload) {
  const seen = { url: null, opts: null };
  return {
    seen,
    ctx: {
      async fetchJson(url, opts) {
        seen.url = url;
        seen.opts = opts;
        return payload;
      },
    },
  };
}

const EMPTY = { decisions: [] };

// -- detect() claims the right entries, and only those ------------------------

if (diavgeia.detect({ provider: 'diavgeia' })) pass('detect claims provider: diavgeia');
else fail('detect did not claim an explicit provider: diavgeia entry');

if (diavgeia.detect({ careers_url: 'https://diavgeia.gov.gr/search?x=1' })) pass('detect claims a diavgeia.gov.gr careers_url');
else fail('detect did not claim a diavgeia.gov.gr careers_url');

// Control: a provider that claims everything would also pass the two above.
if (diavgeia.detect({ careers_url: 'https://boards.greenhouse.io/acme' }) === null) pass('detect returns null for an unrelated careers_url');
else fail('detect claimed an unrelated careers_url');

// -- Query construction -------------------------------------------------------

{
  const { seen, ctx } = ctxCapturing(EMPTY);
  await diavgeia.fetch({ name: 'CERTH', organizationUid: '99220974' }, ctx);
  const q = new URL(seen.url).searchParams.get('q');
  const expected = 'organizationUid:"99220974" AND (decisionTypeUid:"Γ.3.1")';
  if (q === expected) pass('default query scopes to the org and the vacancy decision type');
  else fail(`query was ${JSON.stringify(q)}, expected ${JSON.stringify(expected)}`);

  if (seen.opts?.redirect === 'error') pass('fetchJson is called with redirect:"error" (SSRF guard)');
  else fail(`fetchJson opts were ${JSON.stringify(seen.opts)}`);
}

{
  const { seen, ctx } = ctxCapturing(EMPTY);
  await diavgeia.fetch({ organizationUid: 99220974, decisionTypeUids: ['Γ.3.1', 'Γ.3.4'] }, ctx);
  const q = new URL(seen.url).searchParams.get('q');
  if (q === 'organizationUid:"99220974" AND (decisionTypeUid:"Γ.3.1" OR decisionTypeUid:"Γ.3.4")') pass('configured decision types are OR-ed into one clause');
  else fail(`multi-type query was ${JSON.stringify(q)}`);
}

{
  const { seen, ctx } = ctxCapturing(EMPTY);
  await diavgeia.fetch({ organizationUid: '99220974', unitUids: ['77176', 77177] }, ctx);
  const q = new URL(seen.url).searchParams.get('q');
  if (q === 'organizationUid:"99220974" AND (decisionTypeUid:"Γ.3.1") AND (unitUid:"77176" OR unitUid:"77177")') pass('unitUids narrow the query to those units');
  else fail(`unit-scoped query was ${JSON.stringify(q)}`);
}

// Control for the clause above: with no unitUids the AND must not appear at all,
// or an empty list would silently scope the query to nothing.
{
  const { seen, ctx } = ctxCapturing(EMPTY);
  await diavgeia.fetch({ organizationUid: '99220974', unitUids: [] }, ctx);
  const q = new URL(seen.url).searchParams.get('q');
  if (!/unitUid/.test(q)) pass('an empty unitUids list adds no unit clause');
  else fail(`empty unitUids produced ${JSON.stringify(q)}`);
}

// -- Injection rejection, each with its passing control -----------------------

async function rejects(label, entry) {
  const { ctx } = ctxCapturing(EMPTY);
  let threw = null;
  try {
    await diavgeia.fetch(entry, ctx);
  } catch (err) {
    threw = err;
  }
  if (threw) pass(`${label} is rejected (${threw.message.slice(0, 60)})`);
  else fail(`${label} was accepted`);
}

await rejects('organizationUid carrying a Lucene clause', { organizationUid: '1" OR organizationUid:"2' });
await rejects('non-numeric organizationUid', { organizationUid: 'abc' });
await rejects('missing organizationUid', {});
await rejects('decisionTypeUid carrying a quote', { organizationUid: '99220974', decisionTypeUids: ['Γ.3.1" OR x:"y'] });
await rejects('unitUid carrying a Lucene clause', { organizationUid: '99220974', unitUids: ['77176" OR unitUid:"1'] });

// Control for all four: the legitimate shapes they mimic must still be accepted.
{
  const { ctx } = ctxCapturing(EMPTY);
  let threw = null;
  try {
    await diavgeia.fetch({ organizationUid: '99220974', decisionTypeUids: ['Γ.3.1'] }, ctx);
  } catch (err) {
    threw = err;
  }
  if (!threw) pass('a legitimate uid + decision type is still accepted');
  else fail(`legitimate config was rejected: ${threw.message}`);
}

// -- Mapping ------------------------------------------------------------------

const LONG_SUBJECT = `Πρόσκληση Εκδήλωσης Ενδιαφέροντος για υποβολή πρότασης προς σύναψη σύμβασης ανάθεσης έργου για μία (1) θέση έκτακτου προσωπικού, στο πλαίσιο υλοποίησης του ερευνητικού έργου «${'Χ'.repeat(200)}»`;

{
  const { ctx } = ctxCapturing({
    decisions: [
      {
        ada: 'ΡΦ3Ε469ΗΡ8-9ΞΥ',
        protocolNumber: '049676',
        subject: LONG_SUBJECT,
        documentUrl: 'https://diavgeia.gov.gr/doc/ΡΦ3Ε469ΗΡ8-9ΞΥ',
        publishTimestamp: '16/09/2026 20:53:50',
        issueDate: '15/09/2026 03:00:00',
        organization: { label: 'ΕΘΝ. ΚΕΝΤΡΟ ΕΡΕΥΝΑΣ & ΤΕΧΝΟΛΟΓΙΑΣ' },
      },
      // No documentUrl — the permalink must be rebuilt from the ADA.
      { ada: 'ΨΨΨΨ123-ΑΒΓ', protocolNumber: '000001', subject: 'Σύντομο θέμα', issueDate: '01/02/2026' },
      // Dropped: no subject.
      { ada: 'ΧΧΧΧ456-ΔΕΖ', subject: '', documentUrl: 'https://diavgeia.gov.gr/doc/ΧΧΧΧ456-ΔΕΖ' },
      // Dropped: no ADA and no url to rebuild one from.
      { subject: 'Θέμα χωρίς ΑΔΑ' },
    ],
  });

  const jobs = await diavgeia.fetch({ name: 'CERTH', organizationUid: '99220974' }, ctx);

  if (jobs.length === 2) pass('rows without a subject or an ADA are dropped');
  else fail(`expected 2 mapped jobs, got ${jobs.length}: ${JSON.stringify(jobs.map(j => j.title))}`);

  const first = jobs[0];
  if (first?.title.startsWith('[049676] ')) pass('title is prefixed with the protocol number');
  else fail(`title was ${JSON.stringify(first?.title)}`);

  if (first && first.title.length <= 190 && first.title.endsWith('…')) pass('an over-long subject is truncated');
  else fail(`title length ${first?.title.length}, ends ${JSON.stringify(first?.title.slice(-1))}`);

  // Control for the truncation assert: a short subject must come through whole.
  if (jobs[1]?.title === '[000001] Σύντομο θέμα') pass('a short subject is left intact');
  else fail(`short title was ${JSON.stringify(jobs[1]?.title)}`);

  if (first?.postedAt === Date.UTC(2026, 8, 16, 20, 53, 50)) pass('postedAt comes from publishTimestamp');
  else fail(`postedAt was ${first?.postedAt}`);

  if (jobs[1]?.postedAt === Date.UTC(2026, 1, 1, 0, 0, 0)) pass('a date-only issueDate is parsed when publishTimestamp is absent');
  else fail(`fallback postedAt was ${jobs[1]?.postedAt}`);

  if (jobs[1]?.url === `https://diavgeia.gov.gr/doc/${encodeURIComponent('ΨΨΨΨ123-ΑΒΓ')}`) pass('a missing documentUrl is rebuilt from the ADA');
  else fail(`rebuilt url was ${JSON.stringify(jobs[1]?.url)}`);

  if (first?.company === 'CERTH') pass('company falls back to the configured entry name');
  else fail(`company was ${JSON.stringify(first?.company)}`);
}

// An unparseable date must leave the job undated rather than set NaN.
{
  const { ctx } = ctxCapturing({
    decisions: [{ ada: 'ΑΑΑΑ111-ΒΒΓ', subject: 'Θέμα', issueDate: 'not-a-date', publishTimestamp: '' }],
  });
  const [job] = await diavgeia.fetch({ organizationUid: '99220974' }, ctx);
  if (job && !('postedAt' in job)) pass('an unparseable date leaves postedAt unset');
  else fail(`postedAt was ${JSON.stringify(job?.postedAt)}`);
}

// A response that is not the documented shape must throw, not return [].
{
  const { ctx } = ctxCapturing({ error: 'maintenance' });
  let threw = null;
  try {
    await diavgeia.fetch({ organizationUid: '99220974' }, ctx);
  } catch (err) {
    threw = err;
  }
  if (threw && /unexpected API response/.test(threw.message)) pass('an unexpected payload throws instead of returning zero jobs');
  else fail(`bad payload produced ${threw ? threw.message : 'no error'}`);
}
