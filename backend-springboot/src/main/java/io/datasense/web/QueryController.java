package io.datasense.web;

import io.datasense.engine.DataFrame;
import io.datasense.engine.EffectiveFields;
import io.datasense.engine.QueryEngine;
import io.datasense.engine.TableStore;
import io.datasense.model.AppModels.QueryResult;
import io.datasense.model.AppModels.QuerySpec;
import io.datasense.repo.AppRepository;
import io.datasense.repo.FieldOverrideRepository;
import io.datasense.repo.TableRepository;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Consulta de agregación (Analizar). Equivale a routers/query.py.
 *
 * <p>Propaga la capa de {@code field_overrides} (rename/tipo/ocultar) por todo
 * el flujo: {@code /fields} devuelve identidad física + display + tipo efectivo
 * y excluye los ocultos del catálogo construible; {@code /query} resuelve SIEMPRE
 * por identidad física (el nombre de columna crudo que guardan las hojas) pero
 * respeta el tipo forzado para decidir la agregación. El rename es solo un alias
 * de presentación, así que renombrar NO rompe las hojas existentes.
 */
@RestController
@RequestMapping("/api/v1/apps/{appId}")
public class QueryController {

    private final AppRepository apps;
    private final TableRepository tables;
    private final TableStore store;
    private final FieldOverrideRepository fieldOverrides;
    private final io.datasense.repo.MasterItemRepository masters;

    public QueryController(AppRepository apps, TableRepository tables, TableStore store,
                           FieldOverrideRepository fieldOverrides, io.datasense.repo.MasterItemRepository masters) {
        this.masters = masters;
        this.apps = apps;
        this.tables = tables;
        this.store = store;
        this.fieldOverrides = fieldOverrides;
    }

    @PostMapping("/query")
    public QueryResult query(@PathVariable String appId, @RequestBody QuerySpec spec) {
        apps.getApp(appId).orElseThrow(() ->
                new ResponseStatusException(HttpStatus.NOT_FOUND, "App no encontrada: " + appId));
        Map<String, DataFrame> loaded = new HashMap<>();
        // tipos efectivos por tabla -> {campo físico -> tipo efectivo} y displays.
        Map<String, Map<String, String>> effectiveTypes = new HashMap<>();
        Map<String, Map<String, String>> displays = new HashMap<>();
        for (Map<String, Object> row : tables.listTables(appId)) {
            String name = (String) row.get("name");
            String tableId = (String) row.get("id");
            DataFrame df = store.load(appId, tableId);
            loaded.put(name, df);

            List<Map<String, Object>> overrides = fieldOverrides.list(appId, tableId);
            Map<String, String> typesByField = new LinkedHashMap<>();
            Map<String, String> displayByField = new LinkedHashMap<>();
            for (EffectiveFields.Field f : EffectiveFields.resolve(name, df, overrides)) {
                typesByField.put(f.sourceField(), f.type());
                displayByField.put(f.sourceField(), f.display());
            }
            effectiveTypes.put(name, typesByField);
            displays.put(name, displayByField);
        }
        addCalculated(appId, loaded, spec);
        // El motor degrada combinaciones imposibles (sum sobre texto -> count) sin lanzar 500.
        return QueryEngine.run(loaded, spec, effectiveTypes, displays);
    }

    /** Dimensiones calculadas maestras de la app: [{table, field, expr}]. */
    private List<Map<String, Object>> calculatedMasters(String appId) {
        List<Map<String, Object>> out = new java.util.ArrayList<>();
        for (Map<String, Object> m : masters.list(appId, "dimension")) {
            if (m.get("resolved") instanceof Map<?, ?> r && r.get("expr") != null && r.get("table") != null && r.get("field") != null) {
                out.add(Map.of("table", String.valueOf(r.get("table")), "field", String.valueOf(r.get("field")), "expr", String.valueOf(r.get("expr"))));
            }
        }
        return out;
    }

    /**
     * Añade a cada tabla las columnas de las dimensiones calculadas: las maestras (así sus valores se pueden
     * seleccionar y filtrar desde cualquier objeto) y la de la propia consulta si viene con {@code expr}.
     */
    private void addCalculated(String appId, Map<String, DataFrame> loaded, QuerySpec spec) {
        List<Map<String, Object>> calc = new java.util.ArrayList<>(calculatedMasters(appId));
        if (spec.dimension() != null && spec.dimension().expr() != null && !spec.dimension().expr().isBlank())
            calc.add(Map.of("table", spec.dimension().table(), "field", spec.dimension().field(), "expr", spec.dimension().expr()));
        for (Map<String, Object> c : calc) {
            String t = (String) c.get("table");
            DataFrame df = loaded.get(t);
            if (df == null) continue;
            try { loaded.put(t, io.datasense.engine.Expressions.withCalculated(df, (String) c.get("field"), (String) c.get("expr"))); }
            catch (RuntimeException ignored) { /* expresión inválida: la dimensión queda vacía, no rompe la hoja */ }
        }
    }

    /**
     * Campos candidatos con la capa de overrides aplicada. Cada campo conserva su
     * IDENTIDAD física en {@code field} y expone el {@code display} (rename o
     * físico). El rol (dimensión/medida) se decide por el TIPO EFECTIVO: number
     * -> medidas; text/date -> dimensiones. Los ocultos se EXCLUYEN del catálogo.
     */
    @GetMapping("/fields")
    public Map<String, Object> fields(@PathVariable String appId) {
        apps.getApp(appId).orElseThrow(() ->
                new ResponseStatusException(HttpStatus.NOT_FOUND, "App no encontrada: " + appId));
        List<Map<String, Object>> dims = new java.util.ArrayList<>();
        List<Map<String, Object>> meas = new java.util.ArrayList<>();
        for (Map<String, Object> row : tables.listTables(appId)) {
            String tableName = (String) row.get("name");
            String tableId = (String) row.get("id");
            DataFrame df = store.load(appId, tableId);
            List<Map<String, Object>> overrides = fieldOverrides.list(appId, tableId);
            for (EffectiveFields.Field f : EffectiveFields.resolve(tableName, df, overrides)) {
                if (f.hidden()) continue; // oculto: fuera del catálogo construible
                Map<String, Object> cand = new LinkedHashMap<>();
                cand.put("table", tableName);
                cand.put("field", f.sourceField());   // identidad física estable
                cand.put("display", f.display());      // alias de presentación
                cand.put("type", f.type());            // tipo efectivo
                if (EffectiveFields.isMeasureType(f.type())) meas.add(cand); else dims.add(cand);
            }
        }
        return Map.of("dimensions", dims, "measures", meas);
    }

    /**
     * Valores distintos de un campo (panel de filtrado). POST, igual que el
     * frontend. Resuelve por identidad física; si llega un display de un campo
     * renombrado, lo mapea a su columna física para no romper el filtrado.
     */
    @PostMapping("/fields/values")
    public Map<String, Object> fieldValues(@PathVariable String appId, @RequestBody Map<String, Object> body) {
        apps.getApp(appId).orElseThrow(() ->
                new ResponseStatusException(HttpStatus.NOT_FOUND, "App no encontrada: " + appId));
        String field = String.valueOf(body.get("field"));
        // ¿Es una dimensión calculada (maestra, o enviada con su expresión)? Se calcula y se devuelven sus valores.
        Map<String, Object> calc = null;
        for (Map<String, Object> c : calculatedMasters(appId)) if (field.equals(c.get("field"))) { calc = c; break; }
        if (calc == null && body.get("expr") != null && body.get("table") != null)
            calc = Map.of("table", String.valueOf(body.get("table")), "field", field, "expr", String.valueOf(body.get("expr")));
        if (calc != null) {
            for (Map<String, Object> row : tables.listTables(appId)) {
                if (!calc.get("table").equals(row.get("name"))) continue;
                try {
                    DataFrame df = io.datasense.engine.Expressions.withCalculated(store.load(appId, (String) row.get("id")), field, (String) calc.get("expr"));
                    List<String> distinct = df.columnValues(field).stream().filter(v -> v != null && !v.isBlank()).distinct().toList();
                    return Map.of("field", field, "values", distinct.stream().map(v -> Map.of("value", v, "state", "optional")).toList());
                } catch (RuntimeException e) {
                    throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Dimensión calculada no válida: " + e.getMessage());
                }
            }
        }
        for (Map<String, Object> row : tables.listTables(appId)) {
            String tableId = (String) row.get("id");
            DataFrame df = store.load(appId, tableId);
            String physical = field;
            if (df.indexOf(physical) < 0) {
                // ¿El cliente mandó un display renombrado? Mapear display -> físico.
                List<Map<String, Object>> overrides = fieldOverrides.list(appId, tableId);
                for (EffectiveFields.Field f : EffectiveFields.resolve((String) row.get("name"), df, overrides)) {
                    if (field.equals(f.display())) { physical = f.sourceField(); break; }
                }
            }
            if (df.indexOf(physical) >= 0) {
                List<String> distinct = df.columnValues(physical).stream()
                        .filter(v -> v != null && !v.isBlank()).distinct().toList();
                return Map.of("field", field,
                        "values", distinct.stream().map(v -> Map.of("value", v, "state", "optional")).toList());
            }
        }
        return Map.of("field", field, "values", List.of());
    }
}
