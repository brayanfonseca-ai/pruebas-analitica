// num-format.js — Formato de presentación de medidas y dimensiones.
// Un formato es un objeto pequeño que viaja con la medida/dimensión (maestra o del gráfico):
//   { type: "auto"|"number"|"integer"|"percent"|"currency"|"unit"|"date"|"text",
//     decimals: 0-4, scale: "none"|"K"|"M"|"B"|"auto", prefix, suffix, currency: "COP"|"USD"|"EUR",
//     date: "dd/mm/aaaa"|"d mmm aaaa"|"mmm aaaa"|"aaaa-mm"|"aaaa", case: "upper"|"lower"|"title" }
// También acepta los modos antiguos en texto ("number", "integer", "percent", "money").

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const CUR = { COP: "$", USD: "US$", EUR: "€" };
const SCALE = { K: [1e3, " mil"], M: [1e6, " M"], B: [1e9, " mil M"] };

/** Preajustes: un clic deja el formato listo (luego se puede afinar). */
export const PRESETS = {
  measure: [
    { id: "auto", label: "Automático", f: { type: "auto" } },
    { id: "number", label: "Número", f: { type: "number", decimals: 2 } },
    { id: "integer", label: "Entero", f: { type: "integer", decimals: 0 } },
    { id: "percent", label: "Porcentaje", f: { type: "percent", decimals: 1 } },
    { id: "cop", label: "Pesos $", f: { type: "currency", currency: "COP", decimals: 0 } },
    { id: "usd", label: "Dólares US$", f: { type: "currency", currency: "USD", decimals: 2 } },
    { id: "eur", label: "Euros €", f: { type: "currency", currency: "EUR", decimals: 2 } },
    { id: "k", label: "Miles (mil)", f: { type: "number", scale: "K", decimals: 1 } },
    { id: "m", label: "Millones (M)", f: { type: "number", scale: "M", decimals: 1 } },
    { id: "b", label: "Miles de millones", f: { type: "number", scale: "B", decimals: 1 } },
    { id: "short", label: "Abreviado auto", f: { type: "number", scale: "auto", decimals: 1 } },
    { id: "copm", label: "$ en millones", f: { type: "currency", currency: "COP", scale: "M", decimals: 1 } },
    { id: "kg", label: "Kilos (kg)", f: { type: "unit", suffix: " kg", decimals: 1 } },
    { id: "t", label: "Toneladas (t)", f: { type: "unit", suffix: " t", decimals: 2 } },
    { id: "l", label: "Litros (L)", f: { type: "unit", suffix: " L", decimals: 1 } },
    { id: "gal", label: "Galones (gal)", f: { type: "unit", suffix: " gal", decimals: 1 } },
    { id: "km", label: "Kilómetros (km)", f: { type: "unit", suffix: " km", decimals: 1 } },
    { id: "c", label: "Grados (°C)", f: { type: "unit", suffix: " °C", decimals: 1 } },
    { id: "deg", label: "Grados (°)", f: { type: "unit", suffix: "°", decimals: 0 } },
    { id: "h", label: "Horas (h)", f: { type: "unit", suffix: " h", decimals: 1 } },
    { id: "days", label: "Días", f: { type: "unit", suffix: " días", decimals: 0 } },
    { id: "people", label: "Personas", f: { type: "unit", suffix: " personas", decimals: 0 } },
  ],
  dimension: [
    { id: "auto", label: "Tal cual", f: { type: "auto" } },
    { id: "integer", label: "Número sin decimales", f: { type: "integer", decimals: 0 } },
    { id: "plain", label: "Código (sin puntos)", f: { type: "number", decimals: 0, thousands: false } },
    { id: "cop", label: "Pesos $", f: { type: "currency", currency: "COP", decimals: 0 } },
    { id: "d1", label: "Fecha 31/12/2026", f: { type: "date", date: "dd/mm/aaaa" } },
    { id: "d2", label: "31 dic 2026", f: { type: "date", date: "d mmm aaaa" } },
    { id: "d3", label: "dic 2026", f: { type: "date", date: "mmm aaaa" } },
    { id: "d4", label: "2026-12", f: { type: "date", date: "aaaa-mm" } },
    { id: "d5", label: "Solo el año", f: { type: "date", date: "aaaa" } },
    { id: "up", label: "MAYÚSCULAS", f: { type: "text", case: "upper" } },
    { id: "low", label: "minúsculas", f: { type: "text", case: "lower" } },
    { id: "title", label: "Tipo Título", f: { type: "text", case: "title" } },
  ],
};

const LEGACY = { number: { type: "number", decimals: 2 }, integer: { type: "integer", decimals: 0 }, percent: { type: "percent", decimals: 1 }, money: { type: "currency", currency: "USD", decimals: 2 } };

/** Normaliza: string antiguo → objeto; vacío/auto → null. */
export function normFormat(f) {
  if (!f) return null;
  if (typeof f === "string") return f === "auto" ? null : LEGACY[f] || null;
  if (typeof f === "object" && (!f.type || f.type === "auto") && !f.prefix && !f.suffix) return null;
  return f;
}

const nf = (d, grouping = true) => new Intl.NumberFormat("es-CO", { minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: grouping });
const autoNf = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 });

function toNum(v) {
  if (typeof v === "number") return v;
  if (v == null) return NaN;
  const s = String(v).trim();
  if (!/^-?[\d.,]+$/.test(s)) return NaN;
  // «1.234,5» (es) o «1234.5» (motor)
  const n = /,\d+$/.test(s) && /\./.test(s) ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  return Number(n);
}

function toDate(v) {
  if (v instanceof Date) return v;
  const s = String(v ?? "").trim();
  let m = s.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3] || 1));
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  return null;
}

/** Formatea un valor. Sin formato (o «auto») = 1.234,56. Texto que no es número se devuelve tal cual. */
export function formatValue(v, fmt) {
  const f = normFormat(fmt);
  if (v === null || v === undefined || (typeof v === "number" && Number.isNaN(v))) return "-";
  if (!f) return typeof v === "number" ? autoNf.format(v) : String(v);
  if (f.type === "text") {
    const s = String(v);
    return f.case === "upper" ? s.toUpperCase() : f.case === "lower" ? s.toLowerCase() : f.case === "title" ? s.toLowerCase().replace(/(^|[\s\-/])(\p{L})/gu, (a, b, c) => b + c.toUpperCase()) : s;
  }
  if (f.type === "date") {
    const d = toDate(v);
    if (!d || isNaN(d)) return String(v);
    const dd = String(d.getDate()).padStart(2, "0"), mm = String(d.getMonth() + 1).padStart(2, "0"), yy = d.getFullYear();
    switch (f.date) {
      case "d mmm aaaa": return `${d.getDate()} ${MONTHS[d.getMonth()]} ${yy}`;
      case "mmm aaaa": return `${MONTHS[d.getMonth()]} ${yy}`;
      case "aaaa-mm": return `${yy}-${mm}`;
      case "aaaa": return String(yy);
      default: return `${dd}/${mm}/${yy}`;
    }
  }
  let n = toNum(v);
  if (Number.isNaN(n)) return String(v);
  const dec = Math.max(0, Math.min(4, Number.isFinite(Number(f.decimals)) ? Number(f.decimals) : (f.type === "integer" ? 0 : 2)));
  let suffix = f.suffix || "";
  let pre = f.prefix || "";
  if (f.type === "percent") { n = Math.abs(n) > 1.5 ? n : n * 100; suffix = suffix || " %"; }
  let sc = f.scale;
  if (sc === "auto") { const a = Math.abs(n); sc = a >= 1e9 ? "B" : a >= 1e6 ? "M" : a >= 1e3 ? "K" : "none"; }
  if (SCALE[sc]) { n = n / SCALE[sc][0]; suffix = SCALE[sc][1] + suffix; }
  if (f.type === "currency") pre = pre || (CUR[f.currency || "COP"] || "$") + " ";
  const body = nf(f.type === "integer" ? 0 : dec, f.thousands !== false).format(n);
  return pre + body + suffix;
}

/** Texto corto que describe el formato («$ en millones · 1 decimal»). */
export function describeFormat(fmt, kind = "measure") {
  const f = normFormat(fmt);
  if (!f) return kind === "dimension" ? "Tal cual" : "Automático";
  const p = [...PRESETS.measure, ...PRESETS.dimension].find((x) => JSON.stringify(x.f) === JSON.stringify(f));
  if (p) return p.label;
  return formatValue(kind === "dimension" && f.type === "date" ? "2026-12-31" : 1234567.891, f);
}

/**
 * Panel de formato (para incrustar al lado del editor o en un popover).
 * @param {HTMLElement} host
 * @param {{kind?: "measure"|"dimension", value?: object|string, sample?: any, onChange: (fmt|null) => void}} o
 */
export function mountFormatPanel(host, o) {
  const kind = o.kind === "dimension" ? "dimension" : "measure";
  let f = normFormat(o.value) ? { ...normFormat(o.value) } : { type: "auto" };
  const sampleOf = () => {
    if (o.sample != null && o.sample !== "") return o.sample;
    if (kind === "dimension") return f.type === "date" ? "2026-12-31" : f.type === "text" ? "cali norte" : 20261;
    return 6000000.6156;
  };
  const paint = () => {
    const isNum = !["date", "text", "auto"].includes(f.type);
    const sample = sampleOf();
    host.innerHTML = `
      <div class="nfp">
        <div class="nfp-prev"><span>${esc(typeof sample === "number" ? autoNf.format(sample) : sample)}</span><i>→</i><b>${esc(formatValue(sample, f))}</b></div>
        <div class="nfp-chips">${PRESETS[kind].map((p) => `<button type="button" class="nfp-chip ${JSON.stringify(p.f) === JSON.stringify(f) || (p.id === "auto" && f.type === "auto") ? "on" : ""}" data-p="${p.id}">${esc(p.label)}</button>`).join("")}</div>
        ${isNum ? `
        <div class="nfp-row">
          <label>Decimales<span class="nfp-seg">${[0, 1, 2, 3].map((d) => `<button type="button" data-dec="${d}" class="${Number(f.decimals ?? 2) === d ? "on" : ""}">${d}</button>`).join("")}</span></label>
          <label>Escala<select data-k="scale">${[["none", "Sin escala"], ["K", "Miles (mil)"], ["M", "Millones (M)"], ["B", "Miles de millones"], ["auto", "Automática"]].map(([v, l]) => `<option value="${v}" ${(f.scale || "none") === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>
        </div>
        <div class="nfp-row">
          <label>Antes<input data-k="prefix" maxlength="8" value="${esc(f.prefix || "")}" placeholder="${f.type === "currency" ? esc(CUR[f.currency || "COP"]) : "p. ej. $"}"/></label>
          <label>Después<input data-k="suffix" maxlength="12" value="${esc(f.suffix || "")}" placeholder="p. ej. kg, L, °C"/></label>
          <label class="nfp-chk"><input type="checkbox" data-k="thousands" ${f.thousands === false ? "" : "checked"}/> Separador de miles</label>
        </div>` : ""}
      </div>`;
    host.querySelectorAll("[data-p]").forEach((b) => b.addEventListener("click", () => {
      const p = PRESETS[kind].find((x) => x.id === b.dataset.p);
      f = { ...p.f }; emit(); paint();
    }));
    host.querySelectorAll("[data-dec]").forEach((b) => b.addEventListener("click", () => {
      if (f.type === "auto") f.type = "number";
      f.decimals = Number(b.dataset.dec); if (f.type === "integer" && f.decimals > 0) f.type = "number"; emit(); paint();
    }));
    host.querySelectorAll("[data-k]").forEach((el) => el.addEventListener(el.type === "checkbox" || el.tagName === "SELECT" ? "change" : "input", () => {
      const k = el.dataset.k;
      if (f.type === "auto") f.type = "number";
      if (k === "thousands") f.thousands = el.checked ? undefined : false;
      else if (k === "scale") f.scale = el.value === "none" ? undefined : el.value;
      else f[k] = el.value || undefined;
      if (k === "suffix" && f.type === "number" && el.value) f.type = "unit";
      emit();
      host.querySelector(".nfp-prev b").textContent = formatValue(sampleOf(), f);
      host.querySelectorAll("[data-p]").forEach((b) => b.classList.remove("on"));
      if (el.tagName === "SELECT" || el.type === "checkbox") paint();
    }));
  };
  const emit = () => { const clean = Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined && v !== "")); o.onChange(normFormat(clean) ? clean : null); };
  paint();
  return { get: () => normFormat(f), setSample: (s) => { o.sample = s; paint(); } };
}
