# Copy — `/ghost-jobs`

**Target reading level:** UK reading age 12–13 / US grade 7. This page is an entry page for
someone who is tired and frustrated, not evaluating software. Shorter sentences than the rest of
the site.

**Job (ia §1):** own the strongest search cluster. Answer "is this posting real" for someone who
has never heard of Workler and may never see the home page.

## Head

`<title>` (46 chars)
> Ghost jobs: how to tell if a posting is real

Meta description (154 chars)
> A ghost job is a posting advertised with no intention to hire. Here are the signals that give
> one away, and how Workler checks a posting before you apply.

*Competitor-swap test: this title is true of any honest article on the subject, which is correct —
the page has to win on being the better answer, not on naming the product in the title.*

## H1

> Some job postings were never open

## Answer block (54 words, from query-map §3)

> A ghost job is a posting that is advertised while no hire is intended — already filled, held
> open to collect résumés, or left up after the role closed. The signals are checkable: a listing
> relisted three times in ninety days, a role still advertised after it was filled. Workler scores
> posting legitimacy separately from how well you fit it.

---

## Section 1 — Why this happens

*Kills the visitor's private theory that the problem is them. That belief is why they stopped
applying, and no product argument lands until it is addressed.*

> If you have sent eighty applications and heard back from four, the explanation you have probably
> settled on is that something is wrong with your CV.
>
> Sometimes it is. Often the posting was not a real vacancy.
>
> Companies leave postings up after a role is filled. Some keep a pipeline advert running
> permanently. Agencies post roles they do not have to collect CVs. None of this is visible from
> the advert, and none of it is your fault.

## Section 2 — The signals

*Installs belief 3. This is the section that has to be genuinely useful whether or not anyone buys
anything.*

> These are checkable from the outside, without any tool:
>
> - **The same role, relisted.** A posting that reappears every few weeks is either a role nobody
>   is filling or an advert that is not attached to one. Three times in ninety days is the point
>   where coincidence stops being the explanation.
> - **It outlives its own hire.** The role is announced as filled, or someone appears in it, and
>   the advert stays up.
> - **No closing date, forever.** Evergreen postings with no requisition and no date attached.
> - **The advert describes no team.** No manager named, no product named, no reporting line — a
>   description that would fit any company on the shelf.
> - **It reappears across agencies with different titles.** The same role, three intermediaries,
>   none of whom will name the employer.
>
> None of these is proof on its own. Two or three together usually are.

## Section 3 — What Workler does about it

*Bridges to the product without pretending the previous section was a preamble.*

> Workler scores this separately from how well you fit the job. It is Block G of the report, and
> it does not get averaged into your fit score — because a role you are perfect for is worth
> nothing if nobody is hiring.
>
> It checks whether a posting is still live, tracks roles that get relisted, and flags the ones
> that behave like ghosts.

Claim-with-receipt: `Liveness checking and repost detection are in the repository.` → links to
`check-liveness.mjs` and `detect-reposts.mjs`.

Demo record here: the legitimacy-flagged posting, showing the flag and the reason.
`[CLIENT INPUT REQUIRED: the committed demo records — brief §4 CAN GET.]`

## Section 4 — And then it still might tell you no

*Installs belief 2 on a page that could otherwise leave the visitor thinking the product is only a
ghost-job checker.*

> For postings that are real, Workler scores your fit from 1 to 5. Below 4.0 it recommends you
> don't apply, and tells you what was missing.
>
> The point of both checks is the same: fewer applications, aimed better.

Link: How the score works → `/how-it-works`

## Section 5 — Close

> Workler never sends an application for you. It tells you which ones are worth sending.
>
> **See what it costs →** · Or run the free command-line version →

---

## Alt text

- Legitimacy flag: `Block G, posting legitimacy: flagged. This role was relisted three times in
  ninety days.`
- Report demo: as `/how-it-works`.
