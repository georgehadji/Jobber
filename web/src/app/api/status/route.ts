import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import fs from "node:fs";
import { jobberRoot, rootScript } from "@/lib/jobber";
import { canonicalizeStatus } from "@/lib/core/states";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Writeback: UPDATE the status of an EXISTING tracker row only. The write goes through the core's
// own `set-status.mjs` (locked, atomic, validated, status-log ledger, terminal-state guard), so the
// web never keeps a second copy of the table-editing logic. Never adds rows — new rows go through
// the TSV + merge flow.
export async function POST(req: Request) {
  let body: { n?: string; status?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const { n, status } = body;
  if (n == null || !/^\d{1,6}$/.test(String(n).trim()) || typeof status !== "string" || !status.trim()) {
    return NextResponse.json({ error: "n (a row number) and status required" }, { status: 400 });
  }
  if (/[|\r\n*]/.test(status)) {
    return NextResponse.json({ error: "invalid status (table-breaking characters)" }, { status: 400 });
  }
  const canon = canonicalizeStatus(status);
  if (!canon) {
    return NextResponse.json({ error: `not a canonical status: ${status}` }, { status: 400 });
  }

  const script = rootScript("set-status");
  if (!fs.existsSync(script)) {
    return NextResponse.json({ error: "Updating a status needs a complete Jobber checkout (set-status.mjs)." }, { status: 501 });
  }

  const result = await new Promise<{ code: number | null; out: string }>((resolve) => {
    execFile(
      process.execPath,
      [script, String(n).trim(), canon, "--json"],
      { cwd: jobberRoot(), env: process.env, timeout: 30_000, encoding: "utf8" },
      (err, stdout, stderr) => {
        // execFile reports the exit status in err.code (a number); a spawn failure has a string code.
        const raw = err ? (err as { code?: unknown }).code : 0;
        resolve({ code: typeof raw === "number" ? raw : 1, out: String(stdout || stderr || "") });
      },
    );
  });

  if (result.code === 0) return NextResponse.json({ ok: true, status: canon });
  let message = result.out.trim().slice(0, 200);
  try {
    message = JSON.parse(result.out).error ?? message;
  } catch {
    /* plain text */
  }
  // set-status exit codes: 2 not found, 3 ambiguous, 4 lock timeout, else refused/usage
  const http = result.code === 2 ? 404 : result.code === 3 ? 409 : result.code === 4 ? 423 : 409;
  return NextResponse.json({ error: message || "status update failed" }, { status: http });
}
