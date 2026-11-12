// Interpreting the response of POST /api/status. The route answers { ok: true, status } on success and
// { error } with 400/404/409/423/501 on refusal (409 carries set-status.mjs's own message, e.g. the
// terminal-state guard naming the legal moves). Callers must not treat "the request completed" as "the
// write happened" — they check this result and show `message` to the user. Framework-free; never throws.

export type StatusWriteResult = { ok: true } | { ok: false; status: number; message: string };

export async function readStatusWriteResult(res: Response): Promise<StatusWriteResult> {
  if (res.ok) return { ok: true };
  let message = "";
  try {
    const text = await res.text();
    if (text.trim()) {
      try {
        const body = JSON.parse(text) as { error?: unknown };
        if (typeof body?.error === "string") message = body.error.trim();
      } catch {
        /* non-JSON body: fall through to the generic message */
      }
    }
  } catch {
    /* unreadable body */
  }
  return { ok: false, status: res.status, message: message || `Status update failed (HTTP ${res.status}).` };
}

// fetch() itself rejected (offline, server down): there is no HTTP status.
export function statusWriteNetworkError(): StatusWriteResult {
  return { ok: false, status: 0, message: "Couldn't reach the server. Status not changed." };
}

// POST the write and always resolve to a result.
export async function postStatus(n: string, status: string): Promise<StatusWriteResult> {
  try {
    const res = await fetch("/api/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ n, status }),
    });
    return await readStatusWriteResult(res);
  } catch {
    return statusWriteNetworkError();
  }
}
