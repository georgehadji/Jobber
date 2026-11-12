// Pure terminal-state decision for a /api/run NDJSON stream (no React, no fetch).
// The server emits exactly one `done` or `error` event; a stream that closes with
// neither (crash, proxy cut) must NOT be banked as a success.

export const UNEXPECTED_END_MESSAGE = "The run ended unexpectedly before finishing.";

export function timeoutMessage(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  return `The run timed out after ${minutes} minute${minutes === 1 ? "" : "s"} and was stopped.`;
}

export type RunStreamFacts = {
  sawDone: boolean;
  sawError: boolean;
  errorMessage?: string;
  closedCleanly: boolean;
  timedOut?: boolean;
};

export type RunFinal = { status: "done" | "error"; message?: string };

// Precedence: an error event always wins over a done event (conservative: never
// bank a run the server also flagged). `done` requires a seen `done` event.
export function finalRunState(f: RunStreamFacts): RunFinal {
  if (f.sawError) return { status: "error", message: f.errorMessage || "Error" };
  if (f.timedOut) return { status: "error", message: "The run timed out and was stopped." };
  if (f.sawDone) return { status: "done" };
  return { status: "error", message: UNEXPECTED_END_MESSAGE };
}
