package io.datasense.repo;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Comentarios sobre los objetos de una hoja. Cada comentario pertenece a un objeto ({@code object_id}) de una hoja y
 * puede anclarse a un punto del gráfico ({@code point}, p. ej. «EMPRESA = Vigía»). Se pueden marcar como resueltos.
 */
@Repository
public class CommentRepository {

    private final JdbcTemplate jdbc;

    public CommentRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    private static final String COLS = "id, app_id, sheet_id, object_id, point, text, author_id, author_name, resolved, selections_json, created_at";
    private final com.fasterxml.jackson.databind.ObjectMapper mapper = new com.fasterxml.jackson.databind.ObjectMapper();

    private final RowMapper<Map<String, Object>> mapRow = (rs, i) -> {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", rs.getString("id"));
        m.put("app_id", rs.getString("app_id"));
        m.put("sheet_id", rs.getString("sheet_id"));
        m.put("object_id", rs.getString("object_id"));
        m.put("point", rs.getString("point"));
        m.put("text", rs.getString("text"));
        m.put("author_id", rs.getString("author_id"));
        m.put("author_name", rs.getString("author_name"));
        m.put("resolved", rs.getInt("resolved") == 1);
        String sj = rs.getString("selections_json");
        Object sel = null;
        if (sj != null && !sj.isBlank()) {
            try { sel = mapper.readValue(sj, Map.class); } catch (Exception ignored) { /* selección ilegible: se omite */ }
        }
        m.put("selections", sel);
        m.put("created_at", rs.getString("created_at"));
        return m;
    };

    /** Comentarios de la app, opcionalmente de una hoja y/o un objeto (más antiguos primero, como un hilo). */
    public List<Map<String, Object>> list(String appId, String sheetId, String objectId) {
        StringBuilder sql = new StringBuilder("SELECT " + COLS + " FROM comments WHERE app_id = ?");
        List<Object> args = new java.util.ArrayList<>(List.of(appId));
        if (sheetId != null && !sheetId.isBlank()) { sql.append(" AND sheet_id = ?"); args.add(sheetId); }
        if (objectId != null && !objectId.isBlank()) { sql.append(" AND object_id = ?"); args.add(objectId); }
        sql.append(" ORDER BY created_at ASC");
        return jdbc.query(sql.toString(), mapRow, args.toArray());
    }

    public Optional<Map<String, Object>> get(String id) {
        return jdbc.query("SELECT " + COLS + " FROM comments WHERE id = ?", mapRow, id).stream().findFirst();
    }

    /** {@code selections}: selección activa al comentar ({campo: [valores]}), para volver a «ese punto». */
    public Map<String, Object> create(String appId, String sheetId, String objectId, String point, String text,
                                      String authorId, String authorName, Map<String, Object> selections) {
        String id = Ids.newId();
        String sj = null;
        if (selections != null && !selections.isEmpty()) {
            try { sj = mapper.writeValueAsString(selections); } catch (Exception ignored) { /* sin selección */ }
        }
        jdbc.update("INSERT INTO comments (id, app_id, sheet_id, object_id, point, text, author_id, author_name, resolved, selections_json, created_at) "
                + "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)", id, appId, sheetId, objectId, point, text, authorId, authorName, sj, Ids.now());
        return get(id).orElseThrow();
    }

    public Optional<Map<String, Object>> setResolved(String id, boolean resolved) {
        int n = jdbc.update("UPDATE comments SET resolved = ? WHERE id = ?", resolved ? 1 : 0, id);
        return n > 0 ? get(id) : Optional.empty();
    }

    public boolean delete(String id) {
        return jdbc.update("DELETE FROM comments WHERE id = ?", id) > 0;
    }
}
