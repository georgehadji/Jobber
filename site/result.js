(() => {
  "use strict";
  // The token lives in the URL fragment, so it is never sent to a server in a page request.
  const token = location.hash.slice(1);
  const out = document.getElementById("out");

  const el = (tag, text, cls) => {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text; // text only, never HTML
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

  function render(data) {
    const r = data.result;
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
