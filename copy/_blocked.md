# Copy — blocked pages

Four pages in `spec/ia.md` §1 cannot be drafted, and the reason is the same in each case: they
consist almost entirely of facts nobody has supplied. Writing plausible text for them would be the
exact failure this project's rules exist to prevent — and for three of the four it would also be a
legal document making claims on the founder's behalf.

They ship as real pages or the site does not launch. None of them is optional: `/privacy` and
`/terms` are required before money changes hands, and `/accessibility` is expected under the
European Accessibility Act (brief §6).

---

## `/privacy`

**Blocked on:** brief §7 Q7 (entity, jurisdiction, hosting) and Q11 (form/payment processors).

**What it needs before a word is written:** the operating entity and its registered address · the
hosting location · every processor in the chain, including each LLM provider, the payment
processor and the analytics endpoint · the lawful basis for processing a CV · the retention period
· the deletion mechanism and how long it takes · whether CVs are used for training (the answer
must be no, and it must be true) · the DPIA outcome · the data protection contact.

**Hard constraint.** The CLI's existing legal disclaimer describes local execution and no
telemetry. **Every one of those sentences inverts for a hosted product.** None of it may be
reused, adapted or "based on". This is the single most likely place for a false claim to enter
this site, because the text already exists and appears to be about the same product.

**Who writes it:** counsel, with the founder's answers. Not this pipeline.

## `/terms`

**Blocked on:** the same entity questions, plus the billing model (brief §7 Q3).

**What it needs:** governing law and jurisdiction · the subscription terms, renewal and
cancellation · the EU/UK statutory withdrawal right and how it interacts with immediate digital
delivery · refund policy · acceptable use · limitation of liability · a clear statement that
Workler does not submit applications and the user is responsible for what they send.

**Who writes it:** counsel.

## `/about`

**Blocked on:** brief §7 Q10 — is the founder public by name?

**If yes:** a short page, first person, naming the founder, why the tool exists, and the `Person`
entity with `sameAs` links to their public profiles. It answers objection 10 and it is the
cheapest trust page on the site.

**If no:** the page does not exist, the `Person` entity does not exist, and objection 10 ("who is
behind this?") goes unanswered on a site with no testimonials, no user count and no reviews. That
is a real cost and it should be a knowing decision rather than a default. On a zero-social-proof
site, a named person is one of the few trust signals available — and it is free.

## `/accessibility`

**Blocked on:** the audit that the statement describes, and counsel's review (brief §7 Q14).

**What it needs:** the conformance target (WCAG 2.2 AA) · the actual audit date and who performed
it · known limitations, stated honestly · a feedback contact and a response time · the enforcement
procedure for the relevant jurisdiction — which requires knowing the jurisdiction.

**Note.** An accessibility statement is a factual report about a specific site on a specific date.
It cannot be written before the site is built and tested. It is the one blocked page whose blocker
this pipeline can clear itself, at `/qa-gate`.

---

## Unblocking order, cheapest first

1. **`/about`** — one decision by the founder, zero cost, immediate trust gain.
2. **`/accessibility`** — clears once the build is audited; the audit is happening anyway.
3. **`/terms`** and **`/privacy`** — counsel, and they gate the launch. Start them first even
   though they finish last.
