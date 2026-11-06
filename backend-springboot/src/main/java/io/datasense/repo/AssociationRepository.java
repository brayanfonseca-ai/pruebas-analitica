package io.datasense.repo;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Map;

/** Acceso a {@code associations} (asociaciones persistidas por el usuario). */
@Repository
public class AssociationRepository {

    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper = new ObjectMapper();

    public AssociationRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    private final RowMapper<Map<String, Object>> mapRow = (rs, i) -> {
        Map<String, Object> m = new java.util.LinkedHashMap<>();
        m.put("id", rs.getString("id"));
        m.put("app_id", rs.getString("app_id"));
        m.put("left_table", rs.getString("left_table"));
        m.put("right_table", rs.getString("right_table"));
        m.put("fields", parseList(rs.getString("fields_json")));
        m.put("basis", rs.getString("basis"));
        m.put("confidence", rs.getObject("confidence"));
        m.put("is_custom", rs.getInt("is_custom") == 1);
        return m;
    };

    public List<Map<String, Object>> list(String appId) {
        return jdbc.query("SELECT id, app_id, left_table, right_table, fields_json, basis, confidence, is_custom "
                + "FROM associations WHERE app_id = ?", mapRow, appId);
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> save(String appId, Map<String, Object> body, boolean custom) {
        String id = Ids.newId();
        Object fields = body.getOrDefault("fields", List.of());
        Object conf = body.get("confidence");
        jdbc.update("INSERT INTO associations (id, app_id, left_table, right_table, fields_json, basis, confidence, is_custom) "
                        + "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                id, appId, str(body.get("left_table")), str(body.get("right_table")),
                write(fields), str(body.get("basis")),
                conf == null ? null : ((Number) conf).doubleValue(), custom ? 1 : 0);
        return list(appId).stream().filter(a -> id.equals(a.get("id"))).findFirst().orElseThrow();
    }

    public boolean delete(String id) {
        return jdbc.update("DELETE FROM associations WHERE id = ?", id) > 0;
    }

    private List<Object> parseList(String json) {
        try { return mapper.readValue(json, new TypeReference<List<Object>>() {}); }
        catch (Exception e) { return List.of(); }
    }

    private String write(Object o) {
        try { return mapper.writeValueAsString(o); } catch (Exception e) { return "[]"; }
    }

    private static String str(Object o) { return o == null ? null : String.valueOf(o); }
}
