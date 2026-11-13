(() => {
  "use strict";
  // The token lives in the URL fragment, so it is never sent to a server in a page request.
  const token = location.hash.slice(1);
  const out = document.getElementById("out");

  // Everything is built with textContent and DOM nodes, never innerHTML:
  // results contain text from the visitor's CV, the job, or a model reply.
  const el = (tag, text, cls) => {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  };

  function show(...nodes) { out.replaceChildren(...nodes); }

  function gone(message) {
    show(
      el("h1", "This result is not available", "section-title"),
      el("p", message || "It has expired or was deleted. Results are kept for 30 minutes."),
      Object.assign(el("a", "Start again", "link"), { href: "./#start" })
    );
  }

  // ---- Minimal safe Markdown: headings, lists, tables, **bold**, `code`. No links, no HTML. ----
  function inline(text) {
    const frag = document.createDocumentFragment();
    text.split(/(\*\*[^*]+\*\*|`[^`]+`)/).forEach((p) => {
      if (!p) return;
      if (p.length > 4 && p.startsWith("**") && p.endsWith("**")) frag.append(el("strong", p.slice(2, -2)));
      else if (p.length > 2 && p.startsWith("`") && p.endsWith("`")) frag.append(el("code", p.slice(1, -1)));
      else frag.append(p);
    });
    return frag;
  }
  const cells = (line) => line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
  const isRule = (l) => /^\s*([-*_])\1{2,}\s*$/.test(l);
  const isTableStart = (ls, i) => /^\s*\|/.test(ls[i]) && i + 1 < ls.length && /^\s*\|?\s*:?-{2,}/.test(ls[i + 1]);
  const LIST = /^\s*([-*•]|\d+[.)])\s+(.*)$/;

  function markdown(src) {
    const root = el("div", undefined, "report");
    const ls = src.replace(/\r\n?/g, "\n").split("\n");
    let i = 0;
    while (i < ls.length) {
      const line = ls[i];
      if (!line.trim()) { i++; continue; }
      const h = /^(#{1,4})\s+(.*)$/.exec(line);
      if (h) { const n = h[1].length === 1 ? "h2" : h[1].length === 2 ? "h3" : "h4"; const e = el(n, undefined, "report-h"); e.append(inline(h[2])); root.append(e); i++; continue; }
      if (isRule(line)) { root.append(el("hr")); i++; continue; }
      if (isTableStart(ls, i)) {
        const table = el("table", undefined, "report-table");
        const head = el("tr");
        cells(ls[i]).forEach((c) => { const th = el("th"); th.append(inline(c)); head.append(th); });
        table.append(el("thead")); table.firstChild.append(head);
        const body = el("tbody");
        i += 2;
        while (i < ls.length && /^\s*\|/.test(ls[i])) {
          const tr = el("tr");
          cells(ls[i]).forEach((c) => { const td = el("td"); td.append(inline(c)); tr.append(td); });
          body.append(tr); i++;
        }
        table.append(body);
        const wrap = el("div", undefined, "table-wrap"); wrap.append(table); root.append(wrap);
        continue;
      }
      const li = LIST.exec(line);
      if (li) {
        const ordered = /^\s*\d/.test(line);
        const list = el(ordered ? "ol" : "ul");
        while (i < ls.length && LIST.test(ls[i]) && /^\s*\d/.test(ls[i]) === ordered) { const item = el("li"); item.append(inline(LIST.exec(ls[i])[2])); list.append(item); i++; }
        root.append(list);
        continue;
      }
      const para = [];
      while (i < ls.length && ls[i].trim() && !isRule(ls[i]) && !/^#{1,4}\s/.test(ls[i]) && !LIST.test(ls[i]) && !isTableStart(ls, i)) { para.push(ls[i].trim()); i++; }
      const p = el("p"); p.append(inline(para.join(" "))); root.append(p);
    }
    return root;
  }

  function list(title, hint, items) {
    const box = el("div");
    box.append(el("h2", title + " (" + items.length + ")", "result-h"), el("p", hint, "hint"));
    if (items.length) {
      const ul = el("ul", undefined, "chips");
      items.forEach((s) => ul.append(el("li", s)));
      box.append(ul);
    }
    return box;
  }

  function renderGap(r) {
    const nodes = [el("h1", "Skill gap check", "section-title")];
    if (r.jobSkillCount === 0) {
      nodes.push(
        el("p", "We could not find a list of required skills in the job text you pasted, so there is nothing to compare. This is not the same as having no gaps."),
        el("p", "Paste the requirements section as a bulleted list, then try again.")
      );
    } else {
      nodes.push(
        el("p", "The job asks for " + r.jobSkillCount + " skills we could pick out. This is keyword matching with no AI, so it can miss a skill or misread a word."),
        list("Listed in your CV’s skills", "Your CV names these as skills.", r.existing),
        list("Mentioned elsewhere in your CV", "These appear in your CV, but not in a skills list.", r.supportedByResume),
        list("Not found in your CV", "Add one only if it is true. Do not claim a skill you do not have.", r.gap)
      );
    }
    return nodes;
  }

  function renderScore(r) {
    const known = (v) => v && v.toLowerCase() !== "unknown";
    const title = [known(r.role) ? r.role : "", known(r.company) ? r.company : ""].filter(Boolean).join(", ") || "Your job";
    const head = el("div", undefined, "score-head");
    head.append(el("h1", title, "section-title"));
    const scoreLine = el("p", undefined, "doc-score");
    if (r.score === null) scoreLine.append(el("span", "No score could be read from the reply. Read the report below.", "hint"));
    else { scoreLine.append(el("span", r.score.toFixed(1), "score"), el("span", " out of 5", "score-of")); }
    head.append(scoreLine);
    const nodes = [head];
    if (r.score !== null && r.score < 4) {
      nodes.push(el("p", "Below 4.0. Jobber advises against applying unless you have a specific reason to.", "doc-verdict"));
    }
    if (known(r.legitimacy)) {
      nodes.push(el("p", "Posting check: " + r.legitimacy + ". This check is separate and never changes the score.", "hint"));
    }
    nodes.push(
      el("p", "This report was written by an AI model from your CV and the pasted text only. It can be wrong, and pay figures are estimates. You decide.", "hint"),
      markdown(r.report || "")
    );
    return nodes;
  }

  // The PDF arrives as base64 in the result. It becomes a Blob, so it never touches a URL or a server again.
  function renderPdf(r) {
    const nodes = [el("h1", "Your tailored CV", "section-title")];
    const bytes = Uint8Array.from(atob(r.pdf), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
    const dl = el("a", "Download the PDF", "btn btn-primary");
    dl.href = url; dl.download = r.filename || "tailored-cv.pdf";
    nodes.push(
      el("p", "Read every line before you send it. An AI model reworded your CV for this job. We removed anything we could check that your CV does not support, but we cannot check the wording of each bullet.", "doc-verdict"),
      dl,
      el("p", r.pages + (r.pages === 1 ? " page." : " pages.") + (r.pages > 2 ? " Most recruiters prefer two pages or fewer." : ""), "hint")
    );
    if (r.removed.length) nodes.push(list("Removed because your CV does not support it", "These were in the model’s draft and are not in your PDF.", r.removed));
    if (r.atsFindings.length) nodes.push(list("Reading check", "An applicant tracking system may have trouble reading this PDF.", r.atsFindings));
    return nodes;
  }

  function render(data) {
    const r = data.result;
    const nodes = r.task === "score" ? renderScore(r) : r.task === "pdf" ? renderPdf(r) : renderGap(r);

    const minutes = Math.max(1, Math.round((data.expiresAt - Date.now()) / 60000));
    const del = el("button", "Delete this result now", "btn btn-quiet");
    del.type = "button";
    del.addEventListener("click", async () => {
      del.disabled = true;
      try { await fetch("/api/result/" + token, { method: "DELETE" }); } catch (_) { /* fall through */ }
      gone("Your result was deleted.");
    });
    nodes.push(
      el("p", "This page is kept for about " + minutes + " more minutes, then deleted. Anyone with this link can read it until then, so do not share it.", "hint"),
      del
    );
    show(...nodes);
  }

  if (!/^[A-Za-z0-9_-]{32}$/.test(token)) { gone(); return; }
  fetch("/api/result/" + token, { cache: "no-store" })
    .then((res) => (res.ok ? res.json() : Promise.reject(res)))
    .then(render)
    .catch(() => gone());
})();
