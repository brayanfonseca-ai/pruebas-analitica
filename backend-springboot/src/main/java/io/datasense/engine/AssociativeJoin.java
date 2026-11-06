package io.datasense.engine;

import io.datasense.model.AppModels.MeasureSpec;
import io.datasense.model.AppModels.QuerySpec;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;

/**
 * Une la tabla de la dimensión con la(s) tabla(s) de medidas a través de un
 * campo compartido (clave de asociación), produciendo un {@link DataFrame}
 * combinado con la dimensión y cada medida como columnas.
 *
 * <p>ANTI-FAN-OUT: cada medida se agrega PRIMERO a nivel de la clave compartida
 * en su tabla de origen, y luego se adjunta a la tabla de la dimensión. Así una
 * relación uno-a-muchos no duplica ni infla las filas de la medida.</p>
 *
 * <p>Cubre el caso de dos tablas enlazadas por un campo común (el más frecuente
 * en los modelos actuales). Modelos con cadenas de más tablas quedan como paso
 * siguiente; aquí se resuelve el enlace directo dimensión↔medida.</p>
 */
public final class AssociativeJoin {

    private AssociativeJoin() {}

    public static DataFrame join(Map<String, DataFrame> tables, QuerySpec spec) {
        String dimTable = spec.dimension().table();
        String dimField = spec.dimension().field();
        DataFrame dim = tables.get(dimTable);
        if (dim == null) return null;

        List<MeasureSpec> measures = spec.measures();
        // Columnas del frame resultante: la dimensión + cada medida (por nombre).
        List<String> cols = new ArrayList<>();
        cols.add(dimField);
        for (MeasureSpec m : measures) if (!cols.contains(m.field())) cols.add(m.field());

        // Para cada medida, pre-agrega su tabla por la clave compartida con la
        // tabla de la dimensión, y mapea clave -> valor agregado.
        // key: (measure index) -> (shared key value -> aggregated measure value)
        List<Map<String, Double>> measureByKey = new ArrayList<>();
        List<String> sharedKeys = new ArrayList<>();
        for (MeasureSpec m : measures) {
            DataFrame mt = tables.get(m.table());
            if (mt == null) { measureByKey.add(Map.of()); sharedKeys.add(null); continue; }
            String key = sharedField(dim, mt);
            sharedKeys.add(key);
            measureByKey.add(key == null ? Map.of() : preAggregate(mt, key, m));
        }

        // Construye filas: por cada fila de la dimensión, toma su valor de clave
        // y adjunta el valor agregado de cada medida.
        List<List<String>> rows = new ArrayList<>();
        int dimIdx = dim.indexOf(dimField);
        for (List<String> drow : dim.rows()) {
            List<String> out = new ArrayList<>();
            out.add(cell(drow, dimIdx));
            for (int mi = 0; mi < measures.size(); mi++) {
                String key = sharedKeys.get(mi);
                String keyVal = key == null ? null : cell(drow, dim.indexOf(key));
                Double v = key == null ? null : measureByKey.get(mi).get(keyVal);
                out.add(v == null ? "" : String.valueOf(v));
            }
            rows.add(out);
        }
        // Copia las columnas de clave compartida al frame por si hay selecciones
        // sobre esos campos (filtrado asociativo).
        for (String key : new TreeSet<>(sharedKeys.stream().filter(k -> k != null).toList())) {
            if (cols.contains(key)) continue;
            cols.add(key);
            int ki = dim.indexOf(key);
            for (int r = 0; r < rows.size(); r++) {
                rows.get(r).add(ki >= 0 ? cell(dim.rows().get(r), ki) : "");
            }
        }
        return new DataFrame(cols, rows);
    }

    /** Agrega una medida por su clave compartida (sum/avg/count/min/max). */
    private static Map<String, Double> preAggregate(DataFrame mt, String key, MeasureSpec m) {
        int keyIdx = mt.indexOf(key);
        int measIdx = mt.indexOf(m.field());
        String agg = m.agg() == null ? "sum" : m.agg();
        java.util.LinkedHashMap<String, double[]> acc = new java.util.LinkedHashMap<>();
        // acc[key] = {sum, count, min, max}
        for (List<String> row : mt.rows()) {
            String k = cell(row, keyIdx);
            double[] a = acc.computeIfAbsent(k, x -> new double[]{0, 0, Double.POSITIVE_INFINITY, Double.NEGATIVE_INFINITY});
            if ("count".equals(agg)) { a[1]++; continue; }
            String raw = measIdx >= 0 ? cell(row, measIdx) : null;
            if (raw == null || raw.isBlank() || !Profiler.isNumeric(raw)) continue;
            double v = Double.parseDouble(raw.trim().replace(",", ""));
            a[0] += v; a[1]++;
            if (v < a[2]) a[2] = v;
            if (v > a[3]) a[3] = v;
        }
        java.util.LinkedHashMap<String, Double> out = new java.util.LinkedHashMap<>();
        for (var e : acc.entrySet()) {
            double[] a = e.getValue();
            double val = switch (agg) {
                case "count" -> a[1];
                case "avg" -> a[1] == 0 ? 0 : a[0] / a[1];
                case "min" -> a[1] == 0 ? 0 : a[2];
                case "max" -> a[1] == 0 ? 0 : a[3];
                default -> a[0];
            };
            out.put(e.getKey(), val);
        }
        return out;
    }

    /** Primer campo con el mismo nombre en ambas tablas (clave de asociación). */
    private static String sharedField(DataFrame a, DataFrame b) {
        Set<String> bc = new java.util.HashSet<>(b.columns());
        for (String c : a.columns()) if (bc.contains(c)) return c;
        return null;
    }

    private static String cell(List<String> row, int idx) {
        return idx >= 0 && idx < row.size() ? row.get(idx) : null;
    }
}
