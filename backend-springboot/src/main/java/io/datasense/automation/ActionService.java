package io.datasense.automation;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;

import io.datasense.ask.InsightService;
import io.datasense.auth.UserRecord;
import io.datasense.repo.AppRepository;
import io.datasense.repo.Ids;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.*;

/**
 * <b>Del dato a la acción</b>: listas de acción guardadas. Una lista es «los registros de esta tabla que cumplen estos
 * filtros y esta condición, con estas columnas» (p. ej. conductores con {@code [probabilidad_retiro] > 0.6}). Se
 * consultan, se exportan a CSV y, si tienen webhook, se envían como JSON (Teams/Power Automate/Zapier/n8n/un API
 * propio). Una alerta puede tener una lista asociada: al dispararse, la lista se ejecuta sola.
 */
@Service
public class ActionService {

    private final JdbcTemplate jdbc;
    private final InsightService insights;
    private final AppRepository apps;
    private final ObjectMapper mapper = new ObjectMapper();
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(8)).followRedirects(HttpClient.Redirect.NEVER).build();

    public ActionService(JdbcTemplate jdbc, InsightService insights, AppRepository apps) {
        this.jdbc = jdbc;
        this.insights = insights;
        this.apps = apps;
    }

    public List<Map<String, Object>> list(String appId) {
        return jdbc.queryForList("SELECT * FROM action_lists WHERE app_id = ? ORDER BY created_at", appId).stream().map(this::out).toList();
    }

    public Optional<Map<String, Object>> get(String id) {
        return jdbc.queryForList("SELECT * FROM action_lists WHERE id = ?", id).stream().findFirst();
    }

    Map<String, Object> out(Map<String, Object> a) {
        Map<String, Object> o = new LinkedHashMap<>(a);
        o.remove("selections_json"); o.remove("fields_json");
        o.put("selections", parse(a.get("selections_json"), new TypeReference<Map<String, List<Object>>>() {}, Map.of()));
        o.put("fields", parse(a.get("fields_json"), new TypeReference<List<String>>() {}, List.of()));
        o.put("sort_desc", AutomationService.toInt(a.get("sort_desc")) == 1);
        String url = AutomationService.str(a.get("webhook_url"));
        o.put("webhook_url", url.isBlank() ? null : mask(url));
        o.put("has_webhook", !url.isBlank());
        return o;
    }

    /** El webhook suele llevar un secreto en la URL: se muestra solo el host y el final. */
    static String mask(String url) {
        try {
            URI u = URI.create(url);
            String p = u.getRawPath() == null ? "" : u.getRawPath();
            return u.getScheme() + "://" + u.getHost() + (p.length() > 6 ? "/…" + p.substring(p.length() - 4) : p);
        } catch (RuntimeException e) { return "(oculta)"; }
    }

    /** Body de una lista → parámetros de {@link InsightService#rows}. */
    private Map<String, Object> query(Map<String, Object> a, Integer limit) {
        Map<String, Object> q = new LinkedHashMap<>();
        if (a.get("table_name") != null) q.put("table", a.get("table_name"));
        q.put("selections", parse(a.get("selections_json"), new TypeReference<Map<String, List<Object>>>() {}, Map.of()));
        if (a.get("where_expr") != null) q.put("where", a.get("where_expr"));
        List<String> f = parse(a.get("fields_json"), new TypeReference<List<String>>() {}, List.of());
        if (!f.isEmpty()) q.put("fields", f);
        if (a.get("sort_field") != null) { q.put("sort", a.get("sort_field")); q.put("desc", AutomationService.toInt(a.get("sort_desc")) == 1); }
        if (limit != null) q.put("limit", limit);
        return q;
    }

    public Map<String, Object> save(String appId, String id, Map<String, Object> body, UserRecord owner) {
        String name = AutomationService.str(body.get("name")).strip();
        if (name.isEmpty()) throw new IllegalArgumentException("Ponle un nombre a la lista.");
        String url = AutomationService.str(body.get("webhook_url")).strip();
        boolean keepUrl = id != null && !body.containsKey("webhook_url");
        if (!url.isEmpty()) validateUrl(url);
        Map<String, Object> probe = new LinkedHashMap<>();
        String table = AutomationService.str(body.get("table")).strip();
        if (!table.isEmpty()) probe.put("table", table);
        probe.put("selections", body.getOrDefault("selections", Map.of()));
        String where = AutomationService.str(body.get("where")).strip();
        if (!where.isEmpty()) probe.put("where", where);
        if (body.get("fields") instanceof List<?> l && !l.isEmpty()) probe.put("fields", l);
        String sort = AutomationService.str(body.get("sort")).strip();
        if (!sort.isEmpty()) probe.put("sort", sort);
        probe.put("limit", 1);
        Map<String, Object> r = insights.rows(appId, probe);   // valida filtros, condición y columnas
        String selJson, fieldsJson;
        try {
            selJson = mapper.writeValueAsString(body.getOrDefault("selections", Map.of()));
            fieldsJson = mapper.writeValueAsString(body.get("fields") instanceof List<?> l ? l : List.of());
        } catch (Exception e) { throw new IllegalArgumentException("Filtros o columnas inválidos."); }
        boolean desc = !Boolean.FALSE.equals(body.get("desc")) && !"false".equals(AutomationService.str(body.get("desc")));
        String now = Ids.now();
        if (id == null) {
            id = Ids.newId();
            jdbc.update("""
                INSERT INTO action_lists (id, app_id, name, description, table_name, selections_json, where_expr, fields_json, sort_field, sort_desc,
                  webhook_url, owner_id, owner_name, last_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    id, appId, name, blank(body.get("description")), r.get("table"), selJson, where.isEmpty() ? null : where, fieldsJson,
                    sort.isEmpty() ? null : sort, desc ? 1 : 0, url.isEmpty() ? null : url, owner.id(), owner.name(), r.get("total"), now, now);
        } else {
            jdbc.update("""
                UPDATE action_lists SET name = ?, description = ?, table_name = ?, selections_json = ?, where_expr = ?, fields_json = ?, sort_field = ?,
                  sort_desc = ?, webhook_url = """ + (keepUrl ? "webhook_url" : "?") + ", last_count = ?, updated_at = ? WHERE id = ?",
                    keepUrl ? new Object[]{name, blank(body.get("description")), r.get("table"), selJson, where.isEmpty() ? null : where, fieldsJson, sort.isEmpty() ? null : sort, desc ? 1 : 0, r.get("total"), now, id}
                            : new Object[]{name, blank(body.get("description")), r.get("table"), selJson, where.isEmpty() ? null : where, fieldsJson, sort.isEmpty() ? null : sort, desc ? 1 : 0, url.isEmpty() ? null : url, r.get("total"), now, id});
        }
        return out(get(id).orElseThrow());
    }

    public boolean delete(String id) {
        jdbc.update("UPDATE alerts SET action_id = NULL WHERE action_id = ?", id);
        return jdbc.update("DELETE FROM action_lists WHERE id = ?", id) > 0;
    }

    public Map<String, Object> rows(Map<String, Object> a, int limit) {
        return insights.rows(AutomationService.str(a.get("app_id")), query(a, limit));
    }

    /**
     * Ejecuta la lista: cuenta los registros y, si tiene webhook (y {@code send}), los envía.
     * @return {count, sent, status ok|empty|fail|no_webhook, message, columns, rows (muestra)}
     */
    public Map<String, Object> run(Map<String, Object> a, boolean send, String reason) {
        String id = AutomationService.str(a.get("id"));
        Map<String, Object> r = rows(a, 1000);
        int total = ((Number) r.get("total")).intValue();
        String url = AutomationService.str(a.get("webhook_url"));
        String status, msg;
        boolean sent = false;
        if (!send || url.isBlank()) { status = url.isBlank() ? "no_webhook" : "ok"; msg = total + " registro(s)."; }
        else {
            try {
                Map<String, Object> payload = new LinkedHashMap<>();
                payload.put("source", "DataSense");
                payload.put("app", apps.getApp(AutomationService.str(a.get("app_id"))).map(x -> x.name()).orElse(""));
                payload.put("list", a.get("name"));
                payload.put("reason", reason);
                payload.put("count", total);
                payload.put("columns", r.get("columns"));
                payload.put("rows", r.get("rows"));
                payload.put("truncated", r.get("truncated"));
                payload.put("generated_at", Ids.now());
                // texto listo para Teams / Slack (los dos aceptan {"text": ...})
                payload.put("text", "DataSense · " + a.get("name") + ": " + total + " registro(s)" + (reason == null ? "" : " — " + reason));
                HttpRequest req = HttpRequest.newBuilder(URI.create(url)).timeout(Duration.ofSeconds(10))
                        .header("Content-Type", "application/json").header("User-Agent", "DataSense-webhook")
                        .POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(payload))).build();
                HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString());
                sent = res.statusCode() >= 200 && res.statusCode() < 300;
                status = sent ? "ok" : "fail";
                msg = sent ? "Enviados " + Math.min(total, 1000) + " de " + total + " registro(s) al webhook (HTTP " + res.statusCode() + ")."
                        : "El webhook respondió HTTP " + res.statusCode() + ".";
            } catch (Exception e) {
                status = "fail";
                msg = "No se pudo enviar al webhook: " + (e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage());
            }
        }
        jdbc.update("UPDATE action_lists SET last_run_at = ?, last_count = ?, last_status = ?, last_message = ? WHERE id = ?", Ids.now(), total, status, msg, id);
        Map<String, Object> o = new LinkedHashMap<>();
        o.put("count", total);
        o.put("sent", sent);
        o.put("status", status);
        o.put("message", msg);
        o.put("columns", r.get("columns"));
        List<?> rows = (List<?>) r.get("rows");
        o.put("rows", rows.size() > 50 ? rows.subList(0, 50) : rows);
        return o;
    }

    /** Solo http/https a un host; se rechazan esquemas como file: o javascript:. */
    static void validateUrl(String url) {
        URI u;
        try { u = URI.create(url); } catch (RuntimeException e) { throw new IllegalArgumentException("La URL del webhook no es válida."); }
        String s = u.getScheme() == null ? "" : u.getScheme().toLowerCase(Locale.ROOT);
        if (!s.equals("https") && !s.equals("http")) throw new IllegalArgumentException("El webhook debe ser una URL http(s).");
        if (u.getHost() == null || u.getHost().isBlank()) throw new IllegalArgumentException("La URL del webhook no tiene servidor.");
        if (url.length() > 1000) throw new IllegalArgumentException("La URL del webhook es demasiado larga.");
    }

    private <T> T parse(Object json, TypeReference<T> t, T def) {
        if (json == null || AutomationService.str(json).isBlank()) return def;
        try { return mapper.readValue(AutomationService.str(json), t); } catch (Exception e) { return def; }
    }

    private static String blank(Object o) { String s = AutomationService.str(o).strip(); return s.isEmpty() ? null : s; }
}
