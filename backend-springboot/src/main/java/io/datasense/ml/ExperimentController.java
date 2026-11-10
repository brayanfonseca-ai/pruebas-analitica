package io.datasense.ml;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.datasense.engine.DataFrame;
import io.datasense.engine.EffectiveFields;
import io.datasense.engine.TableStore;
import io.datasense.repo.AppRepository;
import io.datasense.repo.ExperimentRepository;
import io.datasense.repo.FieldOverrideRepository;
import io.datasense.repo.TableRepository;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.util.*;

/**
 * Experimentos de ML como recurso propio (independiente de las vistas de una app).
 *
 * <ul>
 *   <li>{@code GET/POST /api/v1/ml/experiments} — listar / crear {@code {appId, name, description?, table?}}.</li>
 *   <li>{@code GET/PUT/DELETE /api/v1/ml/experiments/{id}} — detalle (incluye ejecuciones y dataset), editar, eliminar.</li>
 *   <li>{@code POST /api/v1/ml/experiments/{id}/runs} — entrena {@code {algorithm, params, label?, save?}} y guarda el resultado.</li>
 *   <li>{@code GET/DELETE /api/v1/ml/experiments/{id}/runs/{runId}} — resultado completo / eliminar.</li>
 * </ul>
 */
@RestController
@RequestMapping("/api/v1/ml/experiments")
public class ExperimentController {

    private final ExperimentRepository repo;
    private final AppRepository apps;
    private final TableRepository tables;
    private final TableStore store;
    private final FieldOverrideRepository overrides;
    private final MlService ml;
    private final MlAssociation association;
    private final ObjectMapper json = new ObjectMapper();

    public ExperimentController(ExperimentRepository repo, AppRepository apps, TableRepository tables, TableStore store,
                                FieldOverrideRepository overrides, MlService ml, MlAssociation association) {
        this.repo = repo;
        this.apps = apps;
        this.tables = tables;
        this.store = store;
        this.overrides = overrides;
        this.ml = ml;
        this.association = association;
    }

    private Map<String, Object> requireExp(String id) {
        return repo.get(id).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Experimento no encontrado: " + id));
    }

    private static String s(Map<String, Object> b, String k) {
        Object o = b.get(k);
        return o == null || String.valueOf(o).isBlank() ? null : String.valueOf(o).trim();
    }

    private Map<String, Object> findTable(String appId, String table) {
        if (table == null) return null;
        for (Map<String, Object> row : tables.listTables(appId))
            if (table.equals(row.get("id")) || table.equals(row.get("name"))) return row;
        return null;
    }

    private Map<String, Object> dataset(String appId, Map<String, Object> row) {
        String name = (String) row.get("name"), id = (String) row.get("id");
        DataFrame df = store.load(appId, id);
        List<Map<String, Object>> numeric = new ArrayList<>(), categorical = new ArrayList<>(), dates = new ArrayList<>();
        for (EffectiveFields.Field f : EffectiveFields.resolve(name, df, overrides.list(appId, id))) {
            if (f.hidden()) continue;
            Map<String, Object> fld = new LinkedHashMap<>();
            fld.put("field", f.sourceField());
            fld.put("display", f.display());
            int ci = df.indexOf(f.sourceField());
            Set<String> distinct = new HashSet<>();
            int nulls = 0;
            for (List<String> r : df.rows()) {
                String v = ci < 0 ? null : r.get(ci);
                if (v == null || v.isBlank()) nulls++; else if (distinct.size() < 10000) distinct.add(v);
            }
            fld.put("distinct", distinct.size());
            fld.put("nulls", nulls);
            if ("number".equals(f.type())) numeric.add(fld);
            else if ("date".equals(f.type())) dates.add(fld);
            else categorical.add(fld);
        }
        List<Map<String, Object>> preview = new ArrayList<>();
        for (int i = 0; i < Math.min(8, df.rowCount()); i++) {
            Map<String, Object> pr = new LinkedHashMap<>();
            for (int c = 0; c < df.columns().size(); c++) pr.put(df.columns().get(c), df.rows().get(i).get(c));
            preview.add(pr);
        }
        Map<String, Object> ds = new LinkedHashMap<>();
        ds.put("id", id);
        ds.put("name", name);
        ds.put("rows", df.rowCount());
        ds.put("numeric", numeric);
        ds.put("categorical", categorical);
        ds.put("dates", dates);
        ds.put("preview", preview);
        return ds;
    }

    /* ------------------------------ Experimentos ------------------------------ */

    @GetMapping
    public List<Map<String, Object>> list() { return repo.list(); }

    @PostMapping
    public Map<String, Object> create(@RequestBody Map<String, Object> body) {
        String appId = s(body, "appId"), name = s(body, "name");
        if (appId == null) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Elige la aplicación que contiene los datos.");
        if (name == null) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "El experimento necesita un nombre.");
        apps.getApp(appId).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "App no encontrada: " + appId));
        String table = s(body, "table");
        if (table != null && findTable(appId, table) == null) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "La tabla no existe en esa aplicación.");
        String id = repo.create(appId, name, s(body, "description"), table);
        return get(id);
    }

    @GetMapping("/{id}")
    public Map<String, Object> get(@PathVariable String id) {
        Map<String, Object> e = new LinkedHashMap<>(requireExp(id));
        String appId = (String) e.get("app_id");
        List<Map<String, Object>> appTables = new ArrayList<>();
        for (Map<String, Object> row : tables.listTables(appId)) appTables.add(Map.of("id", row.get("id"), "name", row.get("name")));
        e.put("tables", appTables);
        Map<String, Object> row = findTable(appId, (String) e.get("table"));
        if (row == null && !appTables.isEmpty()) row = findTable(appId, (String) appTables.get(0).get("id"));
        e.put("dataset", row == null ? null : dataset(appId, row));
        e.put("runList", repo.listRuns(id));
        return e;
    }

    @PutMapping("/{id}")
    public Map<String, Object> update(@PathVariable String id, @RequestBody Map<String, Object> body) {
        Map<String, Object> e = requireExp(id);
        String table = s(body, "table");
        if (table != null && findTable((String) e.get("app_id"), table) == null) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "La tabla no existe en esa aplicación.");
        repo.update(id, s(body, "name"), body.containsKey("description") ? String.valueOf(body.getOrDefault("description", "")) : null, table);
        return get(id);
    }

    @DeleteMapping("/{id}")
    public Map<String, Object> delete(@PathVariable String id) {
        requireExp(id);
        repo.delete(id);
        return Map.of("ok", true);
    }

    /* ------------------------------ Ejecuciones ------------------------------ */

    @PostMapping("/{id}/runs")
    @SuppressWarnings("unchecked")
    public Map<String, Object> run(@PathVariable String id, @RequestBody Map<String, Object> body) {
        Map<String, Object> e = requireExp(id);
        String appId = (String) e.get("app_id");
        String algorithm = s(body, "algorithm");
        if (algorithm == null) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Falta el algoritmo.");
        Map<String, Object> params = body.get("params") instanceof Map<?, ?> m ? new HashMap<>((Map<String, Object>) m) : new HashMap<>();
        params.remove(MlService.SCORE); // interno: solo lo usa /associate
        Map<String, Object> row = findTable(appId, (String) e.get("table"));
        if (row == null) {
            List<Map<String, Object>> all = tables.listTables(appId);
            if (all.isEmpty()) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "La aplicación no tiene tablas. Carga datos primero.");
            row = all.get(0);
        }
        DataFrame df = store.load(appId, (String) row.get("id"));
        Map<String, Object> result;
        long t0 = System.nanoTime();
        try {
            result = ml.run(df, algorithm, params);
        } catch (IllegalArgumentException ex) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, ex.getMessage());
        }
        result.put("elapsedMs", (System.nanoTime() - t0) / 1_000_000);
        result.put("table", row.get("name"));

        boolean save = !Boolean.FALSE.equals(body.get("save")) && !params.containsKey("input");
        if (save) {
            Object[] metric = primaryMetric(result);
            try {
                Map<String, Object> storedParams = new LinkedHashMap<>(params);
                String runId = repo.addRun(id, algorithm, s(body, "label"), json.writeValueAsString(storedParams),
                        json.writeValueAsString(result), (String) metric[0], (Double) metric[1]);
                result.put("runId", runId);
            } catch (Exception ex) {
                throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "No se pudo guardar la ejecución.");
            }
        }
        return result;
    }

    @GetMapping("/{id}/runs/{runId}")
    public Map<String, Object> runDetail(@PathVariable String id, @PathVariable String runId) {
        requireExp(id);
        String js = repo.runResult(id, runId).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Ejecución no encontrada."));
        try {
            Map<String, Object> r = json.readValue(js, new TypeReference<>() {});
            r.put("runId", runId);
            return r;
        } catch (Exception ex) {
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "Resultado ilegible.");
        }
    }

    /**
     * "Asociar a": lleva el resultado de una ejecución a una app como tabla del
     * modelo + hoja nueva. Body opcional {@code {appId?, sheetTitle?}}; por defecto
     * la app del experimento. Re-entrena de forma determinista con
     * {@code __score=true} para obtener la salida por fila.
     */
    @PostMapping("/{id}/runs/{runId}/associate")
    @SuppressWarnings("unchecked")
    public Map<String, Object> associate(@PathVariable String id, @PathVariable String runId,
                                         @RequestBody(required = false) Map<String, Object> body) {
        Map<String, Object> e = requireExp(id);
        Map<String, Object> b = body == null ? Map.of() : body;
        Map<String, Object> run = repo.getRun(id, runId).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Ejecución no encontrada."));
        String srcApp = (String) e.get("app_id");
        String targetApp = s(b, "appId") == null ? srcApp : s(b, "appId");
        apps.getApp(targetApp).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "App no encontrada: " + targetApp));

        Map<String, Object> params;
        Map<String, Object> stored;
        try {
            params = json.readValue(String.valueOf(run.get("params_json")), new TypeReference<>() {});
            stored = json.readValue(String.valueOf(run.get("result_json")), new TypeReference<>() {});
        } catch (Exception ex) {
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "La ejecución guardada es ilegible.");
        }
        Map<String, Object> row = findTable(srcApp, stored.get("table") == null ? null : String.valueOf(stored.get("table")));
        if (row == null) row = findTable(srcApp, (String) e.get("table"));
        if (row == null) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "La tabla de origen de esta ejecución ya no existe en la aplicación.");
        DataFrame df = store.load(srcApp, (String) row.get("id"));

        Map<String, Object> p = new HashMap<>(params);
        p.remove("input");
        p.put(MlService.SCORE, true);
        Map<String, Object> scored;
        try {
            scored = ml.run(df, String.valueOf(run.get("algorithm")), p);
        } catch (IllegalArgumentException ex) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, ex.getMessage());
        }
        try {
            return association.associate(e, run, scored, df, (String) row.get("name"), targetApp, s(b, "sheetTitle"));
        } catch (IllegalArgumentException ex) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, ex.getMessage());
        }
    }

    @DeleteMapping("/{id}/runs/{runId}")
    public Map<String, Object> deleteRun(@PathVariable String id, @PathVariable String runId) {
        requireExp(id);
        repo.deleteRun(id, runId);
        return Map.of("ok", true);
    }

    /** Métrica principal por algoritmo (nombre, valor) para la lista de ejecuciones. */
    @SuppressWarnings("unchecked")
    static Object[] primaryMetric(Map<String, Object> r) {
        Object algo = r.get("algorithm");
        try {
            switch (String.valueOf(algo)) {
                case "kmeans", "hierarchical": return new Object[]{"Silueta", num(r.get("silhouette"))};
                case "dbscan": return new Object[]{"Grupos", num(r.get("clustersFound"))};
                case "pca": return new Object[]{"Componentes al 80%", num(r.get("components80"))};
                case "correlation": {
                    List<Map<String, Object>> pairs = (List<Map<String, Object>>) r.get("pairs");
                    return new Object[]{"|r| máximo", pairs == null || pairs.isEmpty() ? null : Math.abs(num(pairs.get(0).get("r")))};
                }
                case "anomaly": return new Object[]{"Atípicos", num(r.get("total"))};
                case "rules": return new Object[]{"Reglas", num(r.get("total"))};
                case "forecast": {
                    List<Map<String, Object>> fc = (List<Map<String, Object>>) r.get("forecast");
                    return new Object[]{"Próximo periodo", fc == null || fc.isEmpty() ? null : num(fc.get(0).get("value"))};
                }
                case "linear": {
                    Map<String, Object> t = (Map<String, Object>) (r.get("test") != null ? r.get("test") : r.get("train"));
                    return new Object[]{"R²", num(t.get("r2"))};
                }
                case "logistic": return new Object[]{"AUC", num(((Map<String, Object>) r.get("metrics")).get("auc"))};
                case "automl": {
                    Map<String, Object> best = (Map<String, Object>) r.get("best");
                    return withPrimary(best, "");
                }
                default: return withPrimary(r, "");
            }
        } catch (Exception ex) {
            return new Object[]{null, null};
        }
    }

    @SuppressWarnings("unchecked")
    private static Object[] withPrimary(Map<String, Object> r, String prefix) {
        Map<String, Object> ev = (Map<String, Object>) (r.get("test") != null ? r.get("test") : r.get("train"));
        if (ev == null) return new Object[]{null, null};
        if ("classification".equals(r.get("task"))) {
            Object auc = ev.get("auc");
            return auc != null ? new Object[]{prefix + "AUC", num(auc)} : new Object[]{prefix + "Exactitud", num(ev.get("accuracy"))};
        }
        return new Object[]{prefix + "R²", num(ev.get("r2"))};
    }

    private static Double num(Object o) {
        return o instanceof Number n ? n.doubleValue() : null;
    }
}
