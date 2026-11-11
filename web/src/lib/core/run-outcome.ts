// The server's terminal event for a finished agent run (the "honesty gate", #9).
// Pure so it is unit-testable.
export type RunOutcomeIn = {
  emittedText: boolean;
  sawError: boolean;
  cleanExit: boolean; // exit code 0 (null/signal/non-zero = not clean)
  persists: boolean; // evaluate must also have written a report
  wroteReport: boolean;
  tokens: number;
  costUsd: number | null;
  timedOut: boolean; // the kill timer fired (we SIGTERMed the child)
  killMs: number;
};

export function runOutcome(i: RunOutcomeIn): { type: "done"; tokens: number; costUsd: number | null } | { type: "error"; msg: string } {
  // A timeout kill is the cause whatever else the dying child did (even exit 0 after SIGTERM).
  if (i.timedOut) return { type: "error", msg: `Timed out after ${Math.round(i.killMs / 60_000)} min — the run was stopped before finishing. Re-run it, or try a smaller job.` };
  if (!i.emittedText && !i.sawError && !i.cleanExit) return { type: "error", msg: "The CLI exited with an error — is it installed and authenticated?" };
  if (!i.emittedText && !i.sawError) return { type: "error", msg: "The CLI produced no output — is it installed and authenticated? (Jobber is best on Claude Code.)" };
  if (i.persists && !i.wroteReport) return { type: "error", msg: "This evaluation didn't save a report, so it's not in your tracker. Full evaluation is verified on Claude Code." };
  if (!i.cleanExit || i.sawError) return { type: "error", msg: "This run hit an error before finishing, so it isn't recorded as a confident result — re-run it to verify." };
  return { type: "done", tokens: i.tokens, costUsd: i.costUsd };
}
