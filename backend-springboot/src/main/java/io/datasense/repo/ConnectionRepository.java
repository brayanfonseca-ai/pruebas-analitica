package io.datasense.repo;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Conexiones de datos (S3, Athena, bases de datos, REST…) <b>por usuario</b>, independientes de las apps.
 *
 * <ul>
 *   <li>Cada conexión tiene un <b>dueño</b> (quien la crea) y solo él la ve y la usa.</li>
 *   <li>El dueño puede <b>compartirla</b> con otros usuarios (tabla {@code connection_shares}); quien la recibe puede
 *       usarla (explorar, previsualizar, cargar datos) pero no editarla, borrarla ni volver a compartirla.</li>
 *   <li>Ni siquiera un administrador ve las conexiones privadas de otros: así sus credenciales no se filtran.</li>
 * </ul>
 * La config se guarda como JSON; hacia la API los secretos (claves/tokens/contraseñas) salen enmascarados.
 * {@code getRaw*} (sin enmascarar) es solo para los executors del servidor.
 */
@Repository
public class ConnectionRepository {

    public static final String MASK = "••••••";

    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper = new ObjectMapper();

    // Claves cuyo valor se enmascara al devolverlas.
    private static final java.util.Set<String> SECRET = java.util.Set.of(
            "secretKey", "sessionToken", "password", "proxyPassword", "accessKeyId", "kmsKey",
            "accessToken", "apiKey", "authHeader", "token", "sasToken", "serviceAccount");

    public ConnectionRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    private static final String SELECT =
            "SELECT c.id, c.owner_id, c.name, c.connector, c.space, c.description, c.config_json, c.created_at, c.updated_at, "
                    + "u.name AS owner_name FROM data_connections c LEFT JOIN users u ON u.id = c.owner_id";

    private static final String VISIBLE =
            "(c.owner_id = ? OR c.id IN (SELECT connection_id FROM connection_shares WHERE user_id = ?))";

    private Map<String, Object> row(java.sql.ResultSet rs, String viewerId, boolean masked) throws java.sql.SQLException {
        Map<String, Object> m = new LinkedHashMap<>();
        String owner = rs.getString("owner_id");
        m.put("id", rs.getString("id"));
        m.put("name", rs.getString("name"));
        m.put("connector", rs.getString("connector"));
        m.put("space", rs.getString("space"));
        m.put("description", rs.getString("description") == null ? "" : rs.getString("description"));
        Map<String, Object> cfg = parse(rs.getString("config_json"));
        m.put("config", masked ? mask(cfg) : cfg);
        m.put("owner_id", owner);
        m.put("owner_name", rs.getString("owner_name"));
        m.put("mine", viewerId != null && viewerId.equals(owner));
        m.put("created_at", rs.getString("created_at"));
        m.put("updated_at", rs.getString("updated_at"));
        return m;
    }

    /** Conexiones que el usuario puede usar: las suyas y las que le compartieron. */
    public List<Map<String, Object>> listFor(String userId) {
        List<Map<String, Object>> out = jdbc.query(SELECT + " WHERE " + VISIBLE + " ORDER BY c.created_at DESC",
                (rs, i) -> row(rs, userId, true), userId, userId);
        for (Map<String, Object> c : out) {
            if (Boolean.TRUE.equals(c.get("mine"))) c.put("shared_with", sharedWith((String) c.get("id")));
        }
        return out;
    }

    /** {user_id, name, email} de las personas con las que se compartió la conexión. */
    public List<Map<String, Object>> sharedWith(String connId) {
        return jdbc.query("SELECT s.user_id, u.name, u.email FROM connection_shares s JOIN users u ON u.id = s.user_id "
                        + "WHERE s.connection_id = ? ORDER BY u.name",
                (rs, i) -> {
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("user_id", rs.getString("user_id"));
                    m.put("name", rs.getString("name"));
                    m.put("email", rs.getString("email"));
                    return m;
                }, connId);
    }

    /** Conexión (enmascarada) si el usuario puede usarla. */
    public Optional<Map<String, Object>> getFor(String userId, String id) {
        return jdbc.query(SELECT + " WHERE c.id = ? AND " + VISIBLE, (rs, i) -> row(rs, userId, true), id, userId, userId)
                .stream().findFirst();
    }

    /** Config SIN enmascarar, solo si el usuario puede usarla. Uso interno de los executors. */
    public Optional<Map<String, Object>> getRawFor(String userId, String id) {
        return jdbc.query(SELECT + " WHERE c.id = ? AND " + VISIBLE, (rs, i) -> row(rs, userId, false), id, userId, userId)
                .stream().findFirst();
    }

    /** Config sin enmascarar SIN comprobar acceso (solo para componer scripts del propio servidor). */
    public Optional<Map<String, Object>> getRaw(String id) {
        return jdbc.query(SELECT + " WHERE c.id = ?", (rs, i) -> row(rs, null, false), id).stream().findFirst();
    }

    public boolean exists(String id) {
        Integer n = jdbc.queryForObject("SELECT COUNT(*) FROM data_connections WHERE id = ?", Integer.class, id);
        return n != null && n > 0;
    }

    public boolean isOwner(String userId, String id) {
        Integer n = jdbc.queryForObject("SELECT COUNT(*) FROM data_connections WHERE id = ? AND owner_id = ?", Integer.class, id, userId);
        return n != null && n > 0;
    }

    public Map<String, Object> create(String ownerId, String name, String connector, String space, String description,
                                      Map<String, Object> config) {
        String id = Ids.newId();
        String now = Ids.now();
        jdbc.update("INSERT INTO data_connections (id, owner_id, name, connector, space, description, config_json, created_at, updated_at) "
                        + "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                id, ownerId, name, connector, space, description == null ? "" : description, write(config), now, now);
        return getFor(ownerId, id).orElseThrow();
    }

    /**
     * Edita nombre, descripción, espacio y/o config. Un secreto que llega enmascarado («••••••») conserva el valor guardado.
     * Devuelve vacío si no existe.
     */
    public Optional<Map<String, Object>> update(String ownerId, String id, String name, String space, String description,
                                                Map<String, Object> config) {
        Optional<Map<String, Object>> current = getRaw(id);
        if (current.isEmpty()) return Optional.empty();
        @SuppressWarnings("unchecked")
        Map<String, Object> old = (Map<String, Object>) current.get().get("config");
        Map<String, Object> merged = new LinkedHashMap<>(old);
        if (config != null) {
            for (var e : config.entrySet()) {
                boolean keepSecret = SECRET.contains(e.getKey()) && (MASK.equals(String.valueOf(e.getValue())));
                if (!keepSecret) merged.put(e.getKey(), e.getValue());
            }
        }
        jdbc.update("UPDATE data_connections SET name = ?, space = ?, description = ?, config_json = ?, updated_at = ? WHERE id = ?",
                name != null ? name : current.get().get("name"),
                space != null ? space : current.get().get("space"),
                description != null ? description : current.get().get("description"),
                write(merged), Ids.now(), id);
        return getFor(ownerId, id);
    }

    public boolean delete(String id) {
        jdbc.update("DELETE FROM connection_shares WHERE connection_id = ?", id);
        return jdbc.update("DELETE FROM data_connections WHERE id = ?", id) > 0;
    }

    /** Reemplaza la lista de personas con las que se comparte la conexión. */
    public void setShares(String connId, List<String> userIds, String sharedBy) {
        jdbc.update("DELETE FROM connection_shares WHERE connection_id = ?", connId);
        String now = Ids.now();
        for (String uid : new java.util.LinkedHashSet<>(userIds)) {
            jdbc.update("INSERT OR IGNORE INTO connection_shares (connection_id, user_id, shared_by, created_at) VALUES (?, ?, ?, ?)",
                    connId, uid, sharedBy, now);
        }
    }

    /** Al eliminar a un usuario: sus conexiones pasan a otro y desaparecen sus accesos compartidos. */
    public int reassign(String fromUserId, String toUserId) {
        jdbc.update("DELETE FROM connection_shares WHERE user_id = ?", fromUserId);
        jdbc.update("DELETE FROM connection_shares WHERE connection_id IN (SELECT id FROM data_connections WHERE owner_id = ?) AND user_id = ?",
                fromUserId, toUserId);
        return jdbc.update("UPDATE data_connections SET owner_id = ? WHERE owner_id = ?", toUserId, fromUserId);
    }

    /** Quita los accesos compartidos de un usuario que ya no puede gestionar conexiones. */
    public void clearSharesFor(String userId) {
        jdbc.update("DELETE FROM connection_shares WHERE user_id = ?", userId);
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

    private Map<String, Object> mask(Map<String, Object> cfg) {
        Map<String, Object> out = new LinkedHashMap<>();
        for (var e : cfg.entrySet()) {
            if (SECRET.contains(e.getKey()) && e.getValue() != null && !String.valueOf(e.getValue()).isEmpty()) {
                out.put(e.getKey(), MASK);
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
