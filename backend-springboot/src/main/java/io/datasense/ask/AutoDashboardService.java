package io.datasense.ask;

import io.datasense.engine.DataFrame;
import io.datasense.engine.Expressions;
import io.datasense.repo.SheetRepository;

import org.springframework.stereotype.Service;

import java.util.*;

/**
 * <b>De archivo a tablero</b>: mira los datos de una tabla (tipos, cardinalidad, identificadores, fechas y
 * periodos) y arma una hoja lista para usar: KPIs, barras por la mejor categoría, torta, evolución en el tiempo,
 * tabla de detalle y un panel de filtros. Las métricas certificadas de la app van primero entre los KPIs.
 */
@Service
public class AutoDashboardService {

    private final AskService ask;
    private final SheetRepository sheets;

    public AutoDashboardService(AskService ask, SheetRepository sheets) {
        this.ask = ask;
        this.sheets = sheets;
    }

    public Map<String, Object> build(String appId, String tableName, String title) {
        AskService.Model m = ask.load(appId);
        if (m.frames.isEmpty()) throw new IllegalArgumentException("La aplicación no tiene datos: carga un archivo o una conexión primero.");
        String table = tableName != null && m.frames.containsKey(tableName) ? tableName : m.mainTable;
        DataFrame df = m.frames.get(table);
        List<AskService.Field> fs = m.fields.stream().filter(f -> f.table.equals(table)).toList();

        List<AskService.Field> dims = fs.stream()
                .filter(f -> "text".equals(f.type) && !f.idLike && !f.timeLike && f.distinct >= 2 && f.distinct <= 40)
                .sorted(Comparator.comparingInt(f -> Math.abs(f.distinct - 8))).toList();
        List<AskService.Field> nums = fs.stream()
                .filter(f -> "number".equals(f.type) && !f.idLike && !f.timeLike && f.distinct > 5)
                .sorted(Comparator.comparingInt(f -> AskService.nonAdditive(f) ? 1 : 0)).toList();
        AskService.Field time = null; int best = -1;
        for (AskService.Field f : fs) {
            if (!f.timeLike || f.distinct < 2 || f.distinct > 400) continue;
            String n = AskService.norm(f.name);
            int s = n.contains("periodo") ? 40 : "date".equals(f.type) ? 30 : n.matches("anio|ano|year") ? 20 : 10;
            if (s > best) { best = s; time = f; }
        }
        AskService.Field id = fs.stream().filter(f -> f.idLike).min(Comparator.comparingInt(f -> "text".equals(f.type) ? 0 : 1)).orElse(null);
        String first = df.columns().get(0);

        Map<String, Object> rowsM = expr("Count([" + first + "])", table, first, "count", "Registros", null, null);
        Map<String, Object> mainMeasure = nums.isEmpty() ? rowsM
                : numMeasure(nums.get(0), table);

        // KPIs: certificadas, registros, distintos del identificador y sumas de los principales números
        List<Map<String, Object>> kpis = new ArrayList<>();
        for (Map<String, Object> it : m.measures) {
            if (!Boolean.TRUE.equals(it.get("certified")) || kpis.size() >= 2) continue;
            if (it.get("resolved") instanceof Map<?, ?> r && table.equals(r.get("table")))
                kpis.add(Map.of("source", "master", "masterId", it.get("id"), "_title", it.get("name")));
        }
        kpis.add(rowsM);
        if (id != null && kpis.size() < 4) {
            Map<String, Object> r = Expressions.compile("measure", "Count(DISTINCT [" + id.name + "])", m.fieldIndex);
            kpis.add(expr("Count(DISTINCT [" + id.name + "])", table, id.name, "count", id.display + " distintos",
                    (String) r.get("formula"), r.get("parts")));
        }
        for (AskService.Field n : nums) {
            if (kpis.size() >= 4) break;
            kpis.add(numMeasure(n, table));
        }

        List<Map<String, Object>> objs = new ArrayList<>();
        int kw = 20 / kpis.size();
        for (int i = 0; i < kpis.size(); i++) {
            Map<String, Object> k = new LinkedHashMap<>(kpis.get(i));
            Object t = k.remove("_title");
            objs.add(obj("kpi", t != null ? String.valueOf(t) : String.valueOf(k.get("label")), null, k, i * kw, 0, i == kpis.size() - 1 ? 20 - i * kw : kw, 2));
        }
        AskService.Field d0 = dims.isEmpty() ? null : dims.get(0), d1 = dims.size() > 1 ? dims.get(1) : null, d2 = dims.size() > 2 ? dims.get(2) : null;
        if (d0 != null) objs.add(obj("bar", label(mainMeasure) + " por " + d0.display, d0.name, mainMeasure, 0, 2, 10, 5));
        if (d1 != null) objs.add(obj("pie", "Registros por " + d1.display, d1.name, rowsM, 10, 2, 10, 5));
        else if (d0 != null) objs.add(obj("pie", "Registros por " + d0.display, d0.name, rowsM, 10, 2, 10, 5));
        if (time != null) objs.add(obj("line", label(mainMeasure) + " por " + time.display, time.name, mainMeasure, 0, 7, 10, 5));
        else if (d2 != null) objs.add(obj("bar", "Registros por " + d2.display, d2.name, rowsM, 0, 7, 10, 5));
        if (d0 != null) {
            List<Object> ms = new ArrayList<>(List.of(rowsM));
            for (AskService.Field n : nums) { if (ms.size() >= 4) break; ms.add(numMeasure(n, table)); }
            Map<String, Object> tbl = obj("table", "Detalle por " + d0.display, d0.name, null, time != null || d2 != null ? 10 : 0, 7, time != null || d2 != null ? 10 : 20, 5);
            tbl.put("measure", ms);
            objs.add(tbl);
        }
        List<Object> fdims = new ArrayList<>();
        // el panel es angosto (4 columnas): máximo 3 listas para que se lean los valores
        for (AskService.Field d : dims) { if (fdims.size() >= (time != null ? 2 : 3)) break; fdims.add(d.name); }
        if (time != null) fdims.add(time.name);
        if (!fdims.isEmpty()) {
            Map<String, Object> fp = obj("filterpane", "Filtros", null, null, 20, 0, 4, 12);
            fp.put("dimension", fdims);
            objs.add(fp);
        } else {
            // sin categorías: los KPIs ocupan todo el ancho
            for (Map<String, Object> o : objs) if ("kpi".equals(o.get("type"))) { o.put("w", 24 / kpis.size()); o.put("x", objs.indexOf(o) * (24 / kpis.size())); }
        }

        List<String> found = new ArrayList<>();
        found.add(df.rowCount() + " filas y " + df.columns().size() + " columnas");
        if (!dims.isEmpty()) found.add("categorías: " + String.join(", ", dims.stream().limit(4).map(f -> f.display).toList()));
        if (!nums.isEmpty()) found.add("medidas: " + String.join(", ", nums.stream().limit(4).map(f -> f.display).toList()));
        if (time != null) found.add("tiempo: " + time.display);
        if (id != null) found.add("identificador: " + id.display);

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("title", title == null || title.isBlank() ? "Resumen de " + table : title.strip());
        body.put("description", "Tablero generado automáticamente a partir de " + table + " (" + String.join("; ", found) + ").");
        body.put("objects", objs);
        Map<String, Object> sheet = sheets.create(appId, body);

        Map<String, Object> summary = new LinkedHashMap<>();
        summary.put("table", table);
        summary.put("rows", df.rowCount());
        summary.put("columns", df.columns().size());
        summary.put("dimensions", dims.stream().limit(6).map(f -> f.display).toList());
        summary.put("measures", nums.stream().limit(6).map(f -> f.display).toList());
        summary.put("time", time == null ? null : time.display);
        summary.put("id", id == null ? null : id.display);
        summary.put("objects", objs.size());
        return Map.of("sheet", sheet, "summary", summary, "questions", ask.suggestions(m));
    }

    /** Total de un número sumable; promedio si sumarlo no tiene sentido (edad, %, probabilidad…). */
    private static Map<String, Object> numMeasure(AskService.Field n, String table) {
        return AskService.nonAdditive(n)
                ? expr("Avg([" + n.name + "])", table, n.name, "avg", "Promedio " + n.display, null, null)
                : expr("Sum([" + n.name + "])", table, n.name, "sum", "Total " + n.display, null, null);
    }

    private static String label(Map<String, Object> measure) { return String.valueOf(measure.get("label")); }

    private static Map<String, Object> expr(String expression, String table, String field, String agg, String label, String formula, Object parts) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("source", "expr");
        m.put("expression", expression);
        m.put("table", table);
        m.put("field", field);
        m.put("agg", agg);
        if (formula != null) { m.put("formula", formula); m.put("parts", parts); }
        m.put("label", label);
        return m;
    }

    private static Map<String, Object> obj(String type, String title, String dim, Object measure, int x, int y, int w, int h) {
        Map<String, Object> o = new LinkedHashMap<>();
        o.put("type", type);
        o.put("title", title);
        if (dim != null) o.put("dimension", dim);
        if (measure != null) o.put("measure", measure);
        o.put("x", x); o.put("y", y); o.put("w", w); o.put("h", h);
        return o;
    }
}
