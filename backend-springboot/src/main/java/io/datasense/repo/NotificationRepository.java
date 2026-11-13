package io.datasense.repo;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.List;

/**
 * Notificaciones de actividad para el administrador. No hay tabla de eventos: el
 * feed se DERIVA de lo que ya existe con {@code created_at} (apps, tablas cargadas,
 * hojas, colecciones, elementos maestros, conexiones, experimentos y ejecuciones de
 * ML), así cualquier creación —desde la UI, la API o el MCP— aparece sola.
 * Solo se persiste el estado de lectura: {@code notification_state} (marcas
 * {@code read_all_at} / {@code cleared_at}) y {@code notification_reads} (una a una).
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

    private final JdbcTemplate jdbc;

    public NotificationRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    private String state(String key) {
        List<String> v = jdbc.queryForList("SELECT value FROM notification_state WHERE key = ?", String.class, key);
        return v.isEmpty() ? "" : v.get(0);
    }

    private void setState(String key, String value) {
        jdbc.update("INSERT INTO notification_state (key, value) VALUES (?, ?) "
                + "ON CONFLICT(key) DO UPDATE SET value = excluded.value", key, value);
    }

    /**
     * @param limit       máximo de notificaciones (1..200)
     * @param unreadOnly  solo las no leídas
     */
    public NotificationFeed feed(int limit, boolean unreadOnly) {
        int lim = Math.max(1, Math.min(200, limit));
        String cleared = state("cleared_at");
        String readAll = state("read_all_at");
        String unreadCond = " AND u.created_at > ? AND u.nid NOT IN (SELECT id FROM notification_reads)";
        String base = "SELECT u.* FROM (" + FEED + ") u WHERE u.created_at > ?";

        List<NotificationOut> items = jdbc.query(
                base + (unreadOnly ? unreadCond : "") + " ORDER BY u.created_at DESC LIMIT ?",
                (rs, i) -> {
                    String nid = rs.getString("nid");
                    String kind = rs.getString("kind");
                    String created = rs.getString("created_at");
                    return new NotificationOut(nid, kind, rs.getString("title"), rs.getString("detail"),
                            rs.getString("app_id"), rs.getString("ref_id"), rs.getString("extra"), created,
                            false, link(kind, rs.getString("app_id"), rs.getString("ref_id")));
                },
                unreadOnly ? new Object[]{cleared, readAll, lim} : new Object[]{cleared, lim});

        // Marca de leído (global o individual).
        List<String> readIds = jdbc.queryForList("SELECT id FROM notification_reads", String.class);
        java.util.Set<String> readSet = new java.util.HashSet<>(readIds);
        List<NotificationOut> marked = items.stream().map(n -> new NotificationOut(n.id(), n.kind(), n.title(),
                n.detail(), n.app_id(), n.ref_id(), n.extra(), n.created_at(),
                n.created_at().compareTo(readAll) <= 0 || readSet.contains(n.id()), n.link())).toList();

        Integer unread = jdbc.queryForObject("SELECT COUNT(*) FROM (" + FEED + ") u WHERE u.created_at > ?" + unreadCond,
                Integer.class, cleared, readAll);
        Integer total = jdbc.queryForObject("SELECT COUNT(*) FROM (" + FEED + ") u WHERE u.created_at > ?",
                Integer.class, cleared);
        return new NotificationFeed(marked, unread == null ? 0 : unread, total == null ? 0 : total);
    }

    /** Marca todas como leídas (las futuras seguirán llegando como no leídas). */
    public void markAllRead() {
        setState("read_all_at", Ids.now());
        jdbc.update("DELETE FROM notification_reads");
    }

    /** Marca una como leída. */
    public void markRead(String id) {
        jdbc.update("INSERT OR IGNORE INTO notification_reads (id, read_at) VALUES (?, ?)", id, Ids.now());
    }

    /** Oculta del panel todo lo existente (no borra ningún dato de la plataforma). */
    public void clear() {
        String now = Ids.now();
        setState("cleared_at", now);
        setState("read_all_at", now);
        jdbc.update("DELETE FROM notification_reads");
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
            default -> "/pages/inicio.html";
        };
    }
}
