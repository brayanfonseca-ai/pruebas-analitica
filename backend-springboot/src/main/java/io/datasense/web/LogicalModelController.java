package io.datasense.web;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;

import io.datasense.engine.DataFrame;
import io.datasense.engine.LogicalModelService;
import io.datasense.engine.LogicalModelService.FieldInput;
import io.datasense.engine.TableStore;
import io.datasense.repo.AppRepository;
import io.datasense.repo.FieldOverrideRepository;
import io.datasense.repo.Ids;
import io.datasense.repo.LogicalModelRepository;
import io.datasense.repo.TableRepository;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * Modelo lógico de negocio por app (equivalente al "modelo lógico" de Qlik):
 * clasifica los campos reales (dimensión/medida/fecha) respetando los
 * field-overrides, y gestiona grupos, paquetes, jerarquías, comportamientos y
 * periodos de calendario. El backend es la única fuente de verdad: GENERA la
 * lógica por defecto desde los datos y mezcla los ajustes guardados.
 *
 * <p>Contrato defensivo (patrón de {@link FieldOverrideController} /
 * {@link ModelController}): 404 si la app no existe, 400 ante entrada inválida,
 * nunca 500 no manejado. SOLO LEE los field-overrides, no los modifica.</p>
 */
@RestController
@RequestMapping("/api/v1/apps/{appId}/logical-model")
public class LogicalModelController {

    private static final Set<String> CLASSIFICATIONS = Set.of("dimension", "measure", "date");
    private static final Set<String> VISIBILITIES = Set.of("visible", "hidden", "excluded");
    private static final Set<String> AGGREGATIONS = Set.of("sum", "avg", "count", "none");
    private static final Set<String> GROUP_TYPES = Set.of("calendar", "measure", "dimension");

    private final AppRepository apps;
    private final TableRepository tables;
    private final TableStore store;
    private final FieldOverrideRepository fieldOverrides;
    private final LogicalModelRepository models;
    private final LogicalModelService service;
    private final ObjectMapper mapper;

    public LogicalModelController(AppRepository apps, TableRepository tables, TableStore store,
                                  FieldOverrideRepository fieldOverrides, LogicalModelRepository models,
                                  LogicalModelService service, ObjectMapper mapper) {
        this.apps = apps;
        this.tables = tables;
        this.store = store;
        this.fieldOverrides = fieldOverrides;
        this.models = models;
        this.service = service;
        this.mapper = mapper;
    }

    private void requireApp(String appId) {
        apps.getApp(appId).orElseThrow(() ->
                new ResponseStatusException(HttpStatus.NOT_FOUND, "App no encontrada: " + appId));
    }

    /** Arma los campos reales de todas las tablas de la app con su tipo efectivo y override. */
    private List<FieldInput> loadFields(String appId) {
        List<FieldInput> inputs = new ArrayList<>();
        for (Map<String, Object> row : tables.listTables(appId)) {
            String tableName = (String) row.get("name");
            String tableId = (String) row.get("id");
            DataFrame df = store.load(appId, tableId);
            List<Map<String, Object>> overrides = fieldOverrides.list(appId, tableId);
            for (String col : df.columns()) {
                Map<String, Object> ov = findOverride(overrides, col);
                boolean hidden = ov != null && asBool(ov.get("hidden"));
                String forced = ov == null ? null : asString(ov.get("forced_type"));
                String type = (forced != null && !forced.isBlank()) ? forced : df.typeOf(col);
                String rename = ov == null ? null : asString(ov.get("rename"));
                String display = (rename != null && !rename.isBlank()) ? rename : col;
                inputs.add(new FieldInput(tableName, col, display, type, hidden));
            }
        }
        return inputs;
    }

    /** Documento efectivo: default regenerado, mezclado con lo guardado si existe. */
    private Map<String, Object> effectiveDoc(String appId) {
        Map<String, Object> base = service.generateDefault(loadFields(appId));
        Optional<String> saved = models.getDocJson(appId);
        if (saved.isEmpty()) return base;
        Map<String, Object> savedDoc = parseDoc(saved.get());
        return service.merge(base, savedDoc);
    }

    private Map<String, Object> withSummary(String appId, Map<String, Object> doc) {
        Map<String, Object> out = new LinkedHashMap<>(doc);
        out.put("enabled", models.isEnabled(appId));
        out.put("summary", service.summarize(doc));
        return out;
    }

    // --- Documento completo ---

    @GetMapping
    public Map<String, Object> get(@PathVariable String appId) {
        requireApp(appId);
        return withSummary(appId, effectiveDoc(appId));
    }

    @PutMapping
    public Map<String, Object> put(@PathVariable String appId, @RequestBody Map<String, Object> body) {
        requireApp(appId);
        if (body == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Se esperaba el documento del modelo lógico.");
        }
        validateDoc(body);
        persist(appId, body);
        return withSummary(appId, effectiveDoc(appId));
    }

    @PostMapping("/reset")
    public Map<String, Object> reset(@PathVariable String appId) {
        requireApp(appId);
        Map<String, Object> base = service.generateDefault(loadFields(appId));
        persist(appId, base);
        return withSummary(appId, effectiveDoc(appId));
    }

    @PostMapping("/enable")
    public Map<String, Object> enable(@PathVariable String appId) {
        requireApp(appId);
        ensurePersisted(appId);
        models.setEnabled(appId, true);
        return withSummary(appId, effectiveDoc(appId));
    }

    @PostMapping("/disable")
    public Map<String, Object> disable(@PathVariable String appId) {
        requireApp(appId);
        ensurePersisted(appId);
        models.setEnabled(appId, false);
        return withSummary(appId, effectiveDoc(appId));
    }

    // --- Sub-recursos CRUD ---

    @PostMapping("/groups")
    public Map<String, Object> addGroup(@PathVariable String appId, @RequestBody Map<String, Object> body) {
        return mutateCollection(appId, "groups", body, this::validateGroup, null);
    }

    @PutMapping("/groups/{id}")
    public Map<String, Object> updateGroup(@PathVariable String appId, @PathVariable String id,
                                           @RequestBody Map<String, Object> body) {
        return mutateCollection(appId, "groups", body, this::validateGroup, id);
    }

    @DeleteMapping("/groups/{id}")
    public Map<String, Object> deleteGroup(@PathVariable String appId, @PathVariable String id) {
        return removeFromCollection(appId, "groups", id);
    }

    @PostMapping("/packages")
    public Map<String, Object> addPackage(@PathVariable String appId, @RequestBody Map<String, Object> body) {
        return mutateCollection(appId, "packages", body, null, null);
    }

    @PutMapping("/packages/{id}")
    public Map<String, Object> updatePackage(@PathVariable String appId, @PathVariable String id,
                                             @RequestBody Map<String, Object> body) {
        return mutateCollection(appId, "packages", body, null, id);
    }

    @DeleteMapping("/packages/{id}")
    public Map<String, Object> deletePackage(@PathVariable String appId, @PathVariable String id) {
        return removeFromCollection(appId, "packages", id);
    }

    @PostMapping("/hierarchies")
    public Map<String, Object> addHierarchy(@PathVariable String appId, @RequestBody Map<String, Object> body) {
        return mutateCollection(appId, "hierarchies", body, this::validateHierarchy, null);
    }

    @PutMapping("/hierarchies/{id}")
    public Map<String, Object> updateHierarchy(@PathVariable String appId, @PathVariable String id,
                                               @RequestBody Map<String, Object> body) {
        return mutateCollection(appId, "hierarchies", body, this::validateHierarchy, id);
    }

    @DeleteMapping("/hierarchies/{id}")
    public Map<String, Object> deleteHierarchy(@PathVariable String appId, @PathVariable String id) {
        return removeFromCollection(appId, "hierarchies", id);
    }

    @PostMapping("/behaviors")
    public Map<String, Object> addBehavior(@PathVariable String appId, @RequestBody Map<String, Object> body) {
        return mutateCollection(appId, "behaviors", body, null, null);
    }

    @PutMapping("/behaviors/{id}")
    public Map<String, Object> updateBehavior(@PathVariable String appId, @PathVariable String id,
                                              @RequestBody Map<String, Object> body) {
        return mutateCollection(appId, "behaviors", body, null, id);
    }

    @DeleteMapping("/behaviors/{id}")
    public Map<String, Object> deleteBehavior(@PathVariable String appId, @PathVariable String id) {
        return removeFromCollection(appId, "behaviors", id);
    }

    @PostMapping("/calendar-periods")
    public Map<String, Object> addCalendarPeriod(@PathVariable String appId, @RequestBody Map<String, Object> body) {
        requireDateField(appId);
        return mutateCollection(appId, "calendarPeriods", body, null, null);
    }

    @PutMapping("/calendar-periods/{id}")
    public Map<String, Object> updateCalendarPeriod(@PathVariable String appId, @PathVariable String id,
                                                    @RequestBody Map<String, Object> body) {
        requireDateField(appId);
        return mutateCollection(appId, "calendarPeriods", body, null, id);
    }

    @DeleteMapping("/calendar-periods/{id}")
    public Map<String, Object> deleteCalendarPeriod(@PathVariable String appId, @PathVariable String id) {
        return removeFromCollection(appId, "calendarPeriods", id);
    }

    // --- Helpers de colecciones ---

    @SuppressWarnings("unchecked")
    private Map<String, Object> mutateCollection(String appId, String collection, Map<String, Object> body,
                                                 java.util.function.Consumer<Map<String, Object>> validator,
                                                 String id) {
        requireApp(appId);
        if (body == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Se esperaba el cuerpo del recurso.");
        }
        if (validator != null) validator.accept(body);

        Map<String, Object> doc = effectiveDoc(appId);
        List<Map<String, Object>> items = asList(doc.get(collection));

        Map<String, Object> item = new LinkedHashMap<>(body);
        if (id != null) {
            boolean found = false;
            for (int i = 0; i < items.size(); i++) {
                if (id.equals(String.valueOf(items.get(i).get("id")))) {
                    item.put("id", id);
                    items.set(i, item);
                    found = true;
                    break;
                }
            }
            if (!found) {
                throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Recurso no encontrado: " + id);
            }
        } else {
            item.put("id", Ids.newId());
            items.add(item);
        }
        doc.put(collection, items);
        persist(appId, doc);
        return withSummary(appId, effectiveDoc(appId));
    }

    private Map<String, Object> removeFromCollection(String appId, String collection, String id) {
        requireApp(appId);
        Map<String, Object> doc = effectiveDoc(appId);
        List<Map<String, Object>> items = asList(doc.get(collection));
        items.removeIf(it -> id.equals(String.valueOf(it.get("id"))));
        doc.put(collection, items);
        persist(appId, doc);
        return withSummary(appId, effectiveDoc(appId));
    }

    // --- Validación ---

    private void validateDoc(Map<String, Object> body) {
        for (Map<String, Object> f : asList(body.get("fields"))) {
            String classification = asString(f.get("classification"));
            if (classification != null && !CLASSIFICATIONS.contains(classification)) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                        "classification inválida: " + classification + " (esperado dimension|measure|date).");
            }
            String visibility = asString(f.get("visibility"));
            if (visibility != null && !VISIBILITIES.contains(visibility)) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                        "visibility inválida: " + visibility + " (esperado visible|hidden|excluded).");
            }
            String agg = asString(f.get("defaultAggregation"));
            if (agg != null && !AGGREGATIONS.contains(agg)) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                        "defaultAggregation inválida: " + agg + " (esperado sum|avg|count|none).");
            }
        }
    }

    private void validateGroup(Map<String, Object> body) {
        String type = asString(body.get("type"));
        if (type != null && !GROUP_TYPES.contains(type)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "type de grupo inválido: " + type + " (esperado calendar|measure|dimension).");
        }
        if (!(body.get("fields") instanceof List)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "El grupo requiere 'fields' (lista).");
        }
    }

    private void validateHierarchy(Map<String, Object> body) {
        if (!(body.get("levels") instanceof List) || ((List<?>) body.get("levels")).isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "La jerarquía requiere 'levels' (lista ordenada no vacía).");
        }
    }

    private void requireDateField(String appId) {
        requireApp(appId);
        boolean hasDate = false;
        for (Map<String, Object> f : asList(effectiveDoc(appId).get("fields"))) {
            if ("date".equals(asString(f.get("classification")))) {
                hasDate = true;
                break;
            }
        }
        if (!hasDate) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "No hay campos de fecha");
        }
    }

    // --- Persistencia ---

    private void persist(String appId, Map<String, Object> doc) {
        try {
            String json = mapper.writeValueAsString(doc);
            models.upsert(appId, json, models.isEnabled(appId));
        } catch (Exception e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "No se pudo serializar el documento.");
        }
    }

    /** Si aún no hay fila persistida, guarda el default para que setEnabled surta efecto. */
    private void ensurePersisted(String appId) {
        if (models.getDocJson(appId).isEmpty()) {
            persist(appId, service.generateDefault(loadFields(appId)));
        }
    }

    private Map<String, Object> parseDoc(String json) {
        try {
            return mapper.readValue(json, new TypeReference<Map<String, Object>>() {});
        } catch (Exception e) {
            return new LinkedHashMap<>();
        }
    }

    // --- Utilidades ---

    private static Map<String, Object> findOverride(List<Map<String, Object>> overrides, String sourceField) {
        if (overrides == null) return null;
        for (Map<String, Object> ov : overrides) {
            if (sourceField.equals(asString(ov.get("source_field")))) return ov;
        }
        return null;
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> asList(Object o) {
        List<Map<String, Object>> out = new ArrayList<>();
        if (o instanceof List<?> l) {
            for (Object item : l) {
                if (item instanceof Map) out.add(new LinkedHashMap<>((Map<String, Object>) item));
            }
        }
        return out;
    }

    private static String asString(Object o) { return o == null ? null : String.valueOf(o); }

    private static boolean asBool(Object o) {
        if (o instanceof Boolean b) return b;
        if (o instanceof Number n) return n.intValue() != 0;
        if (o instanceof String s) return "1".equals(s) || "true".equalsIgnoreCase(s);
        return false;
    }
}
