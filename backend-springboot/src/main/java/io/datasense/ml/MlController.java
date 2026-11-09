package io.datasense.ml;

import io.datasense.engine.DataFrame;
import io.datasense.engine.EffectiveFields;
import io.datasense.engine.TableStore;
import io.datasense.repo.AppRepository;
import io.datasense.repo.FieldOverrideRepository;
import io.datasense.repo.TableRepository;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.util.*;

/**
 * Laboratorio de ML por aplicación.
 *
 * <ul>
 *   <li>{@code GET  /api/v1/apps/{appId}/ml/datasets} — tablas con sus campos agrupados por rol.</li>
 *   <li>{@code POST /api/v1/apps/{appId}/ml/run} — ejecuta un algoritmo: {@code {table, algorithm, params}}.</li>
 * </ul>
 */
@RestController
@RequestMapping("/api/v1/apps/{appId}/ml")
public class MlController {

    private final AppRepository apps;
    private final TableRepository tables;
    private final TableStore store;
    private final FieldOverrideRepository overrides;
    private final MlService ml;

    public MlController(AppRepository apps, TableRepository tables, TableStore store,
                        FieldOverrideRepository overrides, MlService ml) {
        this.apps = apps;
        this.tables = tables;
        this.store = store;
        this.overrides = overrides;
        this.ml = ml;
    }

    private void requireApp(String appId) {
        apps.getApp(appId).orElseThrow(() ->
                new ResponseStatusException(HttpStatus.NOT_FOUND, "App no encontrada: " + appId));
    }

    @GetMapping("/datasets")
    public List<Map<String, Object>> datasets(@PathVariable String appId) {
        requireApp(appId);
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> row : tables.listTables(appId)) {
            String name = (String) row.get("name");
            String id = (String) row.get("id");
            DataFrame df = store.load(appId, id);
            List<Map<String, Object>> numeric = new ArrayList<>(), categorical = new ArrayList<>(), dates = new ArrayList<>();
            for (EffectiveFields.Field f : EffectiveFields.resolve(name, df, overrides.list(appId, id))) {
                if (f.hidden()) continue;
                Map<String, Object> fld = new LinkedHashMap<>();
                fld.put("field", f.sourceField());
                fld.put("display", f.display());
                if ("number".equals(f.type())) numeric.add(fld);
                else if ("date".equals(f.type())) dates.add(fld);
                else categorical.add(fld);
            }
            Map<String, Object> ds = new LinkedHashMap<>();
            ds.put("id", id);
            ds.put("name", name);
            ds.put("rows", df.rowCount());
            ds.put("numeric", numeric);
            ds.put("categorical", categorical);
            ds.put("dates", dates);
            out.add(ds);
        }
        return out;
    }

    @PostMapping("/run")
    @SuppressWarnings("unchecked")
    public Map<String, Object> run(@PathVariable String appId, @RequestBody Map<String, Object> body) {
        requireApp(appId);
        String table = body.get("table") == null ? null : String.valueOf(body.get("table"));
        String algorithm = body.get("algorithm") == null ? null : String.valueOf(body.get("algorithm"));
        Map<String, Object> params = body.get("params") instanceof Map<?, ?> m ? (Map<String, Object>) m : new HashMap<>();
        if (table == null) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Falta la tabla.");

        String tableId = null;
        for (Map<String, Object> row : tables.listTables(appId)) {
            if (table.equals(row.get("id")) || table.equals(row.get("name"))) { tableId = (String) row.get("id"); break; }
        }
        if (tableId == null) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Tabla no encontrada: " + table);
        DataFrame df = store.load(appId, tableId);
        try {
            long t0 = System.nanoTime();
            Map<String, Object> result = ml.run(df, algorithm, params);
            result.put("elapsedMs", (System.nanoTime() - t0) / 1_000_000);
            result.put("table", table);
            return result;
        } catch (IllegalArgumentException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, e.getMessage());
        }
    }
}
