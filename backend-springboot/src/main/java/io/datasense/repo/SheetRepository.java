package io.datasense.repo;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;

import io.datasense.engine.DataFrame;
import io.datasense.engine.TableStore;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/** Acceso a {@code app_sheets}. Guarda objetos/props como JSON en doc_json. */
@Repository
public class SheetRepository {

    private final JdbcTemplate jdbc;
    private final TableRepository tables;
    private final TableStore store;
    private final ObjectMapper mapper = new ObjectMapper();

    public SheetRepository(JdbcTemplate jdbc, TableRepository tables, TableStore store) {
        this.jdbc = jdbc;
        this.tables = tables;
        this.store = store;
    }

    private final RowMapper<Map<String, Object>> mapRow = (rs, i) -> {
        Map<String, Object> doc = parse(rs.getString("doc_json"));
        String appId = rs.getString("app_id");
        // Retrocompatibilidad: una hoja guardada en formato plano se normaliza al vuelo
        // al leerla, para que las hojas viejas creadas por MCP también se pinten.
        List<Object> objects = normalized(asList(doc.get("objects")), appId);
        return Map.of(
                "id", rs.getString("id"),
                "app_id", appId,
                "title", rs.getString("title"),
                "description", rs.getString("description") == null ? "" : rs.getString("description"),
                "position", rs.getInt("position"),
                "visibility", rs.getString("visibility"),
                "created_at", rs.getString("created_at"),
                "updated_at", rs.getString("updated_at"),
                "objects", objects,
                "props", doc.getOrDefault("props", Map.of()));
    };

    /**
     * Mapa campo → tabla con el mismo criterio que {@code GET /api/v1/apps/{appId}/fields}.
     * Si dos tablas comparten nombre de campo, gana la primera (orden de carga).
     */
    private Map<String, String> fieldTable(String appId) {
        Map<String, String> map = new LinkedHashMap<>();
        try {
            for (Map<String, Object> row : tables.listTables(appId)) {
                String tableName = (String) row.get("name");
                DataFrame df = store.load(appId, (String) row.get("id"));
                for (String col : df.columns()) {
                    map.putIfAbsent(col, tableName);
                }
            }
        } catch (Exception e) {
            // Sin datos cargados no podemos resolver tablas; devolvemos lo que haya.
        }
        return map;
    }

    /** Normaliza; solo resuelve campo→tabla (lee los datos de la app) si algún objeto viene en formato plano. */
    private List<Object> normalized(List<Object> objects, String appId) {
        return SheetObjectNormalizer.normalize(objects,
                SheetObjectNormalizer.allInternal(objects) ? Map.of() : fieldTable(appId));
    }

    @SuppressWarnings("unchecked")
    private static List<Object> asList(Object o) {
        return o instanceof List ? (List<Object>) o : List.of();
    }

    private static final String COLS =
            "id, app_id, title, description, position, doc_json, visibility, created_at, updated_at";

    public List<Map<String, Object>> list(String appId) {
        return jdbc.query("SELECT " + COLS + " FROM app_sheets WHERE app_id = ? ORDER BY position", mapRow, appId);
    }

    public Optional<Map<String, Object>> get(String id) {
        return jdbc.query("SELECT " + COLS + " FROM app_sheets WHERE id = ?", mapRow, id).stream().findFirst();
    }

    /** Id de la hoja generada por "Asociar a" desde una ejecución de ML (props.ml.ejecucionId), si existe. */
    public Optional<String> findByMlRun(String appId, String runId) {
        return jdbc.query("SELECT id, doc_json FROM app_sheets WHERE app_id = ? AND doc_json LIKE ?",
                        (rs, i) -> new String[]{rs.getString("id"), rs.getString("doc_json")}, appId, "%" + runId + "%")
                .stream()
                .filter(r -> {
                    Object props = parse(r[1]).get("props");
                    return props instanceof Map<?, ?> p && p.get("ml") instanceof Map<?, ?> ml && runId.equals(ml.get("ejecucionId"));
                })
                .map(r -> r[0]).findFirst();
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> create(String appId, Map<String, Object> body) {
        String id = Ids.newId();
        String now = Ids.now();
        Integer pos = jdbc.queryForObject(
                "SELECT COALESCE(MAX(position), -1) + 1 FROM app_sheets WHERE app_id = ?", Integer.class, appId);
        List<Object> objects = normalized(asList(body.get("objects")), appId);
        String doc = write(Map.of(
                "objects", objects,
                "props", body.getOrDefault("props", Map.of())));
        jdbc.update("INSERT INTO app_sheets (id, app_id, title, description, position, doc_json, visibility, created_at, updated_at) "
                        + "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                id, appId, str(body.get("title"), "Mi nueva hoja"), str(body.get("description"), null),
                pos == null ? 0 : pos, doc, "privada", now, now);
        return get(id).orElseThrow();
    }

    public Optional<Map<String, Object>> update(String id, Map<String, Object> body) {
        String appId = jdbc.query("SELECT app_id FROM app_sheets WHERE id = ?",
                (rs, i) -> rs.getString("app_id"), id).stream().findFirst().orElse(null);
        List<Object> objects = appId == null
                ? SheetObjectNormalizer.normalize(asList(body.get("objects")), Map.of())
                : normalized(asList(body.get("objects")), appId);
        String doc = write(Map.of(
                "objects", objects,
                "props", body.getOrDefault("props", Map.of())));
        int n = jdbc.update("UPDATE app_sheets SET title = ?, description = ?, doc_json = ?, updated_at = ? WHERE id = ?",
                str(body.get("title"), "Hoja"), str(body.get("description"), null), doc, Ids.now(), id);
        return n > 0 ? get(id) : Optional.empty();
    }

    public Optional<Map<String, Object>> setVisibility(String id, String visibility) {
        int n = jdbc.update("UPDATE app_sheets SET visibility = ?, updated_at = ? WHERE id = ?",
                visibility, Ids.now(), id);
        return n > 0 ? get(id) : Optional.empty();
    }

    public boolean delete(String id) {
        return jdbc.update("DELETE FROM app_sheets WHERE id = ?", id) > 0;
    }

    private Map<String, Object> parse(String json) {
        try { return mapper.readValue(json, new TypeReference<Map<String, Object>>() {}); }
        catch (Exception e) { return Map.of(); }
    }

    private String write(Object o) {
        try { return mapper.writeValueAsString(o); } catch (Exception e) { return "{}"; }
    }

    private static String str(Object o, String def) { return o == null ? def : String.valueOf(o); }
}
