package io.datasense.auth;

import io.datasense.embed.EmbedService;
import io.datasense.model.AppModels.AppOut;
import io.datasense.repo.AppRepository;
import io.datasense.repo.ExperimentRepository;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.Optional;

/**
 * Guarda de TODA la API ({@code /api/v1/**}): exige sesión (Bearer), aplica el permiso que pide cada
 * ruta ({@link Permissions#required}) y las reglas de etapa sobre la app a la que apunta la ruta
 * (una app que el usuario no puede ver responde 404, como si no existiera).
 * Única ruta pública: {@code POST /api/v1/auth/login}.
 *
 * <p>Un Bearer que empieza por {@code dse_} es un token de embedding: actúa como visualizador de
 * solo lectura limitado a la app de su embed.</p>
 */
@Component
public class AuthInterceptor implements HandlerInterceptor {

    private static final String PREFIX = "/api/v1";

    /** Atributo con el {@code EmbedRecord} cuando la petición viene de un token de embedding. */
    public static final String EMBED_ATTR = "ds.embed";

    private final AuthService auth;
    private final AccessService access;
    private final AppRepository apps;
    private final EmbedService embeds;
    private final ExperimentRepository experiments;

    public AuthInterceptor(AuthService auth, AccessService access, AppRepository apps,
                           EmbedService embeds, ExperimentRepository experiments) {
        this.auth = auth;
        this.access = access;
        this.apps = apps;
        this.embeds = embeds;
        this.experiments = experiments;
    }

    @Override
    public boolean preHandle(HttpServletRequest req, HttpServletResponse res, Object handler) throws Exception {
        String method = req.getMethod();
        if ("OPTIONS".equals(method)) return true;
        String uri = req.getRequestURI();
        String path = uri.startsWith(PREFIX) ? uri.substring(PREFIX.length()) : uri;
        if (path.endsWith("/") && path.length() > 1) path = path.substring(0, path.length() - 1);

        if ("POST".equals(method) && path.equals("/auth/login")) return true;

        String token = bearer(req);
        if (token != null && token.startsWith("dse_")) return embedRequest(req, res, method, path, token);
        Optional<UserRecord> found = auth.validate(token);
        if (found.isEmpty()) return deny(res, 401, "Sesión no válida o vencida. Inicia sesión de nuevo.");
        UserRecord user = found.get();
        req.setAttribute(AccessService.USER_ATTR, user);
        req.setAttribute("ds.token", token);

        if (path.startsWith("/auth/")) return true; // me, logout, password, catalog: cualquier usuario autenticado

        String need = Permissions.required(method, path);
        if (!user.has(need)) {
            return deny(res, 403, "No tienes permiso para esta acción (" + need + ").");
        }

        // Experimentos de ML: la lectura exige poder ver la app a la que pertenece el experimento.
        String expId = experimentIdOf(path);
        if (expId != null && !Permissions.ML.equals(need)) {
            Optional<Map<String, Object>> exp = experiments.get(expId);
            if (exp.isPresent() && exp.get().get("app_id") != null) {
                Optional<AppOut> eapp = apps.getApp(String.valueOf(exp.get().get("app_id")));
                if (eapp.isPresent() && !access.canSee(user, eapp.get())) return deny(res, 404, "Experimento no encontrado.");
            }
        }

        String appId = Permissions.appIdOf(path);
        if (appId != null) {
            Optional<AppOut> app = apps.getApp(appId);
            if (app.isPresent()) {
                if (!access.canSee(user, app.get())) return deny(res, 404, "App no encontrada: " + appId);
                boolean read = "GET".equals(method) || "HEAD".equals(method);
                boolean writes = !read && !Permissions.VIEW.equals(need);
                if (writes && !access.canWrite(user, app.get())) {
                    String why = "produccion".equals(app.get().stage())
                            ? "La app está en Producción: solo quien puede publicar (apps:publish) puede modificarla."
                            : "La app está en etapa Personal de otro usuario.";
                    return deny(res, 403, why);
                }
            }
        }
        return true;
    }

    private static String experimentIdOf(String path) {
        if (!path.startsWith("/ml/experiments/")) return null;
        String[] s = path.split("/"); // ["", "ml", "experiments", id, ...]
        return s.length >= 4 && !s[3].isBlank() ? s[3] : null;
    }

    /** Token de embedding: visualizador de solo lectura limitado a SU app y a las rutas que necesita el tablero. */
    private boolean embedRequest(HttpServletRequest req, HttpServletResponse res, String method, String path, String token)
            throws java.io.IOException {
        EmbedService.Authn a = embeds.authenticate(token);
        if (!a.ok()) return deny(res, a.status(), a.error());
        var e = a.embed();
        boolean read = "GET".equals(method) || "HEAD".equals(method);
        String need = Permissions.required(method, path);
        if (!a.user().has(need)) return deny(res, 403, "El token de embedding es de solo lectura.");
        String appId = Permissions.appIdOf(path);
        boolean ownApp = appId != null && appId.equals(e.appId());
        boolean ownMl = false;
        String expId = experimentIdOf(path);
        if (read && expId != null) {
            ownMl = experiments.get(expId).map(m -> e.appId().equals(String.valueOf(m.get("app_id")))).orElse(false);
        }
        if (!ownApp && !ownMl) return deny(res, 403, "Este token solo da acceso a su tablero.");
        req.setAttribute(AccessService.USER_ATTR, a.user());
        req.setAttribute(EMBED_ATTR, e);
        return true;
    }

    private static String bearer(HttpServletRequest req) {
        String h = req.getHeader("Authorization");
        return h != null && h.regionMatches(true, 0, "Bearer ", 0, 7) ? h.substring(7).trim() : null;
    }

    private static boolean deny(HttpServletResponse res, int status, String detail) throws java.io.IOException {
        res.setStatus(status);
        res.setContentType("application/json;charset=UTF-8");
        String safe = detail.replace("\\", "\\\\").replace("\"", "\\\"");
        res.getOutputStream().write(("{\"detail\":\"" + safe + "\",\"status\":" + status + "}").getBytes(StandardCharsets.UTF_8));
        return false;
    }
}
