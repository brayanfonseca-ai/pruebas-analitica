package io.datasense.repo;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.*;

/**
 * Experimentos de ML ({@code ml_experiments}) y sus ejecuciones ({@code ml_runs}).
 * Un experimento pertenece a una app y apunta a una de sus tablas; cada ejecución
 * guarda el algoritmo, los parámetros, el resultado completo y la métrica principal.
 */
@Repository
public class ExperimentRepository {

    private final JdbcTemplate jdbc;

    public ExperimentRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    private static final String EXP_COLS =
            "e.id, e.app_id, e.name, e.description, e.table_ref, e.created_at, e.updated_at, a.name AS app_name, "
            + "(SELECT t.name FROM tables t WHERE t.app_id = e.app_id AND (t.id = e.table_ref OR t.name = e.table_ref) LIMIT 1) AS table_name, "
            + "(SELECT COUNT(*) FROM ml_runs r WHERE r.experiment_id = e.id) AS runs, "
            + "(SELECT r.algorithm FROM ml_runs r WHERE r.experiment_id = e.id ORDER BY r.created_at DESC LIMIT 1) AS last_algorithm, "
            + "(SELECT r.created_at FROM ml_runs r WHERE r.experiment_id = e.id ORDER BY r.created_at DESC LIMIT 1) AS last_run_at";

    private Map<String, Object> expRow(java.sql.ResultSet rs) throws java.sql.SQLException {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", rs.getString("id"));
        m.put("app_id", rs.getString("app_id"));
        m.put("app_name", rs.getString("app_name"));
        m.put("name", rs.getString("name"));
        m.put("description", rs.getString("description"));
        m.put("table", rs.getString("table_ref"));
        m.put("table_name", rs.getString("table_name"));
        m.put("created_at", rs.getString("created_at"));
        m.put("updated_at", rs.getString("updated_at"));
        m.put("runs", rs.getInt("runs"));
        m.put("last_algorithm", rs.getString("last_algorithm"));
        m.put("last_run_at", rs.getString("last_run_at"));
        return m;
    }

    public List<Map<String, Object>> list() {
        return jdbc.query("SELECT " + EXP_COLS + " FROM ml_experiments e JOIN apps a ON a.id = e.app_id ORDER BY e.updated_at DESC",
                (rs, i) -> expRow(rs));
    }

    public Optional<Map<String, Object>> get(String id) {
        return jdbc.query("SELECT " + EXP_COLS + " FROM ml_experiments e JOIN apps a ON a.id = e.app_id WHERE e.id = ?",
                (rs, i) -> expRow(rs), id).stream().findFirst();
    }

    public String create(String appId, String name, String description, String table) {
        String id = Ids.newId();
        String now = Ids.now();
        jdbc.update("INSERT INTO ml_experiments (id, app_id, name, description, table_ref, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                id, appId, name, description, table, now, now);
        return id;
    }

    public void update(String id, String name, String description, String table) {
        jdbc.update("UPDATE ml_experiments SET name = COALESCE(?, name), description = COALESCE(?, description), table_ref = COALESCE(?, table_ref), updated_at = ? WHERE id = ?",
                name, description, table, Ids.now(), id);
    }

    public void touch(String id) {
        jdbc.update("UPDATE ml_experiments SET updated_at = ? WHERE id = ?", Ids.now(), id);
    }

    public void delete(String id) {
        jdbc.update("DELETE FROM ml_runs WHERE experiment_id = ?", id);
        jdbc.update("DELETE FROM ml_experiments WHERE id = ?", id);
    }

    /* ----------------------------- Ejecuciones ----------------------------- */

    public String addRun(String experimentId, String algorithm, String label, String paramsJson, String resultJson,
                         String metricName, Double metricValue) {
        String id = Ids.newId();
        jdbc.update("INSERT INTO ml_runs (id, experiment_id, algorithm, label, params_json, result_json, metric_name, metric_value, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                id, experimentId, algorithm, label, paramsJson, resultJson, metricName, metricValue, Ids.now());
        touch(experimentId);
        return id;
    }

    public List<Map<String, Object>> listRuns(String experimentId) {
        return jdbc.query("SELECT id, algorithm, label, params_json, metric_name, metric_value, created_at FROM ml_runs WHERE experiment_id = ? ORDER BY created_at DESC",
                (rs, i) -> {
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("id", rs.getString("id"));
                    m.put("algorithm", rs.getString("algorithm"));
                    m.put("label", rs.getString("label"));
                    m.put("params_json", rs.getString("params_json"));
                    m.put("metric_name", rs.getString("metric_name"));
                    double v = rs.getDouble("metric_value");
                    m.put("metric_value", rs.wasNull() ? null : v);
                    m.put("created_at", rs.getString("created_at"));
                    return m;
                }, experimentId);
    }

    public Optional<String> runResult(String experimentId, String runId) {
        return jdbc.query("SELECT result_json FROM ml_runs WHERE id = ? AND experiment_id = ?",
                (rs, i) -> rs.getString("result_json"), runId, experimentId).stream().findFirst();
    }

    public void deleteRun(String experimentId, String runId) {
        jdbc.update("DELETE FROM ml_runs WHERE id = ? AND experiment_id = ?", runId, experimentId);
    }
}
