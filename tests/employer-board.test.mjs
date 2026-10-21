// tests/employer-board.test.mjs — lib/employer-board.mjs + scan.mjs employer-board:
// segment (docs/FREEHIRE-INTEGRATION-PLAN.md Phase 7, ATS cross-check).
import { pass, fail, ROOT } from './helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nEmployer-board cross-check — job-board offers vs the employer\'s own board');

const { sameOpening, indexEmployerBoards, crossCheckEmployerBoards } = await import(pathToFileURL(join(ROOT, 'lib/employer-board.mjs')).href);
const { formatEmployerBoardSegment, formatPipelineOffer } = await import(pathToFileURL(join(ROOT, 'scan.mjs')).href);

// sameOpening: lenient on syndication noise, strict on different roles (each paired with its control).
{
  const same = [
    ['Platform Engineer (m/w/d)', 'Platform Engineer'],
    ['Platform Engineer - Berlin', 'Platform Engineer | Remote'],
    ['Senior Backend Engineer (Remote)', 'Backend Engineer, Senior'],
    ['Software Engineer', 'Senior Software Engineer, Payments'],
  ];
  const different = [
    ['Data Analyst', 'Senior Backend Engineer'],
    ['Senior Data Engineer', 'Junior Data Engineer'],
    ['Product Manager', 'Product Designer'],
    ['Engineer', 'Data Engineer'],
  ];
  const missedSame = same.filter(([a, b]) => !sameOpening(a, b));
  const wrongSame = different.filter(([a, b]) => sameOpening(a, b));
  if (missedSame.length === 0) pass('sameOpening matches the same role across gender markers, locations, work mode and seniority order');
  else fail(`sameOpening missed: ${JSON.stringify(missedSame)}`);
  if (wrongSame.length === 0) pass('sameOpening keeps different roles and conflicting seniority apart');
  else fail(`sameOpening wrongly matched: ${JSON.stringify(wrongSame)}`);
}

// indexEmployerBoards: keyed by entry name and posting company; empty boards are no coverage.
const boards = indexEmployerBoards([
  { name: 'Acme Inc.', provider: 'greenhouse', jobs: [{ title: 'Platform Engineer', company: 'Acme' }, { title: 'Data Analyst' }] },
  { name: 'Ghostco', provider: 'lever', jobs: [] },
]);
if (boards.get('acme')?.titles.length === 2 && !boards.has('ghostco')) pass('indexEmployerBoards keys by normalized company and skips an empty board (no coverage)');
else fail(`indexEmployerBoards keys = ${JSON.stringify([...boards.keys()])}`);

// crossCheckEmployerBoards: listed / not listed / no coverage / not a job-board offer.
{
  const offers = [
    { fromBoard: true, company: 'ACME', title: 'Platform Engineer (m/w/d)' },
    { fromBoard: true, company: 'Acme', title: 'Head of Sales' },
    { fromBoard: true, company: 'Ghostco', title: 'Head of Sales' },
    { fromBoard: true, company: 'Unknown Ltd', title: 'Head of Sales' },
    { fromBoard: false, company: 'Acme', title: 'Head of Sales' },
  ];
  const stats = crossCheckEmployerBoards(offers, boards);
  if (offers[0].employerBoard?.listed === true && offers[1].employerBoard?.listed === false
      && offers[1].employerBoard.board === 'Acme Inc.' && offers[1].employerBoard.postings === 2) {
    pass('a role on the employer board is listed; a role missing from it is not, with the board named and counted');
  } else fail(`cross-check results = ${JSON.stringify(offers.slice(0, 2).map((o) => o.employerBoard))}`);
  if (!('employerBoard' in offers[2]) && !('employerBoard' in offers[3]) && !('employerBoard' in offers[4])) {
    pass('no verdict without coverage: empty-board company, untracked company and the employer\'s own offers are left unchecked');
  } else fail('cross-check stamped an offer it had no coverage for');
  if (stats.checked === 2 && stats.notListed === 1) pass('crossCheckEmployerBoards reports checked/notListed counts');
  else fail(`stats = ${JSON.stringify(stats)}`);
}

// Pipeline segment: facts only, only for "not listed", ordered before note:.
{
  const notListed = { url: 'https://boards.example/1', company: 'Acme', title: 'Head of Sales', note: 'n',
    employerBoard: { listed: false, board: 'Acme Inc.', provider: 'greenhouse', postings: 2 } };
  const seg = formatEmployerBoardSegment(notListed);
  if (seg === 'employer-board: not listed (Acme Inc. greenhouse board, 2 postings)') pass('employer-board: segment states which board was checked and its size');
  else fail(`segment = ${JSON.stringify(seg)}`);
  if (!/ghost|fake|scam|risk/i.test(seg)) pass('employer-board: segment carries no verdict word');
  else fail(`segment uses a verdict word: ${seg}`);
  const line = formatPipelineOffer(notListed);
  if (line.indexOf('| employer-board:') > 0 && line.indexOf('| employer-board:') < line.indexOf('| note:')) pass('employer-board: rides before note: in the pipeline line');
  else fail(`pipeline line = ${line}`);
  if (formatEmployerBoardSegment({ employerBoard: { listed: true, board: 'Acme', provider: 'gh', postings: 2 } }) === ''
      && formatEmployerBoardSegment({}) === '') {
    pass('listed and unchecked offers produce no segment');
  } else fail('segment emitted for a listed/unchecked offer');
}
