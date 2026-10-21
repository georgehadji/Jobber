// tests/providers/huntflow.test.mjs
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — huntflow');

const check = (cond, msg, detail = '') => (cond ? pass(msg) : fail(`${msg}${detail ? ` — ${detail}` : ''}`));

/** Minimal devalue-style encoder (the Nuxt _payload.json layout): every value is a node, refs are indices. */
function encode(root) {
  const nodes = [];
  const add = (v) => {
    const i = nodes.length;
    nodes.push(null);
    if (Array.isArray(v)) nodes[i] = v.map(add);
    else if (v && typeof v === 'object') nodes[i] = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, add(x)]));
    else nodes[i] = v;
    return i;
  };
  add(root);
  return nodes;
}

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/huntflow.mjs')).href);
  const huntflow = mod.default;
  const { parseHuntflowPayload, unflattenPayload } = mod;

  check(huntflow.id === 'huntflow', 'huntflow.id is "huntflow"', JSON.stringify(huntflow.id));

  // detect()
  const hit = huntflow.detect({ name: 'Tripster', careers_url: 'https://tripster.huntflow.io/' });
  check(hit?.url === 'https://tripster.huntflow.io/_payload.json', 'detect() resolves <tenant>.huntflow.io → /_payload.json', JSON.stringify(hit));
  check(huntflow.detect({ name: 'F', careers_url: 'https://thefjx.global.huntflow.io/vacancy/x' })?.url === 'https://thefjx.global.huntflow.io/_payload.json',
    'detect() accepts the <tenant>.global.huntflow.io international form');
  const neg = {
    'wrong host': 'https://example.com/',
    'http scheme': 'http://tripster.huntflow.io/',
    'lookalike evil-huntflow.io': 'https://evil-huntflow.io/',
    'lookalike tripster.huntflow.io.evil.com': 'https://tripster.huntflow.io.evil.com/',
    'bare huntflow.io': 'https://huntflow.io/',
    'vendor www label': 'https://www.huntflow.io/',
    'host in path': 'https://evil.example/tripster.huntflow.io',
    'nested subdomain': 'https://a.b.huntflow.io/',
  };
  for (const [label, u] of Object.entries(neg)) {
    check(huntflow.detect({ name: 'X', careers_url: u }) === null, `detect() rejects ${label}`, JSON.stringify(huntflow.detect({ name: 'X', careers_url: u })));
  }
  check(huntflow.detect({ name: 'X', careers_url: null }) === null && huntflow.detect({ name: 'X', careers_url: 7 }) === null, 'detect() tolerates non-string careers_url');

  // unflattenPayload — the exact layout seen live (ShallowReactive wrapper, shared scalar nodes)
  const live = [
    { data: 1, prerenderedAt: -1 }, ['ShallowReactive', 2], { vacancies: 3 }, { total: 4, page: 4, items: 5 }, 1,
    [6, 11],
    { id: 7, slug: 8, position: 9, money: 10, division: 10, city: 10, archived_at: 10 }, 28460, 'product-manager-partnerskaia-programma', 'Product manager (Партнерская программа)', null,
    { id: 12, slug: 13, position: 14, money: 10, division: 10, city: 15, archived_at: 10 }, 29325, 'pr-menedzher-2', 'PR-менеджер', 'Москва',
  ];
  const tree = unflattenPayload(live);
  check(tree?.data?.vacancies?.items?.length === 2 && tree.data.vacancies.items[1].city === 'Москва' && tree.data.vacancies.items[0].money === null,
    'unflattenPayload resolves wrappers, refs and shared null nodes', JSON.stringify(tree));
  check(unflattenPayload([{ a: 0 }]).a === null && unflattenPayload([{ a: 99 }]).a === null && unflattenPayload('x') === null,
    'unflattenPayload survives self-reference, out-of-range index and non-array input');

  const origin = 'https://tripster.huntflow.io';
  const jobs = parseHuntflowPayload(live, 'Tripster', origin);
  check(jobs.length === 2 && jobs[0].title === 'Product manager (Партнерская программа)' && jobs[0].url === `${origin}/vacancy/product-manager-partnerskaia-programma`
    && jobs[0].company === 'Tripster' && jobs[0].location === '' && jobs[1].location === 'Москва',
    'parseHuntflowPayload maps title/url/company/location from the live layout', JSON.stringify(jobs));

  // Filtering: archived, no title, hostile slug (control: the two valid rows survive)
  const mixed = encode({
    data: { vacancies: { total: 1, page: 1, items: [
      { id: 1, slug: 'good-one', position: ' Good One ', city: 'Berlin', archived_at: null },
      { id: 2, slug: 'closed', position: 'Closed', city: 'X', archived_at: '2026-01-01' },
      { id: 3, slug: 'no-title', position: '   ', city: 'X', archived_at: null },
      { id: 4, slug: '../../evil', position: 'Evil slug', city: 'X', archived_at: null },
      { id: 5, slug: 'good-two', position: 'Good Two', archived_at: null },
      null,
    ] } },
  });
  const filtered = parseHuntflowPayload(mixed, 'Acme', origin);
  check(filtered.map((j) => j.title).join('|') === 'Good One|Good Two', 'parseHuntflowPayload drops archived / untitled / path-traversal-slug rows', filtered.map((j) => j.title).join('|'));
  check(filtered[0].location === 'Berlin' && filtered[1].location === '', 'parseHuntflowPayload location: city or ""');
  check(parseHuntflowPayload([], 'A', origin).length === 0 && parseHuntflowPayload({ not: 'array' }, 'A', origin).length === 0 && parseHuntflowPayload(encode({ data: {} }), 'A', origin).length === 0,
    'parseHuntflowPayload: malformed payloads → []');

  // fetch()
  const calls = [];
  const ctx = { fetchJson: async (url, opts) => { calls.push({ url, opts }); return live; } };
  const fetched = await huntflow.fetch({ name: 'Tripster', careers_url: 'https://tripster.huntflow.io/' }, ctx);
  check(fetched.length === 2 && calls.length === 1 && calls[0].url === 'https://tripster.huntflow.io/_payload.json' && calls[0].opts?.redirect === 'error',
    'fetch() makes one _payload.json request with redirect:"error" and returns jobs', JSON.stringify(calls));

  // SSRF
  for (const u of ['https://evil-huntflow.io/', 'http://tripster.huntflow.io/', 'http://169.254.169.254/', 'https://www.huntflow.io/']) {
    let called = false;
    let threw = false;
    try {
      await huntflow.fetch({ name: 'Evil', careers_url: u }, { fetchJson: async () => { called = true; return []; } });
    } catch {
      threw = true;
    }
    check(threw && !called, `fetch() rejects hostile careers_url ${u} without any request`);
  }
} catch (e) {
  fail(`huntflow provider tests crashed: ${e.message}`);
}
