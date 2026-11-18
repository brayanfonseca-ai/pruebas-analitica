package io.datasense.ask;

import io.datasense.engine.DataFrame;
import io.datasense.engine.Expressions;
import io.datasense.engine.Profiler;
import io.datasense.engine.transform.RowExpression;
import io.datasense.model.AppModels.FieldRef;
import io.datasense.model.AppModels.MeasureSpec;
import io.datasense.model.AppModels.QueryResult;
import io.datasense.model.AppModels.QuerySpec;

import org.springframework.stereotype.Service;

import java.util.*;

/**
 * Análisis que van más allá de mostrar un número:
 * <ul>
 *   <li><b>Qué cambió y por qué</b> ({@link #explain}): compara una medida entre dos periodos y descompone el cambio
 *   por cada dimensión candidata (sucursal, cargo, motivo…). En medidas aditivas (Sum/Count) cada segmento aporta
 *   una parte exacta del cambio; en las no aditivas (%, promedios, compuestas) se muestran los segmentos que más
 *   se movieron. Devuelve el relato en español y los números que lo sostienen.</li>
 *   <li><b>Del dato a la acción</b> ({@link #rows}): los registros concretos detrás de una cifra (filtros + condición
 *   por fila, p. ej. {@code [probabilidad_retiro] > 0.6}), listos para exportar o enviar.</li>
 *   <li><b>¿Qué pasaría si…?</b> ({@link #whatIf}): aplica cambios hipotéticos a una copia de los datos (fijar un
 *   valor, multiplicar o sumar a un número, en un % de las filas que cumplen unos filtros) y recalcula las medidas
 *   antes y después, en total y por dimensión.</li>
 * </ul>
 * Todo es determinista, sobre el motor de consultas; nada se guarda en los datos reales.
 */
@Service
public class InsightService {

    private final AskService ask;

    public InsightService(AskService ask) {
        this.ask = ask;
    }

    /** Tabla principal de la app (la de más filas). */
    public String mainTable(String appId) { return ask.model(appId).mainTable; }

    /* ================================ Qué cambió y por qué ================================ */

    /**
     * @param body {expression | master_id, label?, time_field?, current?, previous?, selections?, dimensions?, top?}
     */
    @SuppressWarnings("unchecked")
    public Map<String, Object> explain(String appId, Map<String, Object> body) {
        AskService.Model m = ask.model(appId);
        if (m.frames.isEmpty()) throw new IllegalArgumentException("La aplicación no tiene datos cargados.");
        MeasureSpec ms = ask.measureSpec(m, str(body.get("master_id")), str(body.get("expression")), blankNull(body.get("label")));
        String table = ms.table();
        DataFrame df = m.frames.get(table);
        if (df == null) throw new IllegalArgumentException("La tabla de la medida no está cargada.");
        Map<String, List<Object>> base = sel(body.get("selections"));

        // campo de tiempo (en la tabla de la medida)
        String tf = blankNull(body.get("time_field"));
        AskService.Field time = null;
        for (AskService.Field f : m.fields) if (f.table.equals(table) && (tf != null ? f.name.equals(tf) : false)) time = f;
        if (time == null && tf != null) throw new IllegalArgumentException("El campo de tiempo «" + tf + "» no está en la tabla " + table + ".");
        if (time == null) {
            AskService.Model only = new AskService.Model();
            only.mainTable = table;
            for (AskService.Field f : m.fields) if (f.table.equals(table)) only.fields.add(f);
            time = AskService.bestTimeField(only, "month");
        }
        if (time == null) throw new IllegalArgumentException("No encontré un campo de fecha o periodo en " + table + " para comparar.");
        List<String> periods = distinct(df, time.name);
        periods.sort(AskService::naturalCmp);
        if (periods.size() < 2) throw new IllegalArgumentException("El campo " + time.display + " tiene un solo valor: no hay con qué comparar.");
        String cur = blankNull(body.get("current")), prev = blankNull(body.get("previous"));
        if (cur == null) cur = periods.get(periods.size() - 1);
        if (!periods.contains(cur)) throw new IllegalArgumentException("El periodo «" + cur + "» no existe en " + time.display + ".");
        if (prev == null) { int i = periods.indexOf(cur); if (i == 0) throw new IllegalArgumentException("«" + cur + "» es el primer periodo: no hay uno anterior."); prev = periods.get(i - 1); }
        if (!periods.contains(prev)) throw new IllegalArgumentException("El periodo «" + prev + "» no existe en " + time.display + ".");

        Map<String, List<Object>> sCur = with(base, time.name, cur), sPrev = with(base, time.name, prev);
        double vCur = val(ask.run(m, kpi(ms, sCur))), vPrev = val(ask.run(m, kpi(ms, sPrev)));
        double delta = vCur - vPrev;
        Double pct = vPrev == 0 ? null : delta / Math.abs(vPrev) * 100;
        boolean additive = !ms.composite() && ("sum".equals(ms.agg()) || "count".equals(ms.agg()));
        boolean isPct = String.valueOf(ms.label()).trim().startsWith("%") || (ms.formula() != null && ms.formula().contains("* 100"));

        // dimensiones candidatas
        Set<String> wanted = new LinkedHashSet<>();
        if (body.get("dimensions") instanceof List<?> l) for (Object o : l) wanted.add(String.valueOf(o));
        List<AskService.Field> cands = new ArrayList<>();
        for (AskService.Field f : m.fields) {
            if (!f.table.equals(table) || f == time || base.containsKey(f.name)) continue;
            if (!wanted.isEmpty() ? wanted.contains(f.name) : ("text".equals(f.type) && !f.idLike && !f.timeLike && f.distinct >= 2 && f.distinct <= 60))
                cands.add(f);
        }
        int top = Math.max(1, Math.min(10, body.get("top") == null ? 5 : (int) Double.parseDouble(str(body.get("top")))));
        // para medidas no aditivas el peso de cada segmento es su volumen de filas (un 100 % → 0 % de una sola persona no explica nada)
        MeasureSpec rowsM = new MeasureSpec(table, df.columns().get(0), "count", "Filas", null, null);
        List<Map<String, Object>> drivers = new ArrayList<>();
        double sign = Math.signum(delta == 0 ? 1 : delta);
        for (AskService.Field d : cands) {
            Map<String, Double> a = grouped(m, ms, d, sCur), b = grouped(m, ms, d, sPrev);
            Map<String, Double> na = additive ? Map.of() : grouped(m, rowsM, d, sCur), nb = additive ? Map.of() : grouped(m, rowsM, d, sPrev);
            double totalRows = 0;
            for (double v : na.values()) totalRows += v;
            for (double v : nb.values()) totalRows += v;
            Set<String> keys = new LinkedHashSet<>(a.keySet()); keys.addAll(b.keySet());
            List<Map<String, Object>> items = new ArrayList<>();
            for (String k : keys) {
                if (k == null || k.isBlank() || "null".equals(k)) continue;
                double c = a.getOrDefault(k, 0.0), p = b.getOrDefault(k, 0.0);
                Map<String, Object> it = new LinkedHashMap<>();
                it.put("value", k); it.put("current", c); it.put("previous", p); it.put("delta", c - p);
                if (additive) {
                    if (delta != 0) it.put("share", (c - p) / delta * 100);
                    it.put("impact", c - p);
                } else {
                    double rows = na.getOrDefault(k, 0.0) + nb.getOrDefault(k, 0.0);
                    it.put("rows", (long) (na.getOrDefault(k, 0.0) + 0));
                    it.put("weight", totalRows == 0 ? 0 : rows / totalRows * 100);
                    it.put("impact", totalRows == 0 ? 0 : (c - p) * rows / totalRows);
                }
                items.add(it);
            }
            if (items.isEmpty()) continue;
            // primero los que más empujan en la dirección del cambio total (ponderado por volumen si no es aditiva)
            items.sort((x, y) -> Double.compare(sign * (double) y.get("impact"), sign * (double) x.get("impact")));
            double score = delta == 0 ? Math.abs((double) items.get(0).get("impact")) : sign * (double) items.get(0).get("impact") / Math.abs(delta);
            Map<String, Object> dr = new LinkedHashMap<>();
            dr.put("dimension", d.name);
            dr.put("display", d.display);
            dr.put("score", score);
            dr.put("items", items.subList(0, Math.min(top, items.size())));
            dr.put("values", items.size());
            drivers.add(dr);
        }
        drivers.sort((x, y) -> Double.compare((double) y.get("score"), (double) x.get("score")));
        if (drivers.size() > 4) drivers = new ArrayList<>(drivers.subList(0, 4));

        // relato
        String label = String.valueOf(ms.label());
        String u = isPct ? " %" : "";
        List<String> story = new ArrayList<>();
        String dir = delta > 0 ? "subió" : delta < 0 ? "bajó" : "no cambió";
        String mag = isPct ? AskService.fmt(Math.abs(delta)) + " puntos" : AskService.fmt(Math.abs(delta)) + (pct != null ? " (" + (delta >= 0 ? "+" : "−") + AskService.fmt(Math.abs(pct)) + " %)" : "");
        story.add(label + " " + dir + (delta != 0 ? " " + mag : "") + ": pasó de " + AskService.fmt(vPrev) + u + " en " + prev + " a " + AskService.fmt(vCur) + u + " en " + cur + filtersText(base) + ".");
        for (int i = 0; i < Math.min(2, drivers.size()); i++) {
            Map<String, Object> dr = drivers.get(i);
            List<Map<String, Object>> its = (List<Map<String, Object>>) dr.get("items");
            Map<String, Object> f0 = its.get(0);
            double d0 = (double) f0.get("delta");
            if (delta == 0 || Math.signum(d0) != Math.signum(delta)) continue;
            StringBuilder sb = new StringBuilder(i == 0 ? "Lo que más lo explica: " : "También pesa ");
            sb.append(dr.get("display")).append(" — ").append(f0.get("value")).append(" (")
                    .append(AskService.fmt((double) f0.get("previous"))).append(u).append(" → ").append(AskService.fmt((double) f0.get("current"))).append(u);
            if (f0.get("share") != null) {
                double sh = (double) f0.get("share");
                if (sh > 110) sb.append("; ").append(d0 > 0 ? "+" : "−").append(AskService.fmt(Math.abs(d0))).append(", más que todo el cambio: otros segmentos lo compensan");
                else sb.append("; aporta el ").append(AskService.fmt(sh)).append(" % del cambio");
            } else {
                sb.append("; ").append(d0 > 0 ? "+" : "−").append(AskService.fmt(Math.abs(d0))).append(isPct ? " puntos" : "");
                if (f0.get("weight") != null) sb.append(", con el ").append(AskService.fmt((double) f0.get("weight"))).append(" % de las filas");
            }
            sb.append(")");
            if (its.size() > 1 && Math.signum((double) its.get(1).get("delta")) == Math.signum(delta))
                sb.append(" y ").append(its.get(1).get("value")).append(" (").append((double) its.get(1).get("delta") > 0 ? "+" : "−")
                        .append(AskService.fmt(Math.abs((double) its.get(1).get("delta")))).append(isPct ? " pts" : "").append(")");
            story.add(sb.append(".").toString());
        }
        // contrapeso: el segmento que más se movió en contra
        for (Map<String, Object> dr : drivers) {
            List<Map<String, Object>> its = (List<Map<String, Object>>) dr.get("items");
            Map<String, Object> last = its.get(its.size() - 1);
            double dl = (double) last.get("delta");
            if (delta != 0 && Math.signum(dl) == -Math.signum(delta) && Math.abs(dl) >= Math.abs(delta) * 0.1) {
                story.add("En sentido contrario: " + dr.get("display") + " — " + last.get("value") + " (" + (dl > 0 ? "+" : "−") + AskService.fmt(Math.abs(dl)) + (isPct ? " puntos" : "") + ").");
                break;
            }
        }
        if (!additive && !drivers.isEmpty()) story.add("Como " + label + " no es una suma, los segmentos se ordenan por su cambio ponderado por su volumen de filas: muestran dónde el movimiento pesa más.");

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("measure", Map.of("label", label, "table", table, "additive", additive, "percent", isPct));
        out.put("time_field", time.name);
        out.put("time_display", time.display);
        out.put("periods", periods.size() > 60 ? periods.subList(periods.size() - 60, periods.size()) : periods);
        out.put("current", cur);
        out.put("previous", prev);
        out.put("current_value", vCur);
        out.put("previous_value", vPrev);
        out.put("delta", delta);
        out.put("delta_pct", pct);
        out.put("drivers", drivers);
        out.put("story", story);
        out.put("selections", base);
        return out;
    }

    private Map<String, Double> grouped(AskService.Model m, MeasureSpec ms, AskService.Field d, Map<String, List<Object>> sel) {
        QueryResult r = ask.run(m, new QuerySpec(new FieldRef(d.table, d.name, null), List.of(ms), "bar", sel));
        Map<String, Double> out = new LinkedHashMap<>();
        for (int i = 0; i < r.labels().size(); i++) out.put(String.valueOf(r.labels().get(i)), r.values().get(i) == null ? 0 : r.values().get(i));
        return out;
    }

    /* ================================ Del dato a la acción ================================ */

    /**
     * Registros que cumplen los filtros y la condición. {table?, selections?, where?, fields?, limit?, sort?, desc?}
     * → {table, columns, rows, total, truncated}.
     */
    @SuppressWarnings("unchecked")
    public Map<String, Object> rows(String appId, Map<String, Object> body) {
        AskService.Model m = ask.model(appId);
        if (m.frames.isEmpty()) throw new IllegalArgumentException("La aplicación no tiene datos cargados.");
        String table = blankNull(body.get("table"));
        Map<String, List<Object>> sel = sel(body.get("selections"));
        if (table == null) {
            // la tabla que contiene más campos de los filtros / condición; si no, la principal
            int best = -1;
            String where = str(body.get("where"));
            for (Map.Entry<String, DataFrame> e : m.frames.entrySet()) {
                int sc = 0;
                for (String f : sel.keySet()) if (e.getValue().indexOf(f) >= 0) sc += 2;
                for (String c : e.getValue().columns()) if (where.contains("[" + c + "]")) sc += 2;
                if (e.getKey().equals(m.mainTable)) sc += 1;
                if (sc > best) { best = sc; table = e.getKey(); }
            }
        }
        DataFrame df = m.frames.get(table);
        if (df == null) throw new IllegalArgumentException("La tabla «" + table + "» no existe en la app.");
        for (String f : sel.keySet()) if (df.indexOf(f) < 0) throw new IllegalArgumentException("El campo de filtro «" + f + "» no está en la tabla " + table + ".");
        RowExpression where = null;
        String w = blankNull(body.get("where"));
        if (w != null) {
            try { where = RowExpression.compile(w.replaceFirst("^=\\s*", "")); }
            catch (RowExpression.ExprError e) { throw new IllegalArgumentException("Condición no válida: " + e.getMessage()); }
            for (String f : where.fields()) if (df.indexOf(f) < 0) throw new IllegalArgumentException("El campo «" + f + "» de la condición no está en la tabla " + table + ".");
        }
        List<String> cols = new ArrayList<>();
        if (body.get("fields") instanceof List<?> fl && !fl.isEmpty()) {
            for (Object o : fl) { String c = String.valueOf(o); if (df.indexOf(c) < 0) throw new IllegalArgumentException("El campo «" + c + "» no está en la tabla " + table + "."); cols.add(c); }
        } else cols.addAll(df.columns());
        int limit = Math.max(1, Math.min(10000, body.get("limit") == null ? 500 : (int) Double.parseDouble(str(body.get("limit")))));

        Map<Integer, Set<String>> allowed = new HashMap<>();
        sel.forEach((f, vs) -> { Set<String> s = new HashSet<>(); vs.forEach(v -> s.add(String.valueOf(v))); allowed.put(df.indexOf(f), s); });
        List<List<String>> match = new ArrayList<>();
        for (List<String> r : df.rows()) {
            boolean ok = true;
            for (Map.Entry<Integer, Set<String>> a : allowed.entrySet()) {
                String v = a.getKey() < r.size() ? r.get(a.getKey()) : null;
                if (!a.getValue().contains(v)) { ok = false; break; }
            }
            if (ok && where != null) {
                try { ok = RowExpression.truthy(where.eval(f -> { int i = df.indexOf(f); String s = i >= 0 && i < r.size() ? r.get(i) : null; return s == null || s.isBlank() ? null : s; })); }
                catch (RuntimeException e) { ok = false; }
            }
            if (ok) match.add(r);
        }
        String sort = blankNull(body.get("sort"));
        if (sort != null && df.indexOf(sort) >= 0) {
            int si = df.indexOf(sort);
            boolean desc = !Boolean.FALSE.equals(body.get("desc")) && !"false".equals(str(body.get("desc")));
            Comparator<List<String>> cmp = (x, y) -> {
                String a = si < x.size() ? x.get(si) : null, b = si < y.size() ? y.get(si) : null;
                if (a == null || a.isBlank()) return 1; if (b == null || b.isBlank()) return -1;
                if (Profiler.isNumeric(a) && Profiler.isNumeric(b)) return Double.compare(num(a), num(b));
                return a.compareToIgnoreCase(b);
            };
            match.sort(desc ? cmp.reversed() : cmp);
        }
        List<List<String>> out = new ArrayList<>();
        int[] idx = cols.stream().mapToInt(df::indexOf).toArray();
        for (int i = 0; i < Math.min(limit, match.size()); i++) {
            List<String> r = match.get(i), o = new ArrayList<>(idx.length);
            for (int c : idx) o.add(c < r.size() ? r.get(c) : null);
            out.add(o);
        }
        Map<String, Object> res = new LinkedHashMap<>();
        res.put("table", table);
        res.put("columns", cols);
        res.put("rows", out);
        res.put("total", match.size());
        res.put("truncated", match.size() > out.size());
        res.put("table_rows", df.rowCount());
        return res;
    }

    /** CSV (UTF-8 con BOM, separador «;» para que Excel en español lo abra en columnas). */
    @SuppressWarnings("unchecked")
    public static String csv(Map<String, Object> rows) {
        StringBuilder sb = new StringBuilder("\uFEFF");
        List<String> cols = (List<String>) rows.get("columns");
        sb.append(String.join(";", cols.stream().map(InsightService::cell).toList())).append("\r\n");
        for (List<String> r : (List<List<String>>) rows.get("rows"))
            sb.append(String.join(";", r.stream().map(InsightService::cell).toList())).append("\r\n");
        return sb.toString();
    }

    private static String cell(String v) {
        if (v == null) return "";
        String s = v;
        // evita inyección de fórmulas al abrir en Excel
        if (!s.isEmpty() && "=+-@".indexOf(s.charAt(0)) >= 0 && !Profiler.isNumeric(s)) s = "'" + s;
        return s.contains(";") || s.contains("\"") || s.contains("\n") || s.contains("\r") ? "\"" + s.replace("\"", "\"\"") + "\"" : s;
    }

    /* ================================ ¿Qué pasaría si…? ================================ */

    /**
     * @param body {measures:[{expression | master_id, label?}], changes:[{selections?, where?, field, op: set|multiply|add, value, share? (1-100)}],
     *             dimension?, selections?}
     */
    @SuppressWarnings("unchecked")
    public Map<String, Object> whatIf(String appId, Map<String, Object> body) {
        AskService.Model m = ask.model(appId);
        if (m.frames.isEmpty()) throw new IllegalArgumentException("La aplicación no tiene datos cargados.");
        List<MeasureSpec> measures = new ArrayList<>();
        if (!(body.get("measures") instanceof List<?> ml) || ml.isEmpty()) throw new IllegalArgumentException("Elige al menos una medida.");
        for (Object o : ml) {
            Map<String, Object> mm = (Map<String, Object>) o;
            measures.add(ask.measureSpec(m, str(mm.get("master_id")), str(mm.get("expression")), blankNull(mm.get("label"))));
        }
        if (!(body.get("changes") instanceof List<?> cl) || cl.isEmpty()) throw new IllegalArgumentException("Agrega al menos un cambio al escenario.");

        Map<String, DataFrame> scen = new LinkedHashMap<>(m.frames);
        List<Map<String, Object>> applied = new ArrayList<>();
        for (Object o : cl) {
            Map<String, Object> ch = (Map<String, Object>) o;
            String field = str(ch.get("field"));
            String op = str(ch.getOrDefault("op", "set")).toLowerCase(Locale.ROOT);
            if (!Set.of("set", "multiply", "add").contains(op)) throw new IllegalArgumentException("Operación inválida «" + op + "»: usa set, multiply o add.");
            String value = str(ch.get("value"));
            if (field.isBlank()) throw new IllegalArgumentException("Cada cambio necesita el campo a modificar.");
            if (!"set".equals(op) && !Profiler.isNumeric(value)) throw new IllegalArgumentException("Para " + op + " el valor debe ser un número.");
            double share = ch.get("share") == null ? 100 : Double.parseDouble(str(ch.get("share")));
            if (share <= 0 || share > 100) throw new IllegalArgumentException("El porcentaje de filas debe estar entre 1 y 100.");
            Map<String, List<Object>> s = sel(ch.get("selections"));
            String where = blankNull(ch.get("where"));
            int touched = 0;
            String tableOf = null;
            for (Map.Entry<String, DataFrame> e : new ArrayList<>(scen.entrySet())) {
                DataFrame df = e.getValue();
                int fi = df.indexOf(field);
                if (fi < 0) continue;
                boolean ok = true;
                for (String f : s.keySet()) if (df.indexOf(f) < 0) { ok = false; break; }
                if (!ok) continue;
                RowExpression w = null;
                if (where != null) {
                    try { w = RowExpression.compile(where); } catch (RowExpression.ExprError x) { throw new IllegalArgumentException("Condición no válida: " + x.getMessage()); }
                }
                Map<Integer, Set<String>> allowed = new HashMap<>();
                s.forEach((f, vs) -> { Set<String> set = new HashSet<>(); vs.forEach(v -> set.add(String.valueOf(v))); allowed.put(df.indexOf(f), set); });
                List<List<String>> rows = new ArrayList<>(df.rowCount());
                int seen = 0;
                for (List<String> r : df.rows()) {
                    boolean match = true;
                    for (Map.Entry<Integer, Set<String>> a : allowed.entrySet()) if (!a.getValue().contains(a.getKey() < r.size() ? r.get(a.getKey()) : null)) { match = false; break; }
                    if (match && w != null) {
                        final RowExpression ww = w;
                        try { match = RowExpression.truthy(ww.eval(f -> { int i = df.indexOf(f); String x = i >= 0 && i < r.size() ? r.get(i) : null; return x == null || x.isBlank() ? null : x; })); }
                        catch (RuntimeException x) { match = false; }
                    }
                    if (!match) { rows.add(r); continue; }
                    // reparto determinista: cada fila elegible se cambia si cruza un múltiplo de share
                    boolean pick = Math.floor((seen + 1) * share / 100.0) > Math.floor(seen * share / 100.0);
                    seen++;
                    if (!pick) { rows.add(r); continue; }
                    List<String> nr = new ArrayList<>(r);
                    while (nr.size() <= fi) nr.add(null);
                    String old = nr.get(fi);
                    if ("set".equals(op)) nr.set(fi, value);
                    else if (old != null && Profiler.isNumeric(old)) {
                        double a = num(old), b = num(value);
                        nr.set(fi, RowExpression.format("multiply".equals(op) ? a * b : a + b));
                    }
                    rows.add(nr);
                    touched++;
                }
                scen.put(e.getKey(), new DataFrame(df.columns(), rows));
                tableOf = e.getKey();
                break;
            }
            if (tableOf == null) throw new IllegalArgumentException("No hay una tabla con el campo «" + field + "»" + (s.isEmpty() ? "" : " y los campos de los filtros") + ".");
            Map<String, Object> ap = new LinkedHashMap<>(ch);
            ap.put("table", tableOf);
            ap.put("rows_changed", touched);
            ap.put("text", changeText(field, op, value, share, s, where, touched));
            applied.add(ap);
        }

        Map<String, List<Object>> base = sel(body.get("selections"));
        String dim = blankNull(body.get("dimension"));
        List<Map<String, Object>> results = new ArrayList<>();
        List<String> story = new ArrayList<>();
        for (MeasureSpec ms : measures) {
            QuerySpec k = kpi(ms, base);
            double before = val(io.datasense.engine.QueryEngine.run(m.frames, k, m.types, m.displays));
            double after = val(io.datasense.engine.QueryEngine.run(scen, k, m.types, m.displays));
            boolean isPct = String.valueOf(ms.label()).trim().startsWith("%") || (ms.formula() != null && ms.formula().contains("* 100"));
            Map<String, Object> r = new LinkedHashMap<>();
            r.put("label", ms.label());
            r.put("before", before);
            r.put("after", after);
            r.put("delta", after - before);
            r.put("delta_pct", before == 0 ? null : (after - before) / Math.abs(before) * 100);
            r.put("percent", isPct);
            if (dim != null) {
                String table = ms.table();
                QuerySpec g = new QuerySpec(new FieldRef(table, dim, null), List.of(ms), "bar", base);
                QueryResult b0 = io.datasense.engine.QueryEngine.run(m.frames, g, m.types, m.displays), a0 = io.datasense.engine.QueryEngine.run(scen, g, m.types, m.displays);
                Map<String, Double> bm = new LinkedHashMap<>(), am = new LinkedHashMap<>();
                for (int i = 0; i < b0.labels().size(); i++) bm.put(String.valueOf(b0.labels().get(i)), b0.values().get(i));
                for (int i = 0; i < a0.labels().size(); i++) am.put(String.valueOf(a0.labels().get(i)), a0.values().get(i));
                Set<String> keys = new LinkedHashSet<>(bm.keySet()); keys.addAll(am.keySet());
                List<Map<String, Object>> by = new ArrayList<>();
                for (String key : keys) {
                    if (key == null || key.isBlank() || "null".equals(key)) continue;
                    double x = bm.getOrDefault(key, 0.0), y = am.getOrDefault(key, 0.0);
                    by.add(new LinkedHashMap<>(Map.of("value", key, "before", x, "after", y, "delta", y - x)));
                }
                by.sort((p, q) -> Double.compare(Math.abs((double) q.get("delta")), Math.abs((double) p.get("delta"))));
                r.put("by", by.size() > 30 ? by.subList(0, 30) : by);
            }
            results.add(r);
            String u = isPct ? " %" : "";
            double d = after - before;
            story.add(ms.label() + (d == 0 ? " no cambiaría" : " pasaría de " + AskService.fmt(before) + u + " a " + AskService.fmt(after) + u + " ("
                    + (d > 0 ? "+" : "−") + AskService.fmt(Math.abs(d)) + (isPct ? " puntos" : "")
                    + (!isPct && before != 0 ? ", " + (d > 0 ? "+" : "−") + AskService.fmt(Math.abs(d / before * 100)) + " %" : "") + ")") + ".");
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("changes", applied);
        out.put("results", results);
        out.put("story", story);
        out.put("note", "Simulación sobre una copia de los datos: no se modifica nada. Supone que el resto de las filas no cambia.");
        return out;
    }

    private static String changeText(String field, String op, String value, double share, Map<String, List<Object>> s, String where, int n) {
        String what = switch (op) {
            case "multiply" -> field + " × " + value;
            case "add" -> field + (value.startsWith("-") ? " − " + value.substring(1) : " + " + value);
            default -> field + " = " + value;
        };
        StringBuilder sb = new StringBuilder(what);
        if (share < 100) sb.append(" en el ").append(AskService.fmt(share)).append(" % de las filas");
        List<String> conds = new ArrayList<>();
        s.forEach((f, v) -> conds.add(f + " = " + String.join(" o ", v.stream().map(String::valueOf).toList())));
        if (where != null) conds.add(where);
        if (!conds.isEmpty()) sb.append(" donde ").append(String.join(" y ", conds));
        return sb.append(" (").append(n).append(" filas)").toString();
    }

    /* ================================ utilidades ================================ */

    static QuerySpec kpi(MeasureSpec ms, Map<String, List<Object>> sel) { return new QuerySpec(null, List.of(ms), "kpi", sel); }

    private static double val(QueryResult r) { return r == null || r.value() == null ? 0 : r.value(); }

    private static List<String> distinct(DataFrame df, String col) {
        LinkedHashSet<String> s = new LinkedHashSet<>();
        for (String v : df.columnValues(col)) if (v != null && !v.isBlank()) s.add(v);
        return new ArrayList<>(s);
    }

    private static Map<String, List<Object>> with(Map<String, List<Object>> base, String f, String v) {
        Map<String, List<Object>> m = new LinkedHashMap<>(base);
        m.put(f, List.of(v));
        return m;
    }

    @SuppressWarnings("unchecked")
    static Map<String, List<Object>> sel(Object o) {
        Map<String, List<Object>> out = new LinkedHashMap<>();
        if (o instanceof Map<?, ?> mm) mm.forEach((k, v) -> {
            if (v instanceof List<?> l && !l.isEmpty()) out.put(String.valueOf(k), new ArrayList<>((List<Object>) l));
            else if (v != null && !(v instanceof List)) out.put(String.valueOf(k), List.of(String.valueOf(v)));
        });
        return out;
    }

    private static String filtersText(Map<String, List<Object>> s) {
        if (s.isEmpty()) return "";
        List<String> p = new ArrayList<>();
        s.forEach((f, v) -> p.add(f + " = " + String.join(" o ", v.stream().map(String::valueOf).toList())));
        return " (con " + String.join(" y ", p) + ")";
    }

    private static double num(String s) { return Double.parseDouble(s.trim().replace(",", "")); }
    static String str(Object o) { return o == null ? "" : String.valueOf(o); }
    static String blankNull(Object o) { String s = str(o).strip(); return s.isEmpty() ? null : s; }
}
