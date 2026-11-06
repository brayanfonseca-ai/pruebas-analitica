package io.datasense.web;

import io.datasense.engine.DataFrame;
import io.datasense.engine.FieldOverrides;
import io.datasense.engine.TableStore;
import io.datasense.repo.AppRepository;
import io.datasense.repo.FieldOverrideRepository;
import io.datasense.repo.Ids;
import io.datasense.repo.TableRepository;

import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/** Editor de carga: get/put del script y ejecución (rebuild + log). */
@RestController
@RequestMapping("/api/v1/apps/{appId}")
public class ScriptController {

    private final AppRepository apps;
    private final TableRepository tables;
    private final TableStore store;
    private final FieldOverrideRepository fieldOverrides;
    private final JdbcTemplate jdbc;

    public ScriptController(AppRepository apps, TableRepository tables, TableStore store,
                            FieldOverrideRepository fieldOverrides, JdbcTemplate jdbc) {
        this.apps = apps;
        this.tables = tables;
        this.store = store;
        this.fieldOverrides = fieldOverrides;
        this.jdbc = jdbc;
    }

    private void requireApp(String appId) {
        apps.getApp(appId).orElseThrow(() ->
                new ResponseStatusException(HttpStatus.NOT_FOUND, "App no encontrada: " + appId));
    }

    /** Genera un script QDF a partir de las tablas cargadas. */
    private String generated(String appId) {
        StringBuilder sb = new StringBuilder();
        sb.append("///$tab Principal\n");
        sb.append("SET ThousandSep='.';\nSET DecimalSep=',';\n\n");
        for (Map<String, Object> row : tables.listTables(appId)) {
            String name = (String) row.get("name");
            String tableId = (String) row.get("id");
            DataFrame df = store.load(appId, (String) row.get("id"));
            // Refleja la preparación visual: omite columnas ocultas y aplica el
            // nombre efectivo (alias AS cuando hay renombre). Fuente de nombres
            // originales = df.columns(); nombres efectivos = FieldOverrides.
            List<Map<String, Object>> overrides = fieldOverrides.list(appId, tableId);
            FieldOverrides.Effective eff = FieldOverrides.apply(df, overrides);
            sb.append(name).append(":\nLOAD\n");
            for (int i = 0; i < eff.size(); i++) {
                String source = df.columns().get(eff.sourceIndexAt(i));
                String exposed = eff.names().get(i);
                sb.append("    [").append(source).append("]");
                if (!source.equals(exposed)) {
                    sb.append(" AS [").append(exposed).append("]");
                }
                sb.append(i < eff.size() - 1 ? ",\n" : "\n");
            }
            sb.append("FROM [lib://DataFiles/").append(name).append(".csv]\n")
              .append("(txt, utf8, embedded labels, delimiter is ',');\n\n");
        }
        return sb.toString();
    }

    @GetMapping("/script")
    public Map<String, Object> get(@PathVariable String appId) {
        requireApp(appId);
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT text FROM scripts WHERE app_id = ?", appId);
        if (!rows.isEmpty()) {
            return Map.of("app_id", appId, "text", rows.get(0).get("text"), "is_custom", true);
        }
        return Map.of("app_id", appId, "text", generated(appId), "is_custom", false);
    }

    @PutMapping("/script")
    public Map<String, Object> put(@PathVariable String appId, @RequestBody Map<String, String> body) {
        requireApp(appId);
        String text = body.getOrDefault("text", "");
        int n = jdbc.update("UPDATE scripts SET text = ?, updated_at = ? WHERE app_id = ?",
                text, Ids.now(), appId);
        if (n == 0) jdbc.update("INSERT INTO scripts (app_id, text, updated_at) VALUES (?, ?, ?)",
                appId, text, Ids.now());
        return Map.of("app_id", appId, "text", text, "is_custom", true);
    }

    @PostMapping("/script/run")
    public Map<String, Object> run(@PathVariable String appId) {
        requireApp(appId);
        List<String> log = new ArrayList<>();
        List<Map<String, Object>> summary = new ArrayList<>();
        log.add("Reconstruyendo el modelo desde las tablas cargadas…");
        int total = 0;
        for (Map<String, Object> row : tables.listTables(appId)) {
            String name = (String) row.get("name");
            DataFrame df = store.load(appId, (String) row.get("id"));
            int rows = df.rowCount();
            total += rows;
            log.add(String.format("LOAD %s: %d filas, %d campos.", name, rows, df.columns().size()));
            summary.add(Map.of("table", name, "rows", rows, "fields", df.columns()));
        }
        log.add(String.format("Listo. %d tabla(s), %d filas en total.", summary.size(), total));
        return Map.of("ok", true, "log", log, "tables", summary);
    }
}
