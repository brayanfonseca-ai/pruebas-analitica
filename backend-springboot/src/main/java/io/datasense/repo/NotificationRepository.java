package io.datasense.repo;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Notificaciones (campana). Dos fuentes:
 * <ul>
 *   <li><b>Actividad de la plataforma</b> (solo administradores): se DERIVA de lo que ya existe con
 *   {@code created_at} (apps, tablas cargadas, hojas, colecciones, maestros, conexiones, experimentos y ML), así
 *   cualquier creación —UI, API o MCP— aparece sola.</li>
 *   <li><b>Eventos de automatización</b> ({@code automation_events}): alertas disparadas, recargas programadas que
 *   fallan o terminan; cada evento es de un usuario (el dueño de la alerta o de la programación). Cada persona ve
 *   los suyos; el administrador ve todos.</li>
 * </ul>
 * El estado de lectura es por usuario: {@code notification_state} (claves {@code <userId>:read_all_at} /
 * {@code <userId>:cleared_at}) y {@code notification_reads} ({@code <userId>|<nid>}).
 */
@Repository
public class NotificationRepository {

    /** Una notificación lista para pintar. {@code link} es la ruta del frontend. */
    public record NotificationOut(String id, String kind, String title, String detail,
                                  String app_id, String ref_id, String extra,
                                  String created_at, boolean read, String link) {}

    /** Feed + contadores. */
    public record NotificationFeed(List<NotificationOut> items, int unread, int total) {}

    private static final String FEED = """
        SELECT 'app:' || id AS nid, 'app' AS kind, name AS title, NULL AS detail,
               id AS app_id, id AS ref_id, NULL AS extra, created_at FROM apps
        UNION ALL
        SELECT 'table:' || t.id, 'table', t.name, a.name, t.app_id, t.id,
               (SELECT s.connector FROM table_sources s WHERE s.table_id = t.id), t.created_at
          FROM tables t JOIN apps a ON a.id = t.app_id
        UNION ALL
        SELECT 'sheet:' || s.id, 'sheet', s.title, a.name, s.app_id, s.id, NULL, s.created_at
          FROM app_sheets s JOIN apps a ON a.id = s.app_id
        UNION ALL
        SELECT 'collection:' || id, 'collection', name, description, NULL, id, NULL, created_at FROM collections
        UNION ALL
        SELECT 'master:' || m.id, 'master', m.name, a.name, m.app_id, m.id, m.kind, m.created_at
          FROM master_items m JOIN apps a ON a.id = m.app_id
        UNION ALL
        SELECT 'connection:' || c.id, 'connection', c.name, COALESCE(u.name, ''), NULL, c.id, c.connector, c.created_at
          FROM data_connections c LEFT JOIN users u ON u.id = c.owner_id
        UNION ALL
        SELECT 'experiment:' || e.id, 'experiment', e.name, a.name, e.app_id, e.id, e.table_ref, e.created_at
          FROM ml_experiments e JOIN apps a ON a.id = e.app_id
        UNION ALL
        SELECT 'run:' || r.id, 'run', COALESCE(NULLIF(r.label, ''), r.algorithm), e.name, e.app_id, e.id,
               CASE WHEN r.metric_name IS NOT NULL AND r.metric_value IS NOT NULL
                    THEN r.algorithm || '|' || r.metric_name || '|' || printf('%.4f', r.metric_value)
                    ELSE r.algorithm END,
               r.created_at
          FROM ml_runs r JOIN ml_experiments e ON e.id = r.experiment_id
        """;

    private static final String EVENTS =
            "SELECT 'evt:' || id AS nid, kind, title, detail, app_id, ref_id, extra, created_at FROM automation_events";

    private final JdbcTemplate jdbc;

    public NotificationRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** Registra un evento de automatización para {@code userId} (aparece en su campana). */
    public void addEvent(String kind, String title, String detail, String appId, String refId, String extra, String userId) {
        jdbc.update("INSERT INTO automation_events (id, kind, title, detail, app_id, ref_id, extra, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                Ids.newId(), kind, title, detail, appId, refId, extra, userId, Ids.now());
    }

    private String state(String userId, String key, boolean legacy) {
        List<String> v = jdbc.queryForList("SELECT value FROM notification_state WHERE key = ?", String.class, userId + ":" + key);
        if (!v.isEmpty()) return v.get(0);
        if (legacy) {
            v = jdbc.queryForList("SELECT value FROM notification_state WHERE key = ?", String.class, key);
            if (!v.isEmpty()) return v.get(0);
        }
        return "";
    }

    private void setState(String userId, String key, String value) {
        jdbc.update("INSERT INTO notification_state (key, value) VALUES (?, ?) "
                + "ON CONFLICT(key) DO UPDATE SET value = excluded.value", userId + ":" + key, value);
    }

    /**
     * @param userId     quien consulta
     * @param admin      ve también la actividad de la plataforma y los eventos de todos
     * @param limit      máximo de notificaciones (1..200)
     * @param unreadOnly solo las no leídas
     */
    public NotificationFeed feed(String userId, boolean admin, int limit, boolean unreadOnly) {
        int lim = Math.max(1, Math.min(200, limit));
        String cleared = state(userId, "cleared_at", admin);
        String readAll = state(userId, "read_all_at", admin);
        String source = admin ? FEED + " UNION ALL " + EVENTS : EVENTS + " WHERE user_id = ?";
        List<Object> args = new ArrayList<>();
        if (!admin) args.add(userId);
        args.add(cleared);
        List<NotificationOut> all = jdbc.query("SELECT u.* FROM (" + source + ") u WHERE u.created_at > ? ORDER BY u.created_at DESC LIMIT 1000",
                (rs, i) -> new NotificationOut(rs.getString("nid"), rs.getString("kind"), rs.getString("title"), rs.getString("detail"),
                        rs.getString("app_id"), rs.getString("ref_id"), rs.getString("extra"), rs.getString("created_at"),
                        false, link(rs.getString("kind"), rs.getString("app_id"), rs.getString("ref_id"))), args.toArray());

        Set<String> reads = new HashSet<>();
        String prefix = userId + "|";
        for (String id : jdbc.queryForList("SELECT id FROM notification_reads", String.class)) {
            if (id.startsWith(prefix)) reads.add(id.substring(prefix.length()));
            else if (admin && !id.contains("|")) reads.add(id);   // marcas anteriores al estado por usuario
        }
        List<NotificationOut> marked = new ArrayList<>();
        int unread = 0;
        for (NotificationOut n : all) {
            boolean read = n.created_at().compareTo(readAll) <= 0 || reads.contains(n.id());
            if (!read) unread++;
            if (unreadOnly && read) continue;
            if (marked.size() < lim) marked.add(new NotificationOut(n.id(), n.kind(), n.title(), n.detail(), n.app_id(), n.ref_id(),
                    n.extra(), n.created_at(), read, n.link()));
        }
        return new NotificationFeed(marked, unread, all.size());
    }

    /** Marca todas como leídas (las futuras seguirán llegando como no leídas). */
    public void markAllRead(String userId) {
        setState(userId, "read_all_at", Ids.now());
        jdbc.update("DELETE FROM notification_reads WHERE id LIKE ?", userId + "|%");
    }

    /** Marca una como leída. */
    public void markRead(String userId, String id) {
        jdbc.update("INSERT OR IGNORE INTO notification_reads (id, read_at) VALUES (?, ?)", userId + "|" + id, Ids.now());
    }

    /** Oculta del panel todo lo existente (no borra ningún dato de la plataforma). */
    public void clear(String userId) {
        String now = Ids.now();
        setState(userId, "cleared_at", now);
        setState(userId, "read_all_at", now);
        jdbc.update("DELETE FROM notification_reads WHERE id LIKE ?", userId + "|%");
    }

    private static String enc(String s) {
        return URLEncoder.encode(s == null ? "" : s, StandardCharsets.UTF_8);
    }

    /** Ruta del frontend que abre el elemento. */
    static String link(String kind, String appId, String refId) {
        String app = "/pages/app.html?app=" + enc(appId);
        return switch (kind) {
            case "app" -> app;
            case "table" -> app + "#datos";
            case "sheet" -> app + "&sheet=" + enc(refId) + "#hoja";
            case "collection" -> "/pages/hub.html?page=colecciones";
            case "master" -> app + "#logico";
            case "connection" -> "/pages/conexiones.html";
            case "experiment", "run" -> "/pages/experimento.html?id=" + enc(refId);
            case "alert", "alert_ok", "reload", "reload_fail", "health" -> app + "#automatizar";
            case "insight" -> app + "#insights";
            case "flow" -> "/pages/automatizaciones.html?flow=" + enc(refId);
            default -> "/pages/inicio.html";
        };
    }
}
