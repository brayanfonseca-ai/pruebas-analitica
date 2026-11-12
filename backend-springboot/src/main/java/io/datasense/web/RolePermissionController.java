package io.datasense.web;

import io.datasense.auth.Permissions;
import io.datasense.config.DatabaseConfig.SchemaInitializer;

import jakarta.annotation.PostConstruct;

import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.util.*;

/**
 * El administrador decide qué permisos trae cada rol (Desarrollador y Visualizador). El rol Administrador siempre
 * tiene todo. Lo guardado se aplica de inmediato a todas las personas con ese rol; los permisos sueltos por usuario
 * (concedidos/denegados) se siguen aplicando encima.
 * <ul>
 *   <li>{@code PUT    /api/v1/users/roles/{role}} {permissions:[…]} — fija los permisos del rol.</li>
 *   <li>{@code DELETE /api/v1/users/roles/{role}} — vuelve a los permisos de fábrica.</li>
 * </ul>
 * Requiere {@code users:manage}.
 */
@RestController
@RequestMapping("/api/v1/users/roles")
public class RolePermissionController {

    private final JdbcTemplate jdbc;

    public RolePermissionController(SchemaInitializer schema, JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @PostConstruct
    void load() {
        jdbc.execute("CREATE TABLE IF NOT EXISTS role_permissions (role TEXT PRIMARY KEY, permissions TEXT NOT NULL)");
        jdbc.query("SELECT role, permissions FROM role_permissions", rs -> {
            String role = rs.getString("role");
            if (!Permissions.validRole(role) || "admin".equals(role)) return;
            Set<String> perms = new LinkedHashSet<>();
            for (String p : rs.getString("permissions").split(",")) if (Permissions.validPermission(p.trim())) perms.add(p.trim());
            Permissions.setRoleOverride(role, perms);
        });
    }

    private static String checkRole(String role) {
        if (!Permissions.validRole(role)) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Rol no encontrado: " + role);
        if ("admin".equals(role)) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "El rol Administrador siempre tiene todos los permisos y no se puede cambiar.");
        return role;
    }

    @PutMapping("/{role}")
    public Map<String, Object> set(@PathVariable String role, @RequestBody Map<String, Object> body) {
        checkRole(role);
        Set<String> perms = new LinkedHashSet<>();
        if (body.get("permissions") instanceof List<?> l) {
            for (Object o : l) {
                String p = String.valueOf(o);
                if (!Permissions.validPermission(p)) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Permiso desconocido: " + p);
                perms.add(p);
            }
        }
        if (!perms.contains(Permissions.VIEW)) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Todos los roles deben poder ver tableros publicados (" + Permissions.VIEW + ").");
        jdbc.update("INSERT INTO role_permissions (role, permissions) VALUES (?, ?) ON CONFLICT(role) DO UPDATE SET permissions = excluded.permissions",
                role, String.join(",", perms));
        Permissions.setRoleOverride(role, perms);
        return Map.of("ok", true, "role", role, "permissions", perms, "customized", true);
    }

    @DeleteMapping("/{role}")
    public Map<String, Object> reset(@PathVariable String role) {
        checkRole(role);
        jdbc.update("DELETE FROM role_permissions WHERE role = ?", role);
        Permissions.setRoleOverride(role, null);
        return Map.of("ok", true, "role", role, "permissions", Permissions.roleDefaults(role), "customized", false);
    }
}
