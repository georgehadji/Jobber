# Evaluation: Satalia (WPP) — Junior Data Scientist, Greece

**Candidate:** Georgios-Chrysovalantis Chatzivantsidis (CV: `CVs/Chatzivantsidis/cv-georgios-chatzivantsidis.md`)
**Date:** 2026-11-04 (re-scored 2026-11-04 after the Semantic Paper Search project was added)
**Score:** 3.4/5 (was 3.0/5)
**URL:** https://careers.satalia.com/jobs/8511011-junior-data-scientist-greece
**Via:** —
**Archetype:** Junior Data Scientist (ML / LLM)
**Legitimacy:** High Confidence
**Work Auth:** ✅ Fully remote, Greece
**Verification:** active (check-liveness.mjs, 2026-11-04)
**PDF:** `CVs/Chatzivantsidis/CV-Georgios-Chatzivantsidis-Satalia.pdf`

---

## Machine Summary

```yaml
company: "Satalia (WPP)"
role: "Junior Data Scientist, Greece"
score: 3.4
legitimacy_tier: "High Confidence"
archetype: "Junior Data Scientist (ML / LLM)"
final_decision: "Apply with caution"
hard_stops: []
soft_gaps:
  - "MUST HAVE partly met: embeddings and LLM-based solutions shown by one personal project, built with AI coding assistance"
  - "MUST HAVE partly met: machine learning foundations not shown in CV (statistics is shown)"
  - "No production code or code review experience in CV (project has pytest tests)"
  - "No agents, fine-tuning, geospatial or ad-tech projects"
top_strengths:
  - "Statistics: taught Statistics tutorials incl. MSc Computational Physics (cv:L102-103)"
  - "Embeddings, semantic search and RAG with the Claude API, evaluated against a BM25 baseline (cv:L18, cv:L37-40)"
  - "Python data stack: pandas, NumPy, Matplotlib, SQL (cv:L15, cv:L27)"
  - "Research with numerical simulation on a supercomputer; peer-reviewed publications (cv:L60-62, cv:L116-117) — publications are a listed nice-to-have"
  - "Quantitative degree: BSc Physics (cv:L107)"
  - "Clear communication from teaching (cv:L81, cv:L88)"
risk_level: "Medium"
confidence: "High"
next_action: "Below the 4.0 bar. If applying, be ready to explain every part of the Semantic Paper Search project in an interview; adding one small scikit-learn model would close the ML gap."
work_auth: "eligible"
discard_reasons: []
via: null
company_confidential: false
advertised_comp: "€1,250 - €2,800 per month gross"
dimensions:
  cv_match:   { score: 3.3, evidence: ["cv:L15", "cv:L18", "cv:L27", "cv:L37-40", "cv:L60-62", "cv:L102-103", "cv:L107", "cv:L116-117"] }
  north_star: { score: 3.5, archetype: "Data Scientist" }
  comp:       { score: 3.0, as_of: "2026-11-04", reliability: "High" }
  cultural:   { score: 4.0, capped: false }
  red_flags:  { score: 4.0, items: ["No reply within 2 weeks means rejection"] }
  growth:     { score: 4.5, notes: ["Works with senior data scientists at WPP Research", "Frontier AI workstreams"] }
risk_summary:
  legitimacy: "high_confidence"
  classification: "clear"
  culture: "pass"
  interview_redflags: "not_evaluated"
  ai_infra: "not_evaluated"
```

## A) Role Summary

| Field | Value |
|-------|-------|
| Archetype | Junior Data Scientist, ML and LLM systems |
| Domain | Enterprise AI for WPP (marketing / advertising) |
| Workstreams | Agentic systems, federated learning, identity modelling, geospatial, synthetic data |
| Seniority | 0–2 years incl. internships or substantial academic projects |
| Remote | Fully remote, Greece; full time; start ASAP |
| Salary | €1,250–2,800 / month gross |
| TL;DR | ML-heavy junior role building models and LLM agents for production. |

## B) Match with CV

| Must have | Evidence in CV | Fit |
|---|---|---|
| Degree in a quantitative field | BSc Physics (cv:L107) | Good |
| 0–2 years DS/ML incl. academic projects | Semantic Paper Search (cv:L37-40); football-data project (cv:L47-49); research is numerical simulation, not ML (cv:L60-62) | Partial |
| Statistics and ML foundations | Statistics strong (cv:L20, cv:L102-103); ML models not shown | Partial |
| Good Python + data science stack | pandas, NumPy, Matplotlib (cv:L15, cv:L27); NumPy and sentence-transformers in the project (cv:L39) | Good |
| **Embeddings and LLM-based solutions** | Sentence-transformers embeddings, semantic search, RAG with the Claude API, evaluated against BM25 (cv:L18, cv:L37-40). One personal project, built with AI coding assistance | **Partial** (was Gap) |
| Curiosity, clear communication | Teaching, adult training, summer schools (cv:L33, cv:L81, cv:L88) | Strong |

| Nice to have | Fit |
|---|---|
| Temporal / geospatial data | Orbit time series in research (cv:L60) — partial |
| Agents, fine-tuning, embeddings projects | Embeddings project (cv:L37-40); no agents or fine-tuning |
| Publications | **Yes** (cv:L116-117) |

### Questions for the candidate (add to CV only if true)

1. Did the Summer School "AI" part include using an LLM API, embeddings or a chatbot project? (Answered 2026-11-04: no.)
2. Have you used scikit-learn or built any ML model (regression, classification, clustering)?

### What changed in the re-score

The Semantic Paper Search project (github.com/georgehadji/semantic-paper-search) now exists and is on the CV. It moves the embeddings/LLM must-have from Gap to Partial. It is not a full match: it is one small personal project, the code was written with AI help, and the 20 queries and all 176 relevance labels came from Claude. The README states all of this. The result (precision@5 0.43 vs 0.40) is not statistically significant (sign test p = 0.51); the CV gives the numbers without claiming a win.

## C) Level and Strategy

Lead with statistics teaching, research and publications, the Python stack, and the Semantic Paper Search project as the embeddings/LLM evidence. Expect screening on ML foundations.

## D) Comp and Demand

€1,250–2,800 per month gross, published. Reliability: High.

## E) Customization Plan (applied in tailored CV)

1. Headline: "Data Science: Python, Statistics, SQL".
2. Summary leads with research, statistics and publications, and mentions the semantic search and RAG project.
3. Research and Publications moved up, before certifications.
4. Semantic Paper Search listed first under Projects; AI tools line adds embeddings, semantic search, RAG (Claude API).

## F) Interview Plan

- Likely topics: statistics basics, an ML model end to end, embeddings and cosine similarity, a simple LLM pipeline (RAG).
- Prepare:
  - Walk through Semantic Paper Search step by step: why vectors are unit length, how BM25 scores, how the RAG prompt limits answers to the sources, and why the 256-token limit matters.
  - Explain the evaluation honestly: LLM-judged labels, 20 queries, p = 0.51, and why semantic search helps on plain-language queries.
  - Be open that the code was written with AI coding assistance, and show you understand each part.
  - The A&A study as a STAR story on large numerical experiments; basics of scikit-learn.

## G) Posting Legitimacy

| Signal | Finding |
|---|---|
| Channel | Employer's own careers site |
| Specificity | Detailed JD, salary band, named leadership |
| Liveness | Active (2026-11-04) |
| Assessment | **High Confidence** |

## Risk Summary

Medium risk of a fast rejection: ML foundations are not shown, and the embeddings/LLM evidence is one small project.

## Verdict

**3.4/5 — still below the 4.0 bar, so I recommend against applying unless the candidate has a specific reason.** The gap is smaller than before. The CV is ready if the candidate applies. One small scikit-learn model project would close the ML gap and could lift the score further.

## Keywords extracted

data science, machine learning, statistics, Python, embeddings, LLM, agents, RAG, fine-tuning, federated learning, geospatial, forecasting, optimisation, synthetic data, production code, testing, code review
