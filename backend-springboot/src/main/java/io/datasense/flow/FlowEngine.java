package io.datasense.flow;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;

import io.datasense.ai.BedrockService;
import io.datasense.ask.AskService;
import io.datasense.ask.InsightService;
import io.datasense.auth.AccessService;
import io.datasense.auth.Permissions;
import io.datasense.auth.UserRecord;
import io.datasense.automation.AutomationService;
import io.datasense.automation.HealthService;
import io.datasense.repo.AppRepository;
import io.datasense.repo.Ids;
import io.datasense.repo.NotesRepository;
import io.datasense.repo.NotificationRepository;

import jakarta.mail.internet.MimeMessage;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.mail.javamail.JavaMailSenderImpl;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.stereotype.Service;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Motor de las automatizaciones. Un flujo es un grafo {nodes:[{id, type, name, x, y, params, disabled?}],
 * edges:[{from, port, to}]}. Arranca en el disparador con un registro; cada nodo recibe la lista de registros
 * ({@code items}) que le pasa el anterior y produce los suyos por cada salida (la mayoría «out»; «Si / sino»
 * tiene «true» y «false»). Lo que devuelve cada nodo queda disponible para los siguientes como
 * {@code $node["Nombre"]}. Todo corre con los permisos de quien creó el flujo.
 */
@Service
public class FlowEngine {

    private final FlowRepository repo;
    private final AskService ask;
    private final InsightService insights;
    private final HealthService health;
    private final AutomationService automation;
    private final BedrockService bedrock;
    private final NotesRepository notes;
    private final NotificationRepository notifications;
    private final AppRepository apps;
    private final AccessService access;
    private final ObjectMapper mapper = new ObjectMapper();
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).followRedirects(HttpClient.Redirect.NORMAL).build();

    static final int MAX_STEPS = 200, MAX_ITEMS = 5000;

    public FlowEngine(FlowRepository repo, AskService ask, InsightService insights, HealthService health, AutomationService automation,
                      BedrockService bedrock, NotesRepository notes, NotificationRepository notifications, AppRepository apps, AccessService access) {
        this.repo = repo;
        this.ask = ask;
        this.insights = insights;
        this.health = health;
        this.automation = automation;
        this.bedrock = bedrock;
        this.notes = notes;
        this.notifications = notifications;
        this.apps = apps;
        this.access = access;
    }

    /** Ejecución en curso (evita que un flujo se dispare a sí mismo en bucle). */
    static final ThreadLocal<Deque<String>> CHAIN = ThreadLocal.withInitial(ArrayDeque::new);

    /**
     * Ejecuta el flujo. {@code startType}: tipo de disparador con que arranca (null = el primero del grafo).
     * @return {run_id, status ok|error, error?, duration_ms, steps:[…], output (registros del último nodo)}
     */
    public Map<String, Object> run(Map<String, Object> flowRow, String trigger, String startType, Map<String, Object> triggerData, UserRecord owner) {
        String flowId = String.valueOf(flowRow.get("id"));
        String runId = Ids.newId(), started = Ids.now();
        long t0 = System.currentTimeMillis();
        Map<String, Object> g = repo.graph(flowRow);
        List<Map<String, Object>> nodes = FlowRepository.nodes(g), edges = FlowRepository.edges(g);
        Map<String, Map<String, Object>> byId = new LinkedHashMap<>();
        for (Map<String, Object> n : nodes) byId.put(String.valueOf(n.get("id")), n);
        List<Map<String, Object>> steps = new ArrayList<>();
        Map<String, List<Map<String, Object>>> outputs = new LinkedHashMap<>();
        Map<String, Object> flowInfo = Map.of("id", flowId, "name", String.valueOf(flowRow.get("name")));
        String status = "ok", error = null;
        List<Map<String, Object>> last = List.of();
        Deque<String> chain = CHAIN.get();
        chain.push(flowId);
        try {
            Map<String, Object> start = nodes.stream()
                    .filter(n -> String.valueOf(n.get("type")).startsWith("trigger.") && (startType == null || startType.equals(n.get("type"))))
                    .findFirst().orElse(null);
            if (start == null) throw new FlowException("El flujo no tiene un disparador" + (startType == null ? "." : " de tipo " + startType + "."));
            Map<String, Object> tdata = new LinkedHashMap<>(triggerData == null ? Map.of() : triggerData);
            Deque<Object[]> queue = new ArrayDeque<>();   // {nodeId, items}
            queue.add(new Object[]{start.get("id"), List.of(tdata)});
            int count = 0;
            while (!queue.isEmpty()) {
                if (++count > MAX_STEPS) throw new FlowException("Se superó el máximo de " + MAX_STEPS + " pasos (¿hay un ciclo?).");
                Object[] job = queue.poll();
                Map<String, Object> node = byId.get(String.valueOf(job[0]));
                if (node == null) continue;
                @SuppressWarnings("unchecked") List<Map<String, Object>> input = (List<Map<String, Object>>) job[1];
                String name = nodeName(node);
                Map<String, Object> step = new LinkedHashMap<>();
                step.put("node_id", node.get("id")); step.put("name", name); step.put("type", node.get("type"));
                step.put("input_count", input.size());
                long s0 = System.currentTimeMillis();
                Map<String, List<Map<String, Object>>> out;
                try {
                    if (Boolean.TRUE.equals(node.get("disabled"))) { out = Map.of("out", input); step.put("status", "skipped"); }
                    else {
                        Templates.Ctx base = new Templates.Ctx(input.isEmpty() ? Map.of() : input.get(0), input, outputs, tdata, flowInfo, runId);
                        out = exec(node, input, base, owner, flowRow, step);
                        step.put("status", "ok");
                    }
                } catch (Exception e) {
                    String msg = e instanceof FlowException ? e.getMessage() : e.getClass().getSimpleName() + ": " + e.getMessage();
                    step.put("error", msg);
                    if (!"continue".equals(param(node, "on_error"))) {
                        step.put("status", "error");
                        step.put("ms", System.currentTimeMillis() - s0);
                        steps.add(step);
                        status = "error"; error = name + ": " + msg;
                        break;
                    }
                    // «seguir si falla»: el error viaja como dato a los siguientes nodos
                    step.put("status", "warning");
                    out = new LinkedHashMap<>();
                    for (String port : outPortsOf(node)) out.put(port, List.of());
                    out.put(outPortsOf(node).get(0), List.of(new LinkedHashMap<>(Map.of("error", msg, "node", name))));
                }
                step.put("ms", System.currentTimeMillis() - s0);
                Map<String, Object> sample = new LinkedHashMap<>();
                Map<String, Integer> counts = new LinkedHashMap<>();
                List<Map<String, Object>> all = new ArrayList<>();
                out.forEach((port, items) -> {
                    counts.put(port, items.size());
                    sample.put(port, items.size() > 25 ? items.subList(0, 25) : items);
                    all.addAll(items);
                });
                step.put("output_count", counts);
                step.put("output", sample);
                steps.add(step);
                outputs.put(name, all.size() > MAX_ITEMS ? all.subList(0, MAX_ITEMS) : all);
                last = all;
                for (Map<String, Object> e : edges) {
                    if (!String.valueOf(node.get("id")).equals(String.valueOf(e.get("from")))) continue;
                    String port = e.get("port") == null ? "out" : String.valueOf(e.get("port"));
                    List<Map<String, Object>> items = out.get(port);
                    if (items == null || items.isEmpty()) continue;
                    queue.add(new Object[]{e.get("to"), items});
                }
            }
        } catch (FlowException e) {
            status = "error"; error = e.getMessage();
        } finally {
            chain.pop();
        }
        long ms = System.currentTimeMillis() - t0;
        repo.saveRun(runId, flowId, trigger, status, error, steps, ms, started);
        Map<String, Object> res = new LinkedHashMap<>();
        res.put("run_id", runId);
        res.put("status", status);
        if (error != null) res.put("error", error);
        res.put("duration_ms", ms);
        res.put("steps", steps);
        res.put("output", last.size() > 50 ? last.subList(0, 50) : last);
        return res;
    }

    @SuppressWarnings("unchecked")
    static List<String> outPortsOf(Map<String, Object> n) {
        Map<String, Object> def = FlowCatalog.BY_TYPE.get(String.valueOf(n.get("type")));
        return def == null ? List.of("out") : (List<String>) def.get("outputs");
    }

    static String nodeName(Map<String, Object> n) {
        Object nm = n.get("name");
        return nm == null || String.valueOf(nm).isBlank() ? String.valueOf(n.get("id")) : String.valueOf(nm);
    }

    @SuppressWarnings("unchecked")
    static Object param(Map<String, Object> node, String key) {
        Object p = node.get("params");
        return p instanceof Map<?, ?> m ? ((Map<String, Object>) m).get(key) : null;
    }

    /* ================================ nodos ================================ */

    private Map<String, List<Map<String, Object>>> exec(Map<String, Object> node, List<Map<String, Object>> input, Templates.Ctx c,
                                                       UserRecord owner, Map<String, Object> flow, Map<String, Object> step) throws Exception {
        String type = String.valueOf(node.get("type"));
        P p = new P(node, c);
        return switch (type) {
            case "trigger.manual" -> {
                Map<String, Object> item = new LinkedHashMap<>(c.json());
                Object sample = p.raw("sample");
                if (item.isEmpty() && sample != null && !String.valueOf(sample).isBlank()) item.putAll(json(sample, "Datos de prueba"));
                if (item.isEmpty()) item.put("started_at", Ids.now());
                yield one(item);
            }
            case "trigger.schedule", "trigger.webhook", "trigger.reload", "trigger.alert" -> {
                Map<String, Object> item = new LinkedHashMap<>(c.json());
                if (item.isEmpty()) item.put("started_at", Ids.now());
                yield one(item);
            }
            case "data.reload" -> {
                String app = appFor(p, owner, true);
                Map<String, Object> r = automation.runNow(app, owner, "flow");
                Map<String, Object> item = new LinkedHashMap<>();
                item.put("app_id", app);
                item.put("app", appName(app));
                item.put("status", r.get("status"));
                item.put("message", r.get("message"));
                item.put("tables", r.get("tables"));
                item.put("alerts_checked", r.get("alerts_checked"));
                yield one(item);
            }
            case "data.query" -> {
                String app = appFor(p, owner, false);
                String[] ms = measure(p.str("measure"));
                Map<String, Object> r = ask.measure(app, ms[0], ms[1], p.strOrNull("label"), p.strOrNull("dimension"), sel(p.raw("filters")));
                if (r.get("rows") instanceof List<?> rows) {
                    @SuppressWarnings("unchecked") List<Map<String, Object>> list = (List<Map<String, Object>>) rows;
                    Integer top = p.intOrNull("top");
                    if (top != null && top > 0 && list.size() > top) list = new ArrayList<>(list.subList(0, top));
                    for (Map<String, Object> row : list) row.put("measure", r.get("label"));
                    yield Map.of("out", list);
                }
                yield one(new LinkedHashMap<>(Map.of("label", String.valueOf(r.get("label")), "value", r.get("value") == null ? 0.0 : r.get("value"))));
            }
            case "data.rows" -> {
                String app = appFor(p, owner, false);
                Map<String, Object> q = new LinkedHashMap<>();
                if (p.strOrNull("table") != null) q.put("table", p.str("table"));
                q.put("selections", sel(p.raw("filters")));
                if (p.strOrNull("where") != null) q.put("where", p.str("where"));
                List<String> fl = Arrays.stream(p.str("fields").split(",")).map(String::trim).filter(s -> !s.isEmpty()).toList();
                if (!fl.isEmpty()) q.put("fields", fl);
                if (p.strOrNull("sort") != null) { q.put("sort", p.str("sort")); q.put("desc", true); }
                Integer lim = p.intOrNull("limit");
                q.put("limit", lim == null ? 100 : Math.min(MAX_ITEMS, Math.max(1, lim)));
                Map<String, Object> r = insights.rows(app, q);
                @SuppressWarnings("unchecked") List<String> cols = (List<String>) r.get("columns");
                @SuppressWarnings("unchecked") List<List<String>> rows = (List<List<String>>) r.get("rows");
                List<Map<String, Object>> items = new ArrayList<>();
                for (List<String> row : rows) {
                    Map<String, Object> it = new LinkedHashMap<>();
                    for (int i = 0; i < cols.size(); i++) it.put(cols.get(i), typed(i < row.size() ? row.get(i) : null));
                    items.add(it);
                }
                step.put("note", r.get("total") + " registro(s) de " + r.get("table"));
                yield Map.of("out", items);
            }
            case "data.ask" -> {
                String app = appFor(p, owner, false);
                Map<String, Object> r = ask.ask(app, p.str("question"));
                if (!Boolean.TRUE.equals(r.get("ok"))) throw new FlowException("No entendí la pregunta: " + r.get("message"));
                Map<String, Object> item = new LinkedHashMap<>();
                item.put("question", r.get("question"));
                item.put("answer", r.get("answer"));
                @SuppressWarnings("unchecked") Map<String, Object> res = (Map<String, Object>) r.get("result");
                item.putAll(res);
                @SuppressWarnings("unchecked") Map<String, Object> how = (Map<String, Object>) r.get("how");
                item.put("how", String.join(" · ", (List<String>) how.get("steps")));
                yield one(item);
            }
            case "data.explain" -> {
                String app = appFor(p, owner, false);
                String[] ms = measure(p.str("measure"));
                Map<String, Object> q = new LinkedHashMap<>();
                if (ms[0] != null) q.put("master_id", ms[0]); else q.put("expression", ms[1]);
                if (p.strOrNull("label") != null) q.put("label", p.str("label"));
                q.put("selections", sel(p.raw("filters")));
                Map<String, Object> r = insights.explain(app, q);
                Map<String, Object> item = new LinkedHashMap<>();
                @SuppressWarnings("unchecked") List<String> story = (List<String>) r.get("story");
                item.put("story", String.join(" ", story));
                item.put("headline", story.isEmpty() ? "" : story.get(0));
                for (String k : List.of("current", "previous", "current_value", "previous_value", "delta", "delta_pct")) item.put(k, r.get(k));
                item.put("drivers", r.get("drivers"));
                yield one(item);
            }
            case "data.health" -> {
                String app = appFor(p, owner, false);
                Map<String, Object> h = health.health(app);
                @SuppressWarnings("unchecked") List<Map<String, Object>> issues = (List<Map<String, Object>>) h.get("issues");
                Map<String, Object> item = new LinkedHashMap<>();
                item.put("app", appName(app));
                item.put("score", h.get("score"));
                item.put("status", h.get("status"));
                item.put("critical", issues.stream().filter(i -> "critical".equals(i.get("severity"))).count());
                item.put("warnings", issues.stream().filter(i -> "warning".equals(i.get("severity"))).count());
                item.put("issues_text", String.join("\n", issues.stream().limit(10).map(i -> "• " + (i.get("table") == null ? "" : i.get("table") + ": ") + i.get("message")).toList()));
                item.put("issues", issues);
                yield one(item);
            }
            case "data.whatif" -> {
                String app = appFor(p, owner, false);
                String[] ms = measure(p.str("measure"));
                Map<String, Object> m = new LinkedHashMap<>();
                if (ms[0] != null) m.put("master_id", ms[0]); else m.put("expression", ms[1]);
                if (p.strOrNull("label") != null) m.put("label", p.str("label"));
                Map<String, Object> ch = new LinkedHashMap<>();
                ch.put("field", p.str("field")); ch.put("op", p.str("op").isBlank() ? "set" : p.str("op")); ch.put("value", p.str("value"));
                Integer share = p.intOrNull("share");
                if (share != null) ch.put("share", share);
                ch.put("selections", sel(p.raw("filters")));
                Map<String, Object> r = insights.whatIf(app, Map.of("measures", List.of(m), "changes", List.of(ch)));
                @SuppressWarnings("unchecked") Map<String, Object> r0 = ((List<Map<String, Object>>) r.get("results")).get(0);
                Map<String, Object> item = new LinkedHashMap<>(r0);
                @SuppressWarnings("unchecked") List<String> story = (List<String>) r.get("story");
                item.put("story", String.join(" ", story));
                yield one(item);
            }
            case "ai.agent" -> one(agent(p, input, owner, step));
            case "logic.if" -> {
                List<Map<String, Object>> yes = new ArrayList<>(), no = new ArrayList<>();
                for (Map<String, Object> it : input) (cond(node, it, c) ? yes : no).add(it);
                step.put("note", yes.size() + " por «sí», " + no.size() + " por «no»");
                Map<String, List<Map<String, Object>>> out = new LinkedHashMap<>();
                out.put("true", yes); out.put("false", no);
                yield out;
            }
            case "logic.filter" -> {
                List<Map<String, Object>> keep = new ArrayList<>();
                for (Map<String, Object> it : input) if (cond(node, it, c)) keep.add(it);
                step.put("note", keep.size() + " de " + input.size() + " pasan");
                yield Map.of("out", keep);
            }
            case "logic.set" -> {
                boolean keepOld = !Boolean.FALSE.equals(p.raw("keep"));
                List<Map<String, Object>> out = new ArrayList<>();
                for (Map<String, Object> it : input) {
                    Templates.Ctx ci = item(c, it);
                    Map<String, Object> o = keepOld ? new LinkedHashMap<>(it) : new LinkedHashMap<>();
                    for (Map.Entry<String, Object> kv : kv(p.raw("fields")).entrySet()) o.put(kv.getKey(), Templates.resolve(kv.getValue(), ci));
                    out.add(o);
                }
                yield Map.of("out", out);
            }
            case "logic.aggregate" -> {
                Map<String, Object> o = new LinkedHashMap<>();
                o.put("count", input.size());
                o.put("items", input);
                o.put("table", Templates.table(input));
                yield one(o);
            }
            case "logic.wait" -> {
                Integer s = p.intOrNull("seconds");
                Thread.sleep(Math.max(0, Math.min(300, s == null ? 1 : s)) * 1000L);
                yield Map.of("out", input);
            }
            case "action.email" -> Map.of("out", perItem(p, input, c, (pi, it) -> email(pi, input, owner)));
            case "action.whatsapp" -> Map.of("out", perItem(p, input, c, (pi, it) -> whatsapp(pi, owner)));
            case "action.chat" -> {
                Map<String, Object> cfg = credential(p.str("credential"), "webhook", owner);
                String text = p.str("text");
                HttpResponse<String> r = send("POST", str(cfg.get("url")), Map.of("Content-Type", "application/json"), mapper.writeValueAsString(Map.of("text", text)));
                if (r.statusCode() >= 300) throw new FlowException("El canal respondió HTTP " + r.statusCode() + ": " + clip(r.body(), 200));
                yield one(new LinkedHashMap<>(Map.of("sent", true, "status", r.statusCode(), "text", text)));
            }
            case "action.http" -> {
                String url = p.str("url");
                Map<String, String> headers = new LinkedHashMap<>();
                kv(p.raw("headers")).forEach((k, v) -> headers.put(k, Templates.renderText(String.valueOf(v), c)));
                String credId = p.strOrNull("credential");
                if (credId != null) { Map<String, Object> cfg = credential(credId, "http", owner); headers.put(str(cfg.get("header")), str(cfg.get("value"))); }
                String body = p.strOrNull("body");
                String method = p.str("method").isBlank() ? "POST" : p.str("method").toUpperCase(Locale.ROOT);
                if (body != null && headers.keySet().stream().noneMatch(h -> h.equalsIgnoreCase("Content-Type")))
                    headers.put("Content-Type", body.trim().startsWith("{") || body.trim().startsWith("[") ? "application/json" : "text/plain");
                HttpResponse<String> r = send(method, url, headers, body);
                Map<String, Object> item = new LinkedHashMap<>();
                item.put("status", r.statusCode());
                item.put("ok", r.statusCode() < 400);
                Object parsed = null;
                try { parsed = mapper.readValue(r.body(), Object.class); } catch (Exception ignored) {}
                item.put("body", parsed != null ? parsed : clip(r.body(), 20000));
                if (r.statusCode() >= 400) throw new FlowException("La API respondió HTTP " + r.statusCode() + ": " + clip(r.body(), 300));
                yield one(item);
            }
            case "action.notify" -> {
                notifications.addEvent("flow", p.str("title"), "Automatización «" + flow.get("name") + "» · " + clip(p.str("message"), 280),
                        null, String.valueOf(flow.get("id")), null, owner.id());
                yield Map.of("out", input);
            }
            default -> throw new FlowException("Tipo de nodo desconocido: " + type);
        };
    }

    /* ---------------------------- agente ---------------------------- */

    private static final Map<String, String> ROLES = Map.of(
            "analyst", "Eres un analista de datos senior. Lees cifras, detectas lo importante y lo explicas en lenguaje de negocio, con números concretos y sin inventar datos.",
            "writer", "Eres un redactor corporativo. Escribes mensajes claros, cordiales y breves (correo o WhatsApp) a partir de los datos que recibes. Sin relleno, con una acción concreta.",
            "classifier", "Eres un clasificador. Asignas a cada caso una prioridad (alta, media, baja) y un motivo corto, con criterios explícitos y consistentes.",
            "hr", "Eres experto en rotación de personal y retención de conductores. Interpretas la rotación, la probabilidad de retiro y sus causas, y propones acciones de retención concretas y realistas.",
            "custom", "Eres un asistente experto que trabaja dentro de una automatización de PROTHEO.");

    private static final Pattern TOOL = Pattern.compile("(?s)HERRAMIENTA\\s*:\\s*(\\{.*?\\})\\s*$");

    @SuppressWarnings("unchecked")
    private Map<String, Object> agent(P p, List<Map<String, Object>> input, UserRecord owner, Map<String, Object> step) throws Exception {
        String role = p.str("role").isBlank() ? "analyst" : p.str("role");
        String app = p.strOrNull("app");
        if (app != null) app = appFor(p, owner, false);
        boolean json = "json".equals(p.str("format"));
        StringBuilder sys = new StringBuilder(ROLES.getOrDefault(role, ROLES.get("custom")));
        if (p.strOrNull("instructions") != null) sys.append("\n\nInstrucciones: ").append(p.str("instructions"));
        sys.append("\n\nResponde siempre en español.");
        if (app != null) {
            sys.append("\n\nPuedes consultar la aplicación «").append(appName(app)).append("» con herramientas. Para usar una, responde SOLO una línea:\n")
               .append("HERRAMIENTA: {\"tool\": \"preguntar\", \"input\": \"pregunta en español, p. ej. % de inactivos por sucursal\"}\n")
               .append("HERRAMIENTA: {\"tool\": \"registros\", \"where\": \"[campo] > 10\", \"filters\": {\"CAMPO\": [\"valor\"]}, \"fields\": \"c1, c2\", \"limit\": 20}\n")
               .append("HERRAMIENTA: {\"tool\": \"que_cambio\", \"measure\": \"expresión fx\"}\n")
               .append("Recibirás el resultado y podrás seguir (máximo 4 herramientas). Cuando tengas la respuesta final, escríbela sin la palabra HERRAMIENTA.");
            try {
                String ctx = notes.contextFor(app);
                if (!ctx.isBlank()) sys.append("\n\nDiccionario de datos de la app:\n").append(clip(ctx, 4000));
            } catch (RuntimeException ignored) {}
        }
        if (json) sys.append("\n\nTu respuesta final debe ser SOLO un objeto JSON válido, sin texto antes ni después.");
        StringBuilder user = new StringBuilder(p.str("prompt"));
        if (!Boolean.FALSE.equals(p.raw("include_input")) && !input.isEmpty() && !(input.size() == 1 && input.get(0).isEmpty())) {
            String data = mapper.writeValueAsString(input.size() > 60 ? input.subList(0, 60) : input);
            user.append("\n\nDatos recibidos (").append(input.size()).append(" registro(s)):\n").append(clip(data, 12000));
        }
        List<Map<String, Object>> calls = new ArrayList<>();
        String answer = null;
        String convo = user.toString();
        for (int i = 0; i < 5; i++) {
            BedrockService.AiResult r = bedrock.converse(sys.toString(), convo);
            if (!r.ok()) throw new FlowException("El agente de IA no respondió: " + r.message());
            String txt = r.text().trim();
            Matcher m = TOOL.matcher(txt);
            if (app != null && m.find() && i < 4) {
                Map<String, Object> call;
                try { call = mapper.readValue(m.group(1), new TypeReference<Map<String, Object>>() {}); }
                catch (Exception e) { convo += "\n\nAsistente: " + txt + "\n\nSistema: la llamada a la herramienta no es JSON válido; corrígela o responde."; continue; }
                String result = tool(app, call);
                calls.add(Map.of("tool", String.valueOf(call.get("tool")), "input", call, "result", clip(result, 600)));
                convo += "\n\nAsistente: " + txt + "\n\nResultado de la herramienta:\n" + clip(result, 5000);
                continue;
            }
            answer = txt;
            break;
        }
        if (answer == null) answer = "(El agente no llegó a una respuesta final.)";
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("text", answer);
        if (json) {
            String j = answer.replaceAll("(?s)^```(json)?\\s*|\\s*```$", "").trim();
            int a = j.indexOf('{'), b = j.lastIndexOf('}');
            try { if (a >= 0 && b > a) out.putAll(mapper.readValue(j.substring(a, b + 1), new TypeReference<Map<String, Object>>() {})); }
            catch (Exception e) { out.put("json_error", "La respuesta no era JSON válido."); }
        }
        out.put("tools_used", calls);
        step.put("note", calls.isEmpty() ? "sin herramientas" : calls.size() + " herramienta(s): " + String.join(", ", calls.stream().map(x -> String.valueOf(x.get("tool"))).toList()));
        return out;
    }

    @SuppressWarnings("unchecked")
    private String tool(String app, Map<String, Object> call) {
        try {
            switch (str(call.get("tool"))) {
                case "preguntar": {
                    Map<String, Object> r = ask.ask(app, str(call.get("input")));
                    if (!Boolean.TRUE.equals(r.get("ok"))) return "No entendí: " + r.get("message") + " Sugerencias: " + r.get("suggestions");
                    return r.get("answer") + "\nDatos: " + mapper.writeValueAsString(r.get("result"));
                }
                case "registros": {
                    Map<String, Object> q = new LinkedHashMap<>();
                    if (call.get("filters") != null) q.put("selections", call.get("filters"));
                    if (call.get("where") != null) q.put("where", call.get("where"));
                    if (call.get("fields") != null) q.put("fields", Arrays.stream(str(call.get("fields")).split(",")).map(String::trim).filter(s -> !s.isEmpty()).toList());
                    q.put("limit", Math.min(50, call.get("limit") == null ? 20 : (int) Double.parseDouble(str(call.get("limit")))));
                    Map<String, Object> r = insights.rows(app, q);
                    return r.get("total") + " registro(s) en " + r.get("table") + ". Columnas: " + r.get("columns") + "\nFilas: " + mapper.writeValueAsString(r.get("rows"));
                }
                case "que_cambio": {
                    Map<String, Object> r = insights.explain(app, Map.of("expression", str(call.get("measure"))));
                    return String.join(" ", (List<String>) r.get("story"));
                }
                default: return "Herramienta desconocida. Usa preguntar, registros o que_cambio.";
            }
        } catch (Exception e) {
            return "Error de la herramienta: " + e.getMessage();
        }
    }

    /* ---------------------------- correo ---------------------------- */

    private Map<String, Object> email(P p, List<Map<String, Object>> all, UserRecord owner) throws Exception {
        Map<String, Object> cfg = credential(p.str("credential"), "smtp", owner);
        JavaMailSenderImpl s = new JavaMailSenderImpl();
        s.setHost(str(cfg.get("host")));
        s.setPort(cfg.get("port") == null || str(cfg.get("port")).isBlank() ? 587 : Integer.parseInt(str(cfg.get("port")).trim()));
        s.setUsername(blank(cfg.get("user")));
        s.setPassword(blank(cfg.get("password")));
        s.setDefaultEncoding("UTF-8");
        Properties props = s.getJavaMailProperties();
        String sec = str(cfg.getOrDefault("security", "starttls")).toLowerCase(Locale.ROOT);
        props.put("mail.smtp.auth", String.valueOf(blank(cfg.get("user")) != null));
        props.put("mail.smtp.connectiontimeout", "10000");
        props.put("mail.smtp.timeout", "15000");
        props.put("mail.smtp.writetimeout", "15000");
        if ("ssl".equals(sec)) props.put("mail.smtp.ssl.enable", "true");
        if ("starttls".equals(sec)) { props.put("mail.smtp.starttls.enable", "true"); props.put("mail.smtp.starttls.required", "true"); }
        MimeMessage msg = s.createMimeMessage();
        boolean attach = Boolean.TRUE.equals(p.raw("attach_csv")) && !all.isEmpty();
        MimeMessageHelper h = new MimeMessageHelper(msg, attach, "UTF-8");
        String from = blank(cfg.get("from"));
        h.setFrom(from != null ? from : str(cfg.get("user")));
        List<String> to = list(p.str("to"));
        if (to.isEmpty()) throw new FlowException("Falta el destinatario («Para»).");
        h.setTo(to.toArray(new String[0]));
        List<String> cc = list(p.str("cc"));
        if (!cc.isEmpty()) h.setCc(cc.toArray(new String[0]));
        h.setSubject(p.str("subject"));
        String body = p.str("body");
        boolean html = body.contains("<") && body.contains(">");
        h.setText(html ? "<div style=\"font:14px Segoe UI,Arial,sans-serif;color:#1f2937\">" + body + "</div>" : body, html);
        if (attach) h.addAttachment("registros.csv", new ByteArrayResource(csv(all).getBytes(StandardCharsets.UTF_8)), "text/csv");
        try { s.send(msg); }
        catch (Exception e) { throw new FlowException("No se pudo enviar el correo: " + rootMessage(e)); }
        return new LinkedHashMap<>(Map.of("sent", true, "to", String.join(", ", to), "subject", p.str("subject")));
    }

    private static String csv(List<Map<String, Object>> rows) {
        LinkedHashSet<String> cols = new LinkedHashSet<>();
        rows.forEach(r -> cols.addAll(r.keySet()));
        StringBuilder sb = new StringBuilder("\uFEFF").append(String.join(";", cols)).append("\r\n");
        for (Map<String, Object> r : rows) {
            List<String> v = new ArrayList<>();
            for (String c : cols) {
                String s = Templates.text(r.get(c));
                if (!s.isEmpty() && "=+-@".indexOf(s.charAt(0)) >= 0 && Templates.num(s) == null) s = "'" + s;
                v.add(s.contains(";") || s.contains("\"") || s.contains("\n") ? "\"" + s.replace("\"", "\"\"") + "\"" : s);
            }
            sb.append(String.join(";", v)).append("\r\n");
        }
        return sb.toString();
    }

    /* ---------------------------- WhatsApp ---------------------------- */

    private Map<String, Object> whatsapp(P p, UserRecord owner) throws Exception {
        String credId = p.str("credential");
        Map<String, Object> row = repo.credentialRaw(credId).orElseThrow(() -> new FlowException("La cuenta de WhatsApp elegida ya no existe."));
        if (!owner.id().equals(row.get("owner_id"))) throw new FlowException("La cuenta de WhatsApp no es tuya.");
        String kind = str(row.get("kind"));
        Map<String, Object> cfg = repo.credentialConfig(row);
        List<String> to = list(p.str("to"));
        if (to.isEmpty()) throw new FlowException("Falta el número de destino.");
        String message = p.str("message");
        List<Object> ids = new ArrayList<>();
        for (String num : to) {
            String n = num.replaceAll("[^0-9+]", "");
            HttpResponse<String> r;
            if ("whatsapp_meta".equals(kind)) {
                String base = blank(cfg.get("api_base")) == null ? "https://graph.facebook.com/v20.0" : str(cfg.get("api_base")).replaceAll("/+$", "");
                Map<String, Object> body = new LinkedHashMap<>();
                body.put("messaging_product", "whatsapp");
                body.put("to", n.replace("+", ""));
                String tpl = p.strOrNull("template");
                if (tpl != null) { body.put("type", "template"); body.put("template", Map.of("name", tpl, "language", Map.of("code", "es"))); }
                else { body.put("type", "text"); body.put("text", Map.of("preview_url", false, "body", message)); }
                r = send("POST", base + "/" + str(cfg.get("phone_number_id")) + "/messages",
                        Map.of("Content-Type", "application/json", "Authorization", "Bearer " + str(cfg.get("token"))), mapper.writeValueAsString(body));
            } else if ("whatsapp_twilio".equals(kind)) {
                String base = blank(cfg.get("api_base")) == null ? "https://api.twilio.com" : str(cfg.get("api_base")).replaceAll("/+$", "");
                String sid = str(cfg.get("account_sid"));
                String form = "From=" + enc(str(cfg.get("from")).startsWith("whatsapp:") ? str(cfg.get("from")) : "whatsapp:" + str(cfg.get("from")))
                        + "&To=" + enc("whatsapp:" + (n.startsWith("+") ? n : "+" + n)) + "&Body=" + enc(message);
                String auth = Base64.getEncoder().encodeToString((sid + ":" + str(cfg.get("auth_token"))).getBytes(StandardCharsets.UTF_8));
                r = send("POST", base + "/2010-04-01/Accounts/" + enc(sid) + "/Messages.json",
                        Map.of("Content-Type", "application/x-www-form-urlencoded", "Authorization", "Basic " + auth), form);
            } else throw new FlowException("La credencial elegida no es de WhatsApp.");
            if (r.statusCode() >= 300) throw new FlowException("WhatsApp respondió HTTP " + r.statusCode() + " para " + n + ": " + clip(r.body(), 300));
            ids.add(n);
        }
        return new LinkedHashMap<>(Map.of("sent", true, "to", ids, "message", message));
    }

    /* ---------------------------- utilidades ---------------------------- */

    interface ItemAction { Map<String, Object> apply(P p, Map<String, Object> item) throws Exception; }

    /** Acción una vez (con el primer registro como $json) o, si {@code per_item}, una por registro. */
    private List<Map<String, Object>> perItem(P p, List<Map<String, Object>> input, Templates.Ctx c, ItemAction a) throws Exception {
        List<Map<String, Object>> out = new ArrayList<>();
        if (Boolean.TRUE.equals(p.raw("per_item"))) {
            if (input.size() > 500) throw new FlowException("Demasiados registros para enviar uno por uno (" + input.size() + "; máximo 500).");
            for (Map<String, Object> it : input) {
                Map<String, Object> r = a.apply(new P(p.node, item(c, it)), it);
                Map<String, Object> o = new LinkedHashMap<>(it); o.putAll(r); out.add(o);
            }
        } else out.add(a.apply(p, c.json()));
        return out;
    }

    private static Templates.Ctx item(Templates.Ctx c, Map<String, Object> it) {
        return new Templates.Ctx(it, c.items(), c.nodes(), c.trigger(), c.flow(), c.runId());
    }

    private boolean cond(Map<String, Object> node, Map<String, Object> it, Templates.Ctx c) {
        Templates.Ctx ci = item(c, it);
        Object l = Templates.resolve(param(node, "left"), ci), r = Templates.resolve(param(node, "right"), ci);
        String op = str(param(node, "op"));
        if (op.isBlank()) op = "=";
        String ls = Templates.text(l), rs = Templates.text(r);
        Double ln = Templates.num(l), rn = Templates.num(r);
        int cmp = ln != null && rn != null ? Double.compare(ln, rn) : ls.compareToIgnoreCase(rs);
        return switch (op) {
            case "=" -> cmp == 0; case "!=" -> cmp != 0; case ">" -> cmp > 0; case ">=" -> cmp >= 0; case "<" -> cmp < 0; case "<=" -> cmp <= 0;
            case "contains" -> ls.toLowerCase(Locale.ROOT).contains(rs.toLowerCase(Locale.ROOT));
            case "empty" -> ls.isBlank() || "[]".equals(ls) || "0".equals(ls);
            case "not_empty" -> !(ls.isBlank() || "[]".equals(ls) || "0".equals(ls));
            default -> false;
        };
    }

    /** App del nodo, verificando que el dueño del flujo pueda verla (y recargarla si {@code write}). */
    private String appFor(P p, UserRecord owner, boolean write) {
        String app = p.str("app");
        if (app.isBlank()) throw new FlowException("Elige la aplicación.");
        var a = apps.getApp(app).orElseThrow(() -> new FlowException("La aplicación elegida ya no existe."));
        if (!access.canSee(owner, a)) throw new FlowException("No tienes acceso a la aplicación «" + a.name() + "».");
        if (write && !(owner.has(Permissions.DATA) && access.canWrite(owner, a)))
            throw new FlowException("Recargar «" + a.name() + "» requiere el permiso de importar datos y poder modificar la app.");
        return app;
    }

    private String appName(String app) { return apps.getApp(app).map(a -> a.name()).orElse(app); }

    private Map<String, Object> credential(String id, String want, UserRecord owner) {
        if (id == null || id.isBlank()) throw new FlowException("Elige la credencial del nodo.");
        Map<String, Object> row = repo.credentialRaw(id).orElseThrow(() -> new FlowException("La credencial elegida ya no existe."));
        if (!owner.id().equals(row.get("owner_id"))) throw new FlowException("La credencial no es tuya.");
        if (!FlowCatalog.credentialFits(want, str(row.get("kind")))) throw new FlowException("La credencial «" + row.get("name") + "» no sirve para este nodo.");
        return repo.credentialConfig(row);
    }

    private HttpResponse<String> send(String method, String url, Map<String, String> headers, String body) throws Exception {
        URI u;
        try { u = URI.create(url.trim()); } catch (Exception e) { throw new FlowException("URL no válida: " + url); }
        String sc = u.getScheme() == null ? "" : u.getScheme().toLowerCase(Locale.ROOT);
        if (!sc.equals("http") && !sc.equals("https")) throw new FlowException("Solo se admiten URLs http(s).");
        HttpRequest.Builder b = HttpRequest.newBuilder(u).timeout(Duration.ofSeconds(20)).header("User-Agent", "PROTHEO-Automatizaciones");
        headers.forEach((k, v) -> { if (k != null && !k.isBlank()) b.header(k, v == null ? "" : v); });
        HttpRequest.BodyPublisher pub = body == null || body.isEmpty() ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(body);
        b.method(method, "GET".equals(method) || "DELETE".equals(method) && (body == null || body.isEmpty()) ? HttpRequest.BodyPublishers.noBody() : pub);
        try { return http.send(b.build(), HttpResponse.BodyHandlers.ofString()); }
        catch (java.io.IOException e) { throw new FlowException("No se pudo conectar con " + u.getHost() + ": " + rootMessage(e)); }
    }

    /** "m:<id>" → maestra; si no, expresión fx. */
    static String[] measure(String v) {
        if (v == null || v.isBlank()) throw new FlowException("Elige la medida.");
        return v.startsWith("m:") ? new String[]{v.substring(2), null} : new String[]{null, v};
    }

    @SuppressWarnings("unchecked")
    private Map<String, List<Object>> sel(Object o) {
        Object v = o;
        if (v instanceof String s) { if (s.isBlank()) return Map.of(); v = json(s, "Filtros"); }
        Map<String, List<Object>> out = new LinkedHashMap<>();
        if (v instanceof Map<?, ?> m) m.forEach((k, x) -> {
            if (x instanceof List<?> l) { if (!l.isEmpty()) out.put(String.valueOf(k), new ArrayList<>((List<Object>) l)); }
            else if (x != null && !String.valueOf(x).isBlank()) out.put(String.valueOf(k), List.of(String.valueOf(x)));
        });
        return out;
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> json(Object o, String what) {
        if (o instanceof Map<?, ?> m) return (Map<String, Object>) m;
        try { return mapper.readValue(String.valueOf(o), new TypeReference<Map<String, Object>>() {}); }
        catch (Exception e) { throw new FlowException(what + ": no es un JSON válido (" + clip(e.getMessage(), 120) + ")."); }
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> kv(Object o) {
        Map<String, Object> out = new LinkedHashMap<>();
        if (o instanceof Map<?, ?> m) m.forEach((k, v) -> { if (k != null && !String.valueOf(k).isBlank()) out.put(String.valueOf(k), v); });
        else if (o instanceof List<?> l) for (Object e : l) if (e instanceof Map<?, ?> m && m.get("key") != null && !String.valueOf(m.get("key")).isBlank()) out.put(String.valueOf(m.get("key")), m.get("value"));
        return out;
    }

    private static Object typed(String v) {
        if (v == null) return null;
        Double d = Templates.num(v);
        return d != null && v.trim().matches("-?[\\d,]*\\.?\\d+") && !(v.length() > 1 && v.startsWith("0") && !v.startsWith("0.")) ? (Object) d : v;
    }

    private static Map<String, List<Map<String, Object>>> one(Map<String, Object> item) { return Map.of("out", List.of(item)); }

    private static List<String> list(String s) { return s == null ? List.of() : Arrays.stream(s.split("[,;]")).map(String::trim).filter(x -> !x.isEmpty()).toList(); }
    static String str(Object o) { return o == null ? "" : String.valueOf(o); }
    private static String blank(Object o) { String s = str(o).trim(); return s.isEmpty() ? null : s; }
    static String clip(String s, int n) { return s == null ? "" : s.length() <= n ? s : s.substring(0, n) + "…"; }
    private static String enc(String s) { return URLEncoder.encode(s, StandardCharsets.UTF_8); }
    private static String rootMessage(Throwable e) { Throwable t = e; while (t.getCause() != null && t.getCause() != t) t = t.getCause(); return t.getMessage() == null ? t.getClass().getSimpleName() : t.getMessage(); }

    /** Parámetros del nodo con las plantillas ya resueltas para el registro actual. */
    static final class P {
        final Map<String, Object> node;
        final Templates.Ctx c;
        P(Map<String, Object> node, Templates.Ctx c) { this.node = node; this.c = c; }
        Object raw(String k) { Object v = param(node, k); return v instanceof String s ? Templates.render(s, c) : Templates.resolve(v, c); }
        String str(String k) { return Templates.text(raw(k)).trim(); }
        String strOrNull(String k) { String s = str(k); return s.isEmpty() ? null : s; }
        Integer intOrNull(String k) { Double d = Templates.num(raw(k)); return d == null ? null : d.intValue(); }
    }

    /** Error legible de un nodo. */
    public static class FlowException extends RuntimeException {
        public FlowException(String m) { super(m); }
    }
}
