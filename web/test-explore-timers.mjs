// ExploreProvider's 850 ms "revealing" -> "results" hand-off timer must not outlive its run.
// Run: node --test test-explore-timers.mjs
// Renders the REAL provider (react-dom/client over a stub container, no jsdom dependency) with fake timers.
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const SRC = fileURLToPath(new URL("./src/", import.meta.url));
registerHooks({
  resolve(spec, ctx, next) {
    if (spec === "next/navigation") return { url: "data:text/javascript,export const useRouter=()=>({refresh(){}})", shortCircuit: true };
    const p = spec.startsWith("@/") ? SRC + spec.slice(2) : spec.startsWith(".") && ctx.parentURL?.startsWith("file:") ? fileURLToPath(new URL(spec, ctx.parentURL)) : null;
    if (p) for (const e of ["", ".ts", ".tsx", "/index.ts"]) if (/\.tsx?$/.test(p + e) && existsSync(p + e)) return { url: pathToFileURL(p + e).href, shortCircuit: true };
    return next(spec, ctx);
  },
  load(url, ctx, next) {
    if (!/\/src\/.*\.tsx?$/.test(url)) return next(url, ctx);
    const out = ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    });
    return { format: "module", source: out.outputText, shortCircuit: true };
  },
});

const store = () => ({ getItem: () => null, setItem() {}, removeItem() {} });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.window = globalThis;
globalThis.HTMLIFrameElement = class {};
globalThis.history = { replaceState() {} };
for (const k of ["sessionStorage", "localStorage"]) Object.defineProperty(globalThis, k, { value: store(), configurable: true });

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { ExploreProvider, useExplore } = await import("./src/components/explore/explore-provider.tsx");
const settle = () => new Promise((r) => setImmediate(r));
const OFFER = { url: "https://x.test/1", title: "T", company: "C", location: "L", ats: "greenhouse" };
const line = (o) => new TextEncoder().encode(JSON.stringify(o) + "\n");

// "done": one offer then end (-> "revealing" + 850 ms timer). "open": held open (-> stays "casting") until finish().
function stream(kind) {
  let ctl;
  const body = new ReadableStream({ start(c) { ctl = c; if (kind === "done") { c.enqueue(line({ kind: "offer", offer: OFFER })); c.close(); } } });
  return { body, finish() { ctl.enqueue(line({ kind: "offer", offer: OFFER })); ctl.close(); } };
}

async function harness(...streams) {
  mock.timers.enable({ apis: ["setTimeout"] });
  const pending = new Set(); // outstanding 850 ms timers, tracked on top of the mock
  const st = globalThis.setTimeout, ct = globalThis.clearTimeout;
  globalThis.setTimeout = (fn, ms, ...a) => { const id = st(fn, ms, ...a); if (ms === 850) pending.add(id); return id; };
  globalThis.clearTimeout = (id) => { pending.delete(id); return ct(id); };
  const queue = [...streams];
  globalThis.fetch = async () => new Response(queue.shift().body);
  let ctx;
  const Probe = () => { ctx = useExplore(); return null; };
  const container = { nodeType: 1, nodeName: "DIV", tagName: "DIV", ownerDocument: { nodeType: 9, addEventListener() {}, removeEventListener() {} }, addEventListener() {}, removeEventListener() {}, appendChild() {}, removeChild() {}, childNodes: [] };
  const root = createRoot(container);
  const act = async (fn) => { await React.act(async () => { await fn(); await settle(); }); };
  const cleanup = () => { globalThis.setTimeout = st; globalThis.clearTimeout = ct; mock.timers.reset(); };
  try { await act(() => root.render(React.createElement(ExploreProvider, null, React.createElement(Probe)))); } catch (e) { cleanup(); throw e; }
  const tick = (ms) => act(() => mock.timers.tick(ms));
  return { get ctx() { return ctx; }, act, tick, pending, unmount: () => act(() => root.unmount()), cleanup };
}

test("control: an uninterrupted run reaches results only after the 850 ms reveal", async () => {
  const h = await harness(stream("done"));
  try {
    await h.act(() => h.ctx.discover());
    assert.equal(h.ctx.phase, "revealing");
    assert.equal(h.pending.size, 1, "reveal timer should be pending (tracker control)");
    await h.tick(849);
    assert.equal(h.ctx.phase, "revealing");
    await h.tick(1);
    assert.equal(h.ctx.phase, "results");
  } finally { h.cleanup(); }
});

test("a new run is not overwritten by the previous run's reveal timer", async () => {
  const second = stream("open"), h = await harness(stream("done"), second);
  try {
    await h.act(() => h.ctx.discover());
    assert.equal(h.ctx.phase, "revealing");
    await h.act(() => { void h.ctx.discover(); });
    assert.equal(h.ctx.phase, "casting");
    await h.tick(850);
    assert.equal(h.ctx.phase, "casting", "stale timer from run 1 must not set results on run 2");
    await h.act(() => second.finish());
    assert.equal(h.ctx.phase, "revealing");
    await h.tick(850);
    assert.equal(h.ctx.phase, "results", "run 2 still reaches results on its own timer");
  } finally { h.cleanup(); }
});

test("reset() cancels the pending reveal", async () => {
  const h = await harness(stream("done"));
  try {
    await h.act(() => h.ctx.discover());
    assert.equal(h.ctx.phase, "revealing");
    await h.act(() => h.ctx.reset());
    await h.tick(850);
    assert.equal(h.ctx.phase, "idle", "reset must stay idle, not flip to results");
  } finally { h.cleanup(); }
});

test("unmount cancels the pending reveal", async () => {
  const h = await harness(stream("done"));
  try {
    await h.act(() => h.ctx.discover());
    assert.equal(h.pending.size, 1, "reveal timer should be pending before unmount (control)");
    await h.unmount();
    assert.equal(h.pending.size, 0, "no 850 ms timer may outlive the provider");
  } finally { h.cleanup(); }
});
