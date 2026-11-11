package io.datasense.web;

import io.datasense.engine.DataFrame;
import io.datasense.engine.connect.ConnectionExecutor;
import io.datasense.engine.connect.ConnectionExecutors;
import io.datasense.engine.connect.LoadScripts;
import io.datasense.engine.transform.DataTransform;
import io.datasense.engine.transform.RowExpression;
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

    /**
     * Valida la extracción: trae una muestra cruda (máx. 50 filas, todas las
     * columnas para poder volver a incluirlas) y le aplica las transformaciones.
     * Body = params de carga: {table|query|key, database?, mode (all|partial|sample), limit, tableName?, transform?}.
     */
    @SuppressWarnings("unchecked")
    @PostMapping("/{id}/preview")
    public Map<String, Object> preview(@PathVariable String id, @RequestBody(required = false) Map<String, Object> body) {
        Map<String, Object> conn = raw(id);
        String connector = String.valueOf(conn.get("connector"));
        ConnectionExecutor exec = executors.get(connector);
        if (exec == null) return Map.of("ok", false, "message", "Conector no soportado: " + connector);
        Map<String, Object> config = (Map<String, Object>) conn.get("config");
        Map<String, Object> scriptParams = new LinkedHashMap<>(body == null ? Map.of() : body);
        // Muestra: sin transform (todas las columnas), modo parcial (o muestra aleatoria) de PREVIEW_ROWS filas.
        Map<String, Object> rawParams = new LinkedHashMap<>(scriptParams);
        rawParams.remove("transform");
        rawParams.put("mode", "sample".equals(LoadScripts.mode(scriptParams)) ? "sample" : "partial");
        rawParams.put("limit", PREVIEW_ROWS);
        rawParams.put("maxRows", PREVIEW_ROWS);
        long t0 = System.currentTimeMillis();
        try {
            DataFrame raw = exec.load(config, rawParams);
            if (raw == null || raw.columns().isEmpty()) return Map.of("ok", false, "message", "La consulta no devolvió columnas.");
            List<List<String>> rows = new ArrayList<>();
            for (int i = 0; i < Math.min(PREVIEW_ROWS, raw.rowCount()); i++) rows.add(raw.rows().get(i));
            DataFrame sample = new DataFrame(raw.columns(), rows);
            Map<String, Object> out = transformed(conn, config, scriptParams, sample);
            out.put("elapsedMs", System.currentTimeMillis() - t0);
            out.put("message", "Extracción validada: " + raw.columns().size() + " columnas; muestra de " + rows.size() + " filas.");
            return out;
        } catch (Exception e) {
            return Map.of("ok", false, "message", ConnectionController.message(e));
        }
    }

    /**
     * Re-aplica transformaciones a una muestra ya extraída (sin volver a la fuente):
     * {params, columns, rows} → {raw, columns, rows, warnings, transformError?, script, sql}.
     */
    @SuppressWarnings("unchecked")
    @PostMapping("/{id}/transform")
    public Map<String, Object> transform(@PathVariable String id, @RequestBody Map<String, Object> body) {
        Map<String, Object> conn = raw(id);
        Map<String, Object> config = (Map<String, Object>) conn.get("config");
        Map<String, Object> params = body.get("params") instanceof Map<?, ?> m ? new LinkedHashMap<>((Map<String, Object>) m) : new LinkedHashMap<>();
        List<String> cols = new ArrayList<>();
        if (body.get("columns") instanceof List<?> l) for (Object o : l) cols.add(String.valueOf(o));
        List<List<String>> rows = new ArrayList<>();
        if (body.get("rows") instanceof List<?> l) for (Object r : l) {
            List<String> row = new ArrayList<>();
            if (r instanceof List<?> rl) for (Object v : rl) row.add(v == null ? null : String.valueOf(v));
            while (row.size() < cols.size()) row.add(null);
            rows.add(row);
        }
        return transformed(conn, config, params, new DataFrame(cols, rows));
    }

    /**
     * "Editar script": interpreta el bloque de carga editado y devuelve los params
     * equivalentes (tabla o consulta, modo, límite, nombre) y el transform, para
     * que el asistente visual y el script queden sincronizados.
     * Body {script, columns?: columnas de origen conocidas, params?: params actuales}.
     */
    @SuppressWarnings("unchecked")
    @PostMapping("/{id}/parse-script")
    public Map<String, Object> parseScript(@PathVariable String id, @RequestBody Map<String, Object> body) {
        Map<String, Object> conn = raw(id);
        String connector = String.valueOf(conn.get("connector"));
        Map<String, Object> config = (Map<String, Object>) conn.get("config");
        List<String> known = new ArrayList<>();
        if (body.get("columns") instanceof List<?> l) for (Object o : l) known.add(String.valueOf(o));
        Map<String, Object> cur = body.get("params") instanceof Map<?, ?> m ? (Map<String, Object>) m : Map.of();
        try {
            DataTransform.Parsed p = DataTransform.parseBlock(String.valueOf(body.getOrDefault("script", "")), known);
            Map<String, Object> params = new LinkedHashMap<>();
            if (cur.get("database") != null) params.put("database", cur.get("database"));
            if (p.tableName() != null) params.put("tableName", p.tableName());
            if (p.fileKey() != null) {
                params.put("key", p.fileKey());
            } else if (p.sql() != null) {
                applySql(connector, p.sql(), params);
            }
            params.put("transform", p.spec().toMap());
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("ok", true);
            out.put("params", params);
            out.put("script", LoadScripts.block(String.valueOf(conn.get("name")), connector, config, params,
                    ConnectionController.targetName(params, conn), known));
            out.put("sql", LoadScripts.sqlFor(connector, config, params));
            return out;
        } catch (IllegalArgumentException e) {
            return Map.of("ok", false, "message", ConnectionController.message(e));
        }
    }

    private static final java.util.regex.Pattern SIMPLE_SELECT = java.util.regex.Pattern.compile(
            "(?is)^SELECT\\s+(?:TOP\\s+(\\d+)\\s+)?(.+?)\\s+FROM\\s+((?:\"[^\"]+\"|`[^`]+`|\\[[^\\]]+\\]|[\\w$-]+)(?:\\.(?:\"[^\"]+\"|`[^`]+`|\\[[^\\]]+\\]|[\\w$-]+))*)"
            + "(\\s+ORDER\\s+BY\\s+(?:rand\\(\\)|random\\(\\)|NEWID\\(\\)|DBMS_RANDOM\\.VALUE))?(?:\\s+LIMIT\\s+(\\d+)|\\s+FETCH\\s+FIRST\\s+(\\d+)\\s+ROWS\\s+ONLY)?\\s*$");

    /** SELECT simple sobre una tabla → {table, database?, mode, limit}; cualquier otro SQL → {query, mode: all}. */
    private static void applySql(String connector, String sql, Map<String, Object> params) {
        java.util.regex.Matcher m = SIMPLE_SELECT.matcher(sql.trim());
        if (!m.matches()) { params.put("query", sql.trim()); params.put("mode", "all"); return; }
        String from = m.group(3);
        List<String> parts = new ArrayList<>();
        List<String> raw = new ArrayList<>();
        StringBuilder cur = new StringBuilder();
        char close = 0;
        for (char ch : from.toCharArray()) {
            if (close != 0) { cur.append(ch); if (ch == close) close = 0; continue; }
            if (ch == '"' || ch == '`') close = ch; else if (ch == '[') close = ']';
            if (ch == '.') { raw.add(cur.toString()); cur.setLength(0); continue; }
            cur.append(ch);
        }
        raw.add(cur.toString());
        for (String part : raw) {
            String t = part.trim();
            if ((t.startsWith("\"") && t.endsWith("\"")) || (t.startsWith("`") && t.endsWith("`")) || (t.startsWith("[") && t.endsWith("]"))) t = t.substring(1, t.length() - 1);
            parts.add(t);
        }
        if ("athena".equals(connector) && parts.size() >= 2) {
            params.put("database", parts.get(parts.size() - 2));
            params.put("table", parts.get(parts.size() - 1));
        } else if ("athena".equals(connector)) {
            params.put("table", parts.get(0));
        } else {
            params.put("table", from.trim());
        }
        String n = m.group(1) != null ? m.group(1) : m.group(5) != null ? m.group(5) : m.group(6);
        boolean sample = m.group(4) != null;
        params.put("mode", sample ? "sample" : n != null ? "partial" : "all");
        if (n != null) params.put("limit", Integer.parseInt(n));
    }

    /** Aplica el transform a la muestra y arma la respuesta común de preview/transform. */
    private Map<String, Object> transformed(Map<String, Object> conn, Map<String, Object> config, Map<String, Object> params, DataFrame sample) {
        String connector = String.valueOf(conn.get("connector"));
        String tableName = ConnectionController.targetName(params, conn);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("ok", true);
        out.put("raw", Map.of("columns", sample.columns(), "rows", sample.rows()));
        Map<String, Integer> nulls = new LinkedHashMap<>();
        for (int c = 0; c < sample.columns().size(); c++) {
            int k = 0;
            for (List<String> r : sample.rows()) { String v = c < r.size() ? r.get(c) : null; if (v == null || v.isBlank()) k++; }
            nulls.put(sample.columns().get(c), k);
        }
        out.put("nulls", nulls);
        DataTransform.Spec spec = DataTransform.from(params.get("transform"));
        try {
            DataTransform.Result tr = DataTransform.apply(sample, spec);
            out.put("columns", tr.df().columns());
            out.put("rows", tr.df().rows());
            out.put("warnings", tr.warnings());
        } catch (IllegalArgumentException | RowExpression.ExprError e) {
            out.put("columns", sample.columns());
            out.put("rows", sample.rows());
            out.put("warnings", List.of());
            out.put("transformError", ConnectionController.message(e));
        }
        out.put("shown", sample.rowCount());
        out.put("tableName", tableName);
        out.put("mode", LoadScripts.mode(params));
        out.put("limit", LoadScripts.limit(params));
        out.put("sql", LoadScripts.sqlFor(connector, config, params));
        out.put("script", LoadScripts.block(String.valueOf(conn.get("name")), connector, config, params, tableName, sample.columns()));
        return out;
    }
}
