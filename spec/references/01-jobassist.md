# Reference 01 — jobassist.com

**Added:** 2026-09-08, by the founder. **Reviewed live:** 2026-09-08.
**What I want from it:** [CLIENT INPUT REQUIRED — see "Which kind of reference is this?" below.]

**Classification: this is a competitor, and specifically the competitor whose behaviour Workler's
positioning is a refusal of.** Recorded here in full because that makes it valuable, but it is not
yet clear whether it was supplied as something to move toward or something to move away from. The
answer changes every direction `/art-direction` will propose.

---

## What it is

An auto-apply job platform. Its own words: "Auto Apply in one click", "Apply to 10 jobs in minutes
– not hours", "500.000+ Tailored applications submitted". Volume is the headline metric and the
headline promise.

This is the shelf Workler is filed on by default (message-map §1) and the axis Workler is not
interchangeable on. jobassist.com applies for you. Workler stops before the send.

## Design observations

**Layout.** Left-aligned hero, product card floated right. Nav is logo-left / four-links-centre /
Log in + Signup right — the exact arrangement on the banlist. Rounded cards, soft shadows, generous
white space, a stats band (`20.000+` / `7.000.000+` / `500.000+`), a two-column "Doing it alone vs
With JobAssist" comparison, then a live-activity ticker.

**Palette.** Near-white ground, deep blue as the single brand colour carrying both the wordmark
and the primary button, one bright accent dot on the headline full stop. Employer logos supply the
only other colour on the page.

**Type.** Geometric sans throughout, one family, heavy display weight at large size, regular body.
Display face reads as Inter/Poppins-adjacent — on the banlist as a display choice.

**Motion.** A scrolling ticker of recent applications. Cookie consent banner on load.

**Density.** Low. Large type, short lines, lots of air. It reads competent and generic — the
median result of this brief given to ten studios, which is the banlist's own test.

## What it does that Workler cannot, must not, or will not

| jobassist.com | Workler |
|---|---|
| "Auto Apply in one click" | Never submits. The last click is the user's (belief 1). |
| `4.8 based on 870 reviews`, `500.000+ applications submitted` | No reviews, no counts, no ratings exist and none are coming (brief §4). `AggregateRating` markup is explicitly excluded (query-map §4). |
| A live ticker: "Lucas H. · 3m ago · applied to Customer Service Representative at Walmart" — the same eight names repeating on a loop | Nothing analogous. There are no users to show, and a synthetic one would be a fabrication. |
| Employer logos (Microsoft, Apple, Amazon, Walmart…) used as a trust device for a product those employers have no relationship with | No logo wall. Not available, and the borrowed-credibility move is precisely what the proof inventory forbids. |
| Cookie consent banner | Cookieless self-hosted analytics, no banner (brief §6) — conditional on that claim being true. |

## The single most useful thing on this page

**Every match score is 89–94 out of 100.** Twelve sample postings, three rotating verdicts —
"Excellent fit", "Great fit" — and not one negative. The stated reasons rotate between three
generic strings ("Your experience and skills line up well with this role", "Your background fits
what this employer is looking for", "Your profile matches the core requirements for this job"),
identical across unrelated roles at Walmart, Apple and JPMorgan.

That is a scoring system that structurally cannot say no, demonstrated on its own home page.

It independently confirms the constraint already written into `spec/ia.md` §5: Workler's committed
demo set **must** include a posting scored below 4.0 with `recommendation: do-not-apply`, and one
with `legitimacy_flag: true`, enforced in CI. Side by side, the difference between the two
products is visible in about four seconds without a word of copy — which makes this the strongest
argument yet for the demo component being placed high on the home page.

It also sharpens belief 2 (message-map §3). "It will tell you not to apply" is not an abstract
virtue; it is the thing the category's leading pages demonstrably do not do.

## Which kind of reference is this?

Two readings, and the answer decides how `/art-direction` uses it:

1. **Anti-reference.** "This is the category. Do not look like it, do not argue like it." Under
   this reading the file is a constraint list and the visual direction moves deliberately away
   from soft blue cards and low density.
2. **Craft reference.** "Match this level of polish and clarity, with the opposite argument."
   Legitimate — the page is clean and legible, and Workler is not helped by looking scrappier than
   its competitors.

**Recommended: (1), with the clarity of (2) as a floor, not a target.** Copying this site's visual
register while inverting its message would put Workler in the same frame and force the visitor to
compare on the axis where it loses — volume — instead of the axis where it wins. But polish is not
optional either; a zero-social-proof site that also looks unfinished has nothing left.

[CLIENT INPUT REQUIRED: which reading? One word is enough.]

## Still needed

The art-direction skill requires 3–5 references and will not propose a direction on one — and on
this one alone it certainly should not, because a competitor is not a visual brief. **2–4 more,
and none of them job-search products.** Most useful: things whose *density, restraint and type
treatment* you want, from any field — documentation, a financial or scientific instrument, an
editorial site, print. One you actively dislike is worth more than three you like.
