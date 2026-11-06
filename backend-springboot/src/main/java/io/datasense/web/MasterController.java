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
        try {
            return Expressions.compile(kind, text, fieldIndex(appId));
        } catch (Expressions.ExpressionError e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, e.getMessage());
        }
    }

    @PostMapping("/expressions/parse")
    public Map<String, Object> parse(@PathVariable String appId, @RequestBody Map<String, String> body) {
        requireApp(appId);
        String kind = body.get("kind");
        String expression = body.get("expression");
        Map<String, Object> resolved = compile(appId, kind, expression);
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
        Map<String, Object> resolved = compile(appId, kind, expression);
        return items.create(appId, kind, body.getOrDefault("name", "").strip(), expression,
                body.get("description"), resolved);
    }

    @PutMapping("/master-items/{itemId}")
    public Map<String, Object> update(@PathVariable String appId, @PathVariable String itemId,
                                      @RequestBody Map<String, String> body) {
        requireApp(appId);
        Map<String, Object> existing = items.get(itemId).orElseThrow(() ->
                new ResponseStatusException(HttpStatus.NOT_FOUND, "Elemento maestro no encontrado: " + itemId));
        String kind = (String) existing.get("kind");
        String expression = body.getOrDefault("expression", "").strip();
        Map<String, Object> resolved = compile(appId, kind, expression);
        return items.update(itemId, body.getOrDefault("name", "").strip(), expression,
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
