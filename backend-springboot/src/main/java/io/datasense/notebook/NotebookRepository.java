package io.datasense.notebook;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;

import io.datasense.repo.Ids;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.*;

/** Tabla {@code notebooks}: cuadernos de análisis por app; las celdas se guardan como JSON. */
@Repository
public class NotebookRepository {

    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper = new ObjectMapper();

    public NotebookRepository(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    private Map<String, Object> row(java.sql.ResultSet rs, boolean withCells) throws java.sql.SQLException {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", rs.getString("id"));
        m.put("app_id", rs.getString("app_id"));
        m.put("name", rs.getString("name"));
        m.put("description", rs.getString("description"));
        List<Map<String, Object>> cells = parse(rs.getString("cells_json"));
        m.put("cell_count", cells.size());
        Map<String, Integer> kinds = new LinkedHashMap<>();
        for (Map<String, Object> c : cells) kinds.merge(String.valueOf(c.getOrDefault("kind", "sql")), 1, Integer::sum);
        m.put("kinds", kinds);
        if (withCells) m.put("cells", cells);
        m.put("owner_id", rs.getString("owner_id"));
        m.put("owner_name", rs.getString("owner_name"));
        m.put("created_at", rs.getString("created_at"));
        m.put("updated_at", rs.getString("updated_at"));
        return m;
    }

    private List<Map<String, Object>> parse(String json) {
        try { return json == null ? new ArrayList<>() : mapper.readValue(json, new TypeReference<List<Map<String, Object>>>() {}); }
        catch (Exception e) { return new ArrayList<>(); }
    }

    private String write(List<Map<String, Object>> cells) {
        try { return mapper.writeValueAsString(cells == null ? List.of() : cells); } catch (Exception e) { return "[]"; }
    }

    public List<Map<String, Object>> list(String appId) {
        return jdbc.query("SELECT * FROM notebooks WHERE app_id = ? ORDER BY updated_at DESC", (rs, i) -> row(rs, false), appId);
    }

    public Optional<Map<String, Object>> get(String appId, String id) {
        return jdbc.query("SELECT * FROM notebooks WHERE app_id = ? AND id = ?", (rs, i) -> row(rs, true), appId, id).stream().findFirst();
    }

    public Map<String, Object> create(String appId, String name, String description, List<Map<String, Object>> cells, String ownerId, String ownerName) {
        String id = Ids.newId(), now = Ids.now();
        jdbc.update("INSERT INTO notebooks (id, app_id, name, description, cells_json, owner_id, owner_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                id, appId, name, description, write(cells), ownerId, ownerName, now, now);
        return get(appId, id).orElseThrow();
    }

    public Optional<Map<String, Object>> update(String appId, String id, String name, String description, boolean descProvided, List<Map<String, Object>> cells) {
        Map<String, Object> cur = get(appId, id).orElse(null);
        if (cur == null) return Optional.empty();
        @SuppressWarnings("unchecked") List<Map<String, Object>> curCells = (List<Map<String, Object>>) cur.get("cells");
        jdbc.update("UPDATE notebooks SET name = ?, description = ?, cells_json = ?, updated_at = ? WHERE app_id = ? AND id = ?",
                name != null ? name : cur.get("name"), descProvided ? description : cur.get("description"),
                write(cells != null ? cells : curCells), Ids.now(), appId, id);
        return get(appId, id);
    }

    public boolean delete(String appId, String id) {
        return jdbc.update("DELETE FROM notebooks WHERE app_id = ? AND id = ?", appId, id) > 0;
    }
}
