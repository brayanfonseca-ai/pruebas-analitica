// estrellita.js — widget flotante del asistente de IA de DataSense (FEAT-002).
//
// Un botón flotante (estrella) + un panel de chat moderno (estilo Copilot/Gemini)
// que cambia de personalidad según el contexto donde se monta (ingeniero de datos,
// analista, diseñador). SOLO AÑADE nodos propios (clases prefijadas star-); no toca
// el layout existente. Posicionamiento fixed.
//
// Novedades de este rediseño (solo frontend, contrato intacto):
//   · Rediseño visual moderno (FAB con glow/anillo, panel pulido, burbujas claras).
//   · Render Markdown MÍNIMO y SEGURO de las respuestas del asistente (escapa HTML
//     primero; nunca inyecta texto del modelo sin sanear).
//   · Botón "Ampliar" junto a la X: alterna PANTALLA COMPLETA (overlay fixed).
//   · HISTORIAL DE SESIONES tipo ChatGPT (CRUD) visible SOLO en pantalla completa,
//     persistido en localStorage namespaced por app + persona.
//
// Contrato de los endpoints (FEAT-001): sendFn(appId, {pregunta, contexto})
// devuelve {ok, message, agent}. Si ok===false o la promesa rechaza, el panel
// degrada con un mensaje de error claro sin romper nada.
//
// Contrato de montaje (CONSUMIDO por app-editor.js y app-hoja.js, NO CAMBIAR):
//   const cleanup = mountEstrellita(opts);  // cleanup() desmonta
//   cleanup.setPersona({persona, title, greeting, buildContext, sendFn});

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const STAR_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l2.9 6.26L21.5 9.3l-4.75 4.64L17.9 21 12 17.52 6.1 21l1.15-7.06L2.5 9.3l6.6-1.04z"/></svg>`;
const ICON_EXPAND = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/></svg>`;
const ICON_COLLAPSE = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14h6v6"/><path d="M20 10h-6V4"/><path d="M14 10l7-7"/><path d="M3 21l7-7"/></svg>`;
const ICON_SEND = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7z"/></svg>`;
const ICON_PLUS = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>`;
const ICON_EDIT = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>`;
const ICON_TRASH = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>`;

const uid = () => "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// Etiqueta del botón de acción según el tipo de plan devuelto por el backend.
function actionLabel(kind) {
  if (kind === "build-sheet") return "Crear dashboard";
  if (kind === "add-objects") return "Crear gráfico";
  if (kind === "apply-script") return "Aplicar script";
  return "Ejecutar acción";
}

/* ============================================================================
   Render Markdown MÍNIMO y SEGURO.
   Estrategia: escapamos TODO el HTML primero, y solo DESPUÉS reemplazamos los
   marcadores Markdown por etiquetas seguras. Así el texto del modelo nunca
   inyecta HTML arbitrario (evita XSS). Los bloques de código preservan su texto
   escapado tal cual (sin interpretar negritas dentro). Soporta: encabezados,
   negrita/cursiva, listas (ordenadas y no), bloques ``` y código `inline`.
   ========================================================================== */
function renderMarkdown(src) {
  const text = String(src ?? "");

  // 1) Extraer bloques de código ``` para no procesarlos como Markdown.
  const blocks = [];
  let work = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const i = blocks.length;
    blocks.push(`<pre class="star-code"><code>${esc(code.replace(/\n$/, ""))}</code></pre>`);
    return `\u0000BLOCK${i}\u0000`;
  });

  // 2) Escapar el resto del HTML.
  work = esc(work);

  // 3) Inline: código `...`, negrita **...**, cursiva *...* / _..._.
  const inline = (s) => s
    .replace(/`([^`]+)`/g, (_, c) => `<code class="star-icode">${c}</code>`)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*(?!\s)([^*]+?)\*(?!\*)/g, "$1<em>$2</em>")
    .replace(/(^|[^_\w])_(?!\s)([^_]+?)_(?![_\w])/g, "$1<em>$2</em>");

  // 4) Procesar por líneas: encabezados, listas y párrafos.
  const lines = work.split("\n");
  const out = [];
  let list = null; // 'ul' | 'ol' | null
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };

  for (let raw of lines) {
    const line = raw;
    if (/^\s*$/.test(line)) { closeList(); continue; }

    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      closeList();
      const lvl = h[1].length;
      out.push(`<h${lvl} class="star-h star-h${lvl}">${inline(h[2].trim())}</h${lvl}>`);
      continue;
    }

    const ol = line.match(/^\s*\d+\.\s+(.*)$/);
    if (ol) {
      if (list !== "ol") { closeList(); out.push('<ol class="star-ol">'); list = "ol"; }
      out.push(`<li>${inline(ol[1].trim())}</li>`);
      continue;
    }

    const ul = line.match(/^\s*[-*+]\s+(.*)$/);
    if (ul) {
      if (list !== "ul") { closeList(); out.push('<ul class="star-ul">'); list = "ul"; }
      out.push(`<li>${inline(ul[1].trim())}</li>`);
      continue;
    }

    closeList();
    out.push(`<p>${inline(line.trim())}</p>`);
  }
  closeList();

  // 5) Reinsertar los bloques de código (ya escapados).
  let html = out.join("");
  html = html.replace(/\u0000BLOCK(\d+)\u0000/g, (_, i) => blocks[Number(i)] || "");
  return html;
}

/* ============================================================================
   Persistencia de conversaciones (localStorage), namespaced por app + persona.
   Clave: "ds.ai.chats.<appId>.<personaKey>". Robusto ante JSON corrupto.
   ========================================================================== */
function personaKey(persona) {
  return String(persona || "general").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "general";
}

function storeKey(appId, persona) {
  return `ds.ai.chats.${appId || "app"}.${personaKey(persona)}`;
}

function loadStore(appId, persona) {
  try {
    const raw = localStorage.getItem(storeKey(appId, persona));
    if (!raw) return { chats: [], activeId: null };
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.chats)) return { chats: [], activeId: null };
    // Saneo defensivo de la forma.
    data.chats = data.chats
      .filter((c) => c && typeof c === "object")
      .map((c) => ({
        id: String(c.id || uid()),
        title: typeof c.title === "string" ? c.title : "Conversación",
        persona: typeof c.persona === "string" ? c.persona : (persona || ""),
        createdAt: Number(c.createdAt) || Date.now(),
        updatedAt: Number(c.updatedAt) || Date.now(),
        messages: Array.isArray(c.messages)
          ? c.messages
              .filter((m) => m && (m.role === "user" || m.role === "assistant" || m.role === "error"))
              .map((m) => ({ role: m.role, text: String(m.text ?? "") }))
          : [],
      }));
    return { chats: data.chats, activeId: data.activeId || null };
  } catch {
    return { chats: [], activeId: null }; // corrupto → degrada a vacío
  }
}

function saveStore(appId, persona, store) {
  try {
    localStorage.setItem(storeKey(appId, persona), JSON.stringify(store));
  } catch {
    /* cuota llena o storage no disponible: no romper el chat */
  }
}

/**
 * Monta la estrellita. Devuelve una función de limpieza que elimina los nodos
 * y los listeners creados. La función expone .setPersona(...) (contrato estable).
 *
 * @param {Object} opts
 * @param {string} opts.appId
 * @param {string} opts.persona
 * @param {string} opts.title
 * @param {string} [opts.greeting]
 * @param {() => object} opts.buildContext
 * @param {(appId:string, payload:object) => Promise} opts.sendFn
 * @param {HTMLElement} [opts.mountInto]
 * @returns {() => void} limpieza (con .setPersona)
 */
export function mountEstrellita(opts) {
  const state = {
    appId: opts.appId,
    persona: opts.persona || "",
    title: opts.title || "Asistente",
    greeting: opts.greeting || "Hola, soy tu asistente. ¿En qué te ayudo?",
    buildContext: typeof opts.buildContext === "function" ? opts.buildContext : () => ({}),
    sendFn: opts.sendFn,
    // Callback OPCIONAL para EJECUTAR el plan de acciones que devuelve el backend
    // (FEAT-002). Solo lo recibe el diseñador (hoja en edición) y el ingeniero
    // (editor de carga); el analista NO lo recibe (solo lectura).
    onAction: typeof opts.onAction === "function" ? opts.onAction : null,
  };
  const host = opts.mountInto || document.body;
  let open = false;
  let busy = false;
  let full = false;

  // Estado de conversaciones para la persona actual.
  let store = loadStore(state.appId, state.persona);
  let activeId = null; // conversación cargada en el hilo visible

  // ----- Botón flotante -----
  const fab = document.createElement("button");
  fab.type = "button";
  fab.className = "star-fab";
  fab.setAttribute("aria-label", `Abrir asistente: ${state.title}`);
  fab.setAttribute("title", state.title);
  fab.innerHTML = `<span class="star-fab-ring" aria-hidden="true"></span><span class="star-fab-ico">${STAR_SVG}</span>`;

  // ----- Panel -----
  const panel = document.createElement("div");
  panel.className = "star-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", state.title);
  panel.setAttribute("aria-modal", "false");
  panel.hidden = true;
  panel.innerHTML = `
    <aside class="star-sidebar" aria-label="Historial de conversaciones">
      <button type="button" class="star-new">${ICON_PLUS}<span>Nueva conversación</span></button>
      <div class="star-chats" role="list"></div>
    </aside>
    <div class="star-main">
      <div class="star-head">
        <span class="star-head-star" aria-hidden="true">${STAR_SVG}</span>
        <span class="star-head-text">
          <span class="star-title"></span>
          <span class="star-persona"></span>
        </span>
        <button type="button" class="star-expand" aria-label="Pantalla completa" aria-pressed="false">${ICON_EXPAND}</button>
        <button type="button" class="star-close" aria-label="Cerrar">✕</button>
      </div>
      <div class="star-body" aria-live="polite"></div>
      <div class="star-input">
        <textarea class="star-textarea" rows="1" placeholder="Escribe tu pregunta…" aria-label="Tu pregunta"></textarea>
        <button type="button" class="star-send" aria-label="Enviar">${ICON_SEND}</button>
      </div>
    </div>`;

  const titleEl = panel.querySelector(".star-title");
  const personaEl = panel.querySelector(".star-persona");
  const body = panel.querySelector(".star-body");
  const textarea = panel.querySelector(".star-textarea");
  const sendBtn = panel.querySelector(".star-send");
  const closeBtn = panel.querySelector(".star-close");
  const expandBtn = panel.querySelector(".star-expand");
  const newBtn = panel.querySelector(".star-new");
  const chatsEl = panel.querySelector(".star-chats");

  function syncHeader() {
    titleEl.textContent = state.title;
    personaEl.textContent = ""; // sin subtítulo de "Personalidad"; el título ya indica el rol
    const label = state.title || "Asistente";
    fab.setAttribute("aria-label", `Abrir ${label}`);
    fab.setAttribute("title", label);
    panel.setAttribute("aria-label", label);
  }

  function persist() { saveStore(state.appId, state.persona, store); }

  function activeChat() { return store.chats.find((c) => c.id === activeId) || null; }

  function titleFrom(text) {
    const t = String(text || "").replace(/\s+/g, " ").trim();
    if (!t) return "Nueva conversación";
    return t.length > 42 ? t.slice(0, 42) + "…" : t;
  }

  // ----- Render de mensajes -----
  function addMsgNode(kind, text) {
    const div = document.createElement("div");
    div.className = `star-msg star-${kind}`;
    if (kind === "assistant") {
      div.innerHTML = `<div class="star-md">${renderMarkdown(text)}</div>`;
    } else {
      div.textContent = text; // usuario y error: texto plano/escapado
    }
    body.appendChild(div);
    body.scrollTop = body.scrollHeight;
    return div;
  }

  // Dibuja el botón de acción bajo un mensaje del asistente. Al pulsarlo se
  // deshabilita, se ejecuta state.onAction(action) y el resultado (o error) se
  // añade al hilo como un mensaje más (queda en el historial).
  function renderActionButton(afterNode, action) {
    const wrap = document.createElement("div");
    wrap.className = "star-action";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "star-action-btn";
    btn.textContent = actionLabel(action.kind);
    wrap.appendChild(btn);
    if (afterNode && afterNode.parentNode === body) body.appendChild(wrap);
    else body.appendChild(wrap);
    body.scrollTop = body.scrollHeight;

    btn.addEventListener("click", async () => {
      if (btn.disabled) return;
      btn.disabled = true;
      btn.classList.add("busy");
      try {
        const feedback = await state.onAction(action);
        const msg = (typeof feedback === "string" && feedback.trim())
          ? feedback.trim()
          : "Acción aplicada.";
        addMsgNode("assistant", msg);
        pushMessage("assistant", msg);
      } catch (err) {
        const msg = `No se pudo aplicar la acción. ${err?.message || ""}`.trim();
        addMsgNode("error", msg);
        pushMessage("error", msg);
      }
    });
  }

  function addThinking() {
    const div = document.createElement("div");
    div.className = "star-msg star-assistant star-thinking";
    div.innerHTML = `<span class="star-dots"><i></i><i></i><i></i></span>`;
    body.appendChild(div);
    body.scrollTop = body.scrollHeight;
    return div;
  }

  // Vuelca una conversación completa en el cuerpo. Muestra el saludo inicial solo
  // cuando el hilo está vacío (nuevo); al recargar uno existente NO lo repite.
  function renderThread() {
    body.innerHTML = "";
    const chat = activeChat();
    const msgs = chat ? chat.messages : [];
    if (!msgs.length) {
      addMsgNode("assistant", state.greeting);
    } else {
      for (const m of msgs) addMsgNode(m.role, m.text);
    }
    body.scrollTop = body.scrollHeight;
  }

  function fmtDate(ts) {
    try { return new Date(ts).toLocaleDateString("es-CO", { day: "2-digit", month: "short" }); }
    catch { return ""; }
  }

  function renderChatList() {
    const list = [...store.chats].sort((a, b) => b.updatedAt - a.updatedAt);
    if (!list.length) {
      chatsEl.innerHTML = `<p class="star-chats-empty">Sin conversaciones todavía.</p>`;
      return;
    }
    chatsEl.innerHTML = list.map((c) => `
      <div class="star-chat ${c.id === activeId ? "active" : ""}" data-id="${esc(c.id)}" role="listitem">
        <button type="button" class="star-chat-open" title="${esc(c.title)}">
          <span class="star-chat-title">${esc(c.title)}</span>
          <span class="star-chat-date">${esc(fmtDate(c.updatedAt))}</span>
        </button>
        <span class="star-chat-acts">
          <button type="button" class="star-chat-ico" data-act="rename" aria-label="Renombrar conversación" title="Renombrar">${ICON_EDIT}</button>
          <button type="button" class="star-chat-ico" data-act="delete" aria-label="Eliminar conversación" title="Eliminar">${ICON_TRASH}</button>
        </span>
      </div>`).join("");
  }

  // ----- CRUD de conversaciones -----
  function newChat() {
    activeId = null; // no persiste hasta el primer mensaje
    renderThread();
    renderChatList();
    if (open) setTimeout(() => textarea.focus(), 0);
  }

  function selectChat(id) {
    if (id === activeId) return;
    activeId = id;
    store.activeId = id;
    persist();
    renderThread();
    renderChatList();
  }

  function renameChat(id) {
    const chat = store.chats.find((c) => c.id === id);
    if (!chat) return;
    const next = prompt("Nuevo nombre de la conversación:", chat.title);
    if (next === null) return;
    const t = next.trim();
    if (!t) return;
    chat.title = t.length > 60 ? t.slice(0, 60) : t;
    chat.updatedAt = Date.now();
    persist();
    renderChatList();
  }

  function deleteChat(id) {
    const chat = store.chats.find((c) => c.id === id);
    if (!chat) return;
    if (!confirm(`¿Eliminar la conversación "${chat.title}"? Esta acción no se puede deshacer.`)) return;
    store.chats = store.chats.filter((c) => c.id !== id);
    if (activeId === id) { activeId = null; store.activeId = null; renderThread(); }
    persist();
    renderChatList();
  }

  // Garantiza que exista una conversación activa (la crea al primer mensaje).
  function ensureChat(firstUserText) {
    let chat = activeChat();
    if (!chat) {
      chat = {
        id: uid(),
        title: titleFrom(firstUserText),
        persona: state.persona,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: [],
      };
      store.chats.push(chat);
      activeId = chat.id;
      store.activeId = chat.id;
    }
    return chat;
  }

  function pushMessage(role, text) {
    const chat = ensureChat(role === "user" ? text : "");
    chat.messages.push({ role, text: String(text ?? "") });
    chat.updatedAt = Date.now();
    persist();
  }

  // ----- Fullscreen -----
  function applyFull() {
    panel.classList.toggle("star-full", full);
    document.body.classList.toggle("star-fullscreen-lock", full && open);
    expandBtn.innerHTML = full ? ICON_COLLAPSE : ICON_EXPAND;
    expandBtn.setAttribute("aria-label", full ? "Contraer" : "Pantalla completa");
    expandBtn.setAttribute("aria-pressed", String(full));
    panel.setAttribute("aria-modal", String(full));
    if (full) renderChatList();
  }
  function toggleFull() { full = !full; applyFull(); if (open) setTimeout(() => textarea.focus(), 0); }

  // ----- Abrir / cerrar -----
  function openPanel() {
    open = true;
    panel.hidden = false;
    fab.classList.add("star-hidden");
    // Al abrir, muestra la última conversación activa de esta persona si existe.
    if (activeId === null && store.activeId && store.chats.some((c) => c.id === store.activeId)) {
      activeId = store.activeId;
    }
    renderThread();
    renderChatList();
    applyFull();
    setTimeout(() => textarea.focus(), 0);
  }
  function closePanel() {
    open = false;
    panel.hidden = true;
    document.body.classList.remove("star-fullscreen-lock");
    fab.classList.remove("star-hidden");
    fab.focus();
  }

  // ----- Autosize del textarea -----
  function autosize() {
    textarea.style.height = "auto";
    textarea.style.height = Math.min(textarea.scrollHeight, 160) + "px";
  }

  async function send() {
    if (busy) return;
    const pregunta = textarea.value.trim();
    if (!pregunta) { textarea.focus(); return; }

    pushMessage("user", pregunta);
    addMsgNode("user", pregunta);
    renderChatList();

    textarea.value = "";
    autosize();
    busy = true;
    sendBtn.disabled = true;
    const thinking = addThinking();

    let contexto = {};
    try { contexto = (await state.buildContext()) || {}; } catch { contexto = {}; }

    try {
      if (typeof state.sendFn !== "function") throw new Error("Asistente no configurado.");
      const result = await state.sendFn(state.appId, { pregunta, contexto });
      thinking.remove();
      if (result && result.ok) {
        const msg = result.message || "(sin respuesta)";
        const node = addMsgNode("assistant", msg);
        pushMessage("assistant", msg);
        // Si el backend devolvió un plan de acciones y esta persona sabe
        // ejecutarlo (onAction), ofrecer un botón bajo el mensaje.
        if (result.action && typeof state.onAction === "function") {
          renderActionButton(node, result.action);
        }
      } else {
        const msg = (result && result.message) || "El asistente no pudo responder en este momento.";
        addMsgNode("error", msg);
        pushMessage("error", msg);
      }
    } catch (err) {
      thinking.remove();
      const msg = `No se pudo contactar con el asistente. ${err?.message || ""}`.trim();
      addMsgNode("error", msg);
      pushMessage("error", msg);
    } finally {
      busy = false;
      sendBtn.disabled = false;
      if (open) textarea.focus();
    }
  }

  // ----- Listeners -----
  const onFab = () => (open ? closePanel() : openPanel());
  const onClose = () => closePanel();
  const onSend = () => send();
  const onExpand = () => toggleFull();
  const onNew = () => newChat();
  const onInput = () => autosize();
  const onKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
    else if (e.key === "Escape") {
      if (full) { e.preventDefault(); full = false; applyFull(); }
      else if (open) { e.preventDefault(); closePanel(); }
    }
  };
  const onChatsClick = (e) => {
    const row = e.target.closest(".star-chat");
    if (!row) return;
    const id = row.dataset.id;
    const actBtn = e.target.closest("[data-act]");
    if (actBtn) {
      const act = actBtn.dataset.act;
      if (act === "rename") renameChat(id);
      else if (act === "delete") deleteChat(id);
      return;
    }
    selectChat(id);
  };

  fab.addEventListener("click", onFab);
  closeBtn.addEventListener("click", onClose);
  sendBtn.addEventListener("click", onSend);
  expandBtn.addEventListener("click", onExpand);
  newBtn.addEventListener("click", onNew);
  textarea.addEventListener("keydown", onKey);
  textarea.addEventListener("input", onInput);
  chatsEl.addEventListener("click", onChatsClick);

  syncHeader();
  host.appendChild(fab);
  host.appendChild(panel);

  // API de la instancia: actualizar la personalidad sin remontar.
  const instance = {
    setPersona({ persona, title, greeting, buildContext, sendFn, onAction } = {}) {
      const personaChanged = persona !== undefined && persona !== state.persona;
      if (persona !== undefined) state.persona = persona;
      if (title !== undefined) state.title = title;
      if (greeting !== undefined) state.greeting = greeting;
      if (typeof buildContext === "function") state.buildContext = buildContext;
      if (typeof sendFn === "function") state.sendFn = sendFn;
      // onAction: se actualiza solo si viene en el argumento. Un null explícito
      // desactiva el botón de acción (p. ej. al pasar a modo VISTA/analista).
      if (onAction !== undefined) state.onAction = typeof onAction === "function" ? onAction : null;
      syncHeader();
      // Al cambiar de persona, se cambia de almacén de conversaciones (hilos
      // separados y coherentes por persona: analista vs diseñador, etc.).
      if (personaChanged) {
        store = loadStore(state.appId, state.persona);
        activeId = store.chats.some((c) => c.id === store.activeId) ? store.activeId : null;
        if (open) { renderThread(); renderChatList(); }
      }
    },
    destroy() {
      fab.removeEventListener("click", onFab);
      closeBtn.removeEventListener("click", onClose);
      sendBtn.removeEventListener("click", onSend);
      expandBtn.removeEventListener("click", onExpand);
      newBtn.removeEventListener("click", onNew);
      textarea.removeEventListener("keydown", onKey);
      textarea.removeEventListener("input", onInput);
      chatsEl.removeEventListener("click", onChatsClick);
      document.body.classList.remove("star-fullscreen-lock");
      fab.remove();
      panel.remove();
    },
  };

  const cleanup = () => instance.destroy();
  cleanup.setPersona = instance.setPersona;
  return cleanup;
}
