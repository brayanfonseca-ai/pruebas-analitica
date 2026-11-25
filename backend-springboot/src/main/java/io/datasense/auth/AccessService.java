package io.datasense.auth;

import io.datasense.model.AppModels.AppOut;

import org.springframework.stereotype.Service;

import jakarta.servlet.http.HttpServletRequest;

import java.util.List;
import java.util.Map;

/**
 * Reglas de visibilidad por etapa.
 *
 * <ul>
 *   <li><b>personal</b>: solo su dueño (y el administrador).</li>
 *   <li><b>desarrollo</b>: el equipo técnico (quien puede editar tableros o cargar datos) y el administrador.</li>
 *   <li><b>produccion</b>: cualquiera con {@code dashboard:view}. Un visualizador solo ve las hojas publicadas.</li>
 * </ul>
 * Modificar una app en Producción exige {@code apps:publish}.
 */
@Service
public class AccessService {

    public static final String USER_ATTR = "ds.user";

    /** Permisos que hacen a alguien parte del equipo técnico (ve las apps en Desarrollo). */
    private static final List<String> BUILDER = List.of(Permissions.SHEETS_CREATE, Permissions.SHEETS_EDIT, Permissions.DATA_SCRIPT,
            Permissions.DATA_RELOAD, Permissions.DATA_UPLOAD, Permissions.DATA_MODEL, Permissions.BUSINESS_EDIT);

    public static UserRecord current(HttpServletRequest req) {
        Object u = req.getAttribute(USER_ATTR);
        return u instanceof UserRecord ur ? ur : null;
    }

    public boolean canSee(UserRecord u, AppOut app) {
        if (u == null) return false;
        if (u.isAdmin()) return true;
        if (u.id().equals(app.owner_id())) return true;
        return switch (app.stage()) {
            case "personal" -> false;
            // Desarrollo: el equipo técnico, es decir, quien construye hojas, datos o la capa de negocio.
            case "desarrollo" -> BUILDER.stream().anyMatch(u::has);
            default -> u.has(Permissions.APPS_VIEW);
        };
    }

    public boolean canWrite(UserRecord u, AppOut app) {
        if (u == null) return false;
        if (u.isAdmin()) return true;
        return switch (app.stage()) {
            case "personal" -> u.id().equals(app.owner_id());
            case "produccion" -> u.has(Permissions.PUBLISH);
            default -> true;
        };
    }

    public List<AppOut> visibleApps(UserRecord u, List<AppOut> all) {
        return all.stream().filter(a -> canSee(u, a)).toList();
    }

    /** Un visualizador (sin permiso de edición) solo recibe las hojas publicadas. */
    public List<Map<String, Object>> visibleSheets(UserRecord u, List<Map<String, Object>> sheets) {
        if (u != null && (u.isAdmin() || u.has(Permissions.SHEETS_EDIT) || u.has(Permissions.SHEETS_PUBLISH))) return sheets;
        return sheets.stream().filter(s -> "publica".equals(s.get("visibility"))).toList();
    }
}
