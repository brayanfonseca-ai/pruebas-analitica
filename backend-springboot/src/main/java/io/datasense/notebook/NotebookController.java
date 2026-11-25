package io.datasense.notebook;

import io.datasense.ask.AskService;
import io.datasense.auth.AccessService;
import io.datasense.auth.AuthInterceptor;
import io.datasense.auth.Permissions;
import io.datasense.auth.UserRecord;
import io.datasense.engine.DataFrame;
import io.datasense.engine.Expressions;
import io.datasense.repo.AppRepository;

import jakarta.servlet.http.HttpServletRequest;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.util.*;

/**
 * Cuadernos de análisis de una app.
 * <ul>
 *   <li>{@code GET    /api/v1/apps/{appId}/notebooks} — lista (sin celdas)</li>
 *   <li>{@code POST   /api/v1/apps/{appId}/notebooks} {name, description?, cells?} (charts:edit)</li>
 *   <li>{@code GET    /api/v1/apps/{appId}/notebooks/{id}} — con celdas</li>
 *   <li>{@code PUT    /api/v1/apps/{appId}/notebooks/{id}} {name?, description?, cells?} (dueño o administrador)</li>
 *   <li>{@code DELETE /api/v1/apps/{appId}/notebooks/{id}} (dueño o administrador)</li>
 *   <li>{@code GET    /api/v1/apps/{appId}/notebooks/schema} — tablas y columnas para escribir consultas</li>
 *   <li>{@code POST   /api/v1/apps/{appId}/notebooks/run} {kind: sql|profile|pareto|correlation|outliers, sql?, params?} — ejecuta una celda (solo lectura)</li>
 * </ul>
 * Celda: {@code {id, kind, title?, sql?, text?, params?: {table, field, dimension, measure, fields, k, where}, view?: {chart},
 * builder?: {table, dims[], metrics[{agg, field}], filters[{field, op, value}], order{by, dir}, limit}}}.
 * Los tokens de embedding no tienen acceso.
 */
@RestController
@RequestMapping("/api/v1/apps/{appId}/notebooks")
public class NotebookController {

    static final Set<String> KINDS = Set.of("sql", "profile", "pareto", "correlation", "outliers", "note");
    static final int MAX_CELLS = 80, MAX_TEXT = 20000;

    private final NotebookRepository repo;
    private final AskService ask;
    private final AppRepository apps;

    public NotebookController(NotebookRepository repo, AskService ask, AppRepository apps) {
        this.repo = repo;
        this.ask = ask;
        this.apps = apps;
    }

    /* ------------------------------ cuadernos ------------------------------ */

    @GetMapping
    public List<Map<String, Object>> list(@PathVariable String appId, HttpServletRequest req) {
        guard(appId, req);
        return repo.list(appId);
    }

    @GetMapping("/{id}")
    public Map<String, Object> get(@PathVariable String appId, @PathVariable String id, HttpServletRequest req) {
        guard(appId, req);
        return repo.get(appId, id).orElseThrow(() -> notFound(id));
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> create(@PathVariable String appId, @RequestBody Map<String, Object> body, HttpServletRequest req) {
        UserRecord me = guard(appId, req);
        requireEdit(me);
        String name = str(body.get("name")).strip();
        if (name.isEmpty()) name = "Cuaderno sin título";
        if (name.length() > 120) throw bad("El nombre admite hasta 120 caracteres.");
        String desc = body.get("description") == null ? null : str(body.get("description")).strip();
        List<Map<String, Object>> cells = body.containsKey("cells") ? cells(body.get("cells")) : List.of(starter(appId));
        return repo.create(appId, name, desc, cells, me.id(), me.name());
    }

    @PutMapping("/{id}")
    public Map<String, Object> update(@PathVariable String appId, @PathVariable String id, @RequestBody Map<String, Object> body, HttpServletRequest req) {
        UserRecord me = guard(appId, req);
        requireEdit(me);
        Map<String, Object> cur = repo.get(appId, id).orElseThrow(() -> notFound(id));
        requireOwner(me, cur);
        String name = body.containsKey("name") ? str(body.get("name")).strip() : null;
        if (name != null && name.isEmpty()) throw bad("El nombre no puede estar vacío.");
        if (name != null && name.length() > 120) throw bad("El nombre admite hasta 120 caracteres.");
        boolean descP = body.containsKey("description");
        String desc = descP && body.get("description") != null ? str(body.get("description")).strip() : null;
        List<Map<String, Object>> cells = body.containsKey("cells") ? cells(body.get("cells")) : null;
        return repo.update(appId, id, name, desc, descP, cells).orElseThrow(() -> notFound(id));
    }

    @DeleteMapping("/{id}")
    public Map<String, Object> delete(@PathVariable String appId, @PathVariable String id, HttpServletRequest req) {
        UserRecord me = guard(appId, req);
        requireEdit(me);
        Map<String, Object> cur = repo.get(appId, id).orElseThrow(() -> notFound(id));
        requireOwner(me, cur);
        repo.delete(appId, id);
        return Map.of("ok", true);
    }

    /* ------------------------------ esquema ------------------------------ */

    @GetMapping("/schema")
    public List<Map<String, Object>> schema(@PathVariable String appId, HttpServletRequest req) {
        guard(appId, req);
        List<Map<String, Object>> out = new ArrayList<>();
        for (var e : ask.frames(appId).entrySet()) {
            DataFrame df = e.getValue();
            Map<String, String> types = ask.types(appId, e.getKey()), disp = ask.displays(appId, e.getKey());
            List<Map<String, Object>> cols = new ArrayList<>();
            for (String c : df.columns()) {
                Map<String, Object> col = new LinkedHashMap<>();
                col.put("name", c);
                col.put("type", types.getOrDefault(c, df.typeOf(c)));
                if (disp.get(c) != null && !disp.get(c).equals(c)) col.put("display", disp.get(c));
                cols.add(col);
            }
            out.add(new LinkedHashMap<>(Map.of("table", e.getKey(), "rows", df.rowCount(), "columns", cols)));
        }
        return out;
    }

    /* ------------------------------ ejecutar ------------------------------ */

    @SuppressWarnings("unchecked")
    @PostMapping("/run")
    public Map<String, Object> run(@PathVariable String appId, @RequestBody Map<String, Object> body, HttpServletRequest req) {
        guard(appId, req);
        Map<String, Object> cell = body.get("cell") instanceof Map<?, ?> c ? (Map<String, Object>) c : body;
        String kind = str(cell.getOrDefault("kind", "sql")).toLowerCase(Locale.ROOT);
        Map<String, Object> p = cell.get("params") instanceof Map<?, ?> m ? (Map<String, Object>) m : Map.of();
        long t0 = System.currentTimeMillis();
        try {
            Map<String, DataFrame> frames = ask.frames(appId);
            if (frames.isEmpty()) throw bad("La aplicación aún no tiene datos cargados.");
            Map<String, Object> out = switch (kind) {
                case "sql" -> sql(str(cell.get("sql")), frames);
                case "profile" -> {
                    String t = table(p, frames), f = field(p, "field", frames.get(t), t);
                    yield NotebookStats.profile(t, frames.get(t), f, ask.types(appId, t).get(f), ask.displays(appId, t).get(f));
                }
                case "pareto" -> pareto(p, frames);
                case "correlation" -> {
                    String t = table(p, frames);
                    List<String> fs = new ArrayList<>();
                    if (p.get("fields") instanceof List<?> l) for (Object o : l) if (o != null && !str(o).isBlank()) fs.add(resolveField(str(o), frames.get(t), t));
                    yield NotebookStats.correlation(t, frames.get(t), fs, ask.types(appId, t));
                }
                case "outliers" -> {
                    String t = table(p, frames), f = field(p, "field", frames.get(t), t);
                    double k = 1.5;
                    if (p.get("k") != null) { try { k = Double.parseDouble(str(p.get("k"))); } catch (NumberFormatException e) { throw bad("k debe ser un número (1,5 = estándar; 3 = solo extremos)."); } }
                    if (k <= 0 || k > 10) throw bad("k debe estar entre 0 y 10.");
                    yield NotebookStats.outliers(t, frames.get(t), f, k);
                }
                case "note" -> throw bad("Las celdas de nota no se ejecutan.");
                default -> throw bad("Tipo de celda desconocido: «" + kind + "». Usa sql, profile, pareto, correlation u outliers.");
            };
            out.putIfAbsent("kind", kind);
            out.put("ms", System.currentTimeMillis() - t0);
            return out;
        } catch (NotebookSql.SqlError | Expressions.ExpressionError | IllegalArgumentException e) {
            throw bad(e.getMessage());
        }
    }

    private Map<String, Object> sql(String text, Map<String, DataFrame> frames) {
        if (text.length() > MAX_TEXT) throw bad("La consulta es demasiado larga (máx. " + MAX_TEXT + " caracteres).");
        NotebookSql.Result r = NotebookSql.run(text, frames);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("kind", "sql");
        out.put("table", r.table());
        out.put("columns", r.columns());
        out.put("types", r.types());
        out.put("rows", r.rows());
        out.put("row_count", r.rows().size());
        out.put("total_rows", r.totalRows());
        out.put("truncated", r.truncated());
        out.put("chart", suggest(r));
        out.put("summary", r.totalRows() + (r.totalRows() == 1 ? " fila" : " filas") + (r.truncated() ? " (se muestran " + r.rows().size() + ")" : "") + " · " + r.table());
        return out;
    }

    /** Gráfico sugerido: kpi (un valor), línea (eje temporal), barras o ninguno. */
    static Map<String, Object> suggest(NotebookSql.Result r) {
        List<Integer> dims = new ArrayList<>(), meas = new ArrayList<>();
        for (int i = 0; i < r.columns().size(); i++) (("number".equals(r.types().get(i))) ? meas : dims).add(i);
        Map<String, Object> c = new LinkedHashMap<>();
        if (r.rows().size() == 1 && dims.isEmpty() && !meas.isEmpty()) { c.put("type", "kpi"); c.put("y", meas); return c; }
        if (meas.isEmpty() || r.rows().isEmpty()) { c.put("type", "table"); return c; }
        int x = dims.isEmpty() ? -1 : dims.get(0);
        if (x < 0) { c.put("type", "table"); return c; }
        String xn = r.columns().get(x).toLowerCase(Locale.ROOT);
        boolean time = xn.matches(".*(fecha|periodo|per[ií]odo|mes|a[nñ]o|anio|year|month|date|d[ií]a|semana|week|trimestre).*");
        if (!time && !r.rows().isEmpty()) {
            Object v = r.rows().get(0).get(x);
            time = v != null && String.valueOf(v).matches("\\d{4}([-/]\\d{1,2}([-/]\\d{1,2})?)?");
        }
        c.put("type", time ? "line" : "bar");
        c.put("x", x);
        c.put("y", meas.subList(0, Math.min(3, meas.size())));
        return c;
    }

    private Map<String, Object> pareto(Map<String, Object> p, Map<String, DataFrame> frames) {
        String t = table(p, frames);
        String dim = field(p, "dimension", frames.get(t), t);
        String measure = str(p.get("measure")).strip();
        if (measure.isEmpty()) measure = "COUNT(*)";
        String where = str(p.get("where")).strip();
        String sql = "SELECT " + NotebookSql.quote(dim) + " AS d, " + measure + " AS v FROM " + NotebookSql.quote(t)
                + (where.isEmpty() ? "" : " WHERE " + where) + " GROUP BY 1 LIMIT " + NotebookSql.MAX_LIMIT;
        NotebookSql.Result r = NotebookSql.run(sql, frames);
        String label = str(p.get("label")).strip();
        Map<String, Object> out = NotebookStats.pareto(t, dim, label.isEmpty() ? measure : label, r.rows());
        out.put("sql", sql);
        return out;
    }

    /* ------------------------------ validación ------------------------------ */

    private String table(Map<String, Object> p, Map<String, DataFrame> frames) {
        String t = str(p.get("table")).strip();
        if (t.isEmpty()) {
            // sin tabla: la más grande
            return frames.entrySet().stream().max(Comparator.comparingInt(e -> e.getValue().rowCount())).map(Map.Entry::getKey).orElseThrow();
        }
        if (frames.containsKey(t)) return t;
        for (String k : frames.keySet()) if (k.equalsIgnoreCase(t)) return k;
        throw bad("La tabla «" + t + "» no existe. Tablas: " + String.join(", ", frames.keySet()) + ".");
    }

    private String field(Map<String, Object> p, String key, DataFrame df, String table) {
        String f = str(p.get(key)).strip();
        if (f.isEmpty()) throw bad("Elige el campo (" + key + ").");
        return resolveField(f, df, table);
    }

    private String resolveField(String f, DataFrame df, String table) {
        if (df.indexOf(f) >= 0) return f;
        for (String c : df.columns()) if (c.equalsIgnoreCase(f)) return c;
        throw bad("El campo «" + f + "» no existe en " + table + ".");
    }

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> cells(Object raw) {
        if (!(raw instanceof List<?> l)) throw bad("«cells» debe ser una lista de celdas.");
        if (l.size() > MAX_CELLS) throw bad("Un cuaderno admite hasta " + MAX_CELLS + " celdas.");
        List<Map<String, Object>> out = new ArrayList<>();
        Set<String> ids = new HashSet<>();
        for (Object o : l) {
            if (!(o instanceof Map<?, ?> m)) throw bad("Cada celda debe ser un objeto {kind, …}.");
            Map<String, Object> c = new LinkedHashMap<>();
            String kind = str(((Map<String, Object>) m).getOrDefault("kind", "sql")).toLowerCase(Locale.ROOT);
            if (!KINDS.contains(kind)) throw bad("Tipo de celda desconocido: «" + kind + "».");
            String id = str(m.get("id")).strip();
            if (id.isEmpty() || !ids.add(id)) { id = "c" + UUID.randomUUID().toString().substring(0, 8); ids.add(id); }
            c.put("id", id);
            c.put("kind", kind);
            for (String k : List.of("title", "sql", "text")) {
                if (m.get(k) == null) continue;
                String v = str(m.get(k));
                if (v.length() > MAX_TEXT) throw bad("La celda «" + k + "» supera " + MAX_TEXT + " caracteres.");
                c.put(k, v);
            }
            if (m.get("params") instanceof Map<?, ?> pm) c.put("params", pm);
            if (m.get("view") instanceof Map<?, ?> vm) c.put("view", vm);
            // Constructor visual de la celda SQL ({table, dims, metrics, filters, order, limit}); el SQL generado va en «sql».
            if (m.get("builder") instanceof Map<?, ?> bm) c.put("builder", bm);
            out.add(c);
        }
        return out;
    }

    /** Primer contenido de un cuaderno nuevo: una nota y una consulta sobre la tabla principal. */
    private Map<String, Object> starter(String appId) {
        Map<String, DataFrame> fr = ask.frames(appId);
        String t = fr.entrySet().stream().max(Comparator.comparingInt(e -> e.getValue().rowCount())).map(Map.Entry::getKey).orElse(null);
        Map<String, Object> c = new LinkedHashMap<>();
        c.put("id", "c" + UUID.randomUUID().toString().substring(0, 8));
        c.put("kind", "sql");
        c.put("title", "Vista rápida");
        c.put("sql", t == null ? "SELECT 1" : "SELECT *\nFROM " + NotebookSql.quote(t) + "\nLIMIT 100");
        return c;
    }

    private UserRecord guard(String appId, HttpServletRequest req) {
        if (req.getAttribute(AuthInterceptor.EMBED_ATTR) != null) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Los cuadernos no están disponibles en un embed.");
        if (apps.getApp(appId).isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "App no encontrada: " + appId);
        return AccessService.current(req);
    }

    private static void requireEdit(UserRecord me) {
        if (me == null || !me.has(Permissions.NOTEBOOKS_EDIT)) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Guardar cuadernos requiere el permiso «Guardar cuadernos» (notebooks:edit).");
    }

    private static void requireOwner(UserRecord me, Map<String, Object> nb) {
        if (me.isAdmin() || Objects.equals(me.id(), nb.get("owner_id"))) return;
        String owner = nb.get("owner_name") == null ? "" : " de " + nb.get("owner_name");
        throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Este cuaderno es" + owner + ": solo su autor o un administrador puede cambiarlo. Duplícalo para tener tu copia.");
    }

    private static ResponseStatusException bad(String m) { return new ResponseStatusException(HttpStatus.BAD_REQUEST, m); }
    private static ResponseStatusException notFound(String id) { return new ResponseStatusException(HttpStatus.NOT_FOUND, "Cuaderno no encontrado: " + id); }
    private static String str(Object o) { return o == null ? "" : String.valueOf(o); }
}
