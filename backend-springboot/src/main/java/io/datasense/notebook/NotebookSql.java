package io.datasense.notebook;

import io.datasense.engine.DataFrame;
import io.datasense.engine.ExprLang;
import io.datasense.engine.transform.RowExpression;

import java.util.*;
import java.util.function.Function;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Ejecutor SQL del cuaderno de análisis sobre las tablas en memoria de una app.
 *
 * <pre>
 *   SELECT [DISTINCT] expr [AS alias], …  |  *
 *   FROM tabla
 *   [WHERE condición]
 *   [GROUP BY expr|alias|n, …]
 *   [HAVING condición]
 *   [ORDER BY expr|alias|n [ASC|DESC], …]
 *   [LIMIT n]
 * </pre>
 *
 * Agregaciones: SUM, AVG, COUNT, COUNT(*), COUNT(DISTINCT x), MIN, MAX, MEDIAN, STDDEV y PERCENTILE(x, p), todas con
 * {@code FILTER (WHERE …)}, y combinables con aritmética ({@code ROUND(100.0 * COUNT(*) FILTER (WHERE …) / COUNT(*), 2)}).
 * Las expresiones por fila usan el mismo SQL que medidas y dimensiones (CASE WHEN, IN, LIKE, BETWEEN, ||, CAST,
 * UPPER, YEAR…): se traducen con {@link ExprLang} y se evalúan con {@link RowExpression}.
 * Una sola tabla por consulta (el modelo ya asocia las tablas; JOIN no está disponible).
 */
public final class NotebookSql {

    public static final int DEFAULT_LIMIT = 1000, MAX_LIMIT = 10000;

    /** Error legible para el usuario (se devuelve como 400). */
    public static final class SqlError extends RuntimeException {
        public SqlError(String m) { super(m); }
    }

    /** Resultado tabular. {@code types}: number|text por columna. */
    public record Result(List<String> columns, List<String> types, List<List<Object>> rows, int totalRows, boolean truncated,
                         String table, long ms) {}

    private static final Set<String> AGGS = Set.of("SUM", "AVG", "COUNT", "MIN", "MAX", "MEDIAN", "STDDEV", "STDEV", "PERCENTILE");
    private static final Pattern CLAUSE = Pattern.compile("(?i)\\b(SELECT|FROM|WHERE|GROUP\\s+BY|HAVING|ORDER\\s+BY|LIMIT)\\b");

    private NotebookSql() {}

    /* ===================================== API ===================================== */

    public static Result run(String sql, Map<String, DataFrame> frames) {
        long t0 = System.currentTimeMillis();
        String src = stripComments(sql == null ? "" : sql).strip();
        while (src.endsWith(";")) src = src.substring(0, src.length() - 1).strip();
        if (src.isEmpty()) throw new SqlError("Escribe una consulta, por ejemplo: SELECT * FROM tabla LIMIT 100");
        if (topLevelIndexOf(src, ";") >= 0) throw new SqlError("Una celda ejecuta una sola consulta: quita el «;» del medio o usa otra celda.");
        if (!src.regionMatches(true, 0, "SELECT", 0, 6) && !src.regionMatches(true, 0, "WITH", 0, 4))
            throw new SqlError("El cuaderno solo ejecuta consultas de lectura: empieza con SELECT.");
        if (src.regionMatches(true, 0, "WITH", 0, 4)) throw new SqlError("WITH (CTE) no está disponible todavía: encadena celdas o usa subconsultas en otra celda.");

        Map<String, String> cl = clauses(src);
        String from = cl.get("FROM");
        if (from == null || from.isBlank()) throw new SqlError("Falta FROM: indica la tabla, por ejemplo FROM ventas.");
        if (Pattern.compile("(?i)\\bJOIN\\b|,").matcher(stripQuoted(from)).find())
            throw new SqlError("JOIN no está disponible: una consulta lee una tabla. Las tablas ya se relacionan en el modelo por sus campos comunes.");
        String table = resolveTable(unquote(from.strip()), frames);
        DataFrame df = frames.get(table);
        List<String> cols = df.columns();

        // ---- SELECT ----
        String sel = cl.getOrDefault("SELECT", "").strip();
        boolean distinct = false;
        if (sel.regionMatches(true, 0, "DISTINCT ", 0, 9)) { distinct = true; sel = sel.substring(9).strip(); }
        if (sel.isEmpty()) throw new SqlError("Indica qué columnas quieres: SELECT columna, … o SELECT *.");
        List<Item> items = new ArrayList<>();
        for (String part : splitTop(sel, ',')) {
            String p = part.strip();
            if (p.equals("*")) { for (String c : cols) items.add(new Item(quote(c), c)); continue; }
            String[] ea = splitAlias(p);
            Item it = new Item(ea[0], ea[1] != null ? ea[1] : defaultName(ea[0], items.size()));
            it.aliased = ea[1] != null;
            items.add(it);
        }
        uniqueNames(items);

        // ---- agregaciones ----
        List<Agg> aggs = new ArrayList<>();
        boolean grouped = cl.containsKey("GROUP BY");
        for (Item it : items) { it.post = extractAggs(it.expr, aggs); if (!it.post.equals(it.expr)) it.agg = true; }
        boolean anyAgg = items.stream().anyMatch(i -> i.agg);

        Set<String> names = new LinkedHashSet<>(cols);
        for (Agg a : aggs) names.add(a.slot);
        // Solo los alias explícitos (AS) se pueden usar en otras expresiones; el nombre por defecto no.
        Set<String> aliasNames = new LinkedHashSet<>();
        for (Item it : items) if (it.aliased) aliasNames.add(it.name);

        // HAVING / ORDER BY: se calculan como columnas ocultas (pueden usar agregaciones y alias).
        String havingSrc = cl.get("HAVING");
        Item having = null;
        if (havingSrc != null) {
            if (!grouped && !anyAgg) throw new SqlError("HAVING necesita GROUP BY o una agregación; para filtrar filas usa WHERE.");
            having = new Item(havingSrc.strip(), "__having");
            having.post = extractAggs(having.expr, aggs);
            having.agg = true;
        }
        List<Order> orders = new ArrayList<>();
        if (cl.get("ORDER BY") != null) {
            for (String part : splitTop(cl.get("ORDER BY"), ',')) {
                String p = part.strip(); boolean desc = false;
                Matcher m = Pattern.compile("(?i)\\s+(ASC|DESC)\\s*$").matcher(p);
                if (m.find()) { desc = m.group(1).equalsIgnoreCase("DESC"); p = p.substring(0, m.start()).strip(); }
                Order o = new Order(desc);
                if (p.matches("\\d+")) {
                    int n = Integer.parseInt(p);
                    if (n < 1 || n > items.size()) throw new SqlError("ORDER BY " + n + ": la consulta tiene " + items.size() + " columnas.");
                    o.index = n - 1;
                } else {
                    String u = unquote(p);
                    int idx = -1;
                    for (int i = 0; i < items.size(); i++) if (items.get(i).name.equalsIgnoreCase(u)) { idx = i; break; }
                    if (idx >= 0) o.index = idx;
                    else { o.hidden = new Item(p, "__o" + orders.size()); o.hidden.post = extractAggs(p, aggs); o.hidden.agg = !o.hidden.post.equals(p); }
                }
                orders.add(o);
            }
        }
        for (Agg a : aggs) names.add(a.slot);
        if (anyAgg && !grouped) {
            List<String> plain = items.stream().filter(i -> !i.agg && !i.expr.strip().matches("-?[\\d.]+|'.*'")).map(i -> i.name).toList();
            if (!plain.isEmpty()) throw new SqlError("Mezclas columnas con agregaciones: agrega GROUP BY " + String.join(", ", plain) + ".");
        }
        boolean aggregate = grouped || anyAgg || (having != null) || orders.stream().anyMatch(o -> o.hidden != null && o.hidden.agg);

        // ---- compilar ----
        Function<String, RowExpression> compile = (expr) -> compileRow(expr, names, aliasNames);
        for (Agg a : aggs) {
            a.argNode = a.star ? null : compileRow(a.arg, new LinkedHashSet<>(cols), Set.of());
            a.filterNode = a.filter == null ? null : compileRow(a.filter, new LinkedHashSet<>(cols), Set.of());
            if (a.pctNode != null) a.p = a.pctNode;
        }
        // En el SELECT, cada columna ve los alias de las columnas ANTERIORES (SELECT a*2 AS b, b+1 AS c).
        Set<String> prevAliases = new LinkedHashSet<>();
        for (Item it : items) {
            it.node = compileRow(it.post, names, prevAliases);
            if (it.aliased && !cols.contains(it.name)) prevAliases.add(it.name);
        }
        if (having != null) having.node = compile.apply(having.post);
        for (Order o : orders) if (o.hidden != null) o.hidden.node = compile.apply(o.hidden.post);
        String whereSrc = cl.get("WHERE");
        RowExpression where = whereSrc == null ? null : compileRow(whereSrc, new LinkedHashSet<>(cols), Set.of());
        if (where != null && !aggs.isEmpty() && containsAgg(whereSrc)) throw new SqlError("WHERE no admite agregaciones (SUM, COUNT…): usa HAVING.");

        // ---- filas de origen ----
        Map<String, Integer> pos = new HashMap<>();
        for (int i = 0; i < cols.size(); i++) pos.put(cols.get(i), i);
        List<List<String>> rows = df.rows();
        List<Integer> keep = new ArrayList<>();
        for (int r = 0; r < rows.size(); r++) {
            if (where == null) { keep.add(r); continue; }
            final List<String> row = rows.get(r);
            if (RowExpression.truthy(safeEval(where, f -> cell(row, pos, f), "WHERE"))) keep.add(r);
        }

        List<Map<String, Object>> outRows = new ArrayList<>();   // valores por nombre (columnas visibles + ocultas)
        if (aggregate) {
            // ---- grupos ----
            List<RowExpression> keys = new ArrayList<>();
            if (grouped) {
                for (String g : splitTop(cl.get("GROUP BY"), ',')) {
                    String p = g.strip();
                    String expr = p;
                    if (p.matches("\\d+")) {
                        int n = Integer.parseInt(p);
                        if (n < 1 || n > items.size()) throw new SqlError("GROUP BY " + n + ": la consulta tiene " + items.size() + " columnas.");
                        expr = items.get(n - 1).expr;
                    } else {
                        String u = unquote(p);
                        for (Item it : items) if (it.name.equalsIgnoreCase(u) && !cols.contains(u)) { expr = it.expr; break; }
                    }
                    if (containsAgg(expr)) throw new SqlError("GROUP BY no admite agregaciones: agrupa por columnas o expresiones por fila.");
                    keys.add(compileRow(expr, new LinkedHashSet<>(cols), Set.of()));
                }
            }
            LinkedHashMap<String, List<Integer>> groups = new LinkedHashMap<>();
            for (int r : keep) {
                StringBuilder k = new StringBuilder();
                final List<String> row = rows.get(r);
                for (RowExpression ke : keys) k.append(RowExpression.format(safeEval(ke, f -> cell(row, pos, f), "GROUP BY"))).append('\u0001');
                groups.computeIfAbsent(k.toString(), x -> new ArrayList<>()).add(r);
            }
            if (groups.isEmpty() && !grouped) groups.put("", List.of());   // agregación sin filas: una fila (COUNT = 0)
            for (List<Integer> g : groups.values()) {
                Map<String, Object> vals = new HashMap<>();
                for (Agg a : aggs) vals.put(a.slot, a.compute(g, rows, pos));
                final List<String> first = g.isEmpty() ? null : rows.get(g.get(0));
                Map<String, Object> out = new LinkedHashMap<>();
                Function<String, String> look = f -> {
                    if (vals.containsKey(f)) return RowExpression.format(vals.get(f));
                    if (out.containsKey(f) && !pos.containsKey(f)) return RowExpression.format(out.get(f));
                    return first == null ? null : cell(first, pos, f);
                };
                for (Item it : items) out.put(it.name, clean(safeEval(it.node, look, it.name)));
                if (having != null && !RowExpression.truthy(safeEval(having.node, look, "HAVING"))) continue;
                for (Order o : orders) if (o.hidden != null) out.put(o.hidden.name, clean(safeEval(o.hidden.node, look, "ORDER BY")));
                outRows.add(out);
            }
        } else {
            for (int r : keep) {
                final List<String> row = rows.get(r);
                Map<String, Object> out = new LinkedHashMap<>();
                Function<String, String> look = f -> (out.containsKey(f) && !pos.containsKey(f)) ? RowExpression.format(out.get(f)) : cell(row, pos, f);
                for (Item it : items) out.put(it.name, clean(safeEval(it.node, look, it.name)));
                for (Order o : orders) if (o.hidden != null) out.put(o.hidden.name, clean(safeEval(o.hidden.node, look, "ORDER BY")));
                outRows.add(out);
            }
        }

        // ---- DISTINCT, ORDER BY, LIMIT ----
        if (distinct) {
            LinkedHashMap<String, Map<String, Object>> seen = new LinkedHashMap<>();
            for (Map<String, Object> o : outRows) {
                StringBuilder k = new StringBuilder();
                for (Item it : items) k.append(RowExpression.format(o.get(it.name))).append('\u0001');
                seen.putIfAbsent(k.toString(), o);
            }
            outRows = new ArrayList<>(seen.values());
        }
        if (!orders.isEmpty()) {
            Comparator<Map<String, Object>> cmp = null;
            for (Order o : orders) {
                String key = o.index >= 0 ? items.get(o.index).name : o.hidden.name;
                Comparator<Map<String, Object>> c = (a, b) -> compareValues(a.get(key), b.get(key));
                if (o.desc) c = c.reversed();
                // los vacíos siempre al final
                Comparator<Map<String, Object>> nullsLast = (a, b) -> {
                    boolean na = a.get(key) == null, nb = b.get(key) == null;
                    return na == nb ? 0 : na ? 1 : -1;
                };
                Comparator<Map<String, Object>> cc = nullsLast.thenComparing(c);
                cmp = cmp == null ? cc : cmp.thenComparing(cc);
            }
            outRows.sort(cmp);
        }
        int limit = DEFAULT_LIMIT;
        if (cl.get("LIMIT") != null) {
            String l = cl.get("LIMIT").strip();
            if (!l.matches("\\d+")) throw new SqlError("LIMIT necesita un número entero, por ejemplo LIMIT 100.");
            limit = Math.min(MAX_LIMIT, Integer.parseInt(l));
        }
        int total = outRows.size();
        boolean truncated = total > limit;
        if (truncated) outRows = outRows.subList(0, limit);

        List<String> names2 = new ArrayList<>(), types = new ArrayList<>();
        for (Item it : items) names2.add(it.name);
        List<List<Object>> data = new ArrayList<>(outRows.size());
        for (Map<String, Object> o : outRows) { List<Object> r = new ArrayList<>(items.size()); for (Item it : items) r.add(o.get(it.name)); data.add(r); }
        for (int c = 0; c < names2.size(); c++) {
            boolean num = false, other = false;
            for (List<Object> r : data) { Object v = r.get(c); if (v == null) continue; if (v instanceof Number) num = true; else other = true; }
            types.add(num && !other ? "number" : "text");
        }
        return new Result(names2, types, data, total, truncated, table, System.currentTimeMillis() - t0);
    }

    /* ===================================== piezas ===================================== */

    private static final class Item {
        final String expr, name; String post; boolean agg, aliased; RowExpression node;
        Item(String expr, String name) { this.expr = expr; this.name = name; }
    }

    private static final class Order {
        final boolean desc; int index = -1; Item hidden;
        Order(boolean desc) { this.desc = desc; }
    }

    /** Una agregación extraída de una expresión; su valor por grupo se expone como el campo {@code slot}. */
    private static final class Agg {
        String fn, arg, filter, slot; boolean star, distinct; RowExpression argNode, filterNode; Double p, pctNode;

        Object compute(List<Integer> group, List<List<String>> rows, Map<String, Integer> pos) {
            List<Object> vals = new ArrayList<>();
            for (int r : group) {
                final List<String> row = rows.get(r);
                Function<String, String> look = f -> cell(row, pos, f);
                if (filterNode != null && !RowExpression.truthy(safeEval(filterNode, look, "FILTER"))) continue;
                if (star) { vals.add(1); continue; }
                Object v = safeEval(argNode, look, fn);
                if (v == null || (v instanceof String s && s.isBlank())) continue;
                vals.add(v);
            }
            if (distinct) {
                LinkedHashMap<String, Object> u = new LinkedHashMap<>();
                for (Object v : vals) u.putIfAbsent(RowExpression.format(v), v);
                vals = new ArrayList<>(u.values());
            }
            switch (fn) {
                case "COUNT": return (long) vals.size();
                case "MIN": case "MAX": {
                    Object best = null;
                    for (Object v : vals) if (best == null || (fn.equals("MIN") ? compareValues(v, best) < 0 : compareValues(v, best) > 0)) best = v;
                    return best == null ? null : toNumberIfPossible(best);
                }
                default: {
                    List<Double> ds = new ArrayList<>();
                    for (Object v : vals) { Double d = num(v); if (d != null) ds.add(d); }
                    if (ds.isEmpty()) return "SUM".equals(fn) ? 0L : null;
                    switch (fn) {
                        case "SUM": { double s = 0; for (double d : ds) s += d; return s; }
                        case "AVG": { double s = 0; for (double d : ds) s += d; return s / ds.size(); }
                        case "MEDIAN": return quantile(ds, 0.5);
                        case "PERCENTILE": return quantile(ds, p == null ? 0.5 : p);
                        default: { // STDDEV muestral
                            if (ds.size() < 2) return null;
                            double m = 0; for (double d : ds) m += d; m /= ds.size();
                            double s = 0; for (double d : ds) s += (d - m) * (d - m);
                            return Math.sqrt(s / (ds.size() - 1));
                        }
                    }
                }
            }
        }
    }

    /** Reemplaza cada AGG(...) [FILTER (WHERE ...)] por "__aN" y la registra en {@code aggs}. */
    private static String extractAggs(String expr, List<Agg> aggs) {
        StringBuilder out = new StringBuilder();
        int i = 0, n = expr.length();
        while (i < n) {
            char ch = expr.charAt(i);
            if (ch == '\'' || ch == '"') { int j = skipQuoted(expr, i); out.append(expr, i, j); i = j; continue; }
            if (Character.isLetter(ch) && (i == 0 || !isIdent(expr.charAt(i - 1)))) {
                int j = i; while (j < n && isIdent(expr.charAt(j))) j++;
                String word = expr.substring(i, j).toUpperCase(Locale.ROOT);
                int k = j; while (k < n && Character.isWhitespace(expr.charAt(k))) k++;
                if (AGGS.contains(word) && k < n && expr.charAt(k) == '(') {
                    int close = matchParen(expr, k);
                    String inner = expr.substring(k + 1, close).strip();
                    Agg a = new Agg();
                    a.fn = word.equals("STDEV") ? "STDDEV" : word;
                    if (containsAgg(inner)) throw new SqlError("No se puede anidar una agregación dentro de otra (" + word + "(…" + ")).");
                    if (inner.equals("*")) { if (!a.fn.equals("COUNT")) throw new SqlError(word + "(*) no existe: usa " + word + "(columna)."); a.star = true; }
                    else {
                        if (inner.regionMatches(true, 0, "DISTINCT ", 0, 9)) { a.distinct = true; inner = inner.substring(9).strip(); }
                        if (a.fn.equals("PERCENTILE")) {
                            List<String> ps = splitTop(inner, ',');
                            if (ps.size() != 2) throw new SqlError("PERCENTILE(columna, p): p entre 0 y 1, por ejemplo PERCENTILE(precio, 0.9).");
                            inner = ps.get(0).strip();
                            try { a.pctNode = Double.parseDouble(ps.get(1).strip()); } catch (NumberFormatException e) { throw new SqlError("PERCENTILE: el segundo argumento debe ser un número entre 0 y 1."); }
                            if (a.pctNode < 0 || a.pctNode > 1) throw new SqlError("PERCENTILE: p debe estar entre 0 y 1.");
                        }
                        if (inner.isEmpty()) throw new SqlError(word + "() necesita una columna.");
                        a.arg = inner;
                    }
                    int after = close + 1;
                    Matcher fm = Pattern.compile("(?is)^\\s*FILTER\\s*\\(\\s*WHERE\\s").matcher(expr.substring(after));
                    if (fm.find()) {
                        int fOpen = expr.indexOf('(', after);
                        int fClose = matchParen(expr, fOpen);
                        String f = expr.substring(fOpen + 1, fClose).strip().replaceFirst("(?i)^WHERE\\s+", "");
                        if (containsAgg(f)) throw new SqlError("FILTER (WHERE …) no admite agregaciones.");
                        a.filter = f;
                        after = fClose + 1;
                    }
                    a.slot = "__a" + aggs.size();
                    aggs.add(a);
                    out.append('"').append(a.slot).append('"');
                    i = after;
                    continue;
                }
                out.append(expr, i, j); i = j; continue;
            }
            out.append(ch); i++;
        }
        return out.toString();
    }

    private static boolean containsAgg(String expr) {
        String s = stripQuoted(expr);
        Matcher m = Pattern.compile("(?i)\\b(SUM|AVG|COUNT|MIN|MAX|MEDIAN|STDDEV|STDEV|PERCENTILE)\\s*\\(").matcher(s);
        return m.find();
    }

    private static RowExpression compileRow(String sql, Set<String> fields, Set<String> aliases) {
        Set<String> all = new LinkedHashSet<>(fields);
        all.addAll(aliases);
        String nat;
        try {
            nat = ExprLang.isNative(sql) ? sql : ExprLang.sqlToNative(sql, all);
        } catch (RuntimeException e) {
            throw new SqlError(friendly(e.getMessage(), sql));
        }
        // Un nombre que no es columna, alias ni agregación no debe dar una columna vacía en silencio.
        Set<String> used;
        try { used = ExprLang.fieldsOf(nat, all); } catch (RuntimeException e) { used = Set.of(); }
        for (String u : used) {
            if (all.contains(u)) continue;
            String hint = fields.stream().filter(f -> !f.startsWith("__")).filter(f -> f.equalsIgnoreCase(u)
                    || f.toLowerCase(Locale.ROOT).contains(u.toLowerCase(Locale.ROOT)) || u.toLowerCase(Locale.ROOT).contains(f.toLowerCase(Locale.ROOT)))
                    .findFirst().orElse(null);
            throw new SqlError("La columna «" + u + "» no existe en la tabla." + (hint != null ? " ¿Quisiste decir " + quote(hint) + "?" : "")
                    + " · en: " + (sql.length() > 120 ? sql.substring(0, 117) + "…" : sql));
        }
        try { return RowExpression.compile(nat); }
        catch (RuntimeException e) { throw new SqlError(friendly(e.getMessage(), sql)); }
    }

    private static String friendly(String msg, String sql) {
        String m = msg == null ? "Expresión no válida" : msg.replace("en el modelo de datos", "en la tabla");
        return m + " · en: " + (sql.length() > 120 ? sql.substring(0, 117) + "…" : sql);
    }

    private static Object safeEval(RowExpression e, Function<String, String> look, String where) {
        try { return e.eval(look); }
        catch (RuntimeException ex) { throw new SqlError("Error al calcular " + where + ": " + ex.getMessage()); }
    }

    private static String cell(List<String> row, Map<String, Integer> pos, String f) {
        Integer i = pos.get(f);
        return i == null || i >= row.size() ? null : row.get(i);
    }

    /** Número si el valor lo es (los valores de las tablas llegan como texto). */
    private static Object clean(Object v) {
        if (v == null) return null;
        if (v instanceof Double d) {
            if (d.isNaN() || d.isInfinite()) return null;
            if (d == Math.rint(d) && Math.abs(d) < 1e15) return d.longValue();
            return d;
        }
        if (v instanceof Number || v instanceof Boolean) return v;
        String s = String.valueOf(v);
        if (s.isBlank()) return null;
        return toNumberIfPossible(s);
    }

    private static Object toNumberIfPossible(Object v) {
        if (v instanceof Number) return clean(((Number) v).doubleValue());
        String s = String.valueOf(v).strip();
        // Los códigos con ceros a la izquierda («0123») se quedan como texto.
        if (s.matches("-?(0|[1-9]\\d{0,14})")) return Long.parseLong(s);
        if (s.matches("-?(0|[1-9]\\d*)\\.\\d+([eE]-?\\d+)?")) { double d = Double.parseDouble(s); return clean(d); }
        return s;
    }

    static Double num(Object v) {
        if (v == null) return null;
        if (v instanceof Number n) return n.doubleValue();
        if (v instanceof Boolean b) return b ? 1.0 : 0.0;
        String s = String.valueOf(v).strip();
        if (s.isEmpty()) return null;
        try { return Double.parseDouble(s); } catch (NumberFormatException e) {
            try { return Double.parseDouble(s.replace(".", "").replace(",", ".")); } catch (NumberFormatException e2) { return null; }
        }
    }

    static int compareValues(Object a, Object b) {
        if (a == null || b == null) return a == null ? (b == null ? 0 : 1) : -1;
        Double x = num(a), y = num(b);
        if (x != null && y != null && !(a instanceof String sa && !sa.matches("-?[\\d.,eE]+")) && !(b instanceof String sb && !sb.matches("-?[\\d.,eE]+")))
            return Double.compare(x, y);
        return String.valueOf(a).compareToIgnoreCase(String.valueOf(b));
    }

    static double quantile(List<Double> ds, double p) {
        List<Double> s = new ArrayList<>(ds);
        Collections.sort(s);
        if (s.size() == 1) return s.get(0);
        double idx = p * (s.size() - 1);
        int lo = (int) Math.floor(idx), hi = (int) Math.ceil(idx);
        return s.get(lo) + (s.get(hi) - s.get(lo)) * (idx - lo);
    }

    /* ---------- texto ---------- */

    private static String stripComments(String s) {
        StringBuilder out = new StringBuilder();
        int i = 0;
        while (i < s.length()) {
            char c = s.charAt(i);
            if (c == '\'' || c == '"') { int j = skipQuoted(s, i); out.append(s, i, j); i = j; continue; }
            if (c == '-' && i + 1 < s.length() && s.charAt(i + 1) == '-') { while (i < s.length() && s.charAt(i) != '\n') i++; continue; }
            if (c == '/' && i + 1 < s.length() && s.charAt(i + 1) == '*') { int j = s.indexOf("*/", i + 2); i = j < 0 ? s.length() : j + 2; out.append(' '); continue; }
            out.append(c); i++;
        }
        return out.toString();
    }

    /** Separa las cláusulas de primer nivel (fuera de comillas y paréntesis). */
    private static Map<String, String> clauses(String src) {
        String masked = mask(src);
        Matcher m = CLAUSE.matcher(masked);
        List<int[]> marks = new ArrayList<>();
        List<String> kinds = new ArrayList<>();
        while (m.find()) {
            String k = m.group(1).toUpperCase(Locale.ROOT).replaceAll("\\s+", " ");
            if (kinds.contains(k)) throw new SqlError("La cláusula " + k + " aparece dos veces.");
            marks.add(new int[]{m.start(), m.end()});
            kinds.add(k);
        }
        if (kinds.isEmpty() || !kinds.get(0).equals("SELECT")) throw new SqlError("La consulta debe empezar con SELECT.");
        List<String> order = List.of("SELECT", "FROM", "WHERE", "GROUP BY", "HAVING", "ORDER BY", "LIMIT");
        int last = -1;
        Map<String, String> out = new LinkedHashMap<>();
        for (int i = 0; i < kinds.size(); i++) {
            int o = order.indexOf(kinds.get(i));
            if (o < last) throw new SqlError("Orden de cláusulas: SELECT … FROM … WHERE … GROUP BY … HAVING … ORDER BY … LIMIT.");
            last = o;
            int end = i + 1 < marks.size() ? marks.get(i + 1)[0] : src.length();
            out.put(kinds.get(i), src.substring(marks.get(i)[1], end).strip());
        }
        return out;
    }

    /** Copia del texto con lo que está entre comillas o paréntesis reemplazado por espacios. */
    private static String mask(String s) {
        StringBuilder b = new StringBuilder(s);
        int depth = 0;
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '\'' || c == '"') { int j = skipQuoted(s, i); for (int k = i; k < j; k++) b.setCharAt(k, ' '); i = j - 1; continue; }
            if (c == '(') { depth++; b.setCharAt(i, ' '); continue; }
            if (c == ')') { depth = Math.max(0, depth - 1); b.setCharAt(i, ' '); continue; }
            if (depth > 0) b.setCharAt(i, ' ');
        }
        return b.toString();
    }

    /** Como {@link #mask} pero sin espacios: comillas → «§», paréntesis y su contenido → «·». */
    private static String maskKeep(String s) {
        StringBuilder b = new StringBuilder(s);
        int depth = 0;
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '\'' || c == '"') { int j = skipQuoted(s, i); for (int k = i; k < j; k++) b.setCharAt(k, depth > 0 ? '·' : '§'); i = j - 1; continue; }
            if (c == '(') { depth++; b.setCharAt(i, '·'); continue; }
            if (c == ')') { depth = Math.max(0, depth - 1); b.setCharAt(i, '·'); continue; }
            if (depth > 0) b.setCharAt(i, '·');
        }
        return b.toString();
    }

    private static String stripQuoted(String s) {
        StringBuilder b = new StringBuilder();
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '\'' || c == '"') { int j = skipQuoted(s, i); b.append(" ".repeat(j - i)); i = j - 1; continue; }
            b.append(c);
        }
        return b.toString();
    }

    private static int skipQuoted(String s, int i) {
        char q = s.charAt(i);
        int j = i + 1;
        while (j < s.length()) {
            if (s.charAt(j) == q) { if (j + 1 < s.length() && s.charAt(j + 1) == q) { j += 2; continue; } return j + 1; }
            j++;
        }
        throw new SqlError("Falta cerrar " + (q == '\'' ? "una comilla simple" : "unas comillas dobles") + ".");
    }

    private static int matchParen(String s, int open) {
        int depth = 0;
        for (int i = open; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '\'' || c == '"') { i = skipQuoted(s, i) - 1; continue; }
            if (c == '(') depth++;
            else if (c == ')' && --depth == 0) return i;
        }
        throw new SqlError("Falta cerrar un paréntesis.");
    }

    private static int topLevelIndexOf(String s, String needle) {
        String m = mask(s);
        return m.indexOf(needle);
    }

    static List<String> splitTop(String s, char sep) {
        List<String> out = new ArrayList<>();
        int depth = 0, start = 0;
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '\'' || c == '"') { i = skipQuoted(s, i) - 1; continue; }
            if (c == '(') depth++;
            else if (c == ')') depth--;
            else if (c == sep && depth == 0) { out.add(s.substring(start, i)); start = i + 1; }
        }
        out.add(s.substring(start));
        return out;
    }

    /** "expr AS alias" | "expr alias" (alias simple al final) → [expr, alias|null]. */
    private static String[] splitAlias(String p) {
        // Paréntesis enmascarados con «·» y comillas con «§»: así «COUNT(*) AS n» y «SUM(x) AS "Total ventas"»
        // conservan la posición real de AS y el alias entre comillas cuenta como una sola palabra.
        String masked = maskKeep(p);
        Matcher m = Pattern.compile("(?i)(?<=[\\s·§])AS\\s+(?=\\S+\\s*$)").matcher(masked);
        int at = -1, end = -1;
        while (m.find()) { at = m.start(); end = m.end(); }
        if (at > 0 && !p.substring(0, at).isBlank()) return new String[]{p.substring(0, at).strip(), unquote(p.substring(end).strip())};
        // alias entre comillas dobles sin AS: SUM(x) "Total"
        Matcher q = Pattern.compile("^(.*\\S)\\s+(\"(?:[^\"]|\"\")+\")\\s*$", Pattern.DOTALL).matcher(p);
        if (q.matches() && !q.group(1).strip().endsWith("||") && !Pattern.compile("(?i)(AND|OR|NOT|=|<|>|\\+|-|\\*|/|,|\\(|THEN|ELSE|WHEN|IN|LIKE|IS)$").matcher(q.group(1).strip()).find())
            return new String[]{q.group(1).strip(), unquote(q.group(2))};
        return new String[]{p, null};
    }

    private static String defaultName(String expr, int i) {
        String u = unquote(expr.strip());
        if (u.matches("[\\p{L}_][\\p{L}\\p{N}_ %]*") || expr.strip().matches("\"(?:[^\"]|\"\")+\"")) return u;
        String compact = expr.strip().replaceAll("\\s+", " ");
        return compact.length() <= 40 ? compact : "col" + (i + 1);
    }

    private static void uniqueNames(List<Item> items) {
        Map<String, Integer> seen = new HashMap<>();
        for (int i = 0; i < items.size(); i++) {
            Item it = items.get(i);
            String k = it.name.toLowerCase(Locale.ROOT);
            int n = seen.merge(k, 1, Integer::sum);
            if (n > 1) items.set(i, copyNamed(it, it.name + " (" + n + ")"));
        }
    }

    private static Item copyNamed(Item it, String name) { Item c = new Item(it.expr, name); c.post = it.post; c.agg = it.agg; c.aliased = it.aliased; return c; }

    static String unquote(String s) {
        String t = s.strip();
        if (t.length() >= 2 && ((t.startsWith("\"") && t.endsWith("\"")) || (t.startsWith("`") && t.endsWith("`")) || (t.startsWith("[") && t.endsWith("]"))))
            return t.substring(1, t.length() - 1).replace("\"\"", "\"");
        return t;
    }

    static String quote(String name) { return "\"" + name.replace("\"", "\"\"") + "\""; }

    private static boolean isIdent(char c) { return Character.isLetterOrDigit(c) || c == '_'; }

    private static String resolveTable(String name, Map<String, DataFrame> frames) {
        if (frames.containsKey(name)) return name;
        for (String t : frames.keySet()) if (t.equalsIgnoreCase(name)) return t;
        String key = name.toLowerCase(Locale.ROOT).replaceAll("[^\\p{L}\\p{N}]", "");
        for (String t : frames.keySet()) if (t.toLowerCase(Locale.ROOT).replaceAll("[^\\p{L}\\p{N}]", "").equals(key)) return t;
        throw new SqlError("La tabla «" + name + "» no existe. Tablas de la app: " + String.join(", ", frames.keySet()) + ".");
    }
}
