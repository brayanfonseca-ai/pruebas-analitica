package io.datasense.auth;

import io.datasense.config.DatabaseConfig.SchemaInitializer;

import jakarta.annotation.PostConstruct;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * Siembra los usuarios de demostración la primera vez (base sin usuarios) y asigna dueño a las apps
 * que existían antes de que hubiera usuarios. Depende de {@link SchemaInitializer} para correr
 * después de crear el esquema.
 *
 * <p>Cuentas de demostración (cámbialas en Configuración → Usuarios):
 * admin@datasense.io / admin123 · editor@datasense.io / editor123 · viewer@datasense.io / viewer123.</p>
 */
@Component
public class AuthBootstrap {

    private static final Logger log = LoggerFactory.getLogger(AuthBootstrap.class);

    private final UserRepository users;
    private final JdbcTemplate jdbc;

    public AuthBootstrap(SchemaInitializer schema, UserRepository users, JdbcTemplate jdbc) {
        this.users = users;
        this.jdbc = jdbc;
    }

    @PostConstruct
    public void seed() {
        if (users.count() == 0) {
            users.create("admin@datasense.io", "Admin", "admin123", "admin", true, java.util.List.of(), java.util.List.of());
            users.create("editor@datasense.io", "Editor", "editor123", "editor", true, java.util.List.of(), java.util.List.of());
            users.create("viewer@datasense.io", "Viewer", "viewer123", "viewer", true, java.util.List.of(), java.util.List.of());
            log.info("Usuarios de demostración creados (admin / editor / viewer). Cambia sus contraseñas en Configuración.");
        }
        String adminId = users.findByEmail("admin@datasense.io").map(UserRecord::id)
                .orElseGet(() -> users.list().stream().filter(UserRecord::isAdmin).map(UserRecord::id).findFirst().orElse(null));
        if (adminId != null) {
            int n = jdbc.update("UPDATE apps SET owner_id = ? WHERE owner_id IS NULL", adminId);
            if (n > 0) log.info("{} aplicaciones existentes asignadas al administrador (etapa Desarrollo).", n);
        }
    }
}
