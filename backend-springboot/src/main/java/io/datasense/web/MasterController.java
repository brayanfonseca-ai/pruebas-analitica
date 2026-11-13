package io.datasense.web;

import io.datasense.auth.AccessService;
import io.datasense.auth.Permissions;
import io.datasense.auth.UserRecord;
import io.datasense.engine.DataFrame;
import jakarta.servlet.http.HttpServletRequest;
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
            Map<String, List<String>> idx = fieldIndex(appId);
            // Una medida puede usar las dimensiones calculadas maestras como si fueran campos (p. ej. Count(If([Rango edad]='Joven',[CEDULA]))).
            if ("measure".equals(kind))
                for (Map<String, Object> c : calculatedDims(appId))
                    idx.computeIfAbsent((String) c.get("field"), k -> new ArrayList<>()).add((String) c.get("table"));
            Map<String, Object> r = Expressions.compile(kind, text, idx, name);
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
        if ("measure".equals(kind)) out.put("value", measureValue(appId, resolved));
        return out;
    }

    /** Valor total de una medida sobre todos los datos (vista previa al validar; no se guarda). */
    @SuppressWarnings("unchecked")
    private Double measureValue(String appId, Map<String, Object> r) {
        try {
            Map<String, DataFrame> loaded = new java.util.HashMap<>();
            for (Map<String, Object> row : tables.listTables(appId)) {
                if (!String.valueOf(r.get("table")).equals(row.get("name"))) continue;
                DataFrame df = store.load(appId, (String) row.get("id"));
                for (Map<String, Object> c : calculatedDims(appId))
                    if (c.get("table").equals(row.get("name"))) df = Expressions.withCalculated(df, (String) c.get("field"), (String) c.get("expr"));
                loaded.put((String) row.get("name"), df);
            }
            var m = new io.datasense.model.AppModels.MeasureSpec((String) r.get("table"), (String) r.get("field"), (String) r.get("agg"),
                    null, (String) r.get("formula"), (List<Map<String, Object>>) r.get("parts"));
            var res = io.datasense.engine.QueryEngine.run(loaded, new io.datasense.model.AppModels.QuerySpec(null, List.of(m), "kpi", Map.of()));
            return res.value() instanceof Number n ? n.doubleValue() : null;
        } catch (RuntimeException e) {
            return null;
        }
    }

    /** Dimensiones calculadas maestras: [{table, field, expr}] (sus nombres se pueden usar dentro de una medida). */
    private List<Map<String, Object>> calculatedDims(String appId) {
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> m : items.list(appId, "dimension"))
            if (m.get("resolved") instanceof Map<?, ?> r && r.get("expr") != null && r.get("table") != null && r.get("field") != null)
                out.add(Map.of("table", String.valueOf(r.get("table")), "field", String.valueOf(r.get("field")), "expr", String.valueOf(r.get("expr"))));
        return out;
    }

    @GetMapping("/master-items")
    public List<Map<String, Object>> list(@PathVariable String appId, @RequestParam(required = false) String kind) {
        requireApp(appId);
        return items.list(appId, kind);
    }

    @PostMapping("/master-items")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> create(HttpServletRequest req, @PathVariable String appId, @RequestBody Map<String, String> body) {
        requireApp(appId);
        String kind = body.get("kind");
        String expression = body.getOrDefault("expression", "").strip();
        String name = body.getOrDefault("name", "").strip();
        Map<String, Object> resolved = compile(appId, kind, expression, name);
        if (Boolean.TRUE.equals(resolved.get("calculated"))) uniqueCalculatedName(appId, kind, name, null);
        return items.create(appId, kind, name, expression, body.get("description"), resolved, authorName(req));
    }

    @PutMapping("/master-items/{itemId}")
    public Map<String, Object> update(HttpServletRequest req, @PathVariable String appId, @PathVariable String itemId,
                                      @RequestBody Map<String, String> body) {
        requireApp(appId);
        Map<String, Object> existing = item(appId, itemId);
        String kind = (String) existing.get("kind");
        String expression = body.getOrDefault("expression", "").strip();
        String name = body.getOrDefault("name", "").strip();
        guardCertified(req, existing, "modificar");
        Map<String, Object> resolved = compile(appId, kind, expression, name);
        if (Boolean.TRUE.equals(resolved.get("calculated"))) uniqueCalculatedName(appId, kind, name, itemId);
        return items.update(itemId, name, expression, body.get("description"), resolved, authorName(req), body.get("message"))
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Elemento maestro no encontrado: " + itemId));
    }

    @DeleteMapping("/master-items/{itemId}")
    public ResponseEntity<Void> delete(HttpServletRequest req, @PathVariable String appId, @PathVariable String itemId) {
        requireApp(appId);
        guardCertified(req, item(appId, itemId), "eliminar");
        if (!items.delete(itemId)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Elemento maestro no encontrado: " + itemId);
        }
        return ResponseEntity.noContent().build();
    }

    /**
     * Certifica (o retira la certificación de) una métrica: la marca como definición oficial de la empresa, con quién
     * y cuándo la certificó. Requiere {@code apps:publish} (lo exige {@code Permissions.required}).
     * Body: {certified: true|false, note?}.
     */
    @PostMapping("/master-items/{itemId}/certify")
    public Map<String, Object> certify(HttpServletRequest req, @PathVariable String appId, @PathVariable String itemId,
                                       @RequestBody Map<String, Object> body) {
        requireApp(appId);
        item(appId, itemId);
        boolean on = !Boolean.FALSE.equals(body.get("certified")) && !"false".equals(String.valueOf(body.get("certified")));
        Object note = body.get("note");
        return items.certify(itemId, on, authorName(req), note == null ? null : String.valueOf(note)).orElseThrow();
    }

    /** Historial de versiones de la definición (la más reciente primero). */
    @GetMapping("/master-items/{itemId}/versions")
    public List<Map<String, Object>> versions(@PathVariable String appId, @PathVariable String itemId) {
        requireApp(appId);
        Map<String, Object> it = item(appId, itemId);
        List<Map<String, Object>> v = items.versions(itemId);
        if (!v.isEmpty()) return v;
        // Elemento anterior al historial: su definición vigente es la única versión.
        Map<String, Object> base = new LinkedHashMap<>();
        base.put("version", it.get("version"));
        base.put("name", it.get("name"));
        base.put("expression", it.get("expression"));
        base.put("description", it.get("description"));
        base.put("message", "Definición inicial");
        base.put("author_name", null);
        base.put("created_at", it.get("updated_at"));
        base.put("is_current", true);
        return List.of(base);
    }

    /** Restaura una versión anterior: se valida de nuevo y queda como una versión NUEVA (el historial no se reescribe). */
    @PostMapping("/master-items/{itemId}/versions/{version}/restore")
    public Map<String, Object> restore(HttpServletRequest req, @PathVariable String appId, @PathVariable String itemId,
                                       @PathVariable int version) {
        requireApp(appId);
        Map<String, Object> existing = item(appId, itemId);
        guardCertified(req, existing, "modificar");
        Map<String, Object> v = items.version(itemId, version).orElseThrow(() ->
                new ResponseStatusException(HttpStatus.NOT_FOUND, "Versión no encontrada: v" + version));
        String kind = (String) existing.get("kind");
        String name = (String) v.get("name"), expression = (String) v.get("expression");
        Map<String, Object> resolved = compile(appId, kind, expression, name);
        if (Boolean.TRUE.equals(resolved.get("calculated"))) uniqueCalculatedName(appId, kind, name, itemId);
        return items.update(itemId, name, expression, (String) v.get("description"), resolved, authorName(req), "Restaurada desde v" + version)
                .orElseThrow();
    }

    private Map<String, Object> item(String appId, String itemId) {
        Map<String, Object> it = items.get(itemId).orElseThrow(() ->
                new ResponseStatusException(HttpStatus.NOT_FOUND, "Elemento maestro no encontrado: " + itemId));
        if (!appId.equals(it.get("app_id"))) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Elemento maestro no encontrado: " + itemId);
        return it;
    }

    /** Una métrica certificada solo la cambia o borra quien puede publicar (apps:publish). */
    private static void guardCertified(HttpServletRequest req, Map<String, Object> it, String action) {
        if (!Boolean.TRUE.equals(it.get("certified"))) return;
        UserRecord me = AccessService.current(req);
        if (me == null || !me.has(Permissions.PUBLISH))
            throw new ResponseStatusException(HttpStatus.FORBIDDEN,
                    "«" + it.get("name") + "» es una métrica certificada: solo quien puede publicar (apps:publish) puede " + action + "la.");
    }

    private static String authorName(HttpServletRequest req) {
        UserRecord me = AccessService.current(req);
        return me == null ? null : me.name();
    }
}
