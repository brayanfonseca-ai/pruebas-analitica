package io.datasense.engine;

import io.datasense.engine.transform.RowExpression;

import java.util.List;
import java.util.Map;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Compilador de expresiones `fx` (sin eval). Porta engine/expressions.py: una
 * gramática cerrada con regex ancladas convierte el texto en un spec que el
 * motor de consulta entiende. Cualquier cosa fuera de la gramática se rechaza
 * con un error legible.
 *
 * <pre>
 *   measure   := FUNC "(" fieldref ")"   FUNC ∈ {Sum,Avg,Count,Min,Max}
 *   dimension := fieldref
 *   fieldref  := "[" texto "]" | identificador
 * </pre>
 */
public final class Expressions {

    private Expressions() {}

    /** Error de validación de expresión (mensaje en español para la UI). */
    public static class ExpressionError extends RuntimeException {
        public ExpressionError(String msg) { super(msg); }
    }

    private static final String IDENT = "[A-Za-z_%\\u00C0-\\u017F][\\w%.\\u00C0-\\u017F]*";
    private static final String FIELDREF = "(?:\\[(?<br>[^\\]]+)\\]|(?<id>" + IDENT + "))";
    private static final Pattern MEASURE = Pattern.compile(
            "^\\s*=?\\s*(?<fn>[A-Za-z]+)\\s*\\(\\s*(?<distinct>distinct\\s+)?" + FIELDREF + "\\s*\\)\\s*$",
            Pattern.CASE_INSENSITIVE);
    private static final Pattern DIMENSION = Pattern.compile("^\\s*=?\\s*" + FIELDREF + "\\s*$");
    private static final java.util.Set<String> FUNCS = java.util.Set.of("sum", "avg", "count", "min", "max");

    private static String fieldFrom(Matcher m) {
        String br = m.group("br");
        String field = (br != null ? br : m.group("id"));
        field = field == null ? "" : field.strip();
        if (field.isEmpty()) throw new ExpressionError("La referencia de campo está vacía.");
        return field;
    }

    /**
     * Compila una expresión a un spec listo para el motor.
     * @param kind "measure" | "dimension"
     * @param text expresión fx
     * @param fieldIndex campo -> tablas que lo contienen
     * @return measure -> {table, field, agg}; dimension -> {table, field}
     */
    public static Map<String, Object> compile(String kind, String text, Map<String, List<String>> fieldIndex) {
        return compile(kind, text, fieldIndex, null);
    }

    /**
     * Igual que {@link #compile(String, String, Map)}; {@code name} es el nombre con el que se expone una
     * dimensión calculada (el de la dimensión maestra). Sin nombre se usa la propia expresión.
     */
    public static Map<String, Object> compile(String kind, String text, Map<String, List<String>> fieldIndex, String name) {
        if (text == null || text.isBlank()) throw new ExpressionError("La expresión está vacía.");
        String field, agg = null;
        if ("measure".equals(kind)) {
            Matcher m = MEASURE.matcher(text);
            if (!m.matches()) throw new ExpressionError(
                    "Expresión no válida. Use una función de agregación sobre un campo, por ejemplo Sum([Ventas]) o Count([cedula]).");
            String fn = m.group("fn").toLowerCase();
            if (!FUNCS.contains(fn)) throw new ExpressionError(
                    "Función no soportada: '" + m.group("fn") + "'. Disponibles: Sum, Avg, Count, Min, Max.");
            if (m.group("distinct") != null) throw new ExpressionError("Count(DISTINCT …) aún no está soportado por el motor.");
            agg = fn;
            field = fieldFrom(m);
        } else if ("dimension".equals(kind)) {
            Matcher m = DIMENSION.matcher(text);
            if (!m.matches()) return calculated(text, name, fieldIndex);
            field = fieldFrom(m);
        } else {
            throw new ExpressionError("Tipo de expresión desconocido: '" + kind + "'.");
        }
        String table = resolveTable(field, fieldIndex);
        Map<String, Object> out = new java.util.LinkedHashMap<>();
        out.put("table", table);
        out.put("field", field);
        if (agg != null) out.put("agg", agg);
        return out;
    }

    /**
     * Dimensión calculada: una expresión por fila (If, Round, Year, &amp;, comparaciones, Class…) que el motor evalúa
     * en cada consulta como si fuera un campo más. Todos los campos que usa deben estar en una misma tabla.
     * Devuelve {table, field (nombre con que se agrupa/selecciona), expr, calculated:true, fields}.
     */
    private static Map<String, Object> calculated(String text, String name, Map<String, List<String>> fieldIndex) {
        String expr = text.strip().replaceFirst("^=\\s*", "");
        RowExpression ex;
        try { ex = RowExpression.compile(expr); }
        catch (RowExpression.ExprError e) { throw new ExpressionError("Dimensión calculada no válida: " + e.getMessage()); }
        List<String> used = ex.fields();
        if (used.isEmpty()) throw new ExpressionError("Una dimensión calculada debe usar al menos un campo, por ejemplo If([Edad] >= 40, 'Mayor', 'Menor').");
        java.util.Set<String> common = null;
        for (String f : used) {
            List<String> ts = fieldIndex.get(f);
            if (ts == null || ts.isEmpty()) throw new ExpressionError("El campo '" + f + "' no existe en el modelo de datos.");
            if (common == null) common = new TreeSet<>(ts); else common.retainAll(ts);
        }
        if (common == null || common.isEmpty())
            throw new ExpressionError("Los campos de una dimensión calculada deben estar en la misma tabla (" + String.join(", ", used) + ").");
        String label = name == null || name.isBlank() ? expr : name.strip();
        if (fieldIndex.containsKey(label))
            throw new ExpressionError("El nombre «" + label + "» ya es un campo del modelo. Elige otro nombre para la dimensión calculada.");
        Map<String, Object> out = new java.util.LinkedHashMap<>();
        out.put("table", common.iterator().next());
        out.put("field", label);
        out.put("expr", expr);
        out.put("calculated", true);
        out.put("fields", used);
        return out;
    }

    /** Copia del DataFrame con una columna calculada más ({@code name} = valor de {@code expr} en cada fila). */
    public static DataFrame withCalculated(DataFrame df, String name, String expr) {
        if (df == null || name == null || df.indexOf(name) >= 0) return df;
        RowExpression ex = RowExpression.compile(expr);
        List<String> cols = new java.util.ArrayList<>(df.columns());
        cols.add(name);
        List<List<String>> rows = new java.util.ArrayList<>(df.rowCount());
        for (List<String> r : df.rows()) {
            String v;
            try {
                v = RowExpression.format(ex.eval((f) -> {
                    int i = df.indexOf(f);
                    String s = i >= 0 && i < r.size() ? r.get(i) : null;
                    return s == null || s.isBlank() ? null : s;
                }));
            } catch (RuntimeException e) { v = null; }
            List<String> nr = new java.util.ArrayList<>(r);
            while (nr.size() < cols.size() - 1) nr.add(null);
            nr.add(v == null ? "" : v);
            rows.add(nr);
        }
        return new DataFrame(cols, rows);
    }

    private static String resolveTable(String field, Map<String, List<String>> fieldIndex) {
        List<String> tables = fieldIndex.get(field);
        if (tables == null || tables.isEmpty())
            throw new ExpressionError("El campo '" + field + "' no existe en el modelo de datos.");
        return new TreeSet<>(tables).first();
    }
}
