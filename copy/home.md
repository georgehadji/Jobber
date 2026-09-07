# Copy — `/` (home)

**Target reading level:** UK reading age 13–14 / US grade 8. Short sentences, concrete nouns, no
subordinate clause stacked on a subordinate clause. The audience includes people reading in a
second language (brief §3C).

**Primary page — two directions below.** Different lead, different belief order, A/B testable.

---

## Shared: head

`<title>` (54 chars)
> Workler — the job tool that tells you not to apply

Meta description (149 chars)
> Workler scores a job posting against your CV out of 5, flags postings that were never really
> open, and never sends anything. You send it. Free CLI.

*Test applied:* swap in a competitor's name. "JobAssist — the job tool that tells you not to
apply" reads false against a site advertising one-click auto-apply. Passes.

---

# DIRECTION A — lead with the refusal

**Belief order:** 1 (does not apply for you) → 2 (will tell you not to apply) → 3 (ghost jobs) →
6 (run it free) → 4 (inspectable) → 5 (your market) → 6a (only you pay) → price.

**The bet:** the visitor's first act is filing this site on a shelf. Direction A spends the first
screen on the shelf-fight and nothing else.

### Hero

H1
> Workler never sends your application.

Sub
> It reads the posting, scores the fit out of 5, and tells you when not to bother. Then it stops,
> and hands the decision back to you.

*Installs belief 1. Kills "it's another spam cannon" — segment A's stated abandon trigger.*

Right margin, the signature: a live score card reading **2.8 · do not apply**, with the threshold
rule beneath it. The first number a visitor sees on this site is a bad one, on purpose.

CTA (primary)
> **See what it costs →**
> Micro-copy: `[CLIENT INPUT REQUIRED: price and billing period — brief §7 Q3.]`
> After clicking: the pricing page, with the free/paid boundary as the first thing on it.

CTA (secondary, text link, not a button)
> Or run the free command-line version.
> After clicking: `/open-source`.

### Section 2 — What it actually does

Head
> Seven blocks, one score, and a separate check on whether the job is real.

Body
> Workler reads a job posting and your CV and writes a report: role summary, CV match, level
> strategy, pay research, what to personalise, interview preparation, and work authorisation.
> Posting legitimacy is scored on its own, because a job you fit perfectly is still worth nothing
> if nobody is hiring for it.
>
> The result is a number from 1 to 5. Below 4.0, Workler recommends you don't apply.

*Installs beliefs 2 and 3. Kills "it just flatters my CV and says yes to everything".*

Link: How the score works → `/how-it-works`

### Section 3 — The demo

Head
> Three real postings. Here is what it said about them.

Body (one line, then the component)
> These were evaluated with the tool, not written for this page.

The three committed records, per `spec/ia.md` §5 — at least one below 4.0 with do-not-apply, at
least one legitimacy-flagged. `[CLIENT INPUT REQUIRED: the three evaluated postings — brief §4 CAN
GET, founder, week 2. This section does not ship empty and does not ship with invented examples.]`

*Kills "nobody uses this, there's no proof". This sits where a logo wall would sit.*

Alt text for each score bar: `Score 2.8 out of 5. Below the 4.0 threshold. Workler recommends not
applying.`

### Section 4 — Try it before you pay

Head
> The command-line version is free, and it is the same judgment.

Body
> Workler CLI is open source under the MIT licence. It runs on your own machine inside ten AI
> coding tools. The scoring logic — thirty-three modes, eighteen market vocabulary sets — is in the
> repository, and you can read it before you trust it.

*Installs beliefs 4 and 6. Kills "I'm not paying a stranger with no users" and segment B's
black-box fear. This is the trial the product does not otherwise have.*

CTA: **Read the code →** — after clicking: the repository.

### Section 5 — Who pays for this

Head
> You do. Nobody else does.

Body
> There is no employer paying for placement, no recruiter buying your details, no advertiser. The
> only person Workler is paid by is the person using it — which means there is nobody else for it
> to be optimised for.

*Installs belief 6a. Kills "am I the product?" Link: `/rights`.*

### Section 6 — Close

> Workler is for people who apply on purpose.
>
> **See what it costs →**

*The identity line lands last, where it has been earned (message-map §2).*

---

# DIRECTION B — lead with the ghost job

**Belief order:** 3 (ghost jobs) → 1 (does not apply for you) → 2 (tells you not to apply) → 4 →
6 → 6a → price.

**The bet:** segment A's pain is not "I want a better tool", it is "I have sent eighty
applications and heard nothing". Direction B opens on that and earns the right to describe a
product.

### Hero

H1
> Some of those jobs were never open.

Sub
> Postings get left up after the role is filled. Some are only there to collect CVs. Workler
> checks whether a posting is real before you spend an evening on it — and it never sends anything
> on your behalf.

*Installs belief 3 first, belief 1 in the same breath so the shelf-fight still happens above the
fold.*

Right margin: a legitimacy flag reading **relisted 3× in 90 days**.

CTA: **See what it costs →** · secondary: Or read about ghost jobs → `/ghost-jobs`

### Section 2 — Then it scores the ones that are real

> For a posting that is genuinely open, Workler writes a seven-block report and scores your fit
> from 1 to 5. Below 4.0 it recommends you don't apply. It is the rare job tool that will tell you
> to close the tab.

*Installs belief 2.*

### Sections 3–6

Identical to Direction A sections 3, 4, 5, 6.

---

## Which wins, and on what mechanism

**Expected winner: Direction B**, on entry-path mechanism rather than on persuasion. Segment A
arrives from queries like "is this job posting real" and "applied to 100 jobs no response"
(`spec/query-map.md` §1) — a stated pain, not a product category. Direction B's H1 matches the
sentence already in their head; Direction A's H1 answers a question they have not asked yet
("what does this tool refuse to do?"), which only lands once they know what the tool is.

**Where A wins:** direct and repository traffic — visitors who arrived already knowing this is a
job tool and are deciding which shelf it belongs on. If `/open-source` and referral traffic
dominate, A is the better home page.

**The measurable decision rule:** clickthrough to `/pricing` from `/`, segmented by entry source.
Run for at least 200 sessions per arm before reading it; below that, a home-page A/B test on a
new site is noise wearing a p-value.

---

## States and errors

No forms on this page. The primary CTA is a link to `/pricing`; there is no email capture, because
the site does not launch before purchase works (brief §1).

If the demo records are missing at build, the section does not render and the build fails
(`spec/ia.md` §5). There is no empty state, because an empty demo is worse than no demo.

## Alt text

- Score card: `Score 2.8 out of 5 for a Senior Backend Engineer posting. Below the 4.0 threshold.
  Workler recommends not applying.`
- Threshold rule: decorative, `alt=""` — the value it marks is in adjacent text.
- Legitimacy flag: `Posting legitimacy flag: this role was relisted three times in ninety days.`
