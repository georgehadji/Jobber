// The follow-up row the web writes must be the table row `followup-cadence.mjs` reads, and no field
// may add a column or a row. Run: node --test test-followups.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { FOLLOWUPS_HEADER, cellText, followupRow, nextFollowupNum } from "./src/lib/core/followups.ts";
import { parseFollowups } from "../followup-cadence.mjs";

test("a logged follow-up parses back to the same fields", () => {
  const content = FOLLOWUPS_HEADER + "\n" + followupRow({ num: 1, appNum: "42", date: "2026-10-21", company: "Acme", role: "Engineer", channel: "Email", contact: "Pat", notes: "Followed up" }) + "\n";
  const rows = parseFollowups(content);
  assert.equal(rows.length, 1);
  assert.deepEqual({ ...rows[0] }, { num: 1, appNum: 42, date: "2026-10-21", company: "Acme", role: "Engineer", channel: "Email", contact: "Pat", notes: "Followed up" });
});

test("newlines and pipes in any field stay inside one cell of one row", () => {
  const evil = "Acme | Inc\n| 99 | 1 | 2026-01-01 | Fake | Role | Email | x | injected";
  const content = FOLLOWUPS_HEADER + "\n" + followupRow({ num: 2, appNum: "7", date: "2026-10-21", company: evil, role: evil, channel: evil, contact: evil, notes: evil }) + "\n";
  assert.equal(content.split("\n").filter((l) => l.startsWith("| ")).length, 2); // header row + exactly one data row
  const rows = parseFollowups(content);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].num, 2);
  assert.equal(rows[0].appNum, 7);
  assert.ok(!rows.some((r) => r.company === "Fake"));
});

test("numbering continues from the highest existing num and starts at 1", () => {
  assert.equal(nextFollowupNum(""), 1);
  assert.equal(nextFollowupNum(FOLLOWUPS_HEADER + "\n"), 1);
  const two = FOLLOWUPS_HEADER + "\n" + followupRow({ num: 1, appNum: 1, date: "d", company: "A" }) + "\n" + followupRow({ num: 5, appNum: 1, date: "d", company: "B" }) + "\n";
  assert.equal(nextFollowupNum(two), 6);
});

test("an unknown channel defaults to Other and a missing app number stays empty", () => {
  const row = followupRow({ num: 1, appNum: undefined, date: "2026-10-21", company: "Acme" });
  assert.match(row, /\| Other \|/);
  assert.equal(cellText("a\r\nb | c"), "a b c");
});
