package io.datasense.auth;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;

import io.datasense.repo.Ids;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Map;
import java.util.Optional;

/** Acceso a la tabla {@code users}. */
@Repository
public class UserRepository {

    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper = new ObjectMapper();

    public UserRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    private static final String COLS =
            "id, email, name, role, active, permissions_json, created_at, updated_at, last_login, password_hash";

    private final RowMapper<UserRecord> mapRow = (rs, i) -> {
        Map<String, List<String>> perms = parse(rs.getString("permissions_json"));
        return new UserRecord(rs.getString("id"), rs.getString("email"), rs.getString("name"), rs.getString("role"),
                rs.getInt("active") == 1,
                perms.getOrDefault("grant", List.of()), perms.getOrDefault("deny", List.of()),
                rs.getString("created_at"), rs.getString("updated_at"), rs.getString("last_login"),
                rs.getString("password_hash"));
    };

    public List<UserRecord> list() {
        return jdbc.query("SELECT " + COLS + " FROM users ORDER BY created_at", mapRow);
    }

    public Optional<UserRecord> get(String id) {
        return jdbc.query("SELECT " + COLS + " FROM users WHERE id = ?", mapRow, id).stream().findFirst();
    }

    public Optional<UserRecord> findByEmail(String email) {
        return jdbc.query("SELECT " + COLS + " FROM users WHERE email = ?", mapRow, normEmail(email)).stream().findFirst();
    }

    public long count() {
        Long n = jdbc.queryForObject("SELECT COUNT(*) FROM users", Long.class);
        return n == null ? 0 : n;
    }

    public long activeAdmins() {
        Long n = jdbc.queryForObject("SELECT COUNT(*) FROM users WHERE role = 'admin' AND active = 1", Long.class);
        return n == null ? 0 : n;
    }

    public UserRecord create(String email, String name, String password, String role, boolean active,
                             List<String> grant, List<String> deny) {
        String id = Ids.newId();
        String now = Ids.now();
        jdbc.update("INSERT INTO users (id, email, name, role, active, permissions_json, password_hash, created_at, updated_at) "
                        + "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                id, normEmail(email), name, role, active ? 1 : 0, write(grant, deny),
                PasswordHasher.hash(password), now, now);
        return get(id).orElseThrow();
    }

    public Optional<UserRecord> update(String id, String email, String name, String role, boolean active,
                                       List<String> grant, List<String> deny) {
        int n = jdbc.update("UPDATE users SET email = ?, name = ?, role = ?, active = ?, permissions_json = ?, updated_at = ? WHERE id = ?",
                normEmail(email), name, role, active ? 1 : 0, write(grant, deny), Ids.now(), id);
        return n > 0 ? get(id) : Optional.empty();
    }

    public void setPassword(String id, String password) {
        jdbc.update("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?",
                PasswordHasher.hash(password), Ids.now(), id);
    }

    public void touchLogin(String id) {
        jdbc.update("UPDATE users SET last_login = ? WHERE id = ?", Ids.now(), id);
    }

    public boolean delete(String id) {
        return jdbc.update("DELETE FROM users WHERE id = ?", id) > 0;
    }

    /** Pasa las aplicaciones de un usuario que se elimina a otro (no se pierden ni quedan huérfanas). */
    public int reassignApps(String fromUserId, String toUserId) {
        return jdbc.update("UPDATE apps SET owner_id = ? WHERE owner_id = ?", toUserId, fromUserId);
    }

    public static String normEmail(String email) {
        return email == null ? "" : email.trim().toLowerCase();
    }

    private Map<String, List<String>> parse(String json) {
        try { return mapper.readValue(json == null ? "{}" : json, new TypeReference<Map<String, List<String>>>() {}); }
        catch (Exception e) { return Map.of(); }
    }

    private String write(List<String> grant, List<String> deny) {
        try { return mapper.writeValueAsString(Map.of("grant", grant == null ? List.of() : grant, "deny", deny == null ? List.of() : deny)); }
        catch (Exception e) { return "{}"; }
    }
}
