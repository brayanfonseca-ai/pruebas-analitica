package io.datasense.engine;

import java.text.Normalizer;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;

/**
 * Lenguaje de expresiones de PROTHEO: <b>SQL</b> (estándar abierto) para medidas, dimensiones y el script de carga.
 *
 * <p>Ambas sintaxis se leen a un mismo árbol y se escriben en cualquiera de las dos:
 * <ul>
 *   <li>{@link #sqlToNative}: SQL → formato interno del motor (el que ya evalúan {@link Expressions} y
 *       {@code RowExpression}). Por eso los números con SQL son idénticos a los de antes.</li>
 *   <li>{@link #nativeToSql}: sintaxis anterior ({@code Sum([x])}, {@code If(…)}, {@code &}) → SQL, para convertir
 *       lo que ya existe.</li>
 * </ul>
 *
 * <pre>
 *   SUM(valor)                                    COUNT(DISTINCT cedula)
 *   COUNT(*) FILTER (WHERE estado = 'Inactivo')   100.0 * COUNT(*) FILTER (WHERE x IS NULL) / COUNT(cedula)
 *   CASE WHEN edad >= 40 THEN 'Mayor' ELSE 'Menor' END
 *   sucursal IN ('CALI', 'NEIVA')   ·   nombre LIKE 'AN%'   ·   CAST(valor AS INTEGER)   ·   anio || '-' || mes
 * </pre>
 * Campos: sin comillas ({@code cedula}) o entre comillas dobles si tienen espacios ({@code "ESTADO CONTRATO"}).
 * Sin mayúsculas/minúsculas ni tildes estrictas: {@code estado_contrato} encuentra «ESTADO CONTRATO».
 */
public final class ExprLang {

    private ExprLang() {}

    /* ================================ Árbol ================================ */

    interface N {}
    record Num(String v) implements N {}
    record Str(String v) implements N {}
    record Fld(String name) implements N {}
    record Lit(String kw) implements N {}                                   // null | true | false
    record Call(String fn, List<N> args, boolean distinct, boolean star) implements N {}
    record Bin(String op, N l, N r) implements N {}                          // or and = <> < > <= >= & + - * /
    record Not(N x) implements N {}
    record Neg(N x) implements N {}

    static Call call(String fn, N... a) { return new Call(fn, List.of(a), false, false); }

    private static final Set<String> AGG = Set.of("sum", "avg", "count", "min", "max");
    private static final Map<String, String> NATIVE_NAME = new HashMap<>();
    static {
        for (String s : List.of("If", "IsNull", "Alt", "Upper", "Lower", "Trim", "Len", "Left", "Right", "Mid", "Replace",
                "Round", "Floor", "Ceil", "Abs", "Num", "Text", "Date", "Year", "Month", "Day", "Class", "Match",
                "Sum", "Avg", "Count", "Min", "Max")) NATIVE_NAME.put(s.toLowerCase(Locale.ROOT), s);
    }

    /** ¿El texto está en la sintaxis anterior? (usa corchetes [campo] fuera de un texto). */
    public static boolean isNative(String text) {
        if (text == null) return false;
        boolean q = false; char qc = 0;
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            if (q) { if (c == qc) q = false; continue; }
            if (c == '\'') { q = true; qc = c; continue; }
            if (c == '[') return true;
        }
        return false;
    }

    /* ================================ API ================================ */

    /**
     * SQL → formato interno. {@code fields} = campos del modelo (para resolver nombres sin distinguir mayúsculas,
     * tildes, espacios o «_»); null = se usan tal cual.
     */
    public static String sqlToNative(String sql, Collection<String> fields) {
        if (fields == null) {
            N n = new SqlParser(sql, resolver(null)).parseAll();
            return emitNative(n, firstField(n));
        }
        Map<String, List<String>> idx = new HashMap<>();
        for (String f : fields) if (f != null) idx.put(f, List.of("·"));
        return sqlToNative(sql, idx);
    }

    /**
     * SQL → formato interno resolviendo los nombres por tabla: si «cedula» puede ser {@code cedula} (tabla A) o
     * {@code CEDULA} (tabla B), se elige la tabla donde están todos los campos de la expresión. {@code COUNT(*)} sin
     * otros campos cuenta las filas de la tabla con más campos (la principal).
     */
    public static String sqlToNative(String sql, Map<String, List<String>> fieldIndex) {
        sql = autoQuote(sql, fieldIndex.keySet());
        Set<String> raws = new LinkedHashSet<>();
        new SqlParser(sql, s -> { raws.add(s); return s; }).parseAll();       // 1) nombres tal como se escribieron
        Map<String, String> pick = new HashMap<>();
        if (!raws.isEmpty()) {
            // 2) candidatos por nombre (exacto 3, mayúsculas 2, sin tildes/espacios 1) y la tabla que cubre más
            Map<String, Map<String, Integer>> cands = new HashMap<>();
            Map<String, Integer> tableScore = new HashMap<>();
            for (String r : raws) {
                Map<String, Integer> c = new java.util.LinkedHashMap<>();
                for (String f : fieldIndex.keySet()) {
                    int q = f.equals(r) ? 3 : f.equalsIgnoreCase(r) ? 2 : key(f).equals(key(r)) && !key(r).isEmpty() ? 1 : 0;
                    if (q > 0) c.put(f, q);
                }
                if (c.isEmpty()) resolver(fieldIndex.keySet()).apply(r);           // lanza el error con sugerencia
                cands.put(r, c);
                Map<String, Integer> best = new HashMap<>();
                c.forEach((f, q) -> { for (String t : fieldIndex.getOrDefault(f, List.of())) best.merge(t, q, Math::max); });
                best.forEach((t, q) -> tableScore.merge(t, 1000 + q, Integer::sum));
            }
            String table = tableScore.entrySet().stream().max(Map.Entry.comparingByValue()).map(Map.Entry::getKey).orElse(null);
            for (String r : raws) {
                String chosen = null; int bq = -1, bqAny = -1; String any = null;
                for (var e : cands.get(r).entrySet()) {
                    boolean inT = table != null && fieldIndex.getOrDefault(e.getKey(), List.of()).contains(table);
                    if (inT && e.getValue() > bq) { bq = e.getValue(); chosen = e.getKey(); }
                    if (e.getValue() > bqAny) { bqAny = e.getValue(); any = e.getKey(); }
                }
                pick.put(r, chosen != null ? chosen : any);
            }
        }
        N n = new SqlParser(sql, s -> pick.getOrDefault(s, s)).parseAll();
        String anyField = firstField(n);
        if (anyField == null && !fieldIndex.isEmpty()) {
            // COUNT(*) solo: la tabla con más campos
            Map<String, List<String>> byTable = new HashMap<>();
            fieldIndex.forEach((f, ts) -> ts.forEach(t -> byTable.computeIfAbsent(t, k -> new ArrayList<>()).add(f)));
            List<String> main = byTable.values().stream().max(java.util.Comparator.comparingInt(List::size)).orElse(List.of());
            // un campo que SOLO esté en esa tabla (si está en varias, el motor podría contar otra)
            anyField = main.stream().filter(f -> fieldIndex.getOrDefault(f, List.of()).size() == 1).findFirst().orElse(main.isEmpty() ? null : main.get(0));
        }
        return emitNative(n, anyField);
    }

    /** Formato interno (sintaxis anterior) → SQL legible. */
    public static String nativeToSql(String text) {
        String t = text == null ? "" : text.strip().replaceFirst("^=\\s*", "");
        return emitSql(new NativeParser(t).parseAll(), 0);
    }

    /** Cualquier sintaxis → SQL (si ya es SQL, la normaliza pasando por el árbol). */
    public static String toSql(String text, Collection<String> fields) {
        if (isNative(text)) return nativeToSql(text);
        return emitSql(new SqlParser(text, resolver(fields)).parseAll(), 0);
    }

    /** Cualquier sintaxis → formato interno. */
    public static String toNative(String text, Collection<String> fields) {
        return isNative(text) ? text.strip().replaceFirst("^=\\s*", "") : sqlToNative(text, fields);
    }

    /**
     * Pone comillas dobles a los nombres de campo con espacios o símbolos que se escribieron sin ellas
     * ({@code SUM(VALOR MOVIMIENTO)} → {@code SUM("VALOR MOVIMIENTO")}). Solo fuera de textos y de comillas, con
     * límites de palabra y del nombre más largo al más corto.
     */
    public static String autoQuote(String sql, Collection<String> fields) {
        if (sql == null || fields == null) return sql;
        List<String> multi = new ArrayList<>();
        for (String f : fields) if (f != null && !f.matches("[\\p{L}_][\\p{L}\\p{N}_]*") && f.strip().length() > 1) multi.add(f);
        if (multi.isEmpty()) return sql;
        multi.sort((a, b) -> b.length() - a.length());
        StringBuilder out = new StringBuilder();
        int i = 0, n = sql.length();
        while (i < n) {
            char c = sql.charAt(i);
            if (c == '\'' || c == '"' || c == '`' || c == '[') {
                char close = c == '[' ? ']' : c;
                int j = i + 1;
                while (j < n && sql.charAt(j) != close) j++;
                out.append(sql, i, Math.min(n, j + 1)); i = j + 1; continue;
            }
            boolean startOk = i == 0 || !(Character.isLetterOrDigit(sql.charAt(i - 1)) || sql.charAt(i - 1) == '_');
            String hit = null;
            if (startOk) for (String f : multi) {
                int e = i + f.length();
                if (e <= n && sql.regionMatches(true, i, f, 0, f.length())
                        && (e == n || !(Character.isLetterOrDigit(sql.charAt(e)) || sql.charAt(e) == '_'))) { hit = f; break; }
            }
            if (hit != null) { out.append('"').append(hit.replace("\"", "\"\"")).append('"'); i += hit.length(); continue; }
            out.append(c); i++;
        }
        return out.toString();
    }

    /* ============================ Resolución de campos ============================ */

    static String key(String s) {
        String t = Normalizer.normalize(s == null ? "" : s, Normalizer.Form.NFD).replaceAll("\\p{M}", "");
        return t.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9%]", "");
    }

    static Function<String, String> resolver(Collection<String> fields) {
        if (fields == null) return s -> s;
        Map<String, String> exact = new HashMap<>(), lower = new HashMap<>(), norm = new HashMap<>();
        for (String f : fields) {
            if (f == null) continue;
            exact.put(f, f);
            lower.putIfAbsent(f.toLowerCase(Locale.ROOT), f);
            norm.putIfAbsent(key(f), f);
        }
        return s -> {
            if (exact.containsKey(s)) return exact.get(s);
            String l = lower.get(s.toLowerCase(Locale.ROOT));
            if (l != null) return l;
            String k = norm.get(key(s));
            if (k != null) return k;
            String best = null;
            for (String f : fields) if (f != null && (key(f).contains(key(s)) || key(s).contains(key(f))) && !key(f).isEmpty()) { best = f; break; }
            throw new Expressions.ExpressionError("El campo «" + s + "» no existe en el modelo de datos."
                    + (best != null ? " ¿Quisiste decir \"" + best + "\"?" : ""));
        };
    }

    private static String firstField(N n) {
        if (n instanceof Fld f) return f.name;
        if (n instanceof Call c) { for (N a : c.args) { String s = firstField(a); if (s != null) return s; } }
        if (n instanceof Bin b) { String s = firstField(b.l); return s != null ? s : firstField(b.r); }
        if (n instanceof Not x) return firstField(x.x);
        if (n instanceof Neg x) return firstField(x.x);
        return null;
    }

    /* ================================ Tokens ================================ */

    record Tok(char k, String v, int pos) {}   // k: n número, s texto, i identificador, q campo citado, o operador

    static List<Tok> lex(String s, boolean sql) {
        List<Tok> out = new ArrayList<>();
        int i = 0, n = s.length();
        while (i < n) {
            char c = s.charAt(i);
            if (Character.isWhitespace(c)) { i++; continue; }
            if (sql && c == '-' && i + 1 < n && s.charAt(i + 1) == '-') { while (i < n && s.charAt(i) != '\n') i++; continue; }
            if (c == '[') {
                int j = s.indexOf(']', i + 1);
                if (j < 0) throw err("Falta cerrar el corchete del campo.");
                out.add(new Tok('q', s.substring(i + 1, j).strip(), i)); i = j + 1; continue;
            }
            if (c == '\'' || (!sql && c == '"')) {
                StringBuilder sb = new StringBuilder(); int j = i + 1;
                while (true) {
                    if (j >= n) throw err("Falta cerrar la comilla del texto.");
                    char d = s.charAt(j);
                    if (d == c) { if (j + 1 < n && s.charAt(j + 1) == c) { sb.append(c); j += 2; continue; } break; }
                    sb.append(d); j++;
                }
                out.add(new Tok('s', sb.toString(), i)); i = j + 1; continue;
            }
            if (sql && (c == '"' || c == '`')) {
                StringBuilder sb = new StringBuilder(); int j = i + 1;
                while (true) {
                    if (j >= n) throw err("Falta cerrar la comilla doble del campo.");
                    char d = s.charAt(j);
                    if (d == c) { if (j + 1 < n && s.charAt(j + 1) == c) { sb.append(c); j += 2; continue; } break; }
                    sb.append(d); j++;
                }
                out.add(new Tok('q', sb.toString().strip(), i)); i = j + 1; continue;
            }
            if (Character.isDigit(c) || (c == '.' && i + 1 < n && Character.isDigit(s.charAt(i + 1)))) {
                int j = i;
                while (j < n && (Character.isDigit(s.charAt(j)) || s.charAt(j) == '.')) j++;
                out.add(new Tok('n', s.substring(i, j), i)); i = j; continue;
            }
            if (Character.isLetter(c) || c == '_' || c == '%') {
                int j = i;
                while (j < n && (Character.isLetterOrDigit(s.charAt(j)) || s.charAt(j) == '_' || s.charAt(j) == '%' || (!sql && s.charAt(j) == '.'))) j++;
                out.add(new Tok('i', s.substring(i, j), i)); i = j; continue;
            }
            String two = i + 1 < n ? s.substring(i, i + 2) : "";
            if (List.of("<>", "!=", "<=", ">=", "||", "::", "==").contains(two)) {
                out.add(new Tok('o', two.equals("!=") ? "<>" : two.equals("==") ? "=" : two, i)); i += 2; continue;
            }
            if ("()+-*/=<>,&%".indexOf(c) >= 0) { out.add(new Tok('o', String.valueOf(c), i)); i++; continue; }
            if (sql && c == '.') { out.add(new Tok('o', ".", i)); i++; continue; }   // tabla.campo
            if (c == ';') { i++; continue; }
            throw err("Carácter no válido «" + c + "».");
        }
        return out;
    }

    static Expressions.ExpressionError err(String m) { return new Expressions.ExpressionError(m); }

    /* ================================ Parser común ================================ */

    abstract static class Base {
        final String src; final List<Tok> t; int p = 0;
        Base(String src, boolean sql) { this.src = src; this.t = lex(src, sql); }
        Tok peek() { return p < t.size() ? t.get(p) : null; }
        Tok peek(int k) { return p + k < t.size() ? t.get(p + k) : null; }
        boolean op(String v) { Tok x = peek(); return x != null && x.k == 'o' && x.v.equals(v); }
        boolean word(String w) { Tok x = peek(); return x != null && x.k == 'i' && x.v.equalsIgnoreCase(w); }
        boolean word(int k, String w) { Tok x = peek(k); return x != null && x.k == 'i' && x.v.equalsIgnoreCase(w); }
        void expect(String v) {
            if (!op(v)) throw err("Se esperaba «" + v + "»" + (peek() == null ? " al final" : " antes de «" + peek().v + "»") + ".");
            p++;
        }
        void expectWord(String w) {
            if (!word(w)) throw err("Se esperaba «" + w + "»" + (peek() == null ? " al final" : " antes de «" + peek().v + "»") + ".");
            p++;
        }
        N parseAll() {
            if (t.isEmpty()) throw err("La expresión está vacía.");
            N n = expr();
            if (peek() != null) throw err("Sobra «" + peek().v + "» al final de la expresión.");
            return n;
        }
        N expr() { return or(); }
        N or() { N l = and(); while (word("OR")) { p++; l = new Bin("or", l, and()); } return l; }
        N and() { N l = not(); while (word("AND")) { p++; l = new Bin("and", l, not()); } return l; }
        N not() { if (word("NOT")) { p++; return new Not(not()); } return cmp(); }
        abstract N cmp();
        N concat() {
            N l = add();
            while (op("&") || op("||")) { p++; l = new Bin("&", l, add()); }
            return l;
        }
        N add() {
            N l = mul();
            while (op("+") || op("-")) { String o = peek().v; p++; l = new Bin(o, l, mul()); }
            return l;
        }
        N mul() {
            N l = unary();
            while (op("*") || op("/") || op("%")) {
                if (op("%")) throw err("El operador «%» (módulo) no está disponible.");
                String o = peek().v; p++; l = new Bin(o, l, unary());
            }
            return l;
        }
        N unary() {
            if (op("-")) { p++; N x = unary(); return x instanceof Num nn ? new Num("-" + nn.v) : new Neg(x); }
            if (op("+")) { p++; return unary(); }
            return postfix(primary());
        }
        N postfix(N x) { return x; }
        abstract N primary();
        List<N> args() {
            List<N> a = new ArrayList<>();
            if (op(")")) { p++; return a; }
            while (true) { a.add(expr()); if (op(",")) { p++; continue; } expect(")"); return a; }
        }
        static N cmpNode(String o, N l, N r) { return new Bin(o, l, r); }
    }

    /* ================================ Parser SQL ================================ */

    static final class SqlParser extends Base {
        final Function<String, String> res;
        SqlParser(String src, Function<String, String> res) { super(src, true); this.res = res; }

        @Override N cmp() {
            N l = concat();
            boolean neg = false;
            if (word("IS")) {
                p++;
                if (word("NOT")) { p++; neg = true; }
                expectWord("NULL");
                N n = call("isnull", l);
                return neg ? new Not(n) : n;
            }
            if (word("NOT") && (word(1, "IN") || word(1, "BETWEEN") || word(1, "LIKE") || word(1, "ILIKE"))) { p++; neg = true; }
            if (word("IN")) {
                p++; expect("(");
                List<N> vals = new ArrayList<>(); vals.add(l); vals.addAll(args());
                if (vals.size() < 2) throw err("IN ( ) necesita al menos un valor.");
                return new Bin(neg ? "=" : ">", new Call("match", vals, false, false), new Num("0"));
            }
            if (word("BETWEEN")) {
                p++; N a = concat(); expectWord("AND"); N b = concat();
                N n = new Bin("and", new Bin(">=", l, a), new Bin("<=", l, b));
                return neg ? new Not(n) : n;
            }
            if (word("LIKE") || word("ILIKE")) {
                p++;
                Tok s = peek();
                if (s == null || s.k != 's') throw err("LIKE necesita un patrón de texto, por ejemplo nombre LIKE 'AN%'.");
                p++;
                N n = like(l, s.v);
                return neg ? new Not(n) : n;
            }
            Tok x = peek();
            if (x != null && x.k == 'o' && List.of("=", "<>", "<", ">", "<=", ">=").contains(x.v)) { p++; return cmpNode(x.v, l, concat()); }
            return l;
        }

        static N like(N x, String pat) {
            if (pat.indexOf('_') >= 0) throw err("LIKE con «_» no está disponible; usa % al inicio o al final.");
            boolean st = pat.startsWith("%"), en = pat.endsWith("%") && pat.length() > 1;
            String core = pat.substring(st ? 1 : 0, pat.length() - (en ? 1 : 0));
            if (core.contains("%")) throw err("LIKE admite % solo al inicio y/o al final del patrón.");
            if (core.isEmpty()) return new Lit("true");
            N len = new Num(String.valueOf(core.length()));
            if (!st && !en) return new Bin("=", x, new Str(core));
            if (!st) return new Bin("=", call("left", x, len), new Str(core));
            if (!en) return new Bin("=", call("right", x, len), new Str(core));
            // contiene: el texto sin el patrón es más corto
            N up = call("upper", x);
            return new Bin("<", call("len", call("replace", up, new Str(core.toUpperCase(Locale.ROOT)), new Str(""))), call("len", up));
        }

        @Override N postfix(N x) {
            while (op("::")) { p++; x = cast(x, typeName()); }
            return x;
        }

        String typeName() {
            Tok t0 = peek();
            if (t0 == null || t0.k != 'i') throw err("Falta el tipo de dato (VARCHAR, INTEGER, DOUBLE, DATE).");
            p++;
            String ty = t0.v.toLowerCase(Locale.ROOT);
            if (op("(")) { p++; while (!op(")") && peek() != null) p++; expect(")"); }        // DECIMAL(10,2), VARCHAR(50)
            if (ty.equals("double") && word("PRECISION")) p++;
            return ty;
        }

        static N cast(N x, String ty) {
            return switch (ty) {
                case "varchar", "text", "string", "char", "nvarchar" -> call("text", x);
                case "integer", "int", "bigint", "smallint", "tinyint", "hugeint", "int4", "int8" -> call("round", call("num", x));
                case "double", "float", "real", "decimal", "numeric", "float8", "float4" -> call("num", x);
                case "date", "timestamp", "datetime" -> call("date", x);
                default -> throw err("Tipo no disponible en CAST: " + ty + ". Usa VARCHAR, INTEGER, DOUBLE o DATE.");
            };
        }

        @Override N primary() {
            Tok x = peek();
            if (x == null) throw err("La expresión termina antes de tiempo.");
            p++;
            // tabla.campo / "tabla"."campo": se usa el campo (la tabla la decide la resolución)
            if ((x.k == 'q' || x.k == 'i') && op(".") && peek(1) != null && (peek(1).k == 'q' || peek(1).k == 'i')) {
                p++; Tok f = peek(); p++;
                if (f.k == 'i' && op("(")) throw err("Función no esperada después de «" + x.v + ".».");
                return new Fld(res.apply(f.v));
            }
            switch (x.k) {
                case 'n': return new Num(x.v);
                case 's': return new Str(x.v);
                case 'q': return new Fld(res.apply(x.v));
                case 'o':
                    if (x.v.equals("(")) { N e = expr(); expect(")"); return e; }
                    if (x.v.equals("*")) throw err("«*» solo se usa en COUNT(*).");
                    throw err("Operador inesperado «" + x.v + "».");
                default: break;
            }
            String w = x.v.toLowerCase(Locale.ROOT);
            switch (w) {
                case "null": case "true": case "false": return new Lit(w);
                case "case": return caseExpr();
                case "cast": {
                    expect("("); N e = expr(); expectWord("AS"); String ty = typeName(); expect(")"); return cast(e, ty);
                }
                case "extract": {
                    expect("(");
                    Tok u = peek(); if (u == null) throw err("EXTRACT( unidad FROM fecha ).");
                    p++; expectWord("FROM"); N e = expr(); expect(")");
                    return datePart(u.v, e);
                }
                default: break;
            }
            if (!op("(")) {
                if (Set.of("and", "or", "not", "is", "in", "between", "like", "when", "then", "else", "end", "as", "from", "filter", "where", "distinct").contains(w))
                    throw err("Palabra «" + x.v + "» fuera de lugar.");
                return new Fld(res.apply(x.v));
            }
            p++;
            if (AGG.contains(w)) return aggregate(w);
            List<N> a = args();
            return function(w, x.v, a);
        }

        N aggregate(String fn) {
            boolean distinct = false, star = false;
            N arg = null;
            if (word("DISTINCT")) {
                if (!fn.equals("count")) throw err("DISTINCT solo se admite en COUNT(DISTINCT campo).");
                p++; distinct = true;
            }
            if (op("*")) { if (!fn.equals("count")) throw err("«*» solo se usa en COUNT(*)."); p++; star = true; }
            else arg = expr();
            expect(")");
            N filter = null;
            if (word("FILTER")) { p++; expect("("); expectWord("WHERE"); filter = expr(); expect(")"); }
            if (star) {
                if (distinct) throw err("COUNT(DISTINCT *) no es válido: indica el campo.");
                if (filter != null) return new Call("sum", List.of(call("if", filter, new Num("1"), new Num("0"))), false, false);
                return new Call("count", List.of(), false, true);
            }
            if (filter != null) arg = call("if", filter, arg, fn.equals("sum") ? new Num("0") : new Lit("null"));
            return new Call(fn, List.of(arg), distinct, false);
        }

        N caseExpr() {
            N subject = null;
            if (!word("WHEN")) subject = expr();
            List<N[]> whens = new ArrayList<>();
            while (word("WHEN")) {
                p++; N c = expr(); expectWord("THEN"); N v = expr();
                whens.add(new N[]{subject == null ? c : new Bin("=", subject, c), v});
            }
            if (whens.isEmpty()) throw err("CASE necesita al menos un WHEN … THEN ….");
            N other = null;
            if (word("ELSE")) { p++; other = expr(); }
            expectWord("END");
            N out = other;
            for (int i = whens.size() - 1; i >= 0; i--)
                out = out == null ? call("if", whens.get(i)[0], whens.get(i)[1]) : call("if", whens.get(i)[0], whens.get(i)[1], out);
            return out;
        }

        static N datePart(String unit, N e) {
            return switch (unit.replace("'", "").toLowerCase(Locale.ROOT)) {
                case "year", "years", "yyyy" -> call("year", e);
                case "month", "months", "mm" -> call("month", e);
                case "day", "days", "dd" -> call("day", e);
                default -> throw err("Unidad de fecha no disponible: " + unit + ". Usa YEAR, MONTH o DAY.");
            };
        }

        static N function(String w, String raw, List<N> a) {
            java.util.function.IntConsumer need = k -> { if (a.size() < k) throw err(raw.toUpperCase(Locale.ROOT) + "() necesita " + k + " argumento(s)."); };
            switch (w) {
                case "if": case "iif": need.accept(2); return new Call("if", a, false, false);
                case "coalesce": case "ifnull": case "nvl": case "alt": need.accept(1); return new Call("alt", a, false, false);
                case "nullif": need.accept(2); return call("if", new Bin("=", a.get(0), a.get(1)), new Lit("null"), a.get(0));
                case "upper": case "ucase": return new Call("upper", a, false, false);
                case "lower": case "lcase": return new Call("lower", a, false, false);
                case "trim": case "ltrim": case "rtrim": case "strip": return new Call("trim", a, false, false);
                case "length": case "len": case "char_length": case "character_length": return new Call("len", a, false, false);
                case "substring": case "substr": case "mid": need.accept(2); return new Call("mid", a, false, false);
                case "ceiling": case "ceil": return new Call("ceil", a, false, false);
                case "date_part": case "datepart": {
                    need.accept(2);
                    if (!(a.get(0) instanceof Str s)) throw err("DATE_PART necesita la unidad como texto: DATE_PART('year', fecha).");
                    return datePart(s.v, a.get(1));
                }
                case "concat": {
                    need.accept(1);
                    N out = a.get(0);
                    for (int i = 1; i < a.size(); i++) out = new Bin("&", out, a.get(i));
                    return a.size() == 1 ? new Bin("&", out, new Str("")) : out;
                }
                case "greatest": case "least": {
                    need.accept(2);
                    N out = a.get(0);
                    for (int i = 1; i < a.size(); i++)
                        out = call("if", new Bin(w.equals("greatest") ? ">=" : "<=", out, a.get(i)), out, a.get(i));
                    return out;
                }
                case "to_number": return new Call("num", a, false, false);
                case "to_char": return new Call("text", a.subList(0, 1), false, false);
                case "to_date": return new Call("date", a.subList(0, 1), false, false);
                default:
                    if (NATIVE_NAME.containsKey(w) && !AGG.contains(w)) return new Call(w, a, false, false);
                    throw err("Función no disponible: " + raw.toUpperCase(Locale.ROOT) + ". Usa SUM, COUNT, AVG, MIN, MAX, CASE WHEN, COALESCE, ROUND, "
                            + "UPPER, LOWER, TRIM, LENGTH, SUBSTRING, REPLACE, LEFT, RIGHT, ABS, FLOOR, CEIL, YEAR, MONTH, DAY, CAST o CONCAT.");
            }
        }
    }

    /* ================================ Parser de la sintaxis anterior ================================ */

    static final class NativeParser extends Base {
        NativeParser(String src) { super(src, false); }

        @Override N cmp() {
            N l = concat();
            Tok x = peek();
            if (x != null && x.k == 'o' && List.of("=", "<>", "<", ">", "<=", ">=").contains(x.v)) { p++; return cmpNode(x.v, l, concat()); }
            return l;
        }

        @Override N primary() {
            Tok x = peek();
            if (x == null) throw err("La expresión termina antes de tiempo.");
            p++;
            switch (x.k) {
                case 'n': return new Num(x.v);
                case 's': return new Str(x.v);
                case 'q': return new Fld(x.v);
                case 'o':
                    if (x.v.equals("(")) { N e = expr(); expect(")"); return e; }
                    throw err("Operador inesperado «" + x.v + "».");
                default: break;
            }
            String w = x.v.toLowerCase(Locale.ROOT);
            if (!op("(")) {
                if (Set.of("null", "true", "false").contains(w)) return new Lit(w);
                return new Fld(x.v);
            }
            p++;
            if (AGG.contains(w)) {
                boolean distinct = false;
                if (word("DISTINCT")) { p++; distinct = true; }
                N a = expr(); expect(")");
                return new Call(w, List.of(a), distinct, false);
            }
            return new Call(w, args(), false, false);
        }
    }

    /* ================================ Emisores ================================ */

    private static int prec(N n) {
        if (n instanceof Bin b) return switch (b.op) {
            case "or" -> 1; case "and" -> 2;
            case "=", "<>", "<", ">", "<=", ">=" -> 4;
            case "&" -> 5; case "+", "-" -> 6; default -> 7;
        };
        if (n instanceof Not) return 3;
        if (n instanceof Neg) return 8;
        return 9;
    }

    private static String wrap(String s, N child, int need) { return prec(child) < need ? "(" + s + ")" : s; }

    private static String strLit(String v) { return "'" + v.replace("'", "''") + "'"; }

    /** Formato interno. {@code anyField} sustituye a COUNT(*) (la tabla la da cualquier campo de la expresión). */
    static String emitNative(N n, String anyField) {
        if (n instanceof Num x) return x.v;
        if (n instanceof Str x) return strLit(x.v);
        if (n instanceof Fld x) return "[" + x.name + "]";
        if (n instanceof Lit x) return x.kw;
        if (n instanceof Not x) return "NOT " + wrap(emitNative(x.x, anyField), x.x, 4);
        if (n instanceof Neg x) return "-" + wrap(emitNative(x.x, anyField), x.x, 9);
        if (n instanceof Bin b) {
            int pr = prec(b);
            String op = switch (b.op) { case "or" -> "OR"; case "and" -> "AND"; default -> b.op; };
            int rightNeed = (b.op.equals("-") || b.op.equals("/")) ? pr + 1 : pr;
            if (pr == 4) rightNeed = 5;
            return wrap(emitNative(b.l, anyField), b.l, pr == 4 ? 5 : pr) + " " + op + " " + wrap(emitNative(b.r, anyField), b.r, rightNeed);
        }
        Call c = (Call) n;
        if (c.star) {
            if (anyField == null) throw err("COUNT(*) necesita saber de qué tabla contar: usa COUNT(campo), por ejemplo COUNT(cedula).");
            return "Sum(If(IsNull([" + anyField + "]), 1, 1))";
        }
        String name = NATIVE_NAME.getOrDefault(c.fn, c.fn);
        StringBuilder sb = new StringBuilder(name).append('(');
        if (c.distinct) sb.append("DISTINCT ");
        for (int i = 0; i < c.args.size(); i++) { if (i > 0) sb.append(", "); sb.append(emitNative(c.args.get(i), anyField)); }
        return sb.append(')').toString();
    }

    private static final Set<String> SQL_RESERVED = Set.of("and", "or", "not", "is", "in", "between", "like", "ilike", "case", "when",
            "then", "else", "end", "as", "from", "filter", "where", "distinct", "null", "true", "false", "cast", "extract", "select", "table");

    /** Nombre de campo en SQL: sin comillas si es un identificador simple, si no "entre comillas". */
    public static String sqlIdent(String name) {
        if (name.matches("[A-Za-z_][A-Za-z0-9_]*") && !SQL_RESERVED.contains(name.toLowerCase(Locale.ROOT))) return name;
        return "\"" + name.replace("\"", "\"\"") + "\"";
    }

    static String emitSql(N n, int ignored) {
        if (n instanceof Num x) return x.v;
        if (n instanceof Str x) return strLit(x.v);
        if (n instanceof Fld x) return sqlIdent(x.name);
        if (n instanceof Lit x) return x.kw.toUpperCase(Locale.ROOT);
        if (n instanceof Not x) {
            if (x.x instanceof Call c && c.fn.equals("isnull") && c.args.size() == 1) return wrap(emitSql(c.args.get(0), 0), c.args.get(0), 5) + " IS NOT NULL";
            return "NOT " + wrap(emitSql(x.x, 0), x.x, 4);
        }
        if (n instanceof Neg x) return "-" + wrap(emitSql(x.x, 0), x.x, 9);
        if (n instanceof Bin b) {
            // MATCH(x, a, b) > 0  →  x IN (a, b)
            if (b.l instanceof Call m && m.fn.equals("match") && m.args.size() >= 2 && b.r instanceof Num z && Double.parseDouble(z.v) == 0
                    && (b.op.equals(">") || b.op.equals("=") || b.op.equals("<>"))) {
                StringBuilder sb = new StringBuilder(wrap(emitSql(m.args.get(0), 0), m.args.get(0), 5)).append(b.op.equals("=") ? " NOT IN (" : " IN (");
                for (int i = 1; i < m.args.size(); i++) { if (i > 1) sb.append(", "); sb.append(emitSql(m.args.get(i), 0)); }
                return sb.append(')').toString();
            }
            int pr = prec(b);
            String op = switch (b.op) { case "or" -> "OR"; case "and" -> "AND"; case "&" -> "||"; default -> b.op; };
            int rightNeed = (b.op.equals("-") || b.op.equals("/")) ? pr + 1 : pr;
            if (pr == 4) rightNeed = 5;
            return wrap(emitSql(b.l, 0), b.l, pr == 4 ? 5 : pr) + " " + op + " " + wrap(emitSql(b.r, 0), b.r, rightNeed);
        }
        Call c = (Call) n;
        List<N> a = c.args;
        if (c.star) return "COUNT(*)";
        if (AGG.contains(c.fn) && a.size() == 1 && a.get(0) instanceof Call inner && inner.fn.equals("if") && inner.args.size() >= 2) {
            N cond = inner.args.get(0), val = inner.args.get(1), other = inner.args.size() > 2 ? inner.args.get(2) : new Lit("null");
            // SUM(If(IsNull(x), 1, 1)) → COUNT(*)
            if (c.fn.equals("sum") && cond instanceof Call isn && isn.fn.equals("isnull") && isOne(val) && isOne(other)) return "COUNT(*)";
            // SUM(If(c, 1, 0)) → COUNT(*) FILTER (WHERE c)
            if (c.fn.equals("sum") && isOne(val) && isZero(other)) return "COUNT(*) FILTER (WHERE " + emitSql(cond, 0) + ")";
            if ((c.fn.equals("sum") && isZero(other)) || (!c.fn.equals("sum") && other instanceof Lit l && l.kw.equals("null")))
                return c.fn.toUpperCase(Locale.ROOT) + "(" + (c.distinct ? "DISTINCT " : "") + emitSql(val, 0) + ") FILTER (WHERE " + emitSql(cond, 0) + ")";
        }
        switch (c.fn) {
            case "if": {
                StringBuilder sb = new StringBuilder("CASE");
                N cur = c;
                while (cur instanceof Call ci && ci.fn.equals("if") && ci.args.size() >= 2) {
                    sb.append(" WHEN ").append(emitSql(ci.args.get(0), 0)).append(" THEN ").append(emitSql(ci.args.get(1), 0));
                    cur = ci.args.size() > 2 ? ci.args.get(2) : null;
                }
                if (cur != null && !(cur instanceof Lit l && l.kw.equals("null"))) sb.append(" ELSE ").append(emitSql(cur, 0));
                return sb.append(" END").toString();
            }
            case "isnull": if (a.size() == 1) return wrap(emitSql(a.get(0), 0), a.get(0), 5) + " IS NULL"; break;
            case "text": if (a.size() == 1) return "CAST(" + emitSql(a.get(0), 0) + " AS VARCHAR)"; break;
            case "num": if (a.size() == 1) return "CAST(" + emitSql(a.get(0), 0) + " AS DOUBLE)"; break;
            case "date": if (a.size() == 1) return "CAST(" + emitSql(a.get(0), 0) + " AS DATE)"; break;
            case "round":
                if (a.size() == 1 && a.get(0) instanceof Call nn && nn.fn.equals("num") && nn.args.size() == 1)
                    return "CAST(" + emitSql(nn.args.get(0), 0) + " AS INTEGER)";
                break;
            default: break;
        }
        String name = switch (c.fn) { case "alt" -> "COALESCE"; case "len" -> "LENGTH"; case "mid" -> "SUBSTRING"; default -> c.fn.toUpperCase(Locale.ROOT); };
        StringBuilder sb = new StringBuilder(name).append('(');
        if (c.distinct) sb.append("DISTINCT ");
        for (int i = 0; i < a.size(); i++) { if (i > 0) sb.append(", "); sb.append(emitSql(a.get(i), 0)); }
        return sb.append(')').toString();
    }

    private static boolean isOne(N n) { return n instanceof Num x && Double.parseDouble(x.v) == 1; }
    private static boolean isZero(N n) { return n instanceof Num x && Double.parseDouble(x.v) == 0; }

    /** Campos usados (para avisos/IA). */
    public static Set<String> fieldsOf(String sqlOrNative, Collection<String> fields) {
        N n = isNative(sqlOrNative) ? new NativeParser(sqlOrNative.strip()).parseAll() : new SqlParser(sqlOrNative, resolver(fields)).parseAll();
        Set<String> out = new LinkedHashSet<>();
        collect(n, out);
        return out;
    }

    private static void collect(N n, Set<String> out) {
        if (n instanceof Fld f) out.add(f.name);
        else if (n instanceof Call c) c.args.forEach(a -> collect(a, out));
        else if (n instanceof Bin b) { collect(b.l, out); collect(b.r, out); }
        else if (n instanceof Not x) collect(x.x, out);
        else if (n instanceof Neg x) collect(x.x, out);
    }
}
