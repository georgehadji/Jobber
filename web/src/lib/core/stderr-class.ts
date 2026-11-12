// Classifies a CLI's stderr lines for POST /api/run. Pure so it is unit-testable.
//
// Why: the route used to treat ANY stderr line containing words like "error", "auth" or
// "not found" as a run failure, so a harmless warning failed (and could kill) a run that
// would have finished. Now only lines that clearly report a failure the CLI may NOT
// signal with a non-zero exit — bad/missing credentials, auth refusals, exhausted
// quota or credits — are "fatal". Other noteworthy lines are "warning": shown to the user,
// never a failure by themselves. The exit code, the output check and the report check in
// run-outcome.ts still decide everything else.

export type StderrClass = "fatal" | "warning" | null;

// Failures a CLI may print while still exiting 0 (the "silent false success" this gate exists for).
const FATAL =
  /unauthori[sz]ed|\bforbidden\b|not authenticated|unauthenticated|authentication (?:failed|error|required)|(?:auth|access) token (?:has )?(?:expired|is invalid|invalid)|not logged in|please (?:run )?\/?log ?in|log ?in required|invalid (?:x-)?(?:api[ _-]?key|credentials?|token)|api[ _-]?key (?:is )?(?:missing|invalid|not (?:set|found|provided|valid))|missing (?:api[ _-]?key|credentials?)|credentials? (?:not found|missing|invalid|expired|are invalid)|quota|rate[ -]?limit|credit balance|insufficient (?:credits?|funds|balance)|permission denied|access denied|\bfatal\b/i;

// A line that says the CLI is retrying is transient by definition (e.g. "rate limited, retrying in 5s").
const TRANSIENT = /\bretry(?:ing)?\b|\bretries\b|will retry|backing off/i;

// Worth showing the user (the previous single regex, plus explicit warnings).
const NOTABLE =
  /error|denied|fatal|not found|unauthori[sz]ed|forbidden|auth|login|credential|api[ _-]?key|quota|rate[ -]?limit|not authenticated|warn/i;

export function classifyStderrLine(raw: string): StderrClass {
  const line = raw.trim();
  if (!line) return null;
  if (FATAL.test(line) && !TRANSIENT.test(line)) return "fatal";
  if (NOTABLE.test(line)) return "warning";
  return null;
}

// Splits a chunked stream into lines (chunks may hold several lines or half of one).
// `flush()` emits a trailing line with no newline; overlong partial lines are emitted early.
export function makeLineSplitter(onLine: (line: string) => void, maxPartial = 4096) {
  let buf = "";
  return {
    push(chunk: string) {
      buf += chunk;
      let nl: number;
      while ((nl = buf.indexOf("\n")) !== -1) {
        onLine(buf.slice(0, nl));
        buf = buf.slice(nl + 1);
      }
      if (buf.length > maxPartial) {
        onLine(buf);
        buf = "";
      }
    },
    flush() {
      if (buf) onLine(buf);
      buf = "";
    },
  };
}
