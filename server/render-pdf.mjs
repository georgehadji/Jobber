// server/render-pdf.mjs — HTML to PDF in headless Chromium, behind a small queue.
//
// The page is the visitor's CV content inside our own template, so it is treated as hostile:
// JavaScript is off, every network request is aborted (only data: URLs load), and the whole
// render has a hard timeout. A fresh browser per render means nothing is kept between visitors.
// Only `slots` renders run at once; extra requests wait in a short line, then are refused.

import { injectPrintPageCss, inlineLocalFonts, countRenderedPdfPages } from '../generate-pdf.mjs';
import { extractPdfText, auditTextLayer } from '../lib/pdf-text.mjs';
import { TaskError } from './openrouter.mjs';

const BUSY = 'Too many CVs are being built right now. Try again in a minute. This did not use one of your checks.';
const FAILED = 'The PDF could not be built. Try again in a few minutes. This did not use one of your checks.';

/** At most `concurrency` holders at once; up to `maxPending` more wait; the rest are refused (503). */
export function createSlots({ concurrency = 1, maxPending = 4 } = {}) {
  let active = 0;
  const waiting = [];
  const release = () => {
    const next = waiting.shift();
    if (next) next(); else active--;
  };
  return {
    async acquire() {
      if (active < concurrency) { active++; return release; }
      if (waiting.length >= maxPending) throw new TaskError(503, BUSY);
      await new Promise((resolve) => waiting.push(resolve));
      return release;
    },
    stats: () => ({ active, waiting: waiting.length }),
  };
}

/**
 * @param {{slots?: ReturnType<typeof createSlots>, timeoutMs?: number, noSandbox?: boolean,
 *          launch?: (opts: object) => Promise<any>}} [cfg]  launch is injectable for tests.
 */
export function createRenderer({ slots = createSlots(), timeoutMs = 30_000, noSandbox = false, launch } = {}) {
  const launchBrowser = launch || (async (opts) => (await import('playwright')).chromium.launch(opts));

  async function renderPdf(html, format = 'a4') {
    const done = await slots.acquire();
    let browser = null;
    try {
      const withPage = injectPrintPageCss(await inlineLocalFonts(html), format);
      const work = (async () => {
        browser = await launchBrowser({ headless: true, ...(noSandbox ? { args: ['--no-sandbox'] } : {}) });
        const ctx = await browser.newContext({ javaScriptEnabled: false, offline: true });
        await ctx.route('**/*', (route) => (route.request().url().startsWith('data:') ? route.continue() : route.abort()));
        const page = await ctx.newPage();
        await page.setContent(withPage, { waitUntil: 'load', timeout: timeoutMs });
        return page.pdf({ printBackground: true, margin: { top: '0', right: '0', bottom: '0', left: '0' }, preferCSSPageSize: true });
      })();
      let timer;
      const limit = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('render timeout')), timeoutMs); });
      let pdf;
      try { pdf = Buffer.from(await Promise.race([work, limit])); }
      finally { clearTimeout(timer); work.catch(() => {}); }

      const { text } = extractPdfText(pdf);
      const audit = auditTextLayer(text);
      return {
        pdf,
        pages: countRenderedPdfPages(pdf),
        text,
        atsFindings: audit.ok ? [] : audit.findings.map((f) => f.message),
      };
    } catch (e) {
      if (e instanceof TaskError) throw e;
      throw new TaskError(503, FAILED);       // never echo browser or page content
    } finally {
      try { await browser?.close(); } catch { /* the process is going away anyway */ }
      done();
    }
  }

  return { renderPdf, slots };
}
