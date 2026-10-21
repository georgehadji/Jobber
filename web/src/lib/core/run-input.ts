// Validation for POST /api/run. `input` is spliced into an agent prompt that
// has Bash, so each kind accepts only the shape it needs (quotes, newlines and
// shell metacharacters never fit any of them).

export const RUN_KINDS = ["evaluate", "research", "pdf", "fix-portal"] as const;
export type RunKind = (typeof RUN_KINDS)[number];

const URL_RE = /^https?:\/\/[^\s"'`\<>]{1,2000}$/;
const INPUT_RULES: Record<RunKind, RegExp> = {
  evaluate: URL_RE,
  // read-only agent (no Bash): a URL or a short single-line description of the user's own work
  research: /^[^\x00-\x1f]{1,2000}$/,
  pdf: /^\d{1,4}$/,
  "fix-portal": /^[\p{L}\p{N} .&'()-]{1,80}$/u,
};

/** Returns an error message, or null when kind/input are acceptable. */
export function validateRun(kind: unknown, input: unknown): string | null {
  if (typeof kind !== "string" || !(RUN_KINDS as readonly string[]).includes(kind)) {
    return `kind must be one of: ${RUN_KINDS.join(", ")}`;
  }
  if (typeof input !== "string" || !INPUT_RULES[kind as RunKind].test(input)) {
    return `input is not valid for kind '${kind}'`;
  }
  return null;
}
