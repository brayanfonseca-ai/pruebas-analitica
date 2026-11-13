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
 *              | compuesta: expresión de fila cuyos operandos son agregaciones FUNC "(" [DISTINCT] (fieldref | expr) ")"
 *   dimension := fieldref | expresión de fila (dimensión calculada)
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
            if (!m.matches() || m.group("distinct") != null) return composite(text, fieldIndex);
            String fn = m.group("fn").toLowerCase();
            if (!FUNCS.contains(fn)) throw new ExpressionError(
                    "Función no soportada: '" + m.group("fn") + "'. Disponibles: Sum, Avg, Count, Min, Max.");
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

    /** Prefijo de los marcadores con que se sustituye cada agregación dentro de la fórmula externa. */
    public static final String PART = "__a";

    /**
     * Medida compuesta: aritmética entre agregaciones, agregaciones sobre una expresión por fila y Count(DISTINCT …).
     * <pre>
     *   Count([FECHA RETIRO]) / Count([CEDULA]) * 100
     *   Sum(If([ESTADO CONTRATO] = 'Inactivo', 1, 0))
     *   Count(DISTINCT [CEDULA])
     * </pre>
     * Cada {@code Func(...)} se extrae (paréntesis balanceados) y se sustituye por {@code [__a0]}, {@code [__a1]}…;
     * lo que queda es una expresión de fila ({@link RowExpression}) que combina los resultados.
     * Devuelve {table, field, agg, formula, parts:[{agg, field|expr, distinct}], composite:true, fields}.
     */
    private static Map<String, Object> composite(String text, Map<String, List<String>> fieldIndex) {
        String src = text.strip().replaceFirst("^=\\s*", "");
        StringBuilder outer = new StringBuilder();
        List<Map<String, Object>> parts = new java.util.ArrayList<>();
        java.util.LinkedHashSet<String> used = new java.util.LinkedHashSet<>();
        int i = 0, n = src.length();
        while (i < n) {
            char c = src.charAt(i);
            if (c == '[') {                                    // campo: se copia tal cual
                int j = src.indexOf(']', i + 1);
                if (j < 0) throw new ExpressionError("Falta cerrar el corchete del campo.");
                outer.append(src, i, j + 1); i = j + 1; continue;
            }
            if (c == '\'' || c == '"') {                       // texto literal: se copia tal cual
                int j = skipString(src, i);
                outer.append(src, i, j); i = j; continue;
            }
            if (Character.isLetter(c) && (i == 0 || !Character.isLetterOrDigit(src.charAt(i - 1)) && src.charAt(i - 1) != '_')) {
                int j = i;
                while (j < n && (Character.isLetterOrDigit(src.charAt(j)) || src.charAt(j) == '_')) j++;
                String word = src.substring(i, j);
                int k = j;
                while (k < n && Character.isWhitespace(src.charAt(k))) k++;
                if (FUNCS.contains(word.toLowerCase()) && k < n && src.charAt(k) == '(') {
                    int close = matchParen(src, k);
                    parts.add(part(word.toLowerCase(), src.substring(k + 1, close), used));
                    outer.append('[').append(PART).append(parts.size() - 1).append(']');
                    i = close + 1; continue;
                }
                outer.append(word); i = j; continue;
            }
            outer.append(c); i++;
        }
        if (parts.isEmpty()) throw new ExpressionError(
                "Una medida necesita al menos una agregación, por ejemplo Sum([Ventas]), Count([cedula]) o Count([Retiros]) / Count([cedula]) * 100.");
        String formula = outer.toString().strip();
        RowExpression ex;
        try { ex = RowExpression.compile(formula); }
        catch (RowExpression.ExprError e) { throw new ExpressionError("Medida no válida: " + e.getMessage().replace(PART, "agregación ")); }
        for (String f : ex.fields()) if (!f.startsWith(PART)) throw new ExpressionError(
                "El campo «" + f + "» está fuera de una agregación. En una medida cada campo va dentro de Sum, Avg, Count, Min o Max.");
        java.util.Set<String> common = null;
        for (String f : used) {
            List<String> ts = fieldIndex.get(f);
            if (ts == null || ts.isEmpty()) throw new ExpressionError("El campo '" + f + "' no existe en el modelo de datos.");
            if (common == null) common = new TreeSet<>(ts); else common.retainAll(ts);
        }
        if (common == null || common.isEmpty())
            throw new ExpressionError("Los campos de una medida compuesta deben estar en la misma tabla (" + String.join(", ", used) + ").");
        Map<String, Object> out = new java.util.LinkedHashMap<>();
        out.put("table", common.iterator().next());
        out.put("field", used.iterator().next());
        out.put("agg", parts.get(0).get("agg"));
        out.put("formula", formula);
        out.put("parts", parts);
        out.put("composite", true);
        out.put("fields", new java.util.ArrayList<>(used));
        return out;
    }

    /** Una agregación de la medida compuesta: {agg, field} si el argumento es un campo, {agg, expr} si es una expresión. */
    private static Map<String, Object> part(String agg, String arg, java.util.Set<String> used) {
        String a = arg.strip();
        boolean distinct = false;
        Matcher dm = Pattern.compile("^distinct\\s+", Pattern.CASE_INSENSITIVE).matcher(a);
        if (dm.find()) {
            if (!"count".equals(agg)) throw new ExpressionError("DISTINCT solo se admite dentro de Count, por ejemplo Count(DISTINCT [cedula]).");
            distinct = true; a = a.substring(dm.end()).strip();
        }
        if (a.isEmpty()) throw new ExpressionError("La agregación " + agg + "() está vacía.");
        Map<String, Object> p = new java.util.LinkedHashMap<>();
        p.put("agg", agg);
        Matcher fm = DIMENSION.matcher(a);
        if (fm.matches()) {
            String f = fieldFrom(fm);
            p.put("field", f); used.add(f);
        } else {
            if (Pattern.compile("(?i)\\b(sum|avg|count|min|max)\\s*\\(").matcher(a.replaceAll("\\[[^\\]]*\\]|'[^']*'", "")).find())
                throw new ExpressionError("No se pueden anidar agregaciones (por ejemplo Sum(Count(...))). Combínalas con + - * /: Sum([a]) / Count([b]).");
            RowExpression ex;
            try { ex = RowExpression.compile(a); }
            catch (RowExpression.ExprError e) { throw new ExpressionError("Argumento no válido en " + agg + "(): " + e.getMessage()); }
            if (ex.fields().isEmpty()) throw new ExpressionError("El argumento de " + agg + "() debe usar al menos un campo.");
            p.put("expr", a); used.addAll(ex.fields());
        }
        p.put("distinct", distinct);
        return p;
    }

    private static int skipString(String s, int i) {
        char q = s.charAt(i);
        int j = i + 1;
        while (j < s.length()) {
            if (s.charAt(j) == q) { if (j + 1 < s.length() && s.charAt(j + 1) == q) { j += 2; continue; } return j + 1; }
            j++;
        }
        throw new ExpressionError("Falta cerrar la comilla.");
    }

    private static int matchParen(String s, int open) {
        int depth = 0;
        for (int j = open; j < s.length(); j++) {
            char c = s.charAt(j);
            if (c == '[') { int e = s.indexOf(']', j + 1); if (e < 0) break; j = e; continue; }
            if (c == '\'' || c == '"') { j = skipString(s, j) - 1; continue; }
            if (c == '(') depth++;
            else if (c == ')' && --depth == 0) return j;
        }
        throw new ExpressionError("Falta cerrar un paréntesis en la medida.");
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
