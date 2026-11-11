package io.datasense.repo;

import io.datasense.model.AppModels.AppOut;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

/** Acceso a la tabla {@code apps}. Equivalente a db.create_app/list_apps/... */
@Repository
public class AppRepository {

    private final JdbcTemplate jdbc;

    public AppRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    private static final String SELECT = """
            SELECT a.id, a.name, a.created_at, a.stage, a.owner_id, u.name AS owner_name,
                   (SELECT COUNT(*) FROM app_sheets s WHERE s.app_id = a.id) AS sheets,
                   (SELECT COUNT(*) FROM app_sheets s WHERE s.app_id = a.id AND s.visibility = 'publica') AS published
              FROM apps a LEFT JOIN users u ON u.id = a.owner_id""";

    private static final RowMapper<AppOut> MAPPER = (rs, i) ->
            new AppOut(rs.getString("id"), rs.getString("name"), rs.getString("created_at"),
                    rs.getString("stage"), rs.getString("owner_id"), rs.getString("owner_name"),
                    rs.getInt("sheets"), rs.getInt("published"));

    public List<AppOut> listApps() {
        return jdbc.query(SELECT + " ORDER BY a.created_at DESC", MAPPER);
    }

    public Optional<AppOut> getApp(String id) {
        return jdbc.query(SELECT + " WHERE a.id = ?", MAPPER, id).stream().findFirst();
    }

    /** Toda app nueva nace en la etapa {@code personal} y pertenece a quien la crea. */
    public AppOut createApp(String name, String ownerId) {
        String id = Ids.newId();
        String now = Ids.now();
        jdbc.update("INSERT INTO apps (id, name, created_at, owner_id, stage) VALUES (?, ?, ?, ?, 'personal')",
                id, name, now, ownerId);
        return getApp(id).orElseThrow();
    }

    public Optional<AppOut> setStage(String id, String stage) {
        int n = jdbc.update("UPDATE apps SET stage = ? WHERE id = ?", stage, id);
        return n > 0 ? getApp(id) : Optional.empty();
    }

    public Optional<AppOut> setOwner(String id, String ownerId) {
        int n = jdbc.update("UPDATE apps SET owner_id = ? WHERE id = ?", ownerId, id);
        return n > 0 ? getApp(id) : Optional.empty();
    }

    public boolean deleteApp(String id) {
        return jdbc.update("DELETE FROM apps WHERE id = ?", id) > 0;
    }
}
