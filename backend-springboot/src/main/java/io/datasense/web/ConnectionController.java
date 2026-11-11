package io.datasense.web;

import io.datasense.engine.DataFrame;
import io.datasense.engine.Profiler;
import io.datasense.engine.TableStore;
import io.datasense.engine.connect.ConnectionExecutor;
import io.datasense.engine.connect.ConnectionExecutors;
import io.datasense.engine.connect.Extraction;
import io.datasense.engine.connect.LoadScripts;
import io.datasense.engine.transform.DataTransform;
import io.datasense.model.AppModels.ColumnProfile;
import io.datasense.repo.AppRepository;
import io.datasense.repo.ConnectionRepository;
import io.datasense.repo.TableRepository;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Conexiones de datos (DataFiles, Amazon Athena, S3, bases de datos…).
 * Equivalente a cómo Qlik gestiona las data connections. El "test" valida los
 * campos requeridos por conector y, si están completos, abre una conexión REAL
 * (AWS/JDBC/HTTP) vía {@link ConnectionExecutors}; {@code /load} materializa una
 * tabla real por el mismo camino que un archivo subido.
 *
 * <p>Contrato defensivo: errores de conexión -> {@code {ok:false, message:<error
 * real>}} con HTTP 200; input inválido -> 400; NUNCA 500 sin controlar. Las
 * credenciales nunca se devuelven en las respuestas.
 */
@RestController
@RequestMapping("/api/v1/apps/{appId}/connections")
public class ConnectionController {

    private final AppRepository apps;
    private final ConnectionRepository repo;
    private final ConnectionExecutors executors;
    private final TableRepository tables;
    private final TableStore store;

    // Campos requeridos por conector (según la documentación de Qlik).
    private static final Map<String, List<String>> REQUIRED = Map.of(
            "athena", List.of("awsRegion", "dataSource", "database", "workgroup"),
            "s3", List.of("bucket", "awsRegion"),
            "redshift", List.of("host", "port", "database"),
            "postgres", List.of("host", "port", "database"),
            "mysql", List.of("host", "port", "database"),
            "sqlserver", List.of("host", "port", "database"),
            "odbc", List.of("dsn"),
            "rest", List.of("url")
    );

    public ConnectionController(AppRepository apps, ConnectionRepository repo,
                                ConnectionExecutors executors, TableRepository tables, TableStore store) {
        this.apps = apps;
        this.repo = repo;
        this.executors = executors;
        this.tables = tables;
        this.store = store;
    }

    private void requireApp(String appId) {
        apps.getApp(appId).orElseThrow(() ->
                new ResponseStatusException(HttpStatus.NOT_FOUND, "App no encontrada: " + appId));
    }

    @GetMapping
    public List<Map<String, Object>> list(@PathVariable String appId) {
        requireApp(appId);
        return repo.list(appId);
    }

    @SuppressWarnings("unchecked")
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> create(@PathVariable String appId, @RequestBody Map<String, Object> body) {
        requireApp(appId);
        String name = str(body.get("name"));
        String connector = str(body.get("connector"));
        String space = str(body.get("space"));
        Map<String, Object> config = (Map<String, Object>) body.getOrDefault("config", Map.of());
        if (name.isBlank()) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "El nombre de la conexión es obligatorio.");
        if (connector.isBlank()) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Debe elegir un conector.");
        List<String> missing = missingFields(connector, config);
        if (!missing.isEmpty())
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Faltan campos obligatorios: " + String.join(", ", missing));
        return repo.create(appId, name, connector, space, config);
    }

    /**
     * Prueba de conexión. Si faltan campos requeridos devuelve el error de
     * campos (HTTP 200). Si están completos, obtiene el executor del conector y
     * abre una conexión REAL; el resultado o el error real de AWS/JDBC/HTTP se
     * devuelve como {@code {ok, message}}. Todo envuelto para no propagar 5xx.
     */
    @SuppressWarnings("unchecked")
    @PostMapping("/test")
    public Map<String, Object> test(@PathVariable String appId, @RequestBody Map<String, Object> body) {
        requireApp(appId);
        String connector = str(body.get("connector"));
        Map<String, Object> config = (Map<String, Object>) body.getOrDefault("config", Map.of());
        List<String> missing = missingFields(connector, config);
        if (!missing.isEmpty())
            return Map.of("ok", false, "message", "Faltan campos obligatorios: " + String.join(", ", missing));

        ConnectionExecutor exec = executors.get(connector);
        if (exec == null)
            return Map.of("ok", false, "message", "Conector no soportado: " + connector);
        try {
            ConnectionExecutor.ExecResult res = exec.test(config);
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("ok", res.ok());
            out.put("message", res.message());
            if (res.details() != null && !res.details().isEmpty()) out.put("details", res.details());
            return out;
        } catch (Exception e) {
            return Map.of("ok", false, "message", message(e));
        }
    }

    /**
     * Carga REAL: abre la conexión con la config sin enmascarar, trae datos y los
     * materializa como una tabla del motor (mismo camino que un archivo). Nunca
     * devuelve credenciales ni 5xx.
     */
    @SuppressWarnings("unchecked")
    @PostMapping("/{connId}/load")
    public Map<String, Object> load(@PathVariable String appId, @PathVariable String connId,
                                    @RequestBody(required = false) Map<String, Object> params) {
        requireApp(appId);
        // "Conexiones realizadas": una conexión creada en cualquier app puede usarse
        // para cargar datos en esta (el stack de conexiones es del usuario, no de la app).
        Map<String, Object> conn = repo.getRaw(connId).orElseThrow(() ->
                new ResponseStatusException(HttpStatus.NOT_FOUND, "Conexión no encontrada: " + connId));

        String connector = str(conn.get("connector"));
        Map<String, Object> config = (Map<String, Object>) conn.getOrDefault("config", Map.of());
        Map<String, Object> p = params == null ? Map.of() : params;

        ConnectionExecutor exec = executors.get(connector);
        if (exec == null)
            return Map.of("ok", false, "message", "Conector no soportado: " + connector);

        try {
            DataTransform.Result tr = Extraction.load(exec, config, p);
            DataFrame df = tr == null ? null : tr.df();
            if (df == null || df.columns().isEmpty())
                return Map.of("ok", false, "message", "La carga no devolvió datos.");

            String tableName = targetName(p, conn);

            // Volver a cargar la misma tabla la reemplaza (no duplica nombres en el modelo).
            boolean replaced = false;
            for (Map<String, Object> t : tables.listTables(appId)) {
                if (tableName.equals(t.get("name"))) {
                    tables.deleteTable((String) t.get("id"));
                    store.delete(appId, (String) t.get("id"));
                    repo.deleteTableSource((String) t.get("id"));
                    replaced = true;
                }
            }

            List<ColumnProfile> profiles = new ArrayList<>();
            for (int c = 0; c < df.columns().size(); c++) {
                profiles.add(Profiler.profile(df.columns().get(c), df.columnValues(c)));
            }
            Map<String, Object> row = tables.createTable(appId, tableName, "conn:" + connector, profiles);
            try { store.save(appId, (String) row.get("id"), df); }
            catch (RuntimeException ex) { tables.deleteTable((String) row.get("id")); throw ex; }
            Map<String, Object> stored = new LinkedHashMap<>(p);
            stored.remove("maxRows");
            repo.saveTableSource((String) row.get("id"), appId, connId, str(conn.get("name")), connector, stored);

            Map<String, Object> table = new LinkedHashMap<>();
            table.put("id", row.get("id"));
            table.put("name", tableName);
            table.put("rows", df.rowCount());
            table.put("fields", df.columns().size());
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("ok", true);
            out.put("message", "Tabla " + tableName + (replaced ? " recargada (" : " cargada (") + df.rowCount() + " filas, "
                    + df.columns().size() + " columnas)");
            out.put("table", table);
            out.put("replaced", replaced);
            out.put("rowsExtracted", tr.rowsIn());
            if (!tr.warnings().isEmpty()) out.put("warnings", tr.warnings());
            out.put("script", LoadScripts.block(str(conn.get("name")), connector, config, stored, tableName, df.columns()));
            return out;
        } catch (IllegalArgumentException e) {
            return Map.of("ok", false, "message", message(e));
        } catch (Exception e) {
            return Map.of("ok", false, "message", message(e));
        }
    }

    @DeleteMapping("/{connId}")
    public ResponseEntity<Void> delete(@PathVariable String appId, @PathVariable String connId) {
        requireApp(appId);
        if (!repo.delete(connId)) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Conexión no encontrada: " + connId);
        return ResponseEntity.noContent().build();
    }

    private List<String> missingFields(String connector, Map<String, Object> config) {
        List<String> req = REQUIRED.getOrDefault(connector, List.of());
        List<String> missing = new ArrayList<>();
        for (String f : req) {
            Object v = config.get(f);
            if (v == null || String.valueOf(v).isBlank()) missing.add(f);
        }
        // IAM auth exige claves cuando no es "default".
        if ("athena".equals(connector) && "iam".equals(str(config.get("authType")))) {
            if (isBlank(config.get("accessKeyId"))) missing.add("accessKeyId");
            if (isBlank(config.get("secretKey"))) missing.add("secretKey");
        }
        return missing;
    }

    /** Nombre de la tabla destino: el indicado, o el de la tabla/objeto (sin carpeta ni extensión), o el de la conexión. */
    static String targetName(Map<String, Object> p, Map<String, Object> conn) {
        String n = str(p.get("tableName")).trim();
        if (n.isBlank()) n = str(p.get("table")).trim();
        if (n.isBlank()) {
            String k = str(p.get("key")).isBlank() ? str(p.get("object")) : str(p.get("key"));
            if (!k.isBlank()) {
                k = k.substring(k.lastIndexOf('/') + 1);
                int dot = k.lastIndexOf('.');
                n = dot > 0 ? k.substring(0, dot) : k;
            }
        }
        if (n.contains(".")) n = n.substring(n.lastIndexOf('.') + 1); // esquema.tabla -> tabla
        n = n.replace("\"", "").trim();
        if (n.isBlank()) n = str(conn.get("name"));
        return n.isBlank() ? "tabla" : n;
    }

    static String message(Exception e) {
        String m = e.getMessage();
        return (m == null || m.isBlank()) ? e.getClass().getSimpleName() : m;
    }

    private static boolean isBlank(Object o) { return o == null || String.valueOf(o).isBlank(); }
    private static String str(Object o) { return o == null ? "" : String.valueOf(o); }
}
