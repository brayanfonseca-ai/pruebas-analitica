// app-informes.js — vista "Informes" (grupo Narrar) de DataSense.
//
// NO es un asesor que "aconseja": es un GENERADOR DE INFORMES PDF real y guiado.
// El usuario elige una PLANTILLA BASE (tarjeta con preview), y el módulo:
//   1) ejecuta queries reales contra el motor (datos verdaderos),
//   2) renderiza gráficas con Chart.js en canvas,
//   3) redacta explicaciones con el agente (texto narrativo dentro del PDF),
//   4) compone un PDF técnico (portada, KPIs, gráficas grandes, tablas, análisis)
//      con jsPDF + autotable y lo descarga.
// Pensado para que alguien sin conocimiento solo elija plantilla y obtenga un PDF.
//
// Dependencias globales (CDN en app.html): window.Chart, window.jspdf, autotable.
// Aditivo; datos reales vía js/api.js. Paleta de marca azul #172983.

import * as api from "./api.js";
import { PALETTE } from "./chart-types.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const NF = new Intl.NumberFormat("es-CO");
const isNumericType = (t) => /num|int|float|double|decimal|money|number/i.test(String(t || ""));
const BRAND = [23, 41, 131];       // #172983
const BRAND_DARK = [16, 29, 94];   // #101d5e
const INK = [27, 31, 36];
const MUTED = [107, 114, 128];
// Colores de ESTADO para informe nivel consultoría (semáforo).
const OK = [22, 135, 84];      // verde — bien
const WARN = [201, 138, 20];   // ámbar — atención
const BAD = [192, 57, 43];     // rojo — riesgo
const MUTED2 = [120, 126, 140];
const SOFT = [244, 246, 251];  // relleno suave de tarjetas

/* ---------------- Plantillas base ---------------- */
// Cada plantilla define qué secciones (gráficas/tablas) incluye. Los campos
// (dimensión/medida) se resuelven contra los datos reales al generar.
const TEMPLATES = [
  {
    id: "exec", name: "Resumen Ejecutivo", icon: "★",
    desc: "KPIs principales, ventas por dimensión clave y una gráfica de tendencia. Ideal para dirección.",
    sections: ["cover", "kpis", "bar_primary", "pie_primary", "trend", "analysis"],
  },
  {
    id: "region", name: "Análisis por Región/Geografía", icon: "◱",
    desc: "Desglose completo por la primera dimensión: gráfica, tabla detallada y análisis.",
    sections: ["cover", "kpis", "bar_primary", "table_primary", "analysis"],
  },
  {
    id: "categoria", name: "Análisis por Categoría", icon: "◐",
    desc: "Participación y ranking por la segunda dimensión, con tabla y explicación.",
    sections: ["cover", "kpis", "pie_secondary", "bar_secondary", "table_secondary", "analysis"],
  },
  {
    id: "tendencia", name: "Tendencias en el Tiempo", icon: "📈",
    desc: "Evolución temporal de las medidas, con gráfica de línea y lectura del comportamiento.",
    sections: ["cover", "kpis", "trend", "trend_table", "analysis"],
  },
  {
    id: "full", name: "Informe Completo", icon: "▦",
    desc: "Todo: KPIs, todas las dimensiones (barras + tarta), tendencia, tablas y análisis extenso.",
    sections: ["cover", "kpis", "bar_primary", "pie_primary", "bar_secondary", "trend", "table_primary", "table_secondary", "analysis"],
  },
];

/* ====================================================================== */
export async function render(mount, ctx) {
  const appId = ctx.appId;
  let fields = { dimensions: [], measures: [] };
  let appName = ctx.app?.name || "Aplicación";

  try { fields = await api.getFields(appId); } catch { fields = { dimensions: [], measures: [] }; }

  const dims = fields.dimensions || [];
  const meas = fields.measures || [];
  const ready = dims.length > 0 && meas.length > 0;

  let sheets = [];
  try { sheets = await api.listSheets(appId); } catch { sheets = []; }

  mount.innerHTML = `
    <div class="q-subtoolbar">
      <div class="rp-head">
        <div>
          <h2 class="rp-title">Generador de informes</h2>
          <p class="rp-muted">Informes PDF de <strong>${esc(appName)}</strong> con tus datos reales. Elige un modo.</p>
        </div>
      </div>
      <div class="rp-modes">
        <button class="rp-mode active" data-mode="plantillas">Plantillas</button>
        <button class="rp-mode" data-mode="hojas">Desde una hoja</button>
        <button class="rp-mode" data-mode="chat">Asistente (conversacional)</button>
      </div>
    </div>
    <div class="rp-wrap">
      ${!ready ? `<div class="rp-empty"><p>Esta aplicación aún no tiene datos cargados.</p>
        <p class="rp-muted">Carga un archivo en el Editor de carga para poder generar informes.</p></div>`
      : `<div id="rpPane"></div>`}
    </div>
    <div class="rp-progress-backdrop" id="rpProg" hidden>
      <div class="rp-progress">
        <div class="rp-progress-head"><span class="rp-progress-spin"></span><strong id="rpProgTitle">Generando informe…</strong></div>
        <div class="rp-progress-steps" id="rpProgSteps"></div>
      </div>
    </div>
    <div id="rpCanvasHost" style="position:fixed;left:-99999px;top:0;width:900px;"></div>`;

  if (!ready) return () => {};

  const pane = mount.querySelector("#rpPane");
  mount.querySelectorAll(".rp-mode").forEach((b) =>
    b.addEventListener("click", () => {
      mount.querySelectorAll(".rp-mode").forEach((x) => x.classList.toggle("active", x === b));
      renderMode(b.dataset.mode);
    }));

  function renderMode(mode) {
    if (mode === "hojas") return renderHojas();
    if (mode === "chat") return renderChat();
    return renderPlantillas();
  }

  /* ---------- MODO 1: Plantillas ---------- */
  function renderPlantillas() {
    pane.innerHTML = `<div class="rp-gallery">${TEMPLATES.map((t) => `
      <article class="rp-card" data-tpl="${t.id}">
        <div class="rp-card-preview">${previewSvg(t.id)}</div>
        <div class="rp-card-ico">${t.icon}</div>
        <h3 class="rp-card-title">${esc(t.name)}</h3>
        <p class="rp-card-desc">${esc(t.desc)}</p>
        <button class="q-btn primary rp-card-btn" data-tpl="${t.id}">Generar PDF</button>
      </article>`).join("")}</div>`;
    pane.querySelectorAll(".rp-card-btn").forEach((b) =>
      b.addEventListener("click", () => generate(TEMPLATES.find((t) => t.id === b.dataset.tpl))));
  }

  /* ---------- MODO 2: Desde una hoja (replica la hoja real de ESTA app) ---------- */
  function renderHojas() {
    if (!sheets.length) {
      pane.innerHTML = `<div class="rp-empty"><p>Esta aplicación aún no tiene hojas.</p>
        <p class="rp-muted">Crea una hoja/dashboard para generar su informe.</p></div>`;
      return;
    }
    pane.innerHTML = `<div class="rp-gallery">${sheets.map((s) => {
      const n = (s.objects || []).length;
      return `<article class="rp-card" data-sheet="${esc(s.id)}">
        <div class="rp-card-preview">${previewSvg("full")}</div>
        <div class="rp-card-ico">▦</div>
        <h3 class="rp-card-title">${esc(s.title || "Hoja")}</h3>
        <p class="rp-card-desc">${n} objeto(s): KPIs y gráficos de esta hoja. El PDF replica su contenido con datos reales.</p>
        <button class="q-btn primary rp-card-btn" data-sheet="${esc(s.id)}">Generar PDF de la hoja</button>
      </article>`;
    }).join("")}</div>`;
    pane.querySelectorAll(".rp-card-btn").forEach((b) =>
      b.addEventListener("click", () => generateFromSheet(sheets.find((s) => s.id === b.dataset.sheet))));
  }

  /* ---------- MODO 3: Conversacional con preview en vivo ---------- */
  function renderChat() {
    const saved = loadChatTpls();
    pane.innerHTML = `
      <div class="rp-chat">
        <div class="rp-chat-left">
          <div class="rp-chat-log" id="rpChatLog">
            <div class="rp-chat-msg bot">Hola. Dime qué informe quieres y lo armo. Ej: <em>"ventas por región y una tabla por categoría"</em>. Verás la vista previa a la derecha y podrás ajustarla.</div>
          </div>
          <div class="rp-chat-input">
            <textarea id="rpChatText" rows="2" placeholder="Describe tu informe…"></textarea>
            <button class="q-btn primary" id="rpChatSend">Enviar</button>
          </div>
          ${saved.length ? `<div class="rp-chat-saved"><span class="rp-muted">Plantillas guardadas:</span>
            ${saved.map((t, i) => `<button class="rp-chip" data-saved="${i}">${esc(t.name)}</button>`).join("")}</div>` : ""}
        </div>
        <div class="rp-chat-right">
          <div class="rp-prev-head">
            <strong>Vista previa</strong>
            <span>
              <button class="q-btn" id="rpSaveTpl" disabled>Guardar plantilla</button>
              <button class="q-btn primary" id="rpChatPdf" disabled>Descargar PDF</button>
            </span>
          </div>
          <div class="rp-preview" id="rpPreview"><p class="rp-muted" style="padding:24px;text-align:center;">La vista previa aparecerá aquí.</p></div>
        </div>
      </div>`;

    let currentSpec = null;
    const log = pane.querySelector("#rpChatLog");
    const addMsg = (who, html) => { const d = document.createElement("div"); d.className = `rp-chat-msg ${who}`; d.innerHTML = html; log.appendChild(d); log.scrollTop = log.scrollHeight; return d; };

    async function handle(text) {
      addMsg("user", esc(text));
      const thinking = addMsg("bot", "Pensando…");
      const spec = await specFromPrompt(text, currentSpec);
      thinking.remove();
      if (!spec || !spec.sections.length) {
        addMsg("bot", "No pude mapear eso a tus campos. Prueba nombrando una dimensión (" + dims.map((d) => d.field).join(", ") + ") y una medida (" + meas.map((m) => m.field).join(", ") + ").");
        return;
      }
      currentSpec = spec;
      addMsg("bot", "Listo. Actualicé la vista previa: " + esc(describeSpec(spec)) + ". Dime si ajustamos algo o descarga el PDF.");
      await renderPreview(spec);
      pane.querySelector("#rpChatPdf").disabled = false;
      pane.querySelector("#rpSaveTpl").disabled = false;
    }

    pane.querySelector("#rpChatSend").addEventListener("click", () => {
      const t = pane.querySelector("#rpChatText").value.trim();
      if (!t) return; pane.querySelector("#rpChatText").value = ""; handle(t);
    });
    pane.querySelector("#rpChatText").addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); pane.querySelector("#rpChatSend").click(); }
    });
    pane.querySelector("#rpChatPdf").addEventListener("click", () => { if (currentSpec) generateFromSpec(currentSpec, "Informe personalizado"); });
    pane.querySelector("#rpSaveTpl").addEventListener("click", () => {
      if (!currentSpec) return;
      const name = prompt("Nombre de la plantilla:", "Mi informe");
      if (!name) return;
      const list = loadChatTpls(); list.push({ name: name.trim(), spec: currentSpec }); saveChatTpls(list);
      renderChat();
    });
    pane.querySelectorAll("[data-saved]").forEach((b) =>
      b.addEventListener("click", async () => { const t = loadChatTpls()[+b.dataset.saved]; if (t) { currentSpec = t.spec; await renderPreview(t.spec); pane.querySelector("#rpChatPdf").disabled = false; pane.querySelector("#rpSaveTpl").disabled = false; } }));
  }

  function loadChatTpls() { try { return JSON.parse(localStorage.getItem(`ds.informes.${appId}`) || "[]"); } catch { return []; } }
  function saveChatTpls(list) { try { localStorage.setItem(`ds.informes.${appId}`, JSON.stringify(list)); } catch {} }

  renderPlantillas();

  /* ---------------- Progreso ---------------- */
  const prog = mount.querySelector("#rpProg");
  const progSteps = mount.querySelector("#rpProgSteps");
  const progTitle = mount.querySelector("#rpProgTitle");
  function showProgress(title) {
    progTitle.textContent = title;
    progSteps.innerHTML = "";
    prog.hidden = false;
  }
  function step(txt, state = "run") {
    const d = document.createElement("div");
    d.className = `rp-pstep ${state}`;
    d.innerHTML = `<span class="rp-pstep-dot"></span>${esc(txt)}`;
    progSteps.appendChild(d);
    return d;
  }
  function stepDone(el) { if (el) el.className = "rp-pstep done"; }
  function hideProgress() { prog.hidden = true; }

  /* ---------------- Generación del PDF ---------------- */
  async function generate(tpl) {
    if (!window.jspdf || !window.Chart) {
      alert("No se pudieron cargar las librerías del generador. Recarga la página (Ctrl+F5).");
      return;
    }
    showProgress(`Generando: ${tpl.name}`);
    const bf = businessFields();
    const primaryMeas = bf.primary;
    const measSpec = { table: primaryMeas.table, field: primaryMeas.field, agg: "sum" };
    const timeDim = dims.find((d) => /mes|fecha|date|month|dia|año|year|anio|trimestre|periodo/i.test(norm(d.field))) || null;
    const nonTimeDims = dims.filter((d) => d !== timeDim);

    try {
      // 1) Roles validados: elegimos dimensiones que SÍ producen señal (>0),
      //    evitando el bug "REGION = 0" cuando la data está mal perfilada.
      let s = step("Seleccionando dimensiones con señal…");
      const p1 = await pickDimensionWithSignal(nonTimeDims.length ? nonTimeDims : dims, measSpec, null);
      const primaryDim = p1?.dim || dims[0];
      const p2 = await pickDimensionWithSignal(nonTimeDims.length ? nonTimeDims : dims, measSpec, primaryDim);
      const secondaryDim = p2?.dim || dims[1] || primaryDim;
      stepDone(s);

      // 2) Datos reales + métricas de negocio derivadas
      s = step("Calculando métricas de negocio…");
      const roles = { primaryDim, secondaryDim, timeDim, primaryMeas };
      const data = await gatherData(tpl, roles);
      const spec = await buildSpec(bf, primaryDim, secondaryDim, data.byTime);
      stepDone(s);

      // 3) Gráficas
      s = step("Renderizando gráficas…");
      const images = await renderCharts(tpl, data, roles);
      stepDone(s);

      // 4) Insights + narrativa nivel consultoría (ahora con métricas derivadas)
      s = step("Interpretando resultados…");
      const insights = buildInsights(data, roles);
      const summaryLine = await oneLineSummary(insights, data, spec);
      const findings = buildSpecializedFindings(spec, roles, insights);
      const recommendations = buildSpecializedRecommendations(spec, roles, insights);
      const narrative = await writeExpertNarrative(spec, roles);
      stepDone(s);

      // 5) Componer PDF especializado
      s = step("Componiendo el informe…");
      await buildPdf(tpl, data, images, narrative, roles,
        { summaryLine, insights, findings, recommendations, spec });
      stepDone(s);

      step("Informe descargado ✓", "done");
      setTimeout(hideProgress, 900);
    } catch (e) {
      step("Error: " + (e.message || e), "err");
      console.error(e);
      setTimeout(hideProgress, 2600);
    }
  }

  async function gatherData(tpl, roles) {
    const { primaryDim, secondaryDim, timeDim } = roles;
    const d = { kpis: [], byPrimary: null, bySecondary: null, byTime: null };
    // SOLO medidas numéricas como KPI. Blindaje: aunque /fields clasifique mal,
    // descartamos cualquier campo cuyo type no sea numérico (evita "REGION=0").
    const realMeas = meas.filter((m) => isNumericType(m.type) || m.type === undefined);
    const measForKpi = realMeas.length ? realMeas : meas;
    for (const m of measForKpi) {
      const r = await api.query(appId, { measures: [{ table: m.table, field: m.field, agg: "sum" }] });
      d.kpis.push({ label: fieldLabel(m.field), value: r.value, agg: "sum" });
    }
    if (measForKpi[0]) {
      const avg = await api.query(appId, { measures: [{ table: measForKpi[0].table, field: measForKpi[0].field, agg: "avg" }] });
      d.kpis.push({ label: `${fieldLabel(measForKpi[0].field)} (promedio)`, value: avg.value, agg: "avg" });
    }
    const m0 = roles.primaryMeas || measForKpi[0] || meas[0];
    if (primaryDim) d.byPrimary = await api.query(appId, { dimension: { table: primaryDim.table, field: primaryDim.field }, measures: [{ table: m0.table, field: m0.field, agg: "sum" }] });
    if (secondaryDim) d.bySecondary = await api.query(appId, { dimension: { table: secondaryDim.table, field: secondaryDim.field }, measures: [{ table: m0.table, field: m0.field, agg: "sum" }] });
    if (timeDim) d.byTime = await api.query(appId, { dimension: { table: timeDim.table, field: timeDim.field }, measures: [{ table: m0.table, field: m0.field, agg: "sum" }] });
    return d;
  }

  /* ---------------- Render de gráficas a imagen ---------------- */
  const canvasHost = mount.querySelector("#rpCanvasHost");
  function makeCanvas(w = 820, h = 380) {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    canvasHost.appendChild(c);
    return c;
  }
  function colorAt(i) { return PALETTE[i % PALETTE.length]; }

  function chartImage(type, labels, values, title) {
    return new Promise((resolve) => {
      const canvas = makeCanvas();
      const colors = labels.map((_, i) => colorAt(i));
      const cfg = {
        type: type === "line" ? "line" : type,
        data: {
          labels,
          datasets: [{
            label: title, data: values,
            backgroundColor: type === "pie" ? colors : (type === "line" ? "rgba(23,41,131,0.12)" : "#172983"),
            borderColor: type === "line" ? "#172983" : colors,
            borderWidth: type === "line" ? 3 : 1, fill: type === "line",
            tension: 0.3, pointBackgroundColor: "#172983", pointRadius: 4,
          }],
        },
        options: {
          responsive: false, animation: false,
          plugins: {
            legend: { display: type === "pie", position: "right", labels: { font: { size: 13 } } },
            title: { display: false },
          },
          scales: type === "pie" ? {} : {
            y: { ticks: { font: { size: 12 } }, grid: { color: "#eef0f5" } },
            x: { ticks: { font: { size: 12 } }, grid: { display: false } },
          },
        },
      };
      const chart = new window.Chart(canvas, cfg);
      // Chart.js con animation:false pinta sincrónico. Leemos tras un tick con
      // setTimeout (robusto en headless; requestAnimationFrame puede no dispararse
      // con virtual-time). Forzamos un render explícito por si acaso.
      try { chart.render(); } catch {}
      setTimeout(() => {
        let img = "";
        try { img = canvas.toDataURL("image/png", 1.0); } catch {}
        try { chart.destroy(); } catch {}
        canvas.remove();
        resolve(img);
      }, 30);
    });
  }

  async function renderCharts(tpl, data, roles) {
    const imgs = {};
    const set = tpl.sections;
    if ((set.includes("bar_primary") || set.includes("table_primary")) && data.byPrimary?.labels?.length)
      imgs.bar_primary = await chartImage("bar", data.byPrimary.labels, data.byPrimary.values, `${roles.primaryMeas.field} por ${roles.primaryDim.field}`);
    if (set.includes("pie_primary") && data.byPrimary?.labels?.length)
      imgs.pie_primary = await chartImage("pie", data.byPrimary.labels, data.byPrimary.values, roles.primaryDim.field);
    if ((set.includes("pie_secondary")) && data.bySecondary?.labels?.length)
      imgs.pie_secondary = await chartImage("pie", data.bySecondary.labels, data.bySecondary.values, roles.secondaryDim.field);
    if ((set.includes("bar_secondary")) && data.bySecondary?.labels?.length)
      imgs.bar_secondary = await chartImage("bar", data.bySecondary.labels, data.bySecondary.values, `${roles.primaryMeas.field} por ${roles.secondaryDim.field}`);
    if ((set.includes("trend") || set.includes("trend_table")) && data.byTime?.labels?.length)
      imgs.trend = await chartImage("line", data.byTime.labels, data.byTime.values, `Tendencia de ${roles.primaryMeas.field}`);
    return imgs;
  }

  /* ---------------- Narrativa (agente) ---------------- */
  async function writeNarrative(tpl, data, roles) {
    const ctxData = {
      app: appName, plantilla: tpl.name,
      total: data.kpis.map((k) => ({ medida: k.label, valor: k.value })),
      porDimensionPrincipal: data.byPrimary ? zip(data.byPrimary.labels, data.byPrimary.values) : null,
      porCategoria: data.bySecondary ? zip(data.bySecondary.labels, data.bySecondary.values) : null,
      porTiempo: data.byTime ? zip(data.byTime.labels, data.byTime.values) : null,
    };
    const pregunta = `Redacta el ANÁLISIS escrito de un informe ejecutivo titulado "${tpl.name}" para la aplicación "${appName}". No des consejos ni pasos: INTERPRETA los datos. Escribe 2-3 párrafos profesionales: qué muestran los totales, qué dimensión/categoría destaca y por qué, y el comportamiento en el tiempo si aplica. Usa las cifras reales del contexto. Español, tono de informe corporativo.`;
    // El agente enriquece el texto, pero NUNCA debe bloquear la generación del PDF:
    // carrera contra un timeout; si no responde a tiempo, narrativa determinista.
    const timeout = new Promise((resolve) => setTimeout(() => resolve(null), 25000));
    try {
      const res = await Promise.race([api.aiAnalizar(appId, { pregunta, contexto: ctxData }), timeout]);
      if (res && res.ok && res.message) return res.message;
    } catch {}
    // Respaldo: narrativa determinista si el agente no responde o tarda.
    return deterministicNarrative(data, roles);
  }

  function deterministicNarrative(data, roles) {
    const parts = [];
    const totals = data.kpis.filter((k) => k.agg === "sum").map((k) => `${k.label}: ${NF.format(k.value)}`).join(", ");
    parts.push(`Los totales del periodo son ${totals}.`);
    if (data.byPrimary?.labels?.length) {
      const top = topOf(data.byPrimary);
      parts.push(`En ${roles.primaryDim.field}, el valor más alto corresponde a "${top.label}" con ${NF.format(top.value)} (${top.pct}% del total).`);
    }
    if (data.bySecondary?.labels?.length && roles.secondaryDim.field !== roles.primaryDim.field) {
      const top = topOf(data.bySecondary);
      parts.push(`Por ${roles.secondaryDim.field}, "${top.label}" lidera con ${NF.format(top.value)} (${top.pct}%).`);
    }
    if (data.byTime?.labels?.length) {
      const v = data.byTime.values;
      const trend = v[v.length - 1] >= v[0] ? "una tendencia al alza" : "una tendencia a la baja";
      parts.push(`A lo largo de ${roles.timeDim.field} se observa ${trend}, de ${NF.format(v[0])} a ${NF.format(v[v.length - 1])}.`);
    }
    return parts.join(" ");
  }

  /* ---------------- Composición del PDF (nivel consultoría) ---------------- */
  async function buildPdf(tpl, data, images, narrative, roles, cons) {
    const pdf = newPdf(tpl.name);
    const { doc, W, H, M } = pdf;

    // ---- PORTADA con resumen en una frase ----
    pdf.cover(tpl.name, cons.summaryLine);

    // ---- RESUMEN EJECUTIVO (bloque destacado) ----
    pdf.execSummary(cons.summaryLine, cons.insights);

    // ---- MÉTRICAS DE NEGOCIO derivadas (margen, ticket, %margen) ----
    if (cons.spec) pdf.metricsPanel(cons.spec);

    // ---- KPIs con estado/color ----
    if (tpl.sections.includes("kpis")) pdf.kpiPanel(data.kpis, cons.insights);

    // ---- HALLAZGOS (qué vimos / qué significa) ----
    if (cons.findings?.length) pdf.findings(cons.findings);

    // ---- ANÁLISIS ESPECIALIZADO: rentabilidad, Pareto, evolución ----
    if (cons.spec) {
      if (cons.spec.profPrimary) pdf.profitabilityTable(cons.spec.profPrimary, fieldLabel(roles.primaryDim.field));
      if (cons.spec.paretoPrimary) pdf.paretoTable(cons.spec.paretoPrimary, fieldLabel(roles.primaryDim.field));
      if (cons.spec.profSecondary) pdf.profitabilityTable(cons.spec.profSecondary, fieldLabel(roles.secondaryDim.field));
      if (cons.spec.mom) pdf.momTable(cons.spec.mom, fieldLabel(roles.timeDim?.field || "periodo"));
    }

    // ---- GRÁFICAS ----
    const labelFor = {
      bar_primary: `${fieldLabel(roles.primaryMeas.field)} por ${fieldLabel(roles.primaryDim.field)}`,
      pie_primary: `Participación por ${fieldLabel(roles.primaryDim.field)}`,
      pie_secondary: `Participación por ${fieldLabel(roles.secondaryDim.field)}`,
      bar_secondary: `${fieldLabel(roles.primaryMeas.field)} por ${fieldLabel(roles.secondaryDim.field)}`,
      trend: `Tendencia de ${fieldLabel(roles.primaryMeas.field)}`,
    };
    for (const sec of tpl.sections) if (images[sec]) pdf.image(images[sec], labelFor[sec]);

    // ---- TABLAS ----
    if (tpl.sections.includes("table_primary")) pdf.table(`Detalle por ${fieldLabel(roles.primaryDim.field)}`, data.byPrimary, fieldLabel(roles.primaryDim.field), fieldLabel(roles.primaryMeas.field));
    if (tpl.sections.includes("table_secondary")) pdf.table(`Detalle por ${fieldLabel(roles.secondaryDim.field)}`, data.bySecondary, fieldLabel(roles.secondaryDim.field), fieldLabel(roles.primaryMeas.field));
    if (tpl.sections.includes("trend_table")) pdf.table(`Detalle por ${fieldLabel(roles.timeDim.field)}`, data.byTime, fieldLabel(roles.timeDim.field), fieldLabel(roles.primaryMeas.field));

    // ---- ANÁLISIS NARRATIVO ----
    if (tpl.sections.includes("analysis") && narrative) pdf.prose("Análisis detallado", narrative);

    // ---- RECOMENDACIONES PRIORIZADAS ----
    if (cons.recommendations?.length) pdf.recommendations(cons.recommendations);

    pdf.finish(`Informe_${tpl.name.replace(/[^\w]+/g, "_")}_${appName.replace(/[^\w]+/g, "_")}.pdf`);
  }

  /* ====================================================================== */
  /* ===========  COMPOSITOR PDF REUTILIZABLE (nivel consultoría)  ======== */
  /* ====================================================================== */
  // Encapsula portada, resumen ejecutivo, KPIs con estado, hallazgos,
  // gráficas, tablas, prosa y recomendaciones. Usado por plantillas, hojas
  // y chat para un look & feel homogéneo tipo informe de consultoría.
  function newPdf(docTitle) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const W = doc.internal.pageSize.getWidth();
    const H = doc.internal.pageSize.getHeight();
    const M = 48;
    const api = { doc, W, H, M, y: 0 };

    const ensure = (need) => { if (api.y + need > H - 56) { doc.addPage(); api.y = M; } };
    const heading = (txt) => {
      ensure(42); doc.setFontSize(13.5); doc.setTextColor(...BRAND_DARK); doc.setFont(undefined, "bold");
      doc.text(txt, M, api.y); api.y += 7; doc.setDrawColor(...BRAND); doc.setLineWidth(2);
      doc.line(M, api.y, M + 54, api.y); api.y += 20; doc.setFont(undefined, "normal"); doc.setTextColor(...INK);
    };

    api.cover = (title, summaryLine) => {
      // Banda superior de marca.
      doc.setFillColor(...BRAND); doc.rect(0, 0, W, 210, "F");
      doc.setFillColor(...BRAND_DARK); doc.rect(0, 200, W, 10, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(11.5); doc.text("DATASENSE · INFORME ANALÍTICO", M, 66);
      doc.setFontSize(27); doc.setFont(undefined, "bold");
      doc.text(doc.splitTextToSize(title, W - M * 2), M, 108);
      doc.setFont(undefined, "normal"); doc.setFontSize(13); doc.text(appName, M, 168);
      doc.setFontSize(10); doc.text(new Date().toLocaleString("es-CO"), M, 188);
      // Tarjeta "resumen en una frase".
      api.y = 250;
      const cardH = 92;
      doc.setFillColor(...SOFT); doc.setDrawColor(...BRAND); doc.setLineWidth(0.8);
      doc.roundedRect(M, api.y, W - M * 2, cardH, 8, 8, "FD");
      // Barra lateral azul.
      doc.setFillColor(...BRAND); doc.rect(M, api.y, 5, cardH, "F");
      doc.setFontSize(9.5); doc.setTextColor(...BRAND); doc.setFont(undefined, "bold");
      doc.text("EN UNA FRASE", M + 18, api.y + 24);
      doc.setFont(undefined, "normal"); doc.setFontSize(13); doc.setTextColor(...INK);
      const lines = doc.splitTextToSize(summaryLine || "Panorama del periodo analizado.", W - M * 2 - 36);
      let ly = api.y + 46; lines.slice(0, 3).forEach((l) => { doc.text(l, M + 18, ly); ly += 17; });
      api.y += cardH + 28;
    };

    api.execSummary = (summaryLine, ins) => {
      heading("Resumen ejecutivo");
      doc.setFontSize(11); doc.setTextColor(...INK);
      const bits = [];
      if (ins?.totalKpi) bits.push(`El total de ${fieldLabel(ins.totalKpi.label)} del periodo es ${NF.format(Math.round(ins.totalKpi.value || 0))}.`);
      if (ins?.conc?.top) bits.push(`El mayor aporte proviene de "${ins.conc.top.label}" con ${(ins.conc.topShare * 100).toFixed(1)}% del total, un reparto ${ins.conc.estado}.`);
      if (ins?.trend) bits.push(`En el tiempo, el comportamiento es ${ins.trend.estado} (${ins.trend.pct >= 0 ? "+" : ""}${ins.trend.pct.toFixed(1)}%).`);
      const txt = bits.join(" ") || summaryLine || "";
      doc.splitTextToSize(txt, W - M * 2).forEach((l) => { ensure(15); doc.text(l, M, api.y); api.y += 15; });
      api.y += 14;
    };

    api.kpiPanel = (kpis, ins) => {
      if (!kpis?.length) return;
      heading("Indicadores clave");
      const cols = Math.min(3, kpis.length);
      const cardW = (W - M * 2 - (cols - 1) * 12) / cols;
      const rowH = 78; let cx = M, count = 0; ensure(rowH + 6);
      kpis.forEach((k) => {
        if (count > 0 && count % cols === 0) { api.y += rowH + 12; cx = M; ensure(rowH + 6); }
        // Color de estado: ligado a la tendencia si es la medida principal.
        let sc = BRAND_DARK, estado = "";
        if (ins?.trend && /promedio/i.test(k.label) === false && count === 0) {
          sc = ins.trend.color; estado = ins.trend.estado;
        }
        doc.setFillColor(...SOFT); doc.setDrawColor(224, 228, 240); doc.setLineWidth(0.8);
        doc.roundedRect(cx, api.y, cardW, rowH, 7, 7, "FD");
        // Franja de estado.
        doc.setFillColor(...sc); doc.rect(cx, api.y, cardW, 4, "F");
        doc.setFontSize(8.5); doc.setTextColor(...MUTED);
        doc.text(String(k.label).toUpperCase(), cx + 12, api.y + 24, { maxWidth: cardW - 24 });
        doc.setFontSize(19); doc.setTextColor(...BRAND_DARK); doc.setFont(undefined, "bold");
        doc.text(NF.format(Math.round(k.value || 0)), cx + 12, api.y + 50);
        doc.setFont(undefined, "normal");
        if (estado) { doc.setFontSize(8.5); doc.setTextColor(...sc); doc.text("● " + estado, cx + 12, api.y + 68); }
        cx += cardW + 12; count++;
      });
      api.y += rowH + 26;
    };

    api.findings = (list) => {
      heading("Hallazgos");
      list.forEach((f) => {
        // alto estimado del bloque
        doc.setFontSize(10.5);
        const sawLines = doc.splitTextToSize(f.saw, W - M * 2 - 40);
        const meanLines = doc.splitTextToSize(f.means, W - M * 2 - 40);
        const blockH = 22 + sawLines.length * 14 + 16 + meanLines.length * 14 + 14;
        ensure(blockH);
        const x0 = M, w = W - M * 2;
        doc.setFillColor(252, 252, 254); doc.setDrawColor(230, 233, 243); doc.setLineWidth(0.8);
        doc.roundedRect(x0, api.y, w, blockH - 6, 7, 7, "FD");
        // Punto de estado.
        doc.setFillColor(...(f.state || MUTED2)); doc.circle(x0 + 16, api.y + 20, 5, "F");
        // Qué vimos.
        doc.setFont(undefined, "bold"); doc.setFontSize(9); doc.setTextColor(...MUTED);
        doc.text("QUÉ VIMOS", x0 + 30, api.y + 22);
        doc.setFont(undefined, "normal"); doc.setFontSize(10.5); doc.setTextColor(...INK);
        let ty = api.y + 38; sawLines.forEach((l) => { doc.text(l, x0 + 30, ty); ty += 14; });
        // Qué significa.
        ty += 4; doc.setFont(undefined, "bold"); doc.setFontSize(9); doc.setTextColor(...BRAND);
        doc.text("QUÉ SIGNIFICA", x0 + 30, ty); ty += 16;
        doc.setFont(undefined, "normal"); doc.setFontSize(10.5); doc.setTextColor(60, 66, 78);
        meanLines.forEach((l) => { doc.text(l, x0 + 30, ty); ty += 14; });
        api.y += blockH + 8;
      });
      api.y += 6;
    };

    api.image = (img, label) => {
      if (!img) return; if (label) heading(label);
      const w = W - M * 2; const h = w * (380 / 820); ensure(h + 10);
      doc.addImage(img, "PNG", M, api.y, w, h); api.y += h + 22;
    };

    api.table = (title, q, dimLabel, measLabel) => {
      if (!q?.labels?.length) return; heading(title);
      const total = q.values.reduce((a, b) => a + (b || 0), 0) || 1;
      const rows = q.labels.map((l, i) => [l, NF.format(q.values[i]), ((q.values[i] / total) * 100).toFixed(1) + "%"]);
      rows.push(["TOTAL", NF.format(total), "100%"]);
      doc.autoTable({
        startY: api.y, margin: { left: M, right: M },
        head: [[dimLabel, measLabel || "Valor", "% del total"]], body: rows,
        headStyles: { fillColor: BRAND, textColor: 255, fontStyle: "bold" },
        alternateRowStyles: { fillColor: SOFT }, styles: { fontSize: 10, cellPadding: 6 },
        didParseCell: (d) => { if (d.row.index === rows.length - 1) { d.cell.styles.fontStyle = "bold"; d.cell.styles.fillColor = [232, 235, 247]; } },
      });
      api.y = doc.lastAutoTable.finalY + 24;
    };

    api.prose = (title, text) => {
      if (!text || !String(text).trim()) return; heading(title);
      doc.setFontSize(11); doc.setTextColor(...INK);
      const clean = String(text).replace(/[#*`]/g, "").replace(/\r/g, "");
      doc.splitTextToSize(clean, W - M * 2).forEach((l) => { ensure(16); doc.text(l, M, api.y); api.y += 16; });
      api.y += 10;
    };

    api.recommendations = (recs) => {
      heading("Recomendaciones priorizadas");
      const prioColor = { Alta: BAD, Media: WARN, Baja: OK };
      recs.forEach((r, i) => {
        doc.setFontSize(10.5);
        const txtLines = doc.splitTextToSize(r.text, W - M * 2 - 78);
        const blockH = Math.max(34, 14 + txtLines.length * 14);
        ensure(blockH + 6);
        const x0 = M, w = W - M * 2;
        doc.setFillColor(252, 252, 254); doc.setDrawColor(230, 233, 243); doc.setLineWidth(0.8);
        doc.roundedRect(x0, api.y, w, blockH, 7, 7, "FD");
        // Badge de prioridad.
        const pc = prioColor[r.prio] || MUTED2;
        doc.setFillColor(...pc); doc.roundedRect(x0 + 10, api.y + 9, 54, 18, 4, 4, "F");
        doc.setTextColor(255, 255, 255); doc.setFontSize(8.5); doc.setFont(undefined, "bold");
        doc.text(r.prio.toUpperCase(), x0 + 37, api.y + 21, { align: "center" });
        // Número.
        doc.setTextColor(...MUTED); doc.setFontSize(10); doc.setFont(undefined, "normal");
        // Texto.
        doc.setTextColor(...INK); doc.setFontSize(10.5);
        let ty = api.y + 20; txtLines.forEach((l) => { doc.text(l, x0 + 76, ty); ty += 14; });
        api.y += blockH + 8;
      });
      api.y += 6;
    };

    // Panel de MÉTRICAS DE NEGOCIO derivadas (margen, ticket, %margen).
    api.metricsPanel = (spec) => {
      const { totals, metrics } = spec;
      const cards = [];
      if (totals.revenue != null) cards.push({ label: "Ingresos", val: "$" + NF.format(Math.round(totals.revenue)), tone: BRAND_DARK });
      if (metrics.margin != null) cards.push({ label: "Margen bruto", val: "$" + NF.format(Math.round(metrics.margin)), tone: metrics.marginPct >= 30 ? OK : metrics.marginPct >= 15 ? WARN : BAD });
      if (metrics.marginPct != null) cards.push({ label: "% Margen", val: metrics.marginPct.toFixed(1) + "%", tone: metrics.marginPct >= 30 ? OK : metrics.marginPct >= 15 ? WARN : BAD });
      if (metrics.ticket != null) cards.push({ label: "Ticket promedio", val: "$" + NF.format(Math.round(metrics.ticket)), tone: BRAND_DARK });
      if (totals.units != null) cards.push({ label: "Unidades", val: NF.format(Math.round(totals.units)), tone: BRAND_DARK });
      if (metrics.unitCost != null) cards.push({ label: "Costo unitario", val: "$" + NF.format(Math.round(metrics.unitCost)), tone: MUTED2 });
      if (!cards.length) return;
      heading("Métricas de negocio");
      const cols = Math.min(3, cards.length);
      const cardW = (W - M * 2 - (cols - 1) * 12) / cols; const rowH = 66; let cx = M, count = 0; ensure(rowH + 6);
      cards.forEach((k) => {
        if (count > 0 && count % cols === 0) { api.y += rowH + 12; cx = M; ensure(rowH + 6); }
        doc.setFillColor(...SOFT); doc.setDrawColor(224, 228, 240); doc.setLineWidth(0.8);
        doc.roundedRect(cx, api.y, cardW, rowH, 7, 7, "FD");
        doc.setFillColor(...k.tone); doc.rect(cx, api.y, cardW, 4, "F");
        doc.setFontSize(8.5); doc.setTextColor(...MUTED); doc.text(k.label.toUpperCase(), cx + 12, api.y + 24);
        doc.setFontSize(18); doc.setTextColor(...k.tone); doc.setFont(undefined, "bold");
        doc.text(k.val, cx + 12, api.y + 50); doc.setFont(undefined, "normal");
        cx += cardW + 12; count++;
      });
      api.y += rowH + 26;
    };

    // Tabla de RENTABILIDAD por categoría: ingresos, costo, margen, %margen.
    api.profitabilityTable = (prof, dimLabel) => {
      if (!prof?.rows?.length) return;
      heading(`Rentabilidad por ${dimLabel}`);
      const totalRev = prof.rows.reduce((s, r) => s + (r.revenue || 0), 0) || 1;
      const head = prof.hasCost
        ? [[dimLabel, "Ingresos", "Costo", "Margen", "% Margen", "% Ingresos"]]
        : [[dimLabel, "Ingresos", "% Ingresos"]];
      const body = prof.rows.map((r) => prof.hasCost
        ? [r.label, "$" + NF.format(Math.round(r.revenue)), "$" + NF.format(Math.round(r.cost)), "$" + NF.format(Math.round(r.margin)), (r.marginPct != null ? r.marginPct.toFixed(1) + "%" : "—"), ((r.revenue / totalRev) * 100).toFixed(1) + "%"]
        : [r.label, "$" + NF.format(Math.round(r.revenue)), ((r.revenue / totalRev) * 100).toFixed(1) + "%"]);
      doc.autoTable({
        startY: api.y, margin: { left: M, right: M }, head, body,
        headStyles: { fillColor: BRAND, textColor: 255, fontStyle: "bold", fontSize: 9 },
        alternateRowStyles: { fillColor: SOFT }, styles: { fontSize: 9.5, cellPadding: 5 },
        columnStyles: prof.hasCost ? { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right" } } : { 1: { halign: "right" }, 2: { halign: "right" } },
        didParseCell: (d) => {
          // Colorea el %margen según salud.
          if (prof.hasCost && d.section === "body" && d.column.index === 4) {
            const v = parseFloat(String(d.cell.raw).replace("%", ""));
            if (!isNaN(v)) d.cell.styles.textColor = v >= 30 ? OK : v >= 15 ? WARN : BAD;
          }
        },
      });
      api.y = doc.lastAutoTable.finalY + 24;
    };

    // Tabla de PARETO: contribución y acumulada.
    api.paretoTable = (par, dimLabel) => {
      if (!par?.rows?.length) return;
      heading(`Concentración (Pareto) por ${dimLabel}`);
      const body = par.rows.map((r, i) => [String(i + 1), r.label, "$" + NF.format(Math.round(r.revenue)), (r.share * 100).toFixed(1) + "%", (r.cumShare * 100).toFixed(1) + "%"]);
      doc.autoTable({
        startY: api.y, margin: { left: M, right: M },
        head: [["#", dimLabel, "Ingresos", "% Indiv.", "% Acum."]], body,
        headStyles: { fillColor: BRAND, textColor: 255, fontStyle: "bold", fontSize: 9 },
        alternateRowStyles: { fillColor: SOFT }, styles: { fontSize: 9.5, cellPadding: 5 },
        columnStyles: { 0: { halign: "center", cellWidth: 26 }, 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" } },
        didParseCell: (d) => {
          if (d.section === "body" && d.column.index === 4) {
            const v = parseFloat(String(d.cell.raw).replace("%", ""));
            if (!isNaN(v) && v <= 80) { d.cell.styles.fontStyle = "bold"; d.cell.styles.textColor = BRAND_DARK; }
          }
        },
      });
      doc.setFontSize(9); doc.setTextColor(...MUTED);
      ensure(16); doc.text(`${par.n80} de ${par.n} categorías concentran el 80% de los ingresos.`, M, api.y); api.y += 22;
      doc.setTextColor(...INK);
    };

    // Tabla de EVOLUCIÓN mes a mes (MoM).
    api.momTable = (mom, timeLabel) => {
      if (!mom?.steps?.length) return;
      heading(`Evolución ${timeLabel ? "por " + timeLabel : "mensual"} (variación)`);
      const body = mom.steps.map((s) => [`${s.from} → ${s.to}`, "$" + NF.format(Math.round(s.cur)), (s.delta >= 0 ? "+" : "") + "$" + NF.format(Math.round(s.delta)), (s.pct >= 0 ? "+" : "") + s.pct.toFixed(1) + "%"]);
      doc.autoTable({
        startY: api.y, margin: { left: M, right: M },
        head: [["Periodo", "Valor", "Δ Absoluta", "Δ %"]], body,
        headStyles: { fillColor: BRAND, textColor: 255, fontStyle: "bold", fontSize: 9 },
        alternateRowStyles: { fillColor: SOFT }, styles: { fontSize: 9.5, cellPadding: 5 },
        columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" } },
        didParseCell: (d) => {
          if (d.section === "body" && d.column.index === 3) {
            const v = parseFloat(String(d.cell.raw).replace(/[+%]/g, ""));
            if (!isNaN(v)) d.cell.styles.textColor = v > 0 ? OK : v < 0 ? BAD : MUTED2;
          }
        },
      });
      api.y = doc.lastAutoTable.finalY + 24;
    };

    api.finish = (fname) => {
      const pages = doc.internal.getNumberOfPages();
      for (let i = 1; i <= pages; i++) {
        doc.setPage(i); doc.setFontSize(8); doc.setTextColor(...MUTED);
        doc.text(`DataSense · ${appName}`, M, H - 20);
        doc.text(`Página ${i} de ${pages}`, W - M, H - 20, { align: "right" });
      }
      doc.save(fname);
    };

    return api;
  }

  /* ====================================================================== */
  /* ========  DETECCIÓN DE CAMPOS DE NEGOCIO + MÉTRICAS DERIVADAS  ======== */
  /* ====================================================================== */
  // Identifica, por nombre, los campos clave de un dataset de ventas para poder
  // calcular métricas de negocio REALES (margen, ticket, rentabilidad) y no solo
  // sumas. Si no encuentra un campo, degrada con elegancia (omite esa métrica).

  const numericMeas = () => meas.filter((m) => isNumericType(m.type) || m.type === undefined);
  const findMeasBy = (re) => numericMeas().find((m) => re.test(norm(m.field))) || null;

  // Campos monetarios/volumen típicos (es/en). Heurística por nombre.
  function businessFields() {
    const revenue = findMeasBy(/venta|ingreso|revenue|sales|facturacion|importe|monto/);
    const cost = findMeasBy(/costo|coste|cost|gasto|cogs/);
    const units = findMeasBy(/unidad|cantidad|qty|units|volumen|piezas/);
    // La medida principal para gráficos: ingresos si existe, si no la 1ª numérica.
    const primary = revenue || numericMeas()[0] || meas[0];
    return { revenue, cost, units, primary };
  }

  // Elige la dimensión principal validando que produzca un desglose con señal
  // (suma > 0). Evita el bug "REGION = 0": si la 1ª dimensión da cero, prueba la
  // siguiente. Devuelve también la serie ya consultada para no repetir queries.
  async function pickDimensionWithSignal(candidates, measSpec, exclude) {
    for (const d of candidates) {
      if (exclude && d.field === exclude.field) continue;
      try {
        const r = await api.query(appId, { dimension: { table: d.table, field: d.field }, measures: [measSpec] });
        const total = (r.values || []).reduce((a, b) => a + (b || 0), 0);
        if (total > 0 && (r.labels || []).length) return { dim: d, q: r };
      } catch {}
    }
    return null;
  }

  // Arma el paquete analítico completo (totales, métricas, rentabilidad, Pareto,
  // MoM). Compartido por Plantillas, Hojas y Asistente. Nunca lanza: si algo
  // falla, devuelve lo que pudo calcular.
  async function buildSpec(bf, primaryDim, secondaryDim, byTimeQ) {
    const sum = async (f) => (await api.query(appId, { measures: [{ table: f.table, field: f.field, agg: "sum" }] })).value;
    const totals = {};
    try { if (bf.revenue) totals.revenue = await sum(bf.revenue); } catch {}
    try { if (bf.cost) totals.cost = await sum(bf.cost); } catch {}
    try { if (bf.units) totals.units = await sum(bf.units); } catch {}
    const metrics = derivedMetrics(totals);
    let profPrimary = null, profSecondary = null;
    try { profPrimary = primaryDim ? await profitabilityByDim(primaryDim, bf) : null; } catch {}
    try { profSecondary = (secondaryDim && primaryDim && secondaryDim.field !== primaryDim.field) ? await profitabilityByDim(secondaryDim, bf) : null; } catch {}
    const paretoPrimary = profPrimary ? pareto(profPrimary.rows, "revenue") : null;
    const mom = momSeries(byTimeQ);
    return { bf, totals, metrics, profPrimary, profSecondary, paretoPrimary, mom };
  }

  // Calcula métricas de negocio derivadas a partir de totales reales.
  function derivedMetrics(totals) {
    const rev = totals.revenue, cost = totals.cost, units = totals.units;
    const out = {};
    if (rev != null && cost != null) {
      out.margin = rev - cost;                              // margen bruto
      out.marginPct = rev ? (out.margin / rev) * 100 : 0;   // % margen
    }
    if (rev != null && units) out.ticket = rev / units;      // ticket/precio medio
    if (cost != null && units) out.unitCost = cost / units;  // costo unitario
    return out;
  }

  // Desglose enriquecido por dimensión: ingresos, costo, margen y %margen por
  // cada categoría de la dimensión (cruce de 2 queries alineadas por etiqueta).
  async function profitabilityByDim(dim, bf) {
    if (!dim || !bf.revenue) return null;
    const qRev = await api.query(appId, { dimension: { table: dim.table, field: dim.field }, measures: [{ table: bf.revenue.table, field: bf.revenue.field, agg: "sum" }] });
    let costMap = {};
    if (bf.cost) {
      const qCost = await api.query(appId, { dimension: { table: dim.table, field: dim.field }, measures: [{ table: bf.cost.table, field: bf.cost.field, agg: "sum" }] });
      (qCost.labels || []).forEach((l, i) => { costMap[l] = qCost.values[i] || 0; });
    }
    const rows = (qRev.labels || []).map((l, i) => {
      const rev = qRev.values[i] || 0;
      const cost = costMap[l] || 0;
      const margin = bf.cost ? rev - cost : null;
      const marginPct = (bf.cost && rev) ? (margin / rev) * 100 : null;
      return { label: l, revenue: rev, cost, margin, marginPct };
    }).sort((a, b) => b.revenue - a.revenue);
    return { dimField: dim.field, rows, hasCost: !!bf.cost };
  }

  // Análisis de Pareto: contribución acumulada; cuántas categorías explican 80%.
  function pareto(rows, valueKey = "revenue") {
    if (!rows?.length) return null;
    const total = rows.reduce((s, r) => s + (r[valueKey] || 0), 0) || 1;
    let acc = 0; const enriched = rows.map((r) => {
      acc += r[valueKey] || 0;
      return { ...r, share: (r[valueKey] || 0) / total, cumShare: acc / total };
    });
    const n80 = enriched.findIndex((r) => r.cumShare >= 0.8) + 1;
    return { total, rows: enriched, n80: n80 || enriched.length, n: enriched.length };
  }

  // Variación mes a mes (MoM) sobre la serie temporal real.
  function momSeries(q) {
    if (!q?.values?.length || q.values.length < 2) return null;
    const steps = [];
    for (let i = 1; i < q.values.length; i++) {
      const prev = q.values[i - 1] || 0, cur = q.values[i] || 0;
      const pct = prev ? ((cur - prev) / prev) * 100 : 0;
      steps.push({ from: q.labels[i - 1], to: q.labels[i], prev, cur, delta: cur - prev, pct });
    }
    const best = steps.reduce((a, b) => (b.pct > a.pct ? b : a), steps[0]);
    const worst = steps.reduce((a, b) => (b.pct < a.pct ? b : a), steps[0]);
    const avgPct = steps.reduce((s, x) => s + x.pct, 0) / steps.length;
    return { steps, best, worst, avgPct };
  }

  /* ====================================================================== */
  /* ===============  MOTOR DE INSIGHTS (nivel consultoría)  =============== */
  /* ====================================================================== */
  // A partir de los datos reales calcula: estado de KPIs, concentración,
  // tendencia, brecha líder/rezagado. Alimenta portada, hallazgos y
  // recomendaciones. NO inventa cifras: todo sale de las queries reales.

  // Estado de una serie por concentración (qué tan desigual está el reparto).
  function concentration(q) {
    if (!q?.values?.length) return null;
    const vals = q.values.map((v) => v || 0);
    const total = vals.reduce((a, b) => a + b, 0) || 1;
    const idx = vals.map((v, i) => ({ label: q.labels[i], value: v, pct: v / total }))
      .sort((a, b) => b.value - a.value);
    const top = idx[0];
    const bottom = idx[idx.length - 1];
    const topShare = top.pct;
    // HHI normalizado simple: ¿el líder concentra mucho?
    let estado = "equilibrado", color = OK;
    if (topShare >= 0.6) { estado = "muy concentrado"; color = BAD; }
    else if (topShare >= 0.4) { estado = "concentrado"; color = WARN; }
    const brecha = top.value && bottom.value ? (top.value / Math.max(bottom.value, 1)) : 0;
    return { total, top, bottom, topShare, estado, color, brecha, n: idx.length, ranked: idx };
  }

  // Tendencia de una serie temporal: variación total, pendiente y estado.
  function trendOf(q) {
    if (!q?.values?.length || q.values.length < 2) return null;
    const v = q.values.map((x) => x || 0);
    const first = v[0], last = v[v.length - 1];
    const delta = last - first;
    const pct = first ? (delta / first) * 100 : 0;
    // ¿cuántos periodos suben vs bajan?
    let up = 0, down = 0;
    for (let i = 1; i < v.length; i++) { if (v[i] > v[i - 1]) up++; else if (v[i] < v[i - 1]) down++; }
    let estado = "estable", color = MUTED2;
    if (pct >= 8) { estado = "al alza"; color = OK; }
    else if (pct <= -8) { estado = "a la baja"; color = BAD; }
    else if (up > down) { estado = "ligeramente al alza"; color = OK; }
    else if (down > up) { estado = "ligeramente a la baja"; color = WARN; }
    const peakI = v.indexOf(Math.max(...v));
    const lowI = v.indexOf(Math.min(...v));
    return { first, last, delta, pct, estado, color, up, down, peak: { label: q.labels[peakI], value: v[peakI] }, low: { label: q.labels[lowI], value: v[lowI] } };
  }

  // Construye el set de insights a partir de los datos ya consultados.
  function buildInsights(data, roles) {
    const conc = data.byPrimary ? concentration(data.byPrimary) : null;
    const conc2 = data.bySecondary && roles.secondaryDim && roles.secondaryDim.field !== roles.primaryDim?.field
      ? concentration(data.bySecondary) : null;
    const trend = data.byTime ? trendOf(data.byTime) : null;
    const totalKpi = (data.kpis || []).find((k) => k.agg === "sum");
    return { conc, conc2, trend, totalKpi, roles };
  }

  // Resumen en UNA frase (portada). Lo redacta el agente; si no, determinista.
  async function oneLineSummary(ins, data, spec) {
    const m = spec?.metrics || {}, t = spec?.totals || {};
    const det = () => {
      const bits = [];
      if (t.revenue != null) bits.push(`ingresos de $${NF.format(Math.round(t.revenue))}`);
      if (m.marginPct != null) bits.push(`margen del ${m.marginPct.toFixed(0)}%`);
      if (ins.conc?.top) bits.push(`liderados por ${ins.conc.top.label} (${(ins.conc.topShare * 100).toFixed(0)}%)`);
      if (spec?.mom) bits.push(`con variación mensual promedio de ${spec.mom.avgPct.toFixed(0)}%`);
      else if (ins.trend) bits.push(`con tendencia ${ins.trend.estado}`);
      return bits.length ? capitalize(bits.join(", ")) + "." : "Panorama general del periodo analizado.";
    };
    try {
      const pregunta = `Resume en UNA sola frase (máx 24 palabras), estilo titular ejecutivo de consultoría, el estado del negocio según estas cifras REALES (prioriza rentabilidad/margen, no solo ventas). Sin cifras inventadas, sin comillas, sin markdown. Español.`;
      const contexto = {
        ingresos: t.revenue ?? null,
        margen: m.margin ?? null,
        margenPct: m.marginPct != null ? +m.marginPct.toFixed(1) : null,
        ticketPromedio: m.ticket ?? null,
        lider: ins.conc?.top ? { nombre: ins.conc.top.label, participacion: +(ins.conc.topShare * 100).toFixed(1) } : null,
        concentracion: ins.conc?.estado || null,
        variacionMensualPromedio: spec?.mom ? +spec.mom.avgPct.toFixed(1) : null,
      };
      const to = new Promise((r) => setTimeout(() => r(null), 14000));
      const res = await Promise.race([api.aiAnalizar(appId, { pregunta, contexto }), to]);
      if (res && res.ok && res.message) return res.message.replace(/[#*`"]/g, "").replace(/\s+/g, " ").trim().slice(0, 160);
    } catch {}
    return det();
  }

  // Hallazgos: pares "qué vimos" / "qué significa". Deterministas + reales.
  function buildFindings(ins, roles) {
    const out = [];
    if (ins.conc?.top) {
      const c = ins.conc;
      out.push({
        state: c.color,
        saw: `${roles.primaryDim.field}: "${c.top.label}" concentra ${(c.topShare * 100).toFixed(1)}% del total (${NF.format(Math.round(c.top.value))}).`,
        means: c.topShare >= 0.5
          ? `El resultado depende fuertemente de un solo ${roles.primaryDim.field.toLowerCase()}; hay riesgo de concentración y oportunidad de diversificar.`
          : `El reparto es relativamente equilibrado; ningún ${roles.primaryDim.field.toLowerCase()} domina en exceso.`,
      });
      if (c.n > 1 && c.bottom && c.bottom.value < c.top.value) {
        out.push({
          state: c.bottom.value <= c.top.value * 0.15 ? BAD : WARN,
          saw: `El menor aporte es "${c.bottom.label}" con ${NF.format(Math.round(c.bottom.value))} (${(c.bottom.pct * 100).toFixed(1)}%).`,
          means: `Existe una brecha de ${c.brecha.toFixed(1)}x entre el líder y el rezagado: margen claro de mejora en "${c.bottom.label}".`,
        });
      }
    }
    if (ins.conc2?.top) {
      const c = ins.conc2;
      out.push({
        state: c.color,
        saw: `${roles.secondaryDim.field}: "${c.top.label}" es el de mayor aporte (${(c.topShare * 100).toFixed(1)}%).`,
        means: `Conviene priorizar "${c.top.label}" en decisiones de ${roles.secondaryDim.field.toLowerCase()}, sin descuidar el resto del portafolio.`,
      });
    }
    if (ins.trend) {
      const t = ins.trend;
      out.push({
        state: t.color,
        saw: `A lo largo de ${roles.timeDim.field} el valor pasó de ${NF.format(Math.round(t.first))} a ${NF.format(Math.round(t.last))} (${t.pct >= 0 ? "+" : ""}${t.pct.toFixed(1)}%). Pico en "${t.peak.label}".`,
        means: t.pct >= 8 ? `Crecimiento sostenido: la estrategia actual está funcionando y conviene mantener el impulso.`
          : t.pct <= -8 ? `Caída relevante: requiere revisar causas (estacionalidad, demanda o ejecución) antes del próximo periodo.`
          : `Comportamiento estable: sin cambios bruscos; buen momento para introducir mejoras controladas.`,
      });
    }
    return out;
  }

  // Recomendaciones priorizadas (Alta/Media/Baja) derivadas de los hallazgos.
  function buildRecommendations(ins, roles) {
    const recs = [];
    if (ins.conc?.top && ins.conc.topShare >= 0.5) {
      recs.push({ prio: "Alta", text: `Reducir la dependencia de "${ins.conc.top.label}" en ${roles.primaryDim.field.toLowerCase()}: impulsar a los de menor aporte con acciones comerciales específicas.` });
    }
    if (ins.conc?.bottom && ins.conc.n > 1) {
      recs.push({ prio: ins.conc.bottom.value <= ins.conc.top.value * 0.15 ? "Alta" : "Media", text: `Diseñar un plan de recuperación para "${ins.conc.bottom.label}", el de menor desempeño, con metas medibles para el próximo periodo.` });
    }
    if (ins.trend && ins.trend.pct <= -8) {
      recs.push({ prio: "Alta", text: `Investigar la caída observada en ${roles.timeDim.field.toLowerCase()} y definir acciones correctivas antes del siguiente ciclo.` });
    } else if (ins.trend && ins.trend.pct >= 8) {
      recs.push({ prio: "Media", text: `Capitalizar la tendencia positiva: asegurar inventario/capacidad para sostener el crecimiento en ${roles.timeDim.field.toLowerCase()}.` });
    }
    if (ins.conc2?.top) {
      recs.push({ prio: "Media", text: `Concentrar esfuerzos de marketing en "${ins.conc2.top.label}" (${roles.secondaryDim.field.toLowerCase()} líder) y evaluar la rentabilidad del resto.` });
    }
    recs.push({ prio: "Baja", text: `Establecer un seguimiento mensual de estos indicadores para detectar desviaciones a tiempo.` });
    // Orden por prioridad.
    const order = { Alta: 0, Media: 1, Baja: 2 };
    return recs.sort((a, b) => order[a.prio] - order[b.prio]).slice(0, 6);
  }

  function capitalize(s) { s = String(s || ""); return s.charAt(0).toUpperCase() + s.slice(1); }

  /* ====================================================================== */
  /* =========  HALLAZGOS / RECOMENDACIONES / NARRATIVA EXPERTAS  ========= */
  /* ====================================================================== */
  const money = (v) => "$" + NF.format(Math.round(v || 0));
  const pct1 = (v) => (v >= 0 ? "" : "") + (v || 0).toFixed(1) + "%";

  // Hallazgos de analista senior: margen, rentabilidad por categoría, Pareto,
  // ticket, MoM y mix. Cada uno con cifra real y lectura de negocio.
  function buildSpecializedFindings(spec, roles, insights) {
    const out = [];
    const { metrics, totals, profPrimary, paretoPrimary, mom, bf } = spec;

    // 1) Rentabilidad global (margen).
    if (metrics.margin != null) {
      const healthy = metrics.marginPct >= 30;
      out.push({
        state: metrics.marginPct >= 30 ? OK : metrics.marginPct >= 15 ? WARN : BAD,
        saw: `Margen bruto de ${money(metrics.margin)} sobre ingresos de ${money(totals.revenue)}, equivalente a un ${pct1(metrics.marginPct)} de margen.`,
        means: healthy
          ? `La rentabilidad es saludable: cada peso vendido deja ${pct1(metrics.marginPct)} de margen tras costos.`
          : `El margen es ajustado; conviene revisar estructura de costos o política de precios para protegerlo.`,
      });
    }
    // 2) Ticket promedio.
    if (metrics.ticket != null) {
      out.push({
        state: MUTED2,
        saw: `Ticket promedio de ${money(metrics.ticket)} por unidad${metrics.unitCost != null ? `, con costo unitario de ${money(metrics.unitCost)}` : ""}.`,
        means: metrics.unitCost != null && metrics.ticket > metrics.unitCost
          ? `Cada unidad aporta ${money(metrics.ticket - metrics.unitCost)} de contribución; sostener el precio es clave para la rentabilidad.`
          : `El precio medio por unidad es la palanca principal de ingreso.`,
      });
    }
    // 3) Concentración / Pareto por la dimensión principal.
    if (paretoPrimary && paretoPrimary.rows.length) {
      const top = paretoPrimary.rows[0];
      const n80 = paretoPrimary.n80;
      out.push({
        state: top.share >= 0.5 ? BAD : top.share >= 0.35 ? WARN : OK,
        saw: `En ${roles.primaryDim.field}, "${top.label}" aporta ${pct1(top.share * 100)} de los ingresos (${money(top.revenue)}). ${n80} de ${paretoPrimary.n} categorías concentran el 80%.`,
        means: top.share >= 0.5
          ? `Alta dependencia de "${top.label}": un problema ahí golpea todo el resultado. Diversificar reduce riesgo.`
          : `La distribución sigue el principio de Pareto: foco en las pocas categorías que mueven la mayor parte del negocio.`,
      });
    }
    // 4) Rentabilidad por categoría: mejor y peor margen.
    if (profPrimary?.hasCost && profPrimary.rows.length > 1) {
      const withPct = profPrimary.rows.filter((r) => r.marginPct != null);
      if (withPct.length) {
        const bestM = withPct.reduce((a, b) => (b.marginPct > a.marginPct ? b : a));
        const worstM = withPct.reduce((a, b) => (b.marginPct < a.marginPct ? b : a));
        out.push({
          state: worstM.marginPct < 10 ? BAD : WARN,
          saw: `Por margen: "${bestM.label}" es el más rentable (${pct1(bestM.marginPct)}) y "${worstM.label}" el menos rentable (${pct1(worstM.marginPct)}).`,
          means: `No todo lo que más vende es lo que más deja. "${worstM.label}" exige revisar costos o precio; "${bestM.label}" es candidato a impulsar.`,
        });
      }
    }
    // 5) Evolución MoM.
    if (mom) {
      out.push({
        state: mom.avgPct >= 3 ? OK : mom.avgPct <= -3 ? BAD : MUTED2,
        saw: `Variación mes a mes promedio de ${pct1(mom.avgPct)}. Mejor salto: ${mom.best.from}→${mom.best.to} (${pct1(mom.best.pct)}); peor: ${mom.worst.from}→${mom.worst.to} (${pct1(mom.worst.pct)}).`,
        means: mom.avgPct >= 3 ? `Momento de crecimiento sostenido; asegurar capacidad e inventario para no frenar la demanda.`
          : mom.avgPct <= -3 ? `Tendencia descendente mes a mes; priorizar diagnóstico de la caída entre ${mom.worst.from} y ${mom.worst.to}.`
          : `Negocio estable entre periodos; terreno adecuado para probar iniciativas de crecimiento controladas.`,
      });
    }
    // Respaldo: si no hubo campos de negocio, usa los hallazgos base.
    return out.length ? out : buildFindings(insights, roles);
  }

  function buildSpecializedRecommendations(spec, roles, insights) {
    const recs = [];
    const { metrics, profPrimary, paretoPrimary, mom } = spec;
    if (metrics.marginPct != null && metrics.marginPct < 20) {
      recs.push({ prio: "Alta", text: `Elevar el margen bruto (hoy ${pct1(metrics.marginPct)}) hacia ≥20%: renegociar costos con proveedores de las categorías de mayor volumen y revisar precios de bajo margen.` });
    }
    if (profPrimary?.hasCost) {
      const withPct = profPrimary.rows.filter((r) => r.marginPct != null);
      if (withPct.length) {
        const worstM = withPct.reduce((a, b) => (b.marginPct < a.marginPct ? b : a));
        recs.push({ prio: worstM.marginPct < 10 ? "Alta" : "Media", text: `Plan de rentabilidad para "${worstM.label}" (margen ${pct1(worstM.marginPct)}): ajustar precio, reducir costo o reevaluar su permanencia en el portafolio.` });
      }
    }
    if (paretoPrimary && paretoPrimary.rows[0]?.share >= 0.5) {
      recs.push({ prio: "Alta", text: `Mitigar la concentración en "${paretoPrimary.rows[0].label}" (${pct1(paretoPrimary.rows[0].share * 100)} de ingresos): desarrollar 2-3 categorías alternativas con metas de participación.` });
    }
    if (mom && mom.worst.pct <= -5) {
      recs.push({ prio: "Alta", text: `Diagnosticar la caída de ${pct1(mom.worst.pct)} entre ${mom.worst.from} y ${mom.worst.to} (estacionalidad, quiebres de stock o demanda) y definir contramedidas.` });
    } else if (mom && mom.avgPct >= 3) {
      recs.push({ prio: "Media", text: `Sostener el crecimiento mensual (${pct1(mom.avgPct)} promedio): asegurar inventario y capacidad comercial en las categorías líderes.` });
    }
    recs.push({ prio: "Media", text: `Instaurar un tablero de margen por categoría y región, revisado mensualmente, para decidir con rentabilidad y no solo con ventas.` });
    recs.push({ prio: "Baja", text: `Definir alertas automáticas cuando el margen de una categoría caiga por debajo del umbral objetivo.` });
    const order = { Alta: 0, Media: 1, Baja: 2 };
    const seen = new Set();
    return recs.filter((r) => (seen.has(r.text) ? false : seen.add(r.text)))
      .sort((a, b) => order[a.prio] - order[b.prio]).slice(0, 7);
  }

  // Narrativa de analista: redactada por el agente con TODAS las métricas reales;
  // respaldo determinista detallado si el agente no responde.
  async function writeExpertNarrative(spec, roles) {
    const { totals, metrics, profPrimary, paretoPrimary, mom } = spec;
    const det = () => {
      const p = [];
      if (totals.revenue != null) p.push(`Los ingresos del periodo suman ${money(totals.revenue)}${totals.units ? ` sobre ${NF.format(Math.round(totals.units))} unidades` : ""}.`);
      if (metrics.margin != null) p.push(`El margen bruto es de ${money(metrics.margin)} (${pct1(metrics.marginPct)}), tras costos por ${money(totals.cost)}.`);
      if (metrics.ticket != null) p.push(`El ticket promedio por unidad es ${money(metrics.ticket)}.`);
      if (paretoPrimary?.rows?.length) { const t = paretoPrimary.rows[0]; p.push(`Por ${roles.primaryDim.field}, "${t.label}" lidera con ${pct1(t.share * 100)} de los ingresos, y ${paretoPrimary.n80} de ${paretoPrimary.n} categorías explican el 80% del total.`); }
      if (profPrimary?.hasCost) { const w = profPrimary.rows.filter((r) => r.marginPct != null); if (w.length) { const worst = w.reduce((a, b) => b.marginPct < a.marginPct ? b : a); const best = w.reduce((a, b) => b.marginPct > a.marginPct ? b : a); p.push(`En rentabilidad, "${best.label}" rinde el mayor margen (${pct1(best.marginPct)}) frente a "${worst.label}" (${pct1(worst.marginPct)}), lo que revela que el ranking por ventas no coincide con el de rentabilidad.`); } }
      if (mom) p.push(`La evolución mes a mes promedia ${pct1(mom.avgPct)}, con el mejor avance entre ${mom.best.from} y ${mom.best.to}.`);
      return p.join(" ");
    };
    try {
      const contexto = {
        ingresos: totals.revenue, costo: totals.cost, unidades: totals.units,
        margen: metrics.margin, margenPct: metrics.marginPct, ticketPromedio: metrics.ticket,
        rentabilidadPorCategoria: profPrimary ? profPrimary.rows.slice(0, 8).map((r) => ({ categoria: r.label, ingresos: r.revenue, margenPct: r.marginPct })) : null,
        pareto: paretoPrimary ? { categoriasPara80pct: paretoPrimary.n80, totalCategorias: paretoPrimary.n } : null,
        variacionMensual: mom ? mom.steps.map((x) => ({ de: x.from, a: x.to, pct: +x.pct.toFixed(1) })) : null,
      };
      const pregunta = `Eres consultor senior de analítica de negocio. Redacta un ANÁLISIS EXPERTO de 3-4 párrafos usando SOLO estas cifras reales (no inventes). Cubre: (1) rentabilidad real (margen e interpretación, no solo ventas), (2) qué categorías mandan y riesgo de concentración (Pareto), (3) dónde está el margen vs dónde está el volumen y qué implica, (4) evolución mensual y qué vigilar. Tono ejecutivo, concreto, con cifras. Español. Sin viñetas ni markdown.`;
      const to = new Promise((r) => setTimeout(() => r(null), 26000));
      const res = await Promise.race([api.aiAnalizar(appId, { pregunta, contexto }), to]);
      if (res && res.ok && res.message) return res.message.replace(/[#*`]/g, "");
    } catch {}
    return det();
  }

  /* ---------------- helpers ---------------- */
  function zip(labels, values) { return (labels || []).map((l, i) => ({ label: l, valor: values[i] })); }
  function topOf(q) {
    let bi = 0; for (let i = 1; i < q.values.length; i++) if (q.values[i] > q.values[bi]) bi = i;
    const total = q.values.reduce((a, b) => a + (b || 0), 0) || 1;
    return { label: q.labels[bi], value: q.values[bi], pct: ((q.values[bi] / total) * 100).toFixed(1) };
  }

  /* ===================== MODO HOJAS: replicar una hoja real ===================== */
  async function generateFromSheet(sheet) {
    if (!sheet) return;
    showProgress(`Generando: ${sheet.title || "Hoja"}`);
    try {
      let s = step("Leyendo objetos de la hoja…");
      const objs = sheet.objects || [];
      stepDone(s);
      s = step("Consultando datos y gráficas…");
      // Construimos secciones e imágenes directamente de los objetos de la hoja.
      const kpis = []; const images = []; const tables = [];
      for (const o of objs) {
        const p = o.props || {};
        const meares = (p.measures || []).map((m) => ({ table: m.table, field: m.field, agg: m.agg || "sum" }));
        const dim = (p.dims || [])[0];
        if (o.type === "kpi" && meares[0]) {
          const r = await api.query(appId, { measures: [meares[0]] });
          kpis.push({ label: fieldLabel(meares[0].field), value: r.value });
        } else if (dim && meares[0] && (o.type === "bar" || o.type === "pie" || o.type === "line")) {
          const r = await api.query(appId, { dimension: { table: dim.table, field: dim.field }, measures: [meares[0]] });
          if (r.labels?.length) {
            const img = await chartImage(o.type, r.labels, r.values, p.title || "");
            images.push({ img, label: p.title || `${fieldLabel(meares[0].field)} por ${fieldLabel(dim.field)}`, _q: r, _dimLabel: fieldLabel(dim.field), _measLabel: fieldLabel(meares[0].field) });
          }
        } else if (dim && (o.type === "table")) {
          const m0 = meares[0] || (meas[0] && { table: meas[0].table, field: meas[0].field, agg: "sum" });
          const r = await api.query(appId, { dimension: { table: dim.table, field: dim.field }, measures: [m0] });
          tables.push({ title: p.title || `Detalle por ${fieldLabel(dim.field)}`, q: r, dimLabel: fieldLabel(dim.field), measLabel: fieldLabel(m0.field) });
        }
      }
      stepDone(s);
      s = step("Componiendo el PDF…");
      await buildCustomPdf(sheet.title || "Informe de hoja", kpis, images, tables, "");
      stepDone(s);
      step("Informe descargado ✓", "done");
      setTimeout(hideProgress, 900);
    } catch (e) { step("Error: " + (e.message || e), "err"); setTimeout(hideProgress, 2600); }
  }

  /* ===================== MODO CHAT: spec desde lenguaje natural ===================== */
  // Mapea la petición del usuario a una spec {sections:[{kind,dim,meas,agg,title}]}
  // usando el agente; si falla, heurística por nombres de campos mencionados.
  async function specFromPrompt(text, prev) {
    const low = norm(text);
    const findDim = () => dims.find((d) => low.includes(norm(d.field))) || null;
    const findMeas = () => meas.find((m) => low.includes(norm(m.field))) || meas[0];
    const timeDim = dims.find((d) => /mes|fecha|date|month|ano|anio/i.test(norm(d.field)));
    const prevSecs = prev ? [...prev.sections] : [];

    // --- Detección de INTENCIÓN de edición (sobre spec previa) ---
    const isRemove = /\b(quita|elimina|saca|borra|remueve|sin )\b/.test(low);
    const isReplace = /\b(reemplaza|cambia|convierte|en vez|en lugar|mejor )\b/.test(low);
    const isAdd = /\b(agrega|anade|anadir|suma|incluye|ademas|pon|coloca|agregar|mete|quiero|agregame|ponme)\b/.test(low) || !prev;

    // --- Qué TIPO de sección menciona la frase ---
    const wantsText = /\b(analisis|analiza|recomendacion|recomienda|explicacion|explica|texto|cuadro de texto|resumen escrito|conclusion|interpreta|comentario|narrativa|descripcion)\b/.test(low);
    const wantsKpi = /\b(kpi|indicador|total|valor|metrica|numero)\b/.test(low);
    const wantsPie = /\b(tarta|pastel|pie|dona|donut|participacion|porcentaje|distribucion)\b/.test(low);
    const wantsLine = /\b(linea|tendencia|evolucion|serie|tiempo)\b/.test(low) || (timeDim && low.includes(norm(timeDim.field)));
    const wantsBar = /\b(barra|barras|columna|grafica|grafico|chart)\b/.test(low);
    const wantsTable = /\b(tabla|detalle|listado|desglose)\b/.test(low);

    const dim = findDim(); const measure = findMeas();
    const timeOrDim = (wantsLine && timeDim) ? timeDim : dim;

    // Construye las secciones NUEVAS que la frase pide explícitamente.
    const newSecs = [];
    if (wantsText) newSecs.push({ kind: "text", title: "Análisis" });
    if (wantsKpi) newSecs.push({ kind: "kpi", meas: measure.field, agg: "sum", title: `Total de ${measure.field}` });
    if (wantsPie && dim) newSecs.push({ kind: "pie", dim: dim.field, meas: measure.field, agg: "sum", title: `${measure.field} por ${dim.field}` });
    if (wantsLine && timeDim) newSecs.push({ kind: "line", dim: timeDim.field, meas: measure.field, agg: "sum", title: `Tendencia de ${measure.field}` });
    if (wantsBar && dim && !wantsPie) newSecs.push({ kind: "bar", dim: dim.field, meas: measure.field, agg: "sum", title: `${measure.field} por ${dim.field}` });
    if (wantsTable && dim) newSecs.push({ kind: "table", dim: dim.field, meas: measure.field, agg: "sum", title: `Detalle por ${dim.field}` });
    // Si menciona una dimensión y una medida pero no el tipo, barras por defecto.
    if (!newSecs.length && dim && (low.includes(norm(dim.field)) || low.includes(norm(measure.field)))) {
      newSecs.push({ kind: "bar", dim: dim.field, meas: measure.field, agg: "sum", title: `${measure.field} por ${dim.field}` });
    }

    // ---- QUITAR ----
    if (isRemove && prev) {
      const kindToKill = wantsText ? "text" : wantsKpi ? "kpi" : wantsPie ? "pie" : wantsLine ? "line" : wantsTable ? "table" : wantsBar ? "bar" : null;
      let kept = prevSecs;
      if (kindToKill) kept = prevSecs.filter((s) => s.kind !== kindToKill);
      else if (dim) kept = prevSecs.filter((s) => s.dim !== dim.field);
      return { name: prev.name, sections: kept.length ? kept : prevSecs, _note: kindToKill ? `quité ${label(kindToKill)}` : "quité lo indicado" };
    }
    // ---- REEMPLAZAR (quita del mismo tipo y añade lo nuevo) ----
    if (isReplace && prev && newSecs.length) {
      const addedKinds = new Set(newSecs.map((s) => s.kind));
      const kept = prevSecs.filter((s) => !addedKinds.has(s.kind));
      return { name: prev.name, sections: [...kept, ...newSecs], _note: "reemplacé por " + newSecs.map((s) => label(s.kind)).join(", ") };
    }
    // ---- AGREGAR sobre lo previo ----
    if (prev && !isReplace && newSecs.length) {
      // Evita duplicados idénticos.
      const sig = (s) => `${s.kind}|${s.dim||""}|${s.meas||""}`;
      const have = new Set(prevSecs.map(sig));
      const merged = [...prevSecs, ...newSecs.filter((s) => !have.has(sig(s)))];
      return { name: prev.name, sections: merged, _note: "agregué " + newSecs.map((s) => label(s.kind)).join(", ") };
    }

    // ---- SIN spec previa: intento con el agente y respaldo heurístico ----
    try {
      const pregunta = `Devuelve SOLO un JSON {"sections":[{"kind":"kpi|bar|pie|line|table|text","dim":"<campo o null>","meas":"<campo o null>","agg":"sum|avg|count|min|max","title":"..."}]} para el informe pedido. kind "text" = un párrafo de análisis/recomendaciones (sin dim/meas). Dimensiones: ${dims.map((d) => d.field).join(", ")}. Medidas: ${meas.map((m) => m.field).join(", ")}. Petición: "${text}". Usa SOLO esos campos.`;
      const to = new Promise((r) => setTimeout(() => r(null), 16000));
      const res = await Promise.race([api.aiAnalizar(appId, { pregunta, contexto: { dims: dims.map((d) => d.field), meas: meas.map((m) => m.field) } }), to]);
      if (res && res.ok && res.message) {
        const m = res.message.match(/\{[\s\S]*\}/);
        if (m) {
          const parsed = JSON.parse(m[0]);
          const secs = (parsed.sections || []).map(normSection).filter(Boolean);
          if (secs.length) return { name: "Informe personalizado", sections: secs };
        }
      }
    } catch {}
    if (newSecs.length) return { name: "Informe personalizado", sections: newSecs };
    // Respaldo mínimo: un KPI + barras por la dimensión encontrada.
    const fb = [{ kind: "kpi", meas: measure.field, agg: "sum", title: `Total de ${measure.field}` }];
    if (dim) fb.push({ kind: "bar", dim: dim.field, meas: measure.field, agg: "sum", title: `${measure.field} por ${dim.field}` });
    return { name: "Informe personalizado", sections: fb };
  }
  function norm(s) { return String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""); }
  function label(kind) {
    return ({ kpi: "el KPI", bar: "la gráfica de barras", pie: "la gráfica de tarta", line: "la gráfica de línea", table: "la tabla", text: "el análisis" })[kind] || kind;
  }
  function normSection(s) {
    if (!s || !s.kind) return null;
    if (s.kind === "text") return { kind: "text", title: s.title || "Análisis" };
    const kind = ["kpi", "bar", "pie", "line", "table"].includes(s.kind) ? s.kind : "bar";
    const meas0 = meas.find((m) => m.field === s.meas) ? s.meas : (meas[0] && meas[0].field);
    const dim0 = dims.find((d) => d.field === s.dim) ? s.dim : null;
    if (!meas0) return null;
    if (kind !== "kpi" && !dim0) return null;
    return { kind, dim: dim0, meas: meas0, agg: ["sum","avg","count","min","max"].includes(s.agg) ? s.agg : "sum", title: s.title || "" };
  }
  function describeSpec(spec) {
    if (spec._note) return spec._note + ". Ahora: " + specSummary(spec);
    return specSummary(spec);
  }
  function specSummary(spec) {
    return spec.sections.map((s) => s.kind === "kpi" ? `KPI ${s.meas}` : s.kind === "text" ? "análisis escrito" : `${label(s.kind).replace("la ","").replace("el ","")} ${s.meas||""}${s.dim?"/"+s.dim:""}`).join(", ");
  }

  async function specData(spec) {
    // Ejecuta las queries reales de cada sección de la spec.
    const out = [];
    const numeric = [];   // acumula cifras reales para alimentar el análisis
    for (const s of spec.sections) {
      if (s.kind === "text") { out.push({ ...s, _text: true }); continue; }
      const mref = meas.find((m) => m.field === s.meas) || meas[0];
      const measSpec = { table: mref.table, field: mref.field, agg: s.agg || "sum" };
      if (s.kind === "kpi") {
        const r = await api.query(appId, { measures: [measSpec] });
        out.push({ ...s, value: r.value });
        numeric.push({ tipo: "total", medida: s.meas, valor: r.value });
      } else {
        const dref = dims.find((d) => d.field === s.dim);
        if (!dref) continue;
        const r = await api.query(appId, { dimension: { table: dref.table, field: dref.field }, measures: [measSpec] });
        out.push({ ...s, q: r });
        numeric.push({ tipo: "desglose", medida: s.meas, dimension: s.dim, datos: (r.labels || []).map((l, i) => ({ [l]: r.values[i] })) });
      }
    }
    // Redacta el texto de análisis (si hay sección text) con las cifras reales.
    const hasText = out.some((o) => o._text);
    if (hasText) {
      const analysis = await writeAnalysis(numeric);
      out.forEach((o) => { if (o._text) o.analysis = analysis; });
    }
    return out;
  }

  // El agente interpreta las cifras reales y redacta recomendaciones (no inventa).
  async function writeAnalysis(numeric) {
    const det = () => {
      const parts = [];
      numeric.filter((n) => n.tipo === "total").forEach((n) => parts.push(`${fieldLabel(n.medida)} total: ${NF.format(Math.round(n.valor || 0))}.`));
      numeric.filter((n) => n.tipo === "desglose").forEach((n) => {
        const ent = n.datos.map((o) => Object.entries(o)[0]);
        if (!ent.length) return;
        ent.sort((a, b) => b[1] - a[1]);
        const tot = ent.reduce((s, e) => s + (e[1] || 0), 0) || 1;
        parts.push(`Por ${fieldLabel(n.dimension)}, destaca "${ent[0][0]}" con ${NF.format(ent[0][1])} (${((ent[0][1] / tot) * 100).toFixed(1)}%).`);
      });
      return parts.join(" ");
    };
    try {
      const pregunta = "Eres un analista de BI. Con estas cifras REALES del informe, redacta 1-2 párrafos de análisis y recomendaciones accionables. No inventes cifras, usa solo las dadas. Distingue cada medida por su nombre. Español, tono ejecutivo, sin viñetas.";
      const to = new Promise((r) => setTimeout(() => r(null), 18000));
      const res = await Promise.race([api.aiAnalizar(appId, { pregunta, contexto: { cifras: numeric } }), to]);
      if (res && res.ok && res.message) return res.message.replace(/[#*`]/g, "");
    } catch {}
    return det();
  }

  async function renderPreview(spec) {
    const host = pane.querySelector("#rpPreview");
    host.innerHTML = `<p class="rp-muted" style="padding:16px;">Generando vista previa…</p>`;
    const data = await specData(spec);
    host.innerHTML = "";
    for (const s of data) {
      const box = document.createElement("div"); box.className = "rp-prev-item";
      if (s.kind === "text") {
        box.innerHTML = `<div class="rp-prev-title">${esc(s.title || "Análisis")}</div><p class="rp-prev-text">${esc(s.analysis || "(sin análisis)")}</p>`;
        host.appendChild(box);
      } else if (s.kind === "kpi") {
        box.innerHTML = `<div class="rp-prev-kpi"><span>${esc(fieldLabel(s.meas))}</span><strong>${NF.format(Math.round(s.value || 0))}</strong></div>`;
        host.appendChild(box);
      } else if (s.q && s.q.labels?.length) {
        box.innerHTML = `<div class="rp-prev-title">${esc(s.title || "")}</div>`;
        if (s.kind === "table") {
          const total = s.q.values.reduce((a, b) => a + (b || 0), 0) || 1;
          box.innerHTML += `<table class="rp-prev-table"><thead><tr><th>${esc(fieldLabel(s.dim))}</th><th>${esc(fieldLabel(s.meas))}</th><th>%</th></tr></thead><tbody>${s.q.labels.map((l, i) => `<tr><td>${esc(l)}</td><td>${NF.format(s.q.values[i])}</td><td>${((s.q.values[i]/total)*100).toFixed(1)}%</td></tr>`).join("")}</tbody></table>`;
          host.appendChild(box);
        } else {
          const cv = document.createElement("canvas"); cv.width = 440; cv.height = 240;
          box.appendChild(cv); host.appendChild(box);
          drawPreviewChart(cv, s.kind, s.q.labels, s.q.values, s.title);
        }
      }
    }
    if (!host.children.length) host.innerHTML = `<p class="rp-muted" style="padding:24px;text-align:center;">Sin datos para previsualizar.</p>`;
  }

  function drawPreviewChart(canvas, type, labels, values, title) {
    const colors = labels.map((_, i) => PALETTE[i % PALETTE.length]);
    new window.Chart(canvas, {
      type: type === "line" ? "line" : type,
      data: { labels, datasets: [{ label: title, data: values, backgroundColor: type === "pie" ? colors : "#172983", borderColor: "#172983", borderWidth: type === "line" ? 2 : 1, fill: type === "line", tension: 0.3 }] },
      options: { responsive: false, animation: false, plugins: { legend: { display: type === "pie", position: "right" } }, scales: type === "pie" ? {} : { y: { beginAtZero: true } } },
    });
  }

  async function generateFromSpec(spec, name) {
    showProgress(`Generando: ${name}`);
    try {
      let s = step("Consultando datos…");
      const data = await specData(spec);
      stepDone(s);
      s = step("Renderizando gráficas…");
      const kpis = []; const images = []; const tables = []; let narrative = "";
      for (const sec of data) {
        if (sec.kind === "text") narrative = sec.analysis || "";
        else if (sec.kind === "kpi") kpis.push({ label: fieldLabel(sec.meas), value: sec.value });
        else if (sec.q && sec.q.labels?.length) {
          if (sec.kind === "table") tables.push({ title: sec.title, q: sec.q, dimLabel: fieldLabel(sec.dim), measLabel: fieldLabel(sec.meas) });
          else { const img = await chartImage(sec.kind, sec.q.labels, sec.q.values, sec.title); images.push({ img, label: sec.title, _q: sec.q, _dimLabel: fieldLabel(sec.dim), _measLabel: fieldLabel(sec.meas) }); }
        }
      }
      stepDone(s);
      s = step("Componiendo el PDF…");
      await buildCustomPdf(name, kpis, images, tables, narrative);
      stepDone(s);
      step("Informe descargado ✓", "done"); setTimeout(hideProgress, 900);
    } catch (e) { step("Error: " + (e.message || e), "err"); setTimeout(hideProgress, 2600); }
  }

  /* ---- Compositor PDF genérico (Hojas y Chat) — nivel consultoría ---- */
  // Deriva insights de las tablas/KPIs recolectados para producir resumen en
  // una frase, hallazgos y recomendaciones, además de gráficas y tablas.
  async function buildCustomPdf(title, kpis, images, tables, narrative) {
    // Reconstruye un "data" estilo plantilla para reutilizar el motor de insights.
    const primaryTable = tables[0];
    const secondaryTable = tables[1];
    // Detecta una tabla temporal por el nombre de su dimensión.
    const timeTable = tables.find((t) => /mes|fecha|date|month|dia|año|year|anio/i.test(String(t.dimLabel || ""))) || null;
    const firstChart = images.find((im) => im._q && im._q.labels?.length);
    const timeChart = images.find((im) => im._q && /mes|fecha|date|month|dia|año|year|anio/i.test(String(im._dimLabel || "")));
    const pseudoData = {
      kpis: kpis.map((k) => ({ label: k.label, value: k.value, agg: "sum" })),
      byPrimary: primaryTable?.q || firstChart?._q || null,
      bySecondary: secondaryTable?.q || null,
      byTime: timeTable?.q || timeChart?._q || null,
    };
    const roles = {
      primaryDim: { field: primaryTable?.dimLabel || firstChart?._dimLabel || "Dimensión" },
      secondaryDim: { field: secondaryTable?.dimLabel || primaryTable?.dimLabel || firstChart?._dimLabel || "Dimensión" },
      timeDim: { field: timeTable?.dimLabel || timeChart?._dimLabel || "Periodo" },
      primaryMeas: { field: primaryTable?.measLabel || firstChart?._measLabel || (kpis[0]?.label) || "Medida" },
    };

    // Análisis especializado: resuelve las dimensiones reales (por etiqueta) y
    // calcula margen, rentabilidad, Pareto y MoM igual que las Plantillas.
    const dimObj = (label) => dims.find((d) => d.field === label || fieldLabel(d.field) === label) || null;
    const pDim = dimObj(roles.primaryDim.field);
    const sDim = dimObj(roles.secondaryDim.field);
    let spec = null;
    try {
      const bf = businessFields();
      if (bf.revenue && pDim) {
        spec = await buildSpec(bf, pDim, sDim, pseudoData.byTime);
        if (spec.totals.revenue == null) spec = null;
      }
    } catch { spec = null; }

    const haveSignal = pseudoData.byPrimary || pseudoData.byTime || kpis.length;
    let insights = null, summaryLine = "", findings = [], recommendations = [];
    if (haveSignal) {
      insights = buildInsights(pseudoData, roles);
      summaryLine = await oneLineSummary(insights, pseudoData, spec || undefined);
      findings = spec ? buildSpecializedFindings(spec, roles, insights) : buildFindings(insights, roles);
      recommendations = spec ? buildSpecializedRecommendations(spec, roles, insights) : buildRecommendations(insights, roles);
    }
    if (spec && !(narrative && String(narrative).trim())) narrative = await writeExpertNarrative(spec, roles);

    const pdf = newPdf(title);
    pdf.cover(title, summaryLine || "Informe analítico con datos reales.");
    if (insights) pdf.execSummary(summaryLine, insights);
    if (spec) pdf.metricsPanel(spec);
    if (kpis.length) pdf.kpiPanel(kpis, insights);
    if (findings.length) pdf.findings(findings);
    for (const im of images) pdf.image(im.img, im.label || "");
    for (const t of tables) pdf.table(t.title || "", t.q, t.dimLabel, t.measLabel);
    if (spec) {
      if (spec.profPrimary) pdf.profitabilityTable(spec.profPrimary, roles.primaryDim.field);
      if (spec.paretoPrimary) pdf.paretoTable(spec.paretoPrimary, roles.primaryDim.field);
      if (spec.profSecondary) pdf.profitabilityTable(spec.profSecondary, roles.secondaryDim.field);
      if (spec.mom) pdf.momTable(spec.mom, roles.timeDim.field);
    }
    if (narrative && String(narrative).trim()) pdf.prose("Análisis detallado", narrative);
    if (recommendations.length) pdf.recommendations(recommendations);
    pdf.finish(`Informe_${String(title).replace(/[^\w]+/g, "_")}_${appName.replace(/[^\w]+/g, "_")}.pdf`);
  }

  // Etiqueta de un campo respetando el display de overrides si está en /fields.
  function fieldLabel(field) {
    const all = [...dims, ...meas];
    const f = all.find((x) => x.field === field || x.display === field);
    return (f && (f.display || f.field)) || field;
  }

  return () => {};
}

/* ---------------- Preview SVG por plantilla (decorativo) ---------------- */
function previewSvg(id) {
  const B = "#172983", L = "#4a5bc4", F = "#e8ebf7";
  if (id === "exec" || id === "region" || id === "full")
    return `<svg viewBox="0 0 160 90" width="100%" height="100%"><rect width="160" height="90" fill="${F}"/>
      <rect x="10" y="10" width="40" height="14" rx="2" fill="${B}"/><rect x="56" y="10" width="40" height="14" rx="2" fill="${L}"/><rect x="102" y="10" width="40" height="14" rx="2" fill="${B}"/>
      <rect x="10" y="34" width="30" height="46" fill="${B}"/><rect x="46" y="46" width="30" height="34" fill="${L}"/><rect x="82" y="40" width="30" height="40" fill="${B}"/><rect x="118" y="56" width="30" height="24" fill="${L}"/></svg>`;
  if (id === "categoria")
    return `<svg viewBox="0 0 160 90" width="100%" height="100%"><rect width="160" height="90" fill="${F}"/>
      <circle cx="54" cy="45" r="30" fill="${B}"/><path d="M54 45 L54 15 A30 30 0 0 1 80 60 Z" fill="${L}"/>
      <rect x="96" y="24" width="52" height="8" rx="2" fill="${B}"/><rect x="96" y="40" width="40" height="8" rx="2" fill="${L}"/><rect x="96" y="56" width="46" height="8" rx="2" fill="${B}"/></svg>`;
  // tendencia
  return `<svg viewBox="0 0 160 90" width="100%" height="100%"><rect width="160" height="90" fill="${F}"/>
    <polyline points="12,70 44,52 76,58 108,30 148,20" fill="none" stroke="${B}" stroke-width="3"/>
    <circle cx="12" cy="70" r="3" fill="${B}"/><circle cx="44" cy="52" r="3" fill="${B}"/><circle cx="76" cy="58" r="3" fill="${B}"/><circle cx="108" cy="30" r="3" fill="${B}"/><circle cx="148" cy="20" r="3" fill="${B}"/></svg>`;
}
