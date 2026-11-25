package io.datasense.web;

import io.datasense.auth.AccessService;
import io.datasense.auth.AuditRepository;
import io.datasense.auth.Permissions;
import io.datasense.auth.UserRecord;
import io.datasense.auth.UserRepository;
import io.datasense.config.DatabaseConfig.SchemaInitializer;

import jakarta.annotation.PostConstruct;
import jakarta.servlet.http.HttpServletRequest;

import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.text.Normalizer;
import java.util.*;

/**
 * Roles y sus permisos detallados. El rol Administrador siempre tiene todo. Lo guardado se aplica de inmediato a
 * todas las personas con ese rol; los permisos sueltos por usuario (concedidos/denegados) se siguen aplicando encima.
 * <ul>
 *   <li>{@code POST   /api/v1/users/roles} {label, description?, permissions?, copy_from?} — crea un rol personalizado.</li>
 *   <li>{@code PUT    /api/v1/users/roles/{role}} {permissions?, label?, description?} — fija sus permisos (y en los
 *       personalizados, también nombre y descripción).</li>
 *   <li>{@code DELETE /api/v1/users/roles/{role}} — rol de fábrica: vuelve a los permisos de fábrica; rol personalizado:
 *       lo borra (409 si alguien lo tiene, salvo {@code ?reassign_to=rol}).</li>
 * </ul>
 * Requiere {@code roles:manage}. Cada cambio queda en la auditoría.
 */
@RestController
@RequestMapping("/api/v1/users/roles")
public class RolePermissionController {

    private final JdbcTemplate jdbc;
    private final UserRepository users;
    private final AuditRepository audit;

    public RolePermissionController(SchemaInitializer schema, JdbcTemplate jdbc, UserRepository users, AuditRepository audit) {
        this.jdbc = jdbc;
        this.users = users;
        this.audit = audit;
    }

    @PostConstruct
    void load() {
        jdbc.execute("CREATE TABLE IF NOT EXISTS role_permissions (role TEXT PRIMARY KEY, permissions TEXT NOT NULL)");
        jdbc.execute("CREATE TABLE IF NOT EXISTS custom_roles (id TEXT PRIMARY KEY, label TEXT NOT NULL, description TEXT, permissions TEXT NOT NULL, "
                + "created_by TEXT, created_at TEXT, updated_at TEXT)");
        jdbc.query("SELECT id, label, description, permissions FROM custom_roles", rs -> {
            Permissions.putCustomRole(new Permissions.RoleDef(rs.getString("id"), rs.getString("label"),
                    Objects.toString(rs.getString("description"), ""), split(rs.getString("permissions"))));
        });
        jdbc.query("SELECT role, permissions FROM role_permissions", rs -> {
            String role = rs.getString("role");
            if (!Permissions.BUILTIN.contains(role) || "admin".equals(role)) return;
            Permissions.setRoleOverride(role, split(rs.getString("permissions")));
        });
    }

    private static List<String> split(String csv) {
        List<String> out = new ArrayList<>();
        if (csv == null) return out;
        for (String p : csv.split(",")) if (Permissions.validPermission(p.trim())) out.add(p.trim());
        return out;
    }

    private static ResponseStatusException bad(String m) { return new ResponseStatusException(HttpStatus.BAD_REQUEST, m); }

    /** Lista del cuerpo → permisos detallados válidos (los nombres antiguos se expanden). Ver aplicaciones es obligatorio. */
    private static Set<String> perms(Object raw) {
        List<String> in = new ArrayList<>();
        if (raw instanceof List<?> l) {
            for (Object o : l) {
                String p = String.valueOf(o);
                if (!Permissions.validPermission(p)) throw bad("Permiso desconocido: " + p);
                in.add(p);
            }
        } else if (raw != null) throw bad("Los permisos deben ser una lista.");
        Set<String> out = Permissions.expand(in);
        if (!out.contains(Permissions.APPS_VIEW))
            throw bad("Todo rol debe poder ver aplicaciones (" + Permissions.APPS_VIEW + "): sin eso no puede usar nada más.");
        return out;
    }

    private static String checkRole(String role) {
        if (!Permissions.validRole(role)) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Rol no encontrado: " + role);
        if ("admin".equals(role)) throw bad("El rol Administrador siempre tiene todos los permisos y no se puede cambiar.");
        return role;
    }

    private static String slug(String label) {
        String s = Normalizer.normalize(label, Normalizer.Form.NFD).replaceAll("\\p{M}", "").toLowerCase(Locale.ROOT)
                .replaceAll("[^a-z0-9]+", "-").replaceAll("(^-|-$)", "");
        if (s.isBlank()) s = "rol";
        return s.length() > 40 ? s.substring(0, 40) : s;
    }

    private String label(String role) { return Permissions.role(role).map(Permissions.RoleDef::label).orElse(role); }

    private long usersWith(String role) { return users.list().stream().filter(u -> role.equals(u.role())).count(); }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> create(HttpServletRequest req, @RequestBody Map<String, Object> body) {
        UserRecord me = AccessService.current(req);
        String lbl = String.valueOf(body.getOrDefault("label", "")).trim();
        if (lbl.isBlank()) throw bad("Ponle un nombre al rol.");
        if (lbl.length() > 60) throw bad("El nombre del rol es demasiado largo (máximo 60).");
        if (Permissions.roles().stream().anyMatch(r -> r.label().equalsIgnoreCase(lbl)))
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Ya existe un rol con ese nombre.");
        String desc = String.valueOf(body.getOrDefault("description", "")).trim();
        Set<String> p;
        if (body.get("permissions") != null) p = perms(body.get("permissions"));
        else if (body.get("copy_from") != null) {
            String from = String.valueOf(body.get("copy_from"));
            if (!Permissions.validRole(from)) throw bad("Rol de origen desconocido: " + from);
            p = Permissions.roleDefaults(from);
        } else p = new LinkedHashSet<>(Permissions.factoryDefaults("viewer"));
        String id = "r-" + slug(lbl);
        for (int i = 2; Permissions.validRole(id); i++) id = "r-" + slug(lbl) + "-" + i;
        String now = io.datasense.repo.Ids.now();
        jdbc.update("INSERT INTO custom_roles (id, label, description, permissions, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
                id, lbl, desc, String.join(",", p), me == null ? null : me.id(), now, now);
        Permissions.putCustomRole(new Permissions.RoleDef(id, lbl, desc, List.copyOf(p)));
        audit.log(me, "role.create", "role", id, lbl, "Creó el rol con " + p.size() + " permiso(s)"
                + (body.get("copy_from") != null ? " copiados de " + label(String.valueOf(body.get("copy_from"))) : ""), Map.of("permissions", List.copyOf(p)));
        return out(id);
    }

    @PutMapping("/{role}")
    public Map<String, Object> set(HttpServletRequest req, @PathVariable String role, @RequestBody Map<String, Object> body) {
        UserRecord me = AccessService.current(req);
        checkRole(role);
        Set<String> before = Permissions.roleDefaults(role);
        boolean custom = Permissions.isCustomRole(role);
        if (custom) {
            Permissions.RoleDef cur = Permissions.role(role).orElseThrow();
            String lbl = body.containsKey("label") ? String.valueOf(body.get("label")).trim() : cur.label();
            String desc = body.containsKey("description") ? String.valueOf(body.get("description")).trim() : cur.description();
            if (lbl.isBlank()) throw bad("El nombre del rol no puede quedar vacío.");
            if (Permissions.roles().stream().anyMatch(r -> !r.id().equals(role) && r.label().equalsIgnoreCase(lbl)))
                throw new ResponseStatusException(HttpStatus.CONFLICT, "Ya existe un rol con ese nombre.");
            Set<String> p = body.containsKey("permissions") ? perms(body.get("permissions")) : new LinkedHashSet<>(cur.permissions());
            jdbc.update("UPDATE custom_roles SET label = ?, description = ?, permissions = ?, updated_at = ? WHERE id = ?",
                    lbl, desc, String.join(",", p), io.datasense.repo.Ids.now(), role);
            Permissions.putCustomRole(new Permissions.RoleDef(role, lbl, desc, List.copyOf(p)));
            if (!lbl.equals(cur.label()) || !desc.equals(cur.description()))
                audit.log(me, "role.rename", "role", role, lbl, "Nombre o descripción: «" + cur.label() + "» → «" + lbl + "»", null);
        } else {
            Set<String> p = perms(body.get("permissions"));
            jdbc.update("INSERT INTO role_permissions (role, permissions) VALUES (?, ?) ON CONFLICT(role) DO UPDATE SET permissions = excluded.permissions",
                    role, String.join(",", p));
            Permissions.setRoleOverride(role, p);
        }
        Set<String> after = Permissions.roleDefaults(role);
        Map<String, Object> d = AuditRepository.diff(before, after);
        if (!((List<?>) d.get("added")).isEmpty() || !((List<?>) d.get("removed")).isEmpty())
            audit.log(me, "role.permissions", "role", role, label(role), "+" + ((List<?>) d.get("added")).size() + " / −" + ((List<?>) d.get("removed")).size()
                    + " permiso(s) · afecta a " + usersWith(role) + " persona(s)", d);
        return out(role);
    }

    @DeleteMapping("/{role}")
    public Map<String, Object> reset(HttpServletRequest req, @PathVariable String role, @RequestParam(name = "reassign_to", required = false) String reassignTo) {
        UserRecord me = AccessService.current(req);
        checkRole(role);
        if (Permissions.isCustomRole(role)) {
            long n = usersWith(role);
            String lbl = label(role);
            if (n > 0) {
                if (reassignTo == null || reassignTo.isBlank())
                    throw new ResponseStatusException(HttpStatus.CONFLICT, n + " persona(s) tienen el rol «" + lbl + "». Elige a qué rol pasan (reassign_to) antes de borrarlo.");
                if (!Permissions.validRole(reassignTo) || reassignTo.equals(role)) throw bad("Rol de destino no válido: " + reassignTo);
                if ("admin".equals(reassignTo) && (me == null || !me.isAdmin())) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Solo un administrador puede asignar el rol Administrador.");
                jdbc.update("UPDATE users SET role = ? WHERE role = ?", reassignTo, role);
            }
            jdbc.update("DELETE FROM custom_roles WHERE id = ?", role);
            Permissions.removeCustomRole(role);
            audit.log(me, "role.delete", "role", role, lbl, "Borró el rol" + (n > 0 ? " · " + n + " persona(s) pasan a " + label(reassignTo) : ""), null);
            return Map.of("ok", true, "role", role, "deleted", true, "reassigned", n);
        }
        Set<String> before = Permissions.roleDefaults(role);
        jdbc.update("DELETE FROM role_permissions WHERE role = ?", role);
        Permissions.setRoleOverride(role, null);
        audit.log(me, "role.reset", "role", role, label(role), "Volvió a los permisos de fábrica", AuditRepository.diff(before, Permissions.roleDefaults(role)));
        return out(role);
    }

    private Map<String, Object> out(String role) {
        Permissions.RoleDef r = Permissions.role(role).orElseThrow();
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("ok", true);
        m.put("id", r.id());
        m.put("role", r.id());
        m.put("label", r.label());
        m.put("description", r.description());
        m.put("permissions", Permissions.roleDefaults(role));
        m.put("custom", Permissions.isCustomRole(role));
        m.put("customized", Permissions.isCustomized(role));
        m.put("users", usersWith(role));
        return m;
    }
}
