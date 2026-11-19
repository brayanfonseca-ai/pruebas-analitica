package io.datasense.flow;

import io.datasense.auth.UserRecord;
import io.datasense.auth.UserRepository;
import io.datasense.automation.AutomationEvents;
import io.datasense.repo.Ids;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.*;
import java.time.temporal.ChronoUnit;
import java.time.temporal.TemporalAdjusters;
import java.util.*;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Ciclo de vida de las automatizaciones: validar y guardar el grafo, activar/pausar, el reloj de los disparadores
 * programados, los disparadores por evento (recarga de datos, alerta) y por webhook, y la galería de plantillas.
 * Las ejecuciones por evento corren en segundo plano (no bloquean la recarga que las disparó).
 */
@Service
public class FlowService {

    private static final Logger log = LoggerFactory.getLogger(FlowService.class);

    private final FlowRepository repo;
    private final FlowEngine engine;
    private final UserRepository users;
    private final ExecutorService pool = Executors.newFixedThreadPool(3, r -> { Thread t = new Thread(r, "flow-run"); t.setDaemon(true); return t; });

    public FlowService(FlowRepository repo, FlowEngine engine, UserRepository users) {
        this.repo = repo;
        this.engine = engine;
        this.users = users;
    }

    /* ------------------------------ validación ------------------------------ */

    /** Normaliza y valida el grafo; devuelve la lista de avisos (vacía = listo para activar). */
    @SuppressWarnings("unchecked")
    public Map<String, Object> normalize(Object graphObj) {
        if (!(graphObj instanceof Map<?, ?> gm)) throw new IllegalArgumentException("El flujo necesita un grafo {nodes, edges}.");
        List<Map<String, Object>> nodes = new ArrayList<>(), edges = new ArrayList<>();
        Set<String> ids = new HashSet<>(), names = new HashSet<>();
        for (Object o : gm.get("nodes") instanceof List<?> l ? l : List.of()) {
            if (!(o instanceof Map<?, ?> m)) continue;
            Map<String, Object> n = new LinkedHashMap<>((Map<String, Object>) m);
            String type = FlowEngine.str(n.get("type"));
            if (!FlowCatalog.BY_TYPE.containsKey(type)) throw new IllegalArgumentException("Tipo de nodo desconocido: «" + type + "».");
            String id = FlowEngine.str(n.get("id")).isBlank() ? "n" + Ids.newId().substring(0, 8) : FlowEngine.str(n.get("id"));
            if (!ids.add(id)) throw new IllegalArgumentException("Hay dos nodos con el id «" + id + "».");
            n.put("id", id);
            String name = FlowEngine.str(n.get("name")).strip();
            if (name.isEmpty()) name = String.valueOf(FlowCatalog.BY_TYPE.get(type).get("label"));
            String base = name; int k = 2;
            while (!names.add(name.toLowerCase(Locale.ROOT))) name = base + " " + k++;
            n.put("name", name);
            if (!(n.get("params") instanceof Map)) n.put("params", new LinkedHashMap<>());
            n.putIfAbsent("x", 80); n.putIfAbsent("y", 80);
            nodes.add(n);
        }
        if (nodes.size() > 80) throw new IllegalArgumentException("Un flujo admite hasta 80 nodos.");
        for (Object o : gm.get("edges") instanceof List<?> l ? l : List.of()) {
            if (!(o instanceof Map<?, ?> m)) continue;
            String from = FlowEngine.str(m.get("from")), to = FlowEngine.str(m.get("to"));
            String port = FlowEngine.str(m.get("port")).isBlank() ? "out" : FlowEngine.str(m.get("port"));
            if (!ids.contains(from) || !ids.contains(to) || from.equals(to)) continue;
            Map<String, Object> fn = nodes.stream().filter(x -> from.equals(x.get("id"))).findFirst().get();
            Map<String, Object> tn = nodes.stream().filter(x -> to.equals(x.get("id"))).findFirst().get();
            List<String> outs = (List<String>) FlowCatalog.BY_TYPE.get(fn.get("type")).get("outputs");
            if (!outs.contains(port)) throw new IllegalArgumentException("El nodo «" + fn.get("name") + "» no tiene la salida «" + port + "».");
            if (!Boolean.TRUE.equals(FlowCatalog.BY_TYPE.get(tn.get("type")).get("input")))
                throw new IllegalArgumentException("«" + tn.get("name") + "» es un disparador: no puede recibir conexiones.");
            if (edges.stream().anyMatch(e -> from.equals(e.get("from")) && port.equals(e.get("port")) && to.equals(e.get("to")))) continue;
            edges.add(new LinkedHashMap<>(Map.of("from", from, "port", port, "to", to)));
        }
        Map<String, Object> g = new LinkedHashMap<>();
        g.put("nodes", nodes);
        g.put("edges", edges);
        return g;
    }

    /** Avisos del grafo: sin disparador, nodos sueltos, parámetros obligatorios vacíos. */
    @SuppressWarnings("unchecked")
    public List<String> problems(Map<String, Object> g) {
        List<String> out = new ArrayList<>();
        List<Map<String, Object>> nodes = FlowRepository.nodes(g), edges = FlowRepository.edges(g);
        long triggers = nodes.stream().filter(n -> String.valueOf(n.get("type")).startsWith("trigger.")).count();
        if (triggers == 0) out.add("Agrega un disparador (cuándo empieza el flujo).");
        if (triggers > 1) out.add("Hay " + triggers + " disparadores: el flujo arranca por cualquiera de ellos.");
        for (Map<String, Object> n : nodes) {
            String type = String.valueOf(n.get("type"));
            boolean hasIn = edges.stream().anyMatch(e -> n.get("id").equals(e.get("to")));
            if (!type.startsWith("trigger.") && !hasIn) out.add("«" + n.get("name") + "» no está conectado: nunca se ejecutará.");
            Map<String, Object> params = (Map<String, Object>) n.get("params");
            for (Map<String, Object> pdef : (List<Map<String, Object>>) FlowCatalog.BY_TYPE.get(type).get("params")) {
                if (!Boolean.TRUE.equals(pdef.get("required"))) continue;
                Object v = params.get(pdef.get("key"));
                if (pdef.get("show_if") instanceof Map<?, ?> si && !((List<?>) si.get("values")).contains(String.valueOf(params.getOrDefault(si.get("key"), "")))) continue;
                if (v == null || String.valueOf(v).isBlank()) out.add("«" + n.get("name") + "»: falta «" + pdef.get("label") + "».");
            }
        }
        return out;
    }

    /* ------------------------------ activar ------------------------------ */

    @SuppressWarnings("unchecked")
    public void setEnabled(String id, boolean on) {
        Map<String, Object> f = repo.raw(id).orElseThrow();
        if (on) {
            List<String> pr = problems(repo.graph(f)).stream().filter(s -> !s.startsWith("Hay ")).toList();
            if (!pr.isEmpty()) throw new IllegalArgumentException("Antes de activarlo: " + String.join(" ", pr));
        }
        repo.setEnabled(id, on, on ? nextRun(repo.graph(f), Instant.now()) : null);
    }

    /** Próxima ejecución del disparador programado (null si el flujo no tiene). */
    @SuppressWarnings("unchecked")
    static String nextRun(Map<String, Object> g, Instant from) {
        for (Map<String, Object> n : FlowRepository.nodes(g)) {
            if (!"trigger.schedule".equals(n.get("type"))) continue;
            Map<String, Object> p = (Map<String, Object>) n.get("params");
            String mode = FlowEngine.str(p.getOrDefault("mode", "daily"));
            ZoneId z = ZoneId.systemDefault();
            ZonedDateTime now = from.atZone(z);
            switch (mode) {
                case "interval": {
                    int m = Math.max(5, (int) Optional.ofNullable(Templates.num(p.get("minutes"))).orElse(60.0).doubleValue());
                    return from.plus(Duration.ofMinutes(m)).toString();
                }
                case "hourly": return now.truncatedTo(ChronoUnit.HOURS).plusHours(1).toInstant().toString();
                default: {
                    LocalTime t;
                    try { t = LocalTime.parse(FlowEngine.str(p.getOrDefault("time", "07:00")).trim()); } catch (Exception e) { t = LocalTime.of(7, 0); }
                    ZonedDateTime c;
                    if ("weekly".equals(mode)) {
                        int d = (int) Optional.ofNullable(Templates.num(p.get("weekday"))).orElse(1.0).doubleValue();
                        c = now.with(TemporalAdjusters.nextOrSame(DayOfWeek.of(Math.max(1, Math.min(7, d))))).with(t);
                        if (!c.isAfter(now)) c = c.plusWeeks(1);
                    } else {
                        c = now.with(t);
                        if (!c.isAfter(now)) c = c.plusDays(1);
                    }
                    return c.toInstant().toString();
                }
            }
        }
        return null;
    }

    /* ------------------------------ disparadores ------------------------------ */

    public Map<String, Object> runNow(Map<String, Object> flow, UserRecord user, Map<String, Object> data) {
        UserRecord owner = owner(flow).orElse(user);
        return engine.run(flow, "manual", null, data, owner);
    }

    /** Webhook público: ejecuta en línea y devuelve la salida (máx. lo que tarde el flujo). */
    public Map<String, Object> webhook(String token, Map<String, Object> data) {
        Map<String, Object> f = repo.byToken(token).orElseThrow(() -> new NoSuchElementException("Webhook no encontrado."));
        if (FlowRepository.toInt(f.get("enabled")) != 1) throw new IllegalStateException("La automatización está pausada.");
        boolean has = FlowRepository.nodes(repo.graph(f)).stream().anyMatch(n -> "trigger.webhook".equals(n.get("type")));
        if (!has) throw new NoSuchElementException("La automatización no tiene un disparador webhook.");
        UserRecord owner = owner(f).orElseThrow(() -> new IllegalStateException("Quien creó la automatización ya no existe."));
        return engine.run(f, "webhook", "trigger.webhook", data, owner);
    }

    private Optional<UserRecord> owner(Map<String, Object> f) {
        return users.get(FlowEngine.str(f.get("owner_id"))).filter(UserRecord::active);
    }

    @Scheduled(initialDelay = 25_000, fixedDelay = 30_000)
    public void tick() {
        Instant now = Instant.now();
        for (Map<String, Object> f : repo.enabled()) {
            Object next = f.get("next_run_at");
            if (next == null) continue;
            try {
                if (Instant.parse(String.valueOf(next)).isAfter(now)) continue;
                repo.setNext(String.valueOf(f.get("id")), nextRun(repo.graph(f), now));
                owner(f).ifPresentOrElse(
                        o -> pool.submit(() -> safeRun(f, "schedule", "trigger.schedule", Map.of("scheduled_at", next.toString()), o)),
                        () -> log.warn("Automatización {}: su dueño ya no existe o está inactivo", f.get("id")));
            } catch (RuntimeException e) {
                log.warn("Automatización programada {}: {}", f.get("id"), e.getMessage());
            }
        }
    }

    @EventListener
    public void onReload(AutomationEvents.AppReloaded e) {
        dispatch("trigger.reload", e.appId(), p -> {
            String want = FlowEngine.str(p.getOrDefault("status", "any"));
            return "any".equals(want) || want.isBlank() || ("ok".equals(want) ? "ok".equals(e.status()) : !"ok".equals(e.status()));
        }, Map.of("app_id", e.appId(), "status", e.status(), "message", e.message() == null ? "" : e.message(), "trigger", e.trigger(), "tables", e.tables() == null ? List.of() : e.tables()));
    }

    @EventListener
    public void onAlert(AutomationEvents.AlertFired e) {
        dispatch("trigger.alert", e.appId(), p -> {
            String want = FlowEngine.str(p.get("alert_name")).trim();
            return want.isEmpty() || want.equalsIgnoreCase(e.name());
        }, Map.of("app_id", e.appId(), "alert_id", e.alertId(), "alert", e.name(), "message", e.message(), "value", e.value() == null ? 0.0 : e.value(),
                "condition", FlowEngine.str(e.alert().get("op")) + " " + FlowEngine.str(e.alert().get("threshold"))));
    }

    @SuppressWarnings("unchecked")
    private void dispatch(String type, String appId, java.util.function.Predicate<Map<String, Object>> match, Map<String, Object> data) {
        Set<String> running = new HashSet<>(FlowEngine.CHAIN.get());   // no re-disparar el flujo que causó el evento
        for (Map<String, Object> f : repo.enabled()) {
            if (running.contains(String.valueOf(f.get("id")))) continue;
            for (Map<String, Object> n : FlowRepository.nodes(repo.graph(f))) {
                if (!type.equals(n.get("type"))) continue;
                Map<String, Object> p = (Map<String, Object>) n.get("params");
                if (!appId.equals(FlowEngine.str(p.get("app"))) || !match.test(p)) continue;
                owner(f).ifPresent(o -> pool.submit(() -> safeRun(f, type.substring(8), type, data, o)));
                break;
            }
        }
    }

    private void safeRun(Map<String, Object> f, String trigger, String type, Map<String, Object> data, UserRecord owner) {
        try { engine.run(f, trigger, type, data, owner); }
        catch (RuntimeException e) { log.warn("Automatización {} falló: {}", f.get("id"), e.getMessage()); }
    }

    /* ------------------------------ plantillas ------------------------------ */

    /** Galería de flujos listos para usar (se completan con la app y las credenciales al crearlos). */
    public static List<Map<String, Object>> templates() {
        List<Map<String, Object>> t = new ArrayList<>();
        t.add(tpl("reload_daily", "Recarga diaria y aviso si falla", "Recarga los datos todos los días a las 6:00; si algo sale mal te avisa por correo y en la campana.",
                List.of("trigger.schedule", "data.reload", "logic.if", "action.email", "action.notify"),
                List.of(n("t", "trigger.schedule", "Todos los días 6:00", 60, 160, Map.of("mode", "daily", "time", "06:00")),
                        n("r", "data.reload", "Recargar datos", 330, 160, Map.of("app", "{{app}}")),
                        n("i", "logic.if", "¿Salió bien?", 600, 160, Map.of("left", "{{ $json.status }}", "op", "=", "right", "ok")),
                        n("e", "action.email", "Correo de error", 880, 260, Map.of("credential", "{{smtp}}", "to", "{{email}}", "subject", "⚠ Falló la recarga de {{ $json.app }}",
                                "body", "<p>La recarga programada de <b>{{ $json.app }}</b> terminó con estado <b>{{ $json.status }}</b>.</p><p>{{ $json.message }}</p>")),
                        n("ok", "action.notify", "Aviso: recarga lista", 880, 80, Map.of("title", "Datos al día", "message", "{{ $json.app }}: {{ $json.message }}"))),
                List.of(e("t", "out", "r"), e("r", "out", "i"), e("i", "true", "ok"), e("i", "false", "e"))));
        t.add(tpl("risk_whatsapp", "Conductores en riesgo → WhatsApp al supervisor", "Cada lunes busca los conductores con probabilidad de retiro alta; un agente redacta el mensaje y se envía por WhatsApp.",
                List.of("trigger.schedule", "data.rows", "logic.if", "ai.agent", "action.whatsapp"),
                List.of(n("t", "trigger.schedule", "Lunes 8:00", 60, 160, Map.of("mode", "weekly", "weekday", "1", "time", "08:00")),
                        n("r", "data.rows", "Conductores en riesgo", 320, 160, Map.of("app", "{{app}}", "where", "[probabilidad_retiro] > 0.8", "fields", "cedula, periodo, horizonte_meses, probabilidad_retiro", "sort", "probabilidad_retiro", "limit", 30)),
                        n("g", "logic.aggregate", "Juntar", 570, 160, Map.of()),
                        n("i", "logic.if", "¿Hay casos?", 800, 160, Map.of("left", "{{ $json.count }}", "op", ">", "right", "0")),
                        n("a", "ai.agent", "Redactor", 1040, 100, Map.of("role", "writer", "prompt", "Escribe un WhatsApp corto (máx. 600 caracteres) para el supervisor con los {{ $json.count }} conductores con mayor riesgo de retiro y una acción sugerida.", "include_input", true)),
                        n("w", "action.whatsapp", "WhatsApp supervisor", 1290, 100, Map.of("credential", "{{whatsapp}}", "to", "{{phone}}", "message", "{{ $json.text }}"))),
                List.of(e("t", "out", "r"), e("r", "out", "g"), e("g", "out", "i"), e("i", "true", "a"), e("a", "out", "w"))));
        t.add(tpl("weekly_analyst", "Agente analista: informe semanal por correo", "Cada viernes explica qué cambió en tu métrica clave y un agente experto escribe el informe para la gerencia.",
                List.of("trigger.schedule", "data.explain", "data.health", "ai.agent", "action.email"),
                List.of(n("t", "trigger.schedule", "Viernes 17:00", 60, 160, Map.of("mode", "weekly", "weekday", "5", "time", "17:00")),
                        n("x", "data.explain", "Qué cambió", 320, 160, Map.of("app", "{{app}}", "measure", "{{measure}}", "label", "{{measure_label}}")),
                        n("a", "ai.agent", "Analista de rotación", 580, 160, Map.of("role", "hr", "app", "{{app}}", "prompt", "Con este análisis escribe un informe ejecutivo (3 párrafos cortos y 3 acciones): {{ $json.story }}. Si necesitas más detalle, usa las herramientas.")),
                        n("e", "action.email", "Enviar informe", 840, 160, Map.of("credential", "{{smtp}}", "to", "{{email}}", "subject", "Informe semanal · {{ $node[\"Qué cambió\"].json.headline }}",
                                "body", "<h2>Informe semanal</h2><p>{{ $json.text }}</p><hr><p style=\"color:#64748b\">{{ $node[\"Qué cambió\"].json.story }}</p>"))),
                List.of(e("t", "out", "x"), e("x", "out", "a"), e("a", "out", "e"))));
        t.add(tpl("alert_teams", "Alerta → Teams/Slack y registros por correo", "Cuando una alerta se dispara, avisa en el canal del equipo y manda por correo los registros afectados en CSV.",
                List.of("trigger.alert", "action.chat", "data.rows", "action.email"),
                List.of(n("t", "trigger.alert", "Al dispararse la alerta", 60, 160, Map.of("app", "{{app}}")),
                        n("c", "action.chat", "Aviso al canal", 330, 80, Map.of("credential", "{{webhook}}", "text", "🚨 {{ $json.alert }}: {{ $json.message }}")),
                        n("r", "data.rows", "Registros", 330, 260, Map.of("app", "{{app}}", "limit", 500)),
                        n("e", "action.email", "Correo con CSV", 600, 260, Map.of("credential", "{{smtp}}", "to", "{{email}}", "subject", "Alerta: {{ $trigger.alert }}", "body", "<p>{{ $trigger.message }}</p>{{ $items | table }}", "attach_csv", true))),
                List.of(e("t", "out", "c"), e("t", "out", "r"), e("r", "out", "e"))));
        t.add(tpl("webhook_ask", "API: pregúntale a tus datos por webhook", "Otro sistema (o un bot) llama a la URL con {\"pregunta\": \"…\"} y recibe la respuesta calculada.",
                List.of("trigger.webhook", "data.ask"),
                List.of(n("t", "trigger.webhook", "Webhook", 60, 160, Map.of()),
                        n("q", "data.ask", "Preguntar", 330, 160, Map.of("app", "{{app}}", "question", "{{ $json.pregunta }}"))),
                List.of(e("t", "out", "q"))));
        return t;
    }

    private static Map<String, Object> tpl(String id, String name, String desc, List<String> icons, List<Map<String, Object>> nodes, List<Map<String, Object>> edges) {
        return Map.of("id", id, "name", name, "description", desc, "node_types", icons, "graph", Map.of("nodes", nodes, "edges", edges));
    }
    private static Map<String, Object> n(String id, String type, String name, int x, int y, Map<String, Object> params) {
        return Map.of("id", id, "type", type, "name", name, "x", x, "y", y, "params", params);
    }
    private static Map<String, Object> e(String from, String port, String to) { return Map.of("from", from, "port", port, "to", to); }
}
