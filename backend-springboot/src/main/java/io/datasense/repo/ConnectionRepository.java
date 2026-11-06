package io.datasense.repo;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Acceso a {@code connections} (conexiones de datos: DataFiles, Athena, S3,
 * bases de datos…). La config se guarda como JSON; al leer, los campos secretos
 * (claves/tokens/contraseñas) se enmascaran para no exponerlos en la API.
 */
@Repository
public class ConnectionRepository {

    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper = new ObjectMapper();

    // Claves cuyo valor se enmascara al devolverlas.
    private static final java.util.Set<String> SECRET = java.util.Set.of(
            "secretKey", "sessionToken", "password", "proxyPassword", "accessKeyId", "kmsKey");

    public ConnectionRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    private static final String COLS = "id, app_id, name, connector, space, config_json, created_at, updated_at";

    private final RowMapper<Map<String, Object>> mapRow = (rs, i) -> {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", rs.getString("id"));
        m.put("app_id", rs.getString("app_id"));
        m.put("name", rs.getString("name"));
        m.put("connector", rs.getString("connector"));
        m.put("space", rs.getString("space"));
        m.put("config", mask(parse(rs.getString("config_json"))));
        m.put("created_at", rs.getString("created_at"));
        m.put("updated_at", rs.getString("updated_at"));
        return m;
    };

    public List<Map<String, Object>> list(String appId) {
        return jdbc.query("SELECT " + COLS + " FROM connections WHERE app_id = ? ORDER BY created_at", mapRow, appId);
    }

    public Optional<Map<String, Object>> get(String id) {
        return jdbc.query("SELECT " + COLS + " FROM connections WHERE id = ?", mapRow, id).stream().findFirst();
    }

    /**
     * Devuelve la config SIN enmascarar de una conexión, para uso interno de los
     * executors (abrir la conexión real necesita los secretos). NO exponer por la
     * API: {@link #list(String)}/{@link #get(String)} siguen enmascarados.
     */
    public Optional<Map<String, Object>> getRaw(String id) {
        return jdbc.query("SELECT " + COLS + " FROM connections WHERE id = ?",
                (rs, i) -> {
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("id", rs.getString("id"));
                    m.put("app_id", rs.getString("app_id"));
                    m.put("name", rs.getString("name"));
                    m.put("connector", rs.getString("connector"));
                    m.put("space", rs.getString("space"));
                    m.put("config", parse(rs.getString("config_json")));
                    m.put("created_at", rs.getString("created_at"));
                    m.put("updated_at", rs.getString("updated_at"));
                    return m;
                }, id).stream().findFirst();
    }

    public Map<String, Object> create(String appId, String name, String connector, String space,
                                      Map<String, Object> config) {
        String id = Ids.newId();
        String now = Ids.now();
        jdbc.update("INSERT INTO connections (id, app_id, name, connector, space, config_json, created_at, updated_at) "
                        + "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                id, appId, name, connector, space, write(config), now, now);
        return get(id).orElseThrow();
    }

    public boolean delete(String id) {
        return jdbc.update("DELETE FROM connections WHERE id = ?", id) > 0;
    }

    private Map<String, Object> mask(Map<String, Object> cfg) {
        Map<String, Object> out = new LinkedHashMap<>();
        for (var e : cfg.entrySet()) {
            if (SECRET.contains(e.getKey()) && e.getValue() != null && !String.valueOf(e.getValue()).isEmpty()) {
                out.put(e.getKey(), "••••••");
            } else {
                out.put(e.getKey(), e.getValue());
            }
        }
        return out;
    }

    private Map<String, Object> parse(String json) {
        try { return mapper.readValue(json, new TypeReference<Map<String, Object>>() {}); }
        catch (Exception e) { return Map.of(); }
    }

    private String write(Object o) {
        try { return mapper.writeValueAsString(o); } catch (Exception e) { return "{}"; }
    }
}
