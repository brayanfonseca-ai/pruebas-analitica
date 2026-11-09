package io.datasense.ml;

import io.datasense.engine.DataFrame;
import io.datasense.ml.MlModels.Predictor;

import java.util.*;

import static io.datasense.ml.MlMath.*;
import static io.datasense.ml.MlService.*;

/**
 * Motor supervisado genérico (regresión y clasificación binaria) + AutoML.
 * Todos los modelos se evalúan con la misma partición entrenamiento/prueba y
 * reportan importancia de variables por permutación.
 */
final class MlSupervised {

    private MlSupervised() {}

    private static final int HEAVY_CAP = 4000;

    record Prep(boolean cls, String target, List<String> feats, double[][] x, double[] y,
                int[] train, int[] test, String pos, String neg, String rule, boolean sampled, int complete) {}

    static String modelName(String algo) {
        return switch (algo) {
            case "ols" -> "Regresión lineal";
            case "ridge" -> "Ridge (L2)";
            case "lasso" -> "Lasso (L1)";
            case "poly" -> "Regresión polinómica";
            case "tree" -> "Árbol de decisión";
            case "forest" -> "Bosque aleatorio";
            case "gbm" -> "Gradient Boosting";
            case "knn" -> "K vecinos más cercanos";
            case "bayes" -> "Naive Bayes";
            case "logistic" -> "Regresión logística";
            default -> algo;
        };
    }

    /* ============================ Entrada ============================ */

    static Map<String, Object> run(DataFrame df, String algorithm, Map<String, Object> p) {
        return switch (algorithm) {
            case "ridge", "lasso", "poly" -> single(df, algorithm, false, p);
            case "bayes" -> single(df, algorithm, true, p);
            case "tree", "forest", "gbm", "knn" -> single(df, algorithm, "classification".equals(str(p, "task")), p);
            case "automl" -> automl(df, p);
            default -> throw new IllegalArgumentException("Algoritmo no soportado: " + algorithm);
        };
    }

    private static Map<String, Object> single(DataFrame df, String algo, boolean cls, Map<String, Object> p) {
        Prep pr = prepare(df, p, cls);
        return train(algo, cls, pr, p, true, inputMap(p));
    }

    /* ============================ Preparación ============================ */

    static Prep prepare(DataFrame df, Map<String, Object> p, boolean cls) {
        String target = str(p, "target");
        List<String> feats = new ArrayList<>(strList(p, "features"));
        feats.remove(target);
        if (target == null) throw new IllegalArgumentException(cls ? "Elige qué clasificar (objetivo)." : "Elige la variable a predecir (objetivo).");
        if (feats.isEmpty()) throw new IllegalArgumentException("Elige al menos una variable predictora.");
        int k = feats.size();
        double testSize = Math.max(0, Math.min(0.5, dbl(p, "testSize", 0.2)));

        double[][] x; double[] y;
        String pos = null, neg = null, rule = null;
        boolean sampled = false; int complete;
        if (!cls) {
            List<String> cols = new ArrayList<>();
            cols.add(target); cols.addAll(feats);
            Data d = extract(df, cols);
            requireRows(d.x().length, k + 8);
            int n = d.x().length;
            x = new double[n][k]; y = new double[n];
            for (int i = 0; i < n; i++) { y[i] = d.x()[i][0]; System.arraycopy(d.x()[i], 1, x[i], 0, k); }
            sampled = d.sampled(); complete = d.complete();
        } else {
            int ti = df.indexOf(target);
            if (ti < 0) throw new IllegalArgumentException("Campo no encontrado: " + target);
            int[] fi = new int[k];
            for (int j = 0; j < k; j++) { fi[j] = df.indexOf(feats.get(j)); if (fi[j] < 0) throw new IllegalArgumentException("Campo no encontrado: " + feats.get(j)); }
            List<double[]> xs = new ArrayList<>();
            List<String> raw = new ArrayList<>();
            for (List<String> row : df.rows()) {
                double[] v = new double[k];
                boolean ok = true;
                for (int j = 0; j < k; j++) { Double dv = parse(row.get(fi[j])); if (dv == null) { ok = false; break; } v[j] = dv; }
                String t = row.get(ti) == null ? "" : row.get(ti).trim();
                if (ok && !t.isEmpty()) { xs.add(v); raw.add(t); }
            }
            complete = xs.size();
            if (xs.size() > 20000) {
                sampled = true;
                List<double[]> x2 = new ArrayList<>(); List<String> r2 = new ArrayList<>();
                double step = xs.size() / 20000.0;
                for (int i = 0; i < 20000; i++) { int at = (int) (i * step); x2.add(xs.get(at)); r2.add(raw.get(at)); }
                xs = x2; raw = r2;
            }
            int n = xs.size();
            requireRows(n, 20);
            x = xs.toArray(new double[0][]);
            y = new double[n];
            Set<String> distinct = new LinkedHashSet<>(raw);
            boolean numericTarget = distinct.size() > 2 && raw.stream().allMatch(s -> parse(s) != null);
            if (numericTarget) {
                double[] tv = raw.stream().mapToDouble(s -> parse(s)).toArray();
                double[] sorted = tv.clone();
                Arrays.sort(sorted);
                double thr = dbl(p, "threshold", Double.NaN);
                boolean auto = Double.isNaN(thr);
                if (auto) thr = quantile(sorted, 0.5);
                for (int i = 0; i < n; i++) y[i] = tv[i] >= thr ? 1 : 0;
                pos = target + " ≥ " + fmt(thr);
                neg = target + " < " + fmt(thr);
                rule = "Se separó " + target + " en dos grupos con el umbral " + fmt(thr) + (auto ? " (la mediana)." : ".");
            } else {
                if (distinct.size() < 2) throw new IllegalArgumentException("La variable objetivo solo tiene un valor distinto.");
                Map<String, Integer> freq = new LinkedHashMap<>();
                for (String s : raw) freq.merge(s, 1, Integer::sum);
                String positive = str(p, "positive");
                if (positive == null || !freq.containsKey(positive)) positive = Collections.min(freq.entrySet(), Map.Entry.comparingByValue()).getKey();
                for (int i = 0; i < n; i++) y[i] = raw.get(i).equals(positive) ? 1 : 0;
                pos = target + " = " + positive;
                neg = "Cualquier otro valor";
                rule = "Se predice si " + target + " es '" + positive + "' frente al resto.";
            }
        }
        int n = x.length;
        int nTest = n >= 20 ? (int) Math.round(n * testSize) : 0;
        int[] perm = shuffled(n);
        int[] test = Arrays.copyOfRange(perm, 0, nTest);
        int[] train = Arrays.copyOfRange(perm, nTest, n);
        if (cls) {
            double s = 0;
            for (int i : train) s += y[i];
            if (s == 0 || s == train.length) throw new IllegalArgumentException("El conjunto de entrenamiento solo contiene una clase. Cambia el objetivo o el umbral.");
        }
        return new Prep(cls, target, feats, x, y, train, test, pos, neg, rule, sampled, complete);
    }

    /* ============================ Ajuste ============================ */

    private static Predictor fit(String algo, Prep pr, Map<String, Object> p, List<String> notes) {
        boolean heavy = Set.of("tree", "forest", "gbm", "knn").contains(algo);
        int[] tr = pr.train();
        if (heavy && tr.length > HEAVY_CAP) {
            tr = Arrays.copyOf(tr, HEAVY_CAP);
            notes.add("Este modelo se entrenó con una muestra de " + HEAVY_CAP + " filas para mantener la velocidad.");
        }
        double[][] xt = new double[tr.length][];
        double[] yt = new double[tr.length];
        for (int i = 0; i < tr.length; i++) { xt[i] = pr.x()[tr[i]]; yt[i] = pr.y()[tr[i]]; }
        long seed = 42;
        return switch (algo) {
            case "ols" -> MlModels.ridge(xt, yt, 1e-8);
            case "ridge" -> MlModels.ridge(xt, yt, Math.max(0, dbl(p, "lambda", 1.0)));
            case "lasso" -> MlModels.lasso(xt, yt, Math.max(0, dbl(p, "lambda", 0.1)));
            case "poly" -> MlModels.poly(xt, yt, intp(p, "degree", 2), dbl(p, "lambda", 1.0));
            case "tree" -> MlModels.tree(xt, yt, Math.max(1, Math.min(12, intp(p, "maxDepth", 5))), Math.max(1, intp(p, "minLeaf", 5)), seed);
            case "forest" -> MlModels.forest(xt, yt, pr.cls(), Math.max(5, Math.min(300, intp(p, "nTrees", 60))), Math.max(1, Math.min(12, intp(p, "maxDepth", 8))), Math.max(1, intp(p, "minLeaf", 3)), seed);
            case "gbm" -> MlModels.gbm(xt, yt, pr.cls(), Math.max(10, Math.min(400, intp(p, "rounds", 80))), Math.max(0.01, Math.min(1, dbl(p, "learningRate", 0.1))), Math.max(1, Math.min(6, intp(p, "maxDepth", 3))), seed);
            case "knn" -> MlModels.knn(xt, yt, intp(p, "k", 5));
            case "bayes" -> MlModels.bayes(xt, yt);
            case "logistic" -> MlModels.logit(xt, yt, 0.01);
            default -> throw new IllegalArgumentException("Modelo desconocido: " + algo);
        };
    }

    private static double[] predictAll(Predictor m, double[][] x, int[] idx) {
        double[] out = new double[idx.length];
        for (int i = 0; i < idx.length; i++) out[i] = m.predict(x[idx[i]]);
        return out;
    }

    private static double[] pick(double[] y, int[] idx) {
        double[] o = new double[idx.length];
        for (int i = 0; i < idx.length; i++) o[i] = y[idx[i]];
        return o;
    }

    /* ============================ Métricas ============================ */

    static Map<String, Object> regMetrics(double[] pred, double[] y) {
        int n = y.length;
        double my = mean(y), sse = 0, sst = 0, sae = 0;
        for (int i = 0; i < n; i++) { double e = y[i] - pred[i]; sse += e * e; sae += Math.abs(e); sst += (y[i] - my) * (y[i] - my); }
        return map("n", n, "r2", r(sst == 0 ? 0 : 1 - sse / sst), "rmse", r(Math.sqrt(sse / n)), "mae", r(sae / n));
    }

    static Double auc(double[] prob, double[] y) {
        int nPos = 0;
        for (double v : y) if (v == 1) nPos++;
        int nNeg = y.length - nPos;
        if (nPos == 0 || nNeg == 0) return null;
        double[] rk = ranks(prob);
        double sp = 0;
        for (int i = 0; i < y.length; i++) if (y[i] == 1) sp += rk[i];
        return (sp - nPos * (nPos + 1) / 2.0) / ((double) nPos * nNeg);
    }

    static Map<String, Object> clsMetrics(double[] prob, double[] y) {
        int tp = 0, fp = 0, tn = 0, fn = 0;
        for (int i = 0; i < y.length; i++) {
            boolean pp = prob[i] >= 0.5, ap = y[i] == 1;
            if (pp && ap) tp++; else if (pp) fp++; else if (ap) fn++; else tn++;
        }
        int n = y.length;
        double acc = (tp + tn) / (double) n;
        double prec = tp + fp == 0 ? 0 : tp / (double) (tp + fp);
        double rec = tp + fn == 0 ? 0 : tp / (double) (tp + fn);
        double f1 = prec + rec == 0 ? 0 : 2 * prec * rec / (prec + rec);
        double base = Math.max(tp + fn, tn + fp) / (double) n;
        Double a = auc(prob, y);
        return map("n", n, "accuracy", r(acc), "precision", r(prec), "recall", r(rec), "f1", r(f1),
                "auc", a == null ? null : r(a), "baseline", r(base), "confusion", map("tp", tp, "fp", fp, "tn", tn, "fn", fn));
    }

    private static List<Map<String, Object>> rocCurve(double[] prob, double[] y) {
        int nPos = 0;
        for (double v : y) if (v == 1) nPos++;
        int nNeg = y.length - nPos;
        List<Map<String, Object>> roc = new ArrayList<>();
        if (nPos == 0 || nNeg == 0) return roc;
        Integer[] ord = new Integer[y.length];
        for (int i = 0; i < ord.length; i++) ord[i] = i;
        Arrays.sort(ord, (u, v) -> Double.compare(prob[v], prob[u]));
        int ctp = 0, cfp = 0;
        roc.add(map("fpr", 0.0, "tpr", 0.0));
        for (int a = 0; a < ord.length; a++) {
            if (y[ord[a]] == 1) ctp++; else cfp++;
            if (a == ord.length - 1 || prob[ord[a]] != prob[ord[a + 1]])
                roc.add(map("fpr", r(cfp / (double) nNeg), "tpr", r(ctp / (double) nPos)));
        }
        if (roc.size() > 120) {
            List<Map<String, Object>> thin = new ArrayList<>();
            for (int i : strideIndexes(roc.size(), 120)) thin.add(roc.get(i));
            thin.add(roc.get(roc.size() - 1));
            return thin;
        }
        return roc;
    }

    private static double score(double[] pred, double[] y, boolean cls) {
        if (cls) {
            Double a = auc(pred, y);
            if (a != null) return a;
            return (Double) clsMetrics(pred, y).get("accuracy");
        }
        double sse = 0;
        for (int i = 0; i < y.length; i++) sse += (y[i] - pred[i]) * (y[i] - pred[i]);
        return Math.sqrt(sse / y.length);
    }

    private static List<Map<String, Object>> permutationImportance(Predictor m, Prep pr, int[] evalIdx) {
        int k = pr.feats().size(), n = evalIdx.length;
        double[][] xe = new double[n][];
        for (int i = 0; i < n; i++) xe[i] = pr.x()[evalIdx[i]].clone();
        double[] ye = pick(pr.y(), evalIdx);
        double[] bp = new double[n];
        for (int i = 0; i < n; i++) bp[i] = m.predict(xe[i]);
        double base = score(bp, ye, pr.cls());
        Random rnd = new Random(7);
        double[] imp = new double[k];
        for (int j = 0; j < k; j++) {
            double acc = 0;
            for (int rep = 0; rep < 3; rep++) {
                double[] col = new double[n];
                for (int i = 0; i < n; i++) col[i] = xe[i][j];
                for (int i = n - 1; i > 0; i--) { int s = rnd.nextInt(i + 1); double t = col[i]; col[i] = col[s]; col[s] = t; }
                double[] pp = new double[n];
                for (int i = 0; i < n; i++) {
                    double[] row = xe[i].clone();
                    row[j] = col[i];
                    pp[i] = m.predict(row);
                }
                double sc = score(pp, ye, pr.cls());
                acc += pr.cls() ? base - sc : sc - base;
            }
            imp[j] = acc / 3;
        }
        double pos = 0;
        for (double v : imp) pos += Math.max(0, v);
        List<Map<String, Object>> out = new ArrayList<>();
        for (int j = 0; j < k; j++) out.add(map("name", pr.feats().get(j), "value", r(imp[j]), "share", r(pos == 0 ? 0 : Math.max(0, imp[j]) / pos)));
        out.sort((a, b) -> Double.compare((Double) b.get("share"), (Double) a.get("share")));
        return out;
    }

    /* ============================ Entrenamiento + resultado ============================ */

    static Map<String, Object> train(String algo, boolean cls, Prep pr, Map<String, Object> p, boolean importance, Map<String, Double> input) {
        long t0 = System.nanoTime();
        List<String> notes = new ArrayList<>();
        Predictor m = fit(algo, pr, p, notes);
        long ms = (System.nanoTime() - t0) / 1_000_000;

        int[] evalIdx = pr.test().length > 0 ? pr.test() : pr.train();
        int[] trainEval = pr.train().length > 2000 ? Arrays.copyOf(pr.train(), 2000) : pr.train();
        double[] pEval = predictAll(m, pr.x(), evalIdx), yEval = pick(pr.y(), evalIdx);
        double[] pTr = predictAll(m, pr.x(), trainEval), yTr = pick(pr.y(), trainEval);
        boolean hasTest = pr.test().length > 0;

        Map<String, Object> mTr = cls ? clsMetrics(pTr, yTr) : regMetrics(pTr, yTr);
        Map<String, Object> mEv = hasTest ? (cls ? clsMetrics(pEval, yEval) : regMetrics(pEval, yEval)) : null;
        Map<String, Object> primary = mEv != null ? mEv : mTr;

        Map<String, Object> out = map("algorithm", algo, "task", cls ? "classification" : "regression", "model", modelName(algo),
                "n", pr.x().length, "target", pr.target(), "features", pr.feats(),
                "train", mTr, "test", mEv, "evaluatedOn", hasTest ? "prueba" : "entrenamiento", "trainMs", ms);
        if (cls) {
            out.put("positive", pr.pos()); out.put("negative", pr.neg());
            out.put("metrics", primary);
            out.put("confusion", primary.get("confusion"));
            out.put("roc", rocCurve(pEval, yEval));
        } else {
            List<Map<String, Object>> sc = new ArrayList<>();
            Set<Integer> ts = new HashSet<>();
            for (int i : pr.test()) ts.add(i);
            for (int i : strideIndexes(pr.x().length, 300)) sc.add(map("actual", r(pr.y()[i]), "pred", r(m.predict(pr.x()[i])), "set", ts.contains(i) ? "test" : "train"));
            out.put("scatter", sc);
        }

        if (m instanceof MlModels.LinModel lm) {
            double[] raw = lm.rawCoefficients();
            double sdY = sd(pick(pr.y(), pr.train()));
            if (sdY == 0) sdY = 1;
            List<String> names = lm.names(pr.feats());
            List<Map<String, Object>> coefs = new ArrayList<>();
            coefs.add(map("name", "Intercepto", "value", r(raw[0]), "standardized", null, "zero", false));
            for (int j = 0; j < names.size(); j++) coefs.add(map("name", names.get(j), "value", r(raw[j + 1]), "standardized", r(lm.beta[j] / sdY), "zero", Math.abs(lm.beta[j]) < 1e-9));
            out.put("coefficients", coefs);
        }
        if (importance) out.put("importance", permutationImportance(m, pr, evalIdx));

        // Lectura
        List<String> ins = new ArrayList<>();
        if (cls) {
            ins.add(pr.rule());
            double acc = (Double) primary.get("accuracy"), base = (Double) primary.get("baseline");
            ins.add("Exactitud " + pct(acc) + " frente a " + pct(base) + " de responder siempre la clase mayoritaria" + (acc > base + 0.02 ? " (aporta valor)." : " (aporta poco)."));
            Double a = (Double) primary.get("auc");
            if (a != null) ins.add("AUC " + fmt(a) + ": " + (a >= 0.9 ? "excelente" : a >= 0.8 ? "buena" : a >= 0.7 ? "aceptable" : "débil") + " capacidad de separar las clases.");
        } else {
            double r2 = (Double) primary.get("r2");
            ins.add("El modelo explica " + pct(Math.max(0, r2)) + " de la variación de " + pr.target() + (hasTest ? " en datos que no vio al entrenar." : " (sin conjunto de prueba: pocos datos)."));
            ins.add("Error típico (RMSE) " + fmt((Double) primary.get("rmse")) + "; error absoluto medio " + fmt((Double) primary.get("mae")) + ".");
        }
        if (hasTest) {
            double gap = cls ? ((Double) mTr.get("accuracy") - (Double) mEv.get("accuracy")) : ((Double) mTr.get("r2") - (Double) mEv.get("r2"));
            if (gap > 0.12) ins.add("Posible sobreajuste: rinde notablemente mejor en entrenamiento que en prueba (brecha " + fmt(gap) + ").");
        } else ins.add("Pocos datos: la evaluación usa las mismas filas del entrenamiento y puede ser optimista.");
        if (importance && out.get("importance") instanceof List<?> li && !li.isEmpty()) {
            @SuppressWarnings("unchecked") Map<String, Object> top = (Map<String, Object>) li.get(0);
            if ((Double) top.get("share") > 0) ins.add("Variable más influyente: " + top.get("name") + " (" + pct((Double) top.get("share")) + " de la importancia).");
        }
        if (algo.equals("lasso") && out.get("coefficients") instanceof List<?> cl) {
            List<String> zero = new ArrayList<>();
            for (Object o : cl) { @SuppressWarnings("unchecked") Map<String, Object> c = (Map<String, Object>) o; if (Boolean.TRUE.equals(c.get("zero"))) zero.add((String) c.get("name")); }
            ins.add(zero.isEmpty() ? "Lasso conservó todas las variables." : "Lasso descartó: " + String.join(", ", zero) + ".");
        }
        if (pr.sampled()) ins.add("Se usó una muestra de 20000 filas de " + pr.complete() + ".");
        ins.addAll(notes);
        out.put("insights", ins);

        if (input != null) {
            double[] row = new double[pr.feats().size()];
            for (int j = 0; j < row.length; j++) {
                Double v = input.get(pr.feats().get(j));
                if (v == null) throw new IllegalArgumentException("Falta el valor de '" + pr.feats().get(j) + "' en el caso a probar.");
                row[j] = v;
            }
            double pv = m.predict(row);
            if (cls) out.put("prediction", map("probability", r(pv), "label", pv >= 0.5 ? pr.pos() : pr.neg()));
            else {
                double rm = (Double) primary.get("rmse");
                out.put("prediction", map("value", r(pv), "lower", r(pv - 1.96 * rm), "upper", r(pv + 1.96 * rm)));
            }
        }
        return out;
    }

    /* ============================ AutoML ============================ */

    static Map<String, Object> automl(DataFrame df, Map<String, Object> p) {
        boolean cls = "classification".equals(str(p, "task"));
        Prep pr = prepare(df, p, cls);
        String[] cands = cls
                ? new String[]{"logistic", "bayes", "knn", "tree", "forest", "gbm"}
                : new String[]{"ols", "ridge", "lasso", "poly", "knn", "tree", "forest", "gbm"};
        Map<String, Object> hyper = new HashMap<>();
        List<Map<String, Object>> board = new ArrayList<>();
        for (String c : cands) {
            Map<String, Object> e = new LinkedHashMap<>();
            e.put("algorithm", c); e.put("name", modelName(c));
            try {
                Map<String, Object> r = train(c, cls, pr, hyper, false, null);
                @SuppressWarnings("unchecked") Map<String, Object> tr = (Map<String, Object>) r.get("train");
                @SuppressWarnings("unchecked") Map<String, Object> te = (Map<String, Object>) r.get("test");
                Map<String, Object> ev = te != null ? te : tr;
                e.put("trainMs", r.get("trainMs"));
                if (cls) {
                    e.put("accuracy", ev.get("accuracy")); e.put("f1", ev.get("f1")); e.put("auc", ev.get("auc"));
                    e.put("precision", ev.get("precision")); e.put("recall", ev.get("recall"));
                    e.put("trainAccuracy", tr.get("accuracy"));
                    e.put("sortKey", ev.get("auc") != null ? -(Double) ev.get("auc") : -(Double) ev.get("accuracy"));
                } else {
                    e.put("rmse", ev.get("rmse")); e.put("mae", ev.get("mae")); e.put("r2", ev.get("r2"));
                    e.put("trainR2", tr.get("r2"));
                    e.put("sortKey", ev.get("rmse"));
                }
            } catch (Exception ex) {
                e.put("error", ex.getMessage() == null ? ex.getClass().getSimpleName() : ex.getMessage());
                e.put("sortKey", Double.MAX_VALUE);
            }
            board.add(e);
        }
        board.sort((a, b) -> Double.compare((Double) a.get("sortKey"), (Double) b.get("sortKey")));
        int rank = 1;
        for (Map<String, Object> e : board) { e.remove("sortKey"); if (!e.containsKey("error")) e.put("rank", rank++); }
        Map<String, Object> bestEntry = board.get(0);
        if (bestEntry.containsKey("error")) throw new IllegalArgumentException("Ningún modelo pudo entrenarse con estos datos.");
        String bestAlgo = (String) bestEntry.get("algorithm");
        Map<String, Object> best = train(bestAlgo, cls, pr, hyper, true, inputMap(p));

        List<String> ins = new ArrayList<>();
        ins.add("Se compararon " + cands.length + " modelos con la misma partición de datos; el mejor es " + bestEntry.get("name") + ".");
        if (cls) {
            ins.add(pr.rule());
            ins.add("Ranking por AUC en " + (pr.test().length > 0 ? "datos de prueba" : "entrenamiento (pocos datos)") + ".");
        } else ins.add("Ranking por RMSE (menor es mejor) en " + (pr.test().length > 0 ? "datos de prueba." : "entrenamiento (pocos datos)."));
        if (board.size() > 1 && !board.get(board.size() - 1).containsKey("error")) ins.add("Elegir por simplicidad: si dos modelos empatan, el más simple se interpreta y mantiene mejor.");

        Map<String, Object> out = map("algorithm", "automl", "task", cls ? "classification" : "regression",
                "n", pr.x().length, "target", pr.target(), "features", pr.feats(),
                "metric", cls ? "AUC" : "RMSE", "leaderboard", board, "bestAlgorithm", bestAlgo, "bestName", bestEntry.get("name"),
                "best", best, "insights", ins);
        if (best.get("prediction") != null) out.put("prediction", best.get("prediction"));
        return out;
    }
}
