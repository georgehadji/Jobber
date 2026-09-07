# Message map — Workler

**Stage:** `/positioning`, 2026-09-08. Source: `spec/brief.md` only.
**Rule observed:** every proof cited here is drawn from brief §4 HAVE or §4 CAN GET, and CAN GET
items are marked as not-yet-existing. Nothing from DOES NOT EXIST appears. Where a belief has no
proof, it is not softened — it is listed in §6 as homework.

---

## 1. CATEGORY & CONTRAST

**The category the visitor files this under.** "AI job application tool." They arrive with a
mental shelf that already holds auto-apply bots (LazyApply, AIApply, Sonara, Simplify) and
resume/ATS optimisers (Jobscan, Teal). They assume Workler is one of those. It is the shelf, not
the competitors, that has to be fought.

**The one axis of non-interchangeability.** Everything else on that shelf acts on the seeker's
behalf: it applies, it submits, it sends. Workler stops. It evaluates a posting, scores it, tells
the seeker when not to apply, prepares the artefact — and hands the decision back. The category
sells *throughput*. Workler sells *judgment plus refusal*.

That is one axis with two halves, and both are needed. Judgment alone is a feature (every
optimiser claims a score). Refusal alone is a limitation. Together they are a different product:
**a tool that is willing to tell you no.**

**What Workler is worse at — stated, not hidden:**

- **Volume.** It will never fire off 200 applications. A competitor that does is genuinely faster
  at the thing it does, and for a seeker who wants a spray, Workler is the wrong purchase.
- **Effort.** The seeker still sends. The last click is theirs, always. That is work the category
  removes and Workler deliberately keeps.
- **Reassurance.** It scores below 4.0 and recommends against applying. A seeker who wants
  encouragement will be told to spend the afternoon elsewhere.
- **Track record.** Zero users, zero stars, no placement statistics, no testimonials — and none
  are coming (brief §4). Competitors with a logo wall will look safer to a cautious buyer.
- **Readiness.** The hosted product is in build (brief §1). The CLI exists; the thing being sold
  does not yet.

A positioning with no sacrifice is not a positioning. This one sacrifices speed, comfort and
social proof, in that order.

---

## 2. VALUE PROPOSITION — three versions

### A. Outcome-led

> **Stop losing weeks to jobs that were never open.**

- **Wins:** segment A, the burnt applicant. It names their trigger event exactly.
- **Loses:** segment B, who hears a marketing promise and leaves; segment C, whose fear is
  privacy, not wasted time.
- **Strongest sceptical counter:** *"Prove it."* And it cannot be proved. There is no outcome
  evidence in the proof inventory — no users, no placements, no before/after. An outcome claim
  with zero outcome proof is the exact failure mode this site was designed to avoid.

### B. Mechanism-led — **RECOMMENDED**

> **It reads the posting, scores the fit out of 5, flags the ones that look fake, and stops before
> the send button.**

- **Wins:** all three segments, for different reasons. A hears "fake postings". B hears a
  described mechanism instead of a claim. C hears a system that does not act autonomously.
- **Loses:** a buyer who wants an outcome guaranteed and does not care how. Also anyone who reads
  a mechanism as a feature list and shrugs.
- **Strongest sceptical counter:** *"Every wrapper says it scores things. Yours is a prompt with a
  number on the end."* This is the real objection and it has a real answer: the scoring logic is
  open and readable (brief §4 HAVE — 33 modes, the A–G report structure, the public repository),
  and the site can show three actual postings evaluated, one of them scored below 4.0 and
  recommended against (brief §4 CAN GET — does not exist yet; founder, week 2).
- **Why recommended:** with zero social proof, mechanism is the only claim class the site can
  *demonstrate on the page*. Brief §4 already reached this conclusion structurally; positioning
  confirms it. A mechanism claim carries its own evidence. An outcome claim borrows evidence
  Workler does not have.

### C. Identity-led

> **For people who apply on purpose.**

- **Wins:** segment A emotionally, and it is the most memorable of the three.
- **Loses:** segment B immediately — it is a slogan with no information. Segment C reads it as
  irrelevant.
- **Strongest sceptical counter:** *"That is a sentiment, not a product."* Correct. It cannot
  carry a home page whose one job is purchase.
- **Verdict:** keep as a supporting line, never as the proposition. It is the right register for
  the refusal half of the positioning, once the mechanism half has been earned.

**Recommendation: B, with C as the closing register.** Lead with the mechanism because it is the
only thing that can be shown; land on the identity line because it is the only thing that is
remembered.

---

## 3. MESSAGE HIERARCHY

The ordered beliefs a stranger must acquire before purchase. Order is load-bearing: belief 1
prevents the visitor from filing Workler on the wrong shelf, and every belief after it is wasted
if that happens.

| # | Belief | Proof (inventory only) | Objection it kills |
|---|--------|------------------------|--------------------|
| 1 | **This does not apply for you.** | HAVE: the approval gate enforced in code (`web/test-submit-guard.mjs`), a hard "never submit" rule in the agent instructions, and the legal disclaimer stating it. Three independent layers, all linkable. | "It's another spam cannon" — segment A's stated abandon trigger. |
| 2 | **It will tell you not to apply.** | HAVE: the 1–5 score and the 4.0 threshold below which the shipped modes recommend against applying. | "It just flatters my CV and says yes to everything." |
| 3 | **It can tell you a posting is a ghost.** | HAVE: Block G legitimacy, scored independently of fit; repost detection (a role relisted 3× in 90 days). | "Why do I get no responses?" — segment A's actual search query. |
| 4 | **The judgment is inspectable, not a black box.** | HAVE: the public repository, 33 modes, the A–G report structure, the 19-batch defect-hunt ledger and its written assertion discipline. | Segment B's stated fear: a black-box score. |
| 5 | **It knows your market's actual vocabulary.** | HAVE: 18 shipped market vocabulary sets — Lebenslauf, 13. Monatsgehalt, TFR, kıdem tazminatı, ФОП, CTC vs in-hand. | "Another US tool that thinks everyone has a 401(k)." |
| 6 | **You can run it yourself first, free.** | HAVE: the open-source CLI, MIT, 10 supported AI coding CLIs. This is the SECONDARY action doing work for the PRIMARY one — trying it free is the trial the product does not otherwise have. | "I'm not paying a stranger with no users." Directly answers the zero-social-proof problem. |
| 7 | **Your CV is not going into someone's training pile.** | **NO PROOF AVAILABLE.** Entity, jurisdiction, hosting, processor agreements and retention are all unanswered (brief §1, §6). The CLI's "runs locally, no telemetry" disclaimer describes the free tier and inverts for the hosted one; reusing it would be a lie. | Segment C's entire reason for being here. **This belief cannot ship until answered.** |
| 8 | **It is worth the price.** | **NO PROOF AVAILABLE.** Price and the free/paid boundary are unanswered (brief §7 Q3, Q4). | The last objection before purchase. **Blocks the PRIMARY action.** |

Beliefs 1–6 are shippable today. Beliefs 7 and 8 are not, and 8 is the one the site's single job
depends on.

---

## 4. OBJECTION LEDGER

| # | The real objection, in the visitor's words | Page element that answers it |
|---|-------------------------------------------|------------------------------|
| 1 | "This is an auto-apply bot with better copywriting." | Home, above the fold: the refusal stated as the product, not as a footnote. Links to the enforcing test in the repository. |
| 2 | "Nobody uses this. Zero stars, no testimonials, no logos." | The demo (three real postings, one scored below 4.0, one legitimacy-flagged) placed where a logo wall would be. Answers absence of proof with presence of product. **Requires the CAN GET demo; does not exist yet.** |
| 3 | "Every tool claims an AI score. Yours is a prompt with a number." | The evaluation page: the A–G blocks named and shown, the threshold stated, the scoring logic linked in the repository. |
| 4 | "I'll upload my CV and lose control of it." | `/privacy`, written to the answers in brief §1 — entity, host, processors, retention, deletion. **Blocked: unanswered.** |
| 5 | "Is this legal? Employment AI is regulated in the EU." | `/rights` or an AI Act note: the Annex III(4) question stated as open, no compliance badge, counsel's answer when it arrives. Stating an open question beats claiming a settled one. |
| 6 | "Does it scrape job boards? I don't want to be banned." | Named providers — Greenhouse, Ashby, Lever, Workday, iCIMS — described as public APIs and feeds. The word "scraping" appears nowhere on the site, in any tense (brief §6). |
| 7 | "There's a free open-source version. Why pay?" | Pricing page: the free/paid boundary drawn explicitly. **Blocked: brief §7 Q4.** Note the structural risk — the SECONDARY action (run the free CLI) competes with the PRIMARY one (purchase) unless that line is drawn honestly and visibly. |
| 8 | "Why does this cost anything at all? The CLI says the seeker never pays." | `/rights`, rewritten. "You never pay" is retired (brief §1, founder 2026-09-07). The surviving claim, **confirmed 2026-09-08: the seeker pays, and nobody else** — no employer, recruiter or advertiser revenue. **Unblocked.** The argument the page makes: a tool whose only customer is the seeker has nobody else to optimise for, and the absence of employer-side features is checkable in the open repository. |
| 9 | "It's not even finished." | Honesty as the answer: the CLI exists and can be run today; the hosted tier is in build. **Largely retired 2026-09-08:** the site does not launch until purchase works, so at launch the product is finished. What survives is the thinner version — no users yet — answered by the free CLI being runnable today. |
| 10 | "Who is behind this?" | `/about` with a named Person entity. **CAN GET; brief §7 Q10 unanswered.** |

Four of ten objections are currently unanswerable. All four trace to the same three unanswered
questions: price and privacy posture. Launch sequencing was the third and is now answered.

---

## 5. VOICE

Rules, with rewrites drawn from the founder's own material.

### Rules

1. **Name the mechanism, not the magic.** Say what the software does, in the order it does it.
   - Weak: "AI-powered job search optimisation."
   - Workler: "It reads the posting, scores it out of 5, and tells you when not to bother."

2. **State the refusal in the active voice.** The most valuable sentence on the site is about
   something the product will not do; do not bury it in a limitations section.
   - Source phrasing: "never submits, sends, or clicks anything on the user's behalf."
   - Workler: "It never sends anything. You do."

3. **Every claim carries its receipt.** A number or a capability is followed by the place it can
   be verified. This is the site's substitute for social proof.
   - Source phrasing: "Keywords get reformulated, never fabricated."
   - Workler: "It never invents a line for your CV. That rule is in the instructions the model
     runs under — here they are." (link)

4. **Use the real word.** Lebenslauf, kıdem tazminatı, Block G, 4.0, Greenhouse. Concrete nouns
   from brief §5, never their generic paraphrase.
   - Weak: "supports international job markets."
   - Workler: "It knows what a 13. Monatsgehalt is, and what a TFR is worth."

5. **When something is unknown, say it is unknown.** The open regulatory question is an asset:
   it is the sentence a competitor's compliance badge cannot survive.
   - Workler: "Whether a candidate-side tool is high-risk under Annex III(4) is unsettled. We are
     not going to put a badge on it and hope."

### Anti-rules

1. **No superlatives, no "revolutionary", no "supercharge".** They are the register of the
   auto-apply category, and sounding like it is the one thing the positioning cannot afford.
   - Banned: "Supercharge your job search with AI."

2. **No borrowed scale.** No manifesto framing, no contributor counts, no star counts, no
   "trusted by" — upstream's numbers are upstream's, and under the fork decision that is a licence
   boundary as well as an honesty one (brief §4).
   - Banned: any sentence whose force comes from a number Workler did not earn.

3. **No outcome promises.** No "land your dream job", no implied placement rate.
   - Rewrite: "Stop applying to jobs that were never open" → **only** if the ghost-detection
     mechanism is shown on the same screen. Outcome language is licensed by adjacent mechanism, or
     it is not used.

4. **Never the word "scraping"**, in any tense, on any page (brief §6). "Public APIs and feeds."

5. **No unearned compliance vocabulary.** Not "GDPR compliant", not "AI Act compliant", not
   "enterprise-grade security" — no badge nobody can be named for.
   - Rewrite: "GDPR compliant" → "Hosted in [X], operated by [Y]. Here is what we store and how
     long." **Blocked until brief §1 is answered — which is the point of the rule.**

---

## 6. UNANSWERED — back to the founder verbatim

Beliefs in §3 and objections in §4 with nothing behind them. Each blocks a specific artefact.

1. **What does it cost, and what is the pricing model?** (brief §7 Q3) — Belief 8, objection 7.
   Blocks the pricing page, and therefore blocks the PRIMARY action the whole site is for. This is
   now the single highest-priority question in the project.
2. **Which capabilities are paid, and which stay in the free CLI?** (Q4) — objection 7. Until this
   is drawn, the SECONDARY action cannibalises the PRIMARY one.
3. **What entity, in which jurisdiction, hosted where, with which processors, retaining what for
   how long?** (Q7, Q11) — Belief 7, objection 4. Blocks `/privacy` and all of segment C.
4. ~~Does the site go live only when purchase works, or before?~~ **Answered 2026-09-08:
   only when purchase works.** No interim state to design.
5. ~~Is the "nobody but the seeker pays" claim true?~~ **Answered 2026-09-08: yes, the seeker pays
   and nobody else.** `/rights` unblocked. Promoted out of homework and into Belief 6a: *the only
   person Workler is paid by is the person using it.*
6. **Are there any users or beta testers at all?** (Q9) — the segments in brief §3 remain
   hypotheses until this is answered, and segment order decides the home page.
7. **Is the founder public by name?** (Q10) — objection 10, blocks `/about` and the Person entity.
8. **Does the hosted product keep the "recommend against below 4.0" behaviour?** (Q5) — Belief 2
   is currently proved by the CLI, and is being asserted about a product that is in build. If the
   hosted tier drops it, belief 2 is false and the positioning loses half its axis.
9. **Which markets and languages at launch?** (Q6) — Belief 5 cites 18 vocabulary sets that exist
   in the CLI; how many ship hosted is unknown.
10. **Has counsel been engaged?** (Q14) — the name clearance gates every name-bound asset, and the
    AI Act and accessibility statements gate objection 5.

Question 8 is the sharpest of these. Beliefs 1–6 are all proved by the free CLI, and the thing
being sold is a different, unbuilt product. Every one of those proofs is inherited rather than
demonstrated, and the site should not claim any of them about the hosted tier that the hosted tier
does not yet do.
