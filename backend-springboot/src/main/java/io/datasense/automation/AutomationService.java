package io.datasense.automation;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;

import io.datasense.ask.AskService;
import io.datasense.auth.UserRecord;
import io.datasense.auth.UserRepository;
import io.datasense.repo.AppRepository;
import io.datasense.repo.Ids;
import io.datasense.repo.NotificationRepository;
import io.datasense.web.ScriptController;
import io.datasense.web.ScriptController.ReloadDone;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.event.EventListener;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.text.NumberFormat;
import java.time.*;
import java.util.*;

/**
 * Automatización de una app:
 * <ul>
 *   <li><b>Carga programada</b> ({@code schedules}, una por app): cada N minutos, diaria a una hora o semanal. Corre
 *   el mismo «Cargar datos» del editor con los permisos de quien la programó; cada ejecución queda en
 *   {@code reload_runs} y avisa a la campana según {@code notify} (fail | always | never).</li>
 *   <li><b>Alertas</b> ({@code alerts}): una medida (fx simple o compuesta, o una medida maestra) con filtros y una
 *   condición (&gt; ≥ &lt; ≤ = ≠ o «cambia más de X %»). Se revisan al recargar o cada N minutos; al dispararse o
 *   resolverse avisan a su dueño en la campana.</li>
 *   <li><b>Historial de cargas</b> ({@code table_loads}): filas y columnas por tabla en cada recarga (base de la salud
 *   de datos y de los avisos «la tabla perdió filas»).</li>
 * </ul>
 * El reloj ({@link #tick()}) revisa cada 30 s qué toca ejecutar.
 */
@Service
public class AutomationService {

    private static final Logger log = LoggerFactory.getLogger(AutomationService.class);

    private final JdbcTemplate jdbc;
    private final ScriptController scripts;
    private final UserRepository users;
    private final AppRepository apps;
    private final AskService ask;
    private final NotificationRepository notifications;
    private final HealthService health;
    private final ObjectMapper mapper = new ObjectMapper();

    public AutomationService(JdbcTemplate jdbc, ScriptController scripts, UserRepository users, AppRepository apps,
                             AskService ask, NotificationRepository notifications, HealthService health) {
        this.jdbc = jdbc;
        this.scripts = scripts;
        this.users = users;
        this.apps = apps;
        this.ask = ask;
        this.notifications = notifications;
        this.health = health;
    }

    public static final Set<String> FREQUENCIES = Set.of("interval", "hourly", "daily", "weekly");
    public static final Set<String> NOTIFY = Set.of("fail", "always", "never");
    public static final Set<String> OPS = Set.of(">", ">=", "<", "<=", "=", "!=", "change");
    private static final ZoneId ZONE = ZoneId.systemDefault();

    /* ================================ Carga programada ================================ */

    public Map<String, Object> schedule(String appId) {
        List<Map<String, Object>> l = jdbc.queryForList("SELECT * FROM schedules WHERE app_id = ?", appId);
        return l.isEmpty() ? null : decorate(l.get(0));
    }

    private Map<String, Object> decorate(Map<String, Object> s) {
        Map<String, Object> o = new LinkedHashMap<>(s);
        o.put("enabled", toInt(s.get("enabled")) == 1);
        o.put("description", describe(s));
        Object owner = s.get("owner_id");
        o.put("owner_name", owner == null ? null : users.get(String.valueOf(owner)).map(UserRecord::name).orElse(null));
        return o;
    }

    /** Crea o reemplaza la programación de la app; {@code owner} = quien la guarda (sus permisos se usan al cargar). */
    public Map<String, Object> saveSchedule(String appId, Map<String, Object> body, UserRecord owner) {
        String freq = str(body.getOrDefault("frequency", "daily")).toLowerCase(Locale.ROOT);
        if (!FREQUENCIES.contains(freq)) throw new IllegalArgumentException("Frecuencia inválida: usa interval, hourly, daily o weekly.");
        Integer every = body.get("interval_minutes") == null ? null : toInt(body.get("interval_minutes"));
        if ("interval".equals(freq) && (every == null || every < 5 || every > 10080))
            throw new IllegalArgumentException("El intervalo debe estar entre 5 minutos y 7 días (10080 minutos).");
        String time = str(body.getOrDefault("time_of_day", "06:00"));
        if (("daily".equals(freq) || "weekly".equals(freq)) && !time.matches("([01]\\d|2[0-3]):[0-5]\\d"))
            throw new IllegalArgumentException("La hora debe tener el formato HH:MM (24 h), por ejemplo 06:30.");
        Integer weekday = body.get("weekday") == null ? 1 : toInt(body.get("weekday"));
        if ("weekly".equals(freq) && (weekday < 1 || weekday > 7)) throw new IllegalArgumentException("El día debe ser 1 (lunes) a 7 (domingo).");
        String notify = str(body.getOrDefault("notify", "fail")).toLowerCase(Locale.ROOT);
        if (!NOTIFY.contains(notify)) throw new IllegalArgumentException("Aviso inválido: usa fail, always o never.");
        boolean enabled = !Boolean.FALSE.equals(body.get("enabled")) && !"false".equals(str(body.get("enabled")));
        Map<String, Object> s = new HashMap<>();
        s.put("frequency", freq); s.put("interval_minutes", every); s.put("time_of_day", time); s.put("weekday", weekday);
        String next = enabled ? nextRun(s, Instant.now()).toString() : null;
        String now = Ids.now();
        jdbc.update("""
            INSERT INTO schedules (id, app_id, frequency, interval_minutes, time_of_day, weekday, enabled, notify, owner_id, next_run_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(app_id) DO UPDATE SET frequency = excluded.frequency, interval_minutes = excluded.interval_minutes,
              time_of_day = excluded.time_of_day, weekday = excluded.weekday, enabled = excluded.enabled, notify = excluded.notify,
              owner_id = excluded.owner_id, next_run_at = excluded.next_run_at, updated_at = excluded.updated_at""",
                Ids.newId(), appId, freq, every, time, weekday, enabled ? 1 : 0, notify, owner.id(), next, now, now);
        return schedule(appId);
    }

    public boolean deleteSchedule(String appId) {
        return jdbc.update("DELETE FROM schedules WHERE app_id = ?", appId) > 0;
    }

    /** Próxima ejecución después de {@code from}. */
    static Instant nextRun(Map<String, Object> s, Instant from) {
        String freq = str(s.get("frequency"));
        ZonedDateTime now = from.atZone(ZONE);
        switch (freq) {
            case "interval": {
                int every = Math.max(5, toInt(s.get("interval_minutes")));
                return from.plus(Duration.ofMinutes(every));
            }
            case "hourly":
                return now.truncatedTo(java.time.temporal.ChronoUnit.HOURS).plusHours(1).toInstant();
            case "weekly": {
                LocalTime t = LocalTime.parse(str(s.getOrDefault("time_of_day", "06:00")));
                DayOfWeek d = DayOfWeek.of(Math.max(1, Math.min(7, toInt(s.getOrDefault("weekday", 1)))));
                ZonedDateTime c = now.with(java.time.temporal.TemporalAdjusters.nextOrSame(d)).with(t);
                if (!c.isAfter(now)) c = c.plusWeeks(1);
                return c.toInstant();
            }
            default: {
                LocalTime t = LocalTime.parse(str(s.getOrDefault("time_of_day", "06:00")));
                ZonedDateTime c = now.with(t);
                if (!c.isAfter(now)) c = c.plusDays(1);
                return c.toInstant();
            }
        }
    }

    private static final String[] DAYS = {"lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"};

    static String describe(Map<String, Object> s) {
        return switch (str(s.get("frequency"))) {
            case "interval" -> {
                int m = toInt(s.get("interval_minutes"));
                yield m % 60 == 0 ? "Cada " + (m / 60 == 1 ? "hora" : m / 60 + " horas") : "Cada " + m + " minutos";
            }
            case "hourly" -> "Cada hora en punto";
            case "weekly" -> "Cada " + DAYS[Math.max(1, Math.min(7, toInt(s.get("weekday")))) - 1] + " a las " + s.get("time_of_day");
            default -> "Todos los días a las " + s.get("time_of_day");
        };
    }

    /** Ejecuta la carga ahora (botón «Ejecutar ahora» o el reloj). Devuelve {ok, status, message, log, tables}. */
    public Map<String, Object> runNow(String appId, UserRecord user, String trigger) {
        long t0 = System.currentTimeMillis();
        Map<String, Object> result;
        try {
            result = scripts.runAs(appId, user);
        } catch (RuntimeException e) {
            result = Map.of("ok", false, "log", List.of("ERROR: " + e.getMessage()), "tables", List.of());
        }
        return afterReload(new ReloadDone(appId, trigger, user == null ? null : user.id(), result, System.currentTimeMillis() - t0));
    }

    /** Recarga manual desde el editor: historial, salud y alertas «al recargar». */
    @EventListener
    public void onReload(ReloadDone e) {
        try { afterReload(e); } catch (RuntimeException ex) { log.warn("Automatización tras la recarga de {}: {}", e.appId(), ex.getMessage()); }
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> afterReload(ReloadDone e) {
        String appId = e.appId();
        Map<String, Object> r = e.result();
        List<String> lines = (List<String>) r.getOrDefault("log", List.of());
        boolean ok = !Boolean.FALSE.equals(r.get("ok"));
        long warns = lines.stream().filter(l -> l.startsWith("ADVERTENCIA")).count();
        String status = !ok ? "fail" : warns > 0 ? "warn" : "ok";
        String message = !ok ? lines.stream().filter(l -> l.startsWith("ERROR")).findFirst().orElse("La carga falló.")
                : warns > 0 ? warns + " advertencia(s): " + lines.stream().filter(l -> l.startsWith("ADVERTENCIA")).findFirst().orElse("")
                : lines.isEmpty() ? "Carga completa." : lines.get(lines.size() - 1);
        String now = Ids.now();
        String trigger = e.trigger();

        // historial de cargas por tabla
        List<Map<String, Object>> tables = (List<Map<String, Object>>) r.getOrDefault("tables", List.of());
        for (Map<String, Object> t : tables) {
            Object fields = t.get("fields");
            int cols = fields instanceof Collection<?> c ? c.size() : toInt(fields);
            jdbc.update("INSERT INTO table_loads (app_id, table_name, rows, columns, trigger, loaded_at) VALUES (?, ?, ?, ?, ?, ?)",
                    appId, t.get("table"), toInt(t.get("rows")), cols, trigger, now);
        }
        jdbc.update("INSERT INTO reload_runs (id, app_id, trigger, status, message, duration_ms, user_id, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                Ids.newId(), appId, trigger, status, clip(message, 500), e.durationMs(), e.userId(), now);
        jdbc.update("DELETE FROM reload_runs WHERE app_id = ? AND id NOT IN (SELECT id FROM reload_runs WHERE app_id = ? ORDER BY started_at DESC LIMIT 60)", appId, appId);
        ask.invalidate(appId);

        // programación: estado y aviso
        Map<String, Object> s = schedule(appId);
        if (s != null && !"manual".equals(trigger)) {
            jdbc.update("UPDATE schedules SET last_run_at = ?, last_status = ?, last_message = ?, last_duration_ms = ? WHERE app_id = ?",
                    now, status, clip(message, 500), e.durationMs(), appId);
            String notify = str(s.get("notify"));
            String owner = str(s.get("owner_id"));
            String appName = apps.getApp(appId).map(a -> a.name()).orElse("");
            if (!owner.isBlank() && ("always".equals(notify) || ("fail".equals(notify) && !"ok".equals(status)))) {
                notifications.addEvent("ok".equals(status) ? "reload" : "reload_fail",
                        "ok".equals(status) ? "Recarga completada" : "fail".equals(status) ? "La recarga programada falló" : "Recarga con advertencias",
                        appName + " · " + clip(message, 160), appId, appId, status, owner);
            }
            // Salud: avisa si la carga dejó algo crítico (tabla vacía, pérdida fuerte de filas)
            try {
                Map<String, Object> h = health.health(appId);
                List<Map<String, Object>> crit = ((List<Map<String, Object>>) h.get("issues")).stream().filter(i -> "critical".equals(i.get("severity"))).toList();
                if (!crit.isEmpty() && !owner.isBlank())
                    notifications.addEvent("health", "Salud de datos: " + crit.size() + " problema(s) crítico(s)",
                            appName + " · " + crit.get(0).get("message"), appId, appId, String.valueOf(h.get("score")), owner);
            } catch (RuntimeException ignored) {}
        }

        // alertas que se revisan al recargar
        List<Map<String, Object>> checked = new ArrayList<>();
        for (Map<String, Object> a : jdbc.queryForList("SELECT * FROM alerts WHERE app_id = ? AND enabled = 1 AND check_mode = 'reload'", appId))
            checked.add(evaluate(a));

        Map<String, Object> out = new LinkedHashMap<>(r);
        out.put("status", status);
        out.put("message", message);
        out.put("alerts_checked", checked.size());
        return out;
    }

    public List<Map<String, Object>> runs(String appId, int limit) {
        return jdbc.queryForList("SELECT r.id, r.trigger, r.status, r.message, r.duration_ms, r.started_at, u.name AS user_name "
                + "FROM reload_runs r LEFT JOIN users u ON u.id = r.user_id WHERE r.app_id = ? ORDER BY r.started_at DESC LIMIT ?", appId, Math.max(1, Math.min(60, limit)));
    }

    /* ================================ Alertas ================================ */

    public List<Map<String, Object>> alerts(String appId) {
        return jdbc.queryForList("SELECT * FROM alerts WHERE app_id = ? ORDER BY created_at", appId).stream().map(this::alertOut).toList();
    }

    public Optional<Map<String, Object>> alert(String id) {
        return jdbc.queryForList("SELECT * FROM alerts WHERE id = ?", id).stream().findFirst();
    }

    Map<String, Object> alertOut(Map<String, Object> a) {
        Map<String, Object> o = new LinkedHashMap<>(a);
        o.remove("selections_json");
        o.put("selections", parseSel(a.get("selections_json")));
        o.put("enabled", toInt(a.get("enabled")) == 1);
        o.put("condition", conditionText(str(a.get("op")), toDouble(a.get("threshold"))));
        return o;
    }

    /** Crea ({@code id == null}) o actualiza una alerta, la valida en el motor y la revisa una vez. */
    public Map<String, Object> saveAlert(String appId, String id, Map<String, Object> body, UserRecord owner) {
        String name = str(body.get("name")).strip();
        if (name.isEmpty()) throw new IllegalArgumentException("Ponle un nombre a la alerta.");
        String masterId = str(body.get("master_id")).strip();
        String expression = str(body.get("expression")).strip();
        if (masterId.isEmpty() && expression.isEmpty()) throw new IllegalArgumentException("Elige una medida (expresión fx o medida maestra).");
        String op = str(body.getOrDefault("op", ">")).strip();
        if (!OPS.contains(op)) throw new IllegalArgumentException("Condición inválida: usa >, >=, <, <=, =, != o change (cambio en %).");
        Double th = body.get("threshold") == null ? null : toDouble(body.get("threshold"));
        if (th == null || th.isNaN()) throw new IllegalArgumentException("Escribe el valor umbral (un número).");
        String mode = str(body.getOrDefault("check_mode", "reload"));
        if (!Set.of("reload", "interval").contains(mode)) throw new IllegalArgumentException("Revisión inválida: usa reload o interval.");
        Integer every = body.get("interval_minutes") == null ? null : toInt(body.get("interval_minutes"));
        if ("interval".equals(mode) && (every == null || every < 5)) throw new IllegalArgumentException("El intervalo de revisión debe ser de al menos 5 minutos.");
        Object sel = body.get("selections");
        String selJson;
        try { selJson = sel instanceof Map<?, ?> m && !m.isEmpty() ? mapper.writeValueAsString(m) : null; }
        catch (Exception e) { throw new IllegalArgumentException("Filtros inválidos."); }
        // validar la medida contra los datos
        try { ask.measureValue(appId, masterId.isEmpty() ? null : masterId, expression, parseSel(selJson)); }
        catch (RuntimeException e) { throw new IllegalArgumentException("La medida no es válida: " + e.getMessage()); }
        boolean enabled = !Boolean.FALSE.equals(body.get("enabled")) && !"false".equals(str(body.get("enabled")));
        String now = Ids.now();
        if (id == null) {
            id = Ids.newId();
            jdbc.update("""
                INSERT INTO alerts (id, app_id, name, expression, master_id, op, threshold, selections_json, check_mode, interval_minutes, enabled,
                  owner_id, owner_name, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unknown', ?, ?)""",
                    id, appId, name, expression, masterId.isEmpty() ? null : masterId, op, th, selJson, mode, every, enabled ? 1 : 0,
                    owner.id(), owner.name(), now, now);
        } else {
            jdbc.update("""
                UPDATE alerts SET name = ?, expression = ?, master_id = ?, op = ?, threshold = ?, selections_json = ?, check_mode = ?,
                  interval_minutes = ?, enabled = ?, updated_at = ? WHERE id = ?""",
                    name, expression, masterId.isEmpty() ? null : masterId, op, th, selJson, mode, every, enabled ? 1 : 0, now, id);
        }
        Map<String, Object> a = alert(id).orElseThrow();
        return enabled ? evaluate(a) : alertOut(a);
    }

    public boolean deleteAlert(String id) { return jdbc.update("DELETE FROM alerts WHERE id = ?", id) > 0; }

    /** Revisa una alerta: calcula el valor, compara y, si cambió de estado, avisa a su dueño. Devuelve la alerta. */
    public Map<String, Object> evaluate(Map<String, Object> a) {
        String id = str(a.get("id")), appId = str(a.get("app_id"));
        String prevState = str(a.get("state"));
        Double prev = a.get("last_value") == null ? null : toDouble(a.get("last_value"));
        String op = str(a.get("op"));
        double th = toDouble(a.get("threshold"));
        String now = Ids.now();
        Double value;
        try {
            value = ask.measureValue(appId, a.get("master_id") == null ? null : str(a.get("master_id")), str(a.get("expression")), parseSel(a.get("selections_json")));
        } catch (RuntimeException e) {
            String msg = "No se pudo calcular: " + e.getMessage();
            jdbc.update("UPDATE alerts SET state = 'error', last_checked_at = ?, last_message = ? WHERE id = ?", now, clip(msg, 400), id);
            if (!"error".equals(prevState)) event(a, "alert", "Alerta con error: " + a.get("name"), msg, "error");
            return alertOut(alert(id).orElseThrow());
        }
        double v = value == null ? 0 : value;
        boolean hit;
        String why;
        if ("change".equals(op)) {
            if (prev == null) { hit = false; why = "Primera revisión: " + fmt(v) + " (se compara desde la próxima)."; }
            else {
                double pct = prev == 0 ? (v == 0 ? 0 : 100) : Math.abs(v - prev) / Math.abs(prev) * 100;
                hit = pct >= th;
                why = "Pasó de " + fmt(prev) + " a " + fmt(v) + " (" + (v >= prev ? "+" : "−") + fmt(pct) + " %; umbral " + fmt(th) + " %).";
            }
        } else {
            hit = switch (op) {
                case ">" -> v > th; case ">=" -> v >= th; case "<" -> v < th; case "<=" -> v <= th;
                case "=" -> Math.abs(v - th) < 1e-9; default -> Math.abs(v - th) >= 1e-9;
            };
            why = "Valor actual " + fmt(v) + (hit ? " cumple " : " no cumple ") + conditionText(op, th) + ".";
        }
        String state = hit ? "triggered" : "ok";
        jdbc.update("UPDATE alerts SET state = ?, prev_value = last_value, last_value = ?, last_checked_at = ?, last_message = ?"
                + (hit && !"triggered".equals(prevState) ? ", last_triggered_at = '" + now + "'" : "") + " WHERE id = ?",
                state, v, now, clip(why, 400), id);
        if (hit && !"triggered".equals(prevState)) event(a, "alert", "Alerta: " + a.get("name"), why, "triggered");
        else if (!hit && "triggered".equals(prevState)) event(a, "alert_ok", "Alerta resuelta: " + a.get("name"), why, "ok");
        return alertOut(alert(id).orElseThrow());
    }

    private void event(Map<String, Object> a, String kind, String title, String detail, String extra) {
        String owner = str(a.get("owner_id"));
        if (owner.isBlank()) return;
        String appName = apps.getApp(str(a.get("app_id"))).map(x -> x.name()).orElse("");
        notifications.addEvent(kind, title, appName + " · " + clip(detail, 200), str(a.get("app_id")), str(a.get("id")), extra, owner);
    }

    static String conditionText(String op, double th) {
        return switch (op) {
            case ">" -> "> " + fmt(th); case ">=" -> "≥ " + fmt(th); case "<" -> "< " + fmt(th); case "<=" -> "≤ " + fmt(th);
            case "=" -> "= " + fmt(th); case "!=" -> "≠ " + fmt(th);
            default -> "cambio ≥ " + fmt(th) + " %";
        };
    }

    /* ================================ Reloj ================================ */

    @Scheduled(initialDelay = 20_000, fixedDelay = 30_000)
    public void tick() {
        Instant now = Instant.now();
        for (Map<String, Object> s : jdbc.queryForList("SELECT * FROM schedules WHERE enabled = 1 AND next_run_at IS NOT NULL")) {
            String appId = str(s.get("app_id"));
            try {
                if (Instant.parse(str(s.get("next_run_at"))).isAfter(now)) continue;
                // la próxima se fija antes de correr: una carga larga no se dispara dos veces
                jdbc.update("UPDATE schedules SET next_run_at = ? WHERE app_id = ?", nextRun(s, now).toString(), appId);
                Optional<UserRecord> owner = users.get(str(s.get("owner_id")));
                if (owner.isEmpty() || !owner.get().active()) {
                    afterReload(new ReloadDone(appId, "schedule", null,
                            Map.of("ok", false, "log", List.of("ERROR: quien programó la carga ya no existe o está inactivo; vuelve a guardarla."), "tables", List.of()), 0));
                    continue;
                }
                log.info("Carga programada de {} ({})", appId, describe(s));
                runNow(appId, owner.get(), "schedule");
            } catch (RuntimeException e) {
                log.warn("Carga programada de {} falló: {}", appId, e.getMessage());
            }
        }
        for (Map<String, Object> a : jdbc.queryForList("SELECT * FROM alerts WHERE enabled = 1 AND check_mode = 'interval'")) {
            try {
                Object last = a.get("last_checked_at");
                int every = Math.max(5, toInt(a.get("interval_minutes")));
                if (last != null && OffsetDateTime.parse(str(last)).toInstant().plus(Duration.ofMinutes(every)).isAfter(now)) continue;
                evaluate(a);
            } catch (RuntimeException e) {
                log.warn("Alerta {}: {}", a.get("id"), e.getMessage());
            }
        }
    }

    /* ================================ utilidades ================================ */

    private Map<String, List<Object>> parseSel(Object json) {
        if (json == null || str(json).isBlank()) return Map.of();
        try { return mapper.readValue(str(json), new TypeReference<Map<String, List<Object>>>() {}); }
        catch (Exception e) { return Map.of(); }
    }

    private static final NumberFormat NF = NumberFormat.getNumberInstance(Locale.forLanguageTag("es-CO"));
    static { NF.setMaximumFractionDigits(2); }
    static String fmt(double v) { return NF.format(v); }

    static String str(Object o) { return o == null ? "" : String.valueOf(o); }
    static int toInt(Object o) {
        if (o == null) return 0;
        if (o instanceof Number n) return n.intValue();
        try { return (int) Double.parseDouble(String.valueOf(o).trim()); } catch (NumberFormatException e) { return 0; }
    }
    static Double toDouble(Object o) {
        if (o == null) return null;
        if (o instanceof Number n) return n.doubleValue();
        try { return Double.parseDouble(String.valueOf(o).trim().replace(",", ".")); } catch (NumberFormatException e) { return Double.NaN; }
    }
    private static String clip(String s, int n) { return s == null ? null : s.length() <= n ? s : s.substring(0, n - 1) + "…"; }
}
