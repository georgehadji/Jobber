"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { useMachine } from "@/components/machine-provider";
import { correctionPrompt, legalMoves } from "@/lib/core/state-model";
import { postStatus } from "@/lib/status-write";

// Status writeback control. Updates the existing tracker row (status cell) via
// /api/status — never adds rows. Shows the LEGAL moves for the current status first; every other
// state sits behind an explicit "correction…" choice that asks for confirmation (D1: backward and
// other moves stay possible). Reverts on failure and shows the server's message.
const CORRECTION = "__correction__";

export function StatusSelect({ n, current }: { n: string; current: string }) {
  const machine = useMachine();
  const [status, setStatus] = useState(current);
  const [correcting, setCorrecting] = useState(false);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const moves = legalMoves(machine, status);

  async function write(next: string) {
    const prev = status;
    setStatus(next);
    setCorrecting(false);
    setBusy(true);
    setError(null);
    const r = await postStatus(n, next);
    if (r.ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      router.refresh();
    } else {
      setStatus(prev); // revert on failure, and say why
      setError(r.error);
    }
    setBusy(false);
  }

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const v = e.target.value;
    if (v === CORRECTION) return setCorrecting(true);
    if (v !== status) void write(v);
  }

  function onCorrect(e: React.ChangeEvent<HTMLSelectElement>) {
    const v = e.target.value;
    if (v && window.confirm(correctionPrompt(moves, v))) void write(v);
    else setCorrecting(false);
  }

  const cls =
    "rounded-md border border-border bg-surface px-2.5 py-1 text-sm text-foreground outline-none transition-colors focus:border-brand/50 disabled:opacity-50 max-sm:min-h-[44px]";
  return (
    <span className="inline-flex items-center gap-2">
      <label className="text-xs text-faint">status</label>
      <select value={correcting ? CORRECTION : status} onChange={onChange} disabled={busy} className={cls}>
        <option value={status}>{status}</option>
        {moves.forward.filter((s) => s.id !== moves.current?.id).map((s) => (
          <option key={s.id} value={s.label}>
            {s.label}
          </option>
        ))}
        {moves.corrections.length > 0 && <option value={CORRECTION}>correction…</option>}
      </select>
      {correcting && (
        <select value="" onChange={onCorrect} disabled={busy} aria-label="Correct status to" className={cls}>
          <option value="" disabled>
            correct to…
          </option>
          {moves.corrections.map((s) => (
            <option key={s.id} value={s.label}>
              {s.label}
            </option>
          ))}
        </select>
      )}
      {error && (
        <span role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </span>
      )}
      {saved && (
        <span className="animate-terminal-popup inline-flex items-center gap-1 text-xs font-medium text-brand">
          <Check className="size-3" /> saved
        </span>
      )}
    </span>
  );
}
