# Copy — `/how-it-works`

**Target reading level:** UK reading age 13–14 / US grade 8.
**Job (ia §1):** prove beliefs 2–4 — the A–G report, the 1–5 score, the 4.0 threshold, the
approval gate, and that the logic is readable.

## Head

`<title>` (49 chars)
> How Workler scores a job posting — Workler

Meta description (152 chars)
> Seven blocks, a score from 1 to 5, and a separate legitimacy check. Below 4.0 Workler
> recommends not applying. The scoring logic is open to read.

## H1

> How Workler decides whether a job is worth your evening

## Answer block (57 words, from query-map §3)

> Workler reads a job posting and your CV and produces a report in seven blocks: role summary, CV
> match, level strategy, compensation research, personalisation, interview preparation, and work
> authorisation. Posting legitimacy is scored separately. The result is a score from 1 to 5, and
> below 4.0 Workler recommends not applying. It then stops and hands the decision to you.

---

## Section 1 — The seven blocks

*Installs belief 2 and part of 4. Kills "it's a prompt with a number on the end".*

> Each block answers one question, and each is written out in full so you can disagree with it.

| | Block | The question it answers |
|---|---|---|
| A | Role summary | What is this job, stripped of the advert? |
| B | CV match | Which of your actual experience lines up, and which does not? |
| C | Level strategy | Are you under-levelled, over-levelled, or right for this? |
| D | Compensation | What does this role pay, in this market, in local terms? |
| E | Personalisation | What in this posting is worth responding to directly? |
| F | Interview preparation | Which of your stories fit the questions this role will ask? |
| G | Posting legitimacy | Is anyone actually hiring for this? |

> Block G is scored on its own and never averaged into your fit score. A job you are perfect for
> is worth nothing if the role was filled in March.

Claim-with-receipt: `The seven-block structure and the modes that produce it are in the
repository.` → link to the modes directory.

## Section 2 — The score, and the line under it

*Installs belief 2. Kills "it says yes to everything".*

> Fit is scored from 1 to 5. **Below 4.0, Workler recommends you don't apply**, and says why.
>
> That threshold is the part most job tools do not have. A scoring system that never returns a bad
> number is not measuring anything — it is agreeing with you.

The threshold rule renders here at full width, labelled `4.0`, with the demo records beneath it.

Claim-with-receipt: `The 4.0 threshold and the recommend-against behaviour are in the evaluation
mode, not in marketing copy.` → link.

`[CLIENT INPUT REQUIRED: does the hosted product keep the recommend-against-below-4.0 behaviour?
brief §7 Q5. This section describes the CLI. If the hosted tier drops it, this page is false and
the positioning loses half its axis.]`

## Section 3 — Then it stops

*Installs belief 1. Kills "it's a spam cannon".*

> Workler drafts. You send.
>
> It will write the CV, the covering letter, the form answers and the follow-up. It will not
> submit an application, send an email, or click anything on your behalf. That is not a missing
> feature — it is enforced in the code, and there is a test that fails if it ever stops being
> true.

Claim-with-receipt: `The submit guard is a test in the repository.` → `web/test-submit-guard.mjs`.

## Section 4 — Nothing is invented

*Installs belief 4. Kills "AI will make things up on my CV".*

> Workler reformulates what is already in your CV. It reorders, reframes and emphasises. It does
> not add an achievement you did not describe, a tool you did not use, or a project you did not
> build.
>
> The rule is one line in the instructions the model runs under: keywords get reformulated, never
> fabricated.

Claim-with-receipt: link to the instruction file.

## Section 5 — In your market's words

*Installs belief 5. Kills "another US tool".*

> Pay, notice periods and contract types are not the same everywhere, and a tool that only knows
> American conventions gets them wrong quietly. Workler ships eighteen market vocabulary sets — so
> it knows that a 13. Monatsgehalt is not a bonus, what a TFR is worth, what kıdem tazminatı means
> for a Turkish notice period, and the difference between CTC and in-hand.

Claim-with-receipt: link to the modes directory listing the eighteen sets.

`[CLIENT INPUT REQUIRED: how many of the eighteen ship in the hosted tier at launch? brief §7 Q6.]`

## Section 6 — Read it yourself

*Installs belief 6, hands off to the SECONDARY action.*

> Everything on this page is in a public repository. The free command-line version runs the same
> logic on your own machine.
>
> **Read the code →** · **See what it costs →**

CTA labels name exactly what happens: the first opens the repository, the second opens `/pricing`.

---

## Alt text

- Report demo: `A Workler evaluation report for a Senior Backend Engineer posting. Blocks A to G,
  each with a written finding. Overall score 2.8 out of 5, below the 4.0 threshold, with the
  recommendation: do not apply.`
- Threshold rule: `alt=""`, decorative; the value is in adjacent text.
