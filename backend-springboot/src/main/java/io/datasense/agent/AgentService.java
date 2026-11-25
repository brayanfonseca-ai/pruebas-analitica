package io.datasense.agent;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;

import io.datasense.ai.BedrockService;
import io.datasense.ask.AskService;
import io.datasense.ask.InsightService;
import io.datasense.auth.AccessService;
import io.datasense.auth.UserRecord;
import io.datasense.automation.HealthService;
import io.datasense.config.DatabaseConfig.SchemaInitializer;
import io.datasense.knowledge.KnowledgeService;
import io.datasense.repo.AppRepository;
import io.datasense.repo.Ids;
import io.datasense.repo.MasterItemRepository;
import io.datasense.repo.NotesRepository;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Agentes de IA propios de PROTHEO. Un agente es un rol (plantilla + instrucciones), una app de la que sabe, unas
 * herramientas de <b>solo lectura</b> sobre los datos, memoria de la conversación, conocimiento (la base personal de
 * quien conversa, si la tiene activa) y límites (pasos máximos, ocultar datos personales). El cerebro es el modelo
 * interno de la plataforma (Amazon Bedrock); no hay conexiones externas.
 *
 * <p>Cada respuesta devuelve la <b>traza</b>: qué herramienta usó, con qué datos, qué obtuvo y cuánto tardó.</p>
 */
@Service
public class AgentService {

    /* ----------------------------- catálogo ----------------------------- */

    public record Tool(String id, String label, String icon, String description, String usage) {}

    public static final List<Tool> TOOLS = List.of(
            new Tool("preguntar", "Preguntar a los datos", "ask", "Responde una pregunta en español con la cifra exacta y cómo se calculó.",
                    "{\"tool\": \"preguntar\", \"input\": \"pregunta en español, p. ej. ventas netas por región\"}"),
            new Tool("que_cambio", "Qué cambió y por qué", "delta", "Compara el último periodo con el anterior y dice qué segmentos explican el cambio.",
                    "{\"tool\": \"que_cambio\", \"measure\": \"nombre de una medida maestra o expresión SQL\"}"),
            new Tool("registros", "Buscar registros", "rows", "Trae filas que cumplen filtros o una condición (máx. 50).",
                    "{\"tool\": \"registros\", \"filters\": {\"CAMPO\": [\"valor\"]}, \"where\": \"[campo] > 10\", \"fields\": \"c1, c2\", \"limit\": 20}"),
            new Tool("simular", "¿Qué pasaría si…?", "sim", "Simula un cambio (subir un precio un 10 %, quitar un canal) y compara antes y después.",
                    "{\"tool\": \"simular\", \"measure\": \"medida\", \"field\": \"campo a cambiar\", \"op\": \"pct|add|set\", \"value\": \"10\", \"filters\": {\"CAMPO\": [\"valor\"]}}"),
            new Tool("salud", "Salud de los datos", "health", "Puntaje de calidad de los datos y sus problemas (vacíos, duplicados, fechas).",
                    "{\"tool\": \"salud\"}"),
            new Tool("medidas", "Medidas oficiales", "book", "Lista las medidas y dimensiones maestras con su definición y si están certificadas.",
                    "{\"tool\": \"medidas\"}"),
            new Tool("conocimiento", "Base de conocimiento", "brain", "Busca en lo que ya se preguntó, analizó o informó antes (base personal).",
                    "{\"tool\": \"conocimiento\", \"query\": \"qué buscar\"}"));

    public record Template(String id, String label, String icon, String color, String description, String role, List<String> tools, String style, List<String> starters) {}

    public static final List<Template> TEMPLATES = List.of(
            new Template("analyst", "Analista comercial", "◆", "#6366f1", "Lee las cifras del negocio y las explica en lenguaje de gerencia.",
                    "Eres un analista comercial senior. Lees cifras, detectas lo importante y lo explicas en lenguaje de negocio, con números concretos.",
                    List.of("preguntar", "que_cambio", "registros", "medidas"), "executive",
                    List.of("¿Cómo vamos este mes frente al anterior?", "¿Qué región explica la mayor parte de las ventas?", "¿Dónde está la mayor oportunidad?")),
            new Template("sentinel", "Vigía de riesgos", "▲", "#f43f5e", "Busca lo que se está saliendo de lo normal y avisa con claridad.",
                    "Eres un vigía de riesgos. Buscas variaciones anómalas, concentraciones peligrosas y problemas de calidad de datos, y priorizas por impacto.",
                    List.of("que_cambio", "registros", "salud", "preguntar"), "concise",
                    List.of("¿Qué indicador empeoró más en el último periodo?", "¿Hay problemas de calidad en los datos?", "¿Dónde se disparan las devoluciones?")),
            new Template("narrator", "Narrador de informes", "✎", "#8b5cf6", "Convierte los números en un relato ejecutivo de tres párrafos.",
                    "Eres un redactor de informes ejecutivos. Conviertes cifras en un relato claro: qué pasó, por qué importa y qué hacer, sin relleno.",
                    List.of("preguntar", "que_cambio", "medidas", "conocimiento"), "detailed",
                    List.of("Escribe el resumen ejecutivo del periodo", "Redacta tres hallazgos para la junta", "¿Qué le diría al gerente comercial?")),
            new Template("strategist", "Estratega «¿qué pasaría si…?»", "◎", "#06b6d4", "Prueba escenarios antes de decidir y compara antes y después.",
                    "Eres un estratega. Antes de recomendar, simulas el escenario con datos y comparas el antes y el después con cifras.",
                    List.of("simular", "preguntar", "que_cambio"), "executive",
                    List.of("¿Qué pasa si subimos los precios un 5 %?", "¿Cuánto perdemos si cerramos el canal más pequeño?", "¿Qué escenario mejora más el margen?")),
            new Template("modeler", "Experto en el modelo", "⬡", "#10b981", "Explica qué significa cada medida, de dónde sale y qué tan confiable es.",
                    "Eres el experto del modelo de datos. Explicas definiciones, de dónde sale cada cifra, qué está certificado y la calidad de los datos.",
                    List.of("medidas", "salud", "preguntar"), "detailed",
                    List.of("¿Qué medidas están certificadas?", "¿Cómo se calcula el % de margen?", "¿Qué tan confiables son los datos?")),
            new Template("custom", "En blanco", "✦", "#f59e0b", "Empieza de cero con tus propias instrucciones.",
                    "Eres un asistente experto en análisis de datos que trabaja dentro de PROTHEO.", List.of("preguntar"), "concise", List.of()));

    public static final Map<String, String> STYLES = new LinkedHashMap<>(Map.of(
            "concise", "Responde breve: 2 a 4 frases con la cifra clave.",
            "executive", "Responde como para gerencia: primero la conclusión con la cifra, luego 2 o 3 viñetas cortas y una recomendación.",
            "detailed", "Responde completo: contexto, cifras, explicación y recomendación, en párrafos cortos y fáciles de leer."));

    /* ----------------------------- estado ----------------------------- */

    private final JdbcTemplate jdbc;
    private final BedrockService bedrock;
    private final AskService ask;
    private final InsightService insights;
    private final HealthService health;
    private final MasterItemRepository masters;
    private final NotesRepository notes;
    private final KnowledgeService knowledge;
    private final AppRepository apps;
    private final AccessService access;
    private final ObjectMapper mapper = new ObjectMapper();

    public AgentService(SchemaInitializer schema, JdbcTemplate jdbc, BedrockService bedrock, AskService ask, InsightService insights, HealthService health,
                        MasterItemRepository masters, NotesRepository notes, KnowledgeService knowledge, AppRepository apps, AccessService access) {
        this.jdbc = jdbc;
        this.bedrock = bedrock;
        this.ask = ask;
        this.insights = insights;
        this.health = health;
        this.masters = masters;
        this.notes = notes;
        this.knowledge = knowledge;
        this.apps = apps;
        this.access = access;
        jdbc.execute("CREATE TABLE IF NOT EXISTS agents (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, owner_name TEXT, name TEXT NOT NULL, description TEXT, "
                + "icon TEXT, color TEXT, template TEXT, instructions TEXT, app_id TEXT, tools TEXT, knowledge INTEGER NOT NULL DEFAULT 1, memory INTEGER NOT NULL DEFAULT 8, "
                + "max_steps INTEGER NOT NULL DEFAULT 5, style TEXT, guard_pii INTEGER NOT NULL DEFAULT 1, starters_json TEXT, status TEXT NOT NULL DEFAULT 'draft', "
                + "layout_json TEXT, uses INTEGER NOT NULL DEFAULT 0, last_used_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)");
        jdbc.execute("CREATE TABLE IF NOT EXISTS agent_conversations (id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, user_id TEXT NOT NULL, title TEXT, "
                + "messages_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)");
        jdbc.execute("CREATE INDEX IF NOT EXISTS ix_agent_conv ON agent_conversations(agent_id, user_id, updated_at)");
    }

    public Map<String, Object> catalog() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("templates", TEMPLATES);
        m.put("tools", TOOLS);
        m.put("styles", List.of(Map.of("id", "concise", "label", "Breve"), Map.of("id", "executive", "label", "Ejecutivo"), Map.of("id", "detailed", "label", "Detallado")));
        m.put("brain", Map.of("label", "Motor PROTHEO", "provider", "Amazon Bedrock (interno)", "model", bedrock.getModelId(), "region", bedrock.getRegion()));
        m.put("limits", Map.of("max_steps", 8, "memory", 20));
        return m;
    }

    /* ----------------------------- CRUD ----------------------------- */

    public List<Map<String, Object>> list(UserRecord u) {
        return jdbc.queryForList("SELECT * FROM agents ORDER BY updated_at DESC").stream()
                .filter(r -> canUse(u, r)).map(r -> out(u, r)).toList();
    }

    public Optional<Map<String, Object>> raw(String id) {
        return jdbc.queryForList("SELECT * FROM agents WHERE id = ?", id).stream().findFirst();
    }

    /** Lo ve su dueño (y el admin); los publicados, cualquiera que pueda usar agentes y ver su app. */
    public boolean canUse(UserRecord u, Map<String, Object> r) {
        if (u == null) return false;
        boolean mine = u.id().equals(r.get("owner_id")) || u.isAdmin();
        if (!mine && !"published".equals(r.get("status"))) return false;
        Object app = r.get("app_id");
        if (app == null) return true;
        return apps.getApp(String.valueOf(app)).map(a -> access.canSee(u, a)).orElse(mine);
    }

    public boolean canEdit(UserRecord u, Map<String, Object> r) { return u != null && (u.isAdmin() || u.id().equals(r.get("owner_id"))); }

    public Map<String, Object> out(UserRecord u, Map<String, Object> r) {
        Map<String, Object> m = new LinkedHashMap<>();
        for (String k : List.of("id", "name", "description", "icon", "color", "template", "instructions", "app_id", "style", "status", "owner_id", "owner_name",
                "uses", "last_used_at", "created_at", "updated_at")) m.put(k, r.get(k));
        m.put("tools", csv(r.get("tools")));
        m.put("knowledge", toInt(r.get("knowledge")) == 1);
        m.put("memory", toInt(r.get("memory")));
        m.put("max_steps", toInt(r.get("max_steps")));
        m.put("guard_pii", toInt(r.get("guard_pii")) == 1);
        m.put("starters", parseList(r.get("starters_json")));
        m.put("layout", parseMap(r.get("layout_json")));
        m.put("app_name", r.get("app_id") == null ? null : apps.getApp(String.valueOf(r.get("app_id"))).map(a -> a.name()).orElse(null));
        m.put("editable", canEdit(u, r));
        return m;
    }

    public String create(UserRecord u, Map<String, Object> body) {
        Template t = TEMPLATES.stream().filter(x -> x.id().equals(String.valueOf(body.getOrDefault("template", "analyst")))).findFirst().orElse(TEMPLATES.get(0));
        String id = Ids.newId(), now = Ids.now();
        String name = str(body.get("name")).isBlank() ? t.label() : clip(str(body.get("name")), 60);
        jdbc.update("INSERT INTO agents (id, owner_id, owner_name, name, description, icon, color, template, instructions, app_id, tools, knowledge, memory, max_steps, style, guard_pii, "
                        + "starters_json, status, layout_json, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                id, u.id(), u.name(), name, str(body.getOrDefault("description", t.description())), str(body.getOrDefault("icon", t.icon())),
                str(body.getOrDefault("color", t.color())), t.id(), str(body.getOrDefault("instructions", "")), blankToNull(body.get("app_id")),
                String.join(",", body.get("tools") instanceof List<?> l ? validTools(l) : t.tools()), 1, 8, 5, t.style(), 1,
                write(body.get("starters") instanceof List<?> s ? s : t.starters()), "draft", null, now, now);
        return id;
    }

    public void update(String id, Map<String, Object> body) {
        Map<String, Object> cur = raw(id).orElseThrow();
        Map<String, Object> r = new LinkedHashMap<>(cur);
        for (String k : List.of("name", "description", "icon", "color", "instructions", "style")) if (body.containsKey(k)) r.put(k, str(body.get(k)));
        if (body.containsKey("app_id")) r.put("app_id", blankToNull(body.get("app_id")));
        if (body.get("tools") instanceof List<?> l) r.put("tools", String.join(",", validTools(l)));
        if (body.containsKey("knowledge")) r.put("knowledge", Boolean.TRUE.equals(body.get("knowledge")) ? 1 : 0);
        if (body.containsKey("guard_pii")) r.put("guard_pii", Boolean.FALSE.equals(body.get("guard_pii")) ? 0 : 1);
        if (body.containsKey("memory")) r.put("memory", clampInt(body.get("memory"), 0, 20));
        if (body.containsKey("max_steps")) r.put("max_steps", clampInt(body.get("max_steps"), 1, 8));
        if (body.get("starters") instanceof List<?> s) r.put("starters_json", write(s.stream().map(String::valueOf).filter(x -> !x.isBlank()).limit(6).toList()));
        if (body.get("layout") instanceof Map<?, ?> lay) r.put("layout_json", write(lay));
        if (body.containsKey("status")) r.put("status", "published".equals(body.get("status")) ? "published" : "draft");
        if (str(r.get("name")).isBlank()) throw new IllegalArgumentException("El agente necesita un nombre.");
        if (!STYLES.containsKey(str(r.get("style")))) r.put("style", "concise");
        jdbc.update("UPDATE agents SET name=?, description=?, icon=?, color=?, instructions=?, app_id=?, tools=?, knowledge=?, memory=?, max_steps=?, style=?, guard_pii=?, "
                        + "starters_json=?, status=?, layout_json=?, updated_at=? WHERE id=?",
                clip(str(r.get("name")), 60), clip(str(r.get("description")), 240), clip(str(r.get("icon")), 4), str(r.get("color")), clip(str(r.get("instructions")), 4000),
                r.get("app_id"), r.get("tools"), toInt(r.get("knowledge")), toInt(r.get("memory")), toInt(r.get("max_steps")), r.get("style"), toInt(r.get("guard_pii")),
                r.get("starters_json"), r.get("status"), r.get("layout_json"), Ids.now(), id);
    }

    public void delete(String id) {
        jdbc.update("DELETE FROM agent_conversations WHERE agent_id = ?", id);
        jdbc.update("DELETE FROM agents WHERE id = ?", id);
    }

    private static List<String> validTools(List<?> l) {
        Set<String> ok = new LinkedHashSet<>();
        for (Object o : l) { String t = String.valueOf(o); if (TOOLS.stream().anyMatch(x -> x.id().equals(t))) ok.add(t); }
        return new ArrayList<>(ok);
    }

    /* ----------------------------- conversaciones ----------------------------- */

    public List<Map<String, Object>> conversations(String agentId, String userId) {
        return jdbc.queryForList("SELECT id, title, created_at, updated_at, messages_json FROM agent_conversations WHERE agent_id = ? AND user_id = ? ORDER BY updated_at DESC LIMIT 50",
                agentId, userId).stream().map(r -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", r.get("id")); m.put("title", r.get("title")); m.put("created_at", r.get("created_at")); m.put("updated_at", r.get("updated_at"));
            m.put("messages", parseList(r.get("messages_json")).size());
            return m;
        }).toList();
    }

    public Optional<Map<String, Object>> conversation(String agentId, String userId, String convId) {
        return jdbc.queryForList("SELECT * FROM agent_conversations WHERE id = ? AND agent_id = ? AND user_id = ?", convId, agentId, userId).stream().findFirst().map(r -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", r.get("id")); m.put("title", r.get("title")); m.put("created_at", r.get("created_at")); m.put("updated_at", r.get("updated_at"));
            m.put("messages", parseList(r.get("messages_json")));
            return m;
        });
    }

    public boolean deleteConversation(String agentId, String userId, String convId) {
        return jdbc.update("DELETE FROM agent_conversations WHERE id = ? AND agent_id = ? AND user_id = ?", convId, agentId, userId) > 0;
    }

    /* ----------------------------- conversar ----------------------------- */

    /** Llamada a herramienta: el primer objeto JSON tras «HERRAMIENTA:» (se ignora lo que el modelo escriba después). */
    private static final Pattern TOOL = Pattern.compile("(?s)HERRAMIENTA\\s*:\\s*(\\{.*?\\})(?=\\s*(?:$|[^,\\]}\"]))");

    @SuppressWarnings("unchecked")
    public Map<String, Object> chat(UserRecord u, Map<String, Object> agent, String message, String convId) throws Exception {
        long t0 = System.currentTimeMillis();
        String appId = agent.get("app_id") == null ? null : String.valueOf(agent.get("app_id"));
        if (appId != null) {
            var a = apps.getApp(appId).orElseThrow(() -> new IllegalArgumentException("La aplicación del agente ya no existe."));
            if (!access.canSee(u, a)) throw new IllegalArgumentException("No tienes acceso a la aplicación de este agente.");
        }
        List<String> tools = csv(agent.get("tools"));
        boolean useKb = toInt(agent.get("knowledge")) == 1 && knowledge.enabled(u.id());
        if (!useKb) tools = tools.stream().filter(t -> !"conocimiento".equals(t)).toList();
        if (appId == null) tools = tools.stream().filter(t -> "conocimiento".equals(t)).toList();
        int maxSteps = Math.max(1, Math.min(8, toInt(agent.get("max_steps"))));
        int memory = Math.max(0, Math.min(20, toInt(agent.get("memory"))));
        boolean pii = toInt(agent.get("guard_pii")) == 1;

        // Conversación
        List<Map<String, Object>> history = new ArrayList<>();
        String cid = convId;
        if (cid != null && !cid.isBlank()) {
            Optional<Map<String, Object>> c = conversation(str(agent.get("id")), u.id(), cid);
            if (c.isPresent()) history = new ArrayList<>((List<Map<String, Object>>) c.get().get("messages"));
            else cid = null;
        }

        // Conocimiento previo (si el agente lo usa y la persona tiene la base activa)
        List<Map<String, Object>> kbHits = useKb ? knowledge.retrieve(u, message, appId, 4) : List.of();

        Template t = TEMPLATES.stream().filter(x -> x.id().equals(str(agent.get("template")))).findFirst().orElse(TEMPLATES.get(TEMPLATES.size() - 1));
        StringBuilder sys = new StringBuilder();
        sys.append("Te llamas «").append(str(agent.get("name"))).append("». ").append(t.role());
        if (!str(agent.get("instructions")).isBlank()) sys.append("\n\nInstrucciones de quien te creó:\n").append(clip(str(agent.get("instructions")), 4000));
        sys.append("\n\nEstilo: ").append(STYLES.getOrDefault(str(agent.get("style")), STYLES.get("concise")));
        sys.append("\n\nReglas: responde siempre en español; nunca inventes cifras (si un dato no lo obtuviste con una herramienta o del conocimiento, dilo); "
                + "di de dónde sale cada número; si la pregunta no tiene que ver con los datos, responde breve y vuelve al tema.");
        if (pii) sys.append(" No reveles datos personales (correos, teléfonos, documentos de identidad) aunque aparezcan.");
        if (appId != null) {
            sys.append("\n\nTrabajas con la aplicación «").append(apps.getApp(appId).map(a -> a.name()).orElse(appId)).append("».");
            try {
                String ctx = notes.contextFor(appId);
                if (!ctx.isBlank()) sys.append("\n\nDiccionario de datos:\n").append(clip(ctx, 3500));
            } catch (RuntimeException ignored) {}
        }
        if (!tools.isEmpty()) {
            sys.append("\n\nPuedes usar herramientas. Para usar una, responde SOLO una línea con este formato:\n");
            for (String id : tools) TOOLS.stream().filter(x -> x.id().equals(id)).findFirst().ifPresent(x -> sys.append("· ").append(x.description()).append("\n  HERRAMIENTA: ").append(x.usage()).append('\n'));
            sys.append("Recibirás el resultado y podrás seguir (máximo ").append(maxSteps).append(" herramientas). Cuando tengas la respuesta final, escríbela sin la palabra HERRAMIENTA.");
            sys.append("\nREGLA: antes de dar una cifra, una lista de medidas o un dato de la aplicación, consúltalo con una herramienta en este turno "
                    + "(el diccionario y el conocimiento previo son contexto, no la fuente de la cifra). Tu PRIMERA respuesta a una pregunta sobre datos debe ser una línea HERRAMIENTA.");
        }
        if (!kbHits.isEmpty()) {
            sys.append("\n\nConocimiento previo de esta persona (úsalo si sirve y cítalo como [K1], [K2]…):\n");
            for (int i = 0; i < kbHits.size(); i++) {
                Map<String, Object> d = kbHits.get(i);
                sys.append("[K").append(i + 1).append("] ").append(d.get("title")).append(" — ").append(clip(str(d.get("text")), 500)).append('\n');
            }
        }

        StringBuilder convo = new StringBuilder();
        List<Map<String, Object>> recent = history.subList(Math.max(0, history.size() - memory * 2), history.size());
        for (Map<String, Object> m : recent) convo.append("user".equals(m.get("role")) ? "Usuario: " : "Asistente: ").append(clip(str(m.get("content")), 1500)).append("\n\n");
        convo.append("Usuario: ").append(message);

        List<Map<String, Object>> steps = new ArrayList<>();
        String answer = null;
        String error = null;
        for (int i = 0; i <= maxSteps; i++) {
            long s0 = System.currentTimeMillis();
            BedrockService.AiResult r = bedrock.converse(sys.toString(), convo.toString());
            if (!r.ok()) { error = r.message(); break; }
            String txt = r.text().trim();
            Matcher m = TOOL.matcher(txt);
            if (!tools.isEmpty() && m.find() && i < maxSteps) {
                Map<String, Object> call;
                try { call = mapper.readValue(m.group(1), new TypeReference<Map<String, Object>>() {}); }
                catch (Exception e) { convo.append("\n\nAsistente: ").append(txt).append("\n\nSistema: la llamada a la herramienta no es JSON válido; corrígela o responde."); continue; }
                String tool = str(call.get("tool"));
                Map<String, Object> step = new LinkedHashMap<>();
                step.put("tool", tool);
                step.put("label", TOOLS.stream().filter(x -> x.id().equals(tool)).map(Tool::label).findFirst().orElse(tool));
                Map<String, Object> input = new LinkedHashMap<>(call);
                input.remove("tool");
                step.put("input", input);
                long ts = System.currentTimeMillis();
                String result;
                boolean ok = true;
                if (!tools.contains(tool)) { result = "Esa herramienta no está activa para este agente. Usa: " + String.join(", ", tools); ok = false; }
                else {
                    try { result = runTool(u, appId, tool, call, pii); }
                    catch (Exception e) { result = "Error de la herramienta: " + e.getMessage(); ok = false; }
                }
                step.put("ok", ok);
                step.put("result", clip(result, 900));
                step.put("ms", System.currentTimeMillis() - ts);
                step.put("think_ms", ts - s0);
                steps.add(step);
                convo.append("\n\nAsistente: ").append(txt).append("\n\nResultado de la herramienta «").append(tool).append("»:\n").append(clip(result, 5000));
                if (!ok) convo.append("\n\nSistema: esa herramienta FALLÓ y no devolvió datos. No inventes cifras, regiones ni porcentajes. Corrige la llamada, usa otra herramienta, "
                        + "o di claramente que no pudiste obtener ese dato.");
                continue;
            }
            answer = txt.replaceAll("(?s)HERRAMIENTA\\s*:\\s*\\{.*?\\}", "").trim();
            break;
        }
        if (answer == null && error == null) answer = "No llegué a una respuesta final con los pasos permitidos. Prueba con una pregunta más concreta o sube el límite de pasos.";

        Map<String, Object> out = new LinkedHashMap<>();
        if (error != null) {
            out.put("ok", false);
            out.put("error", "El motor de IA no respondió: " + error);
            out.put("steps", steps);
            out.put("duration_ms", System.currentTimeMillis() - t0);
            return out;
        }

        // Guardar la conversación
        String now = Ids.now();
        Map<String, Object> um = new LinkedHashMap<>(); um.put("role", "user"); um.put("content", message); um.put("at", now);
        Map<String, Object> am = new LinkedHashMap<>(); am.put("role", "assistant"); am.put("content", answer); am.put("at", now); am.put("steps", steps);
        am.put("knowledge", kbHits.stream().map(d -> Map.of("id", d.get("id"), "title", d.get("title"), "kind", d.get("kind"))).toList());
        history.add(um); history.add(am);
        if (history.size() > 200) history = new ArrayList<>(history.subList(history.size() - 200, history.size()));
        if (cid == null) {
            cid = Ids.newId();
            jdbc.update("INSERT INTO agent_conversations (id, agent_id, user_id, title, messages_json, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
                    cid, agent.get("id"), u.id(), clip(message, 80), write(history), now, now);
        } else {
            jdbc.update("UPDATE agent_conversations SET messages_json = ?, updated_at = ? WHERE id = ?", write(history), now, cid);
        }
        jdbc.update("UPDATE agents SET uses = uses + 1, last_used_at = ? WHERE id = ?", now, agent.get("id"));

        // Alimentar la base de conocimiento (si la persona la tiene activa)
        StringBuilder kt = new StringBuilder(answer);
        if (!steps.isEmpty()) kt.append("\nHerramientas: ").append(String.join(", ", steps.stream().map(x -> str(x.get("label"))).toList()));
        knowledge.capture(u, appId, "agent", null, message, kt.toString(), List.of(new KnowledgeService.Hint(str(agent.get("name")), "agent")), Map.of("agent_id", str(agent.get("id"))));

        out.put("ok", true);
        out.put("conversation_id", cid);
        out.put("answer", answer);
        out.put("steps", steps);
        out.put("knowledge", am.get("knowledge"));
        out.put("tools_available", tools);
        out.put("duration_ms", System.currentTimeMillis() - t0);
        out.put("brain", bedrock.getModelId());
        return out;
    }

    /* ----------------------------- herramientas (solo lectura) ----------------------------- */

    private static final Pattern EMAIL = Pattern.compile("[\\w.+-]+@[\\w-]+(\\.[\\w-]+)+");
    private static final Pattern PII_COL = Pattern.compile("(?i)(cedula|cédula|documento|identificaci|telefono|teléfono|celular|movil|móvil|email|correo|nit|direccion|dirección|pasaporte)");

    @SuppressWarnings("unchecked")
    String runTool(UserRecord u, String app, String tool, Map<String, Object> call, boolean pii) throws Exception {
        switch (tool) {
            case "preguntar": {
                Map<String, Object> r = ask.ask(app, str(call.get("input")));
                if (!Boolean.TRUE.equals(r.get("ok"))) return "No entendí la pregunta: " + r.get("message") + " Sugerencias: " + r.get("suggestions");
                StringBuilder sb = new StringBuilder(str(r.get("answer"))).append("\nDatos: ").append(mask(mapper.writeValueAsString(r.get("result")), pii));
                // Participaciones ya calculadas: el modelo no debe dividir por su cuenta (se equivoca con facilidad).
                if (r.get("result") instanceof Map<?, ?> res && res.get("labels") instanceof List<?> labels && res.get("values") instanceof List<?> vals && labels.size() == vals.size() && !labels.isEmpty()) {
                    double total = 0; boolean additive = true;
                    for (Object v : vals) { if (v instanceof Number n) total += n.doubleValue(); else additive = false; }
                    String ml = r.get("how") instanceof Map<?, ?> how && how.get("measure") instanceof Map<?, ?> mm ? str(mm.get("label")) : "";
                    boolean pct = ml.contains("%") || ml.toLowerCase(Locale.ROOT).matches(".*(porcentaje|tasa|promedio|ticket).*");
                    if (additive && total != 0 && !pct) {
                        sb.append("\nTotal de todos los grupos: ").append(String.format(Locale.ROOT, "%.2f", total)).append(" (").append(labels.size()).append(" grupos)\nParticipación de cada grupo sobre ese total: ");
                        for (int i = 0; i < labels.size(); i++) sb.append(i == 0 ? "" : "; ").append(labels.get(i)).append(" ").append(String.format(Locale.ROOT, "%.1f", ((Number) vals.get(i)).doubleValue() * 100 / total)).append(" %");
                        sb.append("\nUsa estas participaciones tal cual; no las recalcules.");
                    }
                }
                return sb.toString();
            }
            case "que_cambio": {
                Map<String, Object> q = new LinkedHashMap<>(measureRef(app, str(call.get("measure"))));
                Map<String, Object> r = insights.explain(app, q);
                Object story = r.get("story");
                String s = story instanceof List<?> l ? String.join(" ", l.stream().map(String::valueOf).toList()) : str(story);
                java.text.NumberFormat nf = java.text.NumberFormat.getNumberInstance(Locale.forLanguageTag("es-CO"));
                nf.setMaximumFractionDigits(2);
                java.util.function.Function<Object, String> f = (o) -> o instanceof Number n ? nf.format(n.doubleValue()) : str(o);
                return s + "\nActual " + r.get("current") + ": " + f.apply(r.get("current_value")) + " · anterior " + r.get("previous") + ": " + f.apply(r.get("previous_value"))
                        + " · variación " + f.apply(r.get("delta_pct")) + " %"
                        + "\n(Los porcentajes «con el X % de las filas» son la parte de los registros de ese segmento, no la parte del cambio.)";
            }
            case "registros": {
                Map<String, Object> q = new LinkedHashMap<>();
                if (call.get("filters") != null) q.put("selections", call.get("filters"));
                if (call.get("where") != null) q.put("where", call.get("where"));
                if (call.get("fields") != null) q.put("fields", Arrays.stream(str(call.get("fields")).split(",")).map(String::trim).filter(s -> !s.isEmpty()).toList());
                q.put("limit", Math.min(50, call.get("limit") == null ? 20 : (int) Double.parseDouble(str(call.get("limit")))));
                Map<String, Object> r = insights.rows(app, q);
                List<Object> cols = r.get("columns") instanceof List<?> c ? (List<Object>) c : List.of();
                List<Object> rows = r.get("rows") instanceof List<?> rr ? (List<Object>) rr : List.of();
                if (pii) rows = maskRows(cols, rows);
                return r.get("total") + " registro(s) en " + r.get("table") + ". Columnas: " + cols + "\nFilas: " + mask(mapper.writeValueAsString(rows), pii);
            }
            case "simular": {
                Map<String, Object> m = new LinkedHashMap<>(measureRef(app, str(call.get("measure"))));
                Map<String, Object> ch = new LinkedHashMap<>();
                ch.put("field", str(call.get("field")));
                ch.put("op", str(call.get("op")).isBlank() ? "pct" : str(call.get("op")));
                ch.put("value", str(call.get("value")));
                if (call.get("filters") != null) ch.put("selections", call.get("filters"));
                Map<String, Object> r = insights.whatIf(app, Map.of("measures", List.of(m), "changes", List.of(ch)));
                Object story = r.get("story");
                return (story instanceof List<?> l ? String.join(" ", l.stream().map(String::valueOf).toList()) : str(story)) + "\nDetalle: " + mapper.writeValueAsString(r.get("results"));
            }
            case "salud": {
                Map<String, Object> h = health.health(app);
                List<Map<String, Object>> issues = (List<Map<String, Object>>) h.get("issues");
                return "Puntaje " + h.get("score") + "/100 (" + h.get("status") + "). Problemas: " + (issues.isEmpty() ? "ninguno" : String.join("; ", issues.stream().limit(10)
                        .map(i -> (i.get("table") == null ? "" : i.get("table") + ": ") + i.get("message")).toList()));
            }
            case "medidas": {
                StringBuilder s = new StringBuilder();
                for (Map<String, Object> m : masters.list(app, null)) {
                    s.append("• ").append(m.get("name")).append(" (").append("measure".equals(m.get("kind")) ? "medida" : "dimensión")
                            .append(Boolean.TRUE.equals(m.get("certified")) || "1".equals(str(m.get("certified"))) ? ", certificada" : "").append("): ").append(m.get("expression"));
                    if (!str(m.get("description")).isBlank()) s.append(" — ").append(clip(str(m.get("description")), 160));
                    s.append('\n');
                }
                return s.length() == 0 ? "La app no tiene medidas ni dimensiones maestras." : s.toString();
            }
            case "conocimiento": {
                List<Map<String, Object>> hits = knowledge.retrieve(u, str(call.get("query")), app, 5);
                if (hits.isEmpty()) return "No hay nada relacionado en la base de conocimiento.";
                StringBuilder s = new StringBuilder();
                for (Map<String, Object> d : hits) s.append("• [").append(d.get("kind")).append("] ").append(d.get("title")).append(": ").append(clip(str(d.get("text")), 400)).append('\n');
                return s.toString();
            }
            default:
                return "Herramienta desconocida.";
        }
    }

    /** «Ventas netas» → {master_id} si es una medida maestra; si no, se usa como expresión. */
    private Map<String, Object> measureRef(String app, String measure) {
        if (measure.isBlank()) throw new IllegalArgumentException("Indica la medida.");
        String n = KnowledgeService.norm(measure);
        List<Map<String, Object>> ms = masters.list(app, null).stream().filter(m -> !"dimension".equals(str(m.get("kind")))).toList();
        // Exacta, luego contenida («ventas» → «Ventas netas»), luego la expresión tal cual.
        for (Map<String, Object> m : ms) if (KnowledgeService.norm(str(m.get("name"))).equals(n)) return Map.of("master_id", str(m.get("id")), "label", str(m.get("name")));
        for (Map<String, Object> m : ms) {
            String mn = KnowledgeService.norm(str(m.get("name")));
            if (!n.isBlank() && (mn.contains(n) || n.contains(mn))) return Map.of("master_id", str(m.get("id")), "label", str(m.get("name")));
        }
        if (!measure.matches("(?s).*[()\\[\\]*+/].*"))
            throw new IllegalArgumentException("No hay una medida llamada «" + measure + "». Medidas disponibles: "
                    + String.join(", ", ms.stream().map(m -> str(m.get("name"))).toList()) + ". Repite la llamada con uno de esos nombres exactos.");
        return Map.of("expression", measure);
    }

    @SuppressWarnings("unchecked")
    private List<Object> maskRows(List<Object> cols, List<Object> rows) {
        List<Integer> idx = new ArrayList<>();
        for (int i = 0; i < cols.size(); i++) if (PII_COL.matcher(str(cols.get(i))).find()) idx.add(i);
        if (idx.isEmpty()) return rows;
        List<Object> out = new ArrayList<>();
        for (Object r : rows) {
            if (r instanceof List<?> l) {
                List<Object> c = new ArrayList<>(l);
                for (int i : idx) if (i < c.size()) c.set(i, "•••");
                out.add(c);
            } else if (r instanceof Map<?, ?> m) {
                Map<String, Object> c = new LinkedHashMap<>((Map<String, Object>) m);
                for (String k : new ArrayList<>(c.keySet())) if (PII_COL.matcher(k).find()) c.put(k, "•••");
                out.add(c);
            } else out.add(r);
        }
        return out;
    }

    private static String mask(String s, boolean pii) { return pii ? EMAIL.matcher(s).replaceAll("•••@•••") : s; }

    /* ----------------------------- utilidades ----------------------------- */

    static String str(Object o) { return o == null ? "" : String.valueOf(o); }
    private static String clip(String s, int n) { return s == null ? "" : s.length() <= n ? s : s.substring(0, n) + "…"; }
    private static String blankToNull(Object o) { return o == null || String.valueOf(o).isBlank() ? null : String.valueOf(o); }
    private static List<String> csv(Object o) { return o == null || str(o).isBlank() ? List.of() : Arrays.stream(str(o).split(",")).map(String::trim).filter(s -> !s.isEmpty()).toList(); }
    private static int toInt(Object o) { if (o instanceof Number n) return n.intValue(); try { return Integer.parseInt(str(o)); } catch (Exception e) { return 0; } }
    private static int clampInt(Object o, int lo, int hi) { int v; try { v = (int) Double.parseDouble(str(o)); } catch (Exception e) { v = lo; } return Math.max(lo, Math.min(hi, v)); }
    private String write(Object o) { try { return mapper.writeValueAsString(o); } catch (Exception e) { return null; } }
    private List<Object> parseList(Object o) {
        if (o == null) return List.of();
        try { return mapper.readValue(String.valueOf(o), new TypeReference<List<Object>>() {}); } catch (Exception e) { return List.of(); }
    }
    private Map<String, Object> parseMap(Object o) {
        if (o == null) return null;
        try { return mapper.readValue(String.valueOf(o), new TypeReference<Map<String, Object>>() {}); } catch (Exception e) { return null; }
    }
}
