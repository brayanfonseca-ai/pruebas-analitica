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
