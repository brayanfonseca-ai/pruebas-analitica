package io.datasense.ml;

import java.util.Arrays;

/** Utilidades numéricas del laboratorio de ML (álgebra lineal y estadística básica, sin dependencias). */
final class MlMath {

    private MlMath() {}

    /** Redondea a 6 decimales; devuelve null si no es finito (JSON seguro). */
    static Double r(double x) {
        if (Double.isNaN(x) || Double.isInfinite(x)) return null;
        return Math.round(x * 1e6) / 1e6;
    }

    static double mean(double[] v) {
        if (v.length == 0) return 0;
        double s = 0;
        for (double x : v) s += x;
        return s / v.length;
    }

    /** Desviación estándar muestral (n-1). */
    static double sd(double[] v) {
        if (v.length < 2) return 0;
        double m = mean(v), s = 0;
        for (double x : v) s += (x - m) * (x - m);
        return Math.sqrt(s / (v.length - 1));
    }

    static double[] column(double[][] x, int c) {
        double[] out = new double[x.length];
        for (int i = 0; i < x.length; i++) out[i] = x[i][c];
        return out;
    }

    static double pearson(double[] a, double[] b) {
        int n = a.length;
        if (n < 2) return 0;
        double ma = mean(a), mb = mean(b), sab = 0, saa = 0, sbb = 0;
        for (int i = 0; i < n; i++) {
            double da = a[i] - ma, db = b[i] - mb;
            sab += da * db; saa += da * da; sbb += db * db;
        }
        if (saa == 0 || sbb == 0) return 0;
        return sab / Math.sqrt(saa * sbb);
    }

    /** Rangos promedio (1-based) para empates. */
    static double[] ranks(double[] v) {
        int n = v.length;
        Integer[] idx = new Integer[n];
        for (int i = 0; i < n; i++) idx[i] = i;
        Arrays.sort(idx, (p, q) -> Double.compare(v[p], v[q]));
        double[] rk = new double[n];
        int i = 0;
        while (i < n) {
            int j = i;
            while (j + 1 < n && v[idx[j + 1]] == v[idx[i]]) j++;
            double avg = (i + j) / 2.0 + 1;
            for (int k = i; k <= j; k++) rk[idx[k]] = avg;
            i = j + 1;
        }
        return rk;
    }

    /** Cuantil con interpolación lineal sobre un arreglo ya ordenado. */
    static double quantile(double[] sorted, double q) {
        if (sorted.length == 0) return 0;
        double pos = q * (sorted.length - 1);
        int lo = (int) Math.floor(pos), hi = (int) Math.ceil(pos);
        return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
    }

    static double[][] transpose(double[][] a) {
        int m = a.length, n = a[0].length;
        double[][] t = new double[n][m];
        for (int i = 0; i < m; i++) for (int j = 0; j < n; j++) t[j][i] = a[i][j];
        return t;
    }

    static double[][] multiply(double[][] a, double[][] b) {
        int m = a.length, k = b.length, n = b[0].length;
        double[][] c = new double[m][n];
        for (int i = 0; i < m; i++)
            for (int p = 0; p < k; p++) {
                double v = a[i][p];
                if (v == 0) continue;
                for (int j = 0; j < n; j++) c[i][j] += v * b[p][j];
            }
        return c;
    }

    /** Inversa por Gauss-Jordan con pivoteo parcial; null si es singular. */
    static double[][] inverse(double[][] a) {
        int n = a.length;
        double[][] m = new double[n][2 * n];
        for (int i = 0; i < n; i++) {
            System.arraycopy(a[i], 0, m[i], 0, n);
            m[i][n + i] = 1;
        }
        for (int col = 0; col < n; col++) {
            int piv = col;
            for (int r = col + 1; r < n; r++) if (Math.abs(m[r][col]) > Math.abs(m[piv][col])) piv = r;
            if (Math.abs(m[piv][col]) < 1e-12) return null;
            double[] tmp = m[col]; m[col] = m[piv]; m[piv] = tmp;
            double d = m[col][col];
            for (int j = 0; j < 2 * n; j++) m[col][j] /= d;
            for (int r = 0; r < n; r++) {
                if (r == col) continue;
                double f = m[r][col];
                if (f == 0) continue;
                for (int j = 0; j < 2 * n; j++) m[r][j] -= f * m[col][j];
            }
        }
        double[][] inv = new double[n][n];
        for (int i = 0; i < n; i++) System.arraycopy(m[i], n, inv[i], 0, n);
        return inv;
    }

    /**
     * Autovalores/autovectores de una matriz simétrica (Jacobi). Devuelve los
     * autovectores por columnas y rellena {@code evals}. Ordenados de mayor a menor.
     */
    static double[][] jacobiEigen(double[][] sym, double[] evals) {
        int n = sym.length;
        double[][] a = new double[n][n];
        for (int i = 0; i < n; i++) a[i] = sym[i].clone();
        double[][] v = new double[n][n];
        for (int i = 0; i < n; i++) v[i][i] = 1;
        for (int sweep = 0; sweep < 100; sweep++) {
            double off = 0;
            for (int i = 0; i < n; i++) for (int j = i + 1; j < n; j++) off += a[i][j] * a[i][j];
            if (off < 1e-20) break;
            for (int p = 0; p < n; p++) {
                for (int q = p + 1; q < n; q++) {
                    if (Math.abs(a[p][q]) < 1e-15) continue;
                    double theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
                    double t = theta == 0 ? 1 : Math.signum(theta) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
                    double c = 1 / Math.sqrt(t * t + 1), s = t * c;
                    for (int k = 0; k < n; k++) {
                        double akp = a[k][p], akq = a[k][q];
                        a[k][p] = c * akp - s * akq;
                        a[k][q] = s * akp + c * akq;
                    }
                    for (int k = 0; k < n; k++) {
                        double apk = a[p][k], aqk = a[q][k];
                        a[p][k] = c * apk - s * aqk;
                        a[q][k] = s * apk + c * aqk;
                    }
                    for (int k = 0; k < n; k++) {
                        double vkp = v[k][p], vkq = v[k][q];
                        v[k][p] = c * vkp - s * vkq;
                        v[k][q] = s * vkp + c * vkq;
                    }
                }
            }
        }
        Integer[] order = new Integer[n];
        for (int i = 0; i < n; i++) order[i] = i;
        final double[][] fa = a;
        Arrays.sort(order, (x, y) -> Double.compare(fa[y][y], fa[x][x]));
        double[][] sorted = new double[n][n];
        for (int c = 0; c < n; c++) {
            evals[c] = a[order[c]][order[c]];
            for (int r = 0; r < n; r++) sorted[r][c] = v[r][order[c]];
        }
        return sorted;
    }

    static double sigmoid(double z) {
        if (z >= 0) { double e = Math.exp(-z); return 1 / (1 + e); }
        double e = Math.exp(z);
        return e / (1 + e);
    }

    /** Aproximación del cuantil 97.5% de la t de Student. */
    static double tCritical(int df) {
        if (df <= 0) return 12.7;
        return 1.96 + 2.4 / df + 1.5 / ((double) df * df);
    }
}
