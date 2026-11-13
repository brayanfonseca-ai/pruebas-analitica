package io.datasense.ask;

import io.datasense.engine.DataFrame;
import io.datasense.engine.EffectiveFields;
import io.datasense.engine.Expressions;
import io.datasense.engine.TableStore;
import io.datasense.model.AppModels.FieldRef;
import io.datasense.model.AppModels.MeasureSpec;
import io.datasense.model.AppModels.QueryResult;
import io.datasense.model.AppModels.QuerySpec;
import io.datasense.repo.FieldOverrideRepository;
import io.datasense.repo.MasterItemRepository;
import io.datasense.repo.TableRepository;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.text.Normalizer;
import java.text.NumberFormat;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * <b>Pregúntale a tus datos</b>: convierte una pregunta en español («% de inactivos por empresa», «top 5 sucursales
 * por cantidad de servicios», «¿cuántos conductores hay en 2025?») en una consulta del motor, la ejecuta y devuelve
 * la respuesta <b>y cómo se calculó</b> (medida, agrupación, filtros, orden, tabla, filas consideradas y la consulta).
 *
 * <p>Es un intérprete determinista (sin IA, sin costo por pregunta y siempre explicable): reconoce los elementos
 * maestros (las métricas certificadas primero), los campos por su nombre, su nombre visible y los sinónimos de las
 * <i>Notas para agente</i>, los valores de los campos como filtros, palabras de agregación (cuántos, total, promedio,
 * máximo, mínimo, distintos, %), la agrupación («por …», «según …», «evolución…») y «top N».</p>
 */
@Service
public class AskService {

    private final TableRepository tables;
    private final TableStore store;
    private final FieldOverrideRepository overrides;
    private final MasterItemRepository masters;
    private final JdbcTemplate jdbc;

    public AskService(TableRepository tables, TableStore store, FieldOverrideRepository overrides,
                      MasterItemRepository masters, JdbcTemplate jdbc) {
        this.tables = tables;
        this.store = store;
        this.overrides = overrides;
        this.masters = masters;
        this.jdbc = jdbc;
    }

    /* =============================== Modelo =============================== */

    /** Un campo de una tabla tal como lo entiende el intérprete. */
    static final class Field {
        String table, name, display, type, semantic = "";
        int distinct;
        boolean idLike, timeLike;
        List<List<String>> aliases = new ArrayList<>();   // cada alias = tokens normalizados
        List<String> weak = new ArrayList<>();            // palabras sueltas distintivas del nombre («edad» → EDAD EN AÑOS)
        List<String> values = List.of();                  // valores distintos (si es categórico)
    }

    /** Todo lo necesario para interpretar preguntas sobre una app. */
    static final class Model {
        Map<String, DataFrame> frames = new LinkedHashMap<>();
        List<Field> fields = new ArrayList<>();
        List<Map<String, Object>> measures = new ArrayList<>();   // elementos maestros de medida
        Map<String, List<String>> fieldIndex = new LinkedHashMap<>();
        Map<String, Map<String, String>> types = new HashMap<>(), displays = new HashMap<>();
        String mainTable;
    }

    /** Modelo en caché por app (se invalida si cambian tablas, maestros o notas; y a los 5 minutos). */
    private final Map<String, Object[]> cache = new java.util.concurrent.ConcurrentHashMap<>();

    private String signature(String appId) {
        StringBuilder sb = new StringBuilder();
        for (Map<String, Object> t : tables.listTables(appId)) sb.append(t.get("id")).append(t.get("created_at")).append(';');
        for (Map<String, Object> it : masters.list(appId, null)) sb.append(it.get("id")).append(it.get("updated_at")).append(it.get("certified")).append(';');
        try {
            sb.append(jdbc.queryForObject("SELECT COUNT(*) || MAX(updated_at) FROM column_notes WHERE app_id = ?", String.class, appId));
            sb.append(jdbc.queryForObject("SELECT COUNT(*) FROM field_overrides WHERE app_id = ?", String.class, appId));
        } catch (RuntimeException ignored) {}
        return sb.toString();
    }

    Model model(String appId) {
        String sig = signature(appId);
        Object[] c = cache.get(appId);
        if (c != null && sig.equals(c[0]) && System.currentTimeMillis() - (Long) c[2] < 300_000) return (Model) c[1];
        Model m = load(appId);
        cache.put(appId, new Object[]{sig, m, System.currentTimeMillis()});
        return m;
    }

    private static final Set<String> GENERIC = Set.of("fecha", "codigo", "cod", "valor", "total", "cantidad", "numero", "nombre", "tipo",
            "estado", "id", "anio", "ano", "mes", "dia", "meses", "anos", "linea", "cuenta");

    /** Palabras sueltas del nombre que solo tiene un campo: sirven para entender «edad» o «antigüedad». */
    private static void weakAliases(Model m) {
        Map<String, Set<String>> owners = new HashMap<>();
        for (Field f : m.fields) for (String w : toks(f.name)) owners.computeIfAbsent(w, k -> new HashSet<>()).add(norm(f.name));
        for (Field f : m.fields) {
            List<String> ws = toks(f.name);
            if (ws.size() < 2) continue;
            for (String w : ws) if (w.length() >= 4 && !STOP.contains(w) && !GENERIC.contains(w) && !w.matches("\\d+") && owners.get(w).size() == 1) f.weak.add(w);
        }
    }

    private QueryResult run(Model m, QuerySpec spec) {
        return io.datasense.engine.QueryEngine.run(m.frames, spec, m.types, m.displays);
    }

    private static final Set<String> STOP = Set.of("de", "del", "la", "el", "los", "las", "en", "y", "a", "al", "por", "con", "un", "una");
    private static final Pattern ID_NAME = Pattern.compile("(^| )(id|cedula|documento|codigo|cod|nit|placa|placas|identificacion|dni|consecutivo)( |$)");
    private static final Pattern TIME_NAME = Pattern.compile("^(anio|ano|year|mes|month|periodo|fecha.*|dia|semana|trimestre|quarter|.*periodo.*)$");

    Model load(String appId) {
        Model m = new Model();
        Map<String, String[]> notes = new HashMap<>();   // tabla\u0001columna -> {synonyms, semantic}
        try {
            jdbc.query("SELECT table_name, column_name, synonyms, semantic FROM column_notes WHERE app_id = ?", rs -> {
                notes.put(rs.getString("table_name") + "\u0001" + rs.getString("column_name"),
                        new String[]{rs.getString("synonyms"), rs.getString("semantic")});
            }, appId);
        } catch (RuntimeException ignored) { /* sin notas */ }

        List<Map<String, Object>> calc = new ArrayList<>();
        for (Map<String, Object> it : masters.list(appId, null)) {
            if ("measure".equals(it.get("kind"))) m.measures.add(it);
            else if (it.get("resolved") instanceof Map<?, ?> r && r.get("expr") != null && r.get("table") != null)
                calc.add(Map.of("table", String.valueOf(r.get("table")), "field", String.valueOf(r.get("field")), "expr", String.valueOf(r.get("expr"))));
        }
        int maxRows = -1;
        for (Map<String, Object> row : tables.listTables(appId)) {
            String tname = (String) row.get("name");
            String tid = (String) row.get("id");
            DataFrame df = store.load(appId, tid);
            for (Map<String, Object> c : calc) {
                if (!tname.equals(c.get("table"))) continue;
                try { df = Expressions.withCalculated(df, (String) c.get("field"), (String) c.get("expr")); } catch (RuntimeException ignored) {}
            }
            m.frames.put(tname, df);
            if (df.rowCount() > maxRows) { maxRows = df.rowCount(); m.mainTable = tname; }
            Map<String, EffectiveFields.Field> eff = new HashMap<>();
            Map<String, String> ty = new HashMap<>(), di = new HashMap<>();
            for (EffectiveFields.Field f : EffectiveFields.resolve(tname, df, overrides.list(appId, tid))) {
                eff.put(f.sourceField(), f);
                ty.put(f.sourceField(), f.type());
                di.put(f.sourceField(), f.display());
            }
            m.types.put(tname, ty);
            m.displays.put(tname, di);
            for (String col : df.columns()) {
                EffectiveFields.Field ef = eff.get(col);
                if (ef != null && ef.hidden()) continue;
                Field f = new Field();
                f.table = tname; f.name = col;
                f.display = ef != null && ef.display() != null ? ef.display() : col;
                f.type = ef != null && ef.type() != null ? ef.type() : df.typeOf(col);
                String[] nt = notes.get(tname + "\u0001" + col);
                if (nt != null && nt[1] != null) f.semantic = nt[1];
                List<String> vals = df.columnValues(col);
                LinkedHashSet<String> distinct = new LinkedHashSet<>();
                for (String v : vals) if (v != null && !v.isBlank()) { distinct.add(v.strip()); if (distinct.size() > 2000) break; }
                f.distinct = distinct.size();
                String nn = norm(col);
                f.timeLike = "date".equals(f.type) || TIME_NAME.matcher(nn).matches() || TIME_NAME.matcher(norm(f.display)).matches();
                f.idLike = "id".equals(f.semantic) || ID_NAME.matcher(nn).find()
                        || ("text".equals(f.type) && df.rowCount() > 50 && f.distinct > df.rowCount() * 0.9);
                addAlias(f, col);
                if (!f.display.equals(col)) addAlias(f, f.display);
                if (nt != null && nt[0] != null) for (String s : nt[0].split("[,;|\\n]")) addAlias(f, s);
                if (nn.matches("anio|ano|year")) { addAlias(f, "año"); addAlias(f, "anio"); addAlias(f, "anual"); }
                if (nn.matches("mes|month")) { addAlias(f, "mes"); addAlias(f, "mensual"); }
                if (("text".equals(f.type) || f.timeLike) && f.distinct <= 1000 && !f.idLike) f.values = new ArrayList<>(distinct);
                m.fields.add(f);
                m.fieldIndex.computeIfAbsent(col, k -> new ArrayList<>()).add(tname);
            }
        }
        weakAliases(m);
        return m;
    }

    private static void addAlias(Field f, String text) {
        List<String> t = toks(text);
        if (!t.isEmpty() && !f.aliases.contains(t)) f.aliases.add(t);
    }

    /* =============================== Interpretación =============================== */

    /** Lo que se entendió de la pregunta. */
    static final class Plan {
        Map<String, Object> master;       // medida maestra
        String measureExpr, measureLabel, measureSource;   // fx de la medida y de dónde sale
        String measureTable;
        Field dim;
        String dimMatched;
        Map<Field, List<String>> filters = new LinkedHashMap<>();
        Map<Field, String> filterMatched = new LinkedHashMap<>();
        Integer top;
        boolean asc;
        List<String> notes = new ArrayList<>();
        String chart = "kpi";
    }

    static String norm(String s) {
        if (s == null) return "";
        String n = Normalizer.normalize(s.toLowerCase(Locale.ROOT), Normalizer.Form.NFD).replaceAll("\\p{M}", "");
        return n.replace("%", " % ").replaceAll("[^a-z0-9%]+", " ").trim().replaceAll(" +", " ");
    }

    static List<String> toks(String s) {
        String n = norm(s);
        return n.isEmpty() ? List.of() : Arrays.asList(n.split(" "));
    }

    private static boolean tokEq(String t, String a) {
        if (t.equals(a)) return true;
        if (a.length() < 3 || t.length() < 3) return false;
        return t.equals(a + "s") || t.equals(a + "es") || a.equals(t + "s") || a.equals(t + "es");
    }

    /** Busca la secuencia {@code alias} en {@code q} (tokens no usados), permitiendo un conector entre palabras. */
    private static int[] find(List<String> q, boolean[] used, List<String> alias, int from) {
        if (alias.isEmpty()) return null;
        for (int i = Math.max(0, from); i < q.size(); i++) {
            if (used[i] || !tokEq(q.get(i), alias.get(0))) continue;
            int j = i + 1, k = 1;
            while (k < alias.size() && j < q.size()) {
                if (used[j]) break;
                if (tokEq(q.get(j), alias.get(k))) { k++; j++; continue; }
                if (STOP.contains(q.get(j)) && j + 1 < q.size() && tokEq(q.get(j + 1), alias.get(k))) { j++; continue; }
                break;
            }
            if (k == alias.size()) return new int[]{i, j};
        }
        return null;
    }

    private static void mark(boolean[] used, int[] span) { for (int i = span[0]; i < span[1]; i++) used[i] = true; }

    private static boolean has(List<String> q, String... words) {
        for (String w : words) {
            List<String> wt = Arrays.asList(w.split(" "));
            for (int i = 0; i + wt.size() <= q.size(); i++) {
                boolean ok = true;
                for (int k = 0; k < wt.size(); k++) if (!q.get(i + k).equals(wt.get(k))) { ok = false; break; }
                if (ok) return true;
            }
        }
        return false;
    }

    private static final Pattern TOP1 = Pattern.compile("\\b(top|primer[oa]s|mayores|mejores|principales|menores|peores|ultim[oa]s)\\s+(\\d{1,3})\\b");
    private static final Pattern TOP3 = Pattern.compile("\\b(los|las)\\s+(\\d{1,3})\\b(?!\\s*%)");
    private static final Pattern TOP2 = Pattern.compile("\\b(\\d{1,3})\\s+(mayores|primer[oa]s|mejores|principales|menores|peores|ultim[oa]s)\\b");

    Plan interpret(Model m, String question) {
        List<String> q = new ArrayList<>(toks(question));
        boolean[] used = new boolean[q.size()];
        Plan p = new Plan();
        String nq = String.join(" ", q);

        // --- Top N ---
        Matcher t1 = TOP1.matcher(nq), t2 = TOP2.matcher(nq);
        String topWord = null, topNum = null;
        if (t1.find()) { topWord = t1.group(1); topNum = t1.group(2); }
        else if (t2.find()) { topWord = t2.group(2); topNum = t2.group(1); }
        else { Matcher t3 = TOP3.matcher(nq); if (t3.find()) { topWord = t3.group(1); topNum = t3.group(2); } }
        int afterTop = -1;
        if (topNum != null) {
            p.top = Math.max(1, Math.min(100, Integer.parseInt(topNum)));
            p.asc = topWord.startsWith("menor") || topWord.startsWith("peor") || topWord.startsWith("ultim")
                    || has(q, "menor", "menores", "menos", "peor", "peores", "mas bajo", "mas bajos");
            for (int i = 0; i < q.size(); i++) if (q.get(i).equals(topNum) || q.get(i).equals(topWord)) { used[i] = true; afterTop = Math.max(afterTop, i + 1); }
        } else if (has(q, "menor", "menos", "peor", "mas bajo", "mas bajos")) p.asc = true;

        // --- Medida maestra (certificadas primero, nombres más largos primero) ---
        List<Map<String, Object>> ms = new ArrayList<>(m.measures);
        ms.sort((a, b) -> {
            int c = Boolean.compare(Boolean.TRUE.equals(b.get("certified")), Boolean.TRUE.equals(a.get("certified")));
            return c != 0 ? c : Integer.compare(toks(String.valueOf(b.get("name"))).size(), toks(String.valueOf(a.get("name"))).size());
        });
        for (Map<String, Object> it : ms) {
            List<String> nt = new ArrayList<>(toks(String.valueOf(it.get("name"))));
            nt.removeIf("%"::equals);
            if (nt.isEmpty()) continue;
            int[] sp = find(q, used, nt, 0);
            if (sp != null) {
                // "%" justo antes del nombre forma parte de él
                if (sp[0] > 0 && q.get(sp[0] - 1).equals("%")) sp = new int[]{sp[0] - 1, sp[1]};
                mark(used, sp);
                p.master = it;
                break;
            }
        }

        // --- «Top 5 sucursales por …»: lo que sigue al top es la agrupación; lo que sigue a «por», la medida ---
        if (afterTop >= 0) {
            int from = afterTop;
            while (from < q.size() && STOP.contains(q.get(from))) from++;
            Field best = null; int[] bestSp = null;
            for (Field f : m.fields) {
                if ("number".equals(f.type) && !f.timeLike) continue;
                int[] sp = match(f, q, used, from, true);
                if (sp != null && (bestSp == null || sp[2] > bestSp[2] || (sp[2] == bestSp[2] && preferTable(m, null, f, best)))) { best = f; bestSp = sp; }
            }
            if (best != null) {
                p.dim = best; p.dimMatched = String.join(" ", q.subList(bestSp[0], bestSp[1])); mark(used, bestSp);
                // el «por» que sigue introduce la medida, no otra agrupación
                if (bestSp[1] < q.size() && q.get(bestSp[1]).equals("por")) used[bestSp[1]] = true;
            }
        }

        // --- Agrupación: «por X», «según X», «para cada X», «de cada X»; o evolución en el tiempo ---
        for (int i = 0; i < q.size() && p.dim == null; i++) {
            String w = q.get(i);
            boolean marker = w.equals("por") || w.equals("segun") || (w.equals("cada") && i > 0);
            if (!marker || used[i]) continue;
            int from = i + 1;
            if (from < q.size() && q.get(from).equals("cada")) from++;
            while (from < q.size() && STOP.contains(q.get(from))) from++;
            Field best = null; int[] bestSp = null;
            for (Field f : m.fields) {
                int[] sp = match(f, q, used, from, true);
                if (sp != null && (bestSp == null || sp[2] > bestSp[2] || (sp[2] == bestSp[2] && preferTable(m, null, f, best)))) { best = f; bestSp = sp; }
            }
            if (best != null) { p.dim = best; p.dimMatched = String.join(" ", q.subList(bestSp[0], bestSp[1])); used[i] = true; mark(used, bestSp); }
        }
        boolean wantsTime = has(q, "evolucion", "tendencia", "historico", "en el tiempo", "a lo largo", "mes a mes", "ano a ano", "mensual", "anual");
        if (p.dim == null && wantsTime) {
            p.dim = bestTimeField(m, has(q, "anual", "ano a ano") ? "year" : has(q, "mensual", "mes a mes") ? "month" : null);
            if (p.dim != null) p.dimMatched = "evolución en el tiempo";
        }

        // --- Filtros por valor: «inactivos», «2025», «Bogotá»… (el más largo primero; menos valores distintos gana) ---
        List<Object[]> cands = new ArrayList<>();   // {Field, value, span}
        for (Field f : m.fields) {
            if (f.values.isEmpty() || f == p.dim) continue;
            for (String v : f.values) {
                List<String> vt = toks(v);
                if (vt.isEmpty()) continue;
                String joined = String.join(" ", vt);
                boolean numeric = joined.matches("\\d+");
                if (numeric ? !(f.timeLike && joined.length() == 4) : joined.length() < 3) continue;
                if (vt.size() == 1 && STOP.contains(joined)) continue;
                int[] sp = find(q, used, vt, 0);
                if (sp != null) cands.add(new Object[]{f, v, sp});
            }
        }
        cands.sort((a, b) -> {
            int la = ((int[]) a[2])[1] - ((int[]) a[2])[0], lb = ((int[]) b[2])[1] - ((int[]) b[2])[0];
            if (la != lb) return Integer.compare(lb, la);
            // misma tabla que la agrupación / la principal antes que otra tabla con un campo homónimo
            String pref = p.dim != null ? p.dim.table : m.mainTable;
            int ta = ((Field) a[0]).table.equals(pref) ? 0 : 1, tb = ((Field) b[0]).table.equals(pref) ? 0 : 1;
            if (ta != tb) return Integer.compare(ta, tb);
            return Integer.compare(((Field) a[0]).distinct, ((Field) b[0]).distinct);
        });
        for (Object[] c : cands) {
            int[] sp = (int[]) c[2];
            boolean free = true;
            for (int i = sp[0]; i < sp[1]; i++) if (used[i]) { free = false; break; }
            if (!free) continue;
            Field f = (Field) c[0];
            // un mismo campo puede repetirse en otra tabla: quedarse con uno
            Field same = p.filters.keySet().stream().filter(x -> x.name.equals(f.name)).findFirst().orElse(null);
            Field key = same != null ? same : f;
            p.filters.computeIfAbsent(key, k -> new ArrayList<>()).add((String) c[1]);
            p.filterMatched.merge(key, String.join(" ", q.subList(sp[0], sp[1])), (x, y) -> x + ", " + y);
            mark(used, sp);
        }

        // --- Palabras de agregación ---
        boolean pct = q.contains("%") || has(q, "porcentaje", "proporcion", "tasa", "participacion");
        String agg = has(q, "promedio", "media", "promedia") ? "avg"
                : has(q, "maximo", "maxima", "mas alto", "mas alta") ? "max"
                : has(q, "minimo", "minima") ? "min"
                : has(q, "total", "suma", "sumatoria", "acumulado", "sumar") ? "sum"
                : has(q, "cuantos", "cuantas", "cantidad de", "numero de", "conteo", "cuenta", "contar") ? "count" : null;
        boolean distinct = has(q, "distintos", "distintas", "unicos", "unicas", "diferentes");

        if (p.master != null) {
            p.measureLabel = String.valueOf(p.master.get("name"));
            p.measureExpr = String.valueOf(p.master.get("expression"));
            p.measureSource = Boolean.TRUE.equals(p.master.get("certified")) ? "certified" : "master";
            Object r = p.master.get("resolved");
            p.measureTable = r instanceof Map<?, ?> rm && rm.get("table") != null ? String.valueOf(rm.get("table")) : m.mainTable;
        } else {
            // Campo numérico mencionado (no usado aún)
            String dimTable = p.dim != null ? p.dim.table : null;
            Field num = null; int[] numSp = null;
            for (Field f : m.fields) {
                if (!"number".equals(f.type) || f.idLike) continue;
                int[] sp = match(f, q, used, 0, false);
                if (sp != null && (numSp == null || sp[2] > numSp[2] || (sp[2] == numSp[2] && preferTable(m, dimTable, f, num)))) { num = f; numSp = sp; }
            }
            // Entidad contada: un campo cualquiera («cédulas», «placas») o una palabra de personas/registros
            Field counted = null; int[] cSp = null;
            if (num == null) {
                for (Field f : m.fields) {
                    if ("number".equals(f.type) && !f.idLike) continue;
                    int[] sp = match(f, q, used, 0, false);
                    if (sp != null && (cSp == null || sp[2] > cSp[2] || (sp[2] == cSp[2] && preferTable(m, dimTable, f, counted)))) { counted = f; cSp = sp; }
                }
            }
            boolean people = has(q, "personas", "persona", "conductores", "conductor", "empleados", "empleado", "clientes", "cliente",
                    "usuarios", "usuario", "trabajadores", "colaboradores");
            Field condField = pct && !p.filters.isEmpty() ? p.filters.keySet().iterator().next() : null;
            String table = num != null ? num.table : counted != null ? counted.table
                    : condField != null ? condField.table : p.dim != null ? p.dim.table : m.mainTable;
            p.measureTable = table;

            if (pct && condField != null) {
                // % de filas que cumplen la condición (dentro de cada grupo)
                List<String> vals = p.filters.remove(condField);
                String matched = p.filterMatched.remove(condField);
                String fieldRef = "[" + condField.name + "]";
                String cond = String.join(" OR ", vals.stream().map(v -> fieldRef + " = '" + v.replace("'", "''") + "'").toList());
                p.measureExpr = "Round(Sum(If(" + cond + ", 1, 0)) / Count(" + fieldRef + ") * 100, 2)";
                p.measureLabel = "% " + String.join(", ", vals);
                p.measureSource = "auto";
                p.notes.add("Calculé el porcentaje de registros con " + condField.display + " = " + String.join(" o ", vals)
                        + " (encontré «" + matched + "» en la pregunta).");
                p.measureTable = condField.table;
            } else if (num != null) {
                // «cuántos servicios» sobre un campo numérico = sumarlo (contar filas sería otra pregunta)
                String a = distinct ? "count" : agg == null || "count".equals(agg) ? (nonAdditive(num) && agg == null ? "avg" : "sum") : agg;
                if (agg == null && "avg".equals(a)) p.notes.add("Promedié " + num.display + " porque sumarlo no tiene sentido (pide «total de …» si lo quieres sumado).");
                p.measureExpr = (distinct ? "Count(DISTINCT [" : cap(a) + "([") + num.name + "])";
                p.measureLabel = labelFor(a, distinct, num.display);
                p.measureSource = "field";
            } else if (counted != null && (agg != null || distinct || counted.idLike)) {
                boolean d = distinct || counted.idLike;
                p.measureExpr = d ? "Count(DISTINCT [" + counted.name + "])" : "Count([" + counted.name + "])";
                p.measureLabel = d ? cap(counted.display) + " distintos" : "Registros con " + counted.display;
                p.measureSource = "field";
                if (counted.idLike && !distinct) p.notes.add("Conté valores distintos de " + counted.display + " porque identifica a cada registro.");
            } else if (people && idField(m, table) != null) {
                Field idf = idField(m, table);
                p.measureExpr = "Count(DISTINCT [" + idf.name + "])";
                String who = q.stream().filter(w -> w.matches("personas|conductores|empleados|clientes|usuarios|trabajadores|colaboradores")).findFirst().orElse("registros");
                p.measureLabel = cap(who);
                p.measureSource = "auto";
                p.notes.add("Conté " + who + " como valores distintos de " + idf.display + ".");
            } else if (agg != null || p.dim != null || !p.filters.isEmpty()) {
                DataFrame df = m.frames.get(table);
                String first = df == null || df.columns().isEmpty() ? null : df.columns().get(0);
                if (first == null) return null;
                p.measureExpr = "Count([" + first + "])";
                p.measureLabel = "Registros";
                p.measureSource = "rows";
            } else {
                return null;
            }
        }
        // Agrupación y filtros en la tabla de la medida cuando allí existe un campo homónimo (Anio ↔ ANIO, cedula ↔ CEDULA)
        if (p.dim != null) {
            Field same = sameIn(m, p.dim, p.measureTable);
            if (same != null) p.dim = same;
            p.chart = p.dim.timeLike ? "line" : "bar";
        }
        Map<Field, List<String>> nf = new LinkedHashMap<>();
        Map<Field, String> nm = new LinkedHashMap<>();
        p.filters.forEach((f, vals) -> {
            Field g = sameIn(m, f, p.measureTable);
            if (g == null || g == f) { nf.merge(f, vals, (a, b) -> { a.addAll(b); return a; }); nm.put(f, p.filterMatched.get(f)); return; }
            List<String> mapped = new ArrayList<>();
            for (String v : vals) {
                String nv = norm(v);
                g.values.stream().filter(x -> norm(x).equals(nv)).findFirst().ifPresentOrElse(mapped::add, () -> mapped.add(v));
            }
            nf.merge(g, mapped, (a, b) -> { a.addAll(b); return a; });
            nm.put(g, p.filterMatched.get(f));
        });
        p.filters = nf;
        p.filterMatched = nm;
        return p;
    }

    /** Ante empates: el campo de la tabla de la agrupación y si no, de la tabla principal (la más grande). */
    private static boolean preferTable(Model m, String dimTable, Field f, Field cur) {
        if (cur == null) return true;
        String pref = dimTable != null ? dimTable : m.mainTable;
        return f.table.equals(pref) && !cur.table.equals(pref);
    }

    /**
     * Mejor coincidencia de un campo en la pregunta: {inicio, fin, puntaje}. Un alias completo vale 2 por palabra;
     * una palabra suelta distintiva del nombre («edad»), 1. {@code atStart}: debe empezar justo en {@code from}.
     */
    private static int[] match(Field f, List<String> q, boolean[] used, int from, boolean atStart) {
        int[] best = null;
        for (List<String> al : f.aliases) {
            int[] sp = find(q, used, al, from);
            if (sp == null || (atStart && sp[0] != from)) continue;
            int sc = (sp[1] - sp[0]) * 2;
            if (best == null || sc > best[2]) best = new int[]{sp[0], sp[1], sc};
        }
        for (String w : f.weak) {
            int[] sp = find(q, used, List.of(w), from);
            if (sp == null || (atStart && sp[0] != from)) continue;
            if (best == null) best = new int[]{sp[0], sp[1], 1};
        }
        return best;
    }

    /** Campos que no tiene sentido sumar (edad, antigüedad, probabilidad, %…): por defecto se promedian. */
    private static final Pattern NON_ADDITIVE = Pattern.compile("(^| )(edad|antiguedad|probabilidad|porcentaje|tasa|ratio|score|puntaje|precio|temperatura|promedio|indice|calificacion|nota|rating)( |$)|%");

    static boolean nonAdditive(Field f) { return NON_ADDITIVE.matcher(norm(f.name) + " " + norm(f.display)).find(); }

    /** El campo con el mismo nombre (sin mayúsculas ni tildes) en {@code table}; null si no hay. */
    private static Field sameIn(Model m, Field f, String table) {
        if (table == null || f.table.equals(table)) return f;
        String n = norm(f.name);
        for (Field g : m.fields) if (g.table.equals(table) && norm(g.name).equals(n)) return g;
        return null;
    }

    private static Field bestTimeField(Model m, String grain) {
        Field best = null; int score = -1;
        for (Field f : m.fields) {
            if (!f.timeLike || f.distinct < 2 || f.distinct > 400) continue;
            String n = norm(f.name);
            int s = (f.table.equals(m.mainTable) ? 10 : 0)
                    + ("year".equals(grain) ? (n.matches("anio|ano|year") ? 50 : 0)
                    : "month".equals(grain) ? (n.contains("periodo") ? 50 : n.matches("mes|month") ? 30 : 0)
                    : n.contains("periodo") ? 40 : "date".equals(f.type) ? 20 : n.matches("anio|ano|year") ? 15 : 5);
            if (s > score) { score = s; best = f; }
        }
        return best;
    }

    private static Field idField(Model m, String table) {
        for (Field f : m.fields) if (f.table.equals(table) && f.idLike) return f;
        return null;
    }

    private static String cap(String s) { return s == null || s.isEmpty() ? s : Character.toUpperCase(s.charAt(0)) + s.substring(1); }

    private static String labelFor(String agg, boolean distinct, String field) {
        if (distinct) return field + " distintos";
        return switch (agg) {
            case "avg" -> "Promedio de " + field;
            case "max" -> "Máximo de " + field;
            case "min" -> "Mínimo de " + field;
            case "count" -> "Registros con " + field;
            default -> "Total de " + field;
        };
    }

    /* =============================== Ejecución =============================== */

    /** Pregunta → respuesta explicada. Nunca lanza: si no entiende, {ok:false, message, suggestions}. */
    public Map<String, Object> ask(String appId, String question) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("question", question);
        if (question == null || question.isBlank()) return fail(out, "Escribe una pregunta.", appId, null);
        if (question.length() > 400) return fail(out, "La pregunta es muy larga (máximo 400 caracteres).", appId, null);
        Model m = model(appId);
        if (m.frames.isEmpty()) return fail(out, "Esta aplicación aún no tiene datos cargados.", appId, m);
        Plan p = interpret(m, question);
        if (p == null) return fail(out, "No encontré en la pregunta una medida, un campo ni un valor de esta aplicación.", appId, m);

        // Medida -> spec del motor (validada por el compilador de expresiones)
        MeasureSpec ms;
        Map<String, Object> resolved;
        try {
            if (p.master != null && p.master.get("resolved") instanceof Map<?, ?> r) {
                @SuppressWarnings("unchecked") Map<String, Object> rr = (Map<String, Object>) r;
                resolved = rr;
            } else {
                resolved = Expressions.compile("measure", p.measureExpr, m.fieldIndex);
                // la tabla de la medida es la elegida (un campo puede estar en varias)
                if (p.measureTable != null && m.fieldIndex.getOrDefault(String.valueOf(resolved.get("field")), List.of()).contains(p.measureTable))
                    resolved.put("table", p.measureTable);
            }
        } catch (RuntimeException e) {
            return fail(out, "No pude armar la medida: " + e.getMessage(), appId, m);
        }
        ms = toSpec(resolved, p.measureLabel);
        Map<String, List<Object>> sel = new LinkedHashMap<>();
        p.filters.forEach((f, vals) -> sel.put(f.name, new ArrayList<>(vals)));
        FieldRef dim = p.dim == null ? null : new FieldRef(p.dim.table, p.dim.name, null);
        QuerySpec spec = new QuerySpec(dim, List.of(ms), p.chart, sel);

        QueryResult r;
        try { r = run(m, spec); }
        catch (RuntimeException e) { return fail(out, "El motor no pudo calcular la respuesta: " + e.getMessage(), appId, m); }

        // filas consideradas (tabla de la medida con los filtros)
        Long rows = null;
        try {
            DataFrame mdf = m.frames.get(ms.table());
            if (mdf != null && !mdf.columns().isEmpty()) {
                QueryResult rc = run(m, new QuerySpec(null, List.of(new MeasureSpec(ms.table(), mdf.columns().get(0), "count", null, null, null)), "kpi", sel));
                rows = rc.value() == null ? null : Math.round(rc.value());
            }
        } catch (RuntimeException ignored) {}

        boolean additive = !ms.composite() && ("sum".equals(ms.agg()) || "count".equals(ms.agg()));
        out.put("ok", true);
        out.put("chart", p.chart);
        Map<String, Object> result = new LinkedHashMap<>();
        if (dim == null) {
            result.put("value", r.value());
            out.put("answer", sentenceKpi(p, r.value(), rows));
        } else {
            List<Object[]> pairs = new ArrayList<>();
            for (int i = 0; i < r.labels().size(); i++) pairs.add(new Object[]{String.valueOf(r.labels().get(i)), r.values().get(i)});
            pairs.removeIf(x -> x[0] == null || "null".equals(x[0]) || String.valueOf(x[0]).isBlank());
            int totalGroups = pairs.size();
            double total = pairs.stream().mapToDouble(x -> x[1] == null ? 0 : (Double) x[1]).sum();
            if (p.dim.timeLike && p.top == null) pairs.sort((a, b) -> naturalCmp((String) a[0], (String) b[0]));
            else pairs.sort((a, b) -> p.asc ? Double.compare((Double) a[1], (Double) b[1]) : Double.compare((Double) b[1], (Double) a[1]));
            Integer cut = p.top != null ? p.top : (!p.dim.timeLike && pairs.size() > 15 ? 15 : null);
            List<Object[]> shown = cut != null && pairs.size() > cut ? pairs.subList(0, cut) : pairs;
            result.put("labels", shown.stream().map(x -> x[0]).toList());
            result.put("values", shown.stream().map(x -> x[1]).toList());
            result.put("groups", totalGroups);
            if (additive) result.put("total", total);
            out.put("answer", sentenceDim(p, pairs, shown.size(), totalGroups, additive ? total : null, rows));
        }
        out.put("result", result);

        // ---- Cómo se calculó ----
        Map<String, Object> how = new LinkedHashMap<>();
        Map<String, Object> mm = new LinkedHashMap<>();
        mm.put("label", p.measureLabel);
        mm.put("expression", p.measureExpr);
        mm.put("source", p.measureSource);
        if (p.master != null) { mm.put("masterId", p.master.get("id")); mm.put("certified", Boolean.TRUE.equals(p.master.get("certified"))); mm.put("certified_by", p.master.get("certified_by")); }
        how.put("measure", mm);
        if (p.dim != null) how.put("dimension", Map.of("field", p.dim.name, "display", p.dim.display, "table", p.dim.table, "matched", p.dimMatched == null ? "" : p.dimMatched));
        List<Map<String, Object>> fl = new ArrayList<>();
        p.filters.forEach((f, vals) -> fl.add(Map.of("field", f.name, "display", f.display, "values", vals, "matched", p.filterMatched.getOrDefault(f, ""))));
        how.put("filters", fl);
        if (dim != null) how.put("order", p.dim.timeLike && p.top == null ? "cronológico" : p.asc ? "menor a mayor" : "mayor a menor");
        if (p.top != null) how.put("top", p.top);
        how.put("table", ms.table());
        if (rows != null) how.put("rows", rows);
        List<String> steps = new ArrayList<>();
        steps.add("Medida: «" + p.measureLabel + "» = " + p.measureExpr + switch (p.measureSource) {
            case "certified" -> " (métrica certificada" + (p.master.get("certified_by") != null ? " por " + p.master.get("certified_by") : "") + ")";
            case "master" -> " (medida maestra)";
            case "rows" -> " (conteo de registros)";
            default -> "";
        });
        if (p.dim != null) steps.add("Agrupado por " + p.dim.display + (p.dimMatched != null && !p.dimMatched.isBlank() ? " (entendí «" + p.dimMatched + "»)" : ""));
        p.filters.forEach((f, vals) -> steps.add("Filtro: " + f.display + " = " + String.join(", ", vals) + " (encontré «" + p.filterMatched.getOrDefault(f, "") + "»)"));
        if (dim != null) steps.add("Orden " + how.get("order") + (p.top != null ? " · top " + p.top : ""));
        steps.add("Tabla " + ms.table() + (rows != null ? " · " + fmt(rows) + " filas consideradas" : ""));
        steps.addAll(p.notes);
        how.put("steps", steps);
        out.put("how", how);
        out.put("query", spec);
        out.put("sheetObject", sheetObject(p, ms, resolved));
        return out;
    }

    private Map<String, Object> fail(Map<String, Object> out, String msg, String appId, Model m) {
        out.put("ok", false);
        out.put("message", msg);
        try { out.put("suggestions", m == null ? List.of() : suggestions(m)); } catch (RuntimeException e) { out.put("suggestions", List.of()); }
        return out;
    }

    @SuppressWarnings("unchecked")
    private static MeasureSpec toSpec(Map<String, Object> r, String label) {
        return new MeasureSpec(String.valueOf(r.get("table")), String.valueOf(r.get("field")),
                r.get("agg") == null ? "sum" : String.valueOf(r.get("agg")), label,
                r.get("formula") == null ? null : String.valueOf(r.get("formula")),
                r.get("parts") instanceof List<?> l ? (List<Map<String, Object>>) l : null);
    }

    /** Objeto de hoja (formato plano) para guardar la respuesta en un tablero. */
    private static Map<String, Object> sheetObject(Plan p, MeasureSpec ms, Map<String, Object> resolved) {
        Map<String, Object> o = new LinkedHashMap<>();
        o.put("type", p.dim == null ? "kpi" : p.chart);
        o.put("title", p.measureLabel + (p.dim != null ? " por " + p.dim.display : ""));
        if (p.dim != null) o.put("dimension", p.dim.name);
        Map<String, Object> meas = new LinkedHashMap<>();
        if (p.master != null) { meas.put("source", "master"); meas.put("masterId", p.master.get("id")); }
        else {
            meas.put("source", "expr"); meas.put("expression", p.measureExpr);
            meas.put("table", ms.table()); meas.put("field", ms.field()); meas.put("agg", ms.agg());
            if (ms.composite()) { meas.put("formula", ms.formula()); meas.put("parts", ms.parts()); }
            meas.put("label", p.measureLabel);
        }
        o.put("measure", meas);
        if (!p.filters.isEmpty()) {
            List<Map<String, Object>> fs = new ArrayList<>();
            p.filters.forEach((f, vals) -> fs.add(Map.of("field", f.name, "values", vals)));
            o.put("props", Map.of("filters", fs));
        }
        return o;
    }

    /* =============================== Redacción =============================== */

    private static final NumberFormat NF = NumberFormat.getNumberInstance(Locale.forLanguageTag("es-CO"));
    static { NF.setMaximumFractionDigits(2); }

    static String fmt(Number n) { return n == null ? "—" : NF.format(n.doubleValue()); }

    private static String filtersText(Plan p) {
        if (p.filters.isEmpty()) return "";
        List<String> parts = new ArrayList<>();
        p.filters.forEach((f, v) -> parts.add(f.display + " = " + String.join(" o ", v)));
        return " (con " + String.join(" y ", parts) + ")";
    }

    private static String suffix(Plan p) { return p.measureLabel.startsWith("%") ? " %" : ""; }

    private static String sentenceKpi(Plan p, Double v, Long rows) {
        return p.measureLabel + filtersText(p) + ": " + fmt(v) + suffix(p) + "."
                + (rows != null && !"rows".equals(p.measureSource) ? " Calculado sobre " + fmt(rows) + " filas." : "");
    }

    private static String sentenceDim(Plan p, List<Object[]> sorted, int shown, int groups, Double total, Long rows) {
        if (sorted.isEmpty()) return "No hay datos de " + p.measureLabel + " por " + p.dim.display + filtersText(p) + ".";
        String s = suffix(p);
        StringBuilder sb = new StringBuilder();
        sb.append(p.measureLabel).append(" por ").append(p.dim.display).append(filtersText(p)).append(": ");
        if (p.dim.timeLike && p.top == null && sorted.size() >= 2) {
            Object[] a = sorted.get(0), b = sorted.get(sorted.size() - 1);
            double va = (Double) a[1], vb = (Double) b[1];
            sb.append("pasa de ").append(fmt(va)).append(s).append(" en ").append(a[0]).append(" a ").append(fmt(vb)).append(s).append(" en ").append(b[0]);
            if (va != 0 && !s.equals(" %")) sb.append(" (").append(vb >= va ? "+" : "").append(fmt((vb - va) / Math.abs(va) * 100)).append(" %)");
            else if (s.equals(" %")) sb.append(" (").append(vb >= va ? "+" : "").append(fmt(vb - va)).append(" puntos)");
            Object[] mx = sorted.stream().max(Comparator.comparingDouble(x -> (Double) x[1])).get();
            sb.append(". El punto más alto es ").append(mx[0]).append(" con ").append(fmt((Double) mx[1])).append(s).append(".");
        } else {
            Object[] first = sorted.get(0);
            sb.append(p.asc ? "el menor es " : "el mayor es ").append(first[0]).append(" con ").append(fmt((Double) first[1])).append(s);
            if (total != null && total != 0) sb.append(" (").append(fmt((Double) first[1] / total * 100)).append(" % del total)");
            if (sorted.size() > 1) {
                Object[] last = sorted.get(Math.min(shown, sorted.size()) - 1);
                if (last != first) sb.append("; ").append(p.top != null ? "el puesto " + shown + " es " : p.asc ? "el mayor mostrado es " : "el menor es ")
                        .append(last[0]).append(" con ").append(fmt((Double) last[1])).append(s);
            }
            sb.append(". ").append(groups).append(groups == 1 ? " valor" : " valores").append(" de ").append(p.dim.display);
            if (shown < groups) sb.append(", se muestran ").append(shown);
            sb.append(".");
            if (total != null) sb.append(" Total: ").append(fmt(total)).append(".");
        }
        return sb.toString();
    }

    private static int naturalCmp(String a, String b) {
        boolean na = a.matches("-?\\d+(\\.\\d+)?"), nb = b.matches("-?\\d+(\\.\\d+)?");
        if (na && nb) return Double.compare(Double.parseDouble(a), Double.parseDouble(b));
        return a.compareTo(b);
    }

    /* =============================== Sugerencias =============================== */

    public List<String> suggestions(String appId) {
        Model m = model(appId);
        return m.frames.isEmpty() ? List.of() : suggestions(m);
    }

    /** Preguntas de ejemplo construidas con el modelo real (solo las que el intérprete entiende). */
    List<String> suggestions(Model m) {
        List<Field> main = m.fields.stream().filter(f -> f.table.equals(m.mainTable)).toList();
        List<Field> dims = main.stream().filter(f -> "text".equals(f.type) && !f.idLike && !f.timeLike && f.distinct >= 2 && f.distinct <= 30)
                .sorted(Comparator.comparingInt(f -> Math.abs(f.distinct - 8))).toList();
        List<Field> nums = main.stream().filter(f -> "number".equals(f.type) && !f.idLike && !f.timeLike && f.distinct > 5).toList();
        Field time = bestTimeField(m, null);
        Field small = main.stream().filter(f -> "text".equals(f.type) && !f.idLike && !f.timeLike && f.distinct >= 2 && f.distinct <= 6)
                .min(Comparator.comparingInt((Field f) -> f.distinct)).orElse(null);
        Field idf = idField(m, m.mainTable);
        List<String> c = new ArrayList<>();
        for (Map<String, Object> it : m.measures) if (Boolean.TRUE.equals(it.get("certified")))
            c.add(it.get("name") + (dims.isEmpty() ? "" : " por " + dims.get(0).display));
        if (small != null && !dims.isEmpty()) {
            Field d = dims.stream().filter(x -> x != small).findFirst().orElse(null);
            String v = small.values.isEmpty() ? null : small.values.get(small.values.size() > 1 ? 1 : 0);
            if (v != null && d != null) c.add("% de " + v + " por " + d.display);
        }
        if (!dims.isEmpty()) c.add(idf != null ? "¿Cuántos " + idf.display + " distintos hay por " + dims.get(0).display + "?" : "¿Cuántos registros hay por " + dims.get(0).display + "?");
        List<Field> add = nums.stream().filter(f -> !nonAdditive(f)).toList();
        List<Field> avg = nums.stream().filter(AskService::nonAdditive).toList();
        if (!add.isEmpty() && dims.size() > 1) c.add("Total de " + add.get(0).display + " por " + dims.get(1).display);
        if (!add.isEmpty() && !dims.isEmpty()) c.add("Top 5 " + dims.get(0).display + " por " + add.get(0).display);
        if (!avg.isEmpty()) c.add("Promedio de " + avg.get(0).display + (dims.size() > 2 ? " por " + dims.get(2).display : ""));
        if (time != null) c.add("Evolución de " + (add.isEmpty() ? "registros" : add.get(0).display) + " por " + time.display);
        for (Map<String, Object> it : m.measures) if (!Boolean.TRUE.equals(it.get("certified")) && c.size() < 9) c.add(String.valueOf(it.get("name")));
        List<String> ok = new ArrayList<>();
        for (String s : c) {
            if (ok.contains(s)) continue;
            try { if (interpret(m, s) != null) ok.add(s); } catch (RuntimeException ignored) {}
            if (ok.size() >= 7) break;
        }
        return ok;
    }
}
