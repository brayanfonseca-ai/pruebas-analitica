package io.datasense.engine;

import io.datasense.model.AppModels.MeasureSpec;
import io.datasense.model.AppModels.QueryResult;
import io.datasense.model.AppModels.QuerySpec;
import io.datasense.model.AppModels.SeriesOut;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Motor de agregación. Porta el núcleo de engine/query.py: agrupa por la
 * dimensión y agrega las medidas, aplicando las selecciones como filtros de
 * fila (filtrado asociativo de tabla única — el caso que cubren las hojas y
 * dashboards verificados).
 *
 * <p>Garantías: una medida sin dimensión devuelve un escalar (KPI); con
 * dimensión devuelve labels + series. Las selecciones restringen filas por
 * valor de campo antes de agregar.</p>
 */
public final class QueryEngine {

    private QueryEngine() {}

    /**
     * Ejecuta la consulta sobre las tablas del app (sin capa de overrides).
     * Se conserva para compatibilidad con llamadores y tests existentes.
     * @param tables  nombre de tabla -> DataFrame cargado
     */
    public static QueryResult run(Map<String, DataFrame> tables, QuerySpec spec) {
        return run(tables, spec, Map.of(), Map.of());
    }

    /**
     * Ejecuta la consulta respetando la capa de field overrides.
     *
     * <p>La resolución de campos (dimensión y medidas) es SIEMPRE por identidad
     * física (el nombre de columna crudo del DataFrame), así que renombrar un
     * campo no rompe las hojas. {@code effectiveTypes} aporta el tipo EFECTIVO
     * (forzado) por campo físico para decidir la agregación: si se pide una
     * agregación numérica (sum/avg/min/max) sobre un campo cuyo tipo efectivo no
     * es {@code number}, se DEGRADA a {@code count} en vez de lanzar o devolver 0
     * silencioso. {@code displays} aporta el alias de presentación para rotular
     * las series cuando el frontend no envía una etiqueta explícita.
     *
     * @param tables         nombre de tabla -> DataFrame
     * @param effectiveTypes nombre de tabla -> {campo físico -> tipo efectivo}
     * @param displays       nombre de tabla -> {campo físico -> display}
     */
    public static QueryResult run(Map<String, DataFrame> tables, QuerySpec spec,
                                  Map<String, Map<String, String>> effectiveTypes,
                                  Map<String, Map<String, String>> displays) {
        List<MeasureSpec> measures = spec.measures() == null ? List.of() : spec.measures();
        if (measures.isEmpty()) return new QueryResult(List.of(), List.of(), null, List.of());

        // Tabla base: la de la primera medida (o la de la dimensión si existe).
        MeasureSpec m0 = measures.get(0);
        DataFrame df = tables.get(m0.table());
        if (df == null && spec.dimension() != null) df = tables.get(spec.dimension().table());
        if (df == null) return new QueryResult(List.of(), List.of(), null, List.of());

        // ¿Multi-tabla? La dimensión vive en una tabla distinta de la medida.
        boolean multiTable = spec.dimension() != null
                && !spec.dimension().table().equals(m0.table())
                && tables.containsKey(spec.dimension().table());
        if (multiTable && measures.stream().anyMatch(MeasureSpec::composite)) {
            // Una medida compuesta no es aditiva (p. ej. un %): no se puede pre-agregar por clave y volver a sumar.
            // Se lleva la dimensión a cada fila de la tabla de la medida a través de la clave compartida.
            DataFrame mapped = withDimFromKey(tables.get(spec.dimension().table()), df, spec);
            if (mapped != null) {
                boolean[] mkeep = applySelections(mapped, spec.selections());
                return aggregateDim(mapped, mkeep, spec, measures, effectiveTypes, displays);
            }
        }
        if (multiTable) {
            DataFrame joined = AssociativeJoin.join(tables, spec);
            if (joined != null) {
                boolean[] jkeep = applySelections(joined, spec.selections());
                return aggregateDim(joined, jkeep, spec, measures, effectiveTypes, displays);
            }
        }

        boolean[] keep = applySelections(df, spec.selections());

        // --- KPI: medida(s) sin dimensión -> escalar(es) ---
        if (spec.dimension() == null) {
            double first = aggregate(df, keep, null, null, m0, effectiveTypes);
            // value = primera medida (contrato del KPI del frontend)
            List<Double> vals = new ArrayList<>();
            for (MeasureSpec m : measures) vals.add(aggregate(df, keep, null, null, m, effectiveTypes));
            return new QueryResult(List.of(), vals, first, List.of());
        }

        // --- Dimensión -> agrupar y agregar ---
        return aggregateDim(df, keep, spec, measures, effectiveTypes, displays);
    }

    /** Agrupa por la dimensión y agrega cada medida; devuelve labels + series. */
    private static QueryResult aggregateDim(DataFrame df, boolean[] keep, QuerySpec spec, List<MeasureSpec> measures,
                                            Map<String, Map<String, String>> effectiveTypes,
                                            Map<String, Map<String, String>> displays) {
        int dimIdx = df.indexOf(spec.dimension().field());
        if (dimIdx < 0) return new QueryResult(List.of(), List.of(), null, List.of());

        // Orden de aparición de las etiquetas (como Qlik: orden de carga).
        LinkedHashMap<String, Integer> labelOrder = new LinkedHashMap<>();
        List<List<String>> rows = df.rows();
        for (int r = 0; r < rows.size(); r++) {
            if (!keep[r]) continue;
            String label = cell(rows.get(r), dimIdx);
            labelOrder.putIfAbsent(label, labelOrder.size());
        }

        List<Object> labels = new ArrayList<>(labelOrder.keySet());
        List<SeriesOut> series = new ArrayList<>();
        for (MeasureSpec m : measures) {
            List<Double> values = new ArrayList<>();
            for (Object label : labels) {
                values.add(aggregate(df, keep, dimIdx, String.valueOf(label), m, effectiveTypes));
            }
            series.add(new SeriesOut(seriesLabel(m, displays), values));
        }
        List<Double> firstValues = series.isEmpty() ? List.of() : series.get(0).values();
        return new QueryResult(labels, firstValues, null, series);
    }

    /** Etiqueta de serie: la que envía el frontend, o el display del override, o el nombre físico. */
    private static String seriesLabel(MeasureSpec m, Map<String, Map<String, String>> displays) {
        if (m.label() != null && !m.label().isBlank()) return m.label();
        Map<String, String> byField = displays == null ? null : displays.get(m.table());
        if (byField != null) {
            String display = byField.get(m.field());
            if (display != null && !display.isBlank()) return display;
        }
        return m.field();
    }

    /** Tipo efectivo de un campo físico (respetando overrides); por defecto el inferido del DataFrame. */
    private static String effectiveType(DataFrame df, MeasureSpec m, Map<String, Map<String, String>> effectiveTypes) {
        Map<String, String> byField = effectiveTypes == null ? null : effectiveTypes.get(m.table());
        if (byField != null) {
            String t = byField.get(m.field());
            if (t != null && !t.isBlank()) return t;
        }
        return df.typeOf(m.field());
    }

    /** Agrega una medida sobre las filas conservadas; si dimIdx!=null, solo las del grupo. */
    private static double aggregate(DataFrame df, boolean[] keep, Integer dimIdx, String groupValue, MeasureSpec m,
                                    Map<String, Map<String, String>> effectiveTypes) {
        if (m.composite()) return aggregateComposite(df, keep, dimIdx, groupValue, m);
        int measIdx = df.indexOf(m.field());
        String agg = m.agg() == null ? "sum" : m.agg();
        // Degradación coherente: sum/avg/min/max sobre un campo cuyo tipo efectivo
        // NO es number no tiene sentido (texto = dimensión) -> contar en su lugar.
        boolean numericAgg = "sum".equals(agg) || "avg".equals(agg) || "min".equals(agg) || "max".equals(agg);
        if (numericAgg && !"number".equals(effectiveType(df, m, effectiveTypes))) {
            agg = "count";
        }
        List<List<String>> rows = df.rows();
        double sum = 0, min = Double.POSITIVE_INFINITY, max = Double.NEGATIVE_INFINITY;
        long count = 0;
        for (int r = 0; r < rows.size(); r++) {
            if (!keep[r]) continue;
            if (dimIdx != null && !java.util.Objects.equals(cell(rows.get(r), dimIdx), groupValue)) continue;
            String raw = measIdx >= 0 ? cell(rows.get(r), measIdx) : null;
            if ("count".equals(agg)) { count++; continue; }
            if (raw == null || raw.isBlank() || !Profiler.isNumeric(raw)) continue;
            double v = Double.parseDouble(raw.trim().replace(",", ""));
            sum += v; count++;
            if (v < min) min = v;
            if (v > max) max = v;
        }
        return switch (agg) {
            case "count" -> count;
            case "avg" -> count == 0 ? 0 : sum / count;
            case "min" -> count == 0 ? 0 : min;
            case "max" -> count == 0 ? 0 : max;
            default -> sum; // sum
        };
    }

    /**
     * Medida compuesta: calcula cada agregación ({@code parts}) sobre las filas del grupo y combina los resultados con
     * la fórmula externa. Dentro de una compuesta, Count cuenta valores no vacíos (Count DISTINCT, valores distintos),
     * Sum/Avg/Min/Max usan solo valores numéricos. Una división por cero o un resultado no numérico da 0.
     */
    private static double aggregateComposite(DataFrame df, boolean[] keep, Integer dimIdx, String groupValue, MeasureSpec m) {
        int np = m.parts().size();
        String[] aggs = new String[np];
        boolean[] distinct = new boolean[np];
        int[] fieldIdx = new int[np];
        io.datasense.engine.transform.RowExpression[] exprs = new io.datasense.engine.transform.RowExpression[np];
        for (int p = 0; p < np; p++) {
            Map<String, Object> part = m.parts().get(p);
            aggs[p] = String.valueOf(part.getOrDefault("agg", "sum")).toLowerCase();
            distinct[p] = Boolean.TRUE.equals(part.get("distinct")) || "true".equals(String.valueOf(part.get("distinct")));
            Object expr = part.get("expr");
            if (expr != null && !String.valueOf(expr).isBlank()) {
                exprs[p] = io.datasense.engine.transform.RowExpression.compile(String.valueOf(expr));
                fieldIdx[p] = -1;
            } else {
                fieldIdx[p] = df.indexOf(String.valueOf(part.get("field")));
            }
        }
        double[] sum = new double[np], min = new double[np], max = new double[np];
        long[] count = new long[np];
        java.util.Arrays.fill(min, Double.POSITIVE_INFINITY);
        java.util.Arrays.fill(max, Double.NEGATIVE_INFINITY);
        List<java.util.Set<String>> seen = new ArrayList<>();
        for (int p = 0; p < np; p++) seen.add(distinct[p] ? new java.util.HashSet<>() : null);

        List<List<String>> rows = df.rows();
        for (int r = 0; r < rows.size(); r++) {
            if (!keep[r]) continue;
            List<String> row = rows.get(r);
            if (dimIdx != null && !java.util.Objects.equals(cell(row, dimIdx), groupValue)) continue;
            for (int p = 0; p < np; p++) {
                String raw;
                if (exprs[p] != null) {
                    try {
                        raw = io.datasense.engine.transform.RowExpression.format(exprs[p].eval(f -> {
                            String s = cell(row, df.indexOf(f));
                            return s == null || s.isBlank() ? null : s;
                        }));
                    } catch (RuntimeException e) { raw = null; }
                } else raw = fieldIdx[p] >= 0 ? cell(row, fieldIdx[p]) : null;
                if (raw == null || raw.isBlank()) continue;
                if ("count".equals(aggs[p])) {
                    if (distinct[p]) seen.get(p).add(raw.trim()); else count[p]++;
                    continue;
                }
                if (!Profiler.isNumeric(raw)) continue;
                double v = Double.parseDouble(raw.trim().replace(",", ""));
                sum[p] += v; count[p]++;
                if (v < min[p]) min[p] = v;
                if (v > max[p]) max[p] = v;
            }
        }
        Map<String, String> values = new java.util.HashMap<>();
        for (int p = 0; p < np; p++) {
            double v = switch (aggs[p]) {
                case "count" -> distinct[p] ? seen.get(p).size() : count[p];
                case "avg" -> count[p] == 0 ? 0 : sum[p] / count[p];
                case "min" -> count[p] == 0 ? 0 : min[p];
                case "max" -> count[p] == 0 ? 0 : max[p];
                default -> sum[p];
            };
            values.put(Expressions.PART + p, io.datasense.engine.transform.RowExpression.format(v));
        }
        try {
            Object out = io.datasense.engine.transform.RowExpression.compile(m.formula()).eval(values::get);
            if (out instanceof Double d) return d.isNaN() || d.isInfinite() ? 0 : d;
            if (out instanceof Boolean b) return b ? 1 : 0;
            String s = io.datasense.engine.transform.RowExpression.format(out);
            return s != null && Profiler.isNumeric(s) ? Double.parseDouble(s.trim().replace(",", "")) : 0;
        } catch (RuntimeException e) {
            return 0;
        }
    }

    /**
     * Tabla de la medida con la columna de la dimensión añadida: cada fila toma la etiqueta de la fila de la tabla de
     * la dimensión que comparte su clave (las selecciones sobre la tabla de la dimensión se respetan). Filas sin pareja
     * quedan fuera. Devuelve null si no hay un campo compartido.
     */
    private static DataFrame withDimFromKey(DataFrame dim, DataFrame mt, QuerySpec spec) {
        if (dim == null || mt == null) return null;
        String dimField = spec.dimension().field();
        String key = null;
        java.util.Set<String> mcols = new java.util.HashSet<>(mt.columns());
        for (String c : dim.columns()) if (mcols.contains(c)) { key = c; break; }
        if (key == null) return null;
        boolean[] dkeep = applySelections(dim, spec.selections());
        int dk = dim.indexOf(key), dd = dim.indexOf(dimField);
        Map<String, String> labelByKey = new java.util.HashMap<>();
        for (int r = 0; r < dim.rowCount(); r++) {
            if (!dkeep[r]) continue;
            List<String> row = dim.rows().get(r);
            labelByKey.putIfAbsent(cell(row, dk), cell(row, dd));
        }
        int mk = mt.indexOf(key);
        List<String> cols = new ArrayList<>(mt.columns());
        boolean hasDim = cols.contains(dimField);
        if (!hasDim) cols.add(dimField);
        int di = cols.indexOf(dimField);
        List<List<String>> rows = new ArrayList<>();
        for (List<String> row : mt.rows()) {
            String k = cell(row, mk);
            if (!labelByKey.containsKey(k)) continue;
            List<String> nr = new ArrayList<>(row);
            while (nr.size() < mt.columns().size()) nr.add(null);
            if (hasDim) nr.set(di, labelByKey.get(k)); else nr.add(labelByKey.get(k));
            rows.add(nr);
        }
        return new DataFrame(cols, rows);
    }

    /** Calcula qué filas sobreviven a las selecciones (filtro asociativo tabla única). */
    private static boolean[] applySelections(DataFrame df, Map<String, List<Object>> selections) {
        boolean[] keep = new boolean[df.rowCount()];
        java.util.Arrays.fill(keep, true);
        if (selections == null || selections.isEmpty()) return keep;
        List<List<String>> rows = df.rows();
        for (Map.Entry<String, List<Object>> sel : selections.entrySet()) {
            int idx = df.indexOf(sel.getKey());
            if (idx < 0 || sel.getValue() == null || sel.getValue().isEmpty()) continue;
            var allowed = sel.getValue().stream().map(String::valueOf).collect(java.util.stream.Collectors.toSet());
            for (int r = 0; r < rows.size(); r++) {
                if (keep[r] && !allowed.contains(cell(rows.get(r), idx))) keep[r] = false;
            }
        }
        return keep;
    }

    private static String cell(List<String> row, int idx) {
        return idx >= 0 && idx < row.size() ? row.get(idx) : null;
    }
}
