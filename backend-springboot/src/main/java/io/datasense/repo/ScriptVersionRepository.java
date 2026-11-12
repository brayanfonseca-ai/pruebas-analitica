package io.datasense.repo;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.*;

/**
 * Control de versiones del script de carga, al estilo git: cada vez que se guarda un script con cambios se crea una
 * versión nueva (v1, v2, …) que pasa a ser la <b>principal</b> (HEAD); las anteriores quedan debajo y nunca se borran.
 * Restaurar una versión antigua no reescribe la historia: crea una versión nueva con ese contenido.
 */
@Repository
public class ScriptVersionRepository {

    private final JdbcTemplate jdbc;

    public ScriptVersionRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public record Saved(boolean created, int version, String message) {}

    public Optional<Map<String, Object>> latest(String appId) {
        return jdbc.queryForList("SELECT version, text FROM script_versions WHERE app_id = ? ORDER BY version DESC LIMIT 1", appId)
                .stream().findFirst();
    }

    /**
     * Registra {@code text} como versión nueva si difiere de la principal. Si la app ya tenía un script guardado antes de
     * existir el control de versiones, ese contenido se conserva primero como v1 para que no se pierda.
     */
    public Saved record(String appId, String text, String message, String authorId, String authorName, String previousText) {
        Optional<Map<String, Object>> head = latest(appId);
        if (head.isEmpty() && previousText != null && !previousText.isBlank() && !previousText.equals(text)) {
            insert(appId, 1, previousText, "Versión anterior (guardada antes del control de versiones)", authorId, authorName);
            head = latest(appId);
        }
        if (head.isPresent() && text.equals(head.get().get("text"))) {
            return new Saved(false, ((Number) head.get().get("version")).intValue(), "Sin cambios: la versión principal ya es igual.");
        }
        int next = head.map(h -> ((Number) h.get("version")).intValue() + 1).orElse(1);
        String msg = message == null || message.isBlank() ? (next == 1 ? "Primera versión del script" : "Cambios en el script") : message.trim();
        if (msg.length() > 300) msg = msg.substring(0, 300);
        insert(appId, next, text, msg, authorId, authorName);
        return new Saved(true, next, msg);
    }

    private void insert(String appId, int version, String text, String message, String authorId, String authorName) {
        jdbc.update("INSERT INTO script_versions (app_id, version, text, message, author_id, author_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                appId, version, text, message, authorId, authorName, Ids.now());
    }

    /** Historial (más reciente primero) con líneas añadidas/quitadas respecto a la versión anterior. */
    public List<Map<String, Object>> list(String appId) {
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT version, text, message, author_name, created_at FROM script_versions WHERE app_id = ? ORDER BY version ASC", appId);
        List<Map<String, Object>> out = new ArrayList<>();
        String prev = null;
        for (int i = 0; i < rows.size(); i++) {
            Map<String, Object> r = rows.get(i);
            String text = String.valueOf(r.get("text"));
            int[] d = prev == null ? new int[]{lines(text).size(), 0} : diffCounts(prev, text);
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("version", r.get("version"));
            m.put("message", r.get("message"));
            m.put("author_name", r.get("author_name"));
            m.put("created_at", r.get("created_at"));
            m.put("lines", lines(text).size());
            m.put("added", d[0]);
            m.put("removed", d[1]);
            m.put("is_head", i == rows.size() - 1);
            out.add(m);
            prev = text;
        }
        Collections.reverse(out);
        return out;
    }

    public Optional<Map<String, Object>> get(String appId, int version) {
        return jdbc.queryForList("SELECT version, text, message, author_name, created_at FROM script_versions WHERE app_id = ? AND version = ?",
                appId, version).stream().findFirst().map(LinkedHashMap::new);
    }

    /* ---- diff por líneas (LCS) ---- */

    private static List<String> lines(String t) {
        return t == null || t.isEmpty() ? List.of() : Arrays.asList(t.split("\\r?\\n", -1));
    }

    /** {añadidas, quitadas}. */
    static int[] diffCounts(String a, String b) {
        List<Map<String, Object>> ops = diff(a, b);
        int add = 0, del = 0;
        for (Map<String, Object> o : ops) {
            if ("+".equals(o.get("op"))) add++;
            else if ("-".equals(o.get("op"))) del++;
        }
        return new int[]{add, del};
    }

    /** Diff línea a línea: [{op: " "|"+"|"-", text}]. Para scripts muy grandes cae a una comparación simple. */
    public static List<Map<String, Object>> diff(String a, String b) {
        List<String> x = lines(a), y = lines(b);
        List<Map<String, Object>> out = new ArrayList<>();
        int n = x.size(), m = y.size();
        if ((long) n * m > 4_000_000L) {
            for (String s : x) out.add(Map.of("op", "-", "text", s));
            for (String s : y) out.add(Map.of("op", "+", "text", s));
            return out;
        }
        int[][] L = new int[n + 1][m + 1];
        for (int i = n - 1; i >= 0; i--)
            for (int j = m - 1; j >= 0; j--)
                L[i][j] = x.get(i).equals(y.get(j)) ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
        int i = 0, j = 0;
        while (i < n && j < m) {
            if (x.get(i).equals(y.get(j))) { out.add(Map.of("op", " ", "text", x.get(i))); i++; j++; }
            else if (L[i + 1][j] >= L[i][j + 1]) { out.add(Map.of("op", "-", "text", x.get(i))); i++; }
            else { out.add(Map.of("op", "+", "text", y.get(j))); j++; }
        }
        while (i < n) out.add(Map.of("op", "-", "text", x.get(i++)));
        while (j < m) out.add(Map.of("op", "+", "text", y.get(j++)));
        return out;
    }
}
