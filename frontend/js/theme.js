// theme.js — tema visual de DataSense: claro / oscuro.
// Script clásico (no módulo) cargado en <head> para aplicar el tema ANTES de pintar
// (sin parpadeo). Inserta el botón de modo junto a la campana de notificaciones y
// adapta los gráficos de Chart.js (textos y rejillas) al cambiar de tema.
(function () {
  var KEY = "ds.theme";
  var root = document.documentElement;
  function initial() {
    try { var s = localStorage.getItem(KEY); if (s === "dark" || s === "light") return s; } catch (e) { /* sin storage */ }
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  function current() { return root.getAttribute("data-theme") === "dark" ? "dark" : "light"; }

  var PAL = {
    light: { text: "#475569", grid: "rgba(100,116,139,0.16)" },
    dark: { text: "#a3b1c9", grid: "rgba(148,163,184,0.14)" },
  };

  function themeCharts(mode) {
    var C = window.Chart;
    if (!C) return;
    var p = PAL[mode];
    C.defaults.color = p.text;
    C.defaults.borderColor = p.grid;
    var list = C.instances ? Object.values(C.instances) : [];
    list.forEach(function (ch) {
      try {
        var o = ch.options || {};
        Object.keys(o.scales || {}).forEach(function (k) {
          var s = o.scales[k];
          if (s.ticks) s.ticks.color = p.text;
          if (s.grid) s.grid.color = p.grid;
          if (s.title) s.title.color = p.text;
        });
        if (o.plugins && o.plugins.legend && o.plugins.legend.labels) o.plugins.legend.labels.color = p.text;
        ch.update("none");
      } catch (e) { /* gráfico sin escalas */ }
    });
  }

  var SUN = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  var MOON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 14.2A8.5 8.5 0 1 1 9.8 3.5a7 7 0 0 0 10.7 10.7z"/></svg>';

  function syncButton() {
    var b = document.getElementById("dsThemeBtn");
    if (!b) return;
    var dark = current() === "dark";
    b.innerHTML = dark ? SUN : MOON;
    b.title = dark ? "Cambiar a modo claro" : "Cambiar a modo oscuro";
    b.setAttribute("aria-label", b.title);
    b.setAttribute("aria-pressed", dark ? "true" : "false");
  }

  function apply(mode, save) {
    root.setAttribute("data-theme", mode);
    if (save) { try { localStorage.setItem(KEY, mode); } catch (e) { /* noop */ } }
    syncButton();
    themeCharts(mode);
    try { window.dispatchEvent(new CustomEvent("ds-theme", { detail: { theme: mode } })); } catch (e) { /* noop */ }
  }

  root.setAttribute("data-theme", initial());

  function mountButton() {
    if (document.getElementById("dsThemeBtn")) return;
    var bar = document.querySelector(".q-top-actions");
    if (!bar) return;
    var b = document.createElement("button");
    b.type = "button";
    b.id = "dsThemeBtn";
    b.className = "q-top-ico ds-theme-btn";
    b.addEventListener("click", function () {
      root.classList.add("ds-theme-anim");
      apply(current() === "dark" ? "light" : "dark", true);
      setTimeout(function () { root.classList.remove("ds-theme-anim"); }, 450);
    });
    var bell = bar.querySelector('[title="Notificaciones"]');
    if (bell) bell.insertAdjacentElement("afterend", b);
    else {
      var av = bar.querySelector(".q-avatar");
      if (av) bar.insertBefore(b, av); else bar.appendChild(b);
    }
    syncButton();
  }

  function onReady() {
    mountButton();
    themeCharts(current());
    // Chart.js puede cargarse después (CDN al final del body).
    if (!window.Chart) window.addEventListener("load", function () { themeCharts(current()); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", onReady); else onReady();

  window.DSTheme = { get: current, set: function (m) { apply(m, true); } };
})();
