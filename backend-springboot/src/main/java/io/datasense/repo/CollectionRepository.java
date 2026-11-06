package io.datasense.repo;

import io.datasense.model.AppModels.CollectionOut;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

/** Acceso a la tabla {@code collections}. */
@Repository
public class CollectionRepository {

    private final JdbcTemplate jdbc;

    public CollectionRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    private static final RowMapper<CollectionOut> MAPPER = (rs, i) -> new CollectionOut(
            rs.getString("id"), rs.getString("name"), rs.getString("description"),
            rs.getString("visibility"), rs.getString("created_at"), rs.getString("updated_at"));

    public List<CollectionOut> list() {
        return jdbc.query("SELECT id, name, description, visibility, created_at, updated_at "
                + "FROM collections ORDER BY updated_at DESC", MAPPER);
    }

    public Optional<CollectionOut> get(String id) {
        return jdbc.query("SELECT id, name, description, visibility, created_at, updated_at "
                + "FROM collections WHERE id = ?", MAPPER, id).stream().findFirst();
    }

    public CollectionOut create(String name, String description, String visibility) {
        String id = Ids.newId();
        String now = Ids.now();
        String vis = (visibility == null || visibility.isBlank()) ? "privada" : visibility;
        jdbc.update("INSERT INTO collections (id, name, description, visibility, created_at, updated_at) "
                + "VALUES (?, ?, ?, ?, ?, ?)", id, name, description, vis, now, now);
        return new CollectionOut(id, name, description, vis, now, now);
    }

    public boolean delete(String id) {
        return jdbc.update("DELETE FROM collections WHERE id = ?", id) > 0;
    }
}
