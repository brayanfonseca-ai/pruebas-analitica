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

    private static final RowMapper<AppOut> MAPPER = (rs, i) ->
            new AppOut(rs.getString("id"), rs.getString("name"), rs.getString("created_at"));

    public List<AppOut> listApps() {
        return jdbc.query("SELECT id, name, created_at FROM apps ORDER BY created_at DESC", MAPPER);
    }

    public Optional<AppOut> getApp(String id) {
        return jdbc.query("SELECT id, name, created_at FROM apps WHERE id = ?", MAPPER, id)
                .stream().findFirst();
    }

    public AppOut createApp(String name) {
        String id = Ids.newId();
        String now = Ids.now();
        jdbc.update("INSERT INTO apps (id, name, created_at) VALUES (?, ?, ?)", id, name, now);
        return new AppOut(id, name, now);
    }

    public boolean deleteApp(String id) {
        return jdbc.update("DELETE FROM apps WHERE id = ?", id) > 0;
    }
}
