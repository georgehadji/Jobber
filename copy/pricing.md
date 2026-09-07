# Copy — `/pricing`

**Target reading level:** UK reading age 13 / US grade 8.
**Job (ia §1):** the PRIMARY action. Purchase. Draw the free/paid boundary so the free CLI stops
competing with the paid tier.

> ## ⚠ This page cannot be completed
>
> Two facts are missing and neither can be guessed: **the price** (brief §7 Q3) and **the
> free/paid boundary** (brief §7 Q4). Everything below is the structure, the argument and the
> states, with the two facts marked. A rounded guess on a pricing page is not a placeholder — it
> is the one number a visitor will hold you to.
>
> The site does not launch until purchase works (brief §1), so this page and a working checkout
> ship together or neither ships.

## Head

`<title>` (36 chars)
> Pricing — Workler

Meta description (≤155) — cannot be written without the price. A pricing meta description that
does not contain the price is a wasted result.
`[CLIENT INPUT REQUIRED: price.]`

## H1

> What it costs

## Answer block (structure fixed, from query-map §3)

> Workler CLI is free and open source. The hosted version costs **[PRICE]** per **[PERIOD]** and
> adds **[PAID CAPABILITIES]**. It is paid for by the person using it — there is no employer,
> recruiter or advertiser revenue, so there is nobody else for it to be optimised for.

---

## Section 1 — The two tiers

*Kills objection 7: "there's a free version, why pay?" — the single most important sentence on
this page, and the one that is blocked.*

Tier comparison, two columns. Per `spec/ia.md` §5 the `excludes[]` field is **required and
non-empty** on both tiers: a boundary drawn only by listing what each tier includes is not a
boundary, and a visitor who cannot see the edge assumes the free tier is the whole product.

| | Workler CLI | Workler hosted |
|---|---|---|
| Price | Free, MIT licence | `[CLIENT INPUT REQUIRED]` |
| Runs | On your machine, inside your AI coding CLI | In the browser |
| Includes | `[CLIENT INPUT REQUIRED]` | `[CLIENT INPUT REQUIRED]` |
| Does not include | `[CLIENT INPUT REQUIRED]` | `[CLIENT INPUT REQUIRED]` |

> Honest framing for whichever way the boundary falls: the CLI is not a crippled demo of the
> hosted product. It is the whole judgment, running on your machine, and it will stay that way.
> What the hosted version sells is `[CLIENT INPUT REQUIRED: convenience? scale? something the CLI
> cannot do?]`.

## Section 2 — What you are not paying for

*Installs belief 6a on the page where money is discussed, which is where it matters most.*

> No employer is paying us to show you their roles. No recruiter is buying your details. There are
> no ads.
>
> You are the only customer, which is why there is a price.

Link: Who this works for → `/rights`

## Section 3 — What happens when you pay

*Removes friction at the exact point it appears. Every unanswered question here is an abandoned
checkout.*

> `[CLIENT INPUT REQUIRED — all of the following, and each one is a conversion leak until answered:
> is there a free trial or a refund window? Is it monthly, annual or one-off? Can you cancel in one
> click? Is VAT included in the displayed price or added at checkout? Which currencies? What
> happens to your data if you cancel?]`

## CTA

Label: **Subscribe →** or **Buy Workler →** — the label must name what actually happens, so it is
set by the billing model, not chosen for tone.
`[CLIENT INPUT REQUIRED: billing model.]`

Micro-copy under the button: the friction remover — refund window, or cancel-anytime, or "no card
until the trial ends". Whichever is true.

What the visitor sees immediately after clicking: the checkout, on the same domain if possible,
with the price and the billing period repeated at the top. A checkout that restates the price
converts better than one that assumes the visitor remembers it.

## States

- **Default.** Both tiers, price visible, CTA active.
- **Error.** Payment declined: *"That payment didn't go through. Your card was not charged. Try
  another card, or email `[address]` and we'll sort it out."* States what happened, what it means,
  what to do. No apology, no "oops".
- **Success.** Confirmation naming what was bought, the amount, the billing period, and the next
  renewal date. A "Subscribe" button produces a page that says "Subscribed".
- **Empty / not-yet-launched.** **Does not exist.** The site does not go live before purchase
  works (brief §1), so there is no waitlist state, no "coming soon", and no email capture on this
  page.

## Schema

`Offer` on the `SoftwareApplication`: `price`, `priceCurrency`, `availability: InStock` — never
`PreOrder`, given the launch-with-purchase decision. Must match the visible price exactly
(query-map §4).

---

## The one thing to get right

The free CLI is the site's SECONDARY action and its substitute for a free trial. It is also this
page's biggest threat. If the boundary is drawn vaguely, segment B reads the vagueness as an
admission that the hosted tier adds nothing, and takes the free version — which was going to
happen anyway, but now without ever considering the paid one.

Draw the line in one sentence a sceptic would accept. That sentence is worth more work than the
rest of this page combined.
