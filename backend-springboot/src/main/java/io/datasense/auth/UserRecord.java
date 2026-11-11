package io.datasense.auth;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Usuario de la plataforma (fila de {@code users}). {@code passwordHash} nunca sale al exterior. */
public record UserRecord(String id, String email, String name, String role, boolean active,
                         List<String> grant, List<String> deny,
                         String createdAt, String updatedAt, String lastLogin, String passwordHash) {

    public Set<String> permissions() {
        return Permissions.effective(role, grant, deny);
    }

    public boolean has(String permission) {
        return permissions().contains(permission);
    }

    public boolean isAdmin() {
        return "admin".equals(role);
    }

    /** Representación para la API (sin hash). Incluye los permisos efectivos ya calculados. */
    public Map<String, Object> toPublic() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", id);
        m.put("email", email);
        m.put("name", name);
        m.put("role", role);
        m.put("active", active);
        m.put("grant", grant);
        m.put("deny", deny);
        m.put("permissions", List.copyOf(permissions()));
        m.put("created_at", createdAt);
        m.put("updated_at", updatedAt);
        m.put("last_login", lastLogin);
        return m;
    }
}
