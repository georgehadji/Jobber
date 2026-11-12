// Test helper (not a test): lets `node --test` import src/**/*.ts(x) that use the "@/..." alias.
// `import "./alias-hooks.mjs"` first, then load the module under test with a DYNAMIC import
// (static imports are linked before this file runs). Same loader idea as test-explore-timers.mjs.
import { registerHooks } from "node:module";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const SRC = fileURLToPath(new URL("./src/", import.meta.url));
registerHooks({
  resolve(spec, ctx, next) {
    const p = spec.startsWith("@/") ? SRC + spec.slice(2) : null;
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
