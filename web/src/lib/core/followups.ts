// Row format of data/follow-ups.md, the table `followup-cadence.mjs` parses
// (num | appNum | date | company | role | channel | contact | notes). The web used to append
// free-form bullets the CLI never read, so a follow-up logged in the UI never advanced the cadence.

export const FOLLOWUPS_HEADER = [
  "# Follow-ups",
  "",
  "| num | appNum | date | company | role | channel | contact | notes |",
  "|---|---|---|---|---|---|---|---|",
].join("\n");

/** One table cell: no line breaks and no pipe, so a value can never add a column or a row. */
export function cellText(v: unknown): string {
  return String(v ?? "").replace(/[\r\n|]+/g, " ").replace(/\s+/g, " ").trim();
}

/** Next sequential `num` in an existing follow-ups file (1 when there are no rows). */
export function nextFollowupNum(content: string): number {
  let max = 0;
  for (const line of content.split("\n")) {
    if (!line.startsWith("|")) continue;
    const n = parseInt(line.split("|")[1] ?? "", 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max + 1;
}

export function followupRow(f: { num: number; appNum: unknown; date: string; company: unknown; role?: unknown; channel?: unknown; contact?: unknown; notes?: unknown }): string {
  const appNum = parseInt(String(f.appNum ?? ""), 10);
  const cells = [
    f.num,
    Number.isFinite(appNum) ? appNum : "",
    f.date,
    cellText(f.company),
    cellText(f.role),
    cellText(f.channel) || "Other",
    cellText(f.contact),
    cellText(f.notes),
  ];
  return `| ${cells.join(" | ")} |`;
}
