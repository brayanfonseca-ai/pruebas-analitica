package io.datasense.web;

import io.datasense.engine.Associations;
import io.datasense.engine.DataFrame;
import io.datasense.engine.TableStore;
import io.datasense.repo.AppRepository;
import io.datasense.repo.TableRepository;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** Modelo de datos: asociaciones recomendadas y grafo del modelo. */
@RestController
@RequestMapping("/api/v1/apps/{appId}")
public class ModelController {

    private final AppRepository apps;
    private final TableRepository tables;
    private final TableStore store;
    private final io.datasense.repo.AssociationRepository assocRepo;
    private final io.datasense.repo.FieldOverrideRepository fieldOverrides;

    public ModelController(AppRepository apps, TableRepository tables, TableStore store,
                           io.datasense.repo.AssociationRepository assocRepo,
                           io.datasense.repo.FieldOverrideRepository fieldOverrides) {
        this.apps = apps;
        this.tables = tables;
        this.store = store;
        this.assocRepo = assocRepo;
        this.fieldOverrides = fieldOverrides;
    }

    private Map<String, DataFrame> load(String appId) {
        apps.getApp(appId).orElseThrow(() ->
                new ResponseStatusException(HttpStatus.NOT_FOUND, "App no encontrada: " + appId));
        Map<String, DataFrame> loaded = new HashMap<>();
        for (Map<String, Object> row : tables.listTables(appId)) {
            loaded.put((String) row.get("name"), store.load(appId, (String) row.get("id")));
        }
        return loaded;
    }

    @GetMapping("/associations/recommend")
    public List<Associations.Edge> recommend(@PathVariable String appId) {
        return Associations.recommend(load(appId));
    }

    @GetMapping("/model")
    public Map<String, Object> model(@PathVariable String appId) {
        appsExist(appId);
        Map<String, DataFrame> loaded = new HashMap<>();
        // Catálogo efectivo por tabla: displays (rename) y campos ocultos omitidos
        // en los nodos, sin cambiar el criterio de asociación (columnas físicas).
        Map<String, List<io.datasense.engine.EffectiveFields.Field>> tableFields = new HashMap<>();
        for (Map<String, Object> row : tables.listTables(appId)) {
            String name = (String) row.get("name");
            String tableId = (String) row.get("id");
            DataFrame df = store.load(appId, tableId);
            loaded.put(name, df);
            tableFields.put(name, io.datasense.engine.EffectiveFields.resolve(
                    name, df, fieldOverrides.list(appId, tableId)));
        }
        return Associations.buildModelGraph(loaded, tableFields);
    }

    // --- Asociaciones persistidas (personalizadas o aceptadas) ---
    @GetMapping("/associations")
    public List<Map<String, Object>> listAssociations(@PathVariable String appId) {
        appsExist(appId);
        return assocRepo.list(appId);
    }

    @PostMapping("/associations")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> createAssociation(@PathVariable String appId, @RequestBody Map<String, Object> body) {
        appsExist(appId);
        return assocRepo.save(appId, body, true);
    }

    @PutMapping("/associations")
    public Map<String, Object> acceptAssociation(@PathVariable String appId, @RequestBody Map<String, Object> body) {
        appsExist(appId);
        return assocRepo.save(appId, body, false);
    }

    @DeleteMapping("/associations/{assocId}")
    public org.springframework.http.ResponseEntity<Void> deleteAssociation(
            @PathVariable String appId, @PathVariable String assocId) {
        appsExist(appId);
        assocRepo.delete(assocId);
        return org.springframework.http.ResponseEntity.noContent().build();
    }

    private void appsExist(String appId) {
        apps.getApp(appId).orElseThrow(() ->
                new ResponseStatusException(HttpStatus.NOT_FOUND, "App no encontrada: " + appId));
    }
}
