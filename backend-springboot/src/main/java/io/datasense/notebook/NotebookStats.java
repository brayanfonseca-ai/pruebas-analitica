package io.datasense.notebook;

import io.datasense.engine.DataFrame;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Análisis estadísticos del cuaderno sobre una tabla en memoria. Cada uno devuelve un mapa listo para pintar:
 * {@code summary} (frase en español), {@code columns}/{@code rows} (tabla) y los datos de su gráfico.
 * <ul>
 *   <li>{@link #profile}: perfil de un campo (nulos, distintos, rango, media, mediana, desviación, percentiles,
 *       asimetría, atípicos, histograma; en texto los valores más frecuentes; en fechas el rango y la serie mensual).</li>
 *   <li>{@link #pareto}: Pareto 80/20 y clasificación ABC de una dimensión por una medida.</li>
 *   <li>{@link #correlation}: matriz de correlación de Pearson entre campos numéricos y las parejas más fuertes.</li>
 *   <li>{@link #outliers}: valores atípicos de un campo por el método de Tukey (IQR) con su z-score.</li>
 * </ul>
 */
public final class NotebookStats {

    private NotebookStats() {}

    /* ==================================== Perfil ==================================== */

    public static Map<String, Object> profile(String table, DataFrame df, String field, String type, String display) {
        List<String> vals = column(df, field);
        int n = vals.size();
        List<String> present = new ArrayList<>();
        for (String v : vals) if (v != null && !v.isBlank()) present.add(v.strip());
        int nulls = n - present.size();
        LinkedHashMap<String, Integer> freq = new LinkedHashMap<>();
        for (String v : present) freq.merge(v, 1, Integer::sum);

        Map<String, Object> out = base("profile", table);
        out.put("field", field);
        out.put("display", display == null ? field : display);
        out.put("count", n);
        out.put("nulls", nulls);
        out.put("null_pct", pct(nulls, n));
        out.put("distinct", freq.size());
        out.put("unique_pct", pct(freq.size(), Math.max(1, present.size())));

        List<Double> nums = new ArrayList<>();
        for (String v : present) { Double d = NotebookSql.num(v); if (d != null) nums.add(d); }
        boolean numeric = "number".equals(type) || (!present.isEmpty() && nums.size() >= present.size() * 0.95);
        List<LocalDate> dates = numeric ? List.of() : parseDates(present);
        boolean date = !numeric && ("date".equals(type) || (!present.isEmpty() && dates.size() >= present.size() * 0.95));
        out.put("type", numeric ? "number" : date ? "date" : "text");
        List<String> notes = new ArrayList<>();
        if (nulls > 0) notes.add(fmt(pct(nulls, n)) + " % de las filas está vacío (" + nf(nulls) + ").");

        if (numeric && !nums.isEmpty()) {
            Collections.sort(nums);
            double sum = 0; for (double d : nums) sum += d;
            double mean = sum / nums.size();
            double var = 0; for (double d : nums) var += (d - mean) * (d - mean);
            double sd = nums.size() > 1 ? Math.sqrt(var / (nums.size() - 1)) : 0;
            double skew = 0;
            if (sd > 0 && nums.size() > 2) { for (double d : nums) skew += Math.pow((d - mean) / sd, 3); skew = skew * nums.size() / ((nums.size() - 1.0) * (nums.size() - 2.0)); }
            double q1 = NotebookSql.quantile(nums, .25), q3 = NotebookSql.quantile(nums, .75), iqr = q3 - q1;
            double lo = q1 - 1.5 * iqr, hi = q3 + 1.5 * iqr;
            int outl = 0; for (double d : nums) if (d < lo || d > hi) outl++;
            int zeros = 0, neg = 0; for (double d : nums) { if (d == 0) zeros++; if (d < 0) neg++; }
            Map<String, Object> st = new LinkedHashMap<>();
            st.put("min", nums.get(0)); st.put("p5", NotebookSql.quantile(nums, .05)); st.put("p25", q1);
            st.put("median", NotebookSql.quantile(nums, .5)); st.put("p75", q3); st.put("p95", NotebookSql.quantile(nums, .95));
            st.put("max", nums.get(nums.size() - 1)); st.put("mean", mean); st.put("stddev", sd); st.put("sum", sum);
            st.put("cv", mean != 0 ? sd / Math.abs(mean) : null); st.put("skewness", skew);
            st.put("iqr", iqr); st.put("outliers", outl); st.put("outlier_low", lo); st.put("outlier_high", hi);
            st.put("zeros", zeros); st.put("negatives", neg);
            out.put("stats", st);
            out.put("histogram", histogram(nums));
            String shape = Math.abs(skew) < 0.5 ? "simétrica" : skew > 0 ? "sesgada a la derecha (cola de valores altos)" : "sesgada a la izquierda (cola de valores bajos)";
            notes.add("Distribución " + shape + "; la mediana es " + fmt(NotebookSql.quantile(nums, .5)) + " y la media " + fmt(mean) + ".");
            if (outl > 0) notes.add(nf(outl) + " valores atípicos (" + fmt(pct(outl, nums.size())) + " %) fuera de [" + fmt(lo) + " ; " + fmt(hi) + "].");
            if (mean != 0 && sd / Math.abs(mean) > 1) notes.add("Variabilidad alta: la desviación supera a la media (CV " + fmt(sd / Math.abs(mean)) + ").");
            if (freq.size() <= 2 && present.size() > 10) notes.add("Solo " + freq.size() + " valores distintos: parece un indicador (0/1), no una cantidad.");
            out.put("columns", List.of("Estadístico", "Valor"));
            List<List<Object>> rows = new ArrayList<>();
            String[][] lbl = {{"min", "Mínimo"}, {"p5", "Percentil 5"}, {"p25", "Percentil 25 (Q1)"}, {"median", "Mediana"}, {"p75", "Percentil 75 (Q3)"},
                    {"p95", "Percentil 95"}, {"max", "Máximo"}, {"mean", "Media"}, {"stddev", "Desviación estándar"}, {"cv", "Coef. de variación"},
                    {"skewness", "Asimetría"}, {"sum", "Suma"}, {"outliers", "Atípicos (IQR)"}};
            for (String[] l : lbl) rows.add(row(l[1], st.get(l[0]) == null ? "—" : st.get(l[0])));
            out.put("rows", rows);
        } else if (date && !dates.isEmpty()) {
            Collections.sort(dates);
            TreeMap<String, Integer> byMonth = new TreeMap<>();
            for (LocalDate d : dates) byMonth.merge(d.format(DateTimeFormatter.ofPattern("yyyy-MM")), 1, Integer::sum);
            List<Map<String, Object>> series = new ArrayList<>();
            byMonth.forEach((k, v) -> series.add(map("period", k, "count", v)));
            out.put("date_min", dates.get(0).toString());
            out.put("date_max", dates.get(dates.size() - 1).toString());
            out.put("series", series.size() > 60 ? series.subList(series.size() - 60, series.size()) : series);
            notes.add("De " + dates.get(0) + " a " + dates.get(dates.size() - 1) + " (" + byMonth.size() + " meses con datos).");
            String peak = byMonth.entrySet().stream().max(Map.Entry.comparingByValue()).map(Map.Entry::getKey).orElse(null);
            if (peak != null) notes.add("El mes con más registros es " + peak + " (" + nf(byMonth.get(peak)) + ").");
            out.put("columns", List.of("Mes", "Registros"));
            List<List<Object>> rows = new ArrayList<>();
            byMonth.descendingMap().forEach((k, v) -> rows.add(row(k, v)));
            out.put("rows", rows.size() > 36 ? rows.subList(0, 36) : rows);
        } else {
            List<Map.Entry<String, Integer>> top = new ArrayList<>(freq.entrySet());
            top.sort((a, b) -> b.getValue() - a.getValue());
            List<List<Object>> rows = new ArrayList<>();
            int shown = 0, cum = 0;
            for (var e : top) { if (shown++ >= 20) break; cum += e.getValue(); rows.add(row(e.getKey(), e.getValue(), pct(e.getValue(), present.size()), pct(cum, present.size()))); }
            out.put("columns", List.of("Valor", "Filas", "%", "% acumulado"));
            out.put("rows", rows);
            int minL = Integer.MAX_VALUE, maxL = 0; long totL = 0;
            for (String v : present) { minL = Math.min(minL, v.length()); maxL = Math.max(maxL, v.length()); totL += v.length(); }
            out.put("length", Map.of("min", present.isEmpty() ? 0 : minL, "max", maxL, "avg", present.isEmpty() ? 0 : (double) totL / present.size()));
            if (!top.isEmpty()) notes.add("El valor más frecuente es «" + top.get(0).getKey() + "» (" + fmt(pct(top.get(0).getValue(), present.size())) + " % de las filas).");
            if (freq.size() == present.size() && present.size() > 1) notes.add("Todos los valores son distintos: sirve como identificador.");
            else if (freq.size() > present.size() * 0.9 && present.size() > 50) notes.add("Casi todos los valores son distintos: parece un identificador o un texto libre.");
            Set<String> norm = new HashSet<>();
            int dup = 0;
            for (String k : freq.keySet()) if (!norm.add(k.toLowerCase(Locale.ROOT).replaceAll("\\s+", " ").strip())) dup++;
            if (dup > 0) notes.add(dup + (dup == 1 ? " valor se repite" : " valores se repiten") + " con otras mayúsculas o espacios (p. ej. «Cali» y «CALI »): conviene normalizarlos.");
        }
        out.put("notes", notes);
        out.put("summary", String.join(" ", notes));
        return out;
    }

    private static List<Map<String, Object>> histogram(List<Double> sorted) {
        List<Map<String, Object>> out = new ArrayList<>();
        double min = sorted.get(0), max = sorted.get(sorted.size() - 1);
        LinkedHashSet<Double> distinct = new LinkedHashSet<>(sorted);
        if (distinct.size() <= 20 && distinct.stream().allMatch(d -> d == Math.rint(d))) {
            Map<Double, Integer> c = new TreeMap<>();
            for (double d : sorted) c.merge(d, 1, Integer::sum);
            c.forEach((k, v) -> out.add(map("from", k, "to", k, "label", fmt(k), "count", v)));
            return out;
        }
        int bins = Math.max(5, Math.min(24, (int) Math.ceil(Math.log(sorted.size()) / Math.log(2) + 1)));
        double w = (max - min) / bins;
        if (w <= 0) { out.add(map("from", min, "to", max, "label", fmt(min), "count", sorted.size())); return out; }
        int[] c = new int[bins];
        for (double d : sorted) c[Math.min(bins - 1, (int) ((d - min) / w))]++;
        for (int i = 0; i < bins; i++) {
            double a = min + i * w, b = a + w;
            out.add(map("from", a, "to", b, "label", fmt(a) + " – " + fmt(b), "count", c[i]));
        }
        return out;
    }

    /* ==================================== Pareto / ABC ==================================== */

    /** {@code rows}: [[valor de la dimensión, medida], …] ya agregados (los calcula el SQL del cuaderno). */
    public static Map<String, Object> pareto(String table, String dimension, String measureLabel, List<List<Object>> grouped) {
        List<Object[]> items = new ArrayList<>();
        double total = 0;
        for (List<Object> r : grouped) {
            Double v = NotebookSql.num(r.get(1));
            if (v == null) continue;
            items.add(new Object[]{r.get(0), v});
            total += v;
        }
        items.sort((a, b) -> Double.compare((Double) b[1], (Double) a[1]));
        Map<String, Object> out = base("pareto", table);
        out.put("dimension", dimension);
        out.put("measure", measureLabel);
        if (items.isEmpty() || total == 0) {
            out.put("columns", List.of(dimension, measureLabel));
            out.put("rows", List.of());
            out.put("summary", "No hay valores para repartir: la medida suma 0 o no tiene datos.");
            return out;
        }
        List<List<Object>> rows = new ArrayList<>();
        double cum = 0; int a = 0, b = 0, c = 0, idx80 = -1;
        boolean neg = false;
        for (int i = 0; i < items.size(); i++) {
            double v = (Double) items.get(i)[1];
            if (v < 0) neg = true;
            double before = cum / total * 100;
            cum += v;
            double share = v / total * 100, cumPct = cum / total * 100;
            String cls = before < 80 ? "A" : before < 95 ? "B" : "C";
            if (cls.equals("A")) a++; else if (cls.equals("B")) b++; else c++;
            if (idx80 < 0 && cumPct >= 80) idx80 = i;
            rows.add(row(String.valueOf(items.get(i)[0]), v, round(share, 2), round(cumPct, 2), cls));
        }
        int n = items.size();
        int top = idx80 + 1;
        double topPct = pct(top, n);
        out.put("columns", List.of(dimension, measureLabel, "% del total", "% acumulado", "Clase"));
        out.put("rows", rows);
        out.put("total", total);
        out.put("classes", Map.of("A", a, "B", b, "C", c));
        out.put("items", n);
        out.put("top80", top);
        String concentration = topPct <= 25 ? "muy concentrada" : topPct <= 45 ? "concentrada" : topPct <= 65 ? "moderadamente repartida" : "muy repartida";
        out.put("summary", top + " de " + n + " " + dimension + " (" + fmt(topPct) + " %) explican el 80 % de " + measureLabel
                + ": la distribución está " + concentration + ". Clase A " + a + " · B " + b + " · C " + c + "."
                + (neg ? " Hay valores negativos: el acumulado puede pasar de 100 % antes del final." : ""));
        return out;
    }

    /* ==================================== Correlación ==================================== */

    public static Map<String, Object> correlation(String table, DataFrame df, List<String> fields, Map<String, String> types) {
        List<String> cand = new ArrayList<>();
        if (fields != null && !fields.isEmpty()) cand.addAll(fields);
        else for (String c : df.columns()) if ("number".equals(types.getOrDefault(c, df.typeOf(c)))) cand.add(c);
        // fuera identificadores y constantes
        List<String> use = new ArrayList<>();
        Map<String, double[]> data = new LinkedHashMap<>();
        for (String f : cand) {
            if (df.indexOf(f) < 0) throw new NotebookSql.SqlError("El campo «" + f + "» no existe en " + table + ".");
            List<String> vs = column(df, f);
            double[] arr = new double[vs.size()];
            Set<Double> distinct = new HashSet<>();
            int ok = 0;
            for (int i = 0; i < vs.size(); i++) { Double d = NotebookSql.num(vs.get(i)); arr[i] = d == null ? Double.NaN : d; if (d != null) { ok++; if (distinct.size() < 3) distinct.add(d); } }
            if (ok < 3 || distinct.size() < 2) continue;
            if ((fields == null || fields.isEmpty()) && Pattern.compile("(?i)(^|[\\s_])(id|cod|codigo|código|cedula|cédula|documento|nit|telefono|celular)([\\s_]|$)").matcher(f).find()) continue;
            use.add(f); data.put(f, arr);
            if (use.size() >= 15) break;
        }
        Map<String, Object> out = base("correlation", table);
        if (use.size() < 2) {
            out.put("fields", use); out.put("matrix", List.of()); out.put("columns", List.of()); out.put("rows", List.of());
            out.put("summary", "Se necesitan al menos dos campos numéricos con variación para medir correlación.");
            return out;
        }
        int k = use.size();
        double[][] m = new double[k][k];
        int[][] nn = new int[k][k];
        for (int i = 0; i < k; i++) for (int j = i; j < k; j++) {
            double[] r = pearson(data.get(use.get(i)), data.get(use.get(j)));
            m[i][j] = m[j][i] = i == j ? 1 : r[0];
            nn[i][j] = nn[j][i] = (int) r[1];
        }
        List<List<Object>> matrix = new ArrayList<>();
        for (int i = 0; i < k; i++) { List<Object> row = new ArrayList<>(); for (int j = 0; j < k; j++) row.add(Double.isNaN(m[i][j]) ? null : round(m[i][j], 3)); matrix.add(row); }
        List<Object[]> pairs = new ArrayList<>();
        for (int i = 0; i < k; i++) for (int j = i + 1; j < k; j++) if (!Double.isNaN(m[i][j])) pairs.add(new Object[]{use.get(i), use.get(j), m[i][j], nn[i][j]});
        pairs.sort((a, b) -> Double.compare(Math.abs((Double) b[2]), Math.abs((Double) a[2])));
        List<List<Object>> rows = new ArrayList<>();
        for (Object[] p : pairs) {
            double r = (Double) p[2];
            rows.add(row(p[0], p[1], round(r, 3), strength(r), r >= 0 ? "Directa" : "Inversa", p[3]));
        }
        out.put("fields", use);
        out.put("matrix", matrix);
        out.put("columns", List.of("Campo A", "Campo B", "r", "Fuerza", "Sentido", "Filas"));
        out.put("rows", rows);
        if (!pairs.isEmpty()) {
            Object[] t = pairs.get(0);
            double r = (Double) t[2];
            long strong = pairs.stream().filter(p -> Math.abs((Double) p[2]) >= 0.6).count();
            out.put("summary", "La relación más fuerte es entre «" + t[0] + "» y «" + t[1] + "» (r = " + fmt(r) + ", " + strength(r).toLowerCase(Locale.ROOT)
                    + ", " + (r >= 0 ? "cuando una sube la otra también" : "cuando una sube la otra baja") + "). "
                    + strong + (strong == 1 ? " pareja fuerte" : " parejas fuertes") + " (|r| ≥ 0,6) de " + pairs.size() + ". Correlación no implica causa.");
        }
        return out;
    }

    private static double[] pearson(double[] x, double[] y) {
        double sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0; int n = 0;
        for (int i = 0; i < Math.min(x.length, y.length); i++) {
            if (Double.isNaN(x[i]) || Double.isNaN(y[i])) continue;
            n++; sx += x[i]; sy += y[i]; sxx += x[i] * x[i]; syy += y[i] * y[i]; sxy += x[i] * y[i];
        }
        if (n < 3) return new double[]{Double.NaN, n};
        double cov = sxy - sx * sy / n, vx = sxx - sx * sx / n, vy = syy - sy * sy / n;
        if (vx <= 0 || vy <= 0) return new double[]{Double.NaN, n};
        return new double[]{cov / Math.sqrt(vx * vy), n};
    }

    private static String strength(double r) {
        double a = Math.abs(r);
        return a >= 0.8 ? "Muy fuerte" : a >= 0.6 ? "Fuerte" : a >= 0.4 ? "Moderada" : a >= 0.2 ? "Débil" : "Casi nula";
    }

    /* ==================================== Atípicos ==================================== */

    public static Map<String, Object> outliers(String table, DataFrame df, String field, double k) {
        int fi = df.indexOf(field);
        if (fi < 0) throw new NotebookSql.SqlError("El campo «" + field + "» no existe en " + table + ".");
        List<Double> nums = new ArrayList<>();
        for (List<String> r : df.rows()) { Double d = fi < r.size() ? NotebookSql.num(r.get(fi)) : null; if (d != null) nums.add(d); }
        Map<String, Object> out = base("outliers", table);
        out.put("field", field);
        if (nums.size() < 4) { out.put("columns", List.of()); out.put("rows", List.of()); out.put("summary", "«" + field + "» no tiene suficientes valores numéricos para buscar atípicos."); return out; }
        List<Double> s = new ArrayList<>(nums); Collections.sort(s);
        double q1 = NotebookSql.quantile(s, .25), q3 = NotebookSql.quantile(s, .75), iqr = q3 - q1, lo = q1 - k * iqr, hi = q3 + k * iqr;
        double mean = 0; for (double d : s) mean += d; mean /= s.size();
        double sd = 0; for (double d : s) sd += (d - mean) * (d - mean); sd = Math.sqrt(sd / Math.max(1, s.size() - 1));
        // Columnas de contexto: las primeras de la tabla (sin el campo) para reconocer el registro.
        List<String> ctx = new ArrayList<>();
        for (String c : df.columns()) { if (!c.equals(field)) ctx.add(c); if (ctx.size() >= 5) break; }
        List<Object[]> found = new ArrayList<>();
        int low = 0, high = 0;
        for (List<String> r : df.rows()) {
            Double d = fi < r.size() ? NotebookSql.num(r.get(fi)) : null;
            if (d == null || (d >= lo && d <= hi)) continue;
            if (d < lo) low++; else high++;
            found.add(new Object[]{d, r});
        }
        final double mu = mean;
        found.sort((a, b) -> Double.compare(Math.abs((Double) b[0] - mu), Math.abs((Double) a[0] - mu)));
        List<String> cols = new ArrayList<>(ctx);
        cols.add(field); cols.add("z-score"); cols.add("Lado");
        List<List<Object>> rows = new ArrayList<>();
        for (Object[] f : found) {
            if (rows.size() >= 200) break;
            @SuppressWarnings("unchecked") List<String> r = (List<String>) f[1];
            List<Object> row = new ArrayList<>();
            for (String c : ctx) { int i = df.indexOf(c); row.add(i < r.size() ? r.get(i) : null); }
            double d = (Double) f[0];
            row.add(d); row.add(sd > 0 ? round((d - mean) / sd, 2) : null); row.add(d > hi ? "Alto" : "Bajo");
            rows.add(row);
        }
        out.put("columns", cols);
        out.put("rows", rows);
        out.put("fences", Map.of("low", lo, "high", hi, "q1", q1, "q3", q3, "k", k));
        out.put("counts", Map.of("low", low, "high", high, "total", nums.size()));
        out.put("box", Map.of("min", s.get(0), "q1", q1, "median", NotebookSql.quantile(s, .5), "q3", q3, "max", s.get(s.size() - 1)));
        out.put("summary", (low + high == 0
                ? "Sin atípicos: todos los valores de «" + field + "» están entre " + fmt(lo) + " y " + fmt(hi) + "."
                : nf(low + high) + " atípicos en «" + field + "» (" + fmt(pct(low + high, nums.size())) + " %): " + nf(high) + " altos (> " + fmt(hi) + ") y " + nf(low) + " bajos (< " + fmt(lo) + "). "
                  + "Método de Tukey con k = " + fmt(k) + " (Q1 " + fmt(q1) + ", Q3 " + fmt(q3) + ")."));
        return out;
    }

    /* ==================================== utilidades ==================================== */

    /** Fila con tipos mezclados y nulos permitidos. */
    private static List<Object> row(Object... v) { return new ArrayList<>(Arrays.asList(v)); }

    private static Map<String, Object> map(Object... kv) {
        Map<String, Object> m = new LinkedHashMap<>();
        for (int i = 0; i + 1 < kv.length; i += 2) m.put(String.valueOf(kv[i]), kv[i + 1]);
        return m;
    }

    private static Map<String, Object> base(String kind, String table) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("kind", kind);
        m.put("table", table);
        return m;
    }

    private static List<String> column(DataFrame df, String field) {
        if (df.indexOf(field) < 0) throw new NotebookSql.SqlError("El campo «" + field + "» no existe.");
        return df.columnValues(field);
    }

    private static final Pattern ISO = Pattern.compile("^(\\d{4})-(\\d{1,2})-(\\d{1,2})"), DMY = Pattern.compile("^(\\d{1,2})/(\\d{1,2})/(\\d{4})");

    private static List<LocalDate> parseDates(List<String> vals) {
        List<LocalDate> out = new ArrayList<>();
        for (String v : vals) {
            try {
                Matcher m = ISO.matcher(v);
                if (m.find()) { out.add(LocalDate.of(Integer.parseInt(m.group(1)), Integer.parseInt(m.group(2)), Integer.parseInt(m.group(3)))); continue; }
                m = DMY.matcher(v);
                if (m.find()) out.add(LocalDate.of(Integer.parseInt(m.group(3)), Integer.parseInt(m.group(2)), Integer.parseInt(m.group(1))));
            } catch (RuntimeException ignored) { /* no es fecha */ }
        }
        return out;
    }

    static double pct(double a, double b) { return b == 0 ? 0 : round(a / b * 100, 2); }
    static double round(double v, int d) { double p = Math.pow(10, d); return Math.round(v * p) / p; }
    private static String nf(long v) { return java.text.NumberFormat.getIntegerInstance(new Locale("es", "CO")).format(v); }
    static String fmt(double v) {
        java.text.NumberFormat f = java.text.NumberFormat.getNumberInstance(new Locale("es", "CO"));
        f.setMaximumFractionDigits(Math.abs(v) >= 100 ? 1 : 2);
        return f.format(v);
    }
}
