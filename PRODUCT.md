# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack
Public site (landing + docs + hosted tool): front end in plain HTML, CSS and vanilla JavaScript, no framework (user decision). Hosted backend on a VPS (user decision) that runs Jobber capabilities for visitors; backend language and framework delegated to the builder, with a preference for reusing Jobber's existing Node `.mjs` scripts. Separate from the local Next.js app in `web/`. Domain undecided.

## Users
Primary audience for the public site: any job seeker, technical or not. The site must explain the value before it mentions a terminal. Actual users today run Jobber inside an AI coding CLI (Claude Code, Codex, OpenCode, etc.), so the install path is technical even when the reader is not. Secondary, unconfirmed: contributors.

## Product Purpose
Jobber is an AI job-search command center. It evaluates offers against the user's real CV, generates ATS-tailored CV and cover-letter PDFs, scans job portals with zero LLM cost, tracks applications in one Markdown tracker, and drafts outreach and interview prep. It exists to find the few roles worth applying to out of hundreds.

## Positioning
A filter, not a spray-and-pray applier. It never submits or sends anything without the user reviewing, recommends against applying below 4.0/5, and adds an independent posting-legitimacy check (scams, ghost jobs). Two ways to use it: locally inside the user's own AI CLI (no cloud, files stay on the user's machine), or, new, on the hosted public site. The hosted site is NOT local: copy must never claim "runs locally" or "no cloud" for the hosted tool, only for the local install.

## Operating Context
Local install (Node.js >= 18, Playwright Chromium for PDFs), driven by slash commands such as `/jobber scan`, `/jobber pdf`, `/jobber tracker`, or by pasting a job URL or description. Data lives in user-owned Markdown/YAML/TSV files. A local Next.js dashboard exists in `web/`.

## Capabilities and Constraints
- Evaluation scored 1-5 across weighted blocks A-F, plus Block G posting legitimacy.
- Portal scanning across Greenhouse, Ashby, Lever, Workday, iCIMS and 70+ provider modules.
- Canonical application states in `templates/states.yml`.
- MIT licensed, version 1.24.0 per README. Trademark policy exists (`TRADEMARK.md`).
- The first evaluations are mediocre until the user feeds the system context; copy must not overpromise.
- Hosted tool (user decisions): visitors upload a CV and use four capabilities on the site: score a job against the CV (needs LLM), CV skill-gap check (zero-LLM), tailored CV PDF (needs LLM), portal scan (public ATS feeds, server-side). CV is processed and discarded at once: no accounts. The finished result (not the CV) is kept in server memory for a short window (default 30 minutes, user decision: short retention) behind an unguessable link, then deleted. Free daily limit per visitor; the limit number, pricing and abuse controls are undecided and must not be invented.
- Hosted backend (user decisions, see `docs/backend-brief.md`): VPS; OpenRouter as the LLM provider with one server-side key; each request runs the existing scripts in a throwaway temp folder; per-visitor daily limit by salted IP hash, global spend cap, and a Cloudflare Turnstile bot check.
- Hosted tool creates obligations not yet resolved: a privacy notice stating exactly what is sent to the LLM provider and that nothing is retained, LLM provider data-use terms, rate limiting, malicious-upload handling (file type and size), no CV content in logs. Visitor CVs are personal data; legal review is the owner's call.
- Undecided: domain, pricing, daily-limit number, whether the site mentions the manifesto at jobber.org/manifesto.

## Brand Commitments
Name: Jobber. Existing assets: `docs/wordmark-light.svg`, `docs/wordmark-dark.svg`, `docs/logo.png`. The tone in existing docs is plain and honest ("this is a filter", "first evaluations will be mediocre, and that's expected"). Landing page (user decision): play the job-tool category standard straight, at full craft, no irony and no themed world. Craft bar: Teal / Huntr and Jobscan (direct job-search peers). No other brand commitment confirmed.

## Evidence on Hand
`docs/demo.gif` (README demo), `docs/hero-banner.jpg`, `docs/og-image.jpg`, `docs/vision-banner.jpg`, `docs/roadmap-phases.jpg`, `README.md`, `docs/*.md` (setup, onboarding, FAQ, scripts, supported job boards and CLIs). The README credits the origin to santifer's own search (740+ offers evaluated, 100+ tailored CVs). No customer testimonials, user counts, benchmarks or press quotes were found; none may be invented.

## Product Principles
1. User decides: nothing is submitted, sent or clicked without review.
2. Quality over volume: fewer, better-fit applications.
3. User data is user-owned: local install keeps files on the user's machine; the hosted tool discards the CV at once, keeps only the result for a short stated window, and says so plainly.
4. Honest about limits: say what it cannot do yet.

## Accessibility & Inclusion
No product-specific standard recorded. Baseline to apply to the site: WCAG 2.2 AA.
