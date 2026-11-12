"use client";

import { createContext, useContext } from "react";
import type { StateMachineView } from "@/lib/core/state-model";

// The root layout reads templates/states.yml once (lib/core/states.ts) and hands the machine to
// every client component here, so none of them keeps its own copy of the state list.
const Ctx = createContext<StateMachineView | null>(null);

export function MachineProvider({ machine, children }: { machine: StateMachineView; children: React.ReactNode }) {
  return <Ctx.Provider value={machine}>{children}</Ctx.Provider>;
}

export function useMachine(): StateMachineView {
  const m = useContext(Ctx);
  if (!m) throw new Error("useMachine() needs <MachineProvider> (see app/layout.tsx)");
  return m;
}
