package io.datasense.ml;

import io.datasense.engine.DataFrame;
import org.springframework.stereotype.Service;

import java.util.*;

import static io.datasense.ml.MlMath.*;

/**
 * Laboratorio de ML: algoritmos implementados en Java puro (sin librerías externas).
 * Cada algoritmo recibe un {@link DataFrame} y parámetros, y devuelve un mapa
 * serializable a JSON con métricas, datos para gráficos, lectura del resultado y,
 * opcionalmente, la predicción de un caso ({@code input}).
 */
@Service
public class MlService {

    private static final int MAX_ROWS = 20000;
    private static final long SEED = 42L;

    public Map<String, Object> run(DataFrame df, String algorithm, Map<String, Object> p) {
        if (algorithm == null) throw new IllegalArgumentException("Falta el algoritmo.");
        return switch (algorithm) {
            case "kmeans" -> kmeans(df, p);
            case "linear" -> linear(df, p);
            case "forecast" -> forecast(df, p);
            case "logistic" -> logistic(df, p);
            case "anomaly" -> anomaly(df, p);
            case "correlation" -> correlation(df, p);
            case "pca" -> pca(df, p);
            default -> throw new IllegalArgumentException("Algoritmo no soportado: " + algorithm);
        };
    }

    /* ===================================================================== */
    /* Utilidades de entrada                                                  */
    /* ===================================================================== */

    private record Data(List<String> cols, double[][] x, int[] rowIdx, boolean sampled, int complete) {}

    private static Double parse(String s) {
        if (s == null) return null;
        String t = s.trim();
        if (t.isEmpty()) return null;
        try {
            if (t.indexOf(',') >= 0 && t.indexOf('.') < 0) t = t.replace(',', '.');
            double v = Double.parseDouble(t);
            return Double.isFinite(v) ? v : null;
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private Data extract(DataFrame df, List<String> cols) {
        int[] ci = new int[cols.size()];
        for (int i = 0; i < ci.length; i++) {
            ci[i] = df.indexOf(cols.get(i));
            if (ci[i] < 0) throw new IllegalArgumentException("Campo no encontrado: " + cols.get(i));
        }
        List<double[]> rows = new ArrayList<>();
        List<Integer> idx = new ArrayList<>();
        List<List<String>> all = df.rows();
        for (int r = 0; r < all.size(); r++) {
            double[] v = new double[ci.length];
            boolean ok = true;
            for (int j = 0; j < ci.length; j++) {
                Double d = parse(all.get(r).get(ci[j]));
                if (d == null) { ok = false; break; }
                v[j] = d;
            }
            if (ok) { rows.add(v); idx.add(r); }
        }
        int complete = rows.size();
        boolean sampled = false;
        if (rows.size() > MAX_ROWS) {
            sampled = true;
            double step = rows.size() / (double) MAX_ROWS;
            List<double[]> r2 = new ArrayList<>();
            List<Integer> i2 = new ArrayList<>();
            for (int k = 0; k < MAX_ROWS; k++) {
                int at = (int) (k * step);
                r2.add(rows.get(at));
                i2.add(idx.get(at));
            }
            rows = r2; idx = i2;
        }
        int[] ri = new int[idx.size()];
        for (int i = 0; i < ri.length; i++) ri[i] = idx.get(i);
        return new Data(cols, rows.toArray(new double[0][]), ri, sampled, complete);
    }

    private static String str(Map<String, Object> p, String k) {
        Object o = p.get(k);
        return o == null || String.valueOf(o).isBlank() ? null : String.valueOf(o);
    }

    private static List<String> strList(Map<String, Object> p, String k) {
        Object o = p.get(k);
        List<String> out = new ArrayList<>();
        if (o instanceof List<?> l) for (Object e : l) if (e != null) out.add(String.valueOf(e));
        return out;
    }

    private static int intp(Map<String, Object> p, String k, int def) {
        Object o = p.get(k);
        if (o instanceof Number n) return n.intValue();
        if (o != null) try { return Integer.parseInt(String.valueOf(o).trim()); } catch (NumberFormatException ignored) {}
        return def;
    }

    private static double dbl(Map<String, Object> p, String k, double def) {
        Object o = p.get(k);
        if (o instanceof Number n) return n.doubleValue();
        if (o != null) { Double d = parse(String.valueOf(o)); if (d != null) return d; }
        return def;
    }

    private static boolean bool(Map<String, Object> p, String k, boolean def) {
        Object o = p.get(k);
        if (o instanceof Boolean b) return b;
        if (o != null) return "true".equalsIgnoreCase(String.valueOf(o));
        return def;
    }

    private static Map<String, Double> inputMap(Map<String, Object> p) {
        Object o = p.get("input");
        if (!(o instanceof Map<?, ?> m) || m.isEmpty()) return null;
        Map<String, Double> out = new LinkedHashMap<>();
        for (Map.Entry<?, ?> e : m.entrySet()) {
            Double d = parse(String.valueOf(e.getValue()));
            if (d != null) out.put(String.valueOf(e.getKey()), d);
        }
        return out;
    }

    private static Map<String, Object> map(Object... kv) {
        Map<String, Object> m = new LinkedHashMap<>();
        for (int i = 0; i + 1 < kv.length; i += 2) m.put(String.valueOf(kv[i]), kv[i + 1]);
        return m;
    }

    private static String fmt(double v) {
        double a = Math.abs(v);
        if (a >= 1000) return String.format(Locale.US, "%,.0f", v);
        if (a >= 100) return String.format(Locale.US, "%.1f", v);
        if (a >= 1) return String.format(Locale.US, "%.2f", v);
        return String.format(Locale.US, "%.4f", v);
    }

    private static String pct(double v) { return String.format(Locale.US, "%.1f%%", v * 100); }

    private static int[] shuffled(int n) {
        int[] a = new int[n];
        for (int i = 0; i < n; i++) a[i] = i;
        Random rnd = new Random(SEED);
        for (int i = n - 1; i > 0; i--) { int j = rnd.nextInt(i + 1); int t = a[i]; a[i] = a[j]; a[j] = t; }
        return a;
    }

    private static List<Integer> strideIndexes(int n, int cap) {
        List<Integer> out = new ArrayList<>();
        double step = Math.max(1.0, n / (double) cap);
        for (double at = 0; at < n && out.size() < cap; at += step) out.add((int) at);
        return out;
    }

    private static void requireRows(int n, int min) {
        if (n < min) throw new IllegalArgumentException("Se necesitan al menos " + min + " filas completas y hay " + n + ". Revisa valores vacíos en las variables elegidas.");
    }

    /* ===================================================================== */
    /* 1) K-MEANS                                                             */
    /* ===================================================================== */

    private static final class KFit { double[][] c; int[] a; double inertia; }

    private static double dist2(double[] a, double[] b) {
        double s = 0;
        for (int i = 0; i < a.length; i++) { double d = a[i] - b[i]; s += d * d; }
        return s;
    }

    private KFit kfit(double[][] z, int k, long seed) {
        int n = z.length, dim = z[0].length;
        Random rnd = new Random(seed);
        double[][] c = new double[k][];
        c[0] = z[rnd.nextInt(n)].clone();
        double[] d2 = new double[n];
        for (int i = 1; i < k; i++) {
            double tot = 0;
            for (int r = 0; r < n; r++) {
                double m = Double.MAX_VALUE;
                for (int j = 0; j < i; j++) m = Math.min(m, dist2(z[r], c[j]));
                d2[r] = m; tot += m;
            }
            double pick = rnd.nextDouble() * tot, cum = 0;
            int sel = n - 1;
            for (int r = 0; r < n; r++) { cum += d2[r]; if (cum >= pick) { sel = r; break; } }
            c[i] = z[sel].clone();
        }
        int[] a = new int[n];
        Arrays.fill(a, -1);
        for (int it = 0; it < 100; it++) {
            boolean changed = false;
            for (int r = 0; r < n; r++) {
                int best = 0; double bd = Double.MAX_VALUE;
                for (int j = 0; j < k; j++) { double d = dist2(z[r], c[j]); if (d < bd) { bd = d; best = j; } }
                if (a[r] != best) { a[r] = best; changed = true; }
            }
            double[][] sum = new double[k][dim];
            int[] cnt = new int[k];
            for (int r = 0; r < n; r++) { cnt[a[r]]++; for (int j = 0; j < dim; j++) sum[a[r]][j] += z[r][j]; }
            for (int j = 0; j < k; j++) {
                if (cnt[j] == 0) { c[j] = z[rnd.nextInt(n)].clone(); changed = true; continue; }
                for (int d = 0; d < dim; d++) c[j][d] = sum[j][d] / cnt[j];
            }
            if (!changed) break;
        }
        KFit f = new KFit();
        f.c = c; f.a = a;
        double in = 0;
        for (int r = 0; r < n; r++) in += dist2(z[r], c[a[r]]);
        f.inertia = in;
        return f;
    }

    private KFit bestFit(double[][] z, int k) {
        KFit best = null;
        for (int r = 0; r < 8; r++) {
            KFit f = kfit(z, k, SEED + r * 17L);
            if (best == null || f.inertia < best.inertia) best = f;
        }
        return best;
    }

    private double silhouette(double[][] z, int[] a, int k) {
        int n = z.length;
        double total = 0; int cntS = 0;
        int step = Math.max(1, n / 400);
        for (int i = 0; i < n; i += step) {
            double[] sum = new double[k];
            int[] cnt = new int[k];
            for (int j = 0; j < n; j++) {
                if (j == i) continue;
                sum[a[j]] += Math.sqrt(dist2(z[i], z[j]));
                cnt[a[j]]++;
            }
            int own = a[i];
            if (cnt[own] == 0) { cntS++; continue; }
            double ai = sum[own] / cnt[own];
            double bi = Double.MAX_VALUE;
            for (int c = 0; c < k; c++) if (c != own && cnt[c] > 0) bi = Math.min(bi, sum[c] / cnt[c]);
            if (bi == Double.MAX_VALUE) { cntS++; continue; }
            total += (bi - ai) / Math.max(ai, bi);
            cntS++;
        }
        return cntS == 0 ? 0 : total / cntS;
    }

    private Map<String, Object> kmeans(DataFrame df, Map<String, Object> p) {
        List<String> feats = strList(p, "features");
        if (feats.size() < 2) throw new IllegalArgumentException("Selecciona al menos 2 variables numéricas.");
        Data d = extract(df, feats);
        int n = d.x().length;
        requireRows(n, 8);
        int dim = feats.size();
        boolean std = bool(p, "standardize", true);

        double[] mu = new double[dim], sg = new double[dim], gsd = new double[dim];
        for (int j = 0; j < dim; j++) {
            double[] col = column(d.x(), j);
            mu[j] = mean(col);
            gsd[j] = sd(col) == 0 ? 1 : sd(col);
            sg[j] = std ? gsd[j] : 1;
        }
        double[][] z = new double[n][dim];
        for (int i = 0; i < n; i++) for (int j = 0; j < dim; j++) z[i][j] = (d.x()[i][j] - mu[j]) / sg[j];

        int kmax = Math.min(8, n - 1);
        // Con pocos datos, k grande sobreajusta: la selección automática se limita a ~5 filas por grupo.
        int kAuto = Math.max(2, Math.min(6, n / 5));
        List<Map<String, Object>> elbow = new ArrayList<>();
        double bestSil = -2; int bestK = 2;
        for (int k = 1; k <= kmax; k++) {
            KFit f = bestFit(z, k);
            Double sil = null;
            if (k >= 2) {
                double s = silhouette(z, f.a, k);
                sil = r(s);
                if (k <= kAuto && s > bestSil) { bestSil = s; bestK = k; }
            }
            elbow.add(map("k", k, "inertia", r(f.inertia), "silhouette", sil));
        }
        int reqK = intp(p, "k", 0);
        int k = reqK > 0 ? Math.max(2, Math.min(Math.min(10, n - 1), reqK)) : bestK;
        KFit fit = bestFit(z, k);
        double sil = silhouette(z, fit.a, k);

        // Reordenar segmentos por tamaño (1 = el mayor)
        int[] size = new int[k];
        for (int a : fit.a) size[a]++;
        Integer[] order = new Integer[k];
        for (int i = 0; i < k; i++) order[i] = i;
        Arrays.sort(order, (x, y) -> Integer.compare(size[y], size[x]));
        int[] newId = new int[k];
        for (int i = 0; i < k; i++) newId[order[i]] = i;
        int[] assign = new int[n];
        for (int i = 0; i < n; i++) assign[i] = newId[fit.a[i]];
        double[][] centZ = new double[k][];
        for (int i = 0; i < k; i++) centZ[newId[i]] = fit.c[i];

        List<Map<String, Object>> clusters = new ArrayList<>();
        List<String> clusterNames = new ArrayList<>();
        for (int c = 0; c < k; c++) {
            double[] sum = new double[dim];
            int cnt = 0;
            for (int i = 0; i < n; i++) if (assign[i] == c) { cnt++; for (int j = 0; j < dim; j++) sum[j] += d.x()[i][j]; }
            Map<String, Object> centroid = new LinkedHashMap<>();
            Map<String, Object> profile = new LinkedHashMap<>();
            double maxAbs = 0; int maxJ = 0; double maxZ = 0;
            for (int j = 0; j < dim; j++) {
                double cm = cnt == 0 ? 0 : sum[j] / cnt;
                double zp = (cm - mu[j]) / gsd[j];
                centroid.put(feats.get(j), r(cm));
                profile.put(feats.get(j), r(zp));
                if (Math.abs(zp) > maxAbs) { maxAbs = Math.abs(zp); maxJ = j; maxZ = zp; }
            }
            String desc = maxAbs < 0.35 ? "Perfil medio" : (maxZ > 0 ? "Alto en " : "Bajo en ") + feats.get(maxJ);
            String name = "Segmento " + (char) ('A' + c) + " · " + desc;
            clusterNames.add(name);
            clusters.add(map("id", c + 1, "name", name, "size", cnt, "share", r(cnt / (double) n),
                    "centroid", centroid, "profile", profile));
        }

        // Proyección 2D con PCA sobre z
        double[][] cov = covariance(z);
        double[] ev = new double[dim];
        double[][] vec = jacobiEigen(cov, ev);
        double evSum = 0;
        for (double e : ev) evSum += Math.max(e, 0);
        List<Map<String, Object>> points = new ArrayList<>();
        for (int i : strideIndexes(n, 500)) {
            double px = 0, py = 0;
            for (int j = 0; j < dim; j++) { px += z[i][j] * vec[j][0]; py += z[i][j] * (dim > 1 ? vec[j][1] : 0); }
            points.add(map("x", r(px), "y", r(py), "c", assign[i] + 1));
        }
        List<Map<String, Object>> sample = new ArrayList<>();
        for (int i = 0; i < Math.min(12, n); i++) {
            Map<String, Object> vals = new LinkedHashMap<>();
            for (int j = 0; j < dim; j++) vals.put(feats.get(j), r(d.x()[i][j]));
            sample.add(map("row", d.rowIdx()[i] + 1, "values", vals, "cluster", assign[i] + 1, "name", clusterNames.get(assign[i])));
        }

        List<String> insights = new ArrayList<>();
        insights.add(k + " segmentos" + (reqK > 0 ? " (elegidos por ti)" : " (k con mejor silueta, limitado por el tamaño de los datos)") + ". El mayor concentra " + pct(size[order[0]] / (double) n) + " de los registros.");
        String q = sil >= 0.5 ? "fuerte: los grupos están bien separados" : sil >= 0.25 ? "razonable: hay estructura pero con cierto solapamiento" : "débil: los datos no forman grupos claros con estas variables";
        insights.add("Separación (silueta " + fmt(sil) + "): " + q + ".");
        if (evSum > 0 && dim > 1) insights.add("El mapa 2D conserva " + pct((ev[0] + ev[1]) / evSum) + " de la variación total.");
        if (d.sampled()) insights.add("Se usó una muestra de " + MAX_ROWS + " filas de " + d.complete() + ".");

        Map<String, Object> out = map("algorithm", "kmeans", "n", n, "features", feats, "k", k, "standardize", std,
                "inertia", r(fit.inertia), "silhouette", r(sil), "elbow", elbow, "clusters", clusters,
                "projection", points, "explained", List.of(r(evSum == 0 ? 0 : ev[0] / evSum), r(evSum == 0 || dim < 2 ? 0 : ev[1] / evSum)),
                "sample", sample, "insights", insights);

        Map<String, Double> in = inputMap(p);
        if (in != null) {
            double[] zi = new double[dim];
            for (int j = 0; j < dim; j++) {
                Double v = in.get(feats.get(j));
                if (v == null) throw new IllegalArgumentException("Falta el valor de '" + feats.get(j) + "' en el caso a probar.");
                zi[j] = (v - mu[j]) / sg[j];
            }
            int best = 0; double bd = Double.MAX_VALUE;
            for (int c = 0; c < k; c++) { double dd = dist2(zi, centZ[c]); if (dd < bd) { bd = dd; best = c; } }
            out.put("prediction", map("cluster", best + 1, "name", clusterNames.get(best), "distance", r(Math.sqrt(bd))));
        }
        return out;
    }

    private static double[][] covariance(double[][] z) {
        int n = z.length, dim = z[0].length;
        double[] m = new double[dim];
        for (double[] row : z) for (int j = 0; j < dim; j++) m[j] += row[j];
        for (int j = 0; j < dim; j++) m[j] /= n;
        double[][] cov = new double[dim][dim];
        for (double[] row : z)
            for (int a = 0; a < dim; a++)
                for (int b = a; b < dim; b++) cov[a][b] += (row[a] - m[a]) * (row[b] - m[b]);
        for (int a = 0; a < dim; a++)
            for (int b = a; b < dim; b++) { cov[a][b] /= Math.max(1, n - 1); cov[b][a] = cov[a][b]; }
        return cov;
    }

    /* ===================================================================== */
    /* 2) REGRESIÓN LINEAL                                                    */
    /* ===================================================================== */

    private static final class Ols { double[] beta; double[][] inv; }

    private Ols ols(double[][] x, double[] y) {
        double[][] xt = transpose(x);
        double[][] xtx = multiply(xt, x);
        double[][] inv = inverse(xtx);
        if (inv == null) {
            double tr = 0;
            for (int i = 0; i < xtx.length; i++) tr += xtx[i][i];
            for (int i = 1; i < xtx.length; i++) xtx[i][i] += 1e-6 * Math.max(tr, 1);
            inv = inverse(xtx);
            if (inv == null) throw new IllegalArgumentException("Las variables son colineales (una es combinación de otras). Quita alguna.");
        }
        double[] xty = new double[xt.length];
        for (int i = 0; i < xt.length; i++) { double s = 0; for (int j = 0; j < y.length; j++) s += xt[i][j] * y[j]; xty[i] = s; }
        double[] beta = new double[xt.length];
        for (int i = 0; i < beta.length; i++) { double s = 0; for (int j = 0; j < beta.length; j++) s += inv[i][j] * xty[j]; beta[i] = s; }
        Ols o = new Ols();
        o.beta = beta; o.inv = inv;
        return o;
    }

    private static double predictLin(double[] beta, double[] xRow) {
        double s = beta[0];
        for (int j = 0; j < xRow.length; j++) s += beta[j + 1] * xRow[j];
        return s;
    }

    private Map<String, Object> regMetrics(double[] beta, double[][] feat, double[] y, int[] idx) {
        if (idx.length == 0) return null;
        double my = 0;
        for (int i : idx) my += y[i];
        my /= idx.length;
        double sse = 0, sst = 0, sae = 0;
        for (int i : idx) {
            double e = y[i] - predictLin(beta, feat[i]);
            sse += e * e; sae += Math.abs(e); sst += (y[i] - my) * (y[i] - my);
        }
        double r2 = sst == 0 ? 0 : 1 - sse / sst;
        return map("n", idx.length, "r2", r(r2), "rmse", r(Math.sqrt(sse / idx.length)), "mae", r(sae / idx.length));
    }

    private Map<String, Object> linear(DataFrame df, Map<String, Object> p) {
        String target = str(p, "target");
        List<String> feats = new ArrayList<>(strList(p, "features"));
        feats.remove(target);
        if (target == null) throw new IllegalArgumentException("Elige la variable a predecir (objetivo).");
        if (feats.isEmpty()) throw new IllegalArgumentException("Elige al menos una variable predictora.");
        List<String> cols = new ArrayList<>();
        cols.add(target); cols.addAll(feats);
        Data d = extract(df, cols);
        int n = d.x().length, k = feats.size();
        requireRows(n, k + 5);

        double[] y = column(d.x(), 0);
        double[][] feat = new double[n][k];
        for (int i = 0; i < n; i++) for (int j = 0; j < k; j++) feat[i][j] = d.x()[i][j + 1];

        double testSize = Math.max(0, Math.min(0.5, dbl(p, "testSize", 0.2)));
        int nTest = n >= 15 ? (int) Math.round(n * testSize) : 0;
        if (n - nTest < k + 4) nTest = 0;
        int[] perm = shuffled(n);
        int[] test = Arrays.copyOfRange(perm, 0, nTest);
        int[] train = Arrays.copyOfRange(perm, nTest, n);

        double[][] xTr = new double[train.length][k + 1];
        double[] yTr = new double[train.length];
        for (int i = 0; i < train.length; i++) {
            xTr[i][0] = 1;
            System.arraycopy(feat[train[i]], 0, xTr[i], 1, k);
            yTr[i] = y[train[i]];
        }
        Ols fit = ols(xTr, yTr);
        Map<String, Object> mTrain = regMetrics(fit.beta, feat, y, train);
        Map<String, Object> mTest = nTest > 0 ? regMetrics(fit.beta, feat, y, test) : null;

        int df2 = Math.max(1, train.length - k - 1);
        double sse = 0;
        for (int i : train) { double e = y[i] - predictLin(fit.beta, feat[i]); sse += e * e; }
        double sigma2 = sse / df2;
        double r2Tr = (Double) mTrain.get("r2");
        double adj = 1 - (1 - r2Tr) * (train.length - 1.0) / df2;
        double sdY = sd(yTr);

        List<Map<String, Object>> coefs = new ArrayList<>();
        double tcrit = tCritical(df2);
        for (int j = 0; j <= k; j++) {
            double se = Math.sqrt(Math.max(0, sigma2 * fit.inv[j][j]));
            double t = se == 0 ? 0 : fit.beta[j] / se;
            String name = j == 0 ? "Intercepto" : feats.get(j - 1);
            double stdBeta = j == 0 || sdY == 0 ? 0 : fit.beta[j] * sd(column(feat, j - 1)) / sdY;
            coefs.add(map("name", name, "value", r(fit.beta[j]), "stdError", r(se), "t", r(t),
                    "significant", Math.abs(t) > tcrit, "standardized", r(stdBeta)));
        }

        StringBuilder eq = new StringBuilder(target + " = " + fmt(fit.beta[0]));
        for (int j = 0; j < k; j++) eq.append(fit.beta[j + 1] >= 0 ? " + " : " − ").append(fmt(Math.abs(fit.beta[j + 1]))).append("·").append(feats.get(j));

        Set<Integer> testSet = new HashSet<>();
        for (int i : test) testSet.add(i);
        List<Map<String, Object>> scatter = new ArrayList<>();
        for (int i : strideIndexes(n, 300)) {
            double pr = predictLin(fit.beta, feat[i]);
            scatter.add(map("actual", r(y[i]), "pred", r(pr), "set", testSet.contains(i) ? "test" : "train"));
        }

        List<String> insights = new ArrayList<>();
        double r2Eval = mTest != null ? (Double) mTest.get("r2") : r2Tr;
        insights.add("El modelo explica " + pct(Math.max(0, r2Eval)) + " de la variación de " + target + (mTest != null ? " en datos que no vio al entrenar." : " (sin conjunto de prueba: pocos datos)."));
        if (mTest != null && r2Tr - r2Eval > 0.15) insights.add("Posible sobreajuste: R² entrenamiento " + fmt(r2Tr) + " vs prueba " + fmt(r2Eval) + ".");
        List<String> sig = new ArrayList<>();
        Map<String, Object> top = null; double topAbs = 0;
        for (int j = 1; j < coefs.size(); j++) {
            Map<String, Object> c = coefs.get(j);
            if (Boolean.TRUE.equals(c.get("significant"))) sig.add((String) c.get("name"));
            double a = Math.abs((Double) c.get("standardized"));
            if (a > topAbs) { topAbs = a; top = c; }
        }
        if (top != null) insights.add("Variable con mayor peso: " + top.get("name") + " (coeficiente estandarizado " + fmt((Double) top.get("standardized")) + ").");
        insights.add(sig.isEmpty() ? "Ninguna variable es estadísticamente significativa (|t| < " + fmt(tcrit) + ")." : "Significativas: " + String.join(", ", sig) + ".");
        if (d.sampled()) insights.add("Se usó una muestra de " + MAX_ROWS + " filas de " + d.complete() + ".");

        Map<String, Object> out = map("algorithm", "linear", "n", n, "target", target, "features", feats,
                "equation", eq.toString(), "coefficients", coefs, "train", mTrain, "test", mTest, "adjR2", r(adj),
                "scatter", scatter, "insights", insights);

        Map<String, Double> in = inputMap(p);
        if (in != null) {
            double[] row = new double[k];
            for (int j = 0; j < k; j++) {
                Double v = in.get(feats.get(j));
                if (v == null) throw new IllegalArgumentException("Falta el valor de '" + feats.get(j) + "' en el caso a probar.");
                row[j] = v;
            }
            double pr = predictLin(fit.beta, row);
            double rm = (Double) mTrain.get("rmse");
            out.put("prediction", map("value", r(pr), "lower", r(pr - 1.96 * rm), "upper", r(pr + 1.96 * rm)));
        }
        return out;
    }

    /* ===================================================================== */
    /* 3) PRONÓSTICO DE SERIES                                                */
    /* ===================================================================== */

    private interface Forecaster { double[][] fit(double[] y, int h); }

    private static final Forecaster NAIVE = (y, h) -> {
        int n = y.length;
        double[] fitted = new double[n];
        fitted[0] = y[0];
        for (int t = 1; t < n; t++) fitted[t] = y[t - 1];
        double[] fc = new double[h];
        Arrays.fill(fc, y[n - 1]);
        return new double[][]{fitted, fc};
    };

    private static final Forecaster TREND = (y, h) -> {
        int n = y.length;
        double[][] x = new double[n][2];
        for (int t = 0; t < n; t++) { x[t][0] = 1; x[t][1] = t; }
        double[][] xt = transpose(x);
        double[][] inv = inverse(multiply(xt, x));
        double b0 = y[0], b1 = 0;
        if (inv != null) {
            double[] xty = new double[2];
            for (int t = 0; t < n; t++) { xty[0] += y[t]; xty[1] += t * y[t]; }
            b0 = inv[0][0] * xty[0] + inv[0][1] * xty[1];
            b1 = inv[1][0] * xty[0] + inv[1][1] * xty[1];
        }
        double[] fitted = new double[n];
        for (int t = 0; t < n; t++) fitted[t] = b0 + b1 * t;
        double[] fc = new double[h];
        for (int i = 0; i < h; i++) fc[i] = b0 + b1 * (n + i);
        return new double[][]{fitted, fc};
    };

    private static final Forecaster HOLT = (y, h) -> {
        int n = y.length;
        double[] grid = {0.1, 0.3, 0.5, 0.7, 0.9};
        double bestSse = Double.MAX_VALUE;
        double[] bestFitted = null, bestFc = null;
        for (double a : grid) {
            for (double b : grid) {
                double l = y[0], tr = y[1] - y[0], sse = 0;
                double[] fitted = new double[n];
                fitted[0] = y[0];
                for (int t = 1; t < n; t++) {
                    double f = l + tr;
                    fitted[t] = f;
                    sse += (y[t] - f) * (y[t] - f);
                    double nl = a * y[t] + (1 - a) * (l + tr);
                    tr = b * (nl - l) + (1 - b) * tr;
                    l = nl;
                }
                if (sse < bestSse) {
                    bestSse = sse; bestFitted = fitted;
                    bestFc = new double[h];
                    for (int i = 0; i < h; i++) bestFc[i] = l + (i + 1) * tr;
                }
            }
        }
        return new double[][]{bestFitted, bestFc};
    };

    private Map<String, Object> forecast(DataFrame df, Map<String, Object> p) {
        String measure = str(p, "measure"), period = str(p, "period");
        if (measure == null) throw new IllegalArgumentException("Elige la medida a pronosticar.");
        if (period == null) throw new IllegalArgumentException("Elige el campo de periodo (mes, fecha...).");
        int horizon = Math.max(1, Math.min(24, intp(p, "horizon", 3)));
        boolean avg = "avg".equals(str(p, "aggregation"));
        int mi = df.indexOf(measure), pi = df.indexOf(period);
        if (mi < 0 || pi < 0) throw new IllegalArgumentException("Campo no encontrado.");

        LinkedHashMap<String, double[]> g = new LinkedHashMap<>();
        for (List<String> row : df.rows()) {
            String key = row.get(pi) == null ? "" : row.get(pi).trim();
            Double v = parse(row.get(mi));
            if (key.isEmpty() || v == null) continue;
            double[] acc = g.computeIfAbsent(key, kk -> new double[2]);
            acc[0] += v; acc[1]++;
        }
        List<String> labels = new ArrayList<>(g.keySet());
        if ("date".equals(df.typeOf(period))) Collections.sort(labels);
        int n = labels.size();
        if (n < 3) throw new IllegalArgumentException("Se necesitan al menos 3 periodos distintos y hay " + n + ".");
        double[] y = new double[n];
        for (int i = 0; i < n; i++) { double[] acc = g.get(labels.get(i)); y[i] = avg ? acc[0] / acc[1] : acc[0]; }

        List<String> warnings = new ArrayList<>();
        if (n < 6) warnings.add("Solo hay " + n + " periodos: el pronóstico es orientativo. Con 12 o más periodos el resultado es mucho más fiable.");

        String[] names = {"Ingenuo (último valor)", "Tendencia lineal", "Suavizado de Holt"};
        Forecaster[] models = {NAIVE, TREND, HOLT};
        int m = n >= 8 ? Math.min(3, n / 4) : (n >= 5 ? 1 : 0);
        List<Map<String, Object>> comparison = new ArrayList<>();
        int bestIdx = 0; double bestRmse = Double.MAX_VALUE;
        for (int mIdx = 0; mIdx < models.length; mIdx++) {
            double sse = 0, sae = 0; int cnt = 0;
            String evalType;
            if (m > 0) {
                double[] trainY = Arrays.copyOfRange(y, 0, n - m);
                double[][] res = models[mIdx].fit(trainY, m);
                for (int i = 0; i < m; i++) { double e = y[n - m + i] - res[1][i]; sse += e * e; sae += Math.abs(e); cnt++; }
                evalType = "holdout";
            } else {
                double[][] res = models[mIdx].fit(y, 1);
                for (int t = 1; t < n; t++) { double e = y[t] - res[0][t]; sse += e * e; sae += Math.abs(e); cnt++; }
                evalType = "in-sample";
            }
            double rmse = Math.sqrt(sse / cnt);
            comparison.add(map("name", names[mIdx], "rmse", r(rmse), "mae", r(sae / cnt), "evaluation", evalType));
            if (rmse < bestRmse) { bestRmse = rmse; bestIdx = mIdx; }
        }

        double[][] fin = models[bestIdx].fit(y, horizon);
        double sse = 0;
        for (int t = 1; t < n; t++) sse += (y[t] - fin[0][t]) * (y[t] - fin[0][t]);
        double resSd = Math.sqrt(sse / Math.max(1, n - 1));

        List<Map<String, Object>> history = new ArrayList<>();
        for (int i = 0; i < n; i++) history.add(map("label", labels.get(i), "value", r(y[i]), "fitted", r(fin[0][i])));
        List<Map<String, Object>> fc = new ArrayList<>();
        for (int i = 0; i < horizon; i++) {
            double band = 1.96 * resSd * Math.sqrt(i + 1);
            fc.add(map("label", "Periodo +" + (i + 1), "value", r(fin[1][i]), "lower", r(fin[1][i] - band), "upper", r(fin[1][i] + band)));
        }

        double[][] tr = TREND.fit(y, 1);
        double slope = tr[0][n - 1] - tr[0][0];
        slope = n > 1 ? slope / (n - 1) : 0;
        double meanY = mean(y);

        List<String> insights = new ArrayList<>();
        insights.add("Mejor modelo: " + names[bestIdx] + (m > 0 ? " (validado con los últimos " + m + " periodos)." : " (evaluado sobre los mismos datos)."));
        double slopePct = meanY == 0 ? 0 : slope / Math.abs(meanY);
        insights.add("Tendencia: " + (Math.abs(slopePct) < 0.01 ? "estable" : slopePct > 0 ? "al alza" : "a la baja") + " (" + String.format(Locale.US, "%+.1f%%", slopePct * 100) + " por periodo).");
        insights.add("Próximo periodo estimado: " + fmt(fin[1][0]) + " (banda " + fmt(fin[1][0] - 1.96 * resSd) + " a " + fmt(fin[1][0] + 1.96 * resSd) + ").");

        return map("algorithm", "forecast", "n", n, "measure", measure, "period", period, "horizon", horizon,
                "best", names[bestIdx], "models", comparison, "history", history, "forecast", fc,
                "warnings", warnings, "insights", insights);
    }

    /* ===================================================================== */
    /* 4) CLASIFICACIÓN (REGRESIÓN LOGÍSTICA)                                 */
    /* ===================================================================== */

    private Map<String, Object> logistic(DataFrame df, Map<String, Object> p) {
        String target = str(p, "target");
        List<String> feats = new ArrayList<>(strList(p, "features"));
        feats.remove(target);
        if (target == null) throw new IllegalArgumentException("Elige la variable a clasificar (objetivo).");
        if (feats.isEmpty()) throw new IllegalArgumentException("Elige al menos una variable predictora.");
        int ti = df.indexOf(target);
        if (ti < 0) throw new IllegalArgumentException("Campo no encontrado: " + target);
        int k = feats.size();
        int[] fi = new int[k];
        for (int j = 0; j < k; j++) { fi[j] = df.indexOf(feats.get(j)); if (fi[j] < 0) throw new IllegalArgumentException("Campo no encontrado: " + feats.get(j)); }

        List<double[]> xs = new ArrayList<>();
        List<String> raw = new ArrayList<>();
        for (List<String> row : df.rows()) {
            double[] v = new double[k];
            boolean ok = true;
            for (int j = 0; j < k; j++) { Double d = parse(row.get(fi[j])); if (d == null) { ok = false; break; } v[j] = d; }
            String t = row.get(ti) == null ? "" : row.get(ti).trim();
            if (ok && !t.isEmpty()) { xs.add(v); raw.add(t); }
        }
        int n = xs.size();
        requireRows(n, 20);

        Set<String> distinct = new LinkedHashSet<>(raw);
        boolean numericTarget = distinct.size() > 2 && raw.stream().allMatch(s -> parse(s) != null);
        int[] y = new int[n];
        String posLabel, negLabel, rule;
        if (numericTarget) {
            double[] tv = raw.stream().mapToDouble(s -> parse(s)).toArray();
            double[] sorted = tv.clone();
            Arrays.sort(sorted);
            double thr = dbl(p, "threshold", Double.NaN);
            if (Double.isNaN(thr)) thr = quantile(sorted, 0.5);
            for (int i = 0; i < n; i++) y[i] = tv[i] >= thr ? 1 : 0;
            posLabel = target + " ≥ " + fmt(thr);
            negLabel = target + " < " + fmt(thr);
            rule = "Se separó " + target + " en dos grupos usando el umbral " + fmt(thr) + (Double.isNaN(dbl(p, "threshold", Double.NaN)) ? " (la mediana)." : ".");
        } else {
            if (distinct.size() < 2) throw new IllegalArgumentException("La variable objetivo solo tiene un valor distinto.");
            Map<String, Integer> freq = new LinkedHashMap<>();
            for (String s : raw) freq.merge(s, 1, Integer::sum);
            String positive = str(p, "positive");
            if (positive == null || !freq.containsKey(positive)) positive = Collections.min(freq.entrySet(), Map.Entry.comparingByValue()).getKey();
            for (int i = 0; i < n; i++) y[i] = raw.get(i).equals(positive) ? 1 : 0;
            posLabel = target + " = " + positive;
            negLabel = distinct.size() == 2 ? "Otro valor" : "Cualquier otro valor";
            rule = "Se predice si " + target + " es '" + positive + "' frente al resto.";
        }

        double testSize = Math.max(0, Math.min(0.5, dbl(p, "testSize", 0.25)));
        int nTest = n >= 20 ? (int) Math.round(n * testSize) : 0;
        int[] perm = shuffled(n);
        int[] test = Arrays.copyOfRange(perm, 0, nTest);
        int[] train = Arrays.copyOfRange(perm, nTest, n);

        double[] mu = new double[k], sg = new double[k];
        for (int j = 0; j < k; j++) {
            double[] col = new double[train.length];
            for (int i = 0; i < train.length; i++) col[i] = xs.get(train[i])[j];
            mu[j] = mean(col);
            sg[j] = sd(col) == 0 ? 1 : sd(col);
        }
        double[][] z = new double[n][k];
        for (int i = 0; i < n; i++) for (int j = 0; j < k; j++) z[i][j] = (xs.get(i)[j] - mu[j]) / sg[j];

        int pos = 0;
        for (int i : train) pos += y[i];
        if (pos == 0 || pos == train.length) throw new IllegalArgumentException("El conjunto de entrenamiento solo contiene una clase. Cambia el objetivo o el umbral.");

        double[] w = new double[k + 1];
        double lr = 0.3, lambda = 0.01;
        for (int it = 0; it < 3000; it++) {
            double[] grad = new double[k + 1];
            for (int i : train) {
                double zz = w[0];
                for (int j = 0; j < k; j++) zz += w[j + 1] * z[i][j];
                double err = sigmoid(zz) - y[i];
                grad[0] += err;
                for (int j = 0; j < k; j++) grad[j + 1] += err * z[i][j];
            }
            for (int j = 0; j <= k; j++) {
                double g = grad[j] / train.length + (j > 0 ? lambda * w[j] : 0);
                w[j] -= lr * g;
            }
        }

        int[] evalSet = nTest > 0 ? test : train;
        double[] prob = new double[evalSet.length];
        for (int a = 0; a < evalSet.length; a++) {
            int i = evalSet[a];
            double zz = w[0];
            for (int j = 0; j < k; j++) zz += w[j + 1] * z[i][j];
            prob[a] = sigmoid(zz);
        }
        int tp = 0, fp = 0, tn = 0, fn = 0;
        for (int a = 0; a < evalSet.length; a++) {
            int pred = prob[a] >= 0.5 ? 1 : 0, act = y[evalSet[a]];
            if (pred == 1 && act == 1) tp++; else if (pred == 1) fp++; else if (act == 1) fn++; else tn++;
        }
        int ne = evalSet.length;
        double acc = (tp + tn) / (double) ne;
        double prec = tp + fp == 0 ? 0 : tp / (double) (tp + fp);
        double rec = tp + fn == 0 ? 0 : tp / (double) (tp + fn);
        double f1 = prec + rec == 0 ? 0 : 2 * prec * rec / (prec + rec);
        int nPos = tp + fn, nNeg = tn + fp;
        double majority = Math.max(nPos, nNeg) / (double) ne;

        Double auc = null;
        List<Map<String, Object>> roc = new ArrayList<>();
        if (nPos > 0 && nNeg > 0) {
            double[] rk = ranks(prob);
            double sumPos = 0;
            for (int a = 0; a < ne; a++) if (y[evalSet[a]] == 1) sumPos += rk[a];
            auc = r((sumPos - nPos * (nPos + 1) / 2.0) / ((double) nPos * nNeg));
            Integer[] ord = new Integer[ne];
            for (int a = 0; a < ne; a++) ord[a] = a;
            Arrays.sort(ord, (u, v) -> Double.compare(prob[v], prob[u]));
            int ctp = 0, cfp = 0;
            roc.add(map("fpr", 0.0, "tpr", 0.0));
            for (int a = 0; a < ne; a++) {
                if (y[evalSet[ord[a]]] == 1) ctp++; else cfp++;
                if (a == ne - 1 || prob[ord[a]] != prob[ord[a + 1]])
                    roc.add(map("fpr", r(cfp / (double) nNeg), "tpr", r(ctp / (double) nPos)));
            }
        }

        List<Map<String, Object>> coefs = new ArrayList<>();
        for (int j = 0; j < k; j++)
            coefs.add(map("name", feats.get(j), "coef", r(w[j + 1]), "oddsRatio", r(Math.exp(w[j + 1]))));
        coefs.sort((a, b) -> Double.compare(Math.abs((Double) b.get("coef")), Math.abs((Double) a.get("coef"))));

        List<String> insights = new ArrayList<>();
        insights.add(rule);
        insights.add("Precisión global " + pct(acc) + " frente a " + pct(majority) + " de un modelo que siempre responde la clase mayoritaria" + (acc > majority + 0.02 ? " (aporta valor)." : " (aporta poco)."));
        if (auc != null) insights.add("AUC " + fmt(auc) + ": " + (auc >= 0.9 ? "excelente" : auc >= 0.8 ? "buena" : auc >= 0.7 ? "aceptable" : "débil") + " capacidad de separar las dos clases.");
        if (!coefs.isEmpty()) insights.add("Variable más influyente: " + coefs.get(0).get("name") + " (por cada desviación estándar, las probabilidades se multiplican por " + fmt((Double) coefs.get(0).get("oddsRatio")) + ").");
        if (nTest == 0) insights.add("Pocos datos: la evaluación usa las mismas filas del entrenamiento y puede ser optimista.");

        Map<String, Object> out = map("algorithm", "logistic", "n", n, "target", target, "features", feats,
                "positive", posLabel, "negative", negLabel, "evaluatedOn", nTest > 0 ? "prueba" : "entrenamiento",
                "metrics", map("accuracy", r(acc), "precision", r(prec), "recall", r(rec), "f1", r(f1), "auc", auc, "baseline", r(majority)),
                "confusion", map("tp", tp, "fp", fp, "tn", tn, "fn", fn), "roc", roc, "coefficients", coefs, "insights", insights);

        Map<String, Double> in = inputMap(p);
        if (in != null) {
            double zz = w[0];
            for (int j = 0; j < k; j++) {
                Double v = in.get(feats.get(j));
                if (v == null) throw new IllegalArgumentException("Falta el valor de '" + feats.get(j) + "' en el caso a probar.");
                zz += w[j + 1] * (v - mu[j]) / sg[j];
            }
            double pr = sigmoid(zz);
            out.put("prediction", map("probability", r(pr), "label", pr >= 0.5 ? posLabel : negLabel));
        }
        return out;
    }

    /* ===================================================================== */
    /* 5) ANOMALÍAS                                                           */
    /* ===================================================================== */

    private Map<String, Object> anomaly(DataFrame df, Map<String, Object> p) {
        List<String> feats = strList(p, "features");
        if (feats.isEmpty()) throw new IllegalArgumentException("Selecciona al menos una variable numérica.");
        Data d = extract(df, feats);
        int n = d.x().length, k = feats.size();
        requireRows(n, 8);
        String method = str(p, "method") == null ? "both" : str(p, "method");
        double thr = Math.max(1, dbl(p, "threshold", 2.5));

        double[] mean = new double[k], sdv = new double[k], low = new double[k], high = new double[k];
        List<Map<String, Object>> stats = new ArrayList<>();
        for (int j = 0; j < k; j++) {
            double[] col = column(d.x(), j);
            double[] s = col.clone();
            Arrays.sort(s);
            mean[j] = mean(col); sdv[j] = sd(col);
            double q1 = quantile(s, 0.25), q3 = quantile(s, 0.75), iqr = q3 - q1;
            low[j] = q1 - 1.5 * iqr; high[j] = q3 + 1.5 * iqr;
            stats.add(map("feature", feats.get(j), "mean", r(mean[j]), "sd", r(sdv[j]), "min", r(s[0]), "q1", r(q1),
                    "median", r(quantile(s, 0.5)), "q3", r(q3), "max", r(s[n - 1]), "lowFence", r(low[j]), "highFence", r(high[j])));
        }

        List<Map<String, Object>> found = new ArrayList<>();
        boolean[] isAnom = new boolean[n];
        for (int i = 0; i < n; i++) {
            List<Map<String, Object>> reasons = new ArrayList<>();
            double score = 0;
            for (int j = 0; j < k; j++) {
                double v = d.x()[i][j];
                double zv = sdv[j] == 0 ? 0 : (v - mean[j]) / sdv[j];
                boolean fz = Math.abs(zv) >= thr, fi = v < low[j] || v > high[j];
                boolean hit = switch (method) { case "zscore" -> fz; case "iqr" -> fi; default -> fz || fi; };
                if (hit) {
                    reasons.add(map("feature", feats.get(j), "value", r(v), "z", r(zv), "rule", fz && fi ? "z-score e IQR" : fz ? "z-score" : "IQR"));
                    score = Math.max(score, Math.abs(zv));
                }
            }
            if (!reasons.isEmpty()) {
                isAnom[i] = true;
                Map<String, Object> vals = new LinkedHashMap<>();
                for (int j = 0; j < k; j++) vals.put(feats.get(j), r(d.x()[i][j]));
                found.add(map("row", d.rowIdx()[i] + 1, "score", r(score), "values", vals, "reasons", reasons));
            }
        }
        found.sort((a, b) -> Double.compare((Double) b.get("score"), (Double) a.get("score")));
        int total = found.size();
        if (found.size() > 30) found = new ArrayList<>(found.subList(0, 30));

        // Histograma de la primera variable
        double[] c0 = column(d.x(), 0);
        double mn = Arrays.stream(c0).min().orElse(0), mx = Arrays.stream(c0).max().orElse(1);
        int bins = 15;
        double w = (mx - mn) / bins;
        List<Map<String, Object>> hist = new ArrayList<>();
        int[] cnt = new int[bins], cntA = new int[bins];
        for (int i = 0; i < n; i++) {
            int b = w == 0 ? 0 : Math.min(bins - 1, (int) ((c0[i] - mn) / w));
            cnt[b]++; if (isAnom[i]) cntA[b]++;
        }
        for (int b = 0; b < bins; b++) hist.add(map("from", r(mn + b * w), "to", r(mn + (b + 1) * w), "count", cnt[b], "anomalies", cntA[b]));

        List<Map<String, Object>> scatter = new ArrayList<>();
        for (int i : strideIndexes(n, 400)) {
            double x = k > 1 ? d.x()[i][1] : d.rowIdx()[i] + 1;
            scatter.add(map("x", r(k > 1 ? d.x()[i][0] : d.rowIdx()[i] + 1), "y", r(k > 1 ? x : d.x()[i][0]), "a", isAnom[i]));
        }

        List<String> insights = new ArrayList<>();
        insights.add(total + " registros atípicos de " + n + " (" + pct(total / (double) n) + ") con el criterio " + ("zscore".equals(method) ? "z-score ≥ " + fmt(thr) : "iqr".equals(method) ? "rango intercuartil (1.5×IQR)" : "z-score ≥ " + fmt(thr) + " o rango intercuartil") + ".");
        if (total > 0) insights.add("El más extremo es la fila " + found.get(0).get("row") + " con una desviación de " + fmt((Double) found.get(0).get("score")) + " σ.");
        else insights.add("No hay valores que se salgan del patrón normal con este umbral; prueba bajándolo.");
        if (total / (double) n > 0.15) insights.add("Más del 15% marcado como atípico: el umbral puede ser muy bajo o la distribución muy asimétrica.");

        return map("algorithm", "anomaly", "n", n, "features", feats, "method", method, "threshold", thr, "total", total,
                "stats", stats, "anomalies", found, "histogram", hist, "scatter", scatter, "insights", insights);
    }

    /* ===================================================================== */
    /* 6) CORRELACIONES                                                       */
    /* ===================================================================== */

    private static String strength(double r) {
        double a = Math.abs(r);
        return a >= 0.8 ? "Muy fuerte" : a >= 0.6 ? "Fuerte" : a >= 0.4 ? "Moderada" : a >= 0.2 ? "Débil" : "Nula";
    }

    private Map<String, Object> correlation(DataFrame df, Map<String, Object> p) {
        List<String> feats = strList(p, "features");
        if (feats.size() < 2) throw new IllegalArgumentException("Selecciona al menos 2 variables numéricas.");
        if (feats.size() > 15) feats = feats.subList(0, 15);
        Data d = extract(df, feats);
        int n = d.x().length, k = feats.size();
        requireRows(n, 5);
        double[][] cols = new double[k][];
        double[][] rk = new double[k][];
        for (int j = 0; j < k; j++) { cols[j] = column(d.x(), j); rk[j] = ranks(cols[j]); }
        double[][] pm = new double[k][k], sm = new double[k][k];
        List<Map<String, Object>> pairs = new ArrayList<>();
        int df2 = n - 2;
        double tc = tCritical(df2);
        for (int a = 0; a < k; a++) {
            for (int b = 0; b < k; b++) {
                pm[a][b] = a == b ? 1 : pearson(cols[a], cols[b]);
                sm[a][b] = a == b ? 1 : pearson(rk[a], rk[b]);
            }
            for (int b = a + 1; b < k; b++) {
                double rv = pm[a][b];
                double t = Math.abs(rv) >= 1 ? 99 : rv * Math.sqrt(df2 / (1 - rv * rv));
                pairs.add(map("a", feats.get(a), "b", feats.get(b), "r", r(rv), "r2", r(rv * rv), "spearman", r(sm[a][b]),
                        "strength", strength(rv), "direction", rv >= 0 ? "positiva" : "negativa", "significant", Math.abs(t) > tc));
            }
        }
        pairs.sort((x, y) -> Double.compare(Math.abs((Double) y.get("r")), Math.abs((Double) x.get("r"))));

        List<List<Double>> pMat = new ArrayList<>(), sMat = new ArrayList<>();
        for (int a = 0; a < k; a++) {
            List<Double> pr = new ArrayList<>(), sr = new ArrayList<>();
            for (int b = 0; b < k; b++) { pr.add(r(pm[a][b])); sr.add(r(sm[a][b])); }
            pMat.add(pr); sMat.add(sr);
        }
        List<String> insights = new ArrayList<>();
        if (!pairs.isEmpty()) {
            Map<String, Object> top = pairs.get(0);
            insights.add("Relación más fuerte: " + top.get("a") + " y " + top.get("b") + " (r = " + fmt((Double) top.get("r")) + ", " + String.valueOf(top.get("strength")).toLowerCase() + " " + top.get("direction") + ").");
            long strong = pairs.stream().filter(m -> Math.abs((Double) m.get("r")) >= 0.8).count();
            if (strong > 0) insights.add(strong + " par(es) con |r| ≥ 0.8: riesgo de redundancia o multicolinealidad si se usan juntos como predictores.");
        }
        insights.add("Correlación no implica causalidad: indica que las variables se mueven juntas, no que una cause la otra.");
        return map("algorithm", "correlation", "n", n, "features", feats, "pearson", pMat, "spearman", sMat, "pairs", pairs, "insights", insights);
    }

    /* ===================================================================== */
    /* 7) PCA                                                                 */
    /* ===================================================================== */

    private Map<String, Object> pca(DataFrame df, Map<String, Object> p) {
        List<String> feats = strList(p, "features");
        if (feats.size() < 2) throw new IllegalArgumentException("Selecciona al menos 2 variables numéricas.");
        Data d = extract(df, feats);
        int n = d.x().length, k = feats.size();
        requireRows(n, 8);
        double[] mu = new double[k], sg = new double[k];
        for (int j = 0; j < k; j++) { double[] c = column(d.x(), j); mu[j] = mean(c); sg[j] = sd(c) == 0 ? 1 : sd(c); }
        double[][] z = new double[n][k];
        for (int i = 0; i < n; i++) for (int j = 0; j < k; j++) z[i][j] = (d.x()[i][j] - mu[j]) / sg[j];
        double[][] cov = covariance(z);
        double[] ev = new double[k];
        double[][] vec = jacobiEigen(cov, ev);
        double tot = 0;
        for (double e : ev) tot += Math.max(e, 0);

        List<Map<String, Object>> comps = new ArrayList<>();
        double cum = 0; int n80 = k; boolean set = false;
        for (int c = 0; c < k; c++) {
            double share = tot == 0 ? 0 : Math.max(ev[c], 0) / tot;
            cum += share;
            if (!set && cum >= 0.8) { n80 = c + 1; set = true; }
            Map<String, Object> loadings = new LinkedHashMap<>();
            for (int j = 0; j < k; j++) loadings.put(feats.get(j), r(vec[j][c]));
            comps.add(map("name", "PC" + (c + 1), "eigenvalue", r(ev[c]), "explained", r(share), "cumulative", r(cum), "loadings", loadings));
        }
        List<Map<String, Object>> points = new ArrayList<>();
        for (int i : strideIndexes(n, 500)) {
            double px = 0, py = 0;
            for (int j = 0; j < k; j++) { px += z[i][j] * vec[j][0]; py += z[i][j] * vec[j][1]; }
            points.add(map("x", r(px), "y", r(py)));
        }
        List<String> insights = new ArrayList<>();
        insights.add(n80 + " de " + k + " componentes retienen al menos 80% de la información: se puede resumir el conjunto sin perder casi nada.");
        int top = 0;
        for (int j = 1; j < k; j++) if (Math.abs(vec[j][0]) > Math.abs(vec[top][0])) top = j;
        insights.add("PC1 (" + pct(tot == 0 ? 0 : ev[0] / tot) + ") está dominado por " + feats.get(top) + ".");
        return map("algorithm", "pca", "n", n, "features", feats, "components", comps, "components80", n80, "projection", points, "insights", insights);
    }
}
