import { NextResponse } from "next/server";
import { readMachine } from "@/lib/core/states";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Read-only description of the application-status machine (states, aliases, transitions, terminal
// set, policy) derived from templates/states.yml. Same shape as `node machines.mjs describe
// application-status --json` minus `persisted_in`/`writers` (server-side paths the UI does not need).
export function GET() {
  return NextResponse.json(readMachine());
}
