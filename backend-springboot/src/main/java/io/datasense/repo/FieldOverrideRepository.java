package io.datasense.repo;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Acceso a {@code field_overrides}: capa de "preparación visual" por tabla
 * (renombrar un campo, forzar su tipo lógico, u ocultarlo). Se aplica al servir
 * la tabla (ver {@code io.datasense.engine.FieldOverrides}) sin reescribir el CSV
 * materializado, de modo que la fuente nunca se pierde.
 */
@Repository
public class FieldOverrideRepository {

    /** Tipos lógicos válidos para forced_type (coinciden con Profiler). */
    public static final Set<String> VALID_TYPES = Set.of("text", "number", "date");

    private final JdbcTemplate jdbc;

    public FieldOverrideRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    private final RowMapper<Map<String, Object>> mapRow = (rs, i) -> {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("source_field", rs.getString("source_field"));
        m.put("rename", rs.getString("rename"));
        m.put("forced_type", rs.getString("forced_type"));
        m.put("hidden", rs.getInt("hidden") != 0);
        return m;
    };

    public List<Map<String, Object>> list(String appId, String tableId) {
        return jdbc.query(
                "SELECT source_field, rename, forced_type, hidden FROM field_overrides "
                        + "WHERE app_id = ? AND table_id = ? ORDER BY rowid",
                mapRow, appId, tableId);
    }

    /**
     * Inserta o actualiza el override de un campo. {@code forcedType} se valida a
     * uno de {@link #VALID_TYPES}; cualquier otro valor se guarda como null.
     * {@code rename} en blanco se guarda como null (sin renombre).
     */
    public void upsert(String appId, String tableId, String sourceField,
                       String rename, String forcedType, boolean hidden) {
        String cleanRename = (rename == null || rename.isBlank()) ? null : rename.trim();
        String cleanType = (forcedType != null && VALID_TYPES.contains(forcedType)) ? forcedType : null;
        int h = hidden ? 1 : 0;
        int n = jdbc.update(
                "UPDATE field_overrides SET rename = ?, forced_type = ?, hidden = ?, updated_at = ? "
                        + "WHERE table_id = ? AND source_field = ?",
                cleanRename, cleanType, h, Ids.now(), tableId, sourceField);
        if (n == 0) {
            jdbc.update(
                    "INSERT INTO field_overrides (id, app_id, table_id, source_field, rename, forced_type, hidden, updated_at) "
                            + "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    Ids.newId(), appId, tableId, sourceField, cleanRename, cleanType, h, Ids.now());
        }
    }

    public void deleteForTable(String tableId) {
        jdbc.update("DELETE FROM field_overrides WHERE table_id = ?", tableId);
    }
}
