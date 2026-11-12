package io.datasense.web;

import io.datasense.auth.AccessService;
import io.datasense.auth.Permissions;
import io.datasense.auth.UserRecord;
import io.datasense.auth.UserRepository;
import io.datasense.engine.DataFrame;
import io.datasense.engine.connect.ConnectionExecutor;
import io.datasense.engine.connect.ConnectionExecutors;
import io.datasense.engine.connect.LoadScripts;
import io.datasense.engine.transform.DataTransform;
import io.datasense.engine.transform.RowExpression;
import io.datasense.repo.ConnectionRepository;

import jakarta.servlet.http.HttpServletRequest;

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
    private final UserRepository users;

    public GlobalConnectionController(ConnectionRepository repo, ConnectionExecutors executors, UserRepository users) {
        this.repo = repo;
        this.executors = executors;
        this.users = users;
    }

    private static UserRecord me(HttpServletRequest req) { return AccessService.current(req); }

    /** Conexiones del usuario: las que creó y las que le compartieron (nunca las privadas de otros, ni siquiera siendo admin). */
    @GetMapping
    public List<Map<String, Object>> list(HttpServletRequest req) {
        return repo.listFor(me(req).id());
    }

    /** Personas a las que se les puede compartir una conexión: activas, con permiso de conexiones, distintas de uno mismo. */
    @GetMapping("/share-targets")
    public List<Map<String, Object>> shareTargets(HttpServletRequest req) {
        String myId = me(req).id();
        return users.list().stream()
                .filter((u) -> u.active() && !u.id().equals(myId) && u.has(Permissions.CONNECTIONS))
                .map((u) -> {
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("id", u.id());
                    m.put("name", u.name());
                    m.put("email", u.email());
                    m.put("role", u.role());
                    return m;
                }).toList();
    }

    @SuppressWarnings("unchecked")
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> create(HttpServletRequest req, @RequestBody Map<String, Object> body) {
        String name = str(body.get("name")).trim();
        String connector = str(body.get("connector"));
        Map<String, Object> config = body.get("config") instanceof Map<?, ?> m ? (Map<String, Object>) m : Map.of();
        if (name.isBlank()) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "El nombre de la conexión es obligatorio.");
        if (connector.isBlank()) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Debe elegir un conector.");
        List<String> missing = ConnectionController.missingFields(connector, config);
        if (!missing.isEmpty())
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Faltan campos obligatorios: " + String.join(", ", missing));
        return repo.create(me(req).id(), name, connector, str(body.get("space")), str(body.get("description")), config);
    }

    /** Prueba de conexión REAL (no guarda nada). Errores de la fuente → {ok:false, message} con 200. */
    @SuppressWarnings("unchecked")
    @PostMapping("/test")
    public Map<String, Object> test(@RequestBody Map<String, Object> body) {
        return ConnectionController.runTest(executors, body);
    }

    /** Edita nombre, descripción, espacio o config (solo el dueño). Un secreto enmascarado conserva su valor. */
    @SuppressWarnings("unchecked")
    @PutMapping("/{id}")
    public Map<String, Object> update(HttpServletRequest req, @PathVariable String id, @RequestBody Map<String, Object> body) {
        ownerOnly(req, id);
        String name = body.containsKey("name") ? str(body.get("name")).trim() : null;
        if (name != null && name.isBlank()) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "El nombre no puede estar vacío.");
        Map<String, Object> cfg = body.get("config") instanceof Map<?, ?> m ? (Map<String, Object>) m : null;
        return repo.update(me(req).id(), id, name,
                        body.containsKey("space") ? str(body.get("space")) : null,
                        body.containsKey("description") ? str(body.get("description")) : null, cfg)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Conexión no encontrada: " + id));
    }

    /** Elimina la conexión para todos con quienes se compartió (solo el dueño). Las tablas ya cargadas se conservan. */
    @DeleteMapping("/{id}")
    public Map<String, Object> delete(HttpServletRequest req, @PathVariable String id) {
        ownerOnly(req, id);
        repo.delete(id);
        return Map.of("ok", true);
    }

    /** Comparte la conexión: {user_ids: [...]} reemplaza la lista. Solo el dueño; solo con personas que puedan usar conexiones. */
    @PutMapping("/{id}/shares")
    public Map<String, Object> shares(HttpServletRequest req, @PathVariable String id, @RequestBody Map<String, Object> body) {
        ownerOnly(req, id);
        List<String> ids = new ArrayList<>();
        if (body.get("user_ids") instanceof List<?> l) for (Object o : l) ids.add(String.valueOf(o));
        String myId = me(req).id();
        for (String uid : ids) {
            if (uid.equals(myId)) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Ya eres el dueño de esta conexión.");
            UserRecord u = users.get(uid).orElseThrow(() -> new ResponseStatusException(HttpStatus.BAD_REQUEST, "Usuario no encontrado: " + uid));
            if (!u.active() || !u.has(Permissions.CONNECTIONS))
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, u.name() + " no puede usar conexiones (rol o permiso).");
        }
        repo.setShares(id, ids, myId);
        return Map.of("ok", true, "shared_with", repo.sharedWith(id));
    }

    private void ownerOnly(HttpServletRequest req, String id) {
        if (!repo.exists(id)) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Conexión no encontrada: " + id);
        if (repo.getFor(me(req).id(), id).isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Conexión no encontrada: " + id);
        if (!repo.isOwner(me(req).id(), id))
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Solo el dueño de la conexión puede cambiarla, compartirla o eliminarla.");
    }

    private static String str(Object o) { return o == null ? "" : String.valueOf(o); }

    private Map<String, Object> raw(HttpServletRequest req, String id) {
        return repo.getRawFor(me(req).id(), id).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Conexión no encontrada: " + id));
    }

    @SuppressWarnings("unchecked")
    @PostMapping("/{id}/browse")
    public Map<String, Object> browse(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> body) {
        Map<String, Object> conn = raw(req, id);
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
    public Map<String, Object> preview(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> body) {
        Map<String, Object> conn = raw(req, id);
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
    public Map<String, Object> transform(HttpServletRequest req, @PathVariable String id, @RequestBody Map<String, Object> body) {
        Map<String, Object> conn = raw(req, id);
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
    public Map<String, Object> parseScript(HttpServletRequest req, @PathVariable String id, @RequestBody Map<String, Object> body) {
        Map<String, Object> conn = raw(req, id);
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
