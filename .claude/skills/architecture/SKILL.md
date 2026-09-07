---
description: Produce the sitemap, template inventory, locale plan and the SEO/GEO query and entity map into spec/ia.md and spec/query-map.md. Use after art direction is locked, before copy.
---

Read `spec/brief.md`, `spec/message-map.md`, `spec/art-direction.md`.

## spec/ia.md
1. SITEMAP — every URL, its single job, funnel position, internal links in and out.
   URL scheme stated as a rule.
2. TEMPLATE INVENTORY — the minimum set of templates and the components each needs.
   Flag every component used on 3+ templates; those are built once.
3. NAVIGATION — primary, footer, crawl path. Justify every item; an item serving no
   segment in brief §3 is removed.
4. INTERNATIONAL — locale strategy (subfolder vs subdomain vs ccTLD) with the trade-off
   stated, hreflang matrix including x-default, currency/unit/date handling, and which
   pages are translated vs transcreated vs market-specific. Machine-translated sales copy
   does not ship.
5. CMS MODEL — content types and fields, designed so a non-technical editor cannot break
   the layout.

## spec/query-map.md
6. One page = one intent cluster. Per page: the primary question in the user's own words,
   5–15 real long-tail phrasings including full-sentence and conversational forms, and the
   pages currently answering them.
7. ENTITY MAP — organisation, people, products, services, locations to establish as
   entities, the pages and markup that establish each, and the external corroboration list
   (registries, profiles, directories, publications) where naming must stay consistent.
8. ANSWER BLOCKS — per page, the extractable 40–60 word direct answer that sits near the
   top, before the persuasion, written to survive being quoted out of context.
9. SCHEMA PLAN — JSON-LD types per template with required and recommended properties.
   Every schema statement must match visible page content. No FAQPage without a real FAQ.

Note in the file: Google's documented position is that no AI-specific markup, file, or
schema is required for AI Overviews or AI Mode eligibility — indexability and snippet
eligibility are the requirements. Do not sell or build tactics that contradict this.
