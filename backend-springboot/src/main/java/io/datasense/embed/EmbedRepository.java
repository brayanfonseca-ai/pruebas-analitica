package io.datasense.embed;

import io.datasense.repo.Ids;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

import java.security.SecureRandom;
import java.util.Base64;
import java.util.List;
import java.util.Optional;

/** Acceso a la tabla {@code embeds}. El token es un secreto de 256 bits con prefijo {@code dse_}. */
@Repository
public class EmbedRepository {

    public static final String TOKEN_PREFIX = "dse_";

    private final JdbcTemplate jdbc;
    private final SecureRandom random = new SecureRandom();

    public EmbedRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    private static final String COLS =
            "id, name, app_id, sheet_id, token, enabled, allowed_origins, expires_at, options_json, created_by, created_at, last_used_at, views";

    private static final RowMapper<EmbedRecord> MAPPER = (rs, i) -> new EmbedRecord(
            rs.getString("id"), rs.getString("name"), rs.getString("app_id"), rs.getString("sheet_id"), rs.getString("token"),
            rs.getInt("enabled") == 1, rs.getString("allowed_origins"), rs.getString("expires_at"), rs.getString("options_json"),
            rs.getString("created_by"), rs.getString("created_at"), rs.getString("last_used_at"), rs.getInt("views"));

    public List<EmbedRecord> list() {
        return jdbc.query("SELECT " + COLS + " FROM embeds ORDER BY created_at DESC", MAPPER);
    }

    public Optional<EmbedRecord> get(String id) {
        return jdbc.query("SELECT " + COLS + " FROM embeds WHERE id = ?", MAPPER, id).stream().findFirst();
    }

    public Optional<EmbedRecord> findByToken(String token) {
        return jdbc.query("SELECT " + COLS + " FROM embeds WHERE token = ?", MAPPER, token).stream().findFirst();
    }

    public String newToken() {
        byte[] b = new byte[32];
        random.nextBytes(b);
        return TOKEN_PREFIX + Base64.getUrlEncoder().withoutPadding().encodeToString(b);
    }

    public EmbedRecord create(String name, String appId, String sheetId, String allowedOrigins, String expiresAt,
                              String optionsJson, String createdBy) {
        String id = Ids.newId();
        jdbc.update("INSERT INTO embeds (id, name, app_id, sheet_id, token, enabled, allowed_origins, expires_at, options_json, created_by, created_at) "
                        + "VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)",
                id, name, appId, sheetId, newToken(), allowedOrigins, expiresAt, optionsJson, createdBy, Ids.now());
        return get(id).orElseThrow();
    }

    public Optional<EmbedRecord> update(String id, String name, Boolean enabled, String allowedOrigins, String expiresAt,
                                        boolean expiresProvided, String optionsJson) {
        EmbedRecord cur = get(id).orElse(null);
        if (cur == null) return Optional.empty();
        jdbc.update("UPDATE embeds SET name = ?, enabled = ?, allowed_origins = ?, expires_at = ?, options_json = ? WHERE id = ?",
                name != null ? name : cur.name(),
                (enabled != null ? enabled : cur.enabled()) ? 1 : 0,
                allowedOrigins != null ? allowedOrigins : cur.allowedOrigins(),
                expiresProvided ? expiresAt : cur.expiresAt(),
                optionsJson != null ? optionsJson : cur.optionsJson(), id);
        return get(id);
    }

    /** Genera un token nuevo: el anterior deja de funcionar al instante. */
    public Optional<EmbedRecord> rotate(String id) {
        int n = jdbc.update("UPDATE embeds SET token = ? WHERE id = ?", newToken(), id);
        return n > 0 ? get(id) : Optional.empty();
    }

    public void touch(String id) {
        jdbc.update("UPDATE embeds SET views = views + 1, last_used_at = ? WHERE id = ?", Ids.now(), id);
    }

    public boolean delete(String id) {
        return jdbc.update("DELETE FROM embeds WHERE id = ?", id) > 0;
    }
}
