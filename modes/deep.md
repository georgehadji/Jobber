# Mode: deep — Deep Research Prompt

Before generating the prompt, run `node company-intel.mjs --company "{company}"` (optional, read-only, no network) — it surfaces your own tracker responsiveness/posting-churn history, `data/active-interviews.md` friction signals, and any employer-review notes you've pasted into `data/company-intel/{slug}.md`. Facts only, never a verdict. If it returns anything relevant, fold it into axis 3 or 4 below instead of re-asking the external research for what you already know locally; an empty/no-data card just means proceed as normal.

Generate a structured prompt for Perplexity/Claude/ChatGPT with 6 axes:

```text
## Deep Research: [Company] — [Role]

Context: I am evaluating a candidacy for [role] at [company]. I need actionable information for the interview.

### 1. AI Strategy
- What products/features use AI/ML?
- What is their AI stack? (models, infrastructure, tools)
- Do they have an engineering blog? What do they publish?
- What papers or talks have they presented on AI?

### 2. Recent moves (last 6 months)
- Relevant hires in AI/ML/product?
- Acquisitions or partnerships?
- Product launches or pivots?
- Funding rounds or leadership changes?

### 3. Engineering culture
- How do they ship? (deployment cadence, CI/CD)
- Monorepo or multirepo?
- What languages/frameworks do they use?
- Remote-first or office-first?
- Glassdoor/Blind reviews about engineering culture?

### 4. Likely challenges
- What scaling problems do they have?
- Reliability, cost, latency challenges?
- Are they migrating anything? (infrastructure, models, platforms)
- What pain points do people mention in reviews?

### 5. Competitors and differentiation
- Who are their main competitors?
- What is their moat/differentiator?
- How are they positioned vs competitors?

### 6. Candidate angle
Given my profile (read from cv.md and profile.yml for specific experience):
- What unique value do I bring to this team?
- Which of my projects are most relevant?
- What story should I tell in the interview?
```

Personalize each section with the specific context of the job being evaluated.
