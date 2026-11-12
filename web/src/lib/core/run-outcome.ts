// The server's terminal event for a finished agent run (the "honesty gate", #9).
// Pure so it is unit-testable.
export type RunOutcomeIn = {
  emittedText: boolean;
  // First stderr line classified "fatal" (stderr-class.ts) — e.g. bad credentials or an
  // exhausted quota, which a CLI may report while still exiting 0. null = none seen.
  fatalMsg: string | null;
  // Last stderr line classified "warning" — context only, never a failure by itself.
  lastWarning: string | null;
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
  // A reported failure wins over everything else, and the user sees the CLI's own words.
  if (i.fatalMsg) return { type: "error", msg: `The CLI reported a problem: "${i.fatalMsg}". This run isn't recorded as a confident result — fix that and re-run it.` };
  const detail = i.lastWarning ? ` Last message from the CLI: "${i.lastWarning}"` : "";
  if (!i.emittedText && !i.cleanExit) return { type: "error", msg: `The CLI exited with an error — is it installed and authenticated?${detail}` };
  if (!i.emittedText) return { type: "error", msg: "The CLI produced no output — is it installed and authenticated? (Jobber is best on Claude Code.)" };
  if (i.persists && !i.wroteReport) return { type: "error", msg: "This evaluation didn't save a report, so it's not in your tracker. Full evaluation is verified on Claude Code." };
  if (!i.cleanExit) return { type: "error", msg: `This run hit an error before finishing, so it isn't recorded as a confident result — re-run it to verify.${detail}` };
  // Warnings alone never fail a run that exited cleanly with real output (and a report, when required).
  return { type: "done", tokens: i.tokens, costUsd: i.costUsd };
}
