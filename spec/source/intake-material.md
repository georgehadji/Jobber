# Intake material — [PRODUCT_NAME] SaaS

Raw material for `/intake`. Everything below is either stated fact from the existing
open-source README or a decision made explicitly by the founder. Anything not here is
UNKNOWN and must appear in OPEN QUESTIONS, not be filled in.

---

## 1. What is being built

A hosted SaaS job-search assistant with a chat interface. It:
- improves and rewrites resumes
- performs ATS optimisation
- finds open positions
- matches a resume against a specific position
- re-optimises the resume per job description
- prepares the application for sending

It does **not** submit, send, or click anything on the user's behalf. Decided explicitly.
Every outbound artifact goes through an approval gate: the system drafts, the user
reviews, the user sends. This is a positioning commitment, not a technical limitation.

## 2. Relationship to the existing open-source product

There is an existing, mature open-source CLI tool (MIT licensed, v1.24.0) that runs
inside AI coding CLIs (Claude Code, Codex, OpenCode, Antigravity, Grok, Qwen, Kimi,
Copilot). The SaaS is a hosted tier above that free core — open-core model.

Both products must tell the same story. The CLI's stated identity is "a filter, not a
spray-and-pray applier" and "it never submits, sends, or clicks anything — you always
review and decide." The SaaS keeps that promise.

## 3. Capability inventory carried over from the CLI

These are built and proven in the open-source tool, so they are claims the SaaS can make
without inventing anything:

- **A–G structured evaluation** of every posting: role summary, CV match, level strategy,
  compensation research, personalisation, STAR+R interview prep, work-authorisation signals.
- **Block G posting-legitimacy check** — flags scams and ghost jobs, scored independently
  of the 1–5 fit score.
- **Recommendation against applying below 4.0/5** — the tool actively tells users not to apply.
- **Zero-token portal scanning** across Greenhouse, Ashby, Lever, Workday, iCIMS and
  55+ provider modules, via public APIs and feeds. Not scraping. 100+ pre-configured
  companies, 45+ queries.
- **Reverse-ATS keyword sweep** over full public ATS datasets, resumable via checkpoints.
- **ATS-oriented PDF generation** — keyword-aligned CVs, HTML+Playwright, LaTeX path too.
- **Cover letters and application emails** — research-backed drafts, approval gate, never auto-sent.
- **Interview suite** — time-blocked prep, practice with feedback, post-interview debriefs,
  company red-flag detector.
- **Offer stage** — contract clause walk with a lawyer question list, plus
  desired/advertised/actual salary-gap analysis.
- **Follow-ups** — cadence calculator, reminders, employer-reply classification.
- **Pattern analysis** — rejection patterns, per-ATS advance rates, lifetime funnel stats,
  repost and ghost-job detection.
- **Market-specific vocabulary sets** for German, French, Arabic, Japanese, Turkish and
  Hindi job markets, each with local employment terminology. Output language and market
  vocabulary are independent axes.
- **Keyword reformulation, never fabrication** — nothing enters a CV or cover letter that
  is not backed by a document the user controls.

## 4. Candidate differentiators to test in positioning

Ranked by how few competitors can claim them:

1. **Ghost-job and scam detection as a first-class feature.** Most tools optimise
   applications; almost none tell you the posting is fake. Real, widespread user pain.
2. **The approval gate.** The category is full of auto-appliers. Being the tool that
   refuses to auto-send is a stance, and it is the opposite of what everyone else sells.
3. **Advising against applying.** A product that reduces the number of applications you
   send is a strange and memorable promise in this category.
4. **EU-native compliance posture.** GDPR-by-design, EU hosting, transparent AI use,
   documented human oversight. No US competitor leads with this.
5. **Market-specific CV conventions** (Lebenslauf, 履歴書, etc.) rather than one
   Anglo-American resume format translated.
6. **Open-source core.** The evaluation logic is publicly auditable — unusual in a
   category where scoring is a black box.

## 5. Regulatory context that must shape the site

- The EU AI Act (Regulation (EU) 2024/1689), Annex III Category 4, names employment AI —
  targeted job advertising, analysing and filtering job applications, evaluating
  candidates — as high-risk, with Article 6(2) making the classification automatic.
  Whether a candidate-side tool falls inside 4(a) is an open legal question that a lawyer
  must answer before launch. INFERENCE, not settled: the provision appears aimed at
  employer/recruiter-side systems. The site must not make compliance claims that have not
  been legally verified.
- GDPR: the SaaS becomes a data controller for CVs, which routinely contain special-category
  data by accident (health inferred from gaps, ethnicity, religious or union affiliation in
  volunteering history) and third-party data (referees, named colleagues). Needs lawful
  basis, DPIA, processor agreements with every LLM provider, retention policy, deletion flow.
- European Accessibility Act, enforceable since 28 June 2025, with EN 301 549 (WCAG 2.1 AA)
  as the technical benchmark and a published accessibility statement required. Build to
  WCAG 2.2 AA.
- Third-party portal terms of service. The scanner uses public APIs and feeds. The site
  must not describe the product in language that implies scraping.

## 6. Competitive field (verified, incomplete)

- **santifer/career-ops** — AI job-search system on Claude Code, 14 skill modes, Go
  dashboard, PDF generation, batch processing. 472 GitHub stars. Closest known competitor
  to the OSS core.
- **Auto-apply SaaS** — LazyApply, AIApply, Sonara, Simplify and similar. Adjacent but
  opposite positioning.
- **Resume/ATS tools** — Jobscan, Teal, Rezi, Kickresume. Overlap on ATS optimisation.
- **Remote job boards** — FlexJobs, We Work Remotely, Remotive, Remote.co, Jobspresso.
  Not competitors; the product is not a job board. There are 50,000+ job boards online.

## 7. OPEN QUESTIONS — must be answered by the founder, not invented

1. **Product name.** Not locked. Five names cleared preliminary EUIPO/TMview screening:
   Kritir, Anakrin, Krinix, Ekloga, Workler. Full clearance in classes 9, 42 and 35 still
   required before any brand investment.
2. **Pricing.** No model decided. Subscription? Usage-based? Free tier scope? What does the
   OSS core give away and what does the paid tier add?
3. **Launch state.** Is the SaaS built, in build, or at concept? Is there a waitlist?
4. **PROOF INVENTORY — the critical gap.** Does the SaaS have any users, beta testers, or
   outcomes? Does the OSS tool have measurable adoption (stars, installs, contributors)?
   Are there any real testimonials, or any documented case of a user landing a role?
   If the answer is none, the site ships with zero social proof and the copy must be built
   to work without it. Do not invent testimonials, user counts, or success rates.
5. **The one commercial action.** Trial signup? Waitlist? Demo? Paid conversion directly?
6. **Target markets at launch** — which countries and languages in month 1, and in month 12?
7. **Legal entity and jurisdiction** for the SaaS. Hosting location.
8. **Who operates the site after launch**, and how technical are they?
9. **Free vs paid boundary** — which of the capabilities in §3 sit behind the paywall?
10. **Does the SaaS keep the CLI's "recommend against applying below 4.0" behaviour?**
    A paid product that tells users to apply less is a strong stance but needs a
    deliberate decision.

---

## Instruction to the intake stage

Produce `spec/brief.md` from this material. Transcribe, do not embellish. Every item in
§7 stays an open question until the founder answers it. Where a belief in the message
hierarchy would need proof that does not exist, write
`[CLIENT INPUT REQUIRED: <exact question>]` rather than a plausible placeholder.
