// Run-generation guard: a delayed transition from an old run must not fire in a newer one.
// Run: node --test test-run-generation.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRunGeneration } from "./src/lib/core/run-generation.ts";

function fakeClock() {
  let now = 0, nextId = 1;
  const timers = new Map();
  return {
    deps: {
      setTimeout: (fn, ms) => { const id = nextId++; timers.set(id, { fn, at: now + ms }); return id; },
      clearTimeout: (id) => { timers.delete(id); },
    },
    pending: () => timers.size,
    advance(ms) {
      now += ms;
      const due = [...timers.entries()].filter(([, t]) => t.at <= now).sort((a, b) => a[1].at - b[1].at || a[0] - b[0]);
      for (const [id, t] of due) { if (timers.delete(id)) t.fn(); }
    },
  };
}

test("control: a scheduled fn runs once after its delay when nothing intervenes", () => {
  const c = fakeClock(), g = createRunGeneration(c.deps), calls = [];
  g.start();
  g.schedule(() => calls.push("results"), 850);
  c.advance(849);
  assert.deepEqual(calls, []);
  c.advance(1);
  assert.deepEqual(calls, ["results"]);
  c.advance(5000);
  assert.deepEqual(calls, ["results"]);
});

test("start() before the timer fires prevents the old run's fn (and cancels the timer)", () => {
  const c = fakeClock(), g = createRunGeneration(c.deps), calls = [];
  g.start();
  g.schedule(() => calls.push("old"), 850);
  g.start();
  assert.equal(c.pending(), 0);
  c.advance(2000);
  assert.deepEqual(calls, []);
});

test("a new run's own timer still fires after an old run was superseded", () => {
  const c = fakeClock(), g = createRunGeneration(c.deps), calls = [];
  g.start();
  g.schedule(() => calls.push("old"), 850);
  c.advance(400);
  g.start();
  g.schedule(() => calls.push("new"), 850);
  c.advance(2000);
  assert.deepEqual(calls, ["new"]);
});

test("clearAll() prevents pending fns", () => {
  const c = fakeClock(), g = createRunGeneration(c.deps), calls = [];
  g.start();
  g.schedule(() => calls.push("a"), 100);
  g.schedule(() => calls.push("b"), 200);
  g.clearAll();
  assert.equal(c.pending(), 0);
  c.advance(1000);
  assert.deepEqual(calls, []);
});

test("multiple timers in one generation all run, in delay order", () => {
  const c = fakeClock(), g = createRunGeneration(c.deps), calls = [];
  g.start();
  g.schedule(() => calls.push("second"), 200);
  g.schedule(() => calls.push("first"), 100);
  g.schedule(() => calls.push("third"), 300);
  c.advance(300);
  assert.deepEqual(calls, ["first", "second", "third"]);
  assert.equal(c.pending(), 0);
});

test("a stale run scheduling late (with its own token) is dropped; the current run is unaffected", () => {
  const c = fakeClock(), g = createRunGeneration(c.deps), calls = [];
  const oldGen = g.start();
  const newGen = g.start();
  g.schedule(() => calls.push("stale"), 10, oldGen);
  g.schedule(() => calls.push("current"), 10, newGen);
  c.advance(10);
  assert.deepEqual(calls, ["current"]);
});

test("after clearAll(), a stale token cannot schedule; a fresh start() works again", () => {
  const c = fakeClock(), g = createRunGeneration(c.deps), calls = [];
  const gen = g.start();
  g.clearAll();
  g.schedule(() => calls.push("stale"), 10, gen);
  c.advance(10);
  assert.deepEqual(calls, []);
  g.start();
  g.schedule(() => calls.push("fresh"), 10);
  c.advance(10);
  assert.deepEqual(calls, ["fresh"]);
});
