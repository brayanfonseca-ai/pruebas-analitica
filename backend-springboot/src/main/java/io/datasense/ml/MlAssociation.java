package io.datasense.ml;

import io.datasense.engine.DataFrame;
import io.datasense.engine.Profiler;
import io.datasense.engine.TableStore;
import io.datasense.model.AppModels.ColumnProfile;
import io.datasense.repo.Ids;
import io.datasense.repo.SheetRepository;
import io.datasense.repo.TableRepository;

import org.springframework.stereotype.Service;

import java.text.Normalizer;
import java.util.*;
import java.util.regex.Pattern;

/**
 * "Asociar a una app": convierte una ejecución de ML en
 * <ol>
 *   <li>una TABLA del modelo de datos de la app ({@code ML_...}) con el resultado
 *       por fila (segmento, predicción, probabilidad, atípico…) enlazada a la tabla
 *       de origen por su clave única (asociación por nombre de campo, como Qlik), o
 *       una tabla resumen (pronóstico, correlaciones, PCA, reglas);</li>
 *   <li>una HOJA nueva con KPIs, gráficos y tabla de detalle sobre esa tabla, y en
 *       {@code props.ml} el resumen del modelo para que el agente analista lo lea.</li>
 * </ol>
 * Es idempotente por ejecución: volver a asociar reemplaza la tabla y la hoja.
 */
@Service
public class MlAssociation {

    private final TableRepository tables;
    private final TableStore store;
    private final SheetRepository sheets;

    public MlAssociation(TableRepository tables, TableStore store, SheetRepository sheets) {
        this.tables = tables;
        this.store = store;
        this.sheets = sheets;
    }

    static final Map<String, String> NAMES = Map.ofEntries(
            Map.entry("kmeans", "K-Means"), Map.entry("hierarchical", "Clúster jerárquico"), Map.entry("dbscan", "DBSCAN"),
            Map.entry("linear", "Regresión lineal"), Map.entry("logistic", "Regresión logística"),
            Map.entry("ridge", "Ridge"), Map.entry("lasso", "Lasso"), Map.entry("poly", "Regresión polinómica"),
            Map.entry("tree", "Árbol de decisión"), Map.entry("forest", "Random Forest"), Map.entry("gbm", "Gradient Boosting"),
            Map.entry("knn", "K vecinos (KNN)"), Map.entry("bayes", "Naive Bayes"), Map.entry("automl", "AutoML"),
            Map.entry("anomaly", "Detección de anomalías"), Map.entry("forecast", "Pronóstico"),
            Map.entry("correlation", "Correlaciones"), Map.entry("pca", "PCA"), Map.entry("rules", "Reglas de asociación"));

    private static final Pattern KEY_NAME = Pattern.compile("(?i).*(\\bid\\b|^id|id$|_id|cod|clave|key|cedula|c[eé]dula|documento|nit|numero|n[uú]mero|folio|consecutivo).*");

    /**
     * @param exp        experimento (id, name, app_id)
     * @param run        ejecución (id, algorithm, label)
     * @param scored     resultado re-calculado con {@code __score=true}
     * @param src        DataFrame de la tabla de origen
     * @param srcName    nombre de la tabla de origen
     * @param targetApp  app destino (la del experimento u otra)
     * @param sheetTitle título pedido para la hoja (opcional)
     */
    @SuppressWarnings("unchecked")
    public Map<String, Object> associate(Map<String, Object> exp, Map<String, Object> run, Map<String, Object> scored,
                                         DataFrame src, String srcName, String targetApp, String sheetTitle) {
        String algo = String.valueOf(run.get("algorithm"));
        String algoName = NAMES.getOrDefault(algo, algo);
        if ("automl".equals(algo) && scored.get("bestName") != null) algoName = "AutoML (" + scored.get("bestName") + ")";
        String runId = String.valueOf(run.get("id"));
        String label = run.get("label") == null ? "" : String.valueOf(run.get("label")).trim();
        boolean sameApp = targetApp.equals(exp.get("app_id"));

        // ---------- Nombre de la tabla resultado (idempotente por ejecución) ----------
        String tableName = "ML_" + slug(algo) + "_" + slug(srcName) + "_" + (label.isEmpty() ? runId.substring(0, Math.min(6, runId.length())) : slug(label));
        if (tableName.length() > 60) tableName = tableName.substring(0, 60);
        for (Map<String, Object> t : tables.listTables(targetApp)) {
            if (tableName.equals(t.get("name"))) { tables.deleteTable((String) t.get("id")); store.delete(targetApp, (String) t.get("id")); }
        }
        Set<String> taken = new HashSet<>();
        for (Map<String, Object> t : tables.listTables(targetApp)) {
            for (Map<String, Object> c : tables.listColumns((String) t.get("id"))) taken.add(String.valueOf(c.get("name")));
        }

        List<String> scoreCols = (List<String>) scored.get("__cols");
        List<List<String>> scoreRows = (List<List<String>>) scored.get("__rows");
        List<String> feats = strList(scored.get("features"));
        String target = scored.get("target") == null ? null : String.valueOf(scored.get("target"));

        DataFrame out;
        String key = null;
        boolean selfContained;
        Map<String, String> col = new LinkedHashMap<>(); // rol -> nombre real de la columna en la tabla ML
        String family;

        if (scoreCols != null && scoreRows != null) {
            family = familyOf(scoreCols);
            key = sameApp ? uniqueKey(src) : null;
            selfContained = key == null;
            List<String> cols = new ArrayList<>();
            Set<String> local = new HashSet<>();
            if (selfContained) { cols.addAll(src.columns()); local.addAll(src.columns()); }
            else { cols.add(key); local.add(key); }
            List<String> outNames = new ArrayList<>();
            for (String c : scoreCols) {
                String n = unique(c, local, taken);
                local.add(n);
                outNames.add(n);
                cols.add(n);
            }
            for (int i = 0; i < scoreCols.size(); i++) col.put(roleOf(scoreCols.get(i), i), outNames.get(i));
            int ki = key == null ? -1 : src.indexOf(key);
            List<List<String>> rows = new ArrayList<>();
            for (int r = 0; r < src.rowCount() && r < scoreRows.size(); r++) {
                List<String> s = scoreRows.get(r);
                if (s == null || s.stream().allMatch(Objects::isNull)) continue;
                List<String> row = new ArrayList<>(cols.size());
                if (selfContained) row.addAll(src.rows().get(r));
                else row.add(src.rows().get(r).get(ki));
                row.addAll(s);
                rows.add(row);
            }
            if (rows.isEmpty()) throw new IllegalArgumentException("El modelo no pudo puntuar ninguna fila (revisa valores vacíos en las variables).");
            out = new DataFrame(cols, rows);
        } else {
            selfContained = true;
            family = algo;
            out = summaryTable(algo, scored, col, taken);
            if (out == null || out.rowCount() == 0)
                throw new IllegalArgumentException("Esta ejecución no tiene resultados que se puedan llevar a una hoja.");
        }

        // ---------- Persistir la tabla en el modelo de la app ----------
        List<ColumnProfile> profiles = new ArrayList<>();
        for (int c = 0; c < out.columns().size(); c++) profiles.add(Profiler.profile(out.columns().get(c), out.columnValues(c)));
        Map<String, Object> trow = tables.createTable(targetApp, tableName, "ml:" + algo + ":" + runId, profiles);
        try { store.save(targetApp, (String) trow.get("id"), out); }
        catch (RuntimeException ex) { tables.deleteTable((String) trow.get("id")); throw ex; }

        // ---------- Hoja ----------
        String featTable = selfContained ? tableName : srcName;   // dónde viven las variables de entrada
        String catField = sameApp || selfContained ? categoricalField(src, key, feats, target) : null;
        String catTable = selfContained ? tableName : srcName;
        Layout L = new Layout();
        List<String> insights = strList(scored.get("insights"));
        StringBuilder head = new StringBuilder();
        head.append(algoName).append(" sobre ").append(srcName).append(" · experimento «").append(exp.get("name")).append("»");
        if (!label.isEmpty()) head.append(" · ").append(label);
        head.append("\nTabla de resultados en el modelo: ").append(tableName)
            .append(key != null ? " (asociada por " + key + ")" : selfContained && scoreCols != null ? " (incluye las columnas de origen: no hay clave única)" : "");
        for (int i = 0; i < Math.min(4, insights.size()); i++) head.append("\n• ").append(insights.get(i));
        if (Boolean.TRUE.equals(scored.get("__approx"))) head.append("\n• Las filas fuera de la muestra de entrenamiento se asignaron al grupo más cercano.");
        long lines = head.chars().filter(ch -> ch == '\n').count() + 1;
        L.add(text(head.toString()), 24, lines <= 6 ? 2 : 3);

        switch (family) {
            case "segment" -> {
                String g = col.get("group");
                int kw = col.containsKey("dist") ? 12 : 24;
                L.add(kpi("Registros segmentados", m(tableName, g, "count")), kw, 3);
                if (col.containsKey("dist")) L.add(kpi("Distancia media al centro (z)", m(tableName, col.get("dist"), "avg")), 12, 3);
                L.newRow();
                L.add(chart("bar", "Registros por grupo", d(tableName, g), List.of(m(tableName, g, "count"))), 12, 8);
                L.add(chart("pie", "Participación por grupo", d(tableName, g), List.of(m(tableName, g, "count"))), 12, 8);
                List<Map<String, Object>> prof = new ArrayList<>();
                for (String f : feats.subList(0, Math.min(3, feats.size()))) prof.add(m(featTable, f, "avg"));
                if (!prof.isEmpty()) L.add(chart("bar", "Perfil promedio por grupo", d(tableName, g), prof), 24, 8);
                List<Map<String, Object>> cent = new ArrayList<>();
                cent.add(m(tableName, g, "count"));
                for (String f : feats.subList(0, Math.min(4, feats.size()))) cent.add(m(featTable, f, "avg"));
                L.add(chart("table", "Centroides por grupo", d(tableName, g), cent), 24, 7);
                L.add(chart("filterpane", "Filtrar por grupo", d(tableName, g), List.of()), 24, 3);
            }
            case "regression" -> {
                String p = col.get("pred"), e = col.get("err");
                L.add(kpi("Predicción promedio", m(tableName, p, "avg")), 8, 3);
                if (e != null) L.add(kpi("Error medio (real − estimado)", m(tableName, e, "avg")), 8, 3);
                if (target != null) L.add(kpi(target + " real promedio", m(featTable, target, "avg")), 8, 3);
                L.newRow();
                if (catField != null) {
                    List<Map<String, Object>> ms = new ArrayList<>();
                    if (target != null) ms.add(m(featTable, target, "sum"));
                    ms.add(m(tableName, p, "sum"));
                    L.add(chart("bar", "Real vs. estimado por " + catField, d(catTable, catField), ms), 14, 8);
                    if (e != null) L.add(chart("bar", "Error promedio por " + catField, d(catTable, catField), List.of(m(tableName, e, "avg"))), 10, 8);
                }
                String det = key != null ? key : catField;
                if (det != null) {
                    List<Map<String, Object>> ms = new ArrayList<>();
                    if (target != null) ms.add(m(featTable, target, "avg"));
                    ms.add(m(tableName, p, "avg"));
                    if (e != null) ms.add(m(tableName, e, "avg"));
                    L.add(chart("table", "Detalle de predicciones", d(key != null ? tableName : catTable, det), ms), 24, 8);
                }
            }
            case "classification" -> {
                String pr = col.get("prob"), cl = col.get("class");
                L.add(kpi("Probabilidad promedio", m(tableName, pr, "avg")), 12, 3);
                L.add(kpi("Registros puntuados", m(tableName, cl, "count")), 12, 3);
                L.newRow();
                L.add(chart("pie", "Clases predichas", d(tableName, cl), List.of(m(tableName, cl, "count"))), 10, 8);
                if (catField != null) L.add(chart("bar", "Probabilidad promedio por " + catField, d(catTable, catField), List.of(m(tableName, pr, "avg"))), 14, 8);
                else L.add(chart("bar", "Probabilidad promedio por clase", d(tableName, cl), List.of(m(tableName, pr, "avg"))), 14, 8);
                if (key != null) L.add(chart("table", "Probabilidad por registro", d(tableName, key), List.of(m(tableName, pr, "avg"))), 24, 8);
                L.add(chart("filterpane", "Filtrar por clase predicha", d(tableName, cl), List.of()), 24, 3);
            }
            case "anomaly" -> {
                String a = col.get("flag"), s = col.get("score");
                L.add(kpi("Registros evaluados", m(tableName, a, "count")), 12, 3);
                L.add(kpi("Puntaje máximo (σ)", m(tableName, s, "max")), 12, 3);
                L.newRow();
                L.add(chart("pie", "Atípicos vs. normales", d(tableName, a), List.of(m(tableName, a, "count"))), 10, 8);
                List<Map<String, Object>> prof = new ArrayList<>();
                for (String f : feats.subList(0, Math.min(3, feats.size()))) prof.add(m(featTable, f, "avg"));
                if (!prof.isEmpty()) L.add(chart("bar", "Promedios: atípicos vs. normales", d(tableName, a), prof), 14, 8);
                if (key != null) L.add(chart("table", "Puntaje por registro", d(tableName, key), List.of(m(tableName, s, "max"))), 24, 8);
                L.add(chart("filterpane", "Filtrar atípicos", d(tableName, a), List.of()), 24, 3);
            }
            case "forecast" -> {
                String per = col.get("period");
                L.add(chart("line", "Histórico y pronóstico", d(tableName, per),
                        List.of(m(tableName, col.get("value"), "sum"), m(tableName, col.get("lower"), "sum"), m(tableName, col.get("upper"), "sum"))), 24, 9);
                L.add(chart("table", "Detalle por periodo", d(tableName, per),
                        List.of(m(tableName, col.get("value"), "sum"), m(tableName, col.get("fitted"), "sum"), m(tableName, col.get("lower"), "sum"), m(tableName, col.get("upper"), "sum"))), 24, 8);
                L.add(chart("filterpane", "Histórico / pronóstico", d(tableName, col.get("kind")), List.of()), 24, 3);
            }
            case "correlation" -> {
                L.add(chart("bar", "Correlación por par de variables", d(tableName, col.get("pair")), List.of(m(tableName, col.get("r"), "sum"))), 24, 9);
                L.add(chart("table", "Detalle de correlaciones", d(tableName, col.get("pair")), List.of(m(tableName, col.get("r"), "sum"), m(tableName, col.get("r2"), "sum"))), 24, 8);
            }
            case "pca" -> {
                L.add(chart("bar", "Varianza explicada por componente", d(tableName, col.get("comp")), List.of(m(tableName, col.get("explained"), "sum"))), 12, 8);
                L.add(chart("line", "Varianza acumulada", d(tableName, col.get("comp")), List.of(m(tableName, col.get("cumulative"), "sum"))), 12, 8);
                List<Map<String, Object>> ms = new ArrayList<>();
                ms.add(m(tableName, col.get("explained"), "sum"));
                for (String f : feats.subList(0, Math.min(4, feats.size()))) if (col.containsKey("load:" + f)) ms.add(m(tableName, col.get("load:" + f), "sum"));
                L.add(chart("table", "Cargas por componente", d(tableName, col.get("comp")), ms), 24, 8);
            }
            case "rules" -> {
                L.add(chart("bar", "Lift por regla", d(tableName, col.get("rule")), List.of(m(tableName, col.get("lift"), "sum"))), 24, 9);
                L.add(chart("table", "Reglas encontradas", d(tableName, col.get("rule")),
                        List.of(m(tableName, col.get("support"), "sum"), m(tableName, col.get("confidence"), "sum"), m(tableName, col.get("lift"), "sum"), m(tableName, col.get("count"), "sum"))), 24, 8);
            }
            default -> { }
        }

        String title = sheetTitle == null || sheetTitle.isBlank()
                ? "ML · " + algoName + " · " + srcName + (label.isEmpty() ? "" : " · " + label)
                : sheetTitle.trim();
        Map<String, Object> ml = new LinkedHashMap<>();
        ml.put("origen", "Experimento de ML");
        ml.put("experimento", exp.get("name"));
        ml.put("experimentoId", exp.get("id"));
        ml.put("ejecucionId", runId);
        if (!label.isEmpty()) ml.put("etiqueta", label);
        ml.put("algoritmo", algoName);
        ml.put("tablaOrigen", srcName);
        ml.put("tablaResultado", tableName);
        if (key != null) ml.put("claveAsociacion", key);
        ml.put("columnasResultado", new ArrayList<>(col.values()));
        ml.put("filasResultado", out.rowCount());
        List<String> notes = howToRead(family);
        if (!notes.isEmpty()) ml.put("comoLeer", notes);
        ml.put("resultado", compact(scored));

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("title", title);
        body.put("description", "Hoja generada desde el experimento de ML «" + exp.get("name") + "» (" + algoName + "). Tabla: " + tableName + ".");
        body.put("objects", L.objects);
        body.put("props", Map.of("extend", true, "ml", ml));

        Map<String, Object> sheet = sheets.findByMlRun(targetApp, runId)
                .flatMap(sid -> sheets.update(sid, body)).orElse(null);
        if (sheet == null) sheet = sheets.create(targetApp, body);

        Map<String, Object> res = new LinkedHashMap<>();
        res.put("ok", true);
        res.put("appId", targetApp);
        res.put("table", Map.of("id", trow.get("id"), "name", tableName, "rows", out.rowCount(), "fields", out.columns().size()));
        res.put("key", key);
        res.put("sheet", Map.of("id", sheet.get("id"), "title", sheet.get("title"), "objects", L.objects.size()));
        res.put("message", "Tabla " + tableName + " (" + out.rowCount() + " filas) y hoja «" + sheet.get("title") + "» creadas.");
        return res;
    }

    /* ============================ Tablas resumen ============================ */

    @SuppressWarnings("unchecked")
    private static DataFrame summaryTable(String algo, Map<String, Object> r, Map<String, String> col, Set<String> taken) {
        Set<String> local = new HashSet<>();
        java.util.function.BiFunction<String, String, String> c = (role, name) -> { String n = unique(name, local, taken); local.add(n); col.put(role, n); return n; };
        List<List<String>> rows = new ArrayList<>();
        switch (algo) {
            case "forecast" -> {
                String measure = String.valueOf(r.getOrDefault("measure", "Valor"));
                List<String> cols = List.of(c.apply("period", "Periodo"), c.apply("kind", "Tipo"), c.apply("value", measure),
                        c.apply("fitted", "Ajustado"), c.apply("lower", "Inferior"), c.apply("upper", "Superior"));
                for (Map<String, Object> h : (List<Map<String, Object>>) r.getOrDefault("history", List.of()))
                    rows.add(Arrays.asList(s(h.get("label")), "Histórico", s(h.get("value")), s(h.get("fitted")), null, null));
                for (Map<String, Object> f : (List<Map<String, Object>>) r.getOrDefault("forecast", List.of()))
                    rows.add(Arrays.asList(s(f.get("label")), "Pronóstico", s(f.get("value")), null, s(f.get("lower")), s(f.get("upper"))));
                return new DataFrame(cols, rows);
            }
            case "correlation" -> {
                List<String> cols = List.of(c.apply("pair", "Par de variables"), c.apply("a", "Variable A"), c.apply("b", "Variable B"),
                        c.apply("r", "Correlacion"), c.apply("r2", "R2"), c.apply("strength", "Fuerza"), c.apply("dir", "Direccion"));
                for (Map<String, Object> p : (List<Map<String, Object>>) r.getOrDefault("pairs", List.of()))
                    rows.add(Arrays.asList(s(p.get("a")) + " ~ " + s(p.get("b")), s(p.get("a")), s(p.get("b")), s(p.get("r")), s(p.get("r2")), s(p.get("strength")), s(p.get("direction"))));
                return new DataFrame(cols, rows);
            }
            case "pca" -> {
                List<String> feats = strList(r.get("features"));
                List<String> cols = new ArrayList<>(List.of(c.apply("comp", "Componente"), c.apply("explained", "Varianza explicada"),
                        c.apply("cumulative", "Varianza acumulada"), c.apply("eigen", "Valor propio")));
                for (String f : feats) cols.add(c.apply("load:" + f, "Carga " + f));
                for (Map<String, Object> p : (List<Map<String, Object>>) r.getOrDefault("components", List.of())) {
                    List<String> row = new ArrayList<>(Arrays.asList(s(p.get("name")), s(p.get("explained")), s(p.get("cumulative")), s(p.get("eigenvalue"))));
                    Map<String, Object> ld = (Map<String, Object>) p.getOrDefault("loadings", Map.of());
                    for (String f : feats) row.add(s(ld.get(f)));
                    rows.add(row);
                }
                return new DataFrame(cols, rows);
            }
            case "rules" -> {
                List<String> cols = List.of(c.apply("rule", "Regla"), c.apply("if", "Si"), c.apply("then", "Entonces"),
                        c.apply("support", "Soporte"), c.apply("confidence", "Confianza"), c.apply("lift", "Lift"), c.apply("count", "Casos"));
                for (Map<String, Object> p : (List<Map<String, Object>>) r.getOrDefault("rules", List.of())) {
                    String si = String.join(" y ", strList(p.get("if"))), en = String.join(" y ", strList(p.get("then")));
                    rows.add(Arrays.asList(si + " ⇒ " + en, si, en, s(p.get("support")), s(p.get("confidence")), s(p.get("lift")), s(p.get("count"))));
                }
                return new DataFrame(cols, rows);
            }
            default -> { return null; }
        }
    }

    /* ============================ Utilidades ============================ */

    private static String familyOf(List<String> cols) {
        String first = cols.get(0);
        if (first.equals("Segmento") || first.equals("Grupo")) return "segment";
        if (first.equals("Probabilidad")) return "classification";
        if (first.equals("Atipico")) return "anomaly";
        return "regression";
    }

    private static String roleOf(String c, int i) {
        if (c.equals("Segmento") || c.equals("Grupo")) return "group";
        if (c.equals("Distancia al centro")) return "dist";
        if (c.equals("Probabilidad")) return "prob";
        if (c.equals("Clase predicha")) return "class";
        if (c.equals("Atipico")) return "flag";
        if (c.equals("Puntaje atipico")) return "score";
        if (c.startsWith("Prediccion")) return "pred";
        if (c.startsWith("Error")) return "err";
        return "c" + i;
    }

    /** Columna con un valor distinto y no vacío por fila; prioriza nombres de clave (id, código, cédula…). */
    static String uniqueKey(DataFrame df) {
        int n = df.rowCount();
        if (n == 0) return null;
        String fallback = null;
        for (int c = 0; c < df.columns().size(); c++) {
            Set<String> seen = new HashSet<>();
            boolean ok = true;
            for (List<String> row : df.rows()) {
                String v = c < row.size() ? row.get(c) : null;
                if (v == null || v.isBlank() || !seen.add(v.trim())) { ok = false; break; }
            }
            if (!ok) continue;
            String name = df.columns().get(c);
            if (KEY_NAME.matcher(name).matches()) return name;
            if (fallback == null) fallback = name;
        }
        return fallback;
    }

    /** Campo categórico de baja cardinalidad (2..30 valores, no numérico) para desgloses. */
    private static String categoricalField(DataFrame df, String key, List<String> feats, String target) {
        String best = null; int bestD = Integer.MAX_VALUE;
        for (int c = 0; c < df.columns().size(); c++) {
            String name = df.columns().get(c);
            if (name.equals(key) || feats.contains(name) || name.equals(target)) continue;
            Set<String> d = new HashSet<>();
            boolean numeric = true;
            for (List<String> row : df.rows()) {
                String v = c < row.size() ? row.get(c) : null;
                if (v == null || v.isBlank()) continue;
                d.add(v);
                if (numeric && MlService.parse(v) == null) numeric = false;
                if (d.size() > 30) break;
            }
            if (numeric || d.size() < 2 || d.size() > 30) continue;
            if (d.size() < bestD) { bestD = d.size(); best = name; }
        }
        return best;
    }

    /** Nombre libre en la app: "Segmento" → "Segmento ML" → "Segmento ML 2"… (evita asociaciones accidentales). */
    private static String unique(String name, Set<String> local, Set<String> taken) {
        if (!local.contains(name) && !taken.contains(name)) return name;
        String base = name + " ML", n = base;
        int i = 2;
        while (local.contains(n) || taken.contains(n)) n = base + " " + (i++);
        return n;
    }

    /** Cómo leer las métricas (va en props.ml para que el analista no las malinterprete). */
    private static List<String> howToRead(String family) {
        List<String> out = new ArrayList<>();
        switch (family) {
            case "segment" -> {
                out.add("clusters[].centroid: promedio de cada variable dentro del grupo, en sus unidades originales.");
                out.add("clusters[].profile: diferencia del grupo frente a la media global en desviaciones estándar (z): +1 = una desviación por encima, −1 = una por debajo. No son 'veces el promedio'.");
                out.add("clusters[].share: proporción de registros del grupo (0 a 1).");
                out.add("silhouette: de −1 a 1; ≥ 0.5 grupos bien separados, 0.25–0.5 estructura razonable, < 0.25 débil.");
            }
            case "regression" -> {
                out.add("r2: proporción de la variación del objetivo que explica el modelo (0 a 1), medida en datos de prueba si existen.");
                out.add("rmse y mae: error típico y error absoluto medio, en las unidades del objetivo.");
                out.add("Columna Error = valor real − valor estimado.");
            }
            case "classification" -> {
                out.add("auc: capacidad de separar las clases; 0.5 = azar, 1 = perfecto.");
                out.add("accuracy frente a baseline: exactitud del modelo vs. responder siempre la clase mayoritaria.");
                out.add("Columna Probabilidad = probabilidad de la clase positiva; Clase predicha usa el umbral 0.5.");
            }
            case "anomaly" -> out.add("Puntaje atípico = mayor |z| entre las variables marcadas; un registro es atípico si supera el umbral z o sale del rango intercuartil.");
            default -> { }
        }
        return out;
    }

    static String slug(String s) {
        String t = Normalizer.normalize(s == null ? "" : s, Normalizer.Form.NFD).replaceAll("\\p{M}", "");
        t = t.replaceAll("[^A-Za-z0-9]+", "_").replaceAll("^_+|_+$", "").toLowerCase(Locale.ROOT);
        return t.isEmpty() ? "x" : t;
    }

    private static String s(Object o) { return o == null ? null : String.valueOf(o); }

    private static List<String> strList(Object o) {
        List<String> out = new ArrayList<>();
        if (o instanceof List<?> l) for (Object e : l) if (e != null) out.add(String.valueOf(e));
        return out;
    }

    /** Resultado sin claves internas ni listas pesadas, para el contexto del agente analista. */
    @SuppressWarnings("unchecked")
    static Map<String, Object> compact(Map<String, Object> r) {
        Set<String> drop = Set.of("projection", "scatter", "roc", "sample", "kdistance", "histogram", "pearson", "spearman",
                "items", "elbow", "heights", "anomalies");
        Map<String, Object> out = new LinkedHashMap<>();
        for (var e : r.entrySet()) {
            String k = e.getKey();
            if (k.startsWith("__") || drop.contains(k)) continue;
            Object v = e.getValue();
            if (v instanceof List<?> l && l.size() > 15) v = new ArrayList<>(l.subList(0, 15));
            if (v instanceof Map<?, ?> m && "best".equals(k)) v = compact((Map<String, Object>) m);
            out.put(k, v);
        }
        return out;
    }

    /* ============================ Objetos de hoja ============================ */

    private static Map<String, Object> d(String table, String field) {
        return new LinkedHashMap<>(Map.of("id", Ids.newId(), "source", "field", "table", table, "field", field));
    }

    private static Map<String, Object> m(String table, String field, String agg) {
        return new LinkedHashMap<>(Map.of("id", Ids.newId(), "source", "field", "table", table, "field", field, "agg", agg));
    }

    private static Map<String, Object> text(String txt) {
        Map<String, Object> props = new LinkedHashMap<>();
        props.put("title", "");
        props.put("text", txt);
        props.put("dims", List.of());
        props.put("measures", List.of());
        return obj("text", props);
    }

    private static Map<String, Object> kpi(String title, Map<String, Object> measure) {
        Map<String, Object> props = new LinkedHashMap<>();
        props.put("title", title);
        props.put("dims", List.of());
        props.put("measures", List.of(measure));
        return obj("kpi", props);
    }

    private static Map<String, Object> chart(String type, String title, Map<String, Object> dim, List<Map<String, Object>> measures) {
        Map<String, Object> props = new LinkedHashMap<>();
        props.put("title", title);
        props.put("dims", List.of(dim));
        props.put("measures", measures);
        if ("pie".equals(type)) props.put("look", Map.of("donut", true, "valueLabels", true));
        if ("line".equals(type)) props.put("look", Map.of("points", true));
        return obj(type, props);
    }

    private static Map<String, Object> obj(String type, Map<String, Object> props) {
        Map<String, Object> o = new LinkedHashMap<>();
        o.put("id", Ids.newId());
        o.put("type", type);
        o.put("props", props);
        return o;
    }

    /** Rejilla de 24 columnas: coloca objetos de izquierda a derecha y salta de fila al llenarse. */
    private static final class Layout {
        final List<Map<String, Object>> objects = new ArrayList<>();
        int x = 0, y = 0, rowH = 0;

        void add(Map<String, Object> o, int w, int h) {
            if (x + w > 24) newRow();
            o.put("x", x); o.put("y", y); o.put("w", w); o.put("h", h);
            objects.add(o);
            x += w;
            rowH = Math.max(rowH, h);
        }

        void newRow() {
            if (x == 0) return;
            y += rowH; x = 0; rowH = 0;
        }
    }
}
