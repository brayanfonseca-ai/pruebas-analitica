package io.datasense.web;

import io.datasense.engine.DataFrame;
import io.datasense.engine.Expressions;
import io.datasense.engine.TableStore;
import io.datasense.repo.AppRepository;
import io.datasense.repo.MasterItemRepository;
import io.datasense.repo.TableRepository;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Elementos maestros + validador de expresiones fx. Equivale a routers/master.py. */
@RestController
@RequestMapping("/api/v1/apps/{appId}")
public class MasterController {

    private final AppRepository apps;
    private final MasterItemRepository items;
    private final TableRepository tables;
    private final TableStore store;

    public MasterController(AppRepository apps, MasterItemRepository items,
                            TableRepository tables, TableStore store) {
        this.apps = apps;
        this.items = items;
        this.tables = tables;
        this.store = store;
    }

    private void requireApp(String appId) {
        apps.getApp(appId).orElseThrow(() ->
                new ResponseStatusException(HttpStatus.NOT_FOUND, "App no encontrada: " + appId));
    }

    /** Índice campo -> tablas que lo contienen (para resolver expresiones). */
    private Map<String, List<String>> fieldIndex(String appId) {
        Map<String, List<String>> idx = new LinkedHashMap<>();
        for (Map<String, Object> row : tables.listTables(appId)) {
            String tableName = (String) row.get("name");
            DataFrame df = store.load(appId, (String) row.get("id"));
            for (String col : df.columns()) {
                idx.computeIfAbsent(col, k -> new ArrayList<>()).add(tableName);
            }
        }
        return idx;
    }

    private Map<String, Object> compile(String appId, String kind, String text) {
        return compile(appId, kind, text, null);
    }

    /** {@code name}: nombre con el que se expone una dimensión calculada (el de la dimensión maestra). */
    private Map<String, Object> compile(String appId, String kind, String text, String name) {
        try {
            Map<String, Object> r = Expressions.compile(kind, text, fieldIndex(appId), name);
            // Validar que la expresión se pueda evaluar sobre los datos reales (y contar sus valores).
            if (Boolean.TRUE.equals(r.get("calculated"))) {
                for (Map<String, Object> row : tables.listTables(appId)) {
                    if (!r.get("table").equals(row.get("name"))) continue;
                    DataFrame df = Expressions.withCalculated(store.load(appId, (String) row.get("id")), (String) r.get("field"), (String) r.get("expr"));
                    List<String> vals = df.columnValues((String) r.get("field")).stream().filter(v -> v != null && !v.isBlank()).distinct().toList();
                    r.put("distinct", vals.size());
                    r.put("sample", vals.stream().limit(6).toList());
                }
            }
            return r;
        } catch (Expressions.ExpressionError e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, e.getMessage());
        }
    }

    /** Dos dimensiones calculadas no pueden llamarse igual (el nombre es el campo por el que se agrupa y selecciona). */
    private void uniqueCalculatedName(String appId, String kind, String name, String exceptId) {
        if (!"dimension".equals(kind)) return;
        for (Map<String, Object> m : items.list(appId, "dimension")) {
            if (m.get("id").equals(exceptId)) continue;
            if (String.valueOf(m.get("name")).equalsIgnoreCase(name) && m.get("resolved") instanceof Map<?, ?> r && r.get("expr") != null)
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Ya existe una dimensión calculada llamada «" + name + "».");
        }
    }

    @PostMapping("/expressions/parse")
    public Map<String, Object> parse(@PathVariable String appId, @RequestBody Map<String, String> body) {
        requireApp(appId);
        String kind = body.get("kind");
        String expression = body.get("expression");
        Map<String, Object> resolved = compile(appId, kind, expression, body.get("name"));
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("kind", kind);
        out.put("expression", expression);
        out.putAll(resolved);
        return out;
    }

    @GetMapping("/master-items")
    public List<Map<String, Object>> list(@PathVariable String appId, @RequestParam(required = false) String kind) {
        requireApp(appId);
        return items.list(appId, kind);
    }

    @PostMapping("/master-items")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> create(@PathVariable String appId, @RequestBody Map<String, String> body) {
        requireApp(appId);
        String kind = body.get("kind");
        String expression = body.getOrDefault("expression", "").strip();
        String name = body.getOrDefault("name", "").strip();
        Map<String, Object> resolved = compile(appId, kind, expression, name);
        if (Boolean.TRUE.equals(resolved.get("calculated"))) uniqueCalculatedName(appId, kind, name, null);
        return items.create(appId, kind, name, expression, body.get("description"), resolved);
    }

    @PutMapping("/master-items/{itemId}")
    public Map<String, Object> update(@PathVariable String appId, @PathVariable String itemId,
                                      @RequestBody Map<String, String> body) {
        requireApp(appId);
        Map<String, Object> existing = items.get(itemId).orElseThrow(() ->
                new ResponseStatusException(HttpStatus.NOT_FOUND, "Elemento maestro no encontrado: " + itemId));
        String kind = (String) existing.get("kind");
        String expression = body.getOrDefault("expression", "").strip();
        String name = body.getOrDefault("name", "").strip();
        Map<String, Object> resolved = compile(appId, kind, expression, name);
        if (Boolean.TRUE.equals(resolved.get("calculated"))) uniqueCalculatedName(appId, kind, name, itemId);
        return items.update(itemId, name, expression,
                body.get("description"), resolved).orElseThrow(() ->
                new ResponseStatusException(HttpStatus.NOT_FOUND, "Elemento maestro no encontrado: " + itemId));
    }

    @DeleteMapping("/master-items/{itemId}")
    public ResponseEntity<Void> delete(@PathVariable String appId, @PathVariable String itemId) {
        requireApp(appId);
        if (!items.delete(itemId)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Elemento maestro no encontrado: " + itemId);
        }
        return ResponseEntity.noContent().build();
    }
}
