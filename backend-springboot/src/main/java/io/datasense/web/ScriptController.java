package io.datasense.web;

import io.datasense.engine.DataFrame;
import io.datasense.engine.FieldOverrides;
import io.datasense.engine.Profiler;
import io.datasense.engine.TableStore;
import io.datasense.engine.connect.ConnectionExecutor;
import io.datasense.engine.connect.ConnectionExecutors;
import io.datasense.engine.connect.LoadScripts;
import io.datasense.model.AppModels.ColumnProfile;
import io.datasense.repo.AppRepository;
import io.datasense.repo.ConnectionRepository;
import io.datasense.repo.FieldOverrideRepository;
import io.datasense.repo.Ids;
import io.datasense.repo.TableRepository;

import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import io.datasense.repo.ScriptVersionRepository;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Editor de carga: get/put del script y ejecución (rebuild + log).
 *
 * <p>Las tablas cargadas desde una conexión ("Conexiones realizadas") aparecen
 * en el script auto-generado con su bloque {@code LIB CONNECT TO} + {@code SQL
 * SELECT} (o {@code FROM [lib://…]} para S3), y al ejecutar la carga se vuelven
 * a extraer de su origen con los mismos parámetros.
 */
@RestController
@RequestMapping("/api/v1/apps/{appId}")
public class ScriptController {

    private final AppRepository apps;
    private final TableRepository tables;
    private final TableStore store;
    private final FieldOverrideRepository fieldOverrides;
    private final ConnectionRepository connections;
    private final ConnectionExecutors executors;
    private final JdbcTemplate jdbc;
    private final ScriptVersionRepository versions;

    public ScriptController(AppRepository apps, TableRepository tables, TableStore store,
                            FieldOverrideRepository fieldOverrides, ConnectionRepository connections,
                            ConnectionExecutors executors, JdbcTemplate jdbc, ScriptVersionRepository versions) {
        this.versions = versions;
        this.apps = apps;
        this.tables = tables;
        this.store = store;
        this.fieldOverrides = fieldOverrides;
        this.connections = connections;
        this.executors = executors;
        this.jdbc = jdbc;
    }

    private void requireApp(String appId) {
        apps.getApp(appId).orElseThrow(() ->
                new ResponseStatusException(HttpStatus.NOT_FOUND, "App no encontrada: " + appId));
    }

    /** Genera un script QDF a partir de las tablas cargadas. */
    @SuppressWarnings("unchecked")
    private String generated(String appId) {
        StringBuilder sb = new StringBuilder();
        sb.append("///$tab Principal\n");
        sb.append("SET ThousandSep='.';\nSET DecimalSep=',';\n\n");
        Map<String, Map<String, Object>> sources = connections.tableSources(appId);
        for (Map<String, Object> row : tables.listTables(appId)) {
            String name = (String) row.get("name");
            String tableId = (String) row.get("id");
            DataFrame df = store.load(appId, (String) row.get("id"));
            Map<String, Object> src = sources.get(tableId);
            if (src != null) {
                // Extracción desde una conexión: mismo bloque que mostró el selector de datos.
                Map<String, Object> config = connections.getRaw((String) src.get("conn_id"))
                        .map(c -> (Map<String, Object>) c.get("config")).orElse(Map.of());
                sb.append(LoadScripts.block((String) src.get("conn_name"), (String) src.get("connector"), config,
                        (Map<String, Object>) src.get("params"), name, df.columns())).append("\n");
                continue;
            }
            // Refleja la preparación visual: omite columnas ocultas y aplica el
            // nombre efectivo (alias AS cuando hay renombre). Fuente de nombres
            // originales = df.columns(); nombres efectivos = FieldOverrides.
            List<Map<String, Object>> overrides = fieldOverrides.list(appId, tableId);
            FieldOverrides.Effective eff = FieldOverrides.apply(df, overrides);
            sb.append(name).append(":\nLOAD\n");
            for (int i = 0; i < eff.size(); i++) {
                String source = df.columns().get(eff.sourceIndexAt(i));
                String exposed = eff.names().get(i);
                sb.append("    [").append(source).append("]");
                if (!source.equals(exposed)) {
                    sb.append(" AS [").append(exposed).append("]");
                }
                sb.append(i < eff.size() - 1 ? ",\n" : "\n");
            }
            sb.append("FROM [lib://DataFiles/").append(name).append(".csv]\n")
              .append("(txt, utf8, embedded labels, delimiter is ',');\n\n");
        }
        return sb.toString();
    }

    @GetMapping("/script")
    public Map<String, Object> get(@PathVariable String appId) {
        requireApp(appId);
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT text FROM scripts WHERE app_id = ?", appId);
        if (!rows.isEmpty()) {
            return Map.of("app_id", appId, "text", rows.get(0).get("text"), "is_custom", true);
        }
        return Map.of("app_id", appId, "text", generated(appId), "is_custom", false);
    }

    /**
     * Guarda el script. Si cambió respecto a la versión principal, crea una versión nueva (control de versiones):
     * body {text, message?}. Devuelve además {version, version_created, version_message}.
     */
    @PutMapping("/script")
    public Map<String, Object> put(@PathVariable String appId, @RequestBody Map<String, String> body,
                                   jakarta.servlet.http.HttpServletRequest request) {
        requireApp(appId);
        String text = body.getOrDefault("text", "");
        io.datasense.auth.UserRecord user = io.datasense.auth.AccessService.current(request);
        List<Map<String, Object>> cur = jdbc.queryForList("SELECT text FROM scripts WHERE app_id = ?", appId);
        String previous = cur.isEmpty() ? null : String.valueOf(cur.get(0).get("text"));
        writeScript(appId, text);
        ScriptVersionRepository.Saved v = versions.record(appId, text, body.get("message"),
                user == null ? null : user.id(), user == null ? null : user.name(), previous);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("app_id", appId);
        out.put("text", text);
        out.put("is_custom", true);
        out.put("version", v.version());
        out.put("version_created", v.created());
        out.put("version_message", v.message());
        return out;
    }

    private void writeScript(String appId, String text) {
        int n = jdbc.update("UPDATE scripts SET text = ?, updated_at = ? WHERE app_id = ?", text, Ids.now(), appId);
        if (n == 0) jdbc.update("INSERT INTO scripts (app_id, text, updated_at) VALUES (?, ?, ?)", appId, text, Ids.now());
    }

    /* ---------------- Control de versiones del script ---------------- */

    /** Historial (la primera es la principal / HEAD). */
    @GetMapping("/script/versions")
    public List<Map<String, Object>> versions(@PathVariable String appId) {
        requireApp(appId);
        return versions.list(appId);
    }

    /** Una versión con su texto y el diff contra la anterior ({op, text} por línea). */
    @GetMapping("/script/versions/{version}")
    public Map<String, Object> version(@PathVariable String appId, @PathVariable int version) {
        requireApp(appId);
        Map<String, Object> v = versions.get(appId, version).orElseThrow(() ->
                new ResponseStatusException(HttpStatus.NOT_FOUND, "Versión no encontrada: v" + version));
        String prev = versions.get(appId, version - 1).map(p -> String.valueOf(p.get("text"))).orElse("");
        v.put("diff", ScriptVersionRepository.diff(prev, String.valueOf(v.get("text"))));
        v.put("is_head", versions.latest(appId).map(h -> ((Number) h.get("version")).intValue() == version).orElse(false));
        return v;
    }

    /** Restaura una versión: no borra nada, crea una versión nueva con ese contenido y la deja como principal. */
    @PostMapping("/script/versions/{version}/restore")
    public Map<String, Object> restore(@PathVariable String appId, @PathVariable int version,
                                       jakarta.servlet.http.HttpServletRequest request) {
        requireApp(appId);
        Map<String, Object> v = versions.get(appId, version).orElseThrow(() ->
                new ResponseStatusException(HttpStatus.NOT_FOUND, "Versión no encontrada: v" + version));
        String text = String.valueOf(v.get("text"));
        io.datasense.auth.UserRecord user = io.datasense.auth.AccessService.current(request);
        writeScript(appId, text);
        ScriptVersionRepository.Saved s = versions.record(appId, text, "Restaurada desde v" + version,
                user == null ? null : user.id(), user == null ? null : user.name(), null);
        return Map.of("ok", true, "text", text, "version", s.version(), "version_created", s.created(), "restored_from", version);
    }

    /**
     * Bloque de una tabla dentro del script completo: desde su cabecera {@code [nombre]:} hasta la siguiente
     * cabecera, {@code LIB CONNECT} o {@code ///$tab}. null si la tabla no aparece (o su cabecera está comentada).
     */
    private static String blockFor(String script, String table) {
        String[] lines = script.split("\\r?\\n");
        java.util.regex.Pattern head = java.util.regex.Pattern.compile(
                "^\\s*(?:\\[" + java.util.regex.Pattern.quote(table) + "\\]|" + java.util.regex.Pattern.quote(table) + ")\\s*:\\s*$",
                java.util.regex.Pattern.CASE_INSENSITIVE);
        java.util.regex.Pattern other = java.util.regex.Pattern.compile("^\\s*(\\[[^\\]]+\\]\\s*:\\s*$|LIB\\s+CONNECT\\b|///\\$tab\\b)",
                java.util.regex.Pattern.CASE_INSENSITIVE);
        int start = -1;
        for (int i = 0; i < lines.length; i++) if (head.matcher(lines[i]).matches()) { start = i; break; }
        if (start < 0) return null;
        StringBuilder sb = new StringBuilder(lines[start]).append('\n');
        for (int i = start + 1; i < lines.length; i++) {
            if (other.matcher(lines[i]).find()) break;
            sb.append(lines[i]).append('\n');
        }
        return sb.toString();
    }

    /**
     * Aplica el script guardado a los parámetros de una tabla cargada por conexión: columnas comentadas con
     * {@code //} (o quitadas del LOAD) no se cargan, renombres AS, WHERE y DISTINCT. Las columnas excluidas se
     * conservan en el spec para poder volver a incluirlas descomentándolas. null si no hay nada que aplicar.
     */
    @SuppressWarnings("unchecked")
    private Map<String, Object> paramsFromScript(String script, String table, Map<String, Object> params, String appId, String tableId) {
        if (script == null) return null;
        String block = blockFor(script, table);
        if (block == null) return null;
        List<String> known = new ArrayList<>(io.datasense.engine.transform.DataTransform.from(params.get("transform")).sources());
        if (known.isEmpty()) {
            try { known.addAll(store.load(appId, tableId).columns()); } catch (Exception ignored) { /* sin datos previos */ }
        }
        // Columnas mencionadas en el bloque (también las comentadas) que aún no se conocían.
        java.util.regex.Matcher fm = java.util.regex.Pattern.compile("^\\s*(?://\\s*)?\\[([^\\]]+)\\]").matcher("");
        for (String line : block.split("\\r?\\n")) {
            if (fm.reset(line).find() && !line.trim().endsWith(":") && !known.contains(fm.group(1))) known.add(fm.group(1));
        }
        // Si se comentó el ÚLTIMO campo («// [x];»), su «;» cerraba el LOAD: se conserva como terminador.
        StringBuilder fixed = new StringBuilder();
        for (String line : block.split("\\r?\\n")) {
            String t = line.trim();
            if (t.startsWith("//") && !t.startsWith("///") && t.endsWith(";")) fixed.append(line).append("\n;\n");
            else fixed.append(line).append('\n');
        }
        var parsed = io.datasense.engine.transform.DataTransform.parseBlock(fixed.toString(), known);
        Map<String, Object> out = new LinkedHashMap<>(params);
        out.put("transform", parsed.spec().toMap());
        return out;
    }

    @SuppressWarnings("unchecked")
    @PostMapping("/script/run")
    public Map<String, Object> run(@PathVariable String appId, jakarta.servlet.http.HttpServletRequest request) {
        requireApp(appId);
        io.datasense.auth.UserRecord user = io.datasense.auth.AccessService.current(request);
        List<String> log = new ArrayList<>();
        List<Map<String, Object>> summary = new ArrayList<>();
        log.add("Reconstruyendo el modelo desde las tablas cargadas…");
        Map<String, Map<String, Object>> sources = connections.tableSources(appId);
        List<Map<String, Object>> saved = jdbc.queryForList("SELECT text FROM scripts WHERE app_id = ?", appId);
        String script = saved.isEmpty() ? null : String.valueOf(saved.get(0).get("text"));
        int total = 0;
        for (Map<String, Object> row : tables.listTables(appId)) {
            String name = (String) row.get("name");
            String tableId = (String) row.get("id");
            Map<String, Object> src = sources.get(tableId);
            if (src != null) {
                // Re-extracción real desde la conexión de origen (mismos parámetros).
                String connName = (String) src.get("conn_name");
                // Solo se usa una conexión propia o compartida contigo: las conexiones son privadas de su dueño.
                var conn = connections.getRawFor(user.id(), (String) src.get("conn_id"));
                ConnectionExecutor exec = executors.get((String) src.get("connector"));
                if (conn.isEmpty() && connections.exists((String) src.get("conn_id"))) {
                    log.add("ADVERTENCIA: no tienes acceso a la conexión '" + connName + "' (es privada de otra persona); " + name
                            + " conserva los datos de la última carga. Pide a su dueño que te la comparta.");
                } else if (conn.isEmpty() || exec == null) {
                    log.add("ADVERTENCIA: la conexión '" + connName + "' ya no existe; " + name + " conserva los datos de la última carga.");
                } else {
                    log.add("LIB CONNECT TO '" + connName + "' → extrayendo " + name + "…");
                    Map<String, Object> params = (Map<String, Object>) src.get("params");
                    Map<String, Object> fromScript = null;
                    try {
                        fromScript = paramsFromScript(script, name, params, appId, tableId);
                    } catch (IllegalArgumentException e) {
                        log.add("ADVERTENCIA: el bloque de " + name + " en el script no se pudo interpretar (" + e.getMessage()
                                + "); se usan los parámetros de la última carga.");
                    }
                    if (fromScript != null) {
                        params = fromScript;
                        long off = ((List<Map<String, Object>>) ((Map<String, Object>) params.get("transform")).getOrDefault("columns", List.of()))
                                .stream().filter(c -> Boolean.FALSE.equals(c.get("include"))).count();
                        if (off > 0) log.add("  · " + name + ": " + off + " columna(s) comentada(s) o quitada(s) en el script no se cargan.");
                    }
                    try {
                        var res = io.datasense.engine.connect.Extraction.load(exec, (Map<String, Object>) conn.get().get("config"), params);
                        if (fromScript != null) connections.saveTableSource(tableId, appId, (String) src.get("conn_id"), connName,
                                (String) src.get("connector"), params);
                        DataFrame fresh = res == null ? null : res.df();
                        if (res != null) res.warnings().forEach(w -> log.add("  · " + name + ": " + w));
                        if (fresh != null && !fresh.columns().isEmpty()) {
                            store.save(appId, tableId, fresh);
                            List<ColumnProfile> profiles = new ArrayList<>();
                            for (int c = 0; c < fresh.columns().size(); c++)
                                profiles.add(Profiler.profile(fresh.columns().get(c), fresh.columnValues(c)));
                            tables.replaceColumns(tableId, profiles);
                        }
                    } catch (Exception e) {
                        log.add("ADVERTENCIA: no se pudo recargar " + name + " desde '" + connName + "': "
                                + ConnectionController.message(e) + " (se conservan los datos anteriores).");
                    }
                }
            }
            DataFrame df = store.load(appId, tableId);
            int rows = df.rowCount();
            total += rows;
            log.add(String.format("LOAD %s: %d filas, %d campos.", name, rows, df.columns().size()));
            summary.add(Map.of("table", name, "rows", rows, "fields", df.columns()));
        }
        log.add(String.format("Listo. %d tabla(s), %d filas en total.", summary.size(), total));
        return Map.of("ok", true, "log", log, "tables", summary);
    }
}
