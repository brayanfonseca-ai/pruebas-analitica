package io.datasense.flow;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;

import io.datasense.repo.Ids;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.security.SecureRandom;
import java.util.*;

/** Acceso a {@code flows}, {@code flow_runs} y {@code flow_credentials}. */
@Repository
public class FlowRepository {

    private final JdbcTemplate jdbc;
    final ObjectMapper mapper = new ObjectMapper();
    private static final SecureRandom RNG = new SecureRandom();

    public FlowRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /* ------------------------------ flujos ------------------------------ */

    public List<Map<String, Object>> list(String ownerId, boolean all) {
        String sql = "SELECT * FROM flows" + (all ? "" : " WHERE owner_id = ?") + " ORDER BY updated_at DESC";
        List<Map<String, Object>> rows = all ? jdbc.queryForList(sql) : jdbc.queryForList(sql, ownerId);
        return rows.stream().map(r -> out(r, false)).toList();
    }

    public Optional<Map<String, Object>> raw(String id) {
        return jdbc.queryForList("SELECT * FROM flows WHERE id = ?", id).stream().findFirst();
    }

    public Optional<Map<String, Object>> byToken(String token) {
        return jdbc.queryForList("SELECT * FROM flows WHERE webhook_token = ?", token).stream().findFirst();
    }

    public Optional<Map<String, Object>> get(String id) { return raw(id).map(r -> out(r, true)); }

    Map<String, Object> out(Map<String, Object> r, boolean withGraph) {
        Map<String, Object> o = new LinkedHashMap<>();
        for (String k : List.of("id", "name", "description", "owner_id", "owner_name", "next_run_at", "last_run_at", "last_status", "created_at", "updated_at")) o.put(k, r.get(k));
        o.put("enabled", toInt(r.get("enabled")) == 1);
        o.put("webhook_token", r.get("webhook_token"));
        Map<String, Object> g = graph(r);
        List<Map<String, Object>> nodes = nodes(g);
        Map<String, Object> trig = nodes.stream().filter(n -> String.valueOf(n.get("type")).startsWith("trigger.")).findFirst().orElse(null);
        o.put("trigger", trig == null ? null : trig.get("type"));
        o.put("nodes_count", nodes.size());
        o.put("node_types", nodes.stream().map(n -> n.get("type")).distinct().toList());
        if (withGraph) o.put("graph", g);
        return o;
    }

    @SuppressWarnings("unchecked")
    Map<String, Object> graph(Map<String, Object> r) {
        try { return mapper.readValue(String.valueOf(r.get("graph_json")), new TypeReference<Map<String, Object>>() {}); }
        catch (Exception e) { return new LinkedHashMap<>(Map.of("nodes", List.of(), "edges", List.of())); }
    }

    @SuppressWarnings("unchecked")
    static List<Map<String, Object>> nodes(Map<String, Object> g) {
        return g.get("nodes") instanceof List<?> l ? (List<Map<String, Object>>) l : List.of();
    }

    @SuppressWarnings("unchecked")
    static List<Map<String, Object>> edges(Map<String, Object> g) {
        return g.get("edges") instanceof List<?> l ? (List<Map<String, Object>>) l : List.of();
    }

    public String create(String name, String description, Map<String, Object> graph, String ownerId, String ownerName) {
        String id = Ids.newId(), now = Ids.now();
        jdbc.update("INSERT INTO flows (id, name, description, graph_json, enabled, webhook_token, owner_id, owner_name, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?)",
                id, name, description, write(graph), token(), ownerId, ownerName, now, now);
        return id;
    }

    public void update(String id, String name, String description, Map<String, Object> graph) {
        jdbc.update("UPDATE flows SET name = ?, description = ?, graph_json = ?, updated_at = ? WHERE id = ?", name, description, write(graph), Ids.now(), id);
    }

    public void setEnabled(String id, boolean on, String nextRunAt) {
        jdbc.update("UPDATE flows SET enabled = ?, next_run_at = ?, updated_at = ? WHERE id = ?", on ? 1 : 0, nextRunAt, Ids.now(), id);
    }

    public void setNext(String id, String nextRunAt) { jdbc.update("UPDATE flows SET next_run_at = ? WHERE id = ?", nextRunAt, id); }

    public void rotateToken(String id) { jdbc.update("UPDATE flows SET webhook_token = ? WHERE id = ?", token(), id); }

    public boolean delete(String id) {
        jdbc.update("DELETE FROM flow_runs WHERE flow_id = ?", id);
        return jdbc.update("DELETE FROM flows WHERE id = ?", id) > 0;
    }

    public List<Map<String, Object>> enabled() { return jdbc.queryForList("SELECT * FROM flows WHERE enabled = 1"); }

    private static String token() {
        byte[] b = new byte[18];
        RNG.nextBytes(b);
        return "flw_" + Base64.getUrlEncoder().withoutPadding().encodeToString(b);
    }

    /* ------------------------------ ejecuciones ------------------------------ */

    public void saveRun(String id, String flowId, String trigger, String status, String error, List<Map<String, Object>> steps, long ms, String startedAt) {
        if (raw(flowId).isEmpty()) return;   // el flujo se borró mientras corría
        jdbc.update("INSERT INTO flow_runs (id, flow_id, trigger, status, error, steps_json, duration_ms, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                id, flowId, trigger, status, error, write(steps), ms, startedAt);
        jdbc.update("UPDATE flows SET last_run_at = ?, last_status = ? WHERE id = ?", startedAt, status, flowId);
        jdbc.update("DELETE FROM flow_runs WHERE flow_id = ? AND id NOT IN (SELECT id FROM flow_runs WHERE flow_id = ? ORDER BY started_at DESC LIMIT 50)", flowId, flowId);
    }

    public List<Map<String, Object>> runs(String flowId, int limit) {
        return jdbc.queryForList("SELECT id, flow_id, trigger, status, error, duration_ms, started_at FROM flow_runs WHERE flow_id = ? ORDER BY started_at DESC LIMIT ?",
                flowId, Math.max(1, Math.min(50, limit)));
    }

    public Optional<Map<String, Object>> run(String runId) {
        return jdbc.queryForList("SELECT * FROM flow_runs WHERE id = ?", runId).stream().findFirst().map(r -> {
            Map<String, Object> o = new LinkedHashMap<>(r);
            Object s = o.remove("steps_json");
            try { o.put("steps", s == null ? List.of() : mapper.readValue(String.valueOf(s), new TypeReference<List<Map<String, Object>>>() {})); }
            catch (Exception e) { o.put("steps", List.of()); }
            return o;
        });
    }

    /* ------------------------------ credenciales ------------------------------ */

    public List<Map<String, Object>> credentials(String ownerId) {
        return jdbc.queryForList("SELECT * FROM flow_credentials WHERE owner_id = ? ORDER BY name", ownerId).stream().map(this::credOut).toList();
    }

    public Optional<Map<String, Object>> credentialRaw(String id) {
        return jdbc.queryForList("SELECT * FROM flow_credentials WHERE id = ?", id).stream().findFirst();
    }

    public Map<String, Object> credentialConfig(Map<String, Object> row) {
        try { return mapper.readValue(String.valueOf(row.get("config_json")), new TypeReference<Map<String, Object>>() {}); }
        catch (Exception e) { return new LinkedHashMap<>(); }
    }

    /** Los campos secretos nunca salen: se indica solo si están configurados. */
    public Map<String, Object> credOut(Map<String, Object> row) {
        Map<String, Object> o = new LinkedHashMap<>();
        o.put("id", row.get("id")); o.put("kind", row.get("kind")); o.put("name", row.get("name"));
        o.put("created_at", row.get("created_at")); o.put("updated_at", row.get("updated_at"));
        Map<String, Object> cfg = credentialConfig(row), shown = new LinkedHashMap<>();
        Set<String> secrets = secretKeys(String.valueOf(row.get("kind")));
        cfg.forEach((k, v) -> shown.put(k, secrets.contains(k) ? (v == null || String.valueOf(v).isBlank() ? "" : "••••••") : v));
        o.put("config", shown);
        return o;
    }

    @SuppressWarnings("unchecked")
    static Set<String> secretKeys(String kind) {
        Set<String> s = new HashSet<>();
        for (Map<String, Object> c : FlowCatalog.CREDENTIALS) if (kind.equals(c.get("kind")))
            for (Map<String, Object> f : (List<Map<String, Object>>) c.get("fields")) if (Boolean.TRUE.equals(f.get("secret"))) s.add((String) f.get("key"));
        return s;
    }

    /** Crea o actualiza; un secreto vacío o «••••••» conserva el valor guardado. */
    public String saveCredential(String id, String ownerId, String kind, String name, Map<String, Object> config) {
        Map<String, Object> merged = new LinkedHashMap<>();
        if (id != null) credentialRaw(id).ifPresent(r -> merged.putAll(credentialConfig(r)));
        Set<String> secrets = secretKeys(kind);
        config.forEach((k, v) -> {
            String s = v == null ? "" : String.valueOf(v);
            if (secrets.contains(k) && (s.isBlank() || s.equals("••••••"))) return;
            merged.put(k, v);
        });
        String now = Ids.now();
        if (id == null) {
            id = Ids.newId();
            jdbc.update("INSERT INTO flow_credentials (id, owner_id, kind, name, config_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    id, ownerId, kind, name, write(merged), now, now);
        } else {
            jdbc.update("UPDATE flow_credentials SET name = ?, config_json = ?, updated_at = ? WHERE id = ?", name, write(merged), now, id);
        }
        return id;
    }

    public boolean deleteCredential(String id) { return jdbc.update("DELETE FROM flow_credentials WHERE id = ?", id) > 0; }

    String write(Object o) { try { return mapper.writeValueAsString(o); } catch (Exception e) { return "{}"; } }

    static int toInt(Object o) { return o instanceof Number n ? n.intValue() : o == null ? 0 : Integer.parseInt(String.valueOf(o)); }
}
