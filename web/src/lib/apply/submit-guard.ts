// The NEVER-SUBMIT invariant (AGENTS.md #7): no code path may click a
// submit/apply-final control on the user's behalf. This is the guard
// drive.ts's autonomous click loop checks before executing any click.
//
// Defence in depth, in order of how hard each is to evade:
//   1. STRUCTURE — a control that would submit a form (type=submit/image, or a
//      <button> with no type inside a <form>) is refused whatever its label says.
//   2. LABEL — a multilingual verb list across every accessible-name source.
//   3. UNKNOWN — a non-link control with no accessible name at all is refused.
// A determined rewrite of the page can still evade any static list; the human
// reviewing before submitting is the real invariant.
//
// Bare "Apply" / "Postuler" / "Candidati" are deliberately NOT in the verb
// list: the reach goal must click them to open the form. The final submit of
// that form is a structural submit control and is caught by (1).
const VERBS = [
  "submit", "send", "send application", "finish", "finish application", "complete application", "confirm", "done",
  "apply (?:and|&) submit", "submit application",
  "enviar", "finalizar", "confirmar",
  "absenden", "abschicken", "bewerbung absenden", "senden", "bestätigen",
  "envoyer", "soumettre", "valider", "confirmer",
  "invia", "inviare", "conferma",
  "verzenden", "versturen", "indienen",
  "wyślij", "gönder",
  "отправить", "подтвердить",
  "送信", "提交", "確認", "제출", "送出",
].map((v) => v.replace(/ /g, "\\s+"));
const SUBMIT_RX = new RegExp(`(?<![\\p{L}\\p{N}])(?:${VERBS.join("|")})(?![\\p{L}\\p{N}])`, "iu");

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

export type ClickDescriptor = {
  /** Would clicking submit a form (type=submit/image, or untyped <button> in a form). */
  submitLike: boolean;
  /** The control is an <a>: navigation, not a form action. */
  isLink: boolean;
  /** Every accessible-name source: text, aria-label, aria-labelledby, title, alt, placeholder, value, name. */
  texts: (string | null | undefined)[];
};

/** Why a click must be refused, or null when it may proceed. */
export function refuseClick(d: ClickDescriptor): string | null {
  if (d.submitLike) return "submit control (the human submits)";
  if (isSubmitLabel(...d.texts)) return "submit-labelled control (the human submits)";
  if (!d.isLink && d.texts.every((t) => !t || !t.trim())) return "unlabelled control (unknown purpose)";
  return null;
}

/** Element refs are minted by snapshot() as `e<N>`; anything else would be
 *  interpolated into a selector. */
export function isValidRef(ref: unknown): ref is string {
  return typeof ref === "string" && /^e\d{1,4}$/.test(ref);
}

/** Text typed through the keyboard must never carry a line break: Enter in a
 *  form field can submit it. (`locator.fill` never presses keys and may keep newlines.) */
export function keystrokeSafe(text: string): string {
  return String(text ?? "").replace(/[\r\n]+/g, " ");
}
