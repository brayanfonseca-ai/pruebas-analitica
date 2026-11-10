package io.datasense.repo;

import io.datasense.model.AppModels.ColumnProfile;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Map;

/** Acceso a {@code tables} y {@code columns}. */
@Repository
public class TableRepository {

    private final JdbcTemplate jdbc;

    public TableRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Map<String, Object> createTable(String appId, String name, String sourceName,
                                           List<ColumnProfile> columns) {
        String id = Ids.newId();
        String now = Ids.now();
        jdbc.update("INSERT INTO tables (id, app_id, name, source_name, created_at) VALUES (?, ?, ?, ?, ?)",
                id, appId, name, sourceName, now);
        try {
            for (ColumnProfile c : columns) {
                jdbc.update("INSERT INTO columns (id, table_id, name, logical_type, null_count, distinct_count) "
                        + "VALUES (?, ?, ?, ?, ?, ?)",
                        Ids.newId(), id, c.name(), c.type(), c.null_count(), c.distinct_count());
            }
        } catch (RuntimeException e) {
            // Sin columnas la tabla quedaría huérfana (y sin CSV rompería las consultas de la app).
            deleteTable(id);
            throw e;
        }
        return Map.of("id", id, "app_id", appId, "name", name,
                "source_name", sourceName == null ? "" : sourceName, "created_at", now);
    }

    public List<Map<String, Object>> listTables(String appId) {
        return jdbc.queryForList("SELECT id, app_id, name, source_name, created_at "
                + "FROM tables WHERE app_id = ? ORDER BY created_at", appId);
    }

    public List<Map<String, Object>> listColumns(String tableId) {
        return jdbc.queryForList("SELECT name, logical_type, null_count, distinct_count "
                + "FROM columns WHERE table_id = ? ORDER BY rowid", tableId);
    }

    /** Reemplaza el perfil de columnas de una tabla (tras recargarla desde su origen). */
    public void replaceColumns(String tableId, List<ColumnProfile> columns) {
        jdbc.update("DELETE FROM columns WHERE table_id = ?", tableId);
        for (ColumnProfile c : columns) {
            jdbc.update("INSERT INTO columns (id, table_id, name, logical_type, null_count, distinct_count) "
                    + "VALUES (?, ?, ?, ?, ?, ?)",
                    Ids.newId(), tableId, c.name(), c.type(), c.null_count(), c.distinct_count());
        }
    }

    public boolean deleteTable(String tableId) {
        jdbc.update("DELETE FROM columns WHERE table_id = ?", tableId);
        return jdbc.update("DELETE FROM tables WHERE id = ?", tableId) > 0;
    }
}
