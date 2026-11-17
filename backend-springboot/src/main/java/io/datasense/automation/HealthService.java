package io.datasense.automation;

import io.datasense.engine.DataFrame;
import io.datasense.engine.Profiler;
import io.datasense.engine.TableStore;
import io.datasense.repo.TableRepository;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.time.*;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * <b>Salud de datos</b>: revisa cada tabla de la app y devuelve un puntaje 0-100 con los problemas encontrados,
 * ordenados por gravedad (critical · warning · info) y con una recomendación:
 * <ul>
 *   <li>tabla vacía o que perdió muchas filas respecto a la carga anterior ({@code table_loads});</li>
 *   <li>columnas totalmente vacías, con muchos vacíos o con un único valor;</li>
 *   <li>filas duplicadas;</li>
 *   <li>columnas casi numéricas con valores que no son números (se tratarían como texto);</li>
 *   <li>datos viejos: la fecha/periodo más reciente es antigua;</li>
 *   <li>carga programada que falló o que no corre hace rato.</li>
 * </ul>
 */
@Service
public class HealthService {

    private final JdbcTemplate jdbc;
    private final TableRepository tables;
    private final TableStore store;

    public HealthService(JdbcTemplate jdbc, TableRepository tables, TableStore store) {
        this.jdbc = jdbc;
        this.tables = tables;
        this.store = store;
    }

    private static final Pattern YM = Pattern.compile("^(\\d{4})[-/](\\d{1,2})(?:[-/](\\d{1,2}))?");

    public Map<String, Object> health(String appId) {
        List<Map<String, Object>> issues = new ArrayList<>();
        List<Map<String, Object>> outTables = new ArrayList<>();
        LocalDate today = LocalDate.now();

        for (Map<String, Object> row : tables.listTables(appId)) {
            String name = (String) row.get("name");
            DataFrame df = store.load(appId, (String) row.get("id"));
            int n = df.rowCount();
            Map<String, Object> t = new LinkedHashMap<>();
            t.put("table", name);
            t.put("rows", n);
            t.put("columns", df.columns().size());

            // historial de cargas: última y anterior
            List<Map<String, Object>> loads = jdbc.queryForList(
                    "SELECT rows, loaded_at, trigger FROM table_loads WHERE app_id = ? AND table_name = ? ORDER BY loaded_at DESC LIMIT 2", appId, name);
            t.put("last_load", loads.isEmpty() ? row.get("created_at") : loads.get(0).get("loaded_at"));
            if (loads.size() == 2) {
                int prev = ((Number) loads.get(1).get("rows")).intValue();
                t.put("previous_rows", prev);
                if (prev > 0) {
                    double change = (n - prev) * 100.0 / prev;
                    t.put("rows_change_pct", Math.round(change * 10) / 10.0);
                    if (change <= -50) add(issues, "critical", name, null, "Perdió " + pct(-change) + " de sus filas en la última carga (" + prev + " → " + n + ").",
                            "Revisa el origen o los filtros del script: puede ser una extracción incompleta.");
                    else if (change <= -20) add(issues, "warning", name, null, "Tiene " + pct(-change) + " menos filas que en la carga anterior (" + prev + " → " + n + ").",
                            "Confirma si la caída es esperada.");
                }
            }
            if (n == 0) {
                add(issues, "critical", name, null, "La tabla está vacía.", "Vuelve a cargarla o revisa la conexión de origen.");
                t.put("score", 0);
                outTables.add(t);
                continue;
            }

            // filas duplicadas
            Set<List<String>> seen = new HashSet<>();
            int dup = 0;
            for (List<String> r : df.rows()) if (!seen.add(r)) dup++;
            t.put("duplicate_rows", dup);
            if (dup > 0) add(issues, dup * 100.0 / n >= 5 ? "warning" : "info", name, null,
                    dup + " fila(s) duplicada(s) (" + pct(dup * 100.0 / n) + ").", "Si no deberían repetirse, usa «Quitar duplicados» al cargar.");

            // columnas
            List<Map<String, Object>> cols = new ArrayList<>();
            List<String> constant = new ArrayList<>();
            LocalDate newest = null; String newestCol = null;
            for (int c = 0; c < df.columns().size(); c++) {
                String col = df.columns().get(c);
                List<String> vals = df.columnValues(c);
                int empty = 0, numeric = 0;
                Set<String> distinct = new HashSet<>();
                LocalDate colMax = null;
                for (String v : vals) {
                    if (v == null || v.isBlank()) { empty++; continue; }
                    if (distinct.size() <= 2) distinct.add(v);
                    if (Profiler.isNumeric(v)) numeric++;
                    LocalDate d = parseDate(v);
                    if (d != null && (colMax == null || d.isAfter(colMax))) colMax = d;
                }
                int filled = n - empty;
                double emptyPct = empty * 100.0 / n;
                Map<String, Object> cm = new LinkedHashMap<>();
                cm.put("name", col);
                cm.put("type", df.typeOf(col));
                cm.put("empty_pct", Math.round(emptyPct * 10) / 10.0);
                cols.add(cm);
                if (filled == 0) add(issues, "warning", name, col, "La columna está completamente vacía.", "Quítala del script (coméntala con //) para no cargarla.");
                else if (emptyPct >= 50) add(issues, "warning", name, col, pct(emptyPct) + " de los valores están vacíos.", "Rellena los vacíos al cargar o revisa el origen.");
                else if (emptyPct >= 20) add(issues, "info", name, col, pct(emptyPct) + " de los valores están vacíos.", null);
                if (filled > 10 && distinct.size() == 1) constant.add(col);
                if (filled > 20 && numeric < filled && numeric >= filled * 0.8)
                    add(issues, "warning", name, col, (filled - numeric) + " valor(es) no numérico(s) en una columna casi numérica.",
                            "Se trata como texto y no se puede sumar: corrige esos valores o fuerza el tipo número en el Gestor de datos.");
                // fecha más reciente (solo columnas de fecha / periodo)
                if (colMax != null && !colMax.isAfter(today.plusYears(1)) && looksTime(col, df.typeOf(col)) && (newest == null || colMax.isAfter(newest))) {
                    newest = colMax; newestCol = col;
                }
            }
            t.put("columns_detail", cols);
            if (!constant.isEmpty()) add(issues, "info", name, constant.size() == 1 ? constant.get(0) : null,
                    (constant.size() == 1 ? "La columna tiene" : constant.size() + " columnas tienen") + " un único valor en todas las filas"
                            + (constant.size() == 1 ? "." : ": " + String.join(", ", constant) + "."),
                    "No sirven para filtrar ni agrupar; puedes quitarlas del script.");
            if (newest != null) {
                t.put("newest_date", newest.toString());
                t.put("newest_column", newestCol);
                long days = Duration.between(newest.atStartOfDay(), today.atStartOfDay()).toDays();
                if (days > 120) add(issues, "warning", name, newestCol, "Los datos más recientes son del " + newest + " (hace " + days + " días).",
                        "Si deberían estar al día, programa la carga o revisa el origen.");
                else if (days > 45) add(issues, "info", name, newestCol, "Los datos más recientes son del " + newest + " (hace " + days + " días).", null);
            }
            outTables.add(t);
        }

        // carga programada
        List<Map<String, Object>> sch = jdbc.queryForList("SELECT * FROM schedules WHERE app_id = ?", appId);
        Map<String, Object> schedule = sch.isEmpty() ? null : sch.get(0);
        if (schedule != null && AutomationService.toInt(schedule.get("enabled")) == 1) {
            if ("fail".equals(schedule.get("last_status")))
                add(issues, "critical", null, null, "La última carga programada falló: " + schedule.get("last_message"), "Abre «Carga programada» y pulsa «Ejecutar ahora» para ver el detalle.");
            else if ("warn".equals(schedule.get("last_status")))
                add(issues, "warning", null, null, "La última carga programada terminó con advertencias: " + schedule.get("last_message"), null);
            Object next = schedule.get("next_run_at");
            if (next != null) {
                try {
                    if (Instant.parse(String.valueOf(next)).isBefore(Instant.now().minus(Duration.ofMinutes(10))))
                        add(issues, "warning", null, null, "La carga programada está atrasada (debía correr " + next + ").", "Revisa que el servidor esté encendido.");
                } catch (RuntimeException ignored) {}
            }
        } else if (!outTables.isEmpty()) {
            add(issues, "info", null, null, "La app no tiene carga programada: los datos solo se actualizan al cargarlos a mano.", "Programa la carga en «Carga programada».");
        }

        // puntaje: cada crítico resta 25; las advertencias, 8 c/u (máx. 48); los avisos, 2 c/u (máx. 10)
        long nc = issues.stream().filter(i -> "critical".equals(i.get("severity"))).count();
        long nw = issues.stream().filter(i -> "warning".equals(i.get("severity"))).count();
        long ni = issues.size() - nc - nw;
        int score = (int) Math.max(0, 100 - nc * 25 - Math.min(48, nw * 8) - Math.min(10, ni * 2));
        issues.sort(Comparator.comparingInt(i -> switch (String.valueOf(i.get("severity"))) { case "critical" -> 0; case "warning" -> 1; default -> 2; }));
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("score", outTables.isEmpty() ? null : score);
        out.put("status", outTables.isEmpty() ? "sin_datos" : score >= 85 ? "buena" : score >= 60 ? "regular" : "mala");
        out.put("checked_at", OffsetDateTime.now().toString());
        out.put("tables", outTables);
        out.put("issues", issues);
        out.put("counts", Map.of(
                "critical", issues.stream().filter(i -> "critical".equals(i.get("severity"))).count(),
                "warning", issues.stream().filter(i -> "warning".equals(i.get("severity"))).count(),
                "info", issues.stream().filter(i -> "info".equals(i.get("severity"))).count()));
        return out;
    }

    private static boolean looksTime(String col, String type) {
        String n = col.toLowerCase(Locale.ROOT);
        return "date".equals(type) || n.contains("fecha") || n.contains("periodo") || n.contains("date") || n.contains("period");
    }

    static LocalDate parseDate(String v) {
        Matcher m = YM.matcher(v.trim());
        if (!m.find()) return null;
        try {
            int y = Integer.parseInt(m.group(1)), mo = Integer.parseInt(m.group(2));
            int d = m.group(3) == null ? 1 : Integer.parseInt(m.group(3));
            if (y < 1900 || y > 2200 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
            return LocalDate.of(y, mo, Math.min(d, YearMonth.of(y, mo).lengthOfMonth()));
        } catch (RuntimeException e) { return null; }
    }

    private static String pct(double v) { return String.format(Locale.forLanguageTag("es-CO"), "%.1f %%", v); }

    private static void add(List<Map<String, Object>> issues, String sev, String table, String column, String msg, String fix) {
        Map<String, Object> i = new LinkedHashMap<>();
        i.put("severity", sev);
        i.put("table", table);
        i.put("column", column);
        i.put("message", msg);
        if (fix != null) i.put("fix", fix);
        issues.add(i);
    }
}
