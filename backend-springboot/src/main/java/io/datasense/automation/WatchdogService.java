package io.datasense.automation;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;

import io.datasense.ask.InsightService;
import io.datasense.auth.UserRecord;
import io.datasense.repo.AppRepository;
import io.datasense.repo.Ids;
import io.datasense.repo.MasterItemRepository;
import io.datasense.repo.NotificationRepository;
import io.datasense.repo.TableRepository;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.*;

/**
 * <b>Agente de guardia</b>: después de cada carga de datos (y al menos una vez al día) revisa las métricas de la app
 * —las certificadas; si no hay, las medidas maestras; si tampoco, el conteo de registros— comparando el último periodo
 * con el anterior ({@link InsightService#explain}). Si alguna cambió más que el umbral (en %; en métricas que ya son
 * un porcentaje, en puntos) o la salud de datos tiene problemas críticos, deja un aviso en la campana de su dueño con
 * el relato de qué cambió y por qué.
 */
@Service
public class WatchdogService {

    private static final Logger log = LoggerFactory.getLogger(WatchdogService.class);

    private final JdbcTemplate jdbc;
    private final InsightService insights;
    private final HealthService health;
    private final MasterItemRepository masters;
    private final TableRepository tables;
    private final NotificationRepository notifications;
    private final AppRepository apps;
    private final ObjectMapper mapper = new ObjectMapper();

    public WatchdogService(JdbcTemplate jdbc, InsightService insights, HealthService health, MasterItemRepository masters,
                           TableRepository tables, NotificationRepository notifications, AppRepository apps) {
        this.jdbc = jdbc;
        this.insights = insights;
        this.health = health;
        this.masters = masters;
        this.tables = tables;
        this.notifications = notifications;
        this.apps = apps;
    }

    public Map<String, Object> get(String appId) {
        List<Map<String, Object>> l = jdbc.queryForList("SELECT * FROM watchdogs WHERE app_id = ?", appId);
        if (l.isEmpty()) return null;
        Map<String, Object> w = new LinkedHashMap<>(l.get(0));
        w.put("enabled", AutomationService.toInt(w.get("enabled")) == 1);
        w.put("measures", parse(w.remove("measures_json"), new TypeReference<List<String>>() {}, List.of()));
        w.put("last_summary", parse(w.remove("last_summary_json"), new TypeReference<Map<String, Object>>() {}, null));
        return w;
    }

    public Map<String, Object> save(String appId, Map<String, Object> body, UserRecord owner) {
        Double th = body.get("threshold_pct") == null ? 15.0 : AutomationService.toDouble(body.get("threshold_pct"));
        if (th == null || th.isNaN() || th <= 0 || th > 1000) throw new IllegalArgumentException("El umbral debe ser un porcentaje mayor que 0.");
        boolean enabled = !Boolean.FALSE.equals(body.get("enabled")) && !"false".equals(AutomationService.str(body.get("enabled")));
        List<String> ms = new ArrayList<>();
        if (body.get("measures") instanceof List<?> l) for (Object o : l) ms.add(String.valueOf(o));
        String json;
        try { json = mapper.writeValueAsString(ms); } catch (Exception e) { json = "[]"; }
        String now = Ids.now();
        jdbc.update("""
            INSERT INTO watchdogs (app_id, enabled, threshold_pct, measures_json, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(app_id) DO UPDATE SET enabled = excluded.enabled, threshold_pct = excluded.threshold_pct, measures_json = excluded.measures_json,
              owner_id = excluded.owner_id, updated_at = excluded.updated_at""", appId, enabled ? 1 : 0, th, json, owner.id(), now, now);
        return get(appId);
    }

    public boolean delete(String appId) { return jdbc.update("DELETE FROM watchdogs WHERE app_id = ?", appId) > 0; }

    /** Medidas que vigila: las elegidas; si no, certificadas; si no, maestras; si no, el conteo de registros (máx. 6). */
    List<Map<String, Object>> targets(String appId, List<String> chosen) {
        List<Map<String, Object>> ms = masters.list(appId, "measure");
        List<Map<String, Object>> out = new ArrayList<>();
        if (!chosen.isEmpty()) {
            for (Map<String, Object> m : ms) if (chosen.contains(String.valueOf(m.get("id")))) out.add(Map.of("master_id", m.get("id"), "label", m.get("name")));
        }
        if (out.isEmpty()) for (Map<String, Object> m : ms) if (Boolean.TRUE.equals(m.get("certified"))) out.add(Map.of("master_id", m.get("id"), "label", m.get("name")));
        if (out.isEmpty()) for (Map<String, Object> m : ms) out.add(Map.of("master_id", m.get("id"), "label", m.get("name")));
        if (out.isEmpty()) {
            // sin medidas maestras: registros y los totales de los números principales de la tabla principal (la de más filas)
            String main = insights.mainTable(appId);
            Map<String, Object> big = null;
            for (Map<String, Object> t : tables.listTables(appId)) if (big == null || String.valueOf(t.get("name")).equals(main)) big = t;
            if (big != null) {
                List<Map<String, Object>> cols = tables.listColumns(String.valueOf(big.get("id")));
                if (!cols.isEmpty()) {
                    out.add(Map.of("expression", "Count([" + cols.get(0).get("name") + "])", "label", "Registros de " + big.get("name")));
                    int k = 0;
                    for (Map<String, Object> c : cols) {
                        String n = String.valueOf(c.get("name"));
                        String low = n.toLowerCase(Locale.ROOT);
                        if (!"number".equals(c.get("logical_type")) || low.matches(".*(id|cod|cedula|anio|ano|year|mes|month|edad|probab|%|porcent).*")) continue;
                        out.add(Map.of("expression", "Sum([" + n + "])", "label", "Total " + n));
                        if (++k >= 2) break;
                    }
                }
            }
        }
        return out.size() > 6 ? out.subList(0, 6) : out;
    }

    /** Revisa la app ahora. {@code notify}: deja el aviso en la campana si hay hallazgos. */
    @SuppressWarnings("unchecked")
    public Map<String, Object> run(String appId, boolean notify) {
        Map<String, Object> w = get(appId);
        double th = w == null ? 15 : AutomationService.toDouble(w.get("threshold_pct"));
        List<String> chosen = w == null ? List.of() : (List<String>) w.get("measures");
        List<Map<String, Object>> findings = new ArrayList<>(), checked = new ArrayList<>();
        for (Map<String, Object> t : targets(appId, chosen)) {
            Map<String, Object> c = new LinkedHashMap<>();
            c.put("label", t.get("label"));
            try {
                Map<String, Object> e = insights.explain(appId, new HashMap<>(t));
                boolean pct = Boolean.TRUE.equals(((Map<String, Object>) e.get("measure")).get("percent"));
                double delta = ((Number) e.get("delta")).doubleValue();
                Double dp = (Double) e.get("delta_pct");
                double size = pct ? Math.abs(delta) : dp == null ? (delta == 0 ? 0 : 100) : Math.abs(dp);
                c.put("current", e.get("current")); c.put("previous", e.get("previous"));
                c.put("current_value", e.get("current_value")); c.put("previous_value", e.get("previous_value"));
                c.put("change", size); c.put("unit", pct ? "puntos" : "%");
                c.put("story", e.get("story"));
                c.put("flag", size >= th);
                if (size >= th) findings.add(c);
            } catch (RuntimeException ex) {
                c.put("error", ex.getMessage());
            }
            checked.add(c);
        }
        Map<String, Object> h = health.health(appId);
        List<Map<String, Object>> crit = ((List<Map<String, Object>>) h.get("issues")).stream().filter(i -> "critical".equals(i.get("severity"))).toList();

        Map<String, Object> summary = new LinkedHashMap<>();
        summary.put("checked_at", Ids.now());
        summary.put("threshold_pct", th);
        summary.put("measures", checked);
        summary.put("findings", findings.size());
        summary.put("health_score", h.get("score"));
        summary.put("health_critical", crit.stream().map(i -> i.get("message")).toList());
        List<String> headline = new ArrayList<>();
        for (Map<String, Object> f : findings) headline.add(((List<String>) f.get("story")).get(0));
        crit.forEach(i -> headline.add("Salud de datos: " + i.get("message")));
        summary.put("headline", headline);
        if (w != null) {
            try { jdbc.update("UPDATE watchdogs SET last_run_at = ?, last_summary_json = ? WHERE app_id = ?", summary.get("checked_at"), mapper.writeValueAsString(summary), appId); }
            catch (Exception ignored) {}
        }
        String owner = w == null ? null : AutomationService.str(w.get("owner_id"));
        if (notify && owner != null && !owner.isBlank() && !headline.isEmpty()) {
            String appName = apps.getApp(appId).map(a -> a.name()).orElse("");
            Map<String, Object> f0 = findings.isEmpty() ? null : findings.get(0);
            String detail = f0 == null ? headline.get(0) : String.join(" ", ((List<String>) f0.get("story")).subList(0, Math.min(2, ((List<String>) f0.get("story")).size())));
            notifications.addEvent("insight", "Agente de guardia: " + (findings.isEmpty() ? "" : findings.size() + " cambio(s) fuerte(s)")
                            + (findings.isEmpty() || crit.isEmpty() ? "" : " y ") + (crit.isEmpty() ? "" : crit.size() + " problema(s) de datos"),
                    appName + " · " + (detail.length() > 300 ? detail.substring(0, 299) + "…" : detail), appId, appId, String.valueOf(findings.size()), owner);
        }
        return summary;
    }

    /** Tras una carga (la llama AutomationService). */
    public void afterReload(String appId) {
        Map<String, Object> w = get(appId);
        if (w == null || !Boolean.TRUE.equals(w.get("enabled"))) return;
        try { run(appId, true); } catch (RuntimeException e) { log.warn("Agente de guardia de {}: {}", appId, e.getMessage()); }
    }

    /** Al menos una revisión diaria aunque no haya cargas. */
    @Scheduled(initialDelay = 60_000, fixedDelay = 15 * 60_000)
    public void daily() {
        for (Map<String, Object> w : jdbc.queryForList("SELECT app_id, last_run_at FROM watchdogs WHERE enabled = 1")) {
            try {
                Object last = w.get("last_run_at");
                if (last != null && OffsetDateTime.parse(String.valueOf(last)).toInstant().plus(Duration.ofHours(24)).isAfter(Instant.now())) continue;
                run(String.valueOf(w.get("app_id")), true);
            } catch (RuntimeException e) {
                log.warn("Agente de guardia de {}: {}", w.get("app_id"), e.getMessage());
            }
        }
    }

    private <T> T parse(Object json, TypeReference<T> t, T def) {
        if (json == null || String.valueOf(json).isBlank()) return def;
        try { return mapper.readValue(String.valueOf(json), t); } catch (Exception e) { return def; }
    }
}
