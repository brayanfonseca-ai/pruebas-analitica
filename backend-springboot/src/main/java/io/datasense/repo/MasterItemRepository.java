package io.datasense.repo;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Map;
import java.util.Optional;

/** Acceso a {@code master_items}. resolved_json guarda el spec compilado. */
@Repository
public class MasterItemRepository {

    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper = new ObjectMapper();

    public MasterItemRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    private static final String COLS =
            "id, app_id, kind, name, expression, description, resolved_json, created_at, updated_at, "
                    + "certified, certified_by, certified_at, certified_note, version";

    private final RowMapper<Map<String, Object>> mapRow = (rs, i) -> {
        Map<String, Object> m = new java.util.LinkedHashMap<>();
        m.put("id", rs.getString("id"));
        m.put("app_id", rs.getString("app_id"));
        m.put("kind", rs.getString("kind"));
        m.put("name", rs.getString("name"));
        m.put("expression", rs.getString("expression"));
        m.put("description", rs.getString("description"));
        m.put("resolved", parse(rs.getString("resolved_json")));
        m.put("created_at", rs.getString("created_at"));
        m.put("updated_at", rs.getString("updated_at"));
        m.put("certified", rs.getInt("certified") == 1);
        m.put("certified_by", rs.getString("certified_by"));
        m.put("certified_at", rs.getString("certified_at"));
        m.put("certified_note", rs.getString("certified_note"));
        m.put("version", rs.getInt("version"));
        return m;
    };

    public List<Map<String, Object>> list(String appId, String kind) {
        if (kind != null && !kind.isBlank()) {
            return jdbc.query("SELECT " + COLS + " FROM master_items WHERE app_id = ? AND kind = ? "
                    + "ORDER BY kind, name COLLATE NOCASE", mapRow, appId, kind);
        }
        return jdbc.query("SELECT " + COLS + " FROM master_items WHERE app_id = ? "
                + "ORDER BY kind, name COLLATE NOCASE", mapRow, appId);
    }

    public Optional<Map<String, Object>> get(String id) {
        return jdbc.query("SELECT " + COLS + " FROM master_items WHERE id = ?", mapRow, id).stream().findFirst();
    }

    public Map<String, Object> create(String appId, String kind, String name, String expression,
                                      String description, Map<String, Object> resolved) {
        return create(appId, kind, name, expression, description, resolved, null);
    }

    /** Crea el elemento y su versión 1 en el historial. */
    public Map<String, Object> create(String appId, String kind, String name, String expression,
                                      String description, Map<String, Object> resolved, String author) {
        String id = Ids.newId();
        String now = Ids.now();
        jdbc.update("INSERT INTO master_items (id, app_id, kind, name, expression, description, "
                        + "resolved_json, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)",
                id, appId, kind, name, expression, description, write(resolved), now, now);
        addVersion(id, 1, name, expression, description, "Creación", author, now);
        return get(id).orElseThrow();
    }

    public Optional<Map<String, Object>> update(String id, String name, String expression,
                                                String description, Map<String, Object> resolved) {
        return update(id, name, expression, description, resolved, null, null);
    }

    /**
     * Actualiza el elemento. Si cambian el nombre, la expresión o la descripción se guarda una versión nueva en el
     * historial (la anterior queda consultable y restaurable).
     */
    public Optional<Map<String, Object>> update(String id, String name, String expression, String description,
                                                Map<String, Object> resolved, String author, String message) {
        Optional<Map<String, Object>> before = get(id);
        if (before.isEmpty()) return Optional.empty();
        Map<String, Object> b = before.get();
        boolean changed = !java.util.Objects.equals(b.get("name"), name)
                || !java.util.Objects.equals(b.get("expression"), expression)
                || !java.util.Objects.equals(blankToNull(b.get("description")), blankToNull(description));
        int version = ((Number) b.getOrDefault("version", 1)).intValue();
        if (changed) {
            ensureBaseline(id, b);
            version++;
        }
        String now = Ids.now();
        jdbc.update("UPDATE master_items SET name = ?, expression = ?, description = ?, "
                        + "resolved_json = ?, updated_at = ?, version = ? WHERE id = ?",
                name, expression, description, write(resolved), now, version, id);
        if (changed) addVersion(id, version, name, expression, description,
                message == null || message.isBlank() ? describeChange(b, name, expression) : message.strip(), author, now);
        return get(id);
    }

    /** Elementos creados antes del historial: su definición vigente se guarda como versión base antes de cambiarla. */
    private void ensureBaseline(String id, Map<String, Object> b) {
        Integer n = jdbc.queryForObject("SELECT COUNT(*) FROM master_item_versions WHERE item_id = ?", Integer.class, id);
        if (n != null && n > 0) return;
        addVersion(id, ((Number) b.getOrDefault("version", 1)).intValue(), (String) b.get("name"), (String) b.get("expression"),
                (String) b.get("description"), "Definición inicial", null, String.valueOf(b.get("updated_at")));
    }

    private static String describeChange(Map<String, Object> b, String name, String expression) {
        List<String> what = new java.util.ArrayList<>();
        if (!java.util.Objects.equals(b.get("expression"), expression)) what.add("expresión");
        if (!java.util.Objects.equals(b.get("name"), name)) what.add("nombre");
        if (what.isEmpty()) what.add("descripción");
        return "Cambio de " + String.join(" y ", what);
    }

    private static Object blankToNull(Object o) { return o == null || String.valueOf(o).isBlank() ? null : String.valueOf(o).strip(); }

    private void addVersion(String id, int version, String name, String expression, String description,
                            String message, String author, String at) {
        jdbc.update("INSERT OR REPLACE INTO master_item_versions (item_id, version, name, expression, description, message, author_name, created_at) "
                + "VALUES (?, ?, ?, ?, ?, ?, ?, ?)", id, version, name, expression, description, message == null ? "" : message, author, at);
    }

    /** Historial de versiones, la más reciente primero: [{version, name, expression, description, message, author_name, created_at, is_current}]. */
    public List<Map<String, Object>> versions(String id) {
        int current = get(id).map(m -> ((Number) m.get("version")).intValue()).orElse(0);
        return jdbc.query("SELECT version, name, expression, description, message, author_name, created_at "
                + "FROM master_item_versions WHERE item_id = ? ORDER BY version DESC", (rs, i) -> {
            Map<String, Object> v = new java.util.LinkedHashMap<>();
            v.put("version", rs.getInt("version"));
            v.put("name", rs.getString("name"));
            v.put("expression", rs.getString("expression"));
            v.put("description", rs.getString("description"));
            v.put("message", rs.getString("message"));
            v.put("author_name", rs.getString("author_name"));
            v.put("created_at", rs.getString("created_at"));
            v.put("is_current", rs.getInt("version") == current);
            return v;
        }, id);
    }

    public Optional<Map<String, Object>> version(String id, int version) {
        return versions(id).stream().filter(v -> ((Number) v.get("version")).intValue() == version).findFirst();
    }

    /** Marca/desmarca la métrica como certificada (definición oficial). */
    public Optional<Map<String, Object>> certify(String id, boolean certified, String by, String note) {
        int n = certified
                ? jdbc.update("UPDATE master_items SET certified = 1, certified_by = ?, certified_at = ?, certified_note = ? WHERE id = ?",
                        by, Ids.now(), note == null || note.isBlank() ? null : note.strip(), id)
                : jdbc.update("UPDATE master_items SET certified = 0, certified_by = NULL, certified_at = NULL, certified_note = NULL WHERE id = ?", id);
        return n > 0 ? get(id) : Optional.empty();
    }

    public boolean delete(String id) {
        jdbc.update("DELETE FROM master_item_versions WHERE item_id = ?", id);
        return jdbc.update("DELETE FROM master_items WHERE id = ?", id) > 0;
    }

    private Map<String, Object> parse(String json) {
        try { return mapper.readValue(json, new TypeReference<Map<String, Object>>() {}); }
        catch (Exception e) { return Map.of(); }
    }

    private String write(Object o) {
        try { return mapper.writeValueAsString(o); } catch (Exception e) { return "{}"; }
    }
}
