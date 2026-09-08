# Banlist — binding unless spec/brief.md explicitly requests the item

## Visual defaults that read as machine-generated
- Purple/blue gradient hero, or any gradient-filled headline text.
- Cream (#F4F1EA-ish) background + high-contrast serif display + terracotta/clay accent (~#D97757).
- Near-black background with a single acid-green or vermilion accent.
- Broadsheet pastiche: hairline rules, zero radius, dense newspaper columns.
- Inter / Geist / Poppins / Montserrat as the display face.
- Untouched shadcn defaults: rounded-xl + 1px ring + soft shadow card grids.
- Centred hero headline + subhead + two buttons.
- Nav as logo-left / three-links-centre / sign-in-right.
- Three-icon feature row using Lucide icons.
- Emoji used as iconography.
- Stock photography of people pointing at laptops.
- `01 / 02 / 03` markers where the content is not actually a sequence.

## Material Design specifics (added 2026-09-08, `spec/brief.md` §6 directive)
- The M3 baseline palette — seed `#6750A4` and its default violet containers. A seed must be this
  site's own (`spec/material-plan.md` §3.1); shipping the baseline seed is the same failure mode
  as untouched shadcn defaults, one entry up.
- A FAB (floating action button). Nothing on this site is a single dominant repeated action a FAB
  fits.
- Bottom navigation. Marketing site, not an app shell; there is nothing to switch between.
- Ripple feedback implemented in JS. Contradicts the zero-JS contract (`spec/brief.md` §6
  "Budgets"). State layers are CSS-only (`::after`, opacity transition); no ripple.
- Full, un-narrowed M3 elevation on every card. Elevation 1 is reserved for the single record the
  page is arguing you should trust most (`spec/material-plan.md` §4); a page where every card
  floats is the "elevated card grid" entry, restated in M3 vocabulary.

## Motion
- Decorative scroll lines, meteor/comet trails, cursor-following glows, aurora blobs,
  animated gradient meshes, floating 3D shapes.
- More than one orchestrated moment per page.
- Any animation over 400ms that is not the signature element.
- Any animation not disabled under `prefers-reduced-motion`.

## Copy
- "In today's fast-paced world", "Unlock/Elevate/Empower/Transform your…",
  "We don't just X, we Y", "It's not about X — it's about Y", "seamless",
  "cutting-edge", "game-changing", "solutions" as a standalone noun, "journey".
- Any headline that stays true when the company name is swapped for a competitor's.
- Any proof not present in the brief's PROOF INVENTORY.

## Test
For every visual decision: if the same brief given to ten studios using AI tools would
produce this, it is a default, not a choice. Revise and say what changed and why.
