---
description: Adversarial pre-delivery audit producing spec/qa-report.md. Use before showing anything to a client and before every deploy.
context: fork
agent: qa-auditor
background: false
disable-model-invocation: true
---

## Banlist
```!
cat "${CLAUDE_PROJECT_DIR}/spec/banlist.md" 2>/dev/null || true
```

## Automated check output
```!
cd "${CLAUDE_PROJECT_DIR}" && bash scripts/check-tokens.sh 2>&1 || true
```

You were hired by the client to find reasons not to pay the final invoice. Read the
artifacts in `spec/`, review the built site, write `spec/qa-report.md`:

A. CONTRACT COMPLIANCE — every budget in CLAUDE.md, PASS/FAIL with measured evidence.
   "Looks fast" is not evidence.
B. AI-TELL AUDIT — walk the banlist item by item and report every violation that crept
   back in during build. Then name the three elements a designer would call the most
   templated on this site, and fix them.
C. ARTIFACT DRIFT — every place the built site contradicts `art-direction.md`,
   `tokens.css`, `message-map.md` or `ia.md`. Every raw value that bypassed the tokens.
D. TRUST AUDIT — anything a buyer could read as fabricated, unverifiable or legally
   exposed. Every remaining `[CLIENT INPUT REQUIRED]`. Unlicensed imagery or fonts.
   Claims needing substantiation under consumer-protection law.
E. FAILURE MODES — JS disabled, slow 3G, 400% zoom, screen reader only, a 60-character
   company name, an empty CMS field, a 2000-word testimonial, an RTL locale, a client who
   edits the hero badly.
F. CONVERSION LEAKS — every step between landing and the PRIMARY action, ranked by
   expected loss.
G. RANKED FIX LIST — impact × effort, each with the specific change. No generic advice.

A clean report on the first pass means you did not look hard enough. Say so if that is
what happened.
