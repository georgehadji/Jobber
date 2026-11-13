// Light is the default. Dark only when the visitor chose it (remembered in this browser).
(() => {
  "use strict";
  const KEY = "jobber-theme";
  const root = document.documentElement;
  const read = () => { try { return localStorage.getItem(KEY); } catch (_) { return null; } };
  const save = (v) => { try { localStorage.setItem(KEY, v); } catch (_) { /* storage blocked: choice lasts this page only */ } };

  const apply = (theme) => {
    if (theme === "dark") root.setAttribute("data-theme", "dark"); else root.removeAttribute("data-theme");
  };
  apply(read());

  document.addEventListener("DOMContentLoaded", () => {
    const btn = document.getElementById("theme");
    if (!btn) return;
    const label = () => { btn.textContent = root.getAttribute("data-theme") === "dark" ? "Light mode" : "Dark mode"; };
    label();
    btn.addEventListener("click", () => {
      const next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
      apply(next);
      save(next);
      label();
    });
  });
})();
