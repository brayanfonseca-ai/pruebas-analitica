package io.datasense.web;

import io.datasense.repo.AppRepository;
import io.datasense.repo.FieldOverrideRepository;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.Map;

/**
 * Capa de "preparación visual de datos" (field overrides) por tabla: renombrar,
 * forzar tipo u ocultar columnas sin escribir script. Los overrides se aplican
 * al servir la tabla (ver {@link io.datasense.web.DataController}) y persisten en
 * SQLite.
 */
@RestController
@RequestMapping("/api/v1/apps/{appId}/tables/{tableId}/field-overrides")
public class FieldOverrideController {

    private final AppRepository apps;
    private final FieldOverrideRepository overrides;

    public FieldOverrideController(AppRepository apps, FieldOverrideRepository overrides) {
        this.apps = apps;
        this.overrides = overrides;
    }

    private void requireApp(String appId) {
        apps.getApp(appId).orElseThrow(() ->
                new ResponseStatusException(HttpStatus.NOT_FOUND, "App no encontrada: " + appId));
    }

    @GetMapping
    public List<Map<String, Object>> list(@PathVariable String appId, @PathVariable String tableId) {
        requireApp(appId);
        return overrides.list(appId, tableId);
    }

    /**
     * Upsert de un conjunto de overrides. Acepta un array de
     * {@code {source_field, rename?, forced_type?, hidden?}}. Input inválido
     * (array nulo, source_field vacío, o forced_type no válido) -> 400; nunca 500.
     */
    @PutMapping
    public List<Map<String, Object>> put(@PathVariable String appId, @PathVariable String tableId,
                                         @RequestBody List<Map<String, Object>> body) {
        requireApp(appId);
        if (body == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Se esperaba un array de overrides.");
        }
        for (Map<String, Object> item : body) {
            if (item == null) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Override inválido (null).");
            }
            Object sf = item.get("source_field");
            String sourceField = sf == null ? "" : String.valueOf(sf).trim();
            if (sourceField.isEmpty()) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "source_field es obligatorio.");
            }
            Object ftObj = item.get("forced_type");
            String forcedType = ftObj == null ? null : String.valueOf(ftObj).trim();
            if (forcedType != null && !forcedType.isEmpty()
                    && !FieldOverrideRepository.VALID_TYPES.contains(forcedType)) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                        "forced_type inválido: " + forcedType + " (esperado text|number|date).");
            }
            Object rnObj = item.get("rename");
            String rename = rnObj == null ? null : String.valueOf(rnObj);
            boolean hidden = asBool(item.get("hidden"));
            overrides.upsert(appId, tableId, sourceField,
                    rename, (forcedType == null || forcedType.isEmpty()) ? null : forcedType, hidden);
        }
        return overrides.list(appId, tableId);
    }

    private static boolean asBool(Object o) {
        if (o instanceof Boolean b) return b;
        if (o instanceof Number n) return n.intValue() != 0;
        if (o instanceof String s) return "1".equals(s) || "true".equalsIgnoreCase(s);
        return false;
    }
}
