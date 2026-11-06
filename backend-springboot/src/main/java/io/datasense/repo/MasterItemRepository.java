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
            "id, app_id, kind, name, expression, description, resolved_json, created_at, updated_at";

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
        String id = Ids.newId();
        String now = Ids.now();
        jdbc.update("INSERT INTO master_items (id, app_id, kind, name, expression, description, "
                        + "resolved_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                id, appId, kind, name, expression, description, write(resolved), now, now);
        return get(id).orElseThrow();
    }

    public Optional<Map<String, Object>> update(String id, String name, String expression,
                                                String description, Map<String, Object> resolved) {
        int n = jdbc.update("UPDATE master_items SET name = ?, expression = ?, description = ?, "
                        + "resolved_json = ?, updated_at = ? WHERE id = ?",
                name, expression, description, write(resolved), Ids.now(), id);
        return n > 0 ? get(id) : Optional.empty();
    }

    public boolean delete(String id) {
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
