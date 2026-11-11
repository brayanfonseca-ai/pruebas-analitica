// theme.js — apariencia de DataSense: modo claro / oscuro / sistema, color de acento,
// estilo de fondo y animaciones, más la paleta de comandos (Ctrl + K).
// Script clásico (no módulo) cargado en <head>: aplica la apariencia ANTES de pintar
// (sin parpadeo). Inserta el botón de modo junto a la campana de notificaciones, adapta
// los gráficos de Chart.js al cambiar de tema y añade el brillo que sigue al cursor en
// las tarjetas. Las preferencias son por navegador (localStorage), no datos del servidor.
(function () {
  var root = document.documentElement;
  var K = { theme: "ds.theme", accent: "ds.accent", bg: "ds.bg", motion: "ds.motion" };

  var ACCENTS = [
    { id: "indigo", label: "Índigo", color: "#6366f1", second: "#06b6d4" },
    { id: "oceano", label: "Océano", color: "#0284c7", second: "#14b8a6" },
    { id: "esmeralda", label: "Esmeralda", color: "#059669", second: "#06b6d4" },
    { id: "atardecer", label: "Atardecer", color: "#ea580c", second: "#e11d48" },
    { id: "magenta", label: "Magenta", color: "#c026d3", second: "#6366f1" },
  ];
  var BGS = [
    { id: "grid", label: "Rejilla + aurora" },
    { id: "aurora", label: "Aurora" },
    { id: "plain", label: "Liso" },
  ];

  function read(k, def) { try { return localStorage.getItem(k) || def; } catch (e) { return def; } }
  function write(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* sin storage */ } }
  var mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  var rmq = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;

  function prefs() {
    var t = read(K.theme, "system");
    if (t !== "light" && t !== "dark") t = "system";
    var a = read(K.accent, "indigo");
    if (!ACCENTS.some(function (x) { return x.id === a; })) a = "indigo";
    var b = read(K.bg, "grid");
    if (!BGS.some(function (x) { return x.id === b; })) b = "grid";
    var m = read(K.motion, rmq && rmq.matches ? "off" : "on") === "off" ? "off" : "on";
    return { theme: t, accent: a, bg: b, motion: m };
  }
  function resolve(t) { return t === "system" ? (mq && mq.matches ? "dark" : "light") : t; }
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

  var SUN = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.2" fill="currentColor" fill-opacity=".25"/><path d="M12 2.5v2M12 19.5v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2.5 12h2M19.5 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  var MOON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 14.2A8.5 8.5 0 1 1 9.8 3.5a7 7 0 0 0 10.7 10.7z" fill="currentColor" fill-opacity=".2"/></svg>';

  function syncButton() {
    var b = document.getElementById("dsThemeBtn");
    if (!b) return;
    var dark = current() === "dark";
    b.innerHTML = dark ? SUN : MOON;
    b.title = (dark ? "Cambiar a modo claro" : "Cambiar a modo oscuro") + " · Ctrl+K: comandos";
    b.setAttribute("aria-label", dark ? "Cambiar a modo claro" : "Cambiar a modo oscuro");
    b.setAttribute("aria-pressed", dark ? "true" : "false");
  }

  /** Aplica las preferencias guardadas al <html> y notifica a la página. */
  function applyAll(animate) {
    var p = prefs();
    var mode = resolve(p.theme);
    if (animate) {
      root.classList.add("ds-theme-anim");
      setTimeout(function () { root.classList.remove("ds-theme-anim"); }, 450);
    }
    root.setAttribute("data-theme", mode);
    root.setAttribute("data-theme-pref", p.theme);
    root.setAttribute("data-accent", p.accent);
    root.setAttribute("data-bg", p.bg);
    root.setAttribute("data-motion", p.motion);
    // Menú lateral plegado (lo cambia el botón hamburguesa de js/topbar.js).
    root.setAttribute("data-side", read("ds.side", "open") === "collapsed" ? "collapsed" : "open");
    syncButton();
    themeCharts(mode);
    try { window.dispatchEvent(new CustomEvent("ds-theme", { detail: { theme: mode, prefs: p } })); } catch (e) { /* noop */ }
  }

  function setPref(key, val) {
    if (!K[key]) return;
    write(K[key], val);
    applyAll(true);
  }

  applyAll(false);
  if (mq && mq.addEventListener) mq.addEventListener("change", function () { if (prefs().theme === "system") applyAll(true); });

  function mountButton() {
    if (document.getElementById("dsThemeBtn")) return;
    var bar = document.querySelector(".q-top-actions");
    if (!bar) return;
    var b = document.createElement("button");
    b.type = "button";
    b.id = "dsThemeBtn";
    b.className = "q-top-ico ds-theme-btn";
    b.addEventListener("click", function () { setPref("theme", current() === "dark" ? "light" : "dark"); });
    var bell = bar.querySelector('[data-ds="bell"], [title="Notificaciones"]');
    if (bell) bell.insertAdjacentElement("afterend", b);
    else {
      var av = bar.querySelector(".q-avatar");
      if (av) bar.insertBefore(b, av); else bar.appendChild(b);
    }
    syncButton();
  }

  /* ---------------- Brillo que sigue al cursor en tarjetas ---------------- */
  var SPOT = ".q-home-card, .q-app-card, .q-create-card, .q-coll-card, .ml-card, .mx-fam-card, .rp-card, .ho-obj, .ds-tm-card";
  function wireSpotlight() {
    var raf = 0, last = null;
    document.addEventListener("pointermove", function (e) {
      last = e;
      if (raf) return;
      raf = requestAnimationFrame(function () {
        raf = 0;
        var t = last.target && last.target.closest ? last.target.closest(SPOT) : null;
        if (!t) return;
        var r = t.getBoundingClientRect();
        t.style.setProperty("--mx", (last.clientX - r.left) + "px");
        t.style.setProperty("--my", (last.clientY - r.top) + "px");
      });
    }, { passive: true });
  }

  /* ---------------- Paleta de comandos (Ctrl + K) ---------------- */
  var PAGES = [
    { label: "Inicio", hint: "Página", href: "/pages/inicio.html" },
    { label: "Crear", hint: "Página", href: "/pages/crear.html" },
    { label: "Catálogo de aplicaciones", hint: "Página", href: "/pages/catalogo.html" },
    { label: "Experimentos de ML", hint: "Página", href: "/pages/experimentos.html" },
    { label: "Nuevo experimento de ML", hint: "Crear", href: "/pages/experimentos.html?new=1" },
    { label: "Colecciones", hint: "Página", href: "/pages/hub.html?page=colecciones" },
    { label: "Analizar (todas las apps)", hint: "Página", href: "/pages/hub.html?page=analizar" },
    { label: "Temas · personalizar apariencia", hint: "Página", href: "/pages/hub.html?page=temas" },
    { label: "Configuración · usuarios, permisos y etapas", hint: "Página", href: "/pages/configuracion.html" },
    { label: "Mi cuenta · cambiar contraseña", hint: "Página", href: "/pages/configuracion.html?tab=cuenta" },
  ];
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var norm = function (s) { return String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""); };
  var pal = null, palItems = [], palSel = 0, appsCache = null;

  function staticItems() {
    var p = prefs();
    var list = [];
    list.push({ group: "Acciones", label: current() === "dark" ? "Cambiar a modo claro" : "Cambiar a modo oscuro", hint: "Apariencia", run: function () { setPref("theme", current() === "dark" ? "light" : "dark"); } });
    if (p.theme !== "system") list.push({ group: "Acciones", label: "Seguir el modo del sistema", hint: "Apariencia", run: function () { setPref("theme", "system"); } });
    ACCENTS.forEach(function (a) {
      if (a.id !== p.accent) list.push({ group: "Acciones", label: "Color de acento: " + a.label, hint: "Apariencia", swatch: a.color, run: function () { setPref("accent", a.id); } });
    });
    BGS.forEach(function (b) {
      if (b.id !== p.bg) list.push({ group: "Acciones", label: "Fondo: " + b.label, hint: "Apariencia", run: function () { setPref("bg", b.id); } });
    });
    list.push({ group: "Acciones", label: p.motion === "on" ? "Desactivar animaciones" : "Activar animaciones", hint: "Apariencia", run: function () { setPref("motion", p.motion === "on" ? "off" : "on"); } });
    if (window.DSHelp) list.push({ group: "Acciones", label: "Centro de ayuda · manual y preguntas frecuentes", hint: "Ayuda", run: function () { window.DSHelp.open(); } });
    if (window.DSNotifications) list.push({ group: "Acciones", label: "Ver notificaciones", hint: "Actividad", run: function () { window.DSNotifications.open(); } });
    if (window.DSSide && document.querySelector(".q-side")) list.push({ group: "Acciones", label: window.DSSide.collapsed() ? "Desplegar menú lateral" : "Plegar menú lateral", hint: "Menú", run: function () { window.DSSide.toggle(); } });
    PAGES.forEach(function (g) { list.push({ group: "Ir a", label: g.label, hint: g.hint, href: g.href }); });
    return list;
  }

  function allItems() {
    var apps = (appsCache || []).map(function (a) {
      return { group: "Aplicaciones", label: a.name, hint: "Abrir app", href: "/pages/app.html?app=" + encodeURIComponent(a.id) };
    });
    return apps.concat(staticItems());
  }

  function filterItems(q) {
    var n = norm(q).trim();
    var items = allItems();
    if (!n) return items.slice(0, 40);
    var words = n.split(/\s+/);
    return items
      .map(function (it) {
        var t = norm(it.label + " " + it.hint + " " + it.group);
        if (!words.every(function (w) { return t.indexOf(w) >= 0; })) return null;
        var score = norm(it.label).indexOf(words[0]) === 0 ? 0 : 1;
        return { it: it, score: score };
      })
      .filter(Boolean)
      .sort(function (a, b) { return a.score - b.score; })
      .slice(0, 40)
      .map(function (x) { return x.it; });
  }

  function renderPal() {
    if (!pal) return;
    var q = pal.querySelector(".ds-cmdk-input").value;
    palItems = filterItems(q);
    if (palSel >= palItems.length) palSel = Math.max(0, palItems.length - 1);
    var ul = pal.querySelector(".ds-cmdk-list");
    if (!palItems.length) { ul.innerHTML = '<li class="ds-cmdk-empty">Sin resultados para «' + esc(q) + "»</li>"; return; }
    var html = "", prev = "";
    palItems.forEach(function (it, i) {
      if (it.group !== prev) { html += '<li class="ds-cmdk-group" role="presentation">' + esc(it.group) + "</li>"; prev = it.group; }
      html += '<li class="ds-cmdk-item' + (i === palSel ? " sel" : "") + '" role="option" aria-selected="' + (i === palSel) + '" data-i="' + i + '">' +
        (it.swatch ? '<span class="ds-cmdk-sw" style="background:' + esc(it.swatch) + '"></span>' : '<span class="ds-cmdk-dot"></span>') +
        '<span class="ds-cmdk-lbl">' + esc(it.label) + '</span><span class="ds-cmdk-hint">' + esc(it.hint) + "</span></li>";
    });
    ul.innerHTML = html;
    var sel = ul.querySelector(".sel");
    if (sel && sel.scrollIntoView) sel.scrollIntoView({ block: "nearest" });
  }

  function runItem(it) {
    if (!it) return;
    closePal();
    if (it.href) location.href = it.href; else if (it.run) it.run();
  }

  function openPal() {
    if (pal) return;
    pal = document.createElement("div");
    pal.className = "ds-cmdk-bd";
    pal.innerHTML =
      '<div class="ds-cmdk" role="dialog" aria-modal="true" aria-label="Paleta de comandos">' +
      '<div class="ds-cmdk-top"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>' +
      '<input class="ds-cmdk-input" type="text" placeholder="Busca apps, páginas o acciones…" aria-label="Buscar comando" autocomplete="off" />' +
      '<kbd>Esc</kbd></div><ul class="ds-cmdk-list" role="listbox"></ul>' +
      '<div class="ds-cmdk-foot"><span><kbd>↑</kbd><kbd>↓</kbd> moverse</span><span><kbd>Enter</kbd> abrir</span><span><kbd>Ctrl</kbd><kbd>K</kbd> abrir / cerrar</span></div></div>';
    document.body.appendChild(pal);
    palSel = 0;
    var input = pal.querySelector(".ds-cmdk-input");
    input.addEventListener("input", function () { palSel = 0; renderPal(); });
    input.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown") { e.preventDefault(); palSel = Math.min(palItems.length - 1, palSel + 1); renderPal(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); palSel = Math.max(0, palSel - 1); renderPal(); }
      else if (e.key === "Enter") { e.preventDefault(); runItem(palItems[palSel]); }
      else if (e.key === "Escape") { e.preventDefault(); closePal(); }
    });
    pal.addEventListener("mousedown", function (e) { if (e.target === pal) closePal(); });
    pal.querySelector(".ds-cmdk-list").addEventListener("click", function (e) {
      var li = e.target.closest(".ds-cmdk-item");
      if (li) runItem(palItems[+li.dataset.i]);
    });
    renderPal();
    input.focus();
    if (!appsCache) {
      var tok = ""; try { tok = (JSON.parse(localStorage.getItem("ds.session") || "null") || {}).token || ""; } catch (e) { /* sin sesión */ }
      fetch("/api/v1/apps", { headers: tok ? { Authorization: "Bearer " + tok } : {} }).then(function (r) { return r.ok ? r.json() : []; }).then(function (a) {
        appsCache = Array.isArray(a) ? a : [];
        renderPal();
      }).catch(function () { appsCache = []; });
    }
  }
  function closePal() { if (pal) { pal.remove(); pal = null; } }

  document.addEventListener("keydown", function (e) {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === "k" || e.key === "K")) {
      if (!document.querySelector(".q-topbar")) return; // solo en páginas con barra (no en el login)
      e.preventDefault();
      if (pal) closePal(); else openPal();
    }
  });

  function onReady() {
    mountButton();
    wireSpotlight();
    themeCharts(current());
    // Chart.js puede cargarse después (CDN al final del body).
    if (!window.Chart) window.addEventListener("load", function () { themeCharts(current()); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", onReady); else onReady();

  window.DSTheme = {
    get: current,
    set: function (m) { setPref("theme", m); },
    prefs: prefs,
    setPref: setPref,
    accents: ACCENTS,
    backgrounds: BGS,
    openPalette: openPal,
  };
})();
