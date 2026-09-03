// tests/gmail-plugin-dryrun.test.mjs — plugins/gmail/index.mjs ingest() must not
// persist its processed-message-id cursor (data/gmail-state.json) on a
// --dry-run invocation (defect-hunt batch 3, B3-D1). Before the fix, a
// dry-run silently marked messages processed, so a real run afterward
// skipped them forever — permanent, silent loss of job leads. Runs the real
// plugin module against a mocked ctx.fetch in an isolated cwd; touches no
// real repo files.
import { mkdtempSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pass, fail } from './helpers.mjs';
import gmailPlugin from '../plugins/gmail/index.mjs';

console.log('\nplugins/gmail/index.mjs — dry-run must not persist processed-id state (B3-D1)');

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const b64url = (s) => Buffer.from(s, 'utf-8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function mockFetch(url) {
  if (url === TOKEN_URL) return { ok: true, json: async () => ({ access_token: 'fake-token' }) };
  if (url.startsWith(`${GMAIL_API}/messages?`)) return { ok: true, json: async () => ({ messages: [{ id: 'msg-1' }], nextPageToken: null }) };
  if (url === `${GMAIL_API}/messages/msg-1?format=full`) {
    const body = 'Check out https://boards.greenhouse.io/acme/jobs/123 for this role.';
    return { ok: true, json: async () => ({ payload: { headers: [{ name: 'Authentication-Results', value: 'dmarc=pass' }, { name: 'Subject', value: 'Software Engineer at Acme' }], body: { data: b64url(body) } } }) };
  }
  throw new Error(`unexpected fetch: ${url}`);
}

async function runIngestIn(cwd, dryRun) {
  const orig = process.cwd();
  process.chdir(cwd);
  try {
    const ctx = { env: { GMAIL_CLIENT_ID: 'id', GMAIL_CLIENT_SECRET: 'secret', GMAIL_REFRESH_TOKEN: 'refresh' }, settings: {}, fetch: mockFetch, log: () => {}, dryRun };
    const jobs = await gmailPlugin.ingest(ctx);
    return { jobs, statePersisted: existsSync(join(cwd, 'data', 'gmail-state.json')) };
  } finally {
    process.chdir(orig);
  }
}

try {
  const dryCwd = mkdtempSync(join(tmpdir(), 'gmail-dryrun-test-'));
  try {
    const { jobs, statePersisted } = await runIngestIn(dryCwd, true);
    if (jobs.length === 1 && statePersisted === false) {
      pass('dry-run returns the found job(s) but writes no state file');
    } else {
      fail(`dry-run should find 1 job and persist nothing: jobs=${jobs.length}, statePersisted=${statePersisted}`);
    }
  } finally {
    rmSync(dryCwd, { recursive: true, force: true });
  }

  // No-regression: a real (non-dry-run) invocation must still persist the cursor.
  const realCwd = mkdtempSync(join(tmpdir(), 'gmail-realrun-test-'));
  try {
    const { statePersisted } = await runIngestIn(realCwd, false);
    if (statePersisted === true) {
      pass('a real (non-dry-run) run still persists the processed-id cursor');
    } else {
      fail('a real run should still persist data/gmail-state.json');
    }
  } finally {
    rmSync(realCwd, { recursive: true, force: true });
  }

  // The actual user-facing claim, end to end in ONE state directory: a dry-run
  // preview followed by a real run must still ingest the previewed message.
  // The two isolated checks above prove each half separately; this proves the
  // sequence itself, which is the shape the defect actually took (dry-run
  // marks msg-1 processed → the real run afterward skips it forever).
  const seqCwd = mkdtempSync(join(tmpdir(), 'gmail-sequence-test-'));
  try {
    const dry = await runIngestIn(seqCwd, true);
    const real = await runIngestIn(seqCwd, false);
    if (dry.jobs.length === 1 && real.jobs.length === 1 && real.statePersisted === true) {
      pass('a real run after a dry-run in the SAME state dir still ingests the previewed message');
    } else {
      fail(`dry-run poisoned the cursor for the following real run: dryJobs=${dry.jobs.length}, realJobs=${real.jobs.length}, statePersisted=${real.statePersisted}`);
    }
  } finally {
    rmSync(seqCwd, { recursive: true, force: true });
  }
} catch (e) {
  fail(`gmail dry-run test crashed: ${e.message}`);
}
