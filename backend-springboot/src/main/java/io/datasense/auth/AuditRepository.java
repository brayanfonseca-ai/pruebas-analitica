package io.datasense.auth;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;

import io.datasense.config.DatabaseConfig.SchemaInitializer;
import io.datasense.repo.Ids;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.*;

/**
 * Auditoría de seguridad ({@code security_audit}): quién cambió qué rol, permiso o cuenta, cuándo y el detalle
 * (antes / después). Solo se añade; nunca se edita ni se borra desde la API.
 */
@Repository
public class AuditRepository {

    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper = new ObjectMapper();

    public AuditRepository(SchemaInitializer schema, JdbcTemplate jdbc) {
        this.jdbc = jdbc;
        jdbc.execute("CREATE TABLE IF NOT EXISTS security_audit (id TEXT PRIMARY KEY, at TEXT NOT NULL, actor_id TEXT, actor_name TEXT, "
                + "action TEXT NOT NULL, target_type TEXT NOT NULL, target_id TEXT, target_label TEXT, summary TEXT, detail_json TEXT)");
        jdbc.execute("CREATE INDEX IF NOT EXISTS ix_security_audit_at ON security_audit(at)");
    }

    /** Registra un evento. {@code detail} admite listas/mapas (se guarda como JSON). Nunca lanza. */
    public void log(UserRecord actor, String action, String targetType, String targetId, String targetLabel, String summary, Map<String, Object> detail) {
        try {
            jdbc.update("INSERT INTO security_audit (id, at, actor_id, actor_name, action, target_type, target_id, target_label, summary, detail_json) VALUES (?,?,?,?,?,?,?,?,?,?)",
                    Ids.newId(), Ids.now(), actor == null ? null : actor.id(), actor == null ? "Sistema" : actor.name(), action, targetType, targetId, targetLabel,
                    summary, detail == null ? null : mapper.writeValueAsString(detail));
        } catch (Exception ignored) { /* la auditoría nunca rompe la operación */ }
    }

    public List<Map<String, Object>> list(int limit, String targetType, String targetId) {
        StringBuilder sql = new StringBuilder("SELECT * FROM security_audit WHERE 1=1");
        List<Object> args = new ArrayList<>();
        if (targetType != null && !targetType.isBlank()) { sql.append(" AND target_type = ?"); args.add(targetType); }
        if (targetId != null && !targetId.isBlank()) { sql.append(" AND target_id = ?"); args.add(targetId); }
        sql.append(" ORDER BY at DESC LIMIT ?");
        args.add(Math.max(1, Math.min(500, limit)));
        return jdbc.queryForList(sql.toString(), args.toArray()).stream().map(r -> {
            Map<String, Object> m = new LinkedHashMap<>(r);
            Object dj = m.remove("detail_json");
            try { m.put("detail", dj == null ? null : mapper.readValue(String.valueOf(dj), new TypeReference<Map<String, Object>>() {})); }
            catch (Exception e) { m.put("detail", null); }
            return m;
        }).toList();
    }

    /** Diferencia legible entre dos listas de permisos: {added:[…], removed:[…]}. */
    public static Map<String, Object> diff(Collection<String> before, Collection<String> after) {
        Set<String> b = new LinkedHashSet<>(before == null ? List.of() : before), a = new LinkedHashSet<>(after == null ? List.of() : after);
        List<String> added = a.stream().filter(x -> !b.contains(x)).toList(), removed = b.stream().filter(x -> !a.contains(x)).toList();
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("added", added);
        m.put("removed", removed);
        return m;
    }
}
