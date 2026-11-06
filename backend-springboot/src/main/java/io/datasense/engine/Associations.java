package io.datasense.engine;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;

/**
 * Motor de asociaciones. Porta engine/associations.py: dos tablas se asocian
 * cuando comparten uno o más campos con el MISMO nombre (como Qlik). Cuando hay
 * valores muestreados, la confianza usa el solapamiento Jaccard de dominios.
 */
public final class Associations {

    private Associations() {}

    /** Una asociación recomendada entre dos tablas por campos compartidos. */
    public record Edge(String left, String right, List<String> fields, String basis, double confidence) {}

    /**
     * Recomienda asociaciones entre todos los pares de tablas.
     * @param tables nombre -> DataFrame
     */
    public static List<Edge> recommend(Map<String, DataFrame> tables) {
        List<Edge> out = new ArrayList<>();
        List<String> names = new ArrayList<>(new TreeSet<>(tables.keySet()));
        for (int i = 0; i < names.size(); i++) {
            for (int j = i + 1; j < names.size(); j++) {
                String left = names.get(i), right = names.get(j);
                DataFrame dl = tables.get(left), dr = tables.get(right);
                Set<String> lc = new HashSet<>(dl.columns());
                Set<String> rc = new HashSet<>(dr.columns());
                List<String> shared = new ArrayList<>();
                for (String c : new TreeSet<>(lc)) if (rc.contains(c)) shared.add(c);
                if (shared.isEmpty()) continue;

                double confidence;
                String basis;
                double sumJ = 0;
                for (String f : shared) {
                    sumJ += jaccard(distinct(dl, f), distinct(dr, f));
                }
                double avgJ = sumJ / shared.size();
                if (avgJ > 0) { confidence = avgJ; basis = "value-overlap"; }
                else { confidence = 0.5; basis = "name-match"; }
                out.add(new Edge(left, right, shared, basis, round2(confidence)));
            }
        }
        return out;
    }

    /** Grafo del modelo: nodos (tablas + filas + campos) y aristas (asociaciones). */
    public static Map<String, Object> buildModelGraph(Map<String, DataFrame> tables) {
        return buildModelGraph(tables, Map.of());
    }

    /**
     * Grafo del modelo respetando la capa de field overrides.
     *
     * <p>Los campos de cada nodo se exponen por su DISPLAY (rename del override)
     * y los OCULTOS se omiten del listado, pero las asociaciones se siguen
     * calculando sobre las columnas FÍSICAS compartidas (el criterio Jaccard no
     * cambia): el rename es presentación, no identidad.
     *
     * @param tableFields nombre de tabla -> catálogo efectivo de campos; si no
     *                    hay entrada para una tabla, se usan sus columnas crudas
     */
    public static Map<String, Object> buildModelGraph(Map<String, DataFrame> tables,
            Map<String, List<EffectiveFields.Field>> tableFields) {
        List<Map<String, Object>> nodes = new ArrayList<>();
        for (var e : tables.entrySet()) {
            Map<String, Object> node = new LinkedHashMap<>();
            node.put("table", e.getKey());
            node.put("rows", e.getValue().rowCount());
            List<EffectiveFields.Field> eff = tableFields == null ? null : tableFields.get(e.getKey());
            if (eff != null) {
                List<String> displayed = new ArrayList<>();
                for (EffectiveFields.Field f : eff) {
                    if (!f.hidden()) displayed.add(f.display());
                }
                node.put("fields", displayed);
            } else {
                node.put("fields", e.getValue().columns());
            }
            nodes.add(node);
        }
        List<Map<String, Object>> edges = new ArrayList<>();
        for (Edge ed : recommend(tables)) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("from", ed.left());
            m.put("to", ed.right());
            m.put("fields", ed.fields());
            m.put("type", "association");
            m.put("confidence", ed.confidence());
            edges.add(m);
        }
        Map<String, Object> graph = new LinkedHashMap<>();
        graph.put("nodes", nodes);
        graph.put("edges", edges);
        return graph;
    }

    private static Set<String> distinct(DataFrame df, String field) {
        Set<String> s = new HashSet<>();
        for (String v : df.columnValues(field)) if (v != null && !v.isBlank()) s.add(v);
        return s;
    }

    private static double jaccard(Set<String> a, Set<String> b) {
        if (a.isEmpty() && b.isEmpty()) return 0;
        Set<String> union = new HashSet<>(a); union.addAll(b);
        if (union.isEmpty()) return 0;
        Set<String> inter = new HashSet<>(a); inter.retainAll(b);
        return (double) inter.size() / union.size();
    }

    private static double round2(double v) { return Math.round(v * 100.0) / 100.0; }
}
