// Tests for web/src/lib/hosted-run-pure.ts — the filesystem/subprocess-free
// half of hosted-run.ts (web/src/app/api/run/route.ts's evaluate/pdf
// helpers). Imported directly, no mocking, same convention as
// test-submit-guard.mjs. hosted-run.ts's other exports (hostedRouteChain,
// hostedApiKey, hostedEnv, fetchJdCached) import jobberRoot() from
// "@/lib/jobber", which pulls in web/'s "@/lib/*" alias graph — resolvable by
// Next's bundler, not by plain `node --test` — which is exactly why the pure
// logic lives in its own zero-import file instead of being untestable here.
//
// Run:  node --test test-hosted-run.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { slugifyUrl, reportUrl } from "./src/lib/hosted-run-pure.ts";

test("slugifyUrl produces a stable, filesystem-safe cache key", () => {
  assert.equal(slugifyUrl("https://boards.greenhouse.io/acme/jobs/123"), "boards-greenhouse-io-acme-jobs-123");
  // Same posting, different casing/scheme noise → same key (cache actually hits).
  assert.equal(slugifyUrl("HTTPS://Boards.Greenhouse.io/acme/jobs/123"), slugifyUrl("https://boards.greenhouse.io/acme/jobs/123"));
});

test("slugifyUrl never returns an empty string", () => {
  assert.equal(slugifyUrl(""), "posting");
  assert.equal(slugifyUrl("https://"), "posting");
});

test("reportUrl extracts the URL line a report header carries", () => {
  const report = "# Evaluation: Acme — Engineer\n\n**Date:** 2026-09-08\n**Score:** 4.0/5\n**URL:** https://acme.example/jobs/1\n**PDF:** pending\n";
  assert.equal(reportUrl(report), "https://acme.example/jobs/1");
});

test("reportUrl returns null when the report has no URL line (control)", () => {
  const report = "# Evaluation: Acme — Engineer\n\n**Date:** 2026-09-08\n**Score:** 4.0/5\n**PDF:** pending\n";
  assert.equal(reportUrl(report), null);
});
