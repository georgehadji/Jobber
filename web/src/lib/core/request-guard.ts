// Request boundary for /api/*. Pure on purpose: web/src/proxy.ts feeds it the
// request headers and test-request-guard.mjs drives it with plain objects.
//
// Threat: this app reads and writes the user's CV, tracker and portals.yml and
// can start a Bash-enabled agent. A web page the user happens to visit must not
// reach it (CSRF from any origin, DNS rebinding through an attacker hostname).
// So: the Host must be a loopback name, and anything that changes state must be
// same-origin JSON (a non-simple Content-Type forces a CORS preflight that we
// never answer).

export type GuardInput = {
  method: string;
  host: string | null;
  origin: string | null;
  secFetchSite: string | null;
  contentType: string | null;
};

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
const SAFE_METHODS = new Set(["GET", "HEAD"]);
// The one multipart upload (CV ingest) cannot be JSON; the Origin rule covers it.
const MULTIPART_OK = /^\/api\/cv\/ingest$/;

function hostname(hostPort: string): string {
  const h = hostPort.trim().toLowerCase();
  if (h.startsWith("[")) return h.slice(0, h.indexOf("]") + 1);
  return h.split(":")[0].replace(/\.$/, "");
}

/** JOBBER_ALLOWED_HOSTS="my-box.lan,other" extends the loopback allowlist (remote/Docker use). */
function allowedHosts(env: string | undefined): Set<string> {
  const extra = (env ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return new Set([...LOOPBACK, ...extra]);
}

/** Returns a rejection reason, or null when the request may proceed. */
export function checkRequest(input: GuardInput, pathname: string, env?: string): string | null {
  if (!input.host || !allowedHosts(env).has(hostname(input.host))) {
    return "Host not allowed";
  }
  if (SAFE_METHODS.has(input.method.toUpperCase())) return null;

  if (input.origin !== null) {
    let originHost: string;
    try {
      originHost = new URL(input.origin).host.toLowerCase();
    } catch {
      return "Bad Origin";
    }
    if (originHost !== input.host.trim().toLowerCase()) return "Cross-origin request blocked";
  } else if (input.secFetchSite !== null && !["same-origin", "none"].includes(input.secFetchSite)) {
    return "Cross-site request blocked";
  }

  const ct = (input.contentType ?? "").toLowerCase();
  const isJson = ct.startsWith("application/json");
  const isUpload = MULTIPART_OK.test(pathname) && ct.startsWith("multipart/form-data");
  if (!isJson && !isUpload) return "Content-Type must be application/json";
  return null;
}
