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
     * "Conexiones realizadas": TODAS las conexiones a las que el usuario tiene
     * acceso (de cualquier app), con el nombre de la app donde se crearon.
     * Config enmascarada.
     */
    public List<Map<String, Object>> listAll() {
        return jdbc.query("SELECT c.id, c.app_id, c.name, c.connector, c.space, c.config_json, c.created_at, c.updated_at, a.name AS app_name "
                        // JOIN: una conexión cuya app ya no existe no se ofrece en el stack.
                        + "FROM connections c JOIN apps a ON a.id = c.app_id ORDER BY c.created_at DESC",
                (rs, i) -> {
                    Map<String, Object> m = mapRow.mapRow(rs, i);
                    m.put("app_name", rs.getString("app_name"));
                    return m;
                });
    }

    /* ------------- Origen de las tablas cargadas desde una conexión ------------- */

    /** Registra (o reemplaza) de qué conexión y con qué parámetros se cargó una tabla. */
    public void saveTableSource(String tableId, String appId, String connId, String connName, String connector,
                                Map<String, Object> params) {
        jdbc.update("DELETE FROM table_sources WHERE table_id = ?", tableId);
        jdbc.update("INSERT INTO table_sources (table_id, app_id, conn_id, conn_name, connector, params_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                tableId, appId, connId, connName, connector, write(params), Ids.now());
    }

    /** tableId -> {conn_id, conn_name, connector, params} de las tablas de una app cargadas por conexión. */
    public Map<String, Map<String, Object>> tableSources(String appId) {
        Map<String, Map<String, Object>> out = new LinkedHashMap<>();
        jdbc.query("SELECT table_id, conn_id, conn_name, connector, params_json FROM table_sources WHERE app_id = ?", rs -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("conn_id", rs.getString("conn_id"));
            m.put("conn_name", rs.getString("conn_name"));
            m.put("connector", rs.getString("connector"));
            m.put("params", parse(rs.getString("params_json")));
            out.put(rs.getString("table_id"), m);
        }, appId);
        return out;
    }

    public void deleteTableSource(String tableId) {
        jdbc.update("DELETE FROM table_sources WHERE table_id = ?", tableId);
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
