package io.datasense.ml;

import io.datasense.engine.DataFrame;

import java.util.*;

import static io.datasense.ml.MlMath.*;
import static io.datasense.ml.MlService.*;

/** Clúster jerárquico, DBSCAN y reglas de asociación (Java puro). */
final class MlUnsupervised {

    private MlUnsupervised() {}

    static Map<String, Object> run(DataFrame df, String algorithm, Map<String, Object> p) {
        return switch (algorithm) {
            case "hierarchical" -> hierarchical(df, p);
            case "dbscan" -> dbscan(df, p);
            case "rules" -> rules(df, p);
            default -> throw new IllegalArgumentException("Algoritmo no soportado: " + algorithm);
        };
    }

    private record Std(List<String> feats, double[][] raw, double[][] z, double[] mu, double[] sd, int[] rowIdx, boolean sampled, int complete) {}

    private static Std standardized(DataFrame df, Map<String, Object> p, int min, int cap) {
        List<String> feats = strList(p, "features");
        if (feats.size() < 2) throw new IllegalArgumentException("Selecciona al menos 2 variables numéricas.");
        Data d = extract(df, feats);
        double[][] x = d.x();
        int[] ri = d.rowIdx();
        boolean sampled = d.sampled();
        if (x.length > cap) {
            sampled = true;
            List<Integer> keep = strideIndexes(x.length, cap);
            double[][] x2 = new double[keep.size()][];
            int[] r2 = new int[keep.size()];
            for (int i = 0; i < keep.size(); i++) { x2[i] = x[keep.get(i)]; r2[i] = ri[keep.get(i)]; }
            x = x2; ri = r2;
        }
        requireRows(x.length, min);
        int k = feats.size();
        double[] mu = new double[k], sg = new double[k];
        for (int j = 0; j < k; j++) { double[] c = column(x, j); mu[j] = mean(c); double s = sd(c); sg[j] = s == 0 ? 1 : s; }
        double[][] z = new double[x.length][k];
        for (int i = 0; i < x.length; i++) for (int j = 0; j < k; j++) z[i][j] = (x[i][j] - mu[j]) / sg[j];
        return new Std(feats, x, z, mu, sg, ri, sampled, d.complete());
    }

    private static double dist(double[] a, double[] b) {
        double s = 0;
        for (int i = 0; i < a.length; i++) { double d = a[i] - b[i]; s += d * d; }
        return Math.sqrt(s);
    }

    private static List<Map<String, Object>> projection(double[][] z, int[] labels, int cap) {
        double[][] cov = new double[z[0].length][z[0].length];
        int n = z.length, k = z[0].length;
        for (double[] row : z) for (int a = 0; a < k; a++) for (int b = a; b < k; b++) cov[a][b] += row[a] * row[b];
        for (int a = 0; a < k; a++) for (int b = a; b < k; b++) { cov[a][b] /= Math.max(1, n - 1); cov[b][a] = cov[a][b]; }
        double[] ev = new double[k];
        double[][] v = jacobiEigen(cov, ev);
        List<Map<String, Object>> pts = new ArrayList<>();
        for (int i : strideIndexes(n, cap)) {
            double px = 0, py = 0;
            for (int j = 0; j < k; j++) { px += z[i][j] * v[j][0]; py += z[i][j] * (k > 1 ? v[j][1] : 0); }
            pts.add(map("x", r(px), "y", r(py), "c", labels[i]));
        }
        return pts;
    }

    private static List<Map<String, Object>> profiles(Std s, int[] labels, int nClusters, boolean noise) {
        int k = s.feats().size(), n = s.raw().length;
        List<Map<String, Object>> out = new ArrayList<>();
        for (int c = noise ? 0 : 1; c <= nClusters; c++) {
            double[] sum = new double[k];
            int cnt = 0;
            for (int i = 0; i < n; i++) if (labels[i] == c) { cnt++; for (int j = 0; j < k; j++) sum[j] += s.raw()[i][j]; }
            if (cnt == 0) continue;
            Map<String, Object> centroid = new LinkedHashMap<>(), profile = new LinkedHashMap<>();
            double maxAbs = 0, maxZ = 0; int maxJ = 0;
            for (int j = 0; j < k; j++) {
                double cm = sum[j] / cnt, zp = (cm - s.mu()[j]) / s.sd()[j];
                centroid.put(s.feats().get(j), r(cm)); profile.put(s.feats().get(j), r(zp));
                if (Math.abs(zp) > maxAbs) { maxAbs = Math.abs(zp); maxJ = j; maxZ = zp; }
            }
            String name = c == 0 ? "Ruido (sin grupo)" : "Grupo " + (char) ('A' + c - 1) + " · " + (maxAbs < 0.35 ? "Perfil medio" : (maxZ > 0 ? "Alto en " : "Bajo en ") + s.feats().get(maxJ));
            out.add(map("id", c, "name", name, "size", cnt, "share", r(cnt / (double) n), "centroid", centroid, "profile", profile, "noise", c == 0));
        }
        return out;
    }

    /* ===================== Jerárquico (Ward) ===================== */

    private static Map<String, Object> hierarchical(DataFrame df, Map<String, Object> p) {
        Std s = standardized(df, p, 6, 600);
        double[][] z = s.z();
        int n = z.length, k = z[0].length;
        String linkage = str(p, "linkage") == null ? "ward" : str(p, "linkage");

        // Distancias iniciales y fusión aglomerativa (Lance-Williams).
        double[][] d = new double[n][n];
        for (int i = 0; i < n; i++) for (int j = i + 1; j < n; j++) {
            double v = dist(z[i], z[j]);
            d[i][j] = d[j][i] = linkage.equals("ward") ? v * v : v;
        }
        boolean[] active = new boolean[n];
        Arrays.fill(active, true);
        int[] size = new int[n];
        Arrays.fill(size, 1);
        int[] parent = new int[n];
        for (int i = 0; i < n; i++) parent[i] = i;
        List<double[]> merges = new ArrayList<>(); // {a, b, height}
        int[] nnIdx = new int[n];
        double[] nnD = new double[n];
        for (int i = 0; i < n; i++) refreshNN(i, d, active, nnIdx, nnD);
        for (int step = 0; step < n - 1; step++) {
            int a = -1; double best = Double.MAX_VALUE;
            for (int i = 0; i < n; i++) if (active[i] && nnIdx[i] >= 0 && nnD[i] < best) { best = nnD[i]; a = i; }
            if (a < 0) break;
            int b = nnIdx[a];
            merges.add(new double[]{a, b, linkage.equals("ward") ? Math.sqrt(Math.max(0, best)) : best});
            for (int m = 0; m < n; m++) {
                if (!active[m] || m == a || m == b) continue;
                double nv;
                switch (linkage) {
                    case "single" -> nv = Math.min(d[a][m], d[b][m]);
                    case "complete" -> nv = Math.max(d[a][m], d[b][m]);
                    case "average" -> nv = (size[a] * d[a][m] + size[b] * d[b][m]) / (size[a] + size[b]);
                    default -> {
                        int sa = size[a], sb = size[b], sm = size[m], tot = sa + sb + sm;
                        nv = ((sa + sm) * d[a][m] + (sb + sm) * d[b][m] - sm * d[a][b]) / tot;
                    }
                }
                d[a][m] = d[m][a] = nv;
            }
            active[b] = false;
            size[a] += size[b];
            for (int i = 0; i < n; i++) if (parent[i] == b) parent[i] = a;
            for (int i = 0; i < n; i++) if (active[i] && (i == a || nnIdx[i] == a || nnIdx[i] == b)) refreshNN(i, d, active, nnIdx, nnD);
        }

        // Elegir número de grupos: pedido, o mayor salto de altura entre 2 y 8.
        int req = intp(p, "k", 0);
        int kSel;
        int mCount = merges.size();
        if (req >= 2) kSel = Math.min(req, Math.max(2, n - 1));
        else {
            double bestJump = -1; kSel = 2;
            for (int kk = 2; kk <= Math.min(8, n - 1); kk++) {
                int iTop = mCount - kk + 1, iBelow = mCount - kk;
                if (iBelow < 0) break;
                double jump = merges.get(iTop)[2] - merges.get(iBelow)[2];
                if (jump > bestJump) { bestJump = jump; kSel = kk; }
            }
        }
        // Reproducir fusiones hasta dejar kSel grupos.
        int[] lab = new int[n];
        for (int i = 0; i < n; i++) lab[i] = i;
        for (int m = 0; m < n - kSel; m++) {
            int a = (int) merges.get(m)[0], b = (int) merges.get(m)[1];
            for (int i = 0; i < n; i++) if (lab[i] == b) lab[i] = a;
        }
        Map<Integer, Integer> remap = new LinkedHashMap<>();
        Map<Integer, Integer> counts = new HashMap<>();
        for (int v : lab) counts.merge(v, 1, Integer::sum);
        List<Integer> roots = new ArrayList<>(counts.keySet());
        roots.sort((x, y) -> Integer.compare(counts.get(y), counts.get(x)));
        for (int i = 0; i < roots.size(); i++) remap.put(roots.get(i), i + 1);
        int[] labels = new int[n];
        for (int i = 0; i < n; i++) labels[i] = remap.get(lab[i]);

        double sil = MlService.silhouette(z, Arrays.stream(labels).map(v -> v - 1).toArray(), kSel);
        List<Map<String, Object>> heights = new ArrayList<>();
        for (int kk = 1; kk <= Math.min(12, n - 1); kk++) heights.add(map("k", kk, "height", r(merges.get(mCount - kk)[2])));

        List<String> ins = new ArrayList<>();
        ins.add(kSel + " grupos" + (req >= 2 ? " (elegidos por ti)" : " (corte en el mayor salto del dendrograma)") + " con enlace " + linkageName(linkage) + ".");
        ins.add("Silueta " + fmt(sil) + ": " + (sil >= 0.5 ? "grupos bien separados." : sil >= 0.25 ? "estructura razonable con algo de solapamiento." : "estructura débil con estas variables."));
        ins.add("A diferencia de K-Means, no se fija k de antemano: el dendrograma muestra cómo se van uniendo los grupos.");
        if (s.sampled()) ins.add("Se usó una muestra de " + n + " filas de " + s.complete() + " (el método es cuadrático en memoria).");
        return map("algorithm", "hierarchical", "n", n, "features", s.feats(), "linkage", linkage, "k", kSel,
                "silhouette", r(sil), "heights", heights, "clusters", profiles(s, labels, kSel, false),
                "projection", projection(z, labels, 500), "sample", sampleRows(s, labels, 12), "insights", ins);
    }

    private static void refreshNN(int i, double[][] d, boolean[] active, int[] nnIdx, double[] nnD) {
        int bi = -1; double bd = Double.MAX_VALUE;
        for (int j = 0; j < d.length; j++) if (j != i && active[j] && d[i][j] < bd) { bd = d[i][j]; bi = j; }
        nnIdx[i] = bi; nnD[i] = bd;
    }

    private static String linkageName(String l) {
        return switch (l) { case "single" -> "simple"; case "complete" -> "completo"; case "average" -> "promedio"; default -> "Ward"; };
    }

    private static List<Map<String, Object>> sampleRows(Std s, int[] labels, int cap) {
        List<Map<String, Object>> out = new ArrayList<>();
        for (int i = 0; i < Math.min(cap, labels.length); i++) {
            Map<String, Object> vals = new LinkedHashMap<>();
            for (int j = 0; j < s.feats().size(); j++) vals.put(s.feats().get(j), r(s.raw()[i][j]));
            out.add(map("row", s.rowIdx()[i] + 1, "values", vals, "cluster", labels[i]));
        }
        return out;
    }

    /* ===================== DBSCAN ===================== */

    private static Map<String, Object> dbscan(DataFrame df, Map<String, Object> p) {
        Std s = standardized(df, p, 8, 3000);
        double[][] z = s.z();
        int n = z.length;
        int minPts = Math.max(2, Math.min(50, intp(p, "minPts", Math.max(3, Math.min(10, n / 10)))));
        // k-distancias para sugerir eps
        double[] kd = new double[n];
        for (int i = 0; i < n; i++) {
            double[] ds = new double[n];
            for (int j = 0; j < n; j++) ds[j] = j == i ? Double.MAX_VALUE : dist(z[i], z[j]);
            Arrays.sort(ds);
            kd[i] = ds[Math.min(minPts - 1, n - 2)];
        }
        double[] sortedKd = kd.clone();
        Arrays.sort(sortedKd);
        double epsAuto = quantile(sortedKd, 0.9);
        double eps = dbl(p, "eps", 0);
        boolean auto = eps <= 0;
        if (auto) eps = epsAuto;

        int[] lab = new int[n];
        Arrays.fill(lab, -1);
        int c = 0;
        for (int i = 0; i < n; i++) {
            if (lab[i] != -1) continue;
            List<Integer> nb = neighbours(z, i, eps);
            if (nb.size() < minPts) { lab[i] = 0; continue; }
            c++;
            lab[i] = c;
            Deque<Integer> q = new ArrayDeque<>(nb);
            while (!q.isEmpty()) {
                int j = q.poll();
                if (lab[j] == 0) lab[j] = c;
                if (lab[j] != -1) continue;
                lab[j] = c;
                List<Integer> nb2 = neighbours(z, j, eps);
                if (nb2.size() >= minPts) q.addAll(nb2);
            }
        }
        int noise = 0;
        for (int v : lab) if (v == 0) noise++;

        List<Map<String, Object>> kdist = new ArrayList<>();
        double[] desc = sortedKd.clone();
        for (int i : strideIndexes(n, 120)) kdist.add(map("i", i + 1, "d", r(desc[n - 1 - i])));

        List<String> ins = new ArrayList<>();
        ins.add(c + " grupo(s) por densidad y " + noise + " punto(s) de ruido (" + pct(noise / (double) n) + ").");
        ins.add("Radio eps " + fmt(eps) + (auto ? " (sugerido: percentil 90 de la distancia al " + minPts + "º vecino)" : "") + " · mínimo " + minPts + " vecinos por núcleo.");
        ins.add(c == 0 ? "Ningún grupo denso: aumenta eps o baja el mínimo de vecinos." : c == 1 ? "Un único grupo denso: los datos son homogéneos o eps es grande; prueba reducirlo." : "DBSCAN detecta grupos de cualquier forma y separa el ruido, útil cuando K-Means fuerza grupos artificiales.");
        if (s.sampled()) ins.add("Se usó una muestra de " + n + " filas de " + s.complete() + ".");
        return map("algorithm", "dbscan", "n", n, "features", s.feats(), "eps", r(eps), "minPts", minPts, "clustersFound", c,
                "noise", noise, "kdistance", kdist, "clusters", profiles(s, lab, c, true),
                "projection", projection(z, lab, 500), "sample", sampleRows(s, lab, 12), "insights", ins);
    }

    private static List<Integer> neighbours(double[][] z, int i, double eps) {
        List<Integer> out = new ArrayList<>();
        for (int j = 0; j < z.length; j++) if (dist(z[i], z[j]) <= eps) out.add(j);
        return out;
    }

    /* ===================== Reglas de asociación (Apriori) ===================== */

    private static Map<String, Object> rules(DataFrame df, Map<String, Object> p) {
        List<String> feats = strList(p, "features");
        if (feats.size() < 2) throw new IllegalArgumentException("Selecciona al menos 2 variables categóricas.");
        double minSup = Math.max(0.01, Math.min(0.9, dbl(p, "minSupport", 0.1)));
        double minConf = Math.max(0.05, Math.min(1, dbl(p, "minConfidence", 0.5)));
        int[] ci = new int[feats.size()];
        for (int j = 0; j < ci.length; j++) { ci[j] = df.indexOf(feats.get(j)); if (ci[j] < 0) throw new IllegalArgumentException("Campo no encontrado: " + feats.get(j)); }

        List<Set<String>> tx = new ArrayList<>();
        for (List<String> row : df.rows()) {
            Set<String> items = new TreeSet<>();
            for (int j = 0; j < ci.length; j++) {
                String v = row.get(ci[j]);
                if (v != null && !v.isBlank()) items.add(feats.get(j) + " = " + v.trim());
            }
            if (items.size() >= 2) tx.add(items);
        }
        int n = tx.size();
        requireRows(n, 10);
        Map<Set<String>, Integer> freq = new HashMap<>();
        Map<String, Integer> c1 = new HashMap<>();
        for (Set<String> t : tx) for (String it : t) c1.merge(it, 1, Integer::sum);
        List<Set<String>> level = new ArrayList<>();
        for (Map.Entry<String, Integer> e : c1.entrySet()) if (e.getValue() / (double) n >= minSup) { Set<String> s = new TreeSet<>(Set.of(e.getKey())); level.add(s); freq.put(s, e.getValue()); }
        int maxLen = Math.min(3, feats.size());
        for (int len = 2; len <= maxLen && !level.isEmpty(); len++) {
            Set<Set<String>> cand = new HashSet<>();
            for (int a = 0; a < level.size(); a++) for (int b = a + 1; b < level.size(); b++) {
                Set<String> u = new TreeSet<>(level.get(a)); u.addAll(level.get(b));
                if (u.size() == len && sameFieldOnce(u)) cand.add(u);
            }
            List<Set<String>> next = new ArrayList<>();
            for (Set<String> cset : cand) {
                int cnt = 0;
                for (Set<String> t : tx) if (t.containsAll(cset)) cnt++;
                if (cnt / (double) n >= minSup) { next.add(cset); freq.put(cset, cnt); }
            }
            level = next;
        }
        List<Map<String, Object>> rules = new ArrayList<>();
        for (Map.Entry<Set<String>, Integer> e : freq.entrySet()) {
            Set<String> items = e.getKey();
            if (items.size() < 2) continue;
            List<String> list = new ArrayList<>(items);
            int m = list.size();
            for (int mask = 1; mask < (1 << m) - 1; mask++) {
                Set<String> lhs = new TreeSet<>(), rhs = new TreeSet<>();
                for (int b = 0; b < m; b++) ((mask & (1 << b)) != 0 ? lhs : rhs).add(list.get(b));
                if (rhs.size() != 1) continue;
                Integer cl = freq.get(lhs), cr = freq.get(rhs);
                if (cl == null || cr == null) continue;
                double sup = e.getValue() / (double) n, conf = e.getValue() / (double) cl, lift = conf / (cr / (double) n);
                if (conf >= minConf) rules.add(map("if", new ArrayList<>(lhs), "then", new ArrayList<>(rhs), "support", r(sup), "confidence", r(conf), "lift", r(lift), "count", e.getValue()));
            }
        }
        rules.sort((a, b) -> {
            int c = Double.compare((Double) b.get("lift"), (Double) a.get("lift"));
            return c != 0 ? c : Double.compare((Double) b.get("confidence"), (Double) a.get("confidence"));
        });
        int total = rules.size();
        if (rules.size() > 60) rules = new ArrayList<>(rules.subList(0, 60));
        List<Map<String, Object>> items = new ArrayList<>();
        c1.entrySet().stream().sorted((a, b) -> b.getValue() - a.getValue()).limit(15)
                .forEach(e -> items.add(map("item", e.getKey(), "support", r(e.getValue() / (double) n), "count", e.getValue())));

        List<String> ins = new ArrayList<>();
        ins.add(total + " regla(s) con soporte ≥ " + pct(minSup) + " y confianza ≥ " + pct(minConf) + " sobre " + n + " registros.");
        if (!rules.isEmpty()) {
            Map<String, Object> t = rules.get(0);
            ins.add("Regla más fuerte: si " + String.join(" y ", castList(t.get("if"))) + " entonces " + castList(t.get("then")).get(0) + " (confianza " + pct((Double) t.get("confidence")) + ", lift " + fmt((Double) t.get("lift")) + ").");
            ins.add("Lift > 1 indica que la combinación ocurre más de lo esperado por azar; < 1, menos.");
        } else ins.add("Sin reglas con estos umbrales: baja el soporte o la confianza mínimos.");
        return map("algorithm", "rules", "n", n, "features", feats, "minSupport", minSup, "minConfidence", minConf,
                "total", total, "rules", rules, "items", items, "insights", ins);
    }

    @SuppressWarnings("unchecked")
    private static List<String> castList(Object o) { return (List<String>) o; }

    private static boolean sameFieldOnce(Set<String> items) {
        Set<String> fields = new HashSet<>();
        for (String it : items) if (!fields.add(it.substring(0, it.indexOf(" = ")))) return false;
        return true;
    }
}
