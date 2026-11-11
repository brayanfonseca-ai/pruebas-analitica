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

    public UserController(UserRepository users, AuthService auth) {
        this.users = users;
        this.auth = auth;
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
    public Map<String, Object> create(@RequestBody Map<String, Object> body) {
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
        return users.create(email, name, password, role, active, permList(body.get("grant")), permList(body.get("deny"))).toPublic();
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

        UserRecord saved = users.update(id, email, name, role, active, grant, deny).orElseThrow();
        // Si cambió algo que afecta a su acceso, sus sesiones se cierran y debe entrar de nuevo.
        if (!active || !role.equals(u.role()) || !grant.equals(u.grant()) || !deny.equals(u.deny())) {
            if (!me.id().equals(id)) auth.revokeAll(id);
        }
        return saved.toPublic();
    }

    @PutMapping("/{id}/password")
    public Map<String, Object> resetPassword(@PathVariable String id, @RequestBody Map<String, Object> body) {
        users.get(id).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Usuario no encontrado: " + id));
        String pw = body.get("password") == null ? null : String.valueOf(body.get("password"));
        checkPassword(pw);
        users.setPassword(id, pw);
        auth.revokeAll(id);
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
        users.delete(id);
        return Map.of("ok", true, "apps_reassigned", moved);
    }
}
