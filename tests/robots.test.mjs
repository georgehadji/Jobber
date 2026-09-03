// tests/robots.test.mjs — lib/robots.mjs (robots.txt gate for the
// browser-User-Agent escalation). Fully offline: gate() takes an injected
// fetchText, no network in this file.
import { pass, fail } from './helpers.mjs';
import {
  looksLikeRobots, parseRobots, isAllowed, gate, _clearCacheForTests,
} from '../lib/robots.mjs';

console.log('\nlib/robots.mjs — robots.txt gate');

function statusErr(status) {
  const e = new Error(`HTTP ${status}`);
  e.status = status;
  return e;
}

try {
  // 1. Blank line inside a record does not end the record — the following
  //    Disallow still binds the User-agent above the blank line.
  {
    const text = 'User-agent: *\n\nDisallow: /private\n';
    const groups = parseRobots(text);
    if (!isAllowed(groups, 'jobber', '/private/page')) {
      pass('blank line inside a record does not end it');
    } else {
      fail('blank line inside a record wrongly ended it (fails open)');
    }
  }

  // 2. Percent-decoded pattern matching: Disallow: /foo%20bar blocks /foo bar.
  {
    const text = 'User-agent: *\nDisallow: /foo%20bar\n';
    const groups = parseRobots(text);
    if (!isAllowed(groups, 'jobber', '/foo bar')) {
      pass('percent-decoded pattern matches the decoded path');
    } else {
      fail('percent-encoded Disallow failed to match the decoded path (fails open)');
    }
  }

  // 3. A 200 response whose body carries no recognized directive is
  //    unreadable, not permission (soft-200 error page).
  {
    const looksRobots = looksLikeRobots('<html><body>404 Not Found</body></html>');
    if (!looksRobots) {
      pass('an HTML error page does not look like a robots.txt');
    } else {
      fail('an HTML error page was mistaken for a valid robots.txt');
    }
  }

  // 4. Empty body IS a valid allow-all under RFC 9309.
  {
    if (looksLikeRobots('') && looksLikeRobots('   \n  ')) {
      pass('an empty/whitespace body is treated as valid allow-all');
    } else {
      fail('an empty body was wrongly treated as unreadable');
    }
  }

  // 5. Equal-length Allow and Disallow ties toward Disallow (cautious default).
  {
    const text = 'User-agent: *\nAllow: /a\nDisallow: /a\n';
    const groups = parseRobots(text);
    if (!isAllowed(groups, 'jobber', '/a')) {
      pass('equal-length Allow/Disallow tie resolves to Disallow');
    } else {
      fail('equal-length tie wrongly resolved to Allow');
    }
  }

  // 5b. Same tie, rules declared in the opposite order — order must not matter.
  {
    const text = 'User-agent: *\nDisallow: /a\nAllow: /a\n';
    const groups = parseRobots(text);
    if (!isAllowed(groups, 'jobber', '/a')) {
      pass('equal-length tie resolves to Disallow regardless of rule order');
    } else {
      fail('rule order flipped the tie result');
    }
  }

  // 6. Longest match wins over a shorter, more permissive one.
  {
    const text = 'User-agent: *\nDisallow: /\nAllow: /public\n';
    const groups = parseRobots(text);
    if (isAllowed(groups, 'jobber', '/public/page') && !isAllowed(groups, 'jobber', '/private')) {
      pass('longest match wins (Allow /public beats Disallow /)');
    } else {
      fail('longest-match specificity was not respected');
    }
  }

  // 7. Wildcard pattern.
  {
    const text = 'User-agent: *\nDisallow: /*.pdf$\n';
    const groups = parseRobots(text);
    if (!isAllowed(groups, 'jobber', '/resume.pdf') && isAllowed(groups, 'jobber', '/resume.pdf.html')) {
      pass('wildcard + end-anchor pattern matches as RFC 9309 specifies');
    } else {
      fail('wildcard/end-anchor pattern did not match correctly');
    }
  }

  // 8. Unrecognized agent falls back to the "*" group.
  {
    const text = 'User-agent: *\nDisallow: /secret\n';
    const groups = parseRobots(text);
    if (!isAllowed(groups, 'some-other-bot', '/secret')) {
      pass('an agent with no dedicated group falls back to "*"');
    } else {
      fail('fallback to "*" group did not happen');
    }
  }

  // 9. No rules at all means allowed.
  {
    const groups = parseRobots('');
    if (isAllowed(groups, 'jobber', '/anything')) {
      pass('no rules at all means allowed');
    } else {
      fail('an empty rule set wrongly disallowed');
    }
  }
} catch (e) {
  fail(`robots.mjs pure-function tests crashed: ${e.message}`);
}

// ── gate() — the async shell, fully offline via injected fetchText ─────────

async function run() {
  // 10. 404 on robots.txt means allowed (no published policy).
  _clearCacheForTests();
  try {
    const result = await gate('https://example.invalid/jobs', {
      fetchText: async () => { throw statusErr(404); },
    });
    if (result.allowed) {
      pass('gate(): 404 on robots.txt is treated as ALLOWED');
    } else {
      fail(`gate(): 404 wrongly disallowed: ${result.reason}`);
    }
  } catch (e) {
    fail(`gate() 404 case crashed: ${e.message}`);
  }

  // 11. A network failure other than 404 is UNCONFIRMED, not allowed.
  _clearCacheForTests();
  try {
    const result = await gate('https://example.invalid/jobs', {
      fetchText: async () => { throw new Error('ECONNREFUSED'); },
    });
    if (!result.allowed && /UNCONFIRMED/.test(result.reason)) {
      pass('gate(): a non-404 fetch failure is UNCONFIRMED (fails closed)');
    } else {
      fail(`gate(): non-404 failure did not fail closed: ${JSON.stringify(result)}`);
    }
  } catch (e) {
    fail(`gate() network-failure case crashed: ${e.message}`);
  }

  // 12. A 200 with an unreadable (non-robots) body is UNCONFIRMED.
  _clearCacheForTests();
  try {
    const result = await gate('https://example.invalid/jobs', {
      fetchText: async () => '<html>soft 200 error page</html>',
    });
    if (!result.allowed && /not a robots\.txt/.test(result.reason)) {
      pass('gate(): a soft-200 HTML error page is UNCONFIRMED, not ALLOWED');
    } else {
      fail(`gate(): soft-200 was not recognized as unreadable: ${JSON.stringify(result)}`);
    }
  } catch (e) {
    fail(`gate() soft-200 case crashed: ${e.message}`);
  }

  // 13. A published Disallow blocks the escalation.
  _clearCacheForTests();
  try {
    const result = await gate('https://example.invalid/careers', {
      fetchText: async () => 'User-agent: *\nDisallow: /careers\n',
    });
    if (!result.allowed) {
      pass('gate(): a published Disallow blocks the escalation');
    } else {
      fail('gate(): a published Disallow was ignored');
    }
  } catch (e) {
    fail(`gate() disallow case crashed: ${e.message}`);
  }

  // 14. A published Allow (or silence on the path) permits the escalation.
  _clearCacheForTests();
  try {
    const result = await gate('https://example.invalid/careers', {
      fetchText: async () => 'User-agent: *\nDisallow: /private\n',
    });
    if (result.allowed) {
      pass('gate(): a path not covered by any Disallow is ALLOWED');
    } else {
      fail(`gate(): an unrestricted path was wrongly disallowed: ${result.reason}`);
    }
  } catch (e) {
    fail(`gate() allow case crashed: ${e.message}`);
  }

  // 15. Results are cached per-origin — a second call for the same origin
  //     must not re-invoke fetchText.
  _clearCacheForTests();
  try {
    let calls = 0;
    const fetchText = async () => { calls++; return 'User-agent: *\nDisallow: /private\n'; };
    await gate('https://example.invalid/careers', { fetchText });
    await gate('https://example.invalid/other-page', { fetchText });
    if (calls === 1) {
      pass('gate(): results are cached per-origin across paths');
    } else {
      fail(`gate(): expected 1 fetch for the same origin, got ${calls}`);
    }
  } catch (e) {
    fail(`gate() caching case crashed: ${e.message}`);
  }

  // 15b. SEED-A (defect-hunt batch 4): the cache must be path-specific. Two
  //      different paths on the same origin, within the same TTL window, must
  //      each get their OWN verdict from the cached rule set — not whichever
  //      verdict happened to be computed first.
  _clearCacheForTests();
  try {
    let calls = 0;
    const fetchText = async () => { calls++; return 'User-agent: *\nDisallow: /admin\n'; };
    const admin = await gate('https://example.invalid/admin/secret', { fetchText });
    const publicPage = await gate('https://example.invalid/public', { fetchText });
    if (calls === 1 && admin.allowed === false && publicPage.allowed === true) {
      pass('gate(): a cached origin still gives each path its own correct verdict');
    } else {
      fail(`gate(): path-specific verdict lost to origin-level caching: calls=${calls}, admin=${JSON.stringify(admin)}, public=${JSON.stringify(publicPage)}`);
    }
  } catch (e) {
    fail(`gate() path-conflation case crashed: ${e.message}`);
  }

  // 16. Non-http(s) scheme is refused outright (SSRF hardening).
  _clearCacheForTests();
  try {
    const result = await gate('file:///etc/passwd', {
      fetchText: async () => { fail('gate(): fetchText must never be called for a file: URL'); return ''; },
    });
    if (!result.allowed) {
      pass('gate(): a non-http(s) scheme is refused without any fetch');
    } else {
      fail('gate(): a file: URL was wrongly allowed');
    }
  } catch (e) {
    fail(`gate() scheme-guard case crashed: ${e.message}`);
  }

  // 17. A body over the byte cap is truncated and parsed, not rejected
  //     outright (RFC 9309 permits ignoring content past 500 KiB).
  _clearCacheForTests();
  try {
    const huge = 'User-agent: *\nDisallow: /private\n' + '#'.repeat(600 * 1024);
    const result = await gate('https://example.invalid/private', {
      fetchText: async () => huge,
    });
    if (!result.allowed && result.reason.startsWith('DISALLOWED')) {
      pass('gate(): an oversized body is truncated and still parsed correctly');
    } else {
      fail(`gate(): oversized body handling regressed: ${JSON.stringify(result)}`);
    }
  } catch (e) {
    fail(`gate() oversized-body case crashed: ${e.message}`);
  }
}

await run().catch(e => fail(`robots.test.mjs top-level crash: ${e.message}`));
