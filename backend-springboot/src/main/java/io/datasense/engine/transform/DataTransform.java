package io.datasense.engine.transform;

import io.datasense.engine.DataFrame;

import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Transformaciones previas a la carga (estilo Power Query) que se aplican a los
 * datos extraídos de una conexión: incluir/quitar columnas, renombrar, cambiar
 * el tipo, limpiar texto, tratar nulos, filtrar filas, columnas calculadas y
 * quitar duplicados.
 *
 * <p>El mismo {@link Spec} se traduce al script de carga (LOAD con AS, Num(),
 * Text(), Alt(), WHERE NOT IsNull(…)) y se puede reconstruir desde ese script
 * ({@link #parseBlock}), de modo que el asistente visual y el editor de script
 * son dos formas de editar lo mismo.
 */
public final class DataTransform {

    private DataTransform() {}

    public static final Set<String> TYPES = Set.of("auto", "text", "integer", "decimal", "date");
    public static final Set<String> TEXT_OPS = Set.of("none", "trim", "upper", "lower");
    public static final Set<String> NULLS = Set.of("keep", "remove", "fill");

    public record ColSpec(String source, boolean include, String name, String type, String text, String nulls, String fill) {
        boolean wrapped() { return !"auto".equals(type) || !"none".equals(text) || "fill".equals(nulls); }
        String out() { return name == null || name.isBlank() ? source : name; }
    }

    public record Computed(String name, String expr) {}

    public record Spec(List<ColSpec> columns, List<Computed> computed, String filter, boolean distinct) {
        public boolean isEmpty() {
            return computed.isEmpty() && (filter == null || filter.isBlank()) && !distinct
                    && columns.stream().allMatch(c -> c.include && c.out().equals(c.source) && !c.wrapped() && !"remove".equals(c.nulls));
        }

        public List<String> sources() { return columns.stream().map(ColSpec::source).toList(); }

        public Map<String, Object> toMap() {
            List<Map<String, Object>> cols = new ArrayList<>();
            for (ColSpec c : columns) {
                Map<String, Object> m = new LinkedHashMap<>();
                m.put("source", c.source); m.put("include", c.include); m.put("name", c.out());
                m.put("type", c.type); m.put("text", c.text); m.put("nulls", c.nulls);
                if (c.fill != null) m.put("fill", c.fill);
                cols.add(m);
            }
            List<Map<String, Object>> comp = new ArrayList<>();
            for (Computed c : computed) comp.add(new LinkedHashMap<>(Map.of("name", c.name, "expr", c.expr)));
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("columns", cols);
            out.put("computed", comp);
            out.put("filter", filter == null ? "" : filter);
            out.put("distinct", distinct);
            return out;
        }
    }

    public record Result(DataFrame df, List<String> warnings, int rowsIn, int rowsOut) {}

    /* ============================== Spec <-> JSON ============================== */

    private static String s(Object o) { return o == null ? null : String.valueOf(o); }
    private static String or(String v, String def, Set<String> allowed) { return v != null && allowed.contains(v) ? v : def; }

    @SuppressWarnings("unchecked")
    public static Spec from(Object raw) {
        if (!(raw instanceof Map<?, ?> m)) return new Spec(List.of(), List.of(), null, false);
        List<ColSpec> cols = new ArrayList<>();
        if (m.get("columns") instanceof List<?> l) {
            for (Object o : l) {
                if (!(o instanceof Map<?, ?> c)) continue;
                String src = s(c.get("source"));
                if (src == null || src.isBlank()) continue;
                String name = s(c.get("name"));
                cols.add(new ColSpec(src, !Boolean.FALSE.equals(c.get("include")) && !"false".equals(s(c.get("include"))),
                        name == null || name.isBlank() ? src : name.trim(),
                        or(s(c.get("type")), "auto", TYPES), or(s(c.get("text")), "none", TEXT_OPS),
                        or(s(c.get("nulls")), "keep", NULLS), s(c.get("fill"))));
            }
        }
        List<Computed> comp = new ArrayList<>();
        if (m.get("computed") instanceof List<?> l) {
            for (Object o : l) {
                if (!(o instanceof Map<?, ?> c)) continue;
                String n = s(c.get("name")), e = s(c.get("expr"));
                if (n == null || n.isBlank() || e == null || e.isBlank()) continue;
                comp.add(new Computed(n.trim(), e.trim()));
            }
        }
        String filter = s(m.get("filter"));
        boolean distinct = Boolean.TRUE.equals(m.get("distinct")) || "true".equals(s(m.get("distinct")));
        return new Spec(cols, comp, filter == null || filter.isBlank() ? null : filter.trim(), distinct);
    }

    /* ============================== Aplicar ============================== */

    private static final Map<String, String> TYPE_LABEL = Map.of("text", "Texto", "integer", "Entero", "decimal", "Decimal", "date", "Fecha");

    /** Valida el spec (nombres repetidos, expresiones) sin datos. Lanza IllegalArgumentException. */
    public static void validate(Spec spec) {
        Set<String> names = new HashSet<>();
        for (ColSpec c : spec.columns) if (c.include && !names.add(c.out().toLowerCase(Locale.ROOT)))
            throw new IllegalArgumentException("El nombre de columna «" + c.out() + "» está repetido.");
        for (Computed c : spec.computed) {
            if (!names.add(c.name.toLowerCase(Locale.ROOT))) throw new IllegalArgumentException("El nombre de columna «" + c.name + "» está repetido.");
            try { RowExpression.compile(c.expr); } catch (RowExpression.ExprError e) { throw new IllegalArgumentException("Columna calculada «" + c.name + "»: " + e.getMessage()); }
        }
        if (spec.filter != null) try { RowExpression.compile(spec.filter); } catch (RowExpression.ExprError e) { throw new IllegalArgumentException("Filtro de filas: " + e.getMessage()); }
    }

    public static Result apply(DataFrame df, Spec spec) {
        validate(spec);
        List<String> warnings = new ArrayList<>();
        Map<String, ColSpec> bySrc = new LinkedHashMap<>();
        for (ColSpec c : spec.columns) bySrc.put(c.source, c);
        for (ColSpec c : spec.columns) if (c.include && df.indexOf(c.source) < 0) warnings.add("La columna «" + c.source + "» no vino en la extracción.");

        // Columnas de salida: todas las de origen (en su orden), con su spec o por defecto.
        List<ColSpec> plan = new ArrayList<>();
        for (String col : df.columns()) plan.add(bySrc.getOrDefault(col, new ColSpec(col, true, col, "auto", "none", "keep", null)));
        List<ColSpec> out = plan.stream().filter(ColSpec::include).toList();
        int[] srcIdx = out.stream().mapToInt(c -> df.indexOf(c.source)).toArray();
        List<int[]> removeIdx = new ArrayList<>();
        for (ColSpec c : plan) if ("remove".equals(c.nulls)) removeIdx.add(new int[]{df.indexOf(c.source)});

        Map<String, String> alias = new HashMap<>();
        for (ColSpec c : plan) if (!c.out().equals(c.source)) alias.put(c.out(), c.source);
        List<RowExpression> comp = spec.computed.stream().map(c -> RowExpression.compile(c.expr)).toList();
        RowExpression filter = spec.filter == null ? null : RowExpression.compile(spec.filter);

        List<String> cols = new ArrayList<>();
        out.forEach(c -> cols.add(c.out()));
        spec.computed.forEach(c -> cols.add(c.name));

        int[] convFail = new int[out.size()];
        List<List<String>> rows = new ArrayList<>();
        Set<List<String>> seen = spec.distinct ? new HashSet<>() : null;
        int filtered = 0, nulled = 0, dups = 0;
        for (List<String> r : df.rows()) {
            java.util.function.Function<String, String> resolve = (name) -> {
                int i = df.indexOf(name);
                if (i < 0 && alias.containsKey(name)) i = df.indexOf(alias.get(name));
                return i < 0 || i >= r.size() ? null : r.get(i);
            };
            boolean drop = false;
            for (int[] ri : removeIdx) { String v = ri[0] >= 0 && ri[0] < r.size() ? r.get(ri[0]) : null; if (v == null || v.isBlank()) { drop = true; break; } }
            if (drop) { nulled++; continue; }
            if (filter != null) {
                boolean keep;
                try { keep = RowExpression.truthy(filter.eval(resolve)); } catch (RuntimeException e) { keep = false; }
                if (!keep) { filtered++; continue; }
            }
            List<String> row = new ArrayList<>(cols.size());
            for (int j = 0; j < out.size(); j++) {
                ColSpec c = out.get(j);
                String v = srcIdx[j] >= 0 && srcIdx[j] < r.size() ? r.get(srcIdx[j]) : null;
                if (v != null) v = switch (c.text) { case "trim" -> v.trim(); case "upper" -> v.toUpperCase(Locale.ROOT); case "lower" -> v.toLowerCase(Locale.ROOT); default -> v; };
                if ((v == null || v.isBlank()) && "fill".equals(c.nulls)) v = c.fill == null ? "" : c.fill;
                if (v != null && !v.isBlank() && !"auto".equals(c.type) && !"text".equals(c.type)) {
                    String conv = switch (c.type) { case "integer" -> Values.toInteger(v); case "decimal" -> Values.toDecimal(v); case "date" -> Values.toDate(v); default -> v; };
                    if (conv == null) convFail[j]++;
                    v = conv;
                }
                row.add(v);
            }
            for (RowExpression e : comp) {
                String v;
                try { v = RowExpression.format(e.eval(resolve)); } catch (RuntimeException ex) { v = null; }
                row.add(v);
            }
            if (seen != null && !seen.add(row)) { dups++; continue; }
            rows.add(row);
        }
        for (int j = 0; j < out.size(); j++)
            if (convFail[j] > 0) warnings.add("«" + out.get(j).out() + "»: " + convFail[j] + " valor(es) no se pudieron convertir a " + TYPE_LABEL.getOrDefault(out.get(j).type, out.get(j).type) + " y quedaron vacíos.");
        if (nulled > 0) warnings.add(nulled + " fila(s) quitadas por valores nulos.");
        if (filtered > 0) warnings.add(filtered + " fila(s) excluidas por el filtro.");
        if (dups > 0) warnings.add(dups + " fila(s) duplicadas quitadas.");
        return new Result(new DataFrame(cols, rows), warnings, df.rowCount(), rows.size());
    }

    /**
     * Columnas de origen que la extracción necesita traer (para SELECT col1, col2…):
     * incluidas + usadas por calculadas, filtro o limpieza de nulos. null = todas (*).
     */
    public static List<String> pushdown(Object rawSpec) {
        Spec spec = from(rawSpec);
        if (spec.columns.isEmpty() || spec.columns.stream().allMatch(ColSpec::include)) return null;
        Map<String, String> alias = new HashMap<>();
        for (ColSpec c : spec.columns) alias.put(c.out(), c.source);
        Set<String> need = new HashSet<>();
        for (ColSpec c : spec.columns) if (c.include || "remove".equals(c.nulls)) need.add(c.source);
        List<String> exprs = new ArrayList<>();
        spec.computed.forEach(c -> exprs.add(c.expr));
        if (spec.filter != null) exprs.add(spec.filter);
        for (String e : exprs) {
            try { for (String f : RowExpression.compile(e).fields()) need.add(alias.getOrDefault(f, f)); }
            catch (RuntimeException ex) { return null; }
        }
        List<String> out = new ArrayList<>();
        for (String s : spec.sources()) if (need.contains(s)) out.add(s);
        return out.isEmpty() ? null : out;
    }

    /* ============================== Script ============================== */

    private static String q(String v) { return "'" + (v == null ? "" : v.replace("'", "''")) + "'"; }

    /** Elementos del LOAD (sin comas) para el spec; sin spec = [col] de cada columna. */
    public static List<String> loadItems(Spec spec, List<String> sources) {
        List<String> items = new ArrayList<>();
        Map<String, ColSpec> by = new HashMap<>();
        for (ColSpec c : spec.columns) by.put(c.source, c);
        List<String> order = spec.columns.isEmpty() ? sources : spec.sources();
        Map<String, String> alias = new HashMap<>();
        for (ColSpec c : spec.columns) if (!c.out().equals(c.source)) alias.put(c.out(), c.source);
        for (String src : order) {
            ColSpec c = by.getOrDefault(src, new ColSpec(src, true, src, "auto", "none", "keep", null));
            if (!c.include) continue;
            String e = "[" + src + "]";
            if (!"none".equals(c.text)) e = switch (c.text) { case "trim" -> "Trim(" + e + ")"; case "upper" -> "Upper(" + e + ")"; default -> "Lower(" + e + ")"; };
            if ("fill".equals(c.nulls)) e = "Alt(" + e + ", " + q(c.fill) + ")";
            e = switch (c.type) { case "text" -> "Text(" + e + ")"; case "integer" -> "Round(Num(" + e + "))"; case "decimal" -> "Num(" + e + ")"; case "date" -> "Date(" + e + ")"; default -> e; };
            if (c.wrapped() || !c.out().equals(src)) e += " AS [" + c.out() + "]";
            items.add(e);
        }
        for (Computed c : spec.computed) items.add(rewriteRefs(c.expr, alias) + " AS [" + c.name + "]");
        return items;
    }

    /** Condición WHERE del LOAD (null si no hay). */
    public static String where(Spec spec) {
        List<String> parts = new ArrayList<>();
        for (ColSpec c : spec.columns) if ("remove".equals(c.nulls)) parts.add("NOT IsNull([" + c.source + "])");
        if (spec.filter != null) {
            Map<String, String> alias = new HashMap<>();
            for (ColSpec c : spec.columns) if (!c.out().equals(c.source)) alias.put(c.out(), c.source);
            String f = rewriteRefs(spec.filter, alias);
            parts.add(parts.isEmpty() ? f : "(" + f + ")");
        }
        return parts.isEmpty() ? null : String.join(" AND ", parts);
    }

    /** Reemplaza referencias [alias] por [origen] (en el script los campos son los de la fuente). */
    static String rewriteRefs(String expr, Map<String, String> alias) {
        if (alias.isEmpty()) return expr;
        Matcher m = Pattern.compile("\\[([^\\]]+)\\]").matcher(expr);
        StringBuilder sb = new StringBuilder();
        while (m.find()) { String f = m.group(1).trim(); m.appendReplacement(sb, Matcher.quoteReplacement("[" + alias.getOrDefault(f, f) + "]")); }
        m.appendTail(sb);
        return sb.toString();
    }

    /* ============================== Script -> Spec ============================== */

    /** Bloque de carga reconstruido desde el script. */
    public record Parsed(String tableName, String sql, String fileKey, Spec spec, boolean loadAll) {}

    private static final Pattern SQL_BLOCK = Pattern.compile(
            "(?is)(?:\\[([^\\]]+)\\]|([\\p{L}_][\\p{L}\\w.]*))\\s*:\\s*LOAD\\s+(DISTINCT\\s+)?(.*?)(?:\\s+WHERE\\s+(.*?))?\\s*;\\s*SQL\\s+(.+?)\\s*;?\\s*$");
    private static final Pattern FILE_BLOCK = Pattern.compile(
            "(?is)(?:\\[([^\\]]+)\\]|([\\p{L}_][\\p{L}\\w.]*))\\s*:\\s*LOAD\\s+(DISTINCT\\s+)?(.*?)\\s+FROM\\s+\\[lib://[^/\\]]+/([^\\]]+)\\]\\s*(?:\\([^)]*\\))?\\s*(?:WHERE\\s+(.*?))?\\s*;\\s*$");

    /**
     * Interpreta un bloque de carga (el que genera {@link #loadItems}/LoadScripts):
     * {@code [Tabla]: LOAD [DISTINCT] campos [WHERE cond]; SQL SELECT …;} o con
     * {@code FROM [lib://conexión/archivo]}. Las columnas de origen conocidas que
     * no aparecen quedan excluidas.
     */
    public static Parsed parseBlock(String script, List<String> knownSources) {
        if (script == null || script.isBlank()) throw new IllegalArgumentException("El script está vacío.");
        StringBuilder clean = new StringBuilder();
        for (String line : script.split("\\r?\\n")) {
            String t = line.trim();
            if (t.startsWith("//") || t.isEmpty()) continue;
            clean.append(line).append('\n');
        }
        String body = clean.toString().replaceAll("(?is)LIB\\s+CONNECT\\s+TO\\s+'(?:[^']|'')*'\\s*;", "").trim();
        String name, fields, cond, sql = null, key = null;
        boolean distinct;
        Matcher m = SQL_BLOCK.matcher(body);
        if (m.find()) {
            name = m.group(1) != null ? m.group(1) : m.group(2);
            distinct = m.group(3) != null; fields = m.group(4); cond = m.group(5); sql = m.group(6).trim().replaceAll(";\\s*$", "");
        } else {
            m = FILE_BLOCK.matcher(body);
            if (!m.find()) throw new IllegalArgumentException("No se reconoce el bloque. Formato esperado:\n[Tabla]:\nLOAD campo1, campo2 AS [Nuevo], …\nWHERE NOT IsNull([campo1]);\nSQL SELECT … FROM …;");
            name = m.group(1) != null ? m.group(1) : m.group(2);
            distinct = m.group(3) != null; fields = m.group(4); key = m.group(5).trim(); cond = m.group(6);
        }

        List<ColSpec> cols = new ArrayList<>();
        List<Computed> comp = new ArrayList<>();
        Set<String> used = new LinkedHashSet<>();
        boolean loadAll = fields.trim().equals("*");
        if (!loadAll) {
            for (String item : splitTop(fields, ",")) {
                String it = item.trim();
                if (it.isEmpty()) continue;
                String expr = it, alias = null;
                int as = lastTopAs(it);
                if (as >= 0) { expr = it.substring(0, as).trim(); alias = unbracket(it.substring(as + 4).trim()); }
                ColSpec c = peel(expr, alias);
                if (c != null && !used.contains(c.source) && (knownSources == null || knownSources.isEmpty() || knownSources.contains(c.source))) {
                    used.add(c.source);
                    cols.add(c);
                } else {
                    if (alias == null) throw new IllegalArgumentException("La expresión «" + expr + "» necesita un nombre: añade AS [Nombre].");
                    try { RowExpression.compile(expr); } catch (RowExpression.ExprError e) { throw new IllegalArgumentException("En «" + it + "»: " + e.getMessage()); }
                    comp.add(new Computed(alias, expr));
                }
            }
        }
        // Columnas conocidas no listadas -> excluidas (se conservan para poder volver a incluirlas).
        if (knownSources != null) {
            for (String s : knownSources) {
                if (used.contains(s)) continue;
                cols.add(new ColSpec(s, loadAll, s, "auto", "none", "keep", null));
            }
            // Orden de las columnas = orden de origen.
            Map<String, Integer> pos = new HashMap<>();
            for (int i = 0; i < knownSources.size(); i++) pos.put(knownSources.get(i), i);
            cols.sort(Comparator.comparingInt(c -> pos.getOrDefault(c.source, Integer.MAX_VALUE)));
        }
        String filter = null;
        if (cond != null && !cond.isBlank()) {
            List<String> rest = new ArrayList<>();
            Pattern nn = Pattern.compile("(?i)^NOT\\s+IsNull\\(\\s*\\[([^\\]]+)\\]\\s*\\)$");
            for (String part : splitTopWord(cond, "AND")) {
                String p = part.trim();
                Matcher mm = nn.matcher(p);
                if (mm.matches()) {
                    String src = mm.group(1).trim();
                    boolean found = false;
                    for (int i = 0; i < cols.size(); i++) {
                        ColSpec c = cols.get(i);
                        if (c.source.equals(src)) { cols.set(i, new ColSpec(c.source, c.include, c.name, c.type, c.text, "remove", null)); found = true; }
                    }
                    if (!found) cols.add(new ColSpec(src, false, src, "auto", "none", "remove", null));
                } else rest.add(stripParens(p));
            }
            if (!rest.isEmpty()) {
                filter = rest.size() == 1 ? rest.get(0) : "(" + String.join(") AND (", rest) + ")";
                try { RowExpression.compile(filter); } catch (RowExpression.ExprError e) { throw new IllegalArgumentException("WHERE: " + e.getMessage()); }
            }
        }
        return new Parsed(name, sql, key, new Spec(cols, comp, filter, distinct), loadAll);
    }

    /** Reconoce Round(Num(…)) / Num / Text / Date, Alt(…,'v'), Trim/Upper/Lower y [campo]. null si es una expresión libre. */
    private static ColSpec peel(String expr, String alias) {
        String e = expr.trim(), type = "auto", text = "none", nulls = "keep", fill = null;
        String in;
        if ((in = unwrap(e, "Round")) != null && splitTop(in, ",").size() == 1 && (in = unwrap(in.trim(), "Num")) != null) { type = "integer"; e = in.trim(); }
        else if ((in = unwrap(e, "Num")) != null) { type = "decimal"; e = in.trim(); }
        else if ((in = unwrap(e, "Text")) != null) { type = "text"; e = in.trim(); }
        else if ((in = unwrap(e, "Date")) != null) { type = "date"; e = in.trim(); }
        if ((in = unwrap(e, "Alt")) != null) {
            List<String> args = splitTop(in, ",");
            if (args.size() != 2) return null;
            String lit = args.get(1).trim();
            if (lit.length() >= 2 && lit.startsWith("'") && lit.endsWith("'")) fill = lit.substring(1, lit.length() - 1).replace("''", "'");
            else if (lit.matches("-?\\d+(\\.\\d+)?")) fill = lit;
            else return null;
            nulls = "fill"; e = args.get(0).trim();
        }
        for (String op : List.of("Trim", "Upper", "Lower")) {
            if ((in = unwrap(e, op)) != null) { text = op.toLowerCase(Locale.ROOT); e = in.trim(); break; }
        }
        Matcher f = Pattern.compile("^\\[([^\\]]+)\\]$").matcher(e);
        String src;
        if (f.matches()) src = f.group(1).trim();
        else if (e.matches("[\\p{L}_][\\p{L}\\w]*")) src = e;
        else return null;
        return new ColSpec(src, true, alias == null ? src : alias, type, text, nulls, fill);
    }

    private static String unbracket(String s) {
        String t = s.trim();
        if (t.startsWith("[") && t.endsWith("]")) return t.substring(1, t.length() - 1).trim();
        if (t.startsWith("\"") && t.endsWith("\"")) return t.substring(1, t.length() - 1).trim();
        return t;
    }

    private static String stripParens(String s) {
        String t = s.trim();
        while (t.startsWith("(") && t.endsWith(")") && matchingParen(t, 0) == t.length() - 1) t = t.substring(1, t.length() - 1).trim();
        return t;
    }

    /** Si expr es exactamente fn( … ), devuelve el contenido; si no, null. */
    private static String unwrap(String expr, String fn) {
        String e = expr.trim();
        if (e.length() <= fn.length() + 1 || !e.regionMatches(true, 0, fn, 0, fn.length())) return null;
        String rest = e.substring(fn.length()).trim();
        if (!rest.startsWith("(") || matchingParen(rest, 0) != rest.length() - 1) return null;
        return rest.substring(1, rest.length() - 1);
    }

    private static int matchingParen(String s, int open) {
        int depth = 0; boolean br = false; char qc = 0;
        for (int i = open; i < s.length(); i++) {
            char c = s.charAt(i);
            if (qc != 0) { if (c == qc) qc = 0; continue; }
            if (br) { if (c == ']') br = false; continue; }
            if (c == '\'' || c == '"') qc = c;
            else if (c == '[') br = true;
            else if (c == '(') depth++;
            else if (c == ')') { depth--; if (depth == 0) return i; }
        }
        return -1;
    }

    /** Divide por un separador de un carácter fuera de corchetes, comillas y paréntesis. */
    static List<String> splitTop(String s, String sep) {
        List<String> out = new ArrayList<>();
        int depth = 0, start = 0; boolean br = false; char qc = 0;
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (qc != 0) { if (c == qc) qc = 0; continue; }
            if (br) { if (c == ']') br = false; continue; }
            if (c == '\'' || c == '"') qc = c;
            else if (c == '[') br = true;
            else if (c == '(') depth++;
            else if (c == ')') depth--;
            else if (depth == 0 && s.startsWith(sep, i)) { out.add(s.substring(start, i)); start = i + sep.length(); }
        }
        out.add(s.substring(start));
        return out;
    }

    /** Divide por una palabra clave (AND) a nivel superior. */
    private static List<String> splitTopWord(String s, String word) {
        List<String> out = new ArrayList<>();
        int depth = 0, start = 0; boolean br = false; char qc = 0;
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (qc != 0) { if (c == qc) qc = 0; continue; }
            if (br) { if (c == ']') br = false; continue; }
            if (c == '\'' || c == '"') qc = c;
            else if (c == '[') br = true;
            else if (c == '(') depth++;
            else if (c == ')') depth--;
            else if (depth == 0 && i > 0 && Character.isWhitespace(s.charAt(i - 1)) && s.regionMatches(true, i, word, 0, word.length())
                    && i + word.length() < s.length() && Character.isWhitespace(s.charAt(i + word.length()))) {
                out.add(s.substring(start, i)); start = i + word.length();
            }
        }
        out.add(s.substring(start));
        return out;
    }

    /** Posición del último " AS " a nivel superior (para alias). -1 si no hay. */
    private static int lastTopAs(String s) {
        int depth = 0, found = -1; boolean br = false; char qc = 0;
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (qc != 0) { if (c == qc) qc = 0; continue; }
            if (br) { if (c == ']') br = false; continue; }
            if (c == '\'' || c == '"') qc = c;
            else if (c == '[') br = true;
            else if (c == '(') depth++;
            else if (c == ')') depth--;
            else if (depth == 0 && i > 0 && Character.isWhitespace(c) && s.regionMatches(true, i + 1, "AS", 0, 2)
                    && i + 3 < s.length() && Character.isWhitespace(s.charAt(i + 3))) found = i;
        }
        return found;
    }
}
