// tests/eval-runner.test.mjs — regression coverage for the shared evaluation
// pipeline helpers in eval-runner.mjs. Pure functions, no LLM calls, no
// network, no file writes to user-layer paths.
import { pass, fail, finish } from './helpers.mjs';
import {
  readContextFile, parseScoreSummary, stripScoreSummary, buildReportContent,
  slugifyCompany, tsvSafe, normalizedTrackerScore,
} from '../eval-runner.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

console.log('\neval-runner.mjs — shared pipeline helpers');

try {
  // parseScoreSummary — the canonical score-summary parser all 3 evaluators use.
  {
    const text = [
      'Block A content...',
      '',
      '---SCORE_SUMMARY---',
      'COMPANY: Acme Corp',
      'ROLE: Senior AI Engineer',
      'SCORE: 4.2',
      'ARCHETYPE: builder',
      'LEGITIMACY: High Confidence',
      '---END_SUMMARY---',
    ].join('\n');
    const s = parseScoreSummary(text);
    if (s.company === 'Acme Corp' && s.role === 'Senior AI Engineer' && s.score === '4.2'
        && s.archetype === 'builder' && s.legitimacy === 'High Confidence') {
      pass('parseScoreSummary extracts all five fields');
    } else {
      fail(`parseScoreSummary wrong: ${JSON.stringify(s)}`);
    }
  }

  // parseScoreSummary — no summary block → safe fallback.
  {
    const s = parseScoreSummary('just prose, no summary');
    if (s.company === 'unknown' && s.score === '?') {
      pass('parseScoreSummary falls back safely when the block is absent');
    } else {
      fail(`parseScoreSummary fallback wrong: ${JSON.stringify(s)}`);
    }
  }

  // parseScoreSummary — per-key regex style (ollama/openai) also parses.
  {
    const text = 'prose\n---SCORE_SUMMARY---\nCOMPANY: Beta\nROLE: ML Eng\nSCORE: 3.9\nARCHETYPE: hybrid\nLEGITIMACY: Caution\n---END_SUMMARY---';
    const s = parseScoreSummary(text);
    if (s.role === 'ML Eng' && s.score === '3.9') {
      pass('parseScoreSummary handles regex-style summary lines');
    } else {
      fail(`parseScoreSummary regex-style wrong: ${JSON.stringify(s)}`);
    }
  }

  // stripScoreSummary — removes only the machine block.
  {
    const text = 'intro\n---SCORE_SUMMARY---\nSCORE: 4.0\n---END_SUMMARY---\noutro';
    const stripped = stripScoreSummary(text);
    if (stripped.includes('intro') && stripped.includes('outro') && !stripped.includes('SCORE_SUMMARY')) {
      pass('stripScoreSummary removes the summary block, keeps the body');
    } else {
      fail(`stripScoreSummary wrong: ${JSON.stringify(stripped)}`);
    }
  }

  // buildReportContent — header + body + no summary leak.
  {
    const report = buildReportContent({
      company: 'Acme', role: 'Engineer', archetype: 'builder',
      score: '4.2', legitimacy: 'High Confidence',
      evaluationText: 'body---SCORE_SUMMARY---\nSCORE: 4.2\n---END_SUMMARY---',
      tool: 'Gemini (test)',
    });
    if (report.includes('# Evaluation: Acme — Engineer')
        && report.includes('**Score:** 4.2/5')
        && report.includes('**Tool:** Gemini (test)')
        && !report.includes('SCORE_SUMMARY')) {
      pass('buildReportContent assembles header + body, strips summary');
    } else {
      fail(`buildReportContent wrong: ${report.slice(0, 200)}`);
    }
  }

  // slugifyCompany — filenames stay filesystem-safe.
  {
    if (slugifyCompany('Acme Corp (AI)') === 'acme-corp-ai' && slugifyCompany('') === 'unknown') {
      pass('slugifyCompany normalizes to a safe slug');
    } else {
      fail(`slugifyCompany wrong: ${slugifyCompany('Acme Corp (AI)')}`);
    }
  }

  // tsvSafe — tabs/newlines flattened for the tracker row.
  {
    if (tsvSafe('a\tb\nc') === 'a b c' && tsvSafe(null) === '') {
      pass('tsvSafe flattens tabs/newlines and nulls');
    } else {
      fail(`tsvSafe wrong: ${JSON.stringify(tsvSafe('a\tb\nc'))}`);
    }
  }

  // normalizedTrackerScore — canonical X.X/5 form.
  {
    if (normalizedTrackerScore('4.2') === '4.2/5' && normalizedTrackerScore('?') === '0.0/5') {
      pass('normalizedTrackerScore produces canonical X.X/5 cells');
    } else {
      fail(`normalizedTrackerScore wrong: ${normalizedTrackerScore('4.2')}`);
    }
  }

  // readContextFile — missing file returns a labeled placeholder.
  {
    const placeholder = readContextFile('/nonexistent/nope.md', 'cv.md');
    if (placeholder === '[cv.md not found — skipping]') {
      pass('readContextFile returns a labeled placeholder for missing files');
    } else {
      fail(`readContextFile placeholder wrong: ${placeholder}`);
    }
  }

  // readContextFile — real file returns trimmed contents.
  {
    const dir = mkdtempSync(join(tmpdir(), 'eval-runner-'));
    try {
      const p = join(dir, 'ctx.md');
      writeFileSync(p, '  hello\nworld  \n');
      const content = readContextFile(p, 'ctx.md');
      if (content === 'hello\nworld') {
        pass('readContextFile reads + trims real files');
      } else {
        fail(`readContextFile content wrong: ${JSON.stringify(content)}`);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
} catch (e) {
  fail(`eval-runner tests crashed: ${e.message}`);
}

finish();
