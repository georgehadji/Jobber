// The NEVER-SUBMIT invariant (AGENTS.md #7): no code path may click a
// submit/apply-final control on the user's behalf. This is the guard
// drive.ts's autonomous click loop checks before executing any click.
const SUBMIT_RX = /\b(submit|send application|finish( application)?|complete application|apply (and|&) submit|enviar|finalizar)\b/i;

/** True if any of the given accessible-text sources for a clicked control name
 *  it as a submit/final-apply action. Must be checked against every source
 *  snapshot() uses to LABEL the element for the planner (innerText, aria-label,
 *  the value attribute) — an icon-only submit button with no innerText, whose
 *  only accessible name is `aria-label="Submit Application"`, was correctly
 *  labeled in the snapshot the LLM reasoned over, but a check that only looked
 *  at innerText/value would let the click through unblocked. */
export function isSubmitLabel(...texts: (string | null | undefined)[]): boolean {
  return texts.some((t) => !!t && SUBMIT_RX.test(t));
}
