package io.datasense.repo;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;

import io.datasense.engine.DataFrame;
import io.datasense.engine.TableStore;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.*;

/**
 * <b>Notas para el agente</b>: el diccionario de datos de cada aplicación. Por cada tabla y columna se guarda qué
 * significa, de qué tipo semántico es, sinónimos y con qué otras columnas se puede cruzar. El asistente de IA
 * (y el MCP) reciben ese texto como contexto, así saben qué es cada campo antes de analizar o modelar.
 */
@Repository
public class NotesRepository {

    /** Tipos semánticos admitidos (vacío = sin clasificar). */
    public static final List<String> SEMANTICS = List.of("", "id", "dimension", "measure", "date", "category", "text", "flag");

    private static final int MAX_TEXT = 2000;
    private static final int MAX_CONTEXT = 12000;

    private final JdbcTemplate jdbc;
    private final TableRepository tables;
    private final TableStore store;
    private final ObjectMapper mapper = new ObjectMapper();

    public NotesRepository(JdbcTemplate jdbc, TableRepository tables, TableStore store) {
        this.jdbc = jdbc;
        this.tables = tables;
        this.store = store;
    }

    /* ------------------------------ Lectura ------------------------------ */

    /**
     * Estructura completa para la pantalla: texto general, tablas con sus columnas (perfil + notas + muestras +
     * cruces detectados por nombre) y la cobertura de documentación.
     */
    public Map<String, Object> get(String appId) {
        Map<String, Map<String, Object>> tableNotes = new HashMap<>();
        jdbc.query("SELECT table_name, description, grain FROM table_notes WHERE app_id = ?", rs -> {
            Map<String, Object> m = new HashMap<>();
            m.put("description", rs.getString("description"));
            m.put("grain", rs.getString("grain"));
            tableNotes.put(rs.getString("table_name"), m);
        }, appId);
        Map<String, Map<String, Object>> colNotes = new HashMap<>();
        jdbc.query("SELECT table_name, column_name, description, semantic, synonyms, joins_json FROM column_notes WHERE app_id = ?", rs -> {
            Map<String, Object> m = new HashMap<>();
            m.put("description", rs.getString("description"));
            m.put("semantic", rs.getString("semantic"));
            m.put("synonyms", rs.getString("synonyms"));
            m.put("joins", parseJoins(rs.getString("joins_json")));
            colNotes.put(rs.getString("table_name") + "\u0001" + rs.getString("column_name"), m);
        }, appId);

        List<Map<String, Object>> tableRows = this.tables.listTables(appId);
        // columna (minúsculas) -> tablas que la tienen: base de los cruces detectados por nombre.
        Map<String, List<String[]>> byName = new LinkedHashMap<>();
        Map<String, List<Map<String, Object>>> colsOf = new LinkedHashMap<>();
        for (Map<String, Object> t : tableRows) {
            List<Map<String, Object>> cols = this.tables.listColumns((String) t.get("id"));
            colsOf.put((String) t.get("name"), cols);
            for (Map<String, Object> c : cols) {
                byName.computeIfAbsent(String.valueOf(c.get("name")).toLowerCase(), k -> new ArrayList<>())
                        .add(new String[]{(String) t.get("name"), String.valueOf(c.get("name"))});
            }
        }

        int total = 0, documented = 0;
        List<Map<String, Object>> outTables = new ArrayList<>();
        for (Map<String, Object> t : tableRows) {
            String tname = (String) t.get("name");
            DataFrame df = null;
            try { df = store.load(appId, (String) t.get("id")); } catch (Exception ignored) { /* sin datos: solo perfil */ }
            Map<String, Object> tn = tableNotes.getOrDefault(tname, Map.of());
            List<Map<String, Object>> outCols = new ArrayList<>();
            List<Map<String, Object>> cols = colsOf.get(tname);
            for (int ci = 0; ci < cols.size(); ci++) {
                Map<String, Object> c = cols.get(ci);
                String cname = String.valueOf(c.get("name"));
                Map<String, Object> n = colNotes.getOrDefault(tname + "\u0001" + cname, Map.of());
                Map<String, Object> o = new LinkedHashMap<>();
                o.put("name", cname);
                o.put("type", c.get("logical_type"));
                o.put("nulls", c.get("null_count"));
                o.put("distinct", c.get("distinct_count"));
                o.put("samples", df == null ? List.of() : samples(df, cname));
                o.put("description", n.getOrDefault("description", ""));
                o.put("semantic", n.getOrDefault("semantic", ""));
                o.put("synonyms", n.getOrDefault("synonyms", ""));
                o.put("joins", n.getOrDefault("joins", List.of()));
                List<Map<String, Object>> auto = new ArrayList<>();
                for (String[] other : byName.getOrDefault(cname.toLowerCase(), List.of())) {
                    if (!other[0].equals(tname)) auto.add(Map.of("table", other[0], "column", other[1]));
                }
                o.put("auto_joins", auto);
                boolean doc = !String.valueOf(o.get("description")).isBlank();
                o.put("documented", doc);
                total++;
                if (doc) documented++;
                outCols.add(o);
            }
            Map<String, Object> to = new LinkedHashMap<>();
            to.put("id", t.get("id"));
            to.put("name", tname);
            to.put("source", t.get("source_name"));
            to.put("rows", df == null ? null : df.rowCount());
            to.put("description", tn.getOrDefault("description", ""));
            to.put("grain", tn.getOrDefault("grain", ""));
            to.put("columns", outCols);
            outTables.add(to);
        }
        List<Map<String, Object>> appRow = jdbc.queryForList("SELECT text, updated_at FROM app_notes WHERE app_id = ?", appId);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("app_text", appRow.isEmpty() ? "" : appRow.get(0).get("text"));
        out.put("tables", outTables);
        out.put("coverage", Map.of("columns", total, "documented", documented, "pct", total == 0 ? 0 : Math.round(documented * 100.0 / total)));
        out.put("semantics", SEMANTICS.stream().filter((s) -> !s.isEmpty()).toList());
        return out;
    }

    /** Hasta 4 valores distintos no vacíos de la columna (de las primeras 400 filas) para orientar a quien documenta. */
    private List<String> samples(DataFrame df, String column) {
        int idx = df.columns().indexOf(column);
        if (idx < 0) return List.of();
        List<String> vals = df.columnValues(idx);
        LinkedHashSet<String> out = new LinkedHashSet<>();
        for (int i = 0; i < Math.min(vals.size(), 400) && out.size() < 4; i++) {
            String v = vals.get(i);
            if (v != null && !v.isBlank()) out.add(v.length() > 40 ? v.substring(0, 40) + "…" : v);
        }
        return new ArrayList<>(out);
    }

    /* ------------------------------ Escritura ------------------------------ */

    /** Guarda lo recibido (upsert): {app_text?, tables:[{name, description?, grain?, columns:[{name, description?, semantic?, synonyms?, joins?}]}]}. */
    @SuppressWarnings("unchecked")
    public void save(String appId, String userId, Map<String, Object> body) {
        String now = Ids.now();
        if (body.containsKey("app_text")) {
            String text = clip(body.get("app_text"));
            jdbc.update("INSERT INTO app_notes (app_id, text, updated_by, updated_at) VALUES (?, ?, ?, ?) "
                    + "ON CONFLICT(app_id) DO UPDATE SET text = excluded.text, updated_by = excluded.updated_by, updated_at = excluded.updated_at",
                    appId, text, userId, now);
        }
        Set<String> known = new HashSet<>();
        for (Map<String, Object> t : this.tables.listTables(appId)) known.add((String) t.get("name"));
        if (!(body.get("tables") instanceof List<?> list)) return;
        for (Object o : list) {
            if (!(o instanceof Map<?, ?> tm)) continue;
            Map<String, Object> t = (Map<String, Object>) tm;
            String tname = String.valueOf(t.get("name"));
            if (!known.contains(tname)) continue; // solo tablas que existen en la app
            if (t.containsKey("description") || t.containsKey("grain")) {
                List<Map<String, Object>> cur = jdbc.queryForList("SELECT description, grain FROM table_notes WHERE app_id = ? AND table_name = ?", appId, tname);
                String desc = t.containsKey("description") ? clip(t.get("description")) : cur.isEmpty() ? "" : String.valueOf(cur.get(0).get("description"));
                String grain = t.containsKey("grain") ? clip(t.get("grain")) : cur.isEmpty() ? "" : String.valueOf(cur.get(0).get("grain"));
                jdbc.update("INSERT INTO table_notes (app_id, table_name, description, grain, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?) "
                        + "ON CONFLICT(app_id, table_name) DO UPDATE SET description = excluded.description, grain = excluded.grain, "
                        + "updated_by = excluded.updated_by, updated_at = excluded.updated_at", appId, tname, desc, grain, userId, now);
            }
            if (!(t.get("columns") instanceof List<?> cl)) continue;
            for (Object co : cl) {
                if (!(co instanceof Map<?, ?> cm)) continue;
                Map<String, Object> c = (Map<String, Object>) cm;
                String cname = String.valueOf(c.get("name"));
                List<Map<String, Object>> cur = jdbc.queryForList(
                        "SELECT description, semantic, synonyms, joins_json FROM column_notes WHERE app_id = ? AND table_name = ? AND column_name = ?",
                        appId, tname, cname);
                Map<String, Object> prev = cur.isEmpty() ? Map.of() : cur.get(0);
                String desc = c.containsKey("description") ? clip(c.get("description")) : str(prev.get("description"));
                String sem = c.containsKey("semantic") ? String.valueOf(c.get("semantic")).trim().toLowerCase() : str(prev.get("semantic"));
                if (!SEMANTICS.contains(sem)) throw new IllegalArgumentException("Tipo semántico inválido: " + sem + " (usa: " + String.join(", ", SEMANTICS.subList(1, SEMANTICS.size())) + ").");
                String syn = c.containsKey("synonyms") ? clip(c.get("synonyms")) : str(prev.get("synonyms"));
                String joins = c.containsKey("joins") ? writeJoins(c.get("joins")) : (prev.get("joins_json") == null ? "[]" : String.valueOf(prev.get("joins_json")));
                if (desc.isBlank() && sem.isBlank() && syn.isBlank() && "[]".equals(joins)) {
                    jdbc.update("DELETE FROM column_notes WHERE app_id = ? AND table_name = ? AND column_name = ?", appId, tname, cname);
                    continue;
                }
                jdbc.update("INSERT INTO column_notes (app_id, table_name, column_name, description, semantic, synonyms, joins_json, updated_by, updated_at) "
                        + "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(app_id, table_name, column_name) DO UPDATE SET "
                        + "description = excluded.description, semantic = excluded.semantic, synonyms = excluded.synonyms, "
                        + "joins_json = excluded.joins_json, updated_by = excluded.updated_by, updated_at = excluded.updated_at",
                        appId, tname, cname, desc, sem, syn, joins, userId, now);
            }
        }
    }

    /* ------------------------------ Contexto para el agente ------------------------------ */

    /**
     * Texto (markdown) que se entrega al asistente de IA y al MCP: contexto general, qué es cada tabla y cada columna
     * documentada, sinónimos y con qué se cruza. Vacío si todavía no hay notas.
     */
    @SuppressWarnings("unchecked")
    public String contextFor(String appId) {
        Map<String, Object> g = get(appId);
        StringBuilder sb = new StringBuilder();
        String appText = String.valueOf(g.get("app_text")).trim();
        if (!appText.isEmpty()) sb.append("Contexto del negocio: ").append(appText).append("\n\n");
        for (Map<String, Object> t : (List<Map<String, Object>>) g.get("tables")) {
            List<Map<String, Object>> cols = (List<Map<String, Object>>) t.get("columns");
            boolean tableHas = !str(t.get("description")).isBlank() || !str(t.get("grain")).isBlank();
            boolean anyCol = cols.stream().anyMatch((c) -> !str(c.get("description")).isBlank() || !((List<?>) c.get("joins")).isEmpty() || !str(c.get("semantic")).isBlank());
            if (!tableHas && !anyCol) continue;
            sb.append("## Tabla ").append(t.get("name"));
            if (!str(t.get("description")).isBlank()) sb.append(": ").append(str(t.get("description")).trim());
            sb.append("\n");
            if (!str(t.get("grain")).isBlank()) sb.append("Granularidad (una fila representa): ").append(str(t.get("grain")).trim()).append("\n");
            for (Map<String, Object> c : cols) {
                List<Map<String, Object>> joins = (List<Map<String, Object>>) c.get("joins");
                boolean has = !str(c.get("description")).isBlank() || !joins.isEmpty() || !str(c.get("semantic")).isBlank() || !str(c.get("synonyms")).isBlank();
                if (!has) continue;
                sb.append("- ").append(c.get("name"));
                List<String> meta = new ArrayList<>();
                if (c.get("type") != null) meta.add(String.valueOf(c.get("type")));
                if (!str(c.get("semantic")).isBlank()) meta.add(str(c.get("semantic")));
                if (!meta.isEmpty()) sb.append(" (").append(String.join(", ", meta)).append(")");
                if (!str(c.get("description")).isBlank()) sb.append(": ").append(str(c.get("description")).trim());
                if (!str(c.get("synonyms")).isBlank()) sb.append(" También se le llama: ").append(str(c.get("synonyms")).trim()).append(".");
                if (!joins.isEmpty()) {
                    List<String> js = new ArrayList<>();
                    for (Map<String, Object> j : joins) {
                        js.add(j.get("table") + "." + j.get("column") + (str(j.get("note")).isBlank() ? "" : " (" + str(j.get("note")).trim() + ")"));
                    }
                    sb.append(" Se cruza con: ").append(String.join("; ", js)).append(".");
                }
                sb.append("\n");
            }
            sb.append("\n");
        }
        String out = sb.toString().trim();
        return out.length() > MAX_CONTEXT ? out.substring(0, MAX_CONTEXT) + "\n…(notas recortadas)" : out;
    }

    /* ------------------------------ Utilidades ------------------------------ */

    private static String str(Object o) { return o == null ? "" : String.valueOf(o); }

    private static String clip(Object o) {
        String s = o == null ? "" : String.valueOf(o).trim();
        return s.length() > MAX_TEXT ? s.substring(0, MAX_TEXT) : s;
    }

    private List<Map<String, Object>> parseJoins(String json) {
        try { return mapper.readValue(json == null ? "[]" : json, new TypeReference<List<Map<String, Object>>>() {}); }
        catch (Exception e) { return List.of(); }
    }

    @SuppressWarnings("unchecked")
    private String writeJoins(Object raw) {
        List<Map<String, Object>> out = new ArrayList<>();
        if (raw instanceof List<?> l) {
            for (Object o : l) {
                if (!(o instanceof Map<?, ?> m)) continue;
                String table = str(((Map<String, Object>) m).get("table")).trim();
                String column = str(((Map<String, Object>) m).get("column")).trim();
                if (table.isEmpty() || column.isEmpty()) continue;
                Map<String, Object> j = new LinkedHashMap<>();
                j.put("table", table);
                j.put("column", column);
                j.put("note", clip(((Map<String, Object>) m).get("note")));
                out.add(j);
            }
        }
        try { return mapper.writeValueAsString(out); } catch (Exception e) { return "[]"; }
    }
}
