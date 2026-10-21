// Click policy of the apply driver (AGENTS.md "never submit"): structural
// submit detection, multilingual labels, unlabeled controls, ref validation,
// and keystroke-safe text. Run: node --test test-click-policy.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { refuseClick, isValidRef, keystrokeSafe, isSubmitLabel } from "./src/lib/apply/submit-guard.ts";

const ctl = (over) => ({ submitLike: false, isLink: false, texts: ["Continue"], ...over });

test("control: an ordinary Next/Continue/Upload control is allowed", () => {
  assert.equal(refuseClick(ctl({ texts: ["Continue"] })), null);
  assert.equal(refuseClick(ctl({ texts: ["Next"] })), null);
  assert.equal(refuseClick(ctl({ texts: ["Upload résumé"] })), null);
});

test("a structural submit control is refused whatever its label says", () => {
  assert.match(refuseClick(ctl({ submitLike: true, texts: ["Go"] })) ?? "", /submit control/);
  assert.match(refuseClick(ctl({ submitLike: true, texts: [] })) ?? "", /submit control/); // empty label + submit
  assert.match(refuseClick(ctl({ submitLike: true, texts: ["Weiter"] })) ?? "", /submit control/);
});

test("the reach goal may still click a bare Apply link or button", () => {
  assert.equal(refuseClick(ctl({ isLink: true, texts: ["Apply"] })), null);
  assert.equal(refuseClick(ctl({ texts: ["Apply now"] })), null);
  assert.equal(refuseClick(ctl({ texts: ["Postuler"] })), null);
});

test("localized and extra submit verbs are refused, reporting the label reason", () => {
  for (const label of [
    "Send", "Confirm", "Done", "Absenden", "Bewerbung absenden", "Envoyer", "Soumettre", "Invia", "Enviar solicitud",
    "Отправить", "送信", "Submit Application", "Verzenden",
  ]) {
    assert.match(refuseClick(ctl({ texts: [label] })) ?? "", /submit-labelled/, label);
  }
});

test("label matching respects word edges, in Latin and non-Latin text", () => {
  assert.equal(isSubmitLabel("Resubmitted drafts"), false);
  assert.equal(isSubmitLabel("Sendai office"), false);
  assert.equal(isSubmitLabel("Отправитель"), false);
  assert.equal(isSubmitLabel("Please Submit."), true);
});

test("any accessible-name source can carry the verb (title, alt, aria-labelledby text)", () => {
  assert.match(refuseClick(ctl({ texts: ["", null, undefined, "", "", "Submit application", "", ""] })) ?? "", /submit-labelled/);
  assert.match(refuseClick(ctl({ texts: ["x", "", "", "", "", "", "Send", ""] })) ?? "", /submit-labelled/);
});

test("a non-link control with no accessible name at all is refused; an unlabelled link is not", () => {
  assert.match(refuseClick(ctl({ texts: ["", "  ", null] })) ?? "", /unlabelled/);
  assert.equal(refuseClick(ctl({ isLink: true, texts: ["", null] })), null);
});

test("refs must be minted ids; selector-breaking refs are rejected", () => {
  assert.equal(isValidRef("e0"), true);
  assert.equal(isValidRef("e69"), true);
  for (const bad of ['x"],button', "e1 ", "e", "E1", "e1; foo", "", undefined, null, 5]) assert.equal(isValidRef(bad), false, String(bad));
});

test("keystroke text never carries a line break; ordinary text is untouched", () => {
  assert.equal(keystrokeSafe("Dear team\nI am applying\r\nthanks"), "Dear team I am applying thanks");
  assert.equal(keystrokeSafe("plain answer"), "plain answer");
  assert.equal(/[\r\n]/.test(keystrokeSafe("a\n\n\nb")), false);
});
