package io.datasense.engine;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Aplica una capa de "field overrides" (preparación visual de datos) sobre un
 * {@link DataFrame}, de forma pura (sin JDBC), para poder testearlo aislado.
 *
 * <p>Cada override se identifica por {@code source_field} (el nombre ORIGINAL de
 * la columna en el DataFrame) y puede:
 * <ul>
 *   <li>renombrar la columna ({@code rename}),</li>
 *   <li>forzar su tipo lógico ({@code forced_type} en {text|number|date},
 *       sobrescribiendo el inferido), y</li>
 *   <li>ocultarla ({@code hidden}), excluyéndola de columnas/filas/perfil.</li>
 * </ul>
 *
 * <p>No modifica el CSV materializado ni el DataFrame de entrada: solo construye
 * una vista efectiva. Sin overrides, la vista es idéntica al DataFrame original.
 */
public final class FieldOverrides {

    private FieldOverrides() {}

    /** Vista efectiva de una tabla tras aplicar los overrides. */
    public static final class Effective {
        private final List<String> names;              // nombres expuestos (renombrados), sin ocultas
        private final List<String> types;              // tipo efectivo por columna visible
        private final List<Integer> sourceIndexes;     // índice en el DataFrame original por columna visible

        Effective(List<String> names, List<String> types, List<Integer> sourceIndexes) {
            this.names = names;
            this.types = types;
            this.sourceIndexes = sourceIndexes;
        }

        /** Nombres de columna expuestos (renombrados), en orden, sin las ocultas. */
        public List<String> names() { return names; }

        /** Tipo lógico efectivo por columna visible (forzado si lo hay, si no el inferido). */
        public List<String> types() { return types; }

        /** Número de columnas visibles. */
        public int size() { return names.size(); }

        /** Tipo efectivo de la columna visible en la posición {@code i}. */
        public String typeAt(int i) { return types.get(i); }

        /** Índice en el DataFrame original de la columna visible en la posición {@code i}. */
        public int sourceIndexAt(int i) { return sourceIndexes.get(i); }

        /**
         * Valores (texto crudo) de la columna visible {@code i}, tomados de la
         * columna original correspondiente del DataFrame.
         */
        public List<String> valuesAt(DataFrame df, int i) {
            return df.columnValues(sourceIndexes.get(i));
        }
    }

    /**
     * Construye la vista efectiva. {@code overrides} es la lista devuelta por
     * {@code FieldOverrideRepository.list} (cada entrada con claves
     * {@code source_field, rename, forced_type, hidden}); puede ser null/vacía.
     */
    public static Effective apply(DataFrame df, List<Map<String, Object>> overrides) {
        List<String> names = new ArrayList<>();
        List<String> types = new ArrayList<>();
        List<Integer> sourceIndexes = new ArrayList<>();

        List<String> cols = df.columns();
        for (int c = 0; c < cols.size(); c++) {
            String original = cols.get(c);
            Map<String, Object> ov = findOverride(overrides, original);

            if (ov != null && asBool(ov.get("hidden"))) {
                continue; // oculta: excluida de la vista
            }

            String rename = ov == null ? null : asString(ov.get("rename"));
            names.add(rename != null && !rename.isBlank() ? rename : original);

            String forced = ov == null ? null : asString(ov.get("forced_type"));
            types.add(forced != null && !forced.isBlank() ? forced : df.typeOf(original));

            sourceIndexes.add(c);
        }
        return new Effective(names, types, sourceIndexes);
    }

    private static Map<String, Object> findOverride(List<Map<String, Object>> overrides, String sourceField) {
        if (overrides == null) return null;
        for (Map<String, Object> ov : overrides) {
            if (sourceField.equals(asString(ov.get("source_field")))) return ov;
        }
        return null;
    }

    private static String asString(Object o) { return o == null ? null : String.valueOf(o); }

    private static boolean asBool(Object o) {
        if (o instanceof Boolean b) return b;
        if (o instanceof Number n) return n.intValue() != 0;
        if (o instanceof String s) return "1".equals(s) || "true".equalsIgnoreCase(s);
        return false;
    }
}
