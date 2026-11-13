(() => {
  "use strict";

  const MAX_BYTES = 5 * 1024 * 1024;
  const EXT = [".pdf", ".md", ".txt"];
  const TASKS = {
    score: { label: "Check my fit", needsJob: true },
    gap: { label: "Check the skill gap", needsJob: true },
    pdf: { label: "Create my tailored CV", needsJob: true },
    scan: { label: "Find open roles", needsJob: false }
  };
  const FILE_MSG = "That file type is not supported. Use a PDF, Markdown or plain text file.";
  const MIN_JOB_CHARS = 80;
  const TIMEOUT_MS = 120000;

  const SAMPLE_JOB = [
    "Operations Analyst (sample posting, invented for this demo)",
    "",
    "Northfield Logistics is looking for an Operations Analyst to join our planning team. You will build weekly reports on delivery performance, find the causes of delays, and help the team decide where to add capacity.",
    "",
    "Requirements: 2+ years in an analyst role, strong SQL, experience building dashboards in Tableau, clear written communication. Nice to have: experience in logistics or retail.",
    "",
    "Salary: 38,000 to 44,000 per year. Hybrid, two days in the Leeds office."
  ].join("\n");

  const $ = (id) => document.getElementById(id);
  const form = $("start");
  if (!form) return;

  const api = document.querySelector('meta[name="jobber-api"]')?.content || form.action;
  const drop = $("drop");
  const cvInput = $("cv");
  const promptEl = drop.querySelector(".drop-prompt");
  const fileEl = drop.querySelector(".drop-file");
  const removeBtn = $("cv-remove");
  const cvError = $("cv-error");
  const job = $("job");
  const jobError = $("job-error");
  const submit = $("submit");
  const status = $("status");

  let file = null;
  let busy = false;

  const fmtSize = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB");

  function checkFile(f) {
    const name = f.name.toLowerCase();
    if (!EXT.some((e) => name.endsWith(e))) return FILE_MSG;
    if (f.size === 0) return "That file is empty.";
    if (f.size > MAX_BYTES) return "That file is " + fmtSize(f.size) + ". The limit is 5 MB.";
    return "";
  }

  function setFile(f) {
    const problem = f ? checkFile(f) : "";
    cvError.textContent = problem;
    if (problem) {
      file = null;
      cvInput.value = "";
      drop.dataset.state = "invalid";
    } else {
      file = f || null;
      drop.dataset.state = file ? "filled" : "empty";
    }
    promptEl.hidden = !!file;
    fileEl.hidden = !file;
    removeBtn.hidden = !file;
    fileEl.textContent = file ? file.name + " (" + fmtSize(file.size) + ")" : "";
    refresh();
  }

  const jobField = $("job-field");
  const taskInputs = form.querySelectorAll('input[name="task"]');
  const currentTask = () => (form.querySelector('input[name="task"]:checked') || {}).value || "score";

  function refresh() {
    submit.disabled = busy;
  }

  const subject = () => (TASKS[currentTask()].needsJob ? "your CV and the job" : "your CV");
  const kept = () => (TASKS[currentTask()].needsJob ? "Your CV and the job are still here" : "Your CV is still here");

  function applyTask() {
    const t = TASKS[currentTask()];
    jobField.hidden = !t.needsJob;
    submit.textContent = t.label;
    jobError.textContent = "";
    job.removeAttribute("aria-invalid");
  }

  function pickTask(name) {
    const r = form.querySelector('input[name="task"][value="' + name + '"]');
    if (!r) return;
    r.checked = true;
    applyTask();
    say("Selected: " + TASKS[name].label + ".");
    r.focus({ preventScroll: true });
  }

  taskInputs.forEach((r) => r.addEventListener("change", applyTask));
  document.querySelectorAll("[data-task]").forEach((a) =>
    a.addEventListener("click", (e) => {
      e.preventDefault();
      form.scrollIntoView({ block: "start" });
      pickTask(a.dataset.task);
    }));

  function say(text, kind) {
    status.textContent = text;
    if (kind) status.dataset.kind = kind; else delete status.dataset.kind;
  }

  cvInput.addEventListener("change", () => setFile(cvInput.files[0] || null));

  ["dragenter", "dragover"].forEach((t) =>
    drop.addEventListener(t, (e) => { e.preventDefault(); drop.dataset.over = "true"; }));
  ["dragleave", "drop"].forEach((t) =>
    drop.addEventListener(t, (e) => { e.preventDefault(); delete drop.dataset.over; }));
  drop.addEventListener("drop", (e) => {
    const f = e.dataTransfer && e.dataTransfer.files[0];
    if (!f) return;
    try {
      const dt = new DataTransfer();
      dt.items.add(f);
      cvInput.files = dt.files;
    } catch (_) { /* older browsers: keep the file in memory only */ }
    setFile(f);
  });

  removeBtn.addEventListener("click", () => {
    cvInput.value = "";
    setFile(null);
    cvInput.focus();
  });

  job.addEventListener("input", () => {
    if (jobError.textContent) { jobError.textContent = ""; job.removeAttribute("aria-invalid"); }
    refresh();
  });

  $("sample").addEventListener("click", () => {
    job.value = SAMPLE_JOB;
    job.dispatchEvent(new Event("input"));
    job.focus();
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (busy) return;

    if (!file) { cvError.textContent = "Choose your CV first."; drop.dataset.state = "invalid"; cvInput.focus(); return; }
    if (TASKS[currentTask()].needsJob && job.value.trim().length < MIN_JOB_CHARS) {
      jobError.textContent = "Paste the full job description. It looks too short to use.";
      job.setAttribute("aria-invalid", "true");
      job.focus();
      return;
    }

    busy = true;
    form.setAttribute("aria-busy", "true");
    submit.disabled = true;
    submit.textContent = "Working…";
    say("Reading " + subject() + ". This can take up to a minute.");

    const body = new FormData();
    body.append("cv", file, file.name);
    body.append("task", currentTask());
    if (TASKS[currentTask()].needsJob) body.append("job", job.value.trim());

    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);

    try {
      const res = await fetch(api, { method: "POST", body, signal: ctl.signal });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data && typeof data.resultUrl === "string" && data.resultUrl.startsWith("/")) {
          say("Done. Opening your result.");
          location.assign(data.resultUrl);
          return;
        }
        say("Something went wrong on our side. " + kept() + ", so you can try again.", "error");
      } else if (res.status === 429) {
        say("You have used today’s free checks. Come back tomorrow, or run Jobber on your own machine. Your inputs are kept on this page.", "error");
      } else if (res.status === 413) {
        say("That file is too large. The limit is 5 MB.", "error");
      } else if (res.status === 415) {
        say(FILE_MSG, "error");
      } else {
        // 400, 422 and 503 carry a plain-language reason from the server; show it.
        const data = await res.json().catch(() => ({}));
        const reason = [400, 422, 503].includes(res.status) && typeof data.error === "string" ? data.error + " " : "Something went wrong on our side. ";
        say(reason + kept() + ", so you can try again.", "error");
      }
    } catch (err) {
      say(err && err.name === "AbortError"
        ? "This is taking too long. " + kept() + ", so you can try again."
        : "Could not reach the Jobber service. Check your connection and try again. " + kept() + ".", "error");
    } finally {
      clearTimeout(timer);
      busy = false;
      form.removeAttribute("aria-busy");
      submit.textContent = TASKS[currentTask()].label;
      refresh();
    }
  });

  // copy command
  const copy = $("copy");
  const copyStatus = $("copy-status");
  if (copy) {
    copy.addEventListener("click", async () => {
      const target = document.querySelector(copy.dataset.copy);
      if (!target) return;
      try {
        await navigator.clipboard.writeText(target.textContent.trim());
        copyStatus.textContent = "Copied to the clipboard.";
      } catch (_) {
        const r = document.createRange();
        r.selectNodeContents(target);
        const s = getSelection();
        s.removeAllRanges();
        s.addRange(r);
        copyStatus.textContent = "Press Ctrl+C or Cmd+C to copy.";
      }
    });
  }

  applyTask();
  refresh();
})();
