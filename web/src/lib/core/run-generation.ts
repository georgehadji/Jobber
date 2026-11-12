// Run-generation guard + timer bag for UI state machines whose delayed phase
// transitions must never leak from an old run into a newer one.
// Framework-free so it can be tested with a fake clock.

export type TimerId = unknown;
export interface RunGenerationDeps {
  setTimeout?: (fn: () => void, ms: number) => TimerId;
  clearTimeout?: (id: TimerId) => void;
}

export interface RunGeneration {
  /** Begin a new run: bumps the generation, cancels pending timers. Returns the new generation. */
  start(): number;
  /** Run fn after ms, only if the generation (default: current; or the one `start()` returned) is still current. */
  schedule(fn: () => void, ms: number, gen?: number): void;
  /** Cancel every pending timer and invalidate the current generation (reset / unmount). */
  clearAll(): void;
  readonly generation: number;
}

export function createRunGeneration(deps: RunGenerationDeps = {}): RunGeneration {
  const set = deps.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
  const clear = deps.clearTimeout ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));
  let generation = 0;
  const pending = new Set<TimerId>();

  const cancelTimers = () => {
    for (const id of pending) clear(id);
    pending.clear();
  };

  return {
    start() {
      generation += 1;
      cancelTimers();
      return generation;
    },
    schedule(fn, ms, gen = generation) {
      if (gen !== generation) return; // caller belongs to a superseded run
      const id = set(() => {
        pending.delete(id);
        if (gen === generation) fn();
      }, ms);
      pending.add(id);
    },
    clearAll() {
      generation += 1;
      cancelTimers();
    },
    get generation() {
      return generation;
    },
  };
}
