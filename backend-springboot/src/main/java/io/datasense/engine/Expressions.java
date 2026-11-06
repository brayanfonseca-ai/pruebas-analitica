package io.datasense.engine;

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
            if (!m.matches()) throw new ExpressionError(
                    "Una dimensión debe ser un campo, por ejemplo [Sucursal]. Las dimensiones calculadas aún no están soportadas.");
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

    private static String resolveTable(String field, Map<String, List<String>> fieldIndex) {
        List<String> tables = fieldIndex.get(field);
        if (tables == null || tables.isEmpty())
            throw new ExpressionError("El campo '" + field + "' no existe en el modelo de datos.");
        return new TreeSet<>(tables).first();
    }
}
