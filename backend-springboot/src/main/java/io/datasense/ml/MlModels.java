package io.datasense.ml;

import java.util.*;

import static io.datasense.ml.MlMath.*;

/**
 * Modelos supervisados del laboratorio (Java puro). Todos exponen {@link Predictor}:
 * en regresión devuelven el valor estimado; en clasificación binaria devuelven la
 * probabilidad de la clase positiva.
 */
final class MlModels {

    private MlModels() {}

    interface Predictor { double predict(double[] x); }

    /* ===================== Estandarizador ===================== */
    static final class Scaler {
        final double[] mu, sg;
        Scaler(double[] mu, double[] sg) { this.mu = mu; this.sg = sg; }
        static Scaler fit(double[][] x) {
            int k = x[0].length;
            double[] mu = new double[k], sg = new double[k];
            for (int j = 0; j < k; j++) {
                double[] c = column(x, j);
                mu[j] = mean(c);
                double s = sd(c);
                sg[j] = s == 0 ? 1 : s;
            }
            return new Scaler(mu, sg);
        }
        double[] apply(double[] v) {
            double[] o = new double[v.length];
            for (int j = 0; j < v.length; j++) o[j] = (v[j] - mu[j]) / sg[j];
            return o;
        }
    }

    /* ===================== Modelos lineales (Ridge / Lasso / Poly) ===================== */
    static final class LinModel implements Predictor {
        final Scaler sc;
        final double[] beta;   // sobre variables estandarizadas
        final double ym;
        final Expander expander; // null si no hay expansión polinómica
        LinModel(Scaler sc, double[] beta, double ym, Expander ex) { this.sc = sc; this.beta = beta; this.ym = ym; this.expander = ex; }

        public double predict(double[] x) {
            double[] v = expander == null ? x : expander.expand(x);
            double s = ym;
            for (int j = 0; j < beta.length; j++) s += beta[j] * (v[j] - sc.mu[j]) / sc.sg[j];
            return s;
        }
        /** Coeficientes en unidades originales: [intercepto, b1, ...]. */
        double[] rawCoefficients() {
            double[] out = new double[beta.length + 1];
            double ic = ym;
            for (int j = 0; j < beta.length; j++) {
                out[j + 1] = beta[j] / sc.sg[j];
                ic -= out[j + 1] * sc.mu[j];
            }
            out[0] = ic;
            return out;
        }
        List<String> names(List<String> base) { return expander == null ? base : expander.names(base); }
    }

    static final class Expander {
        final int degree, k;
        Expander(int degree, int k) { this.degree = degree; this.k = k; }
        double[] expand(double[] x) {
            List<Double> o = new ArrayList<>();
            for (int d = 1; d <= degree; d++) for (int j = 0; j < k; j++) o.add(Math.pow(x[j], d));
            if (degree >= 2 && k <= 8) for (int i = 0; i < k; i++) for (int j = i + 1; j < k; j++) o.add(x[i] * x[j]);
            double[] r = new double[o.size()];
            for (int i = 0; i < r.length; i++) r[i] = o.get(i);
            return r;
        }
        List<String> names(List<String> base) {
            List<String> o = new ArrayList<>();
            for (int d = 1; d <= degree; d++) for (int j = 0; j < k; j++) o.add(d == 1 ? base.get(j) : base.get(j) + "^" + d);
            if (degree >= 2 && k <= 8) for (int i = 0; i < k; i++) for (int j = i + 1; j < k; j++) o.add(base.get(i) + "·" + base.get(j));
            return o;
        }
    }

    static LinModel ridge(double[][] x, double[] y, double lambda) { return fitLinear(x, y, lambda, false, null); }
    static LinModel lasso(double[][] x, double[] y, double lambda) { return fitLinear(x, y, lambda, true, null); }
    static LinModel poly(double[][] x, double[] y, int degree, double lambda) {
        Expander ex = new Expander(Math.max(1, Math.min(4, degree)), x[0].length);
        double[][] xe = new double[x.length][];
        for (int i = 0; i < x.length; i++) xe[i] = ex.expand(x[i]);
        return fitLinear(xe, y, Math.max(lambda, 1e-3), false, ex);
    }

    private static LinModel fitLinear(double[][] x, double[] y, double lambda, boolean lasso, Expander ex) {
        int n = x.length, k = x[0].length;
        Scaler sc = Scaler.fit(x);
        double[][] z = new double[n][];
        for (int i = 0; i < n; i++) z[i] = sc.apply(x[i]);
        double ym = mean(y);
        double[] yc = new double[n];
        for (int i = 0; i < n; i++) yc[i] = y[i] - ym;
        double[] beta = new double[k];
        if (!lasso) {
            double[][] a = new double[k][k];
            double[] b = new double[k];
            for (int i = 0; i < n; i++)
                for (int p = 0; p < k; p++) {
                    b[p] += z[i][p] * yc[i];
                    for (int q = p; q < k; q++) a[p][q] += z[i][p] * z[i][q];
                }
            for (int p = 0; p < k; p++) for (int q = 0; q < p; q++) a[p][q] = a[q][p];
            for (int p = 0; p < k; p++) a[p][p] += lambda + 1e-9;
            double[][] inv = inverse(a);
            if (inv != null) for (int p = 0; p < k; p++) { double s = 0; for (int q = 0; q < k; q++) s += inv[p][q] * b[q]; beta[p] = s; }
        } else {
            double[] resid = yc.clone();
            double[] colSq = new double[k];
            for (int j = 0; j < k; j++) { double s = 0; for (int i = 0; i < n; i++) s += z[i][j] * z[i][j]; colSq[j] = s / n; }
            for (int it = 0; it < 2000; it++) {
                double maxD = 0;
                for (int j = 0; j < k; j++) {
                    double rho = 0;
                    for (int i = 0; i < n; i++) rho += z[i][j] * (resid[i] + z[i][j] * beta[j]);
                    rho /= n;
                    double nb = Math.abs(rho) <= lambda ? 0 : (rho - Math.signum(rho) * lambda) / (colSq[j] == 0 ? 1 : colSq[j]);
                    double d = nb - beta[j];
                    if (d != 0) { for (int i = 0; i < n; i++) resid[i] -= d * z[i][j]; beta[j] = nb; }
                    maxD = Math.max(maxD, Math.abs(d));
                }
                if (maxD < 1e-8) break;
            }
        }
        return new LinModel(sc, beta, ym, ex);
    }

    /* ===================== Árbol CART ===================== */
    static final class Tree implements Predictor {
        int[] feat, left, right;
        double[] thr, val;
        int size;

        double predict(double[] x, boolean unused) { return val[leaf(x)]; }
        public double predict(double[] x) { return val[leaf(x)]; }
        int leaf(double[] x) {
            int nd = 0;
            while (feat[nd] >= 0) nd = x[feat[nd]] <= thr[nd] ? left[nd] : right[nd];
            return nd;
        }

        static Tree build(double[][] x, double[] y, int[] rows, int maxDepth, int minLeaf, int mtry, Random rnd) {
            int cap = Math.max(3, Math.min(2 * rows.length + 1, (1 << (Math.min(maxDepth, 12) + 1)) + 1));
            Tree t = new Tree();
            t.feat = new int[cap]; t.left = new int[cap]; t.right = new int[cap];
            t.thr = new double[cap]; t.val = new double[cap];
            int[] idx = rows.clone();
            t.grow(x, y, idx, 0, idx.length, 0, maxDepth, minLeaf, mtry, rnd);
            return t;
        }

        private int newNode() { return size++; }

        private int grow(double[][] x, double[] y, int[] idx, int lo, int hi, int depth, int maxDepth, int minLeaf, int mtry, Random rnd) {
            int me = newNode();
            int m = hi - lo;
            double sum = 0;
            for (int i = lo; i < hi; i++) sum += y[idx[i]];
            val[me] = sum / m;
            feat[me] = -1;
            if (depth >= maxDepth || m < 2 * minLeaf || size + 2 >= feat.length) return me;

            int k = x[0].length;
            int[] feats = new int[k];
            for (int j = 0; j < k; j++) feats[j] = j;
            for (int j = k - 1; j > 0; j--) { int r = rnd.nextInt(j + 1); int tmp = feats[j]; feats[j] = feats[r]; feats[r] = tmp; }
            int use = Math.max(1, Math.min(mtry, k));

            double bestGain = 1e-12; int bestF = -1; double bestThr = 0;
            double base = sum * sum / m;
            long[] keys = new long[m];
            for (int fi = 0; fi < use; fi++) {
                int f = feats[fi];
                for (int i = 0; i < m; i++) {
                    float v = (float) x[idx[lo + i]][f];
                    int b = Float.floatToIntBits(v);
                    b ^= (b >> 31) & 0x7fffffff;
                    keys[i] = ((long) b << 32) | (i & 0xffffffffL);
                }
                Arrays.sort(keys);
                double sl = 0;
                for (int i = 0; i < m - 1; i++) {
                    int li = (int) (keys[i] & 0xffffffffL);
                    sl += y[idx[lo + li]];
                    int nl = i + 1, nr = m - nl;
                    if (nl < minLeaf || nr < minLeaf) continue;
                    int ni = (int) (keys[i + 1] & 0xffffffffL);
                    double v1 = x[idx[lo + li]][f], v2 = x[idx[lo + ni]][f];
                    if (v1 == v2) continue;
                    double sr = sum - sl;
                    double gain = sl * sl / nl + sr * sr / nr - base;
                    if (gain > bestGain) { bestGain = gain; bestF = f; bestThr = (v1 + v2) / 2; }
                }
            }
            if (bestF < 0) return me;

            int i = lo, j = hi - 1;
            while (i <= j) {
                if (x[idx[i]][bestF] <= bestThr) i++;
                else { int tmp = idx[i]; idx[i] = idx[j]; idx[j] = tmp; j--; }
            }
            int mid = i;
            if (mid == lo || mid == hi) return me;
            feat[me] = bestF; thr[me] = bestThr;
            left[me] = grow(x, y, idx, lo, mid, depth + 1, maxDepth, minLeaf, mtry, rnd);
            right[me] = grow(x, y, idx, mid, hi, depth + 1, maxDepth, minLeaf, mtry, rnd);
            return me;
        }
    }

    static Tree tree(double[][] x, double[] y, int maxDepth, int minLeaf, long seed) {
        int[] rows = new int[x.length];
        for (int i = 0; i < rows.length; i++) rows[i] = i;
        return Tree.build(x, y, rows, maxDepth, minLeaf, x[0].length, new Random(seed));
    }

    /* ===================== Bosque aleatorio ===================== */
    static final class Forest implements Predictor {
        final List<Tree> trees = new ArrayList<>();
        public double predict(double[] x) {
            double s = 0;
            for (Tree t : trees) s += t.predict(x);
            return s / trees.size();
        }
    }

    static Forest forest(double[][] x, double[] y, boolean cls, int nTrees, int maxDepth, int minLeaf, long seed) {
        Forest f = new Forest();
        int n = x.length, k = x[0].length;
        // Igual que scikit-learn: regresión usa todas las variables por corte; clasificación √k.
        int mtry = cls ? Math.max(1, (int) Math.round(Math.sqrt(k))) : k;
        Random rnd = new Random(seed);
        for (int t = 0; t < nTrees; t++) {
            int[] boot = new int[n];
            for (int i = 0; i < n; i++) boot[i] = rnd.nextInt(n);
            f.trees.add(Tree.build(x, y, boot, maxDepth, minLeaf, mtry, rnd));
        }
        return f;
    }

    /* ===================== Gradient Boosting ===================== */
    static final class Gbm implements Predictor {
        double init, lr;
        boolean cls;
        final List<Tree> trees = new ArrayList<>();
        public double predict(double[] x) {
            double f = init;
            for (Tree t : trees) f += lr * t.predict(x);
            return cls ? sigmoid(f) : f;
        }
    }

    static Gbm gbm(double[][] x, double[] y, boolean cls, int rounds, double lr, int depth, long seed) {
        int n = x.length;
        Gbm g = new Gbm();
        g.cls = cls; g.lr = lr;
        double m = mean(y);
        g.init = cls ? Math.log(Math.max(1e-6, m) / Math.max(1e-6, 1 - m)) : m;
        double[] f = new double[n];
        Arrays.fill(f, g.init);
        Random rnd = new Random(seed);
        double[] res = new double[n];
        for (int r = 0; r < rounds; r++) {
            double[] pr = new double[n];
            for (int i = 0; i < n; i++) {
                pr[i] = cls ? sigmoid(f[i]) : 0;
                res[i] = cls ? y[i] - pr[i] : y[i] - f[i];
            }
            int take = (int) Math.max(20, n * 0.8);
            int[] rows = new int[Math.min(n, take)];
            for (int i = 0; i < rows.length; i++) rows[i] = rnd.nextInt(n);
            Tree t = Tree.build(x, res, rows, depth, 5, x[0].length, rnd);
            if (cls) {
                double[] num = new double[t.size], den = new double[t.size];
                for (int i = 0; i < n; i++) { int lf = t.leaf(x[i]); num[lf] += res[i]; den[lf] += pr[i] * (1 - pr[i]); }
                for (int nd = 0; nd < t.size; nd++) if (t.feat[nd] < 0) t.val[nd] = den[nd] < 1e-9 ? 0 : num[nd] / den[nd];
            }
            g.trees.add(t);
            for (int i = 0; i < n; i++) f[i] += lr * t.predict(x[i]);
        }
        return g;
    }

    /* ===================== KNN ===================== */
    static final class Knn implements Predictor {
        final Scaler sc; final double[][] z; final double[] y; final int k;
        Knn(Scaler sc, double[][] z, double[] y, int k) { this.sc = sc; this.z = z; this.y = y; this.k = k; }
        public double predict(double[] x) {
            double[] q = sc.apply(x);
            int n = z.length, kk = Math.min(k, n);
            double[] d = new double[n];
            Integer[] best = null;
            PriorityQueue<double[]> heap = new PriorityQueue<>((a, b) -> Double.compare(b[0], a[0]));
            for (int i = 0; i < n; i++) {
                double s = 0;
                for (int j = 0; j < q.length; j++) { double t = q[j] - z[i][j]; s += t * t; }
                if (heap.size() < kk) heap.add(new double[]{s, i});
                else if (s < heap.peek()[0]) { heap.poll(); heap.add(new double[]{s, i}); }
            }
            double sum = 0;
            for (double[] e : heap) sum += y[(int) e[1]];
            return sum / heap.size();
        }
    }

    static Knn knn(double[][] x, double[] y, int k) {
        Scaler sc = Scaler.fit(x);
        double[][] z = new double[x.length][];
        for (int i = 0; i < x.length; i++) z[i] = sc.apply(x[i]);
        return new Knn(sc, z, y, Math.max(1, k));
    }

    /* ===================== Naive Bayes gaussiano (binario) ===================== */
    static final class Bayes implements Predictor {
        double prior1; double[] m0, m1, v0, v1;
        public double predict(double[] x) {
            double l1 = Math.log(prior1), l0 = Math.log(1 - prior1);
            for (int j = 0; j < x.length; j++) {
                l1 += logPdf(x[j], m1[j], v1[j]);
                l0 += logPdf(x[j], m0[j], v0[j]);
            }
            return sigmoid(l1 - l0);
        }
        private static double logPdf(double x, double m, double v) { return -0.5 * Math.log(2 * Math.PI * v) - (x - m) * (x - m) / (2 * v); }
    }

    static Bayes bayes(double[][] x, double[] y) {
        int k = x[0].length;
        Bayes b = new Bayes();
        b.m0 = new double[k]; b.m1 = new double[k]; b.v0 = new double[k]; b.v1 = new double[k];
        int n0 = 0, n1 = 0;
        for (int i = 0; i < x.length; i++) { if (y[i] == 1) n1++; else n0++; }
        b.prior1 = Math.min(0.999, Math.max(0.001, n1 / (double) x.length));
        for (int j = 0; j < k; j++) {
            double s0 = 0, s1 = 0;
            for (int i = 0; i < x.length; i++) { if (y[i] == 1) s1 += x[i][j]; else s0 += x[i][j]; }
            b.m0[j] = n0 == 0 ? 0 : s0 / n0; b.m1[j] = n1 == 0 ? 0 : s1 / n1;
            double q0 = 0, q1 = 0;
            for (int i = 0; i < x.length; i++) {
                if (y[i] == 1) q1 += (x[i][j] - b.m1[j]) * (x[i][j] - b.m1[j]);
                else q0 += (x[i][j] - b.m0[j]) * (x[i][j] - b.m0[j]);
            }
            b.v0[j] = Math.max(1e-6, n0 > 1 ? q0 / (n0 - 1) : 1);
            b.v1[j] = Math.max(1e-6, n1 > 1 ? q1 / (n1 - 1) : 1);
        }
        return b;
    }

    /* ===================== Regresión logística ===================== */
    static final class Logit implements Predictor {
        final Scaler sc; final double[] w;
        Logit(Scaler sc, double[] w) { this.sc = sc; this.w = w; }
        public double predict(double[] x) {
            double[] z = sc.apply(x);
            double s = w[0];
            for (int j = 0; j < z.length; j++) s += w[j + 1] * z[j];
            return sigmoid(s);
        }
    }

    static Logit logit(double[][] x, double[] y, double lambda) {
        int n = x.length, k = x[0].length;
        Scaler sc = Scaler.fit(x);
        double[][] z = new double[n][];
        for (int i = 0; i < n; i++) z[i] = sc.apply(x[i]);
        double[] w = new double[k + 1];
        for (int it = 0; it < 2500; it++) {
            double[] g = new double[k + 1];
            for (int i = 0; i < n; i++) {
                double s = w[0];
                for (int j = 0; j < k; j++) s += w[j + 1] * z[i][j];
                double e = sigmoid(s) - y[i];
                g[0] += e;
                for (int j = 0; j < k; j++) g[j + 1] += e * z[i][j];
            }
            for (int j = 0; j <= k; j++) w[j] -= 0.3 * (g[j] / n + (j > 0 ? lambda * w[j] : 0));
        }
        return new Logit(sc, w);
    }
}
