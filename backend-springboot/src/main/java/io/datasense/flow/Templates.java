package io.datasense.flow;

import com.fasterxml.jackson.databind.ObjectMapper;

import java.text.NumberFormat;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Plantillas de los nodos: {@code {{ expresión | filtro | filtro:arg }}}. Sin eval: solo rutas y filtros fijos.
 * <pre>
 *   $json.campo · $json["campo con espacios"]       registro actual
 *   $items · $items.length · $items[0].campo          registros que llegan al nodo
 *   $node["Nombre"].json.x · $node.Nombre.items       salida de un nodo anterior (por su nombre)
 *   $trigger.x                                        datos con que arrancó el flujo
 *   $now · $today · $flow.name · $run.id
 * Filtros: number[:decimales] · percent · upper · lower · json · count · join[:sep] · list:campo · table · default:texto · round[:n]
 * </pre>
 * Si la plantilla es exactamente una expresión, devuelve el valor tal cual (número, lista…); si no, interpola texto.
 */
public final class Templates {

    private Templates() {}

    private static final Pattern T = Pattern.compile("\\{\\{\\s*(.+?)\\s*}}", Pattern.DOTALL);
    private static final ObjectMapper JSON = new ObjectMapper();

    /** Contexto de evaluación. */
    public record Ctx(Map<String, Object> json, List<Map<String, Object>> items, Map<String, List<Map<String, Object>>> nodes,
                      Map<String, Object> trigger, Map<String, Object> flow, String runId) {}

    public static Object resolve(Object value, Ctx c) {
        if (value instanceof String s) return render(s, c);
        if (value instanceof Map<?, ?> m) {
            Map<String, Object> out = new LinkedHashMap<>();
            m.forEach((k, v) -> out.put(String.valueOf(k), resolve(v, c)));
            return out;
        }
        if (value instanceof List<?> l) { List<Object> out = new ArrayList<>(); for (Object v : l) out.add(resolve(v, c)); return out; }
        return value;
    }

    public static Object render(String s, Ctx c) {
        if (s == null || !s.contains("{{")) return s;
        Matcher m = T.matcher(s);
        // una sola expresión (devuelve el valor con su tipo); "{{ a }} y {{ b }}" no lo es aunque empiece y termine con llaves
        if (m.matches() && !m.group(1).contains("}}") && !m.group(1).contains("{{")) return eval(m.group(1), c);
        m.reset();
        StringBuilder sb = new StringBuilder();
        while (m.find()) m.appendReplacement(sb, Matcher.quoteReplacement(text(eval(m.group(1), c))));
        m.appendTail(sb);
        return sb.toString();
    }

    public static String renderText(String s, Ctx c) { return text(render(s, c)); }

    static Object eval(String expr, Ctx c) {
        List<String> parts = splitPipes(expr);
        Object v = path(parts.get(0).trim(), c);
        for (int i = 1; i < parts.size(); i++) v = filter(v, parts.get(i).trim());
        return v;
    }

    private static List<String> splitPipes(String e) {
        List<String> out = new ArrayList<>();
        int depth = 0; boolean q = false; char qc = 0; StringBuilder sb = new StringBuilder();
        for (char ch : e.toCharArray()) {
            if (q) { sb.append(ch); if (ch == qc) q = false; continue; }
            if (ch == '"' || ch == '\'') { q = true; qc = ch; sb.append(ch); continue; }
            if (ch == '[') depth++; else if (ch == ']') depth--;
            if (ch == '|' && depth == 0) { out.add(sb.toString()); sb.setLength(0); continue; }
            sb.append(ch);
        }
        out.add(sb.toString());
        return out;
    }

    /** Resuelve una ruta tipo {@code $node["X"].json.campo} o un literal. */
    @SuppressWarnings("unchecked")
    static Object path(String p, Ctx c) {
        if (p.isEmpty()) return "";
        if ((p.startsWith("\"") && p.endsWith("\"")) || (p.startsWith("'") && p.endsWith("'"))) return p.substring(1, p.length() - 1);
        if (p.matches("-?\\d+(\\.\\d+)?")) return Double.parseDouble(p);
        if (!p.startsWith("$")) return p;
        List<String> segs = segments(p);
        String root = segs.get(0);
        Object cur;
        int i = 1;
        switch (root) {
            case "$json" -> cur = c.json();
            case "$items" -> cur = c.items();
            case "$trigger" -> cur = c.trigger();
            case "$flow" -> cur = c.flow();
            case "$run" -> cur = Map.of("id", c.runId() == null ? "" : c.runId());
            case "$now" -> cur = OffsetDateTime.now().withNano(0).toString();
            case "$today" -> cur = LocalDate.now().toString();
            case "$node" -> {
                if (segs.size() < 2) return null;
                List<Map<String, Object>> its = c.nodes().get(segs.get(1));
                if (its == null) return null;
                Map<String, Object> n = new LinkedHashMap<>();
                n.put("json", its.isEmpty() ? Map.of() : its.get(0));
                n.put("items", its);
                n.put("count", its.size());
                cur = n; i = 2;
            }
            default -> { return null; }
        }
        for (; i < segs.size() && cur != null; i++) {
            String s = segs.get(i);
            if (cur instanceof Map<?, ?> m) {
                Object nx = ((Map<String, Object>) m).get(s);
                if (nx == null && "length".equals(s)) nx = m.size();
                cur = nx;
            } else if (cur instanceof List<?> l) {
                if ("length".equals(s) || "count".equals(s)) cur = l.size();
                else if (s.matches("\\d+")) { int k = Integer.parseInt(s); cur = k < l.size() ? l.get(k) : null; }
                else if (!l.isEmpty() && l.get(0) instanceof Map<?, ?> m0) cur = m0.get(s);
                else cur = null;
            } else cur = null;
        }
        return cur;
    }

    /** {@code $node["Mi nodo"].json.x} → [$node, Mi nodo, json, x]. */
    private static List<String> segments(String p) {
        List<String> out = new ArrayList<>();
        int i = 0, n = p.length();
        StringBuilder sb = new StringBuilder();
        while (i < n) {
            char ch = p.charAt(i);
            if (ch == '.') { if (sb.length() > 0) { out.add(sb.toString()); sb.setLength(0); } i++; continue; }
            if (ch == '[') {
                if (sb.length() > 0) { out.add(sb.toString()); sb.setLength(0); }
                int j = p.indexOf(']', i);
                if (j < 0) j = n;
                String inner = p.substring(i + 1, j).trim();
                if (inner.length() >= 2 && (inner.startsWith("\"") || inner.startsWith("'"))) inner = inner.substring(1, inner.length() - 1);
                out.add(inner);
                i = j + 1; continue;
            }
            sb.append(ch); i++;
        }
        if (sb.length() > 0) out.add(sb.toString());
        return out;
    }

    private static final NumberFormat NF = NumberFormat.getNumberInstance(Locale.forLanguageTag("es-CO"));

    @SuppressWarnings("unchecked")
    static Object filter(Object v, String f) {
        String name = f, arg = null;
        int k = f.indexOf(':');
        if (k > 0) { name = f.substring(0, k).trim(); arg = f.substring(k + 1).trim(); if (arg.length() >= 2 && (arg.startsWith("\"") || arg.startsWith("'"))) arg = arg.substring(1, arg.length() - 1); }
        switch (name) {
            case "number", "round" -> {
                Double d = num(v);
                if (d == null) return v;
                int dec = arg == null ? 2 : Integer.parseInt(arg);
                if ("round".equals(name)) { double p = Math.pow(10, dec); return Math.round(d * p) / p; }
                NumberFormat nf = (NumberFormat) NF.clone(); nf.setMaximumFractionDigits(dec);
                return nf.format(d);
            }
            case "percent" -> { Double d = num(v); if (d == null) return v; NumberFormat nf = (NumberFormat) NF.clone(); nf.setMaximumFractionDigits(arg == null ? 1 : Integer.parseInt(arg)); return nf.format(d) + " %"; }
            case "upper" -> { return text(v).toUpperCase(Locale.ROOT); }
            case "lower" -> { return text(v).toLowerCase(Locale.ROOT); }
            case "json" -> { try { return JSON.writerWithDefaultPrettyPrinter().writeValueAsString(v); } catch (Exception e) { return text(v); } }
            case "count" -> { return v instanceof Collection<?> col ? col.size() : v instanceof Map<?, ?> m ? m.size() : v == null ? 0 : 1; }
            case "default" -> { return v == null || text(v).isBlank() ? (arg == null ? "" : arg) : v; }
            case "list" -> {
                if (!(v instanceof List<?> l)) return v;
                List<Object> out = new ArrayList<>();
                for (Object o : l) out.add(o instanceof Map<?, ?> m ? m.get(arg) : o);
                return out;
            }
            case "join" -> {
                if (!(v instanceof List<?> l)) return text(v);
                List<String> s = new ArrayList<>();
                for (Object o : l) s.add(text(o));
                return String.join(arg == null ? ", " : arg, s);
            }
            case "table" -> { return table(v); }
            default -> { return v; }
        }
    }

    /** Lista de registros → tabla HTML con estilo en línea (se ve bien en Outlook y Gmail). */
    @SuppressWarnings("unchecked")
    static String table(Object v) {
        List<Map<String, Object>> rows = new ArrayList<>();
        if (v instanceof List<?> l) for (Object o : l) if (o instanceof Map<?, ?> m) rows.add((Map<String, Object>) m);
        if (v instanceof Map<?, ?> m) rows.add((Map<String, Object>) m);
        if (rows.isEmpty()) return "<p><i>Sin registros.</i></p>";
        LinkedHashSet<String> cols = new LinkedHashSet<>();
        for (Map<String, Object> r : rows) cols.addAll(r.keySet());
        StringBuilder sb = new StringBuilder("<table style=\"border-collapse:collapse;font:13px Segoe UI,Arial,sans-serif\"><thead><tr>");
        for (String c : cols) sb.append("<th style=\"text-align:left;padding:6px 10px;background:#eef2ff;border:1px solid #d6dbf5\">").append(esc(c)).append("</th>");
        sb.append("</tr></thead><tbody>");
        int n = 0;
        for (Map<String, Object> r : rows) {
            if (++n > 200) break;
            sb.append("<tr>");
            for (String c : cols) sb.append("<td style=\"padding:5px 10px;border:1px solid #e5e7eb\">").append(esc(text(r.get(c)))).append("</td>");
            sb.append("</tr>");
        }
        sb.append("</tbody></table>");
        if (rows.size() > 200) sb.append("<p><i>… y ").append(rows.size() - 200).append(" más.</i></p>");
        return sb.toString();
    }

    public static String text(Object v) {
        if (v == null) return "";
        if (v instanceof Double d) return d == Math.rint(d) && Math.abs(d) < 1e15 ? String.valueOf(d.longValue()) : String.valueOf(d);
        if (v instanceof Map || v instanceof List) { try { return JSON.writeValueAsString(v); } catch (Exception e) { return String.valueOf(v); } }
        return String.valueOf(v);
    }

    static Double num(Object v) {
        if (v instanceof Number n) return n.doubleValue();
        if (v == null) return null;
        try { return Double.parseDouble(String.valueOf(v).trim().replace(",", "")); } catch (NumberFormatException e) { return null; }
    }

    static String esc(String s) { return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;"); }
}
