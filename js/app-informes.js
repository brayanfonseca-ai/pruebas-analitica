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
const BRAND = [23, 41, 131];       // #172983
const BRAND_DARK = [16, 29, 94];   // #101d5e
const INK = [27, 31, 36];
const MUTED = [107, 114, 128];

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

  mount.innerHTML = `
    <div class="q-subtoolbar">
      <div class="rp-head">
        <div>
          <h2 class="rp-title">Generador de informes</h2>
          <p class="rp-muted">Elige una plantilla y genera un PDF profesional con tus datos reales. Sin configurar nada.</p>
        </div>
      </div>
    </div>
    <div class="rp-wrap">
      ${!ready ? `<div class="rp-empty"><p>Esta aplicación aún no tiene datos cargados.</p>
        <p class="rp-muted">Carga un archivo en el Editor de carga para poder generar informes.</p></div>`
      : `<div class="rp-gallery" id="rpGallery"></div>`}
    </div>
    <div class="rp-progress-backdrop" id="rpProg" hidden>
      <div class="rp-progress">
        <div class="rp-progress-head"><span class="rp-progress-spin"></span><strong id="rpProgTitle">Generando informe…</strong></div>
        <div class="rp-progress-steps" id="rpProgSteps"></div>
      </div>
    </div>
    <!-- canvas ocultos para renderizar gráficas que van al PDF -->
    <div id="rpCanvasHost" style="position:fixed;left:-99999px;top:0;width:900px;"></div>`;

  if (!ready) return () => {};

  const gallery = mount.querySelector("#rpGallery");
  gallery.innerHTML = TEMPLATES.map((t) => `
    <article class="rp-card" data-tpl="${t.id}">
      <div class="rp-card-preview">${previewSvg(t.id)}</div>
      <div class="rp-card-ico">${t.icon}</div>
      <h3 class="rp-card-title">${esc(t.name)}</h3>
      <p class="rp-card-desc">${esc(t.desc)}</p>
      <button class="q-btn primary rp-card-btn" data-tpl="${t.id}">Generar PDF</button>
    </article>`).join("");

  gallery.querySelectorAll(".rp-card-btn").forEach((b) =>
    b.addEventListener("click", () => generate(TEMPLATES.find((t) => t.id === b.dataset.tpl))));

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
    const primaryDim = dims[0];
    const secondaryDim = dims[1] || dims[0];
    const timeDim = dims.find((d) => /mes|fecha|date|month|dia|año|year/i.test(d.field)) || dims[dims.length - 1];
    const primaryMeas = meas[0];

    try {
      // 1) Datos reales
      let s = step("Consultando datos del motor…");
      const data = await gatherData(tpl, { primaryDim, secondaryDim, timeDim, primaryMeas });
      stepDone(s);

      // 2) Gráficas
      s = step("Renderizando gráficas…");
      const images = await renderCharts(tpl, data, { primaryDim, secondaryDim, timeDim, primaryMeas });
      stepDone(s);

      // 3) Análisis narrativo (agente redacta, no aconseja)
      s = step("Redactando el análisis…");
      const narrative = await writeNarrative(tpl, data, { primaryDim, secondaryDim, timeDim, primaryMeas });
      stepDone(s);

      // 4) Componer PDF
      s = step("Componiendo el PDF…");
      await buildPdf(tpl, data, images, narrative, { primaryDim, secondaryDim, timeDim, primaryMeas });
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
    // KPIs: suma de cada medida (y promedio de la primera como "ticket")
    for (const m of meas) {
      const r = await api.query(appId, { measures: [{ table: m.table, field: m.field, agg: "sum" }] });
      d.kpis.push({ label: m.field, value: r.value, agg: "sum" });
    }
    if (meas[0]) {
      const avg = await api.query(appId, { measures: [{ table: meas[0].table, field: meas[0].field, agg: "avg" }] });
      d.kpis.push({ label: `${meas[0].field} (promedio)`, value: avg.value, agg: "avg" });
    }
    const m0 = meas[0];
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

  /* ---------------- Composición del PDF ---------------- */
  async function buildPdf(tpl, data, images, narrative, roles) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const W = doc.internal.pageSize.getWidth();
    const H = doc.internal.pageSize.getHeight();
    const M = 48;
    let y = 0;

    const footer = () => {
      const pages = doc.internal.getNumberOfPages();
      for (let i = 1; i <= pages; i++) {
        doc.setPage(i);
        doc.setFontSize(8); doc.setTextColor(...MUTED);
        doc.text(`DataSense · ${appName}`, M, H - 20);
        doc.text(`Página ${i} de ${pages}`, W - M, H - 20, { align: "right" });
      }
    };
    const ensure = (need) => { if (y + need > H - 60) { doc.addPage(); y = M; } };
    const heading = (txt) => {
      ensure(40); doc.setFontSize(14); doc.setTextColor(...BRAND_DARK); doc.setFont(undefined, "bold");
      doc.text(txt, M, y); y += 8; doc.setDrawColor(...BRAND); doc.setLineWidth(2); doc.line(M, y, M + 60, y);
      y += 20; doc.setFont(undefined, "normal"); doc.setTextColor(...INK);
    };
    const addImage = (img, label) => {
      if (!img) return;
      if (label) { heading(label); }
      const w = W - M * 2; const h = w * (380 / 820);
      ensure(h + 10);
      doc.addImage(img, "PNG", M, y, w, h); y += h + 22;
    };

    // ---- Portada ----
    doc.setFillColor(...BRAND); doc.rect(0, 0, W, 180, "F");
    doc.setFillColor(...BRAND_DARK); doc.rect(0, 170, W, 10, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(12); doc.text("DataSense · Informe analítico", M, 70);
    doc.setFontSize(26); doc.setFont(undefined, "bold"); doc.text(tpl.name, M, 110);
    doc.setFont(undefined, "normal"); doc.setFontSize(13);
    doc.text(appName, M, 138);
    doc.setFontSize(10);
    doc.text(new Date().toLocaleString("es-CO"), M, 158);
    y = 215;

    // ---- KPIs ----
    if (tpl.sections.includes("kpis")) {
      heading("Indicadores clave");
      const kpis = data.kpis;
      const cols = Math.min(3, kpis.length);
      const cardW = (W - M * 2 - (cols - 1) * 12) / cols;
      let cx = M, rowH = 70, maxInRow = cols, count = 0;
      ensure(rowH + 6);
      kpis.forEach((k) => {
        if (count > 0 && count % maxInRow === 0) { y += rowH + 12; cx = M; ensure(rowH + 6); }
        doc.setFillColor(244, 246, 251); doc.setDrawColor(224, 228, 240);
        doc.roundedRect(cx, y, cardW, rowH, 6, 6, "FD");
        doc.setFontSize(9); doc.setTextColor(...MUTED);
        doc.text(String(k.label).toUpperCase(), cx + 12, y + 20, { maxWidth: cardW - 24 });
        doc.setFontSize(18); doc.setTextColor(...BRAND_DARK); doc.setFont(undefined, "bold");
        doc.text(NF.format(Math.round(k.value || 0)), cx + 12, y + 46);
        doc.setFont(undefined, "normal");
        cx += cardW + 12; count++;
      });
      y += rowH + 24;
    }

    // ---- Gráficas según plantilla ----
    const labelFor = {
      bar_primary: `${roles.primaryMeas.field} por ${roles.primaryDim.field}`,
      pie_primary: `Participación por ${roles.primaryDim.field}`,
      pie_secondary: `Participación por ${roles.secondaryDim.field}`,
      bar_secondary: `${roles.primaryMeas.field} por ${roles.secondaryDim.field}`,
      trend: `Tendencia de ${roles.primaryMeas.field}`,
    };
    for (const sec of tpl.sections) {
      if (images[sec]) addImage(images[sec], labelFor[sec]);
    }

    // ---- Tablas ----
    const addTable = (title, q, dimLabel) => {
      if (!q?.labels?.length) return;
      heading(title);
      const total = q.values.reduce((a, b) => a + (b || 0), 0) || 1;
      const rows = q.labels.map((l, i) => [l, NF.format(q.values[i]), ((q.values[i] / total) * 100).toFixed(1) + "%"]);
      rows.push(["TOTAL", NF.format(total), "100%"]);
      doc.autoTable({
        startY: y, margin: { left: M, right: M },
        head: [[dimLabel, roles.primaryMeas.field, "% del total"]],
        body: rows,
        headStyles: { fillColor: BRAND, textColor: 255, fontStyle: "bold" },
        alternateRowStyles: { fillColor: [244, 246, 251] },
        styles: { fontSize: 10, cellPadding: 6 },
        didParseCell: (d) => { if (d.row.index === rows.length - 1) { d.cell.styles.fontStyle = "bold"; d.cell.styles.fillColor = [232, 235, 247]; } },
      });
      y = doc.lastAutoTable.finalY + 24;
    };
    if (tpl.sections.includes("table_primary")) addTable(`Detalle por ${roles.primaryDim.field}`, data.byPrimary, roles.primaryDim.field);
    if (tpl.sections.includes("table_secondary")) addTable(`Detalle por ${roles.secondaryDim.field}`, data.bySecondary, roles.secondaryDim.field);
    if (tpl.sections.includes("trend_table")) addTable(`Detalle por ${roles.timeDim.field}`, data.byTime, roles.timeDim.field);

    // ---- Análisis narrativo ----
    if (tpl.sections.includes("analysis") && narrative) {
      heading("Análisis");
      doc.setFontSize(11); doc.setTextColor(...INK);
      const clean = String(narrative).replace(/[#*`]/g, "").replace(/\r/g, "");
      const lines = doc.splitTextToSize(clean, W - M * 2);
      lines.forEach((ln) => { ensure(16); doc.text(ln, M, y); y += 16; });
    }

    footer();
    const fname = `Informe_${tpl.name.replace(/[^\w]+/g, "_")}_${appName.replace(/[^\w]+/g, "_")}.pdf`;
    doc.save(fname);
  }

  /* ---------------- helpers ---------------- */
  function zip(labels, values) { return (labels || []).map((l, i) => ({ label: l, valor: values[i] })); }
  function topOf(q) {
    let bi = 0; for (let i = 1; i < q.values.length; i++) if (q.values[i] > q.values[bi]) bi = i;
    const total = q.values.reduce((a, b) => a + (b || 0), 0) || 1;
    return { label: q.labels[bi], value: q.values[bi], pct: ((q.values[bi] / total) * 100).toFixed(1) };
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
