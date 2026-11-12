// tests/machine-reply-candidate.test.mjs — STATE-MACHINES-PLAN Phase 4.5 (M15): reply-candidate machine.
// Declaration only: asserts templates/machines/reply-candidate.yml matches what reply-matcher.mjs /
// paste-reply.mjs / reply-watch.mjs really produce. Nothing is enforced.
import { pass, fail, ROOT } from './helpers.mjs';
import { readFileSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { loadMachine, canonicalize, check } from '../lib/state-machine.mjs';
import { classifyReply } from '../reply-matcher.mjs';

console.log('\nreply-candidate state machine (Phase 4.5 / M15)');

const eq = (label, got, want) => (JSON.stringify(got) === JSON.stringify(want) ? pass(label) : fail(`${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`));
const machine = loadMachine('reply-candidate');
const tracker = loadMachine('application-status');
// pending is "in the file"; applied is the tracker write: neither is a classifier `type`.
const CLASSIFIED = machine.states.filter(s => s.id !== 'pending' && s.id !== 'applied').map(s => s.label);

eq('loads valid: initial pending, applied is the only terminal state', [machine.initial, machine.states.filter(s => s.terminal).map(s => s.id)], ['pending', ['applied']]);

// ── behavioural parity: every type classifyReply can return is a state, and each fixture hits its own ──
const FIXTURES = [
  ['Noise', { subject: 'Zhaopin job alert', body_snippet: '', signal: null }, 'none'],
  ['Rejected', { subject: 'x', body_snippet: '', signal: 'rejection' }, 'Rejected'],
  ['Offer', { subject: 'x', body_snippet: '', signal: 'offer' }, 'Offer'],
  ['Auto-confirmation', { subject: 'Application received', body_snippet: '', signal: null }, 'none'],
  ['Need Action', { subject: 'Online test', body_snippet: 'please finish before the deadline', signal: null }, 'Responded'],
  ['Interview', { subject: 'x', body_snippet: '', signal: 'interview_invite' }, 'Interview'],
  ['Responded', { subject: 'x', body_snippet: '', signal: 'update' }, 'Responded'],
  ['Unknown', { subject: 'hello', body_snippet: 'nothing relevant', signal: null }, 'Needs Review'],
];
const got = FIXTURES.map(([, cand]) => classifyReply(cand));
eq('each fixture is classified as the type it was built for (so the parity set below is exercised, not assumed)',
  got.map(g => g.type), FIXTURES.map(([t]) => t));
eq('every classifyReply type is a state label of the machine (by canonicalize)',
  got.map(g => canonicalize(machine, g.type)?.label ?? `MISSING:${g.type}`), FIXTURES.map(([t]) => t));
eq('...and the 8 classified states are exactly the 8 types exercised (no declared-but-unreachable state)',
  [...CLASSIFIED].sort(), FIXTURES.map(([t]) => t).sort());
eq('scheduling wording turns a Need Action suggestion into Interview (the only branch with two outputs)',
  classifyReply({ subject: 'Online test', body_snippet: 'please pick a time', signal: null }).suggestedTrackerUpdate, 'Interview');

// suggestedTrackerUpdate is either a sentinel or a real application-status label (cross-machine)
const SENTINELS = ['none', 'Needs Review'];
const updates = [...got.map(g => g.suggestedTrackerUpdate), 'Interview'];
eq('every suggestedTrackerUpdate is none, Needs Review, or an application-status label',
  updates.filter(u => !SENTINELS.includes(u) && !canonicalize(tracker, u)), []);
eq('control: a made-up status is NOT an application-status label (the check above can fail)', !!canonicalize(tracker, 'Maybe'), false);

// ── source parity: no `type:` literal in the classifier is missing from the machine ──
const labels = src => [...src.matchAll(/\btype:\s*'([^']+)'/g)].map(m => m[1]);
const SRC = readFileSync(join(ROOT, 'reply-matcher.mjs'), 'utf-8');
const inSource = [...new Set(labels(SRC))];
eq('every `type: \'...\'` literal in reply-matcher.mjs is a classified state label', inSource.filter(t => !CLASSIFIED.includes(t)), []);
eq('...and every classified label appears in the source (no stale state)', CLASSIFIED.filter(t => !inSource.includes(t)), []);
eq('control: the same scan over a source with an extra type reports it as missing',
  labels(`${SRC}\n{ type: 'Snoozed' }`).filter(t => !CLASSIFIED.includes(t)), ['Snoozed']);

// ── the signal values are documented on the pending state; paste-reply writes null ──
const SIGNALS = [...new Set([...SRC.matchAll(/signal === '([a-z_]+)'/g)].map(m => m[1]))].sort();
eq('the classifier reads exactly the four documented signals', SIGNALS, ['interview_invite', 'offer', 'rejection', 'update']);
const pendingDesc = machine.states.find(s => s.id === 'pending').description;
eq('the pending description names every signal value', SIGNALS.filter(s => !pendingDesc.includes(s)), []);
const { normalizeCandidate } = await import(pathToFileURL(join(ROOT, 'paste-reply.mjs')).href);
const pasted = normalizeCandidate({ subject: 's', from: 'f', body: 'b' });
eq('paste-reply writes signal null and NO lifecycle field (pending is implicit)', [pasted.signal, Object.keys(pasted).sort()], [null, ['body_snippet', 'from', 'message_id', 'signal', 'subject']]);
const a = normalizeCandidate({ subject: 's', from: 'f', body: 'b' }).message_id;
const b = normalizeCandidate({ subject: 's', from: 'f', body: 'b' }).message_id;
eq('known gap pinned: ids are synthesized per paste, never derived from content (no dedupe of the same email)', [a !== b, /^pasted-\d+-[a-z0-9]+$/.test(a)], [true, true]);

// ── check() kinds ──
eq('pending -> interview is a declared forward move', check(machine, 'Pending', 'Interview').kind, 'forward');
eq('interview -> applied is a declared forward move', check(machine, 'interview', 'applied').kind, 'forward');
eq('noise -> applied is NOT declared (nothing is applied for Noise): allowed only as a correction', check(machine, 'noise', 'applied').kind, 'correction');
eq('applied -> pending leaves the terminal state: needs an override', [check(machine, 'applied', 'pending').kind, check(machine, 'applied', 'pending').ok], ['terminal-exit', false]);
eq('an undeclared target is reported as unknown-to', check(machine, 'pending', 'Snoozed').kind, 'unknown-to');
