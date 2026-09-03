// The NEVER-SUBMIT invariant (AGENTS.md #7): no code path may click a
// submit/apply-final control on the user's behalf. This is the guard
// drive.ts's autonomous click loop checks before executing any click.
const SUBMIT_RX = /\b(submit|send application|finish( application)?|complete application|apply (and|&) submit|enviar|finalizar)\b/i;

/** True if any of the given accessible-text sources for a clicked control name
 *  it as a submit/final-apply action. Must be checked against every source
 *  snapshot() uses to LABEL the element for the planner — in the same order,
 *  aria-label, placeholder, textContent (innerText here), value, name — so a
 *  control whose only accessible name comes from any one of those (e.g. an
 *  icon-only `<button aria-label="Submit Application">` or a bare
 *  `<button name="submitApplication">`, both with no visible text) is caught
 *  the same way it was correctly labeled in the snapshot the LLM reasoned
 *  over. A check that only covers a subset of these sources reopens the same
 *  bypass class through whichever source it left out. */
export function isSubmitLabel(...texts: (string | null | undefined)[]): boolean {
  return texts.some((t) => !!t && SUBMIT_RX.test(t));
}
