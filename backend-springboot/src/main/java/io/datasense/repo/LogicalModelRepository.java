package io.datasense.repo;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.Optional;

/**
 * Acceso a {@code logical_model}: una fila por app con el documento del modelo
 * lógico serializado ({@code doc_json}) y un flag {@code enabled}. El servicio
 * {@code io.datasense.engine.LogicalModelService} genera el documento por
 * defecto desde los campos reales; aquí solo se persiste/lee como texto.
 */
@Repository
public class LogicalModelRepository {

    private final JdbcTemplate jdbc;

    public LogicalModelRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** Documento guardado para la app, o vacío si nunca se persistió. */
    public Optional<String> getDocJson(String appId) {
        return jdbc.query("SELECT doc_json FROM logical_model WHERE app_id = ?",
                (rs, i) -> rs.getString("doc_json"), appId)
                .stream().findFirst();
    }

    /** {@code true} si el modelo está habilitado; también true si no hay fila. */
    public boolean isEnabled(String appId) {
        Integer v = jdbc.query("SELECT enabled FROM logical_model WHERE app_id = ?",
                (rs, i) -> rs.getInt("enabled"), appId)
                .stream().findFirst().orElse(null);
        return v == null || v != 0;
    }

    /** Inserta o actualiza el documento y el flag de habilitado para la app. */
    public void upsert(String appId, String docJson, boolean enabled) {
        int e = enabled ? 1 : 0;
        int n = jdbc.update(
                "UPDATE logical_model SET doc_json = ?, enabled = ?, updated_at = ? WHERE app_id = ?",
                docJson, e, Ids.now(), appId);
        if (n == 0) {
            jdbc.update(
                    "INSERT INTO logical_model (app_id, enabled, doc_json, updated_at) VALUES (?, ?, ?, ?)",
                    appId, e, docJson, Ids.now());
        }
    }

    /** Cambia solo el flag de habilitado; si no hay fila aún, no hace nada. */
    public void setEnabled(String appId, boolean enabled) {
        jdbc.update("UPDATE logical_model SET enabled = ?, updated_at = ? WHERE app_id = ?",
                enabled ? 1 : 0, Ids.now(), appId);
    }

    public void delete(String appId) {
        jdbc.update("DELETE FROM logical_model WHERE app_id = ?", appId);
    }
}
