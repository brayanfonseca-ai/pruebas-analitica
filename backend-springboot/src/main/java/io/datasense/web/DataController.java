package io.datasense.web;

import io.datasense.engine.DataFrame;
import io.datasense.engine.FieldOverrides;
import io.datasense.engine.Profiler;
import io.datasense.engine.TableReader;
import io.datasense.engine.TableStore;
import io.datasense.model.AppModels.ColumnProfile;
import io.datasense.model.AppModels.TableOut;
import io.datasense.repo.AppRepository;
import io.datasense.repo.FieldOverrideRepository;
import io.datasense.repo.TableRepository;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Carga y listado de tablas. Equivale a routers/data.py (parte de tablas). */
@RestController
@RequestMapping("/api/v1/apps/{appId}")
public class DataController {

    private final AppRepository apps;
    private final TableRepository tables;
    private final TableStore store;
    private final FieldOverrideRepository fieldOverrides;

    public DataController(AppRepository apps, TableRepository tables, TableStore store,
                          FieldOverrideRepository fieldOverrides) {
        this.apps = apps;
        this.tables = tables;
        this.store = store;
        this.fieldOverrides = fieldOverrides;
    }

    private void requireApp(String appId) {
        apps.getApp(appId).orElseThrow(() ->
                new ResponseStatusException(HttpStatus.NOT_FOUND, "App no encontrada: " + appId));
    }

    @PostMapping("/tables")
    @ResponseStatus(HttpStatus.CREATED)
    public TableOut upload(@PathVariable String appId, @RequestParam("file") MultipartFile file) {
        requireApp(appId);
        String filename = file.getOriginalFilename() == null ? "upload.csv" : file.getOriginalFilename();
        DataFrame df;
        try {
            df = TableReader.read(file.getBytes(), filename);
        } catch (IllegalArgumentException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, e.getMessage());
        } catch (IOException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "No se pudo leer el archivo: " + e.getMessage());
        }
        String name = filename.contains(".") ? filename.substring(0, filename.lastIndexOf('.')) : filename;
        // El perfilado persistido en 'columns' usa el DataFrame crudo (sin overrides,
        // que aún no existen en el momento de la creación).
        List<ColumnProfile> rawProfiles = profiles(df);
        Map<String, Object> row = tables.createTable(appId, name.isBlank() ? "tabla" : name, filename, rawProfiles);
        store.save(appId, (String) row.get("id"), df);
        return toTableOut(appId, row, df);
    }

    @GetMapping("/tables")
    public List<TableOut> list(@PathVariable String appId) {
        requireApp(appId);
        List<TableOut> out = new ArrayList<>();
        for (Map<String, Object> row : tables.listTables(appId)) {
            DataFrame df = store.load(appId, (String) row.get("id"));
            out.add(toTableOut(appId, row, df));
        }
        return out;
    }

    @GetMapping("/tables/{tableId}")
    public TableOut getTable(@PathVariable String appId, @PathVariable String tableId) {
        requireApp(appId);
        Map<String, Object> row = tables.listTables(appId).stream()
                .filter(r -> tableId.equals(r.get("id"))).findFirst()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Tabla no encontrada: " + tableId));
        DataFrame df = store.load(appId, tableId);
        return toTableOut(appId, row, df);
    }

    @DeleteMapping("/tables/{tableId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteTable(@PathVariable String appId, @PathVariable String tableId) {
        requireApp(appId);
        tables.deleteTable(tableId);
    }

    private List<ColumnProfile> profiles(DataFrame df) {
        List<ColumnProfile> out = new ArrayList<>();
        for (int c = 0; c < df.columns().size(); c++) {
            out.add(Profiler.profile(df.columns().get(c), df.columnValues(c)));
        }
        return out;
    }

    /**
     * Construye el {@link TableOut} aplicando la capa de field overrides
     * (renombre, tipo forzado, ocultar) de la tabla. Sin overrides, el resultado
     * es idéntico al comportamiento previo. La capa es de VISTA: no reescribe el
     * CSV materializado (la fuente conserva todas sus columnas).
     */
    private TableOut toTableOut(String appId, Map<String, Object> row, DataFrame df) {
        String tableId = (String) row.get("id");
        List<Map<String, Object>> overrides = fieldOverrides.list(appId, tableId);
        FieldOverrides.Effective eff = FieldOverrides.apply(df, overrides);

        // Perfiles sobre la vista efectiva: nombre renombrado, tipo forzado manda,
        // columnas ocultas ausentes.
        List<ColumnProfile> profiles = new ArrayList<>();
        for (int i = 0; i < eff.size(); i++) {
            ColumnProfile raw = Profiler.profile(eff.names().get(i), eff.valuesAt(df, i));
            String effType = eff.typeAt(i);
            profiles.add(new ColumnProfile(raw.name(), effType, raw.null_count(),
                    raw.distinct_count(), raw.total_count(), raw.sample()));
        }

        List<Map<String, Object>> preview = new ArrayList<>();
        int limit = Math.min(50, df.rowCount());
        for (int r = 0; r < limit; r++) {
            Map<String, Object> rec = new LinkedHashMap<>();
            List<String> values = df.rows().get(r);
            for (int i = 0; i < eff.size(); i++) {
                int src = eff.sourceIndexAt(i);
                String raw = src < values.size() ? values.get(src) : null;
                rec.put(eff.names().get(i), Profiler.coerce(raw, eff.typeAt(i)));
            }
            preview.add(rec);
        }

        return new TableOut(
                tableId, appId, (String) row.get("name"),
                (String) row.get("source_name"), (String) row.get("created_at"),
                df.rowCount(), profiles, preview);
    }
}
