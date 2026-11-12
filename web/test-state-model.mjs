// The web's view of the application-status machine (STATE-MACHINES-PLAN §4.4 / Phase 4.1).
// templates/states.yml is read ONCE (lib/core/states.ts -> lib/core/state-model.ts); every list the
// UI shows (select options, pipeline tabs, analytics stages, assistant prompt) is derived from it.
// No DOM tooling, so the pure logic is driven directly. Run: node --test test-state-model.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import {
  machineFromDoc, findState, resolveCell, canonStatus, displayStates, displayLabels, tabValues, funnelStages,
  legalMoves, correctionPrompt, terminalHint, statesProse,
} from "./src/lib/core/state-model.ts";

const WEB = fileURLToPath(new URL(".", import.meta.url));
const STATES_YML = join(WEB, "..", "templates", "states.yml");
const doc = yaml.load(readFileSync(STATES_YML, "utf8"));
const M = machineFromDoc(doc);
const labels = (xs) => xs.map((s) => s.label);

// What the hard-coded copies said before they were removed (kept here as the expected data).
const OLD_ORDER = ["Evaluated", "Applied", "Responded", "Interview", "Offer", "Hired", "Rejected", "Discarded", "SKIP"];
const OLD_TABS = ["INBOX", "ALL", ...OLD_ORDER.map((l) => l.toUpperCase())];
const OLD_STAGES = OLD_ORDER.filter((l) => l !== "SKIP");
const OLD_STATUS_ALIAS = {
  evaluada: "EVALUATED", evaluado: "EVALUATED", condicional: "EVALUATED", hold: "EVALUATED", evaluar: "EVALUATED", verificar: "EVALUATED",
  aplicada: "APPLIED", aplicado: "APPLIED", enviada: "APPLIED", sent: "APPLIED",
  respondida: "RESPONDED", respondido: "RESPONDED", contestada: "RESPONDED", entrevista: "INTERVIEW", oferta: "OFFER",
  rechazada: "REJECTED", rechazado: "REJECTED", descartada: "DISCARDED", descartado: "DISCARDED", cerrada: "DISCARDED", cancelada: "DISCARDED",
  duplicado: "DISCARDED", repost: "DISCARDED", monitor: "SKIP", no_aplicar: "SKIP", "no aplicar": "SKIP",
  contratado: "HIRED", contratada: "HIRED", accepted: "HIRED", accept: "HIRED",
};

test("machine is built from states.yml: 9 states, terminals are exactly the empty-edge states", () => {
  assert.equal(M.states.length, 9);
  assert.deepEqual([...M.terminal].sort(), ["discarded", "hired", "rejected"]);
  assert.equal(M.states.find((s) => s.id === "skip").terminal, false, "skip has edges (evaluated, discarded): shelved, not terminal");
  assert.deepEqual(M.transitions.applied, ["responded", "interview", "rejected", "discarded", "skip"]);
  assert.equal(M.initial, "evaluated");
});

test("an unusable document yields null (states.ts then uses its FALLBACK)", () => {
  assert.equal(machineFromDoc(null), null);
  assert.equal(machineFromDoc({ states: [] }), null);
  assert.equal(machineFromDoc({ states: "x" }), null);
});

test("parity with the core runtime (lib/state-machine.mjs describe) when the root deps are installed", async (t) => {
  let core;
  try {
    core = await import("../lib/state-machine.mjs");
  } catch {
    return t.skip("root node_modules not installed (web-only CI)");
  }
  const d = core.describe(core.loadMachine("application-status"));
  assert.deepEqual(M.states, d.states, "states (id/label/aliases/description/terminal)");
  assert.deepEqual(M.transitions, d.transitions);
  assert.deepEqual(M.terminal, d.terminal);
  assert.deepEqual(M.policy, d.policy);
  assert.equal(M.initial, d.initial);
});

test("display order, pipeline tabs and analytics stages equal the old hard-coded lists", () => {
  assert.deepEqual(displayLabels(M), OLD_ORDER);
  assert.deepEqual(tabValues(M), OLD_TABS);
  assert.deepEqual(funnelStages(M).map((s) => s.label), OLD_STAGES);
  assert.deepEqual(funnelStages(M).map((s) => s.key), OLD_STAGES.map((l) => l.toUpperCase()));
  assert.equal(statesProse(M), OLD_ORDER.join(", "));
  assert.equal(displayStates(M).length, M.states.length, "reordering never drops or duplicates a state");
});

test("a state added to the document appears in every derived list (control: the lists are not frozen)", () => {
  const m = machineFromDoc({ states: [...doc.states, { id: "ghosted", label: "Ghosted", aliases: [] }], transitions: { ...doc.transitions, applied: [...doc.transitions.applied, "ghosted"] } });
  assert.ok(tabValues(m).includes("GHOSTED"));
  assert.ok(funnelStages(m).some((s) => s.key === "GHOSTED"));
  assert.ok(statesProse(m).includes("Ghosted"));
  assert.ok(labels(legalMoves(m, "Applied").forward).includes("Ghosted"));
});

test("canonStatus keeps every spelling the old alias table knew, and the identity cases", () => {
  const miss = [];
  for (const [k, want] of Object.entries(OLD_STATUS_ALIAS)) if (canonStatus(M, k) !== want) miss.push(`${k} -> ${canonStatus(M, k)} (want ${want})`);
  assert.deepEqual(miss, []);
  for (const s of OLD_ORDER) assert.equal(canonStatus(M, s), s.toUpperCase());
  assert.equal(canonStatus(M, ""), "DISCARDED");
  assert.equal(canonStatus(M, "—"), "DISCARDED");
  assert.equal(canonStatus(M, "-"), "DISCARDED");
  // control: text that is no state is just upper-cased (substring matching downstream still sees it)
  assert.equal(canonStatus(M, "Applied 2026-01-05"), "APPLIED 2026-01-05");
  assert.ok(canonStatus(M, "Applied 2026-01-05").includes("APPLIED"));
  assert.equal(canonStatus(M, "banana"), "BANANA");
});

test("findState/resolveCell: aliases, `**`, case, dated cells; unknown stays null", () => {
  assert.equal(findState(M, "ENVIADA").id, "applied");
  assert.equal(findState(M, "**Rejected**").id, "rejected");
  assert.equal(findState(M, "Applied 2026-01-05"), null, "findState is exact");
  assert.equal(resolveCell(M, "Applied 2026-01-05").id, "applied");
  assert.equal(resolveCell(M, "Hired (2026-01-05)").id, "hired");
  assert.equal(resolveCell(M, "**Rejected** 2026-02-01 note").id, "rejected");
  assert.equal(resolveCell(M, "Evaluada").id, "evaluated");
  assert.equal(resolveCell(M, "banana"), null);
  assert.equal(resolveCell(M, ""), null);
  assert.equal(resolveCell(M, "2026-01-05"), null);
});

for (const s of OLD_ORDER) {
  test(`legalMoves(${s}): forward = declared edges; corrections = every other state, but only for a live state`, () => {
    const st = M.states.find((x) => x.label === s);
    const mv = legalMoves(M, s);
    assert.equal(mv.current.id, st.id);
    assert.deepEqual(new Set(mv.forward.map((x) => x.id)), new Set(M.transitions[st.id]));
    assert.equal(mv.terminal, st.terminal);
    const all = [mv.current.id, ...mv.forward.map((x) => x.id), ...mv.corrections.map((x) => x.id)];
    assert.equal(new Set(all).size, all.length, "no state is offered twice");
    if (!st.terminal) assert.equal(all.length, M.states.length, "live: current + forward + corrections partition the states");
    assert.ok(!mv.forward.some((x) => x.id === st.id) && !mv.corrections.some((x) => x.id === st.id), "never offers the current state");
    if (st.terminal) {
      assert.deepEqual(mv.forward, [], "a terminal state offers no direct move");
      assert.deepEqual(mv.corrections, [], "and no correction: /api/status never passes --force, the server would refuse it");
    } else {
      assert.ok(mv.forward.length > 0 && mv.corrections.length > 0);
    }
  });
}

test("legalMoves picks the same verdict as the core's check() for every pair (when root deps exist)", async (t) => {
  let core;
  try {
    core = await import("../lib/state-machine.mjs");
  } catch {
    return t.skip("root node_modules not installed (web-only CI)");
  }
  const cm = core.loadMachine("application-status");
  const bad = [];
  for (const from of M.states) {
    const mv = legalMoves(M, from.label);
    for (const to of M.states) {
      if (to.id === from.id) continue;
      const kind = core.check(cm, from.label, to.label).kind;
      const where = mv.forward.some((x) => x.id === to.id) ? "forward" : mv.corrections.some((x) => x.id === to.id) ? "correction" : "none";
      // terminal-exit needs --force, which the web never sends -> not offered
      const want = kind === "forward" ? "forward" : kind === "correction" ? "correction" : "none";
      if (where !== want) bad.push(`${from.label}->${to.label}: ui ${where}, core ${kind}`);
    }
  }
  assert.deepEqual(bad, []);
});

test("a decorated terminal cell offers nothing (hint instead); a dated live cell still offers its moves", () => {
  const rej = legalMoves(M, "Rejected 2026-02-01");
  assert.equal(rej.current.id, "rejected");
  assert.equal(rej.terminal, true);
  assert.deepEqual(rej.forward, []);
  assert.deepEqual(rej.corrections, []);
  assert.match(terminalHint(rej, "12"), /Rejected is a final state.*node set-status.mjs 12 <State> --force/);
  const app = legalMoves(M, "Applied 2026-01-05");
  assert.deepEqual(labels(app.forward), ["Responded", "Interview", "Rejected", "Discarded", "SKIP"]);
  assert.deepEqual(labels(app.corrections), ["Evaluated", "Offer", "Hired"]);
  const skip = legalMoves(M, "SKIP");
  assert.deepEqual(labels(skip.forward), ["Evaluated", "Discarded"]);
  assert.equal(terminalHint(app, "12"), null, "live state: no hint");
  assert.equal(terminalHint(skip, "12"), null);
  assert.equal(terminalHint(legalMoves(M, "Banana"), "12"), null, "unknown cell: no hint");
});

test("an unknown cell is treated as live and offers every state directly (the core's unknown-from)", () => {
  const mv = legalMoves(M, "Banana");
  assert.equal(mv.current, null);
  assert.equal(mv.terminal, false);
  assert.deepEqual(labels(mv.forward), OLD_ORDER);
  assert.deepEqual(mv.corrections, []);
});

test("policy forbidden removes the live correction path (control: default policy keeps it)", () => {
  assert.ok(legalMoves(M, "Applied").corrections.length > 0);
  const live = machineFromDoc({ ...doc, policy: { backward_between_live: "forbidden" } });
  assert.deepEqual(legalMoves(live, "Applied").corrections, []);
});

test("correctionPrompt names the live move", () => {
  const live = correctionPrompt(legalMoves(M, "Applied"), "Evaluated");
  assert.match(live, /Applied → Evaluated/);
  assert.match(live, /correction/);
});

// ── ABSENCE: no hard-coded canonical list outside states.ts ───────────────────────────────────────
// Static text scan: fails closed (a false positive is the safe direction). A determined rewrite
// (building the list from fragments, a JSON import, ...) evades it; it only catches the copy-paste
// drift that happened before (#2249). states.ts keeps its FALLBACK on purpose.
const LABELS = new Set(M.states.flatMap((s) => [s.label.toLowerCase(), s.id]));
function hardCodedLists(src) {
  const hits = [];
  for (const m of src.matchAll(/\[([^\[\]]*)\]/g)) {
    const found = new Set([...m[1].matchAll(/"([A-Za-z_]+)"/g)].map((x) => x[1].toLowerCase()).filter((x) => LABELS.has(x)));
    if (found.size >= 3) hits.push([...found].join(","));
  }
  for (const m of src.matchAll(/\{[^{}]*\}/g)) { // object-literal alias tables
    const found = new Set([...m[0].matchAll(/\b(?:key|label)\s*:\s*"([A-Za-z]+)"/g)].map((x) => x[1].toLowerCase()).filter((x) => LABELS.has(x)));
    if (found.size >= 3) hits.push(`{${[...found].join(",")}}`);
  }
  return hits;
}
function* walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.(ts|tsx)$/.test(f)) yield p;
  }
}

test("control: the scanner flags a hard-coded canonical array and ignores ordinary lists", () => {
  assert.equal(hardCodedLists('const A = ["Evaluated", "Applied", "Offer"];').length, 1);
  assert.equal(hardCodedLists('const T = ["INBOX", "ALL", "EVALUATED", "APPLIED", "RESPONDED"] as const;').length, 1);
  assert.ok(hardCodedLists('const S = [{ key: "EVALUATED", label: "Evaluated" }, { key: "APPLIED", label: "Applied" }, { key: "OFFER", label: "Offer" }];').length >= 1);
  assert.equal(hardCodedLists('const SORT = ["company", "role", "score", "status", "date"] as const;').length, 0);
  assert.equal(hardCodedLists('const two = ["Applied", "Offer"];').length, 0);
});

test("no web source outside lib/core/states.ts hard-codes the canonical state list", () => {
  const offenders = [];
  for (const p of walk(join(WEB, "src"))) {
    const rel = relative(WEB, p).replaceAll("\\", "/");
    if (rel === "src/lib/core/states.ts") continue; // the one allowed copy: the unreadable-file FALLBACK
    const hits = hardCodedLists(readFileSync(p, "utf8"));
    if (hits.length) offenders.push(`${rel}: ${hits.join(" | ")}`);
  }
  assert.deepEqual(offenders, []);
});
