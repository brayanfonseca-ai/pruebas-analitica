package io.datasense.engine.transform;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.function.Function;

/**
 * Expresiones por fila (estilo script de carga de Qlik) para columnas calculadas
 * y filtros del selector de datos. Sin eval: gramática cerrada con parser
 * descendente recursivo.
 *
 * <pre>
 *   expr    := or
 *   or      := and ("OR" and)*
 *   and     := not ("AND" not)*
 *   not     := "NOT" not | cmp
 *   cmp     := concat (("=" | "<>" | "<" | ">" | "<=" | ">=") concat)?
 *   concat  := add ("&" add)*
 *   add     := mul (("+" | "-") mul)*
 *   mul     := unary (("*" | "/") unary)*
 *   unary   := "-" unary | primary
 *   primary := número | 'texto' | [Campo] | Func "(" args ")" | "(" expr ")"
 * </pre>
 * Funciones: If, IsNull, Alt, Upper, Lower, Trim, Len, Left, Right, Mid, Replace,
 * Round, Floor, Ceil, Abs, Num, Text, Date, Year, Month, Day.
 * Valores: Double, String, Boolean o null. Aritmética con null → null.
 */
public final class RowExpression {

    /** Error de sintaxis o de evaluación con mensaje en español. */
    public static class ExprError extends RuntimeException {
        public ExprError(String m) { super(m); }
    }

    private interface Node { Object eval(Function<String, String> row); }

    private final Node root;
    private final List<String> fields = new ArrayList<>();
    private final String text;

    private RowExpression(String text) {
        this.text = text;
        this.toks = tokenize(text);
        this.root = parseOr();
        if (pos < toks.size()) throw new ExprError("Sobra texto cerca de «" + toks.get(pos).v + "» en: " + text);
    }

    public static RowExpression compile(String text) {
        if (text == null || text.isBlank()) throw new ExprError("La expresión está vacía.");
        return new RowExpression(text.trim());
    }

    /** Campos [..] referenciados, en orden de aparición. */
    public List<String> fields() { return fields; }

    public String text() { return text; }

    /** Evalúa con un resolutor de campos (nombre → valor de texto, null si vacío). */
    public Object eval(Function<String, String> row) { return root.eval(row); }

    public static boolean truthy(Object v) {
        if (v == null) return false;
        if (v instanceof Boolean b) return b;
        if (v instanceof Double d) return d != 0;
        String s = v.toString().trim();
        return !s.isEmpty() && !s.equals("0") && !s.equalsIgnoreCase("false");
    }

    /** Valor a texto de salida (números enteros sin ".0", sin notación científica). */
    public static String format(Object v) {
        if (v == null) return null;
        if (v instanceof Boolean b) return b ? "1" : "0";
        if (v instanceof Double d) {
            if (d.isNaN() || d.isInfinite()) return null;
            if (d == Math.rint(d) && Math.abs(d) < 1e15) return String.valueOf(d.longValue());
            return BigDecimal.valueOf(d).stripTrailingZeros().toPlainString();
        }
        return v.toString();
    }

    /* ============================== Léxico ============================== */

    private record Tok(char k, String v) {}   // k: n=num s=str f=campo i=ident o=operador

    private final List<Tok> toks;
    private int pos = 0;

    private static List<Tok> tokenize(String s) {
        List<Tok> out = new ArrayList<>();
        int i = 0, n = s.length();
        while (i < n) {
            char c = s.charAt(i);
            if (Character.isWhitespace(c)) { i++; continue; }
            if (c == '[') {
                int j = s.indexOf(']', i + 1);
                if (j < 0) throw new ExprError("Falta cerrar el corchete del campo en: " + s);
                out.add(new Tok('f', s.substring(i + 1, j)));
                i = j + 1; continue;
            }
            if (c == '\'' || c == '"') {
                StringBuilder sb = new StringBuilder();
                int j = i + 1;
                while (true) {
                    if (j >= n) throw new ExprError("Falta cerrar la comilla en: " + s);
                    char d = s.charAt(j);
                    if (d == c) { if (j + 1 < n && s.charAt(j + 1) == c) { sb.append(c); j += 2; continue; } break; }
                    sb.append(d); j++;
                }
                out.add(new Tok('s', sb.toString()));
                i = j + 1; continue;
            }
            if (Character.isDigit(c) || (c == '.' && i + 1 < n && Character.isDigit(s.charAt(i + 1)))) {
                int j = i;
                while (j < n && (Character.isDigit(s.charAt(j)) || s.charAt(j) == '.')) j++;
                out.add(new Tok('n', s.substring(i, j)));
                i = j; continue;
            }
            if (Character.isLetter(c) || c == '_') {
                int j = i;
                while (j < n && (Character.isLetterOrDigit(s.charAt(j)) || s.charAt(j) == '_' || s.charAt(j) == '#')) j++;
                out.add(new Tok('i', s.substring(i, j)));
                i = j; continue;
            }
            if (i + 1 < n) {
                String two = s.substring(i, i + 2);
                if (two.equals("<>") || two.equals("<=") || two.equals(">=") || two.equals("!=")) { out.add(new Tok('o', two.equals("!=") ? "<>" : two)); i += 2; continue; }
            }
            if ("+-*/&=<>(),".indexOf(c) >= 0) { out.add(new Tok('o', String.valueOf(c))); i++; continue; }
            throw new ExprError("Carácter no válido «" + c + "» en: " + s);
        }
        return out;
    }

    private Tok peek() { return pos < toks.size() ? toks.get(pos) : null; }
    private boolean isOp(String v) { Tok t = peek(); return t != null && t.k == 'o' && t.v.equals(v); }
    private boolean isWord(String w) { Tok t = peek(); return t != null && t.k == 'i' && t.v.equalsIgnoreCase(w); }
    private void expect(String v) {
        if (!isOp(v)) throw new ExprError("Se esperaba «" + v + "»" + (peek() == null ? " al final" : " antes de «" + peek().v + "»") + " en: " + text);
        pos++;
    }

    /* ============================== Sintaxis ============================== */

    private Node parseOr() {
        Node l = parseAnd();
        while (isWord("OR")) { pos++; Node a = l, b = parseAnd(); l = r -> truthy(a.eval(r)) || truthy(b.eval(r)); }
        return l;
    }

    private Node parseAnd() {
        Node l = parseNot();
        while (isWord("AND")) { pos++; Node a = l, b = parseNot(); l = r -> truthy(a.eval(r)) && truthy(b.eval(r)); }
        return l;
    }

    private Node parseNot() {
        if (isWord("NOT")) { pos++; Node a = parseNot(); return r -> !truthy(a.eval(r)); }
        return parseCmp();
    }

    private Node parseCmp() {
        Node l = parseConcat();
        Tok t = peek();
        if (t != null && t.k == 'o' && List.of("=", "<>", "<", ">", "<=", ">=").contains(t.v)) {
            pos++;
            Node a = l, b = parseConcat();
            String op = t.v;
            return r -> {
                Object x = a.eval(r), y = b.eval(r);
                if (x == null || y == null) return op.equals("=") ? (x == null && y == null) : op.equals("<>") ? !(x == null && y == null) : false;
                Double nx = num(x), ny = num(y);
                int c = nx != null && ny != null ? Double.compare(nx, ny) : format(x).compareToIgnoreCase(format(y));
                return switch (op) { case "=" -> c == 0; case "<>" -> c != 0; case "<" -> c < 0; case ">" -> c > 0; case "<=" -> c <= 0; default -> c >= 0; };
            };
        }
        return l;
    }

    private Node parseConcat() {
        Node l = parseAdd();
        while (isOp("&")) { pos++; Node a = l, b = parseAdd(); l = r -> { Object x = a.eval(r), y = b.eval(r); return (x == null ? "" : format(x)) + (y == null ? "" : format(y)); }; }
        return l;
    }

    private Node parseAdd() {
        Node l = parseMul();
        while (isOp("+") || isOp("-")) {
            String op = peek().v; pos++;
            Node a = l, b = parseMul();
            l = r -> { Double x = num(a.eval(r)), y = num(b.eval(r)); return x == null || y == null ? null : op.equals("+") ? x + y : x - y; };
        }
        return l;
    }

    private Node parseMul() {
        Node l = parseUnary();
        while (isOp("*") || isOp("/")) {
            String op = peek().v; pos++;
            Node a = l, b = parseUnary();
            l = r -> { Double x = num(a.eval(r)), y = num(b.eval(r)); if (x == null || y == null) return null; if (op.equals("/")) return y == 0 ? null : x / y; return x * y; };
        }
        return l;
    }

    private Node parseUnary() {
        if (isOp("-")) { pos++; Node a = parseUnary(); return r -> { Double x = num(a.eval(r)); return x == null ? null : -x; }; }
        return parsePrimary();
    }

    private Node parsePrimary() {
        Tok t = peek();
        if (t == null) throw new ExprError("La expresión termina antes de tiempo: " + text);
        pos++;
        switch (t.k) {
            case 'n' -> { double d = Double.parseDouble(t.v); return r -> d; }
            case 's' -> { String s = t.v; return r -> s; }
            case 'f' -> {
                String f = t.v.trim();
                fields.add(f);
                return r -> { String v = r.apply(f); return v == null || v.isBlank() ? null : v; };
            }
            case 'o' -> {
                if (t.v.equals("(")) { Node e = parseOr(); expect(")"); return e; }
                throw new ExprError("Operador inesperado «" + t.v + "» en: " + text);
            }
            default -> {
                if (!isOp("(")) {
                    if (t.v.equalsIgnoreCase("null")) return r -> null;
                    if (t.v.equalsIgnoreCase("true")) return r -> Boolean.TRUE;
                    if (t.v.equalsIgnoreCase("false")) return r -> Boolean.FALSE;
                    throw new ExprError("«" + t.v + "» no es un campo ni una función. Escribe los campos entre corchetes: [" + t.v + "].");
                }
                pos++;
                List<Node> args = new ArrayList<>();
                if (!isOp(")")) {
                    args.add(parseOr());
                    while (isOp(",")) { pos++; args.add(parseOr()); }
                }
                expect(")");
                return function(t.v, args);
            }
        }
    }

    private Node function(String name, List<Node> a) {
        String f = name.toLowerCase(Locale.ROOT);
        java.util.function.IntConsumer need = (k) -> { if (a.size() < k) throw new ExprError(name + "() necesita " + k + " argumento(s)."); };
        switch (f) {
            case "if" -> { need.accept(2); return r -> truthy(a.get(0).eval(r)) ? a.get(1).eval(r) : a.size() > 2 ? a.get(2).eval(r) : null; }
            case "isnull" -> { need.accept(1); return r -> { Object v = a.get(0).eval(r); return v == null || format(v).isBlank(); }; }
            case "alt" -> { need.accept(1); return r -> { for (Node n : a) { Object v = n.eval(r); if (v != null && !format(v).isBlank()) return v; } return null; }; }
            case "upper" -> { need.accept(1); return r -> map(a.get(0).eval(r), s -> s.toUpperCase(Locale.ROOT)); }
            case "lower" -> { need.accept(1); return r -> map(a.get(0).eval(r), s -> s.toLowerCase(Locale.ROOT)); }
            case "trim" -> { need.accept(1); return r -> map(a.get(0).eval(r), String::trim); }
            case "len" -> { need.accept(1); return r -> { Object v = a.get(0).eval(r); return v == null ? 0d : (double) format(v).length(); }; }
            case "left" -> { need.accept(2); return r -> { Object v = a.get(0).eval(r); Double k = num(a.get(1).eval(r)); if (v == null || k == null) return null; String s = format(v); return s.substring(0, Math.max(0, Math.min(s.length(), k.intValue()))); }; }
            case "right" -> { need.accept(2); return r -> { Object v = a.get(0).eval(r); Double k = num(a.get(1).eval(r)); if (v == null || k == null) return null; String s = format(v); int c = Math.max(0, Math.min(s.length(), k.intValue())); return s.substring(s.length() - c); }; }
            case "mid" -> { need.accept(2); return r -> {
                Object v = a.get(0).eval(r); Double st = num(a.get(1).eval(r)); if (v == null || st == null) return null;
                String s = format(v); int b = Math.max(0, Math.min(s.length(), st.intValue() - 1));
                int e = a.size() > 2 && num(a.get(2).eval(r)) != null ? Math.min(s.length(), b + num(a.get(2).eval(r)).intValue()) : s.length();
                return s.substring(b, Math.max(b, e)); }; }
            case "replace" -> { need.accept(3); return r -> { Object v = a.get(0).eval(r); Object x = a.get(1).eval(r), y = a.get(2).eval(r); if (v == null) return null; return format(v).replace(x == null ? "" : format(x), y == null ? "" : format(y)); }; }
            case "round" -> { need.accept(1); return r -> { Double x = num(a.get(0).eval(r)); if (x == null) return null; int d = a.size() > 1 && num(a.get(1).eval(r)) != null ? num(a.get(1).eval(r)).intValue() : 0; return BigDecimal.valueOf(x).setScale(Math.max(0, d), java.math.RoundingMode.HALF_UP).doubleValue(); }; }
            case "floor" -> { need.accept(1); return r -> { Double x = num(a.get(0).eval(r)); return x == null ? null : Math.floor(x); }; }
            case "ceil" -> { need.accept(1); return r -> { Double x = num(a.get(0).eval(r)); return x == null ? null : Math.ceil(x); }; }
            case "abs" -> { need.accept(1); return r -> { Double x = num(a.get(0).eval(r)); return x == null ? null : Math.abs(x); }; }
            case "num", "num#" -> { need.accept(1); return r -> num(a.get(0).eval(r)); }
            case "text" -> { need.accept(1); return r -> { Object v = a.get(0).eval(r); return v == null ? null : format(v); }; }
            case "date", "date#" -> { need.accept(1); return r -> { Object v = a.get(0).eval(r); return v == null ? null : Values.toDate(format(v)); }; }
            case "year", "month", "day" -> { need.accept(1); return r -> {
                Object v = a.get(0).eval(r); String d = v == null ? null : Values.toDate(format(v));
                if (d == null) return null;
                return Double.valueOf(f.equals("year") ? d.substring(0, 4) : f.equals("month") ? d.substring(5, 7) : d.substring(8, 10)); }; }
            default -> throw new ExprError("Función no soportada: " + name + "(). Disponibles: If, IsNull, Alt, Upper, Lower, Trim, Len, Left, Right, Mid, Replace, Round, Floor, Ceil, Abs, Num, Text, Date, Year, Month, Day.");
        }
    }

    private static Object map(Object v, Function<String, String> fn) { return v == null ? null : fn.apply(format(v)); }

    static Double num(Object v) {
        if (v == null) return null;
        if (v instanceof Double d) return d;
        if (v instanceof Boolean b) return b ? 1d : 0d;
        return Values.toNumber(v.toString());
    }
}
