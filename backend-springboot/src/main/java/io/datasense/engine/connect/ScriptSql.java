package io.datasense.engine.connect;

import io.datasense.engine.ExprLang;
import io.datasense.engine.Expressions;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Script de carga en <b>SQL</b>. Convierte entre el script SQL que ve y edita la persona y el formato interno que ya
 * entiende la extracción ({@code DataTransform.parseBlock}); así la carga se comporta igual que antes.
 *
 * <pre>
 *   -- #pestaña Principal
 *   USE CONNECTION 'Postgres ventas';
 *
 *   CREATE TABLE ventas AS
 *   SELECT DISTINCT
 *       cliente,
 *       CAST(valor AS DOUBLE) AS valor,
 *       -- comentario,                      ← columna que NO se carga
 *       CASE WHEN valor > 100 THEN 'Alta' ELSE 'Baja' END AS rango
 *   FROM (
 *       SELECT * FROM public.ventas         ← consulta que se envía a la conexión, en su propio SQL
 *   ) AS origen
 *   WHERE cliente IS NOT NULL;
 *
 *   CREATE TABLE archivo AS
 *   SELECT * FROM read_file('lib://S3 datos/carpeta/archivo.csv');
 * </pre>
 */
public final class ScriptSql {

    private ScriptSql() {}

    private static final Pattern IS_SQL = Pattern.compile("(?im)^\\s*CREATE\\s+(?:OR\\s+REPLACE\\s+)?TABLE\\b");

    /** ¿El script está en SQL? */
    public static boolean isSql(String script) { return script != null && IS_SQL.matcher(script).find(); }

    // comentario dentro de la lista de columnas (uso privado de Unicode: trim() no los quita, a diferencia de \u0001)
    private static final char C1 = '\uE000', C2 = '\uE001';

    /* ================================ formato interno → SQL ================================ */

    public static String toSql(String script) {
        if (script == null || script.isBlank() || isSql(script)) return script;
        String[] lines = script.split("\\r?\\n", -1);
        StringBuilder out = new StringBuilder();
        Pattern head = Pattern.compile("^\\s*(?:\\[([^\\]]+)\\]|([\\p{L}_][\\p{L}\\w.]*))\\s*:\\s*$");
        for (int i = 0; i < lines.length; i++) {
            String line = lines[i], t = line.trim();
            Matcher hm = head.matcher(line);
            if (hm.matches()) {
                String name = hm.group(1) != null ? hm.group(1) : hm.group(2);
                List<String> block = new ArrayList<>();
                int j = i + 1;
                boolean loadDone = false;
                for (; j < lines.length; j++) {
                    String l = lines[j], lt = l.trim();
                    if (!loadDone) {
                        block.add(l);
                        if (!lt.startsWith("//") && endsStatement(lt)) loadDone = true;
                        continue;
                    }
                    if (lt.isEmpty()) continue;
                    if (lt.toUpperCase(Locale.ROOT).startsWith("SQL ")) {
                        block.add(l);
                        while (!endsStatement(lines[j].trim()) && j + 1 < lines.length) { j++; block.add(lines[j]); }
                        j++;
                    }
                    break;
                }
                out.append(blockToSql(name, block)).append('\n');
                i = j - 1;
                continue;
            }
            if (t.startsWith("///$tab")) { out.append("-- #pestaña ").append(t.substring(7).trim()).append('\n'); continue; }
            Matcher lc = Pattern.compile("(?i)^LIB\\s+CONNECT\\s+TO\\s+('(?:[^']|'')*')\\s*;?$").matcher(t);
            if (lc.matches()) { out.append("USE CONNECTION ").append(lc.group(1)).append(";\n"); continue; }
            if (t.startsWith("//")) { out.append(line.replaceFirst("//", "--")).append('\n'); continue; }
            out.append(line).append('\n');
        }
        return out.toString().replaceAll("\\n{3,}", "\n\n").replaceAll("\\n+$", "\n");
    }

    private static boolean endsStatement(String t) {
        boolean q = false;
        for (int k = 0; k < t.length(); k++) {
            char c = t.charAt(k);
            if (c == '\'') q = !q;
            if (!q && c == '/' && k + 1 < t.length() && t.charAt(k + 1) == '/') return t.substring(0, k).trim().endsWith(";");
        }
        return t.endsWith(";");
    }

    /** Un bloque [Tabla]: LOAD … (FROM [lib://…] | ; SQL …;) → CREATE TABLE … AS SELECT …. */
    private static String blockToSql(String name, List<String> block) {
        StringBuilder text = new StringBuilder();
        String sql = null;
        for (String l : block) {
            String t = l.trim();
            if (t.toUpperCase(Locale.ROOT).startsWith("SQL ")) { sql = (sql == null ? "" : sql + "\n") + t.substring(4).trim(); continue; }
            if (sql != null) { sql += "\n" + t; continue; }
            if (t.startsWith("//") && !t.startsWith("///")) {
                String c = t.substring(2).trim();
                if (c.endsWith(";")) c = c.substring(0, c.length() - 1) + ",";     // «// [x];» era el último campo
                text.append(C1).append(c).append(C2).append(",\n");
                continue;
            }
            text.append(l).append('\n');
        }
        String body = text.toString().trim();
        if (body.endsWith(";")) body = body.substring(0, body.length() - 1).trim();
        if (sql != null) sql = sql.trim().replaceAll(";\\s*$", "");
        Matcher lm = Pattern.compile("(?is)^LOAD\\s+(DISTINCT\\s+)?").matcher(body);
        if (!lm.find()) return "-- (no se pudo convertir el bloque «" + name + "»)\n" + commentAll(String.join("\n", block));
        boolean distinct = lm.group(1) != null;
        String rest = body.substring(lm.end());
        int fromAt = topWord(rest, "FROM"), whereAt = topWord(rest, "WHERE");
        int itemsEnd = minPos(fromAt, whereAt, rest.length());
        String items = rest.substring(0, itemsEnd).trim();
        String from = null, where = null;
        if (fromAt >= 0) {
            String f = rest.substring(fromAt + 4, whereAt > fromAt ? whereAt : rest.length()).trim();
            Matcher fm = Pattern.compile("(?s)^\\[(lib://[^\\]]+)\\].*").matcher(f);
            from = fm.matches() ? "read_file('" + fm.group(1).replace("'", "''") + "')" : f;
        }
        if (whereAt >= 0) where = rest.substring(whereAt + 5).trim();
        StringBuilder sb = new StringBuilder("CREATE TABLE ").append(ExprLang.sqlIdent(name)).append(" AS\nSELECT").append(distinct ? " DISTINCT" : "");
        if (items.equals("*")) sb.append(" *\n");
        else {
            sb.append('\n');
            List<String> parts = splitTop(items);
            for (int k = 0; k < parts.size(); k++) {
                String it = parts.get(k).trim();
                if (it.isEmpty()) continue;
                boolean last = k == parts.size() - 1 || allComments(parts.subList(k + 1, parts.size()));
                if (it.charAt(0) == C1) {
                    String c = it.substring(1, it.indexOf(C2)).trim();
                    String cc = c.endsWith(",") ? c.substring(0, c.length() - 1).trim() : c;
                    String conv;
                    try { conv = itemToSql(cc); } catch (RuntimeException e) { conv = cc; }
                    sb.append("    -- ").append(conv).append(",\n");
                    continue;
                }
                sb.append("    ").append(itemToSql(it)).append(last ? "\n" : ",\n");
            }
        }
        if (sql != null) sb.append("FROM (\n    ").append(sql.replace("\n", "\n    ")).append("\n) AS origen\n");
        else if (from != null) sb.append("FROM ").append(from).append('\n');
        else sb.append("FROM connection_source()   -- los datos los entrega la conexión\n");
        if (where != null && !where.isBlank()) sb.append("WHERE ").append(ExprLang.nativeToSql(where)).append('\n');
        return sb.toString().replaceAll("\\n$", "") + ";\n";
    }

    private static boolean allComments(List<String> parts) {
        for (String p : parts) { String t = p.trim(); if (!t.isEmpty() && t.charAt(0) != C1) return false; }
        return true;
    }

    private static String commentAll(String s) { return "-- " + s.replace("\n", "\n-- ") + "\n"; }

    private static String itemToSql(String it) {
        int as = lastTopAs(it);
        if (as < 0) return ExprLang.nativeToSql(it);
        String expr = it.substring(0, as).trim(), alias = it.substring(as + 4).trim();
        if (alias.startsWith("[") && alias.endsWith("]")) alias = alias.substring(1, alias.length() - 1);
        if (alias.startsWith("\"") && alias.endsWith("\"")) alias = alias.substring(1, alias.length() - 1).replace("\"\"", "\"");
        return ExprLang.nativeToSql(expr) + " AS " + ExprLang.sqlIdent(alias);
    }

    /* ================================ SQL → formato interno ================================ */

    public static String toNative(String script) {
        if (script == null || !isSql(script)) return script;
        StringBuilder out = new StringBuilder();
        String s = script.replace("\r\n", "\n");
        int i = 0, n = s.length();
        while (i < n) {
            // espacios y líneas en blanco
            int ls = i;
            while (i < n && (s.charAt(i) == ' ' || s.charAt(i) == '\t')) i++;
            if (i < n && s.charAt(i) == '\n') { out.append('\n'); i++; continue; }
            if (i >= n) break;
            // líneas de la sintaxis anterior (script mixto): se copian tal cual
            if (s.startsWith("//", i)) {
                int e = s.indexOf('\n', i); if (e < 0) e = n;
                out.append(s, i, e).append('\n');
                i = e + 1; continue;
            }
            // comentario de línea fuera de una sentencia
            if (s.startsWith("--", i)) {
                int e = s.indexOf('\n', i); if (e < 0) e = n;
                String c = s.substring(i + 2, e).trim();
                if (c.toLowerCase(Locale.ROOT).startsWith("#pestaña") || c.toLowerCase(Locale.ROOT).startsWith("#pestana")) out.append("///$tab ").append(c.substring(8).trim()).append('\n');
                else out.append("// ").append(c).append('\n');
                i = e + 1; continue;
            }
            int end = statementEnd(s, i);
            String stmt = s.substring(i, end).trim();
            int line = 1 + (int) s.substring(0, ls).chars().filter(ch -> ch == '\n').count();
            i = Math.min(n, end + 1);
            if (stmt.isEmpty()) continue;
            out.append(statementToNative(stmt, line)).append('\n');
        }
        return out.toString();
    }

    /** Posición del «;» que cierra la sentencia (fuera de textos, paréntesis y comentarios). */
    private static int statementEnd(String s, int i) {
        int depth = 0; boolean q = false, dq = false;
        for (int k = i; k < s.length(); k++) {
            char c = s.charAt(k);
            if (!q && !dq && c == '-' && k + 1 < s.length() && s.charAt(k + 1) == '-') { int e = s.indexOf('\n', k); if (e < 0) return s.length(); k = e; continue; }
            if (c == '\'' && !dq) q = !q;
            else if (c == '"' && !q) dq = !dq;
            else if (!q && !dq) {
                if (c == '(') depth++;
                else if (c == ')') depth--;
                else if (c == ';' && depth <= 0) return k;
            }
        }
        return s.length();
    }

    private static String statementToNative(String stmt, int line) {
        Matcher use = Pattern.compile("(?is)^USE\\s+CONNECTION\\s+('(?:[^']|'')*')$").matcher(stmt);
        if (use.matches()) return "LIB CONNECT TO " + use.group(1) + ";";
        if (stmt.toUpperCase(Locale.ROOT).startsWith("SET ")) return stmt + ";";
        // sentencias de la sintaxis anterior en un script mixto: [Tabla]: LOAD …; · SQL …; · LIB CONNECT TO …;
        if (stmt.matches("(?is)^(\\[[^\\]]+\\]|[\\p{L}_][\\p{L}\\w.]*)\\s*:\\s*LOAD\\b.*") || stmt.matches("(?is)^(SQL|LIB\\s+CONNECT|LOAD)\\b.*"))
            return stmt + ";";
        Matcher ct = Pattern.compile("(?is)^CREATE\\s+(?:OR\\s+REPLACE\\s+)?TABLE\\s+(\"(?:[^\"]|\"\")+\"|\\[[^\\]]+\\]|[\\p{L}_][\\p{L}\\w.]*)\\s+AS\\s+(.*)$").matcher(stmt);
        if (!ct.matches()) throw new IllegalArgumentException("Línea " + line + ": sentencia no reconocida. Usa CREATE TABLE nombre AS SELECT … FROM …; o USE CONNECTION 'conexión';");
        String name = unquote(ct.group(1));
        String sel = ct.group(2).trim();
        try { return selectToNative(name, sel); }
        catch (Expressions.ExpressionError | IllegalArgumentException e) { throw new IllegalArgumentException("Tabla «" + name + "» (línea " + line + "): " + e.getMessage()); }
    }

    private static String selectToNative(String name, String sel) {
        // los comentarios dentro de la lista de columnas («-- campo,») son columnas que no se cargan
        StringBuilder marked = new StringBuilder();
        for (String l : sel.split("\n")) {
            String t = l.trim();
            if (t.startsWith("--")) { marked.append(C1).append(t.substring(2).trim()).append(C2).append(",\n"); continue; }
            int c = inlineComment(l);
            marked.append(c >= 0 ? l.substring(0, c) : l).append('\n');
        }
        String body = marked.toString().trim();
        Matcher sm = Pattern.compile("(?is)^SELECT\\s+(DISTINCT\\s+)?").matcher(body);
        if (!sm.find()) throw new IllegalArgumentException("Después de AS va un SELECT.");
        boolean distinct = sm.group(1) != null;
        String rest = body.substring(sm.end());
        int fromAt = topWord(rest, "FROM");
        if (fromAt < 0) throw new IllegalArgumentException("Falta el FROM (la consulta de la conexión entre paréntesis o read_file('lib://…')).");
        String items = rest.substring(0, fromAt).trim();
        String after = rest.substring(fromAt + 4).trim();
        String sql = null, file = null, where = null;
        if (after.startsWith("(")) {
            int close = matchParen(after, 0);
            sql = after.substring(1, close).trim();
            // alias opcional del origen: «) AS origen» / «) origen» (sin comerse un WHERE)
            after = after.substring(close + 1).trim().replaceFirst("(?i)^(?:AS\\s+)?(?!WHERE\\b)[\\p{L}_]\\w*\\s*", "");
        } else if (after.matches("(?is)^connection_source\\s*\\(\\s*\\).*")) {
            after = after.replaceFirst("(?is)^connection_source\\s*\\(\\s*\\)\\s*(?:AS\\s+\\w+\\s*)?", "").trim();
        } else {
            Matcher rf = Pattern.compile("(?is)^read_(?:file|csv|csv_auto|xlsx|parquet|json)\\s*\\(\\s*'((?:[^']|'')*)'[^)]*\\)\\s*(?:AS\\s+\\w+\\s*)?").matcher(after);
            if (rf.find()) { file = rf.group(1).replace("''", "'"); after = after.substring(rf.end()).trim(); }
            else {
                Matcher tb = Pattern.compile("(?is)^([\\p{L}_\"][\\p{L}\\w.\"]*)\\s*").matcher(after);
                if (!tb.find()) throw new IllegalArgumentException("FROM no válido.");
                sql = "SELECT * FROM " + tb.group(1);
                after = after.substring(tb.end()).trim();
            }
        }
        if (!after.isEmpty()) {
            Matcher wm = Pattern.compile("(?is)^WHERE\\s+(.+)$").matcher(after);
            if (!wm.matches()) throw new IllegalArgumentException("No se entiende «" + after.split("\\s+")[0] + "»: después del FROM solo va WHERE.");
            where = ExprLang.sqlToNative(wm.group(1).trim(), (java.util.Collection<String>) null);
        }
        StringBuilder sb = new StringBuilder("[").append(name).append("]:\nLOAD ").append(distinct ? "DISTINCT" : "");
        List<String> parts = splitTop(items);
        if (items.equals("*")) sb.append(distinct ? " *" : "*");
        else {
            List<String> real = new ArrayList<>();
            for (String p : parts) if (!p.trim().isEmpty() && p.trim().charAt(0) != C1) real.add(p);
            int done = 0;
            for (String p : parts) {
                String it = p.trim();
                if (it.isEmpty()) continue;
                if (it.charAt(0) == C1) {
                    String c = it.substring(1, it.indexOf(C2)).trim();
                    if (c.endsWith(",")) c = c.substring(0, c.length() - 1).trim();
                    String conv;
                    try { conv = itemToNative(c); } catch (RuntimeException e) { conv = c; }
                    sb.append("\n    // ").append(conv).append(',');
                    continue;
                }
                done++;
                sb.append("\n    ").append(itemToNative(it)).append(done < real.size() ? "," : "");
            }
        }
        if (file != null) {
            sb.append("\nFROM [").append(file).append("]\n").append(file.toLowerCase(Locale.ROOT).endsWith(".xlsx") ? "(ooxml, embedded labels)" : "(txt, utf8, embedded labels, delimiter is ',', msq)");
        }
        if (where != null) sb.append("\nWHERE ").append(where);
        sb.append(";");
        if (sql != null) sb.append("\nSQL ").append(sql).append(";");
        return sb.toString();
    }

    private static String itemToNative(String it) {
        int as = lastTopAs(it);
        String expr = as < 0 ? it : it.substring(0, as).trim();
        String nat = ExprLang.sqlToNative(expr, (java.util.Collection<String>) null);
        if (as < 0) return nat;
        return nat + " AS [" + unquote(it.substring(as + 4).trim()) + "]";
    }

    /* ================================ utilidades ================================ */

    private static String unquote(String s) {
        String t = s.trim();
        if (t.startsWith("\"") && t.endsWith("\"") && t.length() >= 2) return t.substring(1, t.length() - 1).replace("\"\"", "\"");
        if (t.startsWith("[") && t.endsWith("]")) return t.substring(1, t.length() - 1);
        return t;
    }

    private static int inlineComment(String l) {
        boolean q = false, dq = false;
        for (int k = 0; k + 1 < l.length(); k++) {
            char c = l.charAt(k);
            if (c == '\'' && !dq) q = !q; else if (c == '"' && !q) dq = !dq;
            else if (!q && !dq && c == '-' && l.charAt(k + 1) == '-') return k;
        }
        return -1;
    }

    private static int minPos(int a, int b, int def) {
        int m = def;
        if (a >= 0) m = Math.min(m, a);
        if (b >= 0) m = Math.min(m, b);
        return m;
    }

    /** Posición de una palabra clave a nivel superior (fuera de textos, corchetes, paréntesis y comentarios). */
    static int topWord(String s, String w) {
        int depth = 0; boolean q = false, dq = false, cm = false;
        for (int k = 0; k < s.length(); k++) {
            char c = s.charAt(k);
            if (c == C1) { cm = true; continue; }
            if (c == C2) { cm = false; continue; }
            if (cm) continue;
            if (c == '\'' && !dq) { q = !q; continue; }
            if (c == '"' && !q) { dq = !dq; continue; }
            if (q || dq) continue;
            if (c == '[') { int e = s.indexOf(']', k); if (e > 0) { k = e; continue; } }
            if (c == '(') depth++;
            else if (c == ')') depth--;
            else if (depth == 0 && s.regionMatches(true, k, w, 0, w.length())
                    && (k == 0 || !Character.isLetterOrDigit(s.charAt(k - 1)) && s.charAt(k - 1) != '_')
                    && (k + w.length() >= s.length() || !Character.isLetterOrDigit(s.charAt(k + w.length())) && s.charAt(k + w.length()) != '_'))
                return k;
        }
        return -1;
    }

    static List<String> splitTop(String s) {
        List<String> out = new ArrayList<>();
        int depth = 0, start = 0; boolean q = false, dq = false, cm = false;
        for (int k = 0; k < s.length(); k++) {
            char c = s.charAt(k);
            if (c == C1) { cm = true; continue; }
            if (c == C2) { cm = false; continue; }
            if (cm) continue;
            if (c == '\'' && !dq) { q = !q; continue; }
            if (c == '"' && !q) { dq = !dq; continue; }
            if (q || dq) continue;
            if (c == '[') { int e = s.indexOf(']', k); if (e > 0) { k = e; continue; } }
            if (c == '(') depth++;
            else if (c == ')') depth--;
            else if (c == ',' && depth == 0) { out.add(s.substring(start, k)); start = k + 1; }
        }
        out.add(s.substring(start));
        return out;
    }

    static int lastTopAs(String s) {
        int found = -1, depth = 0; boolean q = false, dq = false;
        for (int k = 0; k < s.length(); k++) {
            char c = s.charAt(k);
            if (c == '\'' && !dq) { q = !q; continue; }
            if (c == '"' && !q) { dq = !dq; continue; }
            if (q || dq) continue;
            if (c == '[') { int e = s.indexOf(']', k); if (e > 0) { k = e; continue; } }
            if (c == '(') depth++;
            else if (c == ')') depth--;
            else if (depth == 0 && Character.isWhitespace(c) && s.regionMatches(true, k + 1, "AS", 0, 2)
                    && k + 3 < s.length() && Character.isWhitespace(s.charAt(k + 3))) found = k;
        }
        return found;
    }

    private static int matchParen(String s, int open) {
        int depth = 0; boolean q = false, dq = false;
        for (int k = open; k < s.length(); k++) {
            char c = s.charAt(k);
            if (c == '\'' && !dq) q = !q; else if (c == '"' && !q) dq = !dq;
            else if (!q && !dq) { if (c == '(') depth++; else if (c == ')' && --depth == 0) return k; }
        }
        throw new IllegalArgumentException("Falta cerrar el paréntesis del FROM.");
    }
}
