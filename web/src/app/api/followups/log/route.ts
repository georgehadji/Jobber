import fs from "node:fs";
import path from "node:path";
import { jobberRoot } from "@/lib/jobber";
import { atomicWrite } from "@/lib/core/safe-write";
import { FOLLOWUPS_HEADER, cellText, followupRow, nextFollowupNum } from "@/lib/core/followups";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Follow-up log → data/follow-ups.md, in the TABLE format `followup-cadence.mjs` parses (a bullet
// line would be invisible to the cadence). Append-only: the existing file is read, one row is added
// and the whole file is written atomically. Every field is flattened to one table cell.
export async function POST(req: Request) {
  let body: { num?: string | number; company?: string; role?: string; channel?: string; contact?: string; note?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  const company = cellText(body.company);
  if (!company) return Response.json({ error: "company required" }, { status: 400 });
  const appNum = body.num != null && /^\d{1,6}$/.test(String(body.num).trim()) ? String(body.num).trim() : null;
  if (body.num != null && appNum === null) return Response.json({ error: "num must be an application number" }, { status: 400 });

  const file = path.join(jobberRoot(), "data", "follow-ups.md");
  try {
    let existing = "";
    try {
      existing = fs.readFileSync(file, "utf8");
    } catch {
      existing = "";
    }
    const base = existing.trim() ? existing.replace(/\n*$/, "\n") : FOLLOWUPS_HEADER + "\n";
    const row = followupRow({
      num: nextFollowupNum(base),
      appNum,
      date: new Date().toISOString().slice(0, 10),
      company,
      role: body.role,
      channel: body.channel,
      contact: body.contact,
      notes: body.note || "Followed up",
    });
    atomicWrite(file, base + row + "\n");
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "write failed" }, { status: 500 });
  }
  return Response.json({ ok: true });
}
