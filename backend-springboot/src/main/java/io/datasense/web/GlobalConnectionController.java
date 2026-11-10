package io.datasense.web;

import io.datasense.engine.DataFrame;
import io.datasense.engine.connect.ConnectionExecutor;
import io.datasense.engine.connect.ConnectionExecutors;
import io.datasense.engine.connect.LoadScripts;
import io.datasense.repo.ConnectionRepository;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * "Conexiones realizadas": el stack de conexiones del usuario, independiente de
 * la app donde se crearon.
 * <ul>
 *   <li>{@code GET  /api/v1/connections} — todas (config enmascarada + app de origen).</li>
 *   <li>{@code POST /api/v1/connections/{id}/browse} — explora bases/tablas/objetos.</li>
 *   <li>{@code POST /api/v1/connections/{id}/preview} — extrae una muestra SIN
 *       materializarla (validación) y devuelve el script de carga equivalente.</li>
 * </ul>
 * La carga real sigue en {@code POST /api/v1/apps/{appId}/connections/{id}/load}.
 * Contrato: errores de la fuente -> {@code {ok:false, message}} con HTTP 200.
 */
@RestController
@RequestMapping("/api/v1/connections")
public class GlobalConnectionController {

    private static final int PREVIEW_ROWS = 50;

    private final ConnectionRepository repo;
    private final ConnectionExecutors executors;

    public GlobalConnectionController(ConnectionRepository repo, ConnectionExecutors executors) {
        this.repo = repo;
        this.executors = executors;
    }

    @GetMapping
    public List<Map<String, Object>> list() {
        return repo.listAll();
    }

    private Map<String, Object> raw(String id) {
        return repo.getRaw(id).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Conexión no encontrada: " + id));
    }

    @SuppressWarnings("unchecked")
    @PostMapping("/{id}/browse")
    public Map<String, Object> browse(@PathVariable String id, @RequestBody(required = false) Map<String, Object> body) {
        Map<String, Object> conn = raw(id);
        ConnectionExecutor exec = executors.get(String.valueOf(conn.get("connector")));
        if (exec == null) return Map.of("ok", false, "message", "Conector no soportado: " + conn.get("connector"));
        try {
            Map<String, Object> res = new LinkedHashMap<>(exec.browse((Map<String, Object>) conn.get("config"), body == null ? Map.of() : body));
            res.put("ok", true);
            return res;
        } catch (UnsupportedOperationException e) {
            return Map.of("ok", false, "unsupported", true, "message", ConnectionController.message(e));
        } catch (Exception e) {
            return Map.of("ok", false, "message", ConnectionController.message(e));
        }
    }

    @SuppressWarnings("unchecked")
    @PostMapping("/{id}/preview")
    public Map<String, Object> preview(@PathVariable String id, @RequestBody(required = false) Map<String, Object> body) {
        Map<String, Object> conn = raw(id);
        String connector = String.valueOf(conn.get("connector"));
        ConnectionExecutor exec = executors.get(connector);
        if (exec == null) return Map.of("ok", false, "message", "Conector no soportado: " + connector);
        Map<String, Object> config = (Map<String, Object>) conn.get("config");
        Map<String, Object> params = new LinkedHashMap<>(body == null ? Map.of() : body);
        // La muestra trae como máximo PREVIEW_ROWS filas; el script refleja el límite pedido para la carga.
        Map<String, Object> scriptParams = new LinkedHashMap<>(params);
        params.put("maxRows", PREVIEW_ROWS);
        if (!params.containsKey("query") || String.valueOf(params.get("query")).isBlank()) params.put("limit", PREVIEW_ROWS);
        long t0 = System.currentTimeMillis();
        try {
            DataFrame df = exec.load(config, params);
            if (df == null || df.columns().isEmpty()) return Map.of("ok", false, "message", "La consulta no devolvió columnas.");
            List<List<String>> rows = new ArrayList<>();
            for (int i = 0; i < Math.min(PREVIEW_ROWS, df.rowCount()); i++) rows.add(df.rows().get(i));
            String tableName = ConnectionController.targetName(scriptParams, conn);
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("ok", true);
            out.put("columns", df.columns());
            out.put("rows", rows);
            out.put("shown", rows.size());
            out.put("elapsedMs", System.currentTimeMillis() - t0);
            out.put("tableName", tableName);
            out.put("sql", LoadScripts.sqlFor(connector, config, scriptParams));
            out.put("script", LoadScripts.block(String.valueOf(conn.get("name")), connector, config, scriptParams, tableName, df.columns()));
            out.put("message", "Extracción validada: " + df.columns().size() + " columnas; muestra de " + rows.size() + " filas.");
            return out;
        } catch (Exception e) {
            return Map.of("ok", false, "message", ConnectionController.message(e));
        }
    }
}
