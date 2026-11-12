// Consumes the NDJSON stream from POST /api/run. Pure (no React, no fetch) so the
// done/error/cancel rules are unit-testable.
//
// A run is `done` ONLY on an explicit `done` event. A clean close without one (server
// crash, dropped connection that looks like EOF) is an error, never a silent success.
// On an early `error` event the run ends as an error for the UI, but the reader is
// deliberately NOT cancelled: /api/run emits `error` for any stderr line matching words
// such as "error", "auth" or "not found", and cancelling would make the server SIGTERM
// a CLI that may still be writing a report or the tracker. The child keeps its
// tracker-write token until it really exits — that is the correct protection.
export type RunEnd = { status: "done" } | { status: "error"; label: string };
type Reader = { read(): Promise<{ done: boolean; value?: Uint8Array }>; cancel(): Promise<unknown> };

export async function consumeRunStream(reader: Reader, onEvent: (ev: { type?: string; [k: string]: unknown }) => void): Promise<RunEnd> {
  const dec = new TextDecoder();
  let buf = "";
  let sawDone = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let ev: { type?: string; [k: string]: unknown };
      try {
        ev = JSON.parse(line);
      } catch {
        continue; // partial/garbled line
      }
      onEvent(ev);
      if (ev.type === "done") sawDone = true;
      else if (ev.type === "error") {
        return { status: "error", label: (typeof ev.msg === "string" && ev.msg) || "Error" };
      }
    }
  }
  return sawDone ? { status: "done" } : { status: "error", label: "Run ended unexpectedly" };
}
