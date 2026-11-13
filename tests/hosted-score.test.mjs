// tests/hosted-score.test.mjs — hosted "score" task through OpenRouter (fake endpoint):
// request shape and privacy routing, cost accounting, failures, refunds, config.
import { pass as emitPass, fail as emitFail, warn } from './helpers.mjs';
import { createApp, readConfig, GAP_TASK } from '../server/index.mjs';
import { createLimits } from '../server/limits.mjs';
import { createScoreTask, TaskError } from '../server/score.mjs';

console.log('\nhosted server (score task)');

const queued = [];
const pass = (m) => queued.push(() => emitPass(m));
const fail = (m) => queued.push(() => emitFail(m));
const logged = [];
const realLog = console.log, realErr = console.error;
const quiet = () => { console.log = (...a) => logged.push(a.join(' ')); console.error = (...a) => logged.push(a.join(' ')); };
const loud = () => { console.log = realLog; console.error = realErr; };

// Markers built by concatenation so this file never contains the strings it searches for.
const CV_MARK = 'Zeb' + 'ulon' + 'Quixote';
const JOB_MARK = 'Ferd' + 'inand' + 'Plover';
const CV = `# Skills\nPython\n\n# Experience\nBuilt ${CV_MARK} reporting tools.\n`;
const JOB = `Operations Analyst at ${JOB_MARK} Logistics.\n\n## Requirements\n- Python, SQL, Tableau\n\nWe need an analyst to build weekly delivery reports for the planning team.`;
const REPLY = `## Block A\nSome **bold** text.\n\n| Dimension | Score |\n|---|---|\n| Skills | 3 |\n\n---SCORE_SUMMARY---\nCOMPANY: Northfield\nROLE: Operations Analyst\nSCORE: 3.4\nARCHETYPE: Analyst\nLEGITIMACY: High Confidence\n---END_SUMMARY---\n`;
const PRICE = { prompt: 1, completion: 2 };

const okReply = (content = REPLY, usage = { cost: 0.0123 }) => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content } }], usage }) });
const recorder = (reply = okReply) => { const calls = []; const fetchFn = async (url, init) => { calls.push({ url, init, body: JSON.parse(init.body) }); return reply(); }; return { calls, fetchFn }; };
const mk = (over = {}) => createScoreTask({ apiKey: 'or-key', model: 'vendor/model-x', maxPricePerM: PRICE, ...over });

quiet();
try {
  // 1. Request shape: privacy routing, price cap, auth, data in the USER message only. Control: zdr only when asked.
  try {
    const r = recorder();
    await mk({ fetchFn: r.fetchFn }).run(CV, JOB);
    const c = r.calls[0];
    const [sys, user] = c.body.messages;
    const rz = recorder();
    await mk({ fetchFn: rz.fetchFn, zdr: true }).run(CV, JOB);
    const p = c.body.provider;
    if (c.url === 'https://openrouter.ai/api/v1/chat/completions' && c.init.headers.Authorization === 'Bearer or-key'
      && c.body.model === 'vendor/model-x' && c.body.stream === false && c.body.max_tokens > 0
      && p.data_collection === 'deny' && p.max_price.prompt === 1 && p.max_price.completion === 2 && p.zdr === undefined
      && rz.calls[0].body.provider.zdr === true && rz.calls[0].body.provider.data_collection === 'deny') {
      pass('request: data_collection=deny, price caps, auth and model set; zdr added only when enabled');
    } else fail(`request shape: ${JSON.stringify({ url: c.url, p, model: c.body.model, mt: c.body.max_tokens })}`);

    if (sys.role === 'system' && user.role === 'user' && !sys.content.includes(CV_MARK) && !sys.content.includes(JOB_MARK)
      && user.content.includes(CV_MARK) && user.content.includes(JOB_MARK) && /untrusted/i.test(sys.content)) {
      pass('CV and job travel in the user message inside markers; the system prompt carries neither and warns they are untrusted');
    } else fail('CV or job text is in the system prompt, or missing from the user message');
  } catch (e) { fail(`request-shape test crashed: ${e.message}`); }

  // 2. Parsing and cost: usage.cost is charged; missing cost charges the full reservation (control: both paths).
  try {
    const task = mk({ fetchFn: recorder().fetchFn });
    const a = await task.run(CV, JOB);
    const b = await mk({ fetchFn: recorder(() => okReply(REPLY, {})).fetchFn }).run(CV, JOB);
    const reserved = task.maxCostUsd(CV, JOB);
    const r = a.result;
    if (r.task === 'score' && r.score === 3.4 && r.role === 'Operations Analyst' && r.company === 'Northfield' && r.legitimacy === 'High Confidence'
      && !r.report.includes('SCORE_SUMMARY') && r.report.includes('Block A') && a.costUsd === 0.0123
      && b.costUsd === reserved && reserved > 0.0123) pass('score: fields parsed, summary block stripped, real cost charged, missing cost charges the reservation');
    else fail(`parse/cost: ${JSON.stringify({ r, a: a.costUsd, b: b.costUsd, reserved })}`);

    const noScore = await mk({ fetchFn: recorder(() => okReply('Just prose, no summary block.')).fetchFn }).run(CV, JOB);
    if (noScore.result.score === null && noScore.result.report.includes('Just prose')) pass('a reply without a summary block gives score null and keeps the report');
    else fail(`no-summary reply: ${JSON.stringify(noScore.result)}`);
  } catch (e) { fail(`parse/cost test crashed: ${e.message}`); }

  // 3. Failures become a TaskError(503) whose message leaks nothing.
  try {
    const cases = {
      'network error': () => { throw new Error(`boom ${CV_MARK}`); },
      'HTTP 500': () => ({ ok: false, status: 500, json: async () => ({}) }),
      'empty reply': () => okReply('   '),
      'bad JSON': () => ({ ok: true, status: 200, json: async () => { throw new Error('bad'); } }),
    };
    const bad = [];
    for (const [name, reply] of Object.entries(cases)) {
      try { await mk({ fetchFn: async () => reply() }).run(CV, JOB); bad.push(`${name}: no error`); }
      catch (e) { if (!(e instanceof TaskError) || e.status !== 503 || e.message.includes(CV_MARK) || e.message.includes('boom')) bad.push(`${name}: ${e.message}`); }
    }
    if (bad.length === 0) pass('upstream failures (network, 500, empty, bad JSON) are TaskError 503 with a generic message');
    else fail(`failure handling: ${bad.join('; ')}`);
  } catch (e) { fail(`failure test crashed: ${e.message}`); }

  // 4. Size limits.
  try {
    const t = mk({ fetchFn: recorder().fetchFn });
    if (t.check(CV, JOB) === null && /CV is too long/.test(t.check('x'.repeat(30_001), JOB)) && /job description is too long/.test(t.check(CV, 'x'.repeat(20_001)))) pass('size limits: normal input passes; oversize CV and job get a reason');
    else fail('size limit checks wrong');
  } catch (e) { fail(`size limit test crashed: ${e.message}`); }

  // 5. Through the server: result, spend, refund on failure, budget refusal, logs.
  const form = (task, { cv = CV, job = JOB } = {}) => {
    const f = new FormData();
    f.set('task', task); f.set('job', job); f.set('cv', new Blob([cv]), 'cv.md');
    return f;
  };
  const start = (opts) => new Promise((res) => {
    const server = createApp(opts);
    server.listen(0, '127.0.0.1', () => res({ server, base: `http://127.0.0.1:${server.address().port}` }));
  });
  const send = (base, task) => fetch(`${base}/api/evaluate`, { method: 'POST', body: form(task) });

  let ctx;
  try {
    const limits = createLimits({ dailyLimit: 1, dailyBudgetUsd: 1 });
    let mode = 'ok';
    const score = mk({ fetchFn: async () => (mode === 'ok' ? okReply() : { ok: false, status: 500, json: async () => ({}) }) });
    ctx = await start({ limits, tasks: { gap: GAP_TASK, score } });
    mode = 'down';
    const failed = await send(ctx.base, 'score');
    const failedBody = await failed.json();
    const spentAfterFail = limits.spentTodayUsd();
    mode = 'ok';
    const good = await send(ctx.base, 'score');           // limit is 1: only works if the failed call was refunded
    const goodUrl = (await good.json()).resultUrl;
    const result = await (await fetch(`${ctx.base}${goodUrl.replace('/result.html#', '/api/result/')}`)).json();
    const again = await send(ctx.base, 'score');          // control: the delivered check is now used up
    if (failed.status === 503 && /did not use one of your checks/.test(failedBody.error) && spentAfterFail === 0
      && good.status === 200 && result.result.score === 3.4 && Math.abs(limits.spentTodayUsd() - 0.0123) < 1e-9 && again.status === 429) {
      pass('server: failed score costs nothing and is refunded; delivered score is stored, charged usage.cost, and uses the check');
    } else fail(`server score flow: failed ${failed.status} spent ${spentAfterFail}, good ${good.status}, spent ${limits.spentTodayUsd()}, again ${again.status}`);
  } catch (e) { fail(`server score flow crashed: ${e.message}`); }
  finally { ctx?.server.close(); }

  try {
    const limits = createLimits({ dailyBudgetUsd: 0.001 });  // far below one request's worst case
    const score = mk({ fetchFn: recorder().fetchFn });
    ctx = await start({ limits, tasks: { gap: GAP_TASK, score } });
    const s = await send(ctx.base, 'score');
    const sBody = await s.json();
    const g = await send(ctx.base, 'gap');
    if (s.status === 503 && /budget/.test(sBody.error) && g.status === 200) pass('budget too small for a score request: refused with 503; the free gap task still works');
    else fail(`budget refusal: score ${s.status}, gap ${g.status}`);
  } catch (e) { fail(`budget test crashed: ${e.message}`); }
  finally { ctx?.server.close(); }

  const text = logged.join('\n');
  if (!text.includes(CV_MARK) && !text.includes(JOB_MARK) && !text.includes('Block A') && /"status":200/.test(text)) pass('logs hold request lines and none of the CV, job or model reply');
  else fail('logs leaked CV, job or reply text, or no request lines were logged');

  // 6. Config: score is off without a key; a key needs a model and price caps; complete config enables it.
  try {
    const base = { PATH: process.env.PATH, JOBBER_DEV: '1', JOBBER_DB: ':memory:' };
    const off = readConfig(base);
    const noModel = readConfig({ ...base, OPENROUTER_API_KEY: 'k' });
    const badPrice = readConfig({ ...base, OPENROUTER_API_KEY: 'k', JOBBER_SCORE_MODEL: 'm', JOBBER_SCORE_MAX_PRICE_PROMPT: '0', JOBBER_SCORE_MAX_PRICE_COMPLETION: '2' });
    const on = readConfig({ ...base, OPENROUTER_API_KEY: 'k', JOBBER_SCORE_MODEL: 'm', JOBBER_SCORE_MAX_PRICE_PROMPT: '1', JOBBER_SCORE_MAX_PRICE_COMPLETION: '2' });
    if (!off.options.tasks.score && noModel.errors.some((e) => e.includes('JOBBER_SCORE_MODEL')) && badPrice.errors.some((e) => e.includes('MAX_PRICE'))
      && on.errors.length === 0 && typeof on.options.tasks.score?.run === 'function') pass('config: score is off without a key; key needs model and price caps; complete config enables it');
    else fail(`score config: ${JSON.stringify({ off: Object.keys(off.options.tasks), noModel: noModel.errors, badPrice: badPrice.errors, on: on.errors })}`);
    off.options.limits.close(); on.options.limits.close();
  } catch (e) { fail(`config test crashed: ${e.message}`); }
} catch (e) {
  fail(`hosted score tests crashed: ${e.stack || e.message}`);
} finally {
  loud();
}

queued.forEach((f) => f());
