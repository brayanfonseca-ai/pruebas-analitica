package io.datasense.web;

import io.datasense.auth.AccessService;
import io.datasense.auth.AuthService;
import io.datasense.auth.AuthService.Login;
import io.datasense.auth.Permissions;
import io.datasense.auth.UserRecord;
import io.datasense.auth.UserRepository;

import jakarta.servlet.http.HttpServletRequest;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Sesión y catálogo de seguridad.
 * <ul>
 *   <li>{@code POST /api/v1/auth/login} {email, password} → {token, expires_at, user} (público)</li>
 *   <li>{@code GET  /api/v1/auth/me} → usuario con permisos efectivos</li>
 *   <li>{@code POST /api/v1/auth/logout}</li>
 *   <li>{@code PUT  /api/v1/auth/password} {current, password} → cambia la contraseña propia</li>
 *   <li>{@code GET  /api/v1/auth/catalog} → roles, permisos y etapas</li>
 * </ul>
 */
@RestController
@RequestMapping("/api/v1/auth")
public class AuthController {

    private final AuthService auth;
    private final UserRepository users;

    public AuthController(AuthService auth, UserRepository users) {
        this.auth = auth;
        this.users = users;
    }

    @PostMapping("/login")
    public Map<String, Object> login(@RequestBody Map<String, Object> body) {
        String email = String.valueOf(body.getOrDefault("email", ""));
        String password = String.valueOf(body.getOrDefault("password", ""));
        if (email.isBlank() || password.isBlank() || "null".equals(password)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Ingresa tu correo y tu contraseña.");
        }
        Login l = auth.login(email, password);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("token", l.token());
        out.put("expires_at", l.expiresAt());
        out.put("user", l.user().toPublic());
        return out;
    }

    @GetMapping("/me")
    public Map<String, Object> me(HttpServletRequest req) {
        return AccessService.current(req).toPublic();
    }

    @PostMapping("/logout")
    public Map<String, Object> logout(HttpServletRequest req) {
        auth.logout((String) req.getAttribute("ds.token"));
        return Map.of("ok", true);
    }

    @PutMapping("/password")
    public Map<String, Object> password(HttpServletRequest req, @RequestBody Map<String, Object> body) {
        UserRecord me = AccessService.current(req);
        String current = String.valueOf(body.getOrDefault("current", ""));
        String next = String.valueOf(body.getOrDefault("password", ""));
        if (!io.datasense.auth.PasswordHasher.verify(current, me.passwordHash())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "La contraseña actual no es correcta.");
        }
        UserController.checkPassword(next);
        users.setPassword(me.id(), next);
        // Cierra todas las sesiones (incluida esta) y devuelve una nueva con la contraseña ya cambiada.
        auth.revokeAll(me.id());
        Login l = auth.login(me.email(), next);
        return Map.of("ok", true, "token", l.token(), "expires_at", l.expiresAt());
    }

    @GetMapping("/catalog")
    public Map<String, Object> catalog() {
        List<Map<String, Object>> roles = Permissions.roles().stream().map(r -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", r.id());
            m.put("label", r.label());
            m.put("description", r.description());
            m.put("permissions", Permissions.roleDefaults(r.id()));
            m.put("factory", Permissions.factoryDefaults(r.id()));
            m.put("customized", Permissions.isCustomized(r.id()));
            m.put("custom", Permissions.isCustomRole(r.id()));
            m.put("editable", !"admin".equals(r.id()));
            return m;
        }).toList();
        List<Map<String, Object>> perms = Permissions.CATALOG.stream().map(d -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", d.id());
            m.put("label", d.label());
            m.put("group", d.group());
            m.put("module", d.module());
            m.put("action", d.action());
            m.put("risk", d.risk());
            m.put("description", d.description());
            return m;
        }).toList();
        List<Map<String, Object>> modules = Permissions.MODULES.stream().map(x -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", x.id());
            m.put("label", x.label());
            m.put("icon", x.icon());
            m.put("description", x.description());
            return m;
        }).toList();
        List<Map<String, Object>> legacy = Permissions.LEGACY.stream().map(l -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", l.id());
            m.put("label", l.label());
            m.put("anchor", l.anchor());
            m.put("covers", l.covers());
            return m;
        }).toList();
        List<Map<String, Object>> stages = List.of(
                Map.of("id", "personal", "label", "Personal", "description", "Solo la ve su dueño. Es donde nace cada aplicación."),
                Map.of("id", "desarrollo", "label", "Desarrollo", "description", "La ve el equipo técnico para construir y probar. Los visualizadores no la ven."),
                Map.of("id", "produccion", "label", "Producción", "description", "Publicada: la ven los visualizadores, pero solo las hojas marcadas como publicadas."));
        List<Map<String, Object>> actions = List.of(
                Map.of("id", "ver", "label", "Ver"), Map.of("id", "crear", "label", "Crear"), Map.of("id", "editar", "label", "Editar"),
                Map.of("id", "eliminar", "label", "Eliminar"), Map.of("id", "publicar", "label", "Publicar"), Map.of("id", "ejecutar", "label", "Ejecutar"),
                Map.of("id", "exportar", "label", "Exportar"), Map.of("id", "administrar", "label", "Administrar"));
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("roles", roles);
        out.put("permissions", perms);
        out.put("modules", modules);
        out.put("actions", actions);
        out.put("legacy", legacy);
        out.put("stages", stages);
        return out;
    }
}
