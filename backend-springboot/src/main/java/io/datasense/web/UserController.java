package io.datasense.web;

import io.datasense.auth.AccessService;
import io.datasense.auth.AuthService;
import io.datasense.auth.Permissions;
import io.datasense.auth.UserRecord;
import io.datasense.auth.UserRepository;

import jakarta.servlet.http.HttpServletRequest;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Administración de usuarios (CRUD). Requiere {@code users:manage} (lo aplica el interceptor).
 * <ul>
 *   <li>{@code GET    /api/v1/users}</li>
 *   <li>{@code POST   /api/v1/users} {email, name, password, role, active?, grant?, deny?}</li>
 *   <li>{@code GET    /api/v1/users/{id}}</li>
 *   <li>{@code PUT    /api/v1/users/{id}} {email?, name?, role?, active?, grant?, deny?}</li>
 *   <li>{@code PUT    /api/v1/users/{id}/password} {password} (restablece la contraseña)</li>
 *   <li>{@code DELETE /api/v1/users/{id}}</li>
 * </ul>
 * Reglas: correo único; contraseña de 8+ caracteres; nunca se queda la plataforma sin un administrador
 * activo; nadie puede borrarse ni desactivarse a sí mismo.
 */
@RestController
@RequestMapping("/api/v1/users")
public class UserController {

    private static final Pattern EMAIL = Pattern.compile("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$");

    private final UserRepository users;
    private final AuthService auth;
    private final io.datasense.repo.ConnectionRepository connections;
    private final io.datasense.auth.AuditRepository audit;

    public UserController(UserRepository users, AuthService auth, io.datasense.repo.ConnectionRepository connections, io.datasense.auth.AuditRepository audit) {
        this.users = users;
        this.auth = auth;
        this.connections = connections;
        this.audit = audit;
    }

    /** Auditoría de seguridad (exige audit:view). ?target_type=user|role&target_id=…&limit=… */
    @GetMapping("/audit")
    public List<Map<String, Object>> auditLog(@RequestParam(defaultValue = "100") int limit,
                                              @RequestParam(name = "target_type", required = false) String targetType,
                                              @RequestParam(name = "target_id", required = false) String targetId) {
        return audit.list(limit, targetType, targetId);
    }

    /** Permisos efectivos de una persona, con el motivo de cada uno (rol, concedido, denegado o ninguno). */
    @GetMapping("/{id}/effective")
    public Map<String, Object> effective(@PathVariable String id) {
        UserRecord u = users.get(id).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Usuario no encontrado: " + id));
        Map<String, String> why = Permissions.explain(u.role(), u.grant(), u.deny());
        List<Map<String, Object>> rows = new ArrayList<>();
        for (Permissions.Def d : Permissions.CATALOG) {
            Map<String, Object> m = new java.util.LinkedHashMap<>();
            m.put("id", d.id());
            m.put("label", d.label());
            m.put("module", d.module());
            m.put("action", d.action());
            m.put("risk", d.risk());
            String w = why.get(d.id());
            m.put("source", w);
            m.put("granted", "rol".equals(w) || "concedido".equals(w));
            rows.add(m);
        }
        Map<String, Object> out = new java.util.LinkedHashMap<>();
        out.put("user", u.toPublic());
        out.put("role", u.role());
        out.put("permissions", rows);
        out.put("granted", rows.stream().filter(r -> Boolean.TRUE.equals(r.get("granted"))).count());
        out.put("total", rows.size());
        return out;
    }

    private static String permSummary(List<String> grant, List<String> deny) {
        return "concedidos: " + (grant.isEmpty() ? "ninguno" : String.join(", ", grant)) + " · denegados: " + (deny.isEmpty() ? "ninguno" : String.join(", ", deny));
    }

    static void checkPassword(String pw) {
        if (pw == null || pw.length() < 8) {
            throw bad("La contraseña debe tener al menos 8 caracteres.");
        }
        if (pw.length() > 128) throw bad("La contraseña es demasiado larga (máximo 128).");
    }

    private static ResponseStatusException bad(String m) { return new ResponseStatusException(HttpStatus.BAD_REQUEST, m); }

    @SuppressWarnings("unchecked")
    private static List<String> permList(Object o) {
        if (o == null) return List.of();
        if (!(o instanceof List<?> l)) throw bad("Los permisos deben ser una lista.");
        List<String> out = new ArrayList<>();
        for (Object x : l) {
            String p = String.valueOf(x);
            if (!Permissions.validPermission(p)) throw bad("Permiso desconocido: " + p);
            if (!out.contains(p)) out.add(p);
        }
        return out;
    }

    @GetMapping
    public List<Map<String, Object>> list() {
        return users.list().stream().map(UserRecord::toPublic).toList();
    }

    @GetMapping("/{id}")
    public Map<String, Object> get(@PathVariable String id) {
        return users.get(id).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Usuario no encontrado: " + id)).toPublic();
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> create(HttpServletRequest req, @RequestBody Map<String, Object> body) {
        UserRecord me = AccessService.current(req);
        String email = UserRepository.normEmail(String.valueOf(body.getOrDefault("email", "")));
        String name = String.valueOf(body.getOrDefault("name", "")).trim();
        String password = body.get("password") == null ? null : String.valueOf(body.get("password"));
        String role = String.valueOf(body.getOrDefault("role", "viewer"));
        if (!EMAIL.matcher(email).matches()) throw bad("Ingresa un correo válido.");
        if (!Permissions.validRole(role)) throw bad("Rol inválido: " + role);
        checkPassword(password);
        if (users.findByEmail(email).isPresent()) throw new ResponseStatusException(HttpStatus.CONFLICT, "Ya existe un usuario con ese correo.");
        if (name.isBlank()) name = email.substring(0, email.indexOf('@'));
        boolean active = !Boolean.FALSE.equals(body.get("active"));
        List<String> grant = permList(body.get("grant")), deny = permList(body.get("deny"));
        guardPermissionChange(me, role, !grant.isEmpty() || !deny.isEmpty() || !"viewer".equals(role));
        UserRecord created = users.create(email, name, password, role, active, grant, deny);
        audit.log(me, "user.create", "user", created.id(), created.name() + " <" + created.email() + ">",
                "Creó la cuenta con rol " + Permissions.role(role).map(Permissions.RoleDef::label).orElse(role) + (grant.isEmpty() && deny.isEmpty() ? "" : " · " + permSummary(grant, deny)),
                Map.of("role", role, "grant", grant, "deny", deny));
        return created.toPublic();
    }

    /**
     * Cambiar el rol o los permisos de alguien es administrar permisos (roles:manage), no solo cuentas. Y solo un
     * administrador puede dar el rol de administrador: así nadie se escala a sí mismo.
     */
    private static void guardPermissionChange(UserRecord me, String newRole, boolean touchesAccess) {
        if (me == null) throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Sesión no válida.");
        if ("admin".equals(newRole) && !me.isAdmin()) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Solo un administrador puede asignar el rol Administrador.");
        if (touchesAccess && !me.has(Permissions.ROLES_MANAGE))
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Cambiar el rol o los permisos de una persona requiere «Roles y permisos» (roles:manage).");
    }

    @PutMapping("/{id}")
    public Map<String, Object> update(HttpServletRequest req, @PathVariable String id, @RequestBody Map<String, Object> body) {
        UserRecord me = AccessService.current(req);
        UserRecord u = users.get(id).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Usuario no encontrado: " + id));
        String email = body.containsKey("email") ? UserRepository.normEmail(String.valueOf(body.get("email"))) : u.email();
        String name = body.containsKey("name") ? String.valueOf(body.get("name")).trim() : u.name();
        String role = body.containsKey("role") ? String.valueOf(body.get("role")) : u.role();
        boolean active = body.containsKey("active") ? !Boolean.FALSE.equals(body.get("active")) : u.active();
        List<String> grant = body.containsKey("grant") ? permList(body.get("grant")) : u.grant();
        List<String> deny = body.containsKey("deny") ? permList(body.get("deny")) : u.deny();

        if (!EMAIL.matcher(email).matches()) throw bad("Ingresa un correo válido.");
        if (!Permissions.validRole(role)) throw bad("Rol inválido: " + role);
        if (name.isBlank()) throw bad("El nombre no puede estar vacío.");
        users.findByEmail(email).filter(o -> !o.id().equals(id)).ifPresent(o -> {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Ya existe un usuario con ese correo.");
        });
        boolean loosesAdmin = u.isAdmin() && u.active() && (!"admin".equals(role) || !active);
        if (loosesAdmin && users.activeAdmins() <= 1) throw bad("Debe quedar al menos un administrador activo.");
        if (me.id().equals(id) && !active) throw bad("No puedes desactivar tu propia cuenta.");
        if (me.id().equals(id) && !"admin".equals(role) && u.isAdmin()) throw bad("No puedes quitarte a ti mismo el rol de administrador.");

        boolean accessChanged = !role.equals(u.role()) || !grant.equals(u.grant()) || !deny.equals(u.deny());
        if (accessChanged) guardPermissionChange(me, role.equals(u.role()) ? "" : role, true);

        UserRecord saved = users.update(id, email, name, role, active, grant, deny).orElseThrow();
        String who = saved.name() + " <" + saved.email() + ">";
        if (!role.equals(u.role()))
            audit.log(me, "user.role", "user", id, who, "Rol: " + Permissions.role(u.role()).map(Permissions.RoleDef::label).orElse(u.role())
                    + " → " + Permissions.role(role).map(Permissions.RoleDef::label).orElse(role), Map.of("before", u.role(), "after", role));
        if (!grant.equals(u.grant()) || !deny.equals(u.deny()))
            audit.log(me, "user.permissions", "user", id, who, "Permisos individuales · " + permSummary(grant, deny),
                    Map.of("grant", io.datasense.auth.AuditRepository.diff(u.grant(), grant), "deny", io.datasense.auth.AuditRepository.diff(u.deny(), deny)));
        if (active != u.active()) audit.log(me, active ? "user.activate" : "user.deactivate", "user", id, who, active ? "Activó la cuenta" : "Desactivó la cuenta", null);
        // Si ya no puede usar conexiones, pierde las que le habían compartido.
        if (!saved.has(Permissions.CONNECTIONS)) connections.clearSharesFor(id);
        // Si cambió algo que afecta a su acceso, sus sesiones se cierran y debe entrar de nuevo.
        if (!active || accessChanged) {
            if (!me.id().equals(id)) auth.revokeAll(id);
        }
        return saved.toPublic();
    }

    @PutMapping("/{id}/password")
    public Map<String, Object> resetPassword(HttpServletRequest req, @PathVariable String id, @RequestBody Map<String, Object> body) {
        UserRecord u = users.get(id).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Usuario no encontrado: " + id));
        String pw = body.get("password") == null ? null : String.valueOf(body.get("password"));
        checkPassword(pw);
        users.setPassword(id, pw);
        auth.revokeAll(id);
        audit.log(AccessService.current(req), "user.password", "user", id, u.name() + " <" + u.email() + ">", "Restableció la contraseña (sesiones cerradas)", null);
        return Map.of("ok", true);
    }

    @DeleteMapping("/{id}")
    public Map<String, Object> delete(HttpServletRequest req, @PathVariable String id) {
        UserRecord me = AccessService.current(req);
        UserRecord u = users.get(id).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Usuario no encontrado: " + id));
        if (me.id().equals(id)) throw bad("No puedes eliminar tu propia cuenta.");
        if (u.isAdmin() && u.active() && users.activeAdmins() <= 1) throw bad("Debe quedar al menos un administrador activo.");
        auth.revokeAll(id);
        int moved = users.reassignApps(id, me.id());
        int conns = connections.reassign(id, me.id());
        users.delete(id);
        audit.log(me, "user.delete", "user", id, u.name() + " <" + u.email() + ">", "Eliminó la cuenta · " + moved + " app(s) y " + conns + " conexión(es) pasan a " + me.name(), null);
        return Map.of("ok", true, "apps_reassigned", moved, "connections_reassigned", conns);
    }
}
