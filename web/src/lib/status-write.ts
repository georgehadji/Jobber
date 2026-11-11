// One place that turns a /api/status response into success-or-reason, so no UI can claim a status
// changed when the server refused it (404 not found, 409 refused/ambiguous, 423 locked).
export type StatusResult = { ok: true } | { ok: false; error: string };

export async function postStatus(n: string, status: string, fetchImpl: typeof fetch = fetch): Promise<StatusResult> {
  try {
    const res = await fetchImpl("/api/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ n, status }),
    });
    if (res.ok) return { ok: true };
    let error = `status update failed (HTTP ${res.status})`;
    try {
      const body = (await res.json()) as { error?: unknown };
      if (typeof body.error === "string" && body.error.trim()) error = body.error;
    } catch {
      /* non-JSON body: keep the generic message */
    }
    return { ok: false, error };
  } catch {
    return { ok: false, error: "network error - status not changed" };
  }
}
