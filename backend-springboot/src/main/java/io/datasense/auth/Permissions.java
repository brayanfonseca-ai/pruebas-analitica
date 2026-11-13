package io.datasense.auth;

import java.util.*;

/**
 * Catálogo de roles, permisos y etapas de DataSense, y la regla que decide qué permiso exige cada
 * endpoint. Fuente de verdad única: el frontend (página Configuración) y el MCP lo leen de
 * {@code GET /api/v1/auth/catalog}.
 *
 * <p><b>Roles</b>: {@code admin} (todo, no se le puede restringir), {@code editor} (desarrollador:
 * construye aplicaciones, datos, hojas y modelos) y {@code viewer} (solo ve lo publicado).
 * Cada usuario puede además tener permisos concedidos o denegados a título individual.</p>
 *
 * <p><b>Etapas</b> de una aplicación: {@code personal} (solo su dueño), {@code desarrollo} (equipo
 * técnico) y {@code produccion} (publicada: la ven todos los que tengan {@code dashboard:view};
 * un visualizador solo ve además las hojas marcadas como publicadas).</p>
 */
public final class Permissions {

    public static final String VIEW = "dashboard:view";
    public static final String APPS_CREATE = "apps:create";
    public static final String APPS_DELETE = "apps:delete";
    public static final String EDIT = "charts:edit";
    public static final String DATA = "data:import";
    public static final String CONNECTIONS = "connections:manage";
    public static final String ML = "ml:run";
    public static final String AI = "ai:use";
    public static final String PUBLISH = "apps:publish";
    public static final String USERS = "users:manage";
    public static final String EMBED = "embed:manage";

    public record Def(String id, String label, String group, String description) {}

    public static final List<Def> CATALOG = List.of(
            new Def(VIEW, "Ver tableros publicados", "Visualización", "Abrir aplicaciones publicadas y consultar sus hojas."),
            new Def(AI, "Usar el asistente de IA", "Visualización", "Hacer preguntas al asistente sobre los datos."),
            new Def(APPS_CREATE, "Crear aplicaciones", "Construcción", "Crear aplicaciones nuevas (quedan en etapa Personal)."),
            new Def(EDIT, "Editar tableros", "Construcción", "Crear y modificar hojas, gráficos, elementos maestros y el modelo lógico."),
            new Def(DATA, "Cargar y preparar datos", "Construcción", "Subir archivos, editar el script de carga, asociaciones y campos."),
            new Def(CONNECTIONS, "Gestionar conexiones", "Construcción", "Crear y usar conexiones de datos (S3, Athena, bases de datos)."),
            new Def(ML, "Experimentos de ML", "Construcción", "Crear experimentos, entrenar modelos y asociarlos a una app."),
            new Def(APPS_DELETE, "Eliminar aplicaciones", "Gobierno", "Borrar aplicaciones completas."),
            new Def(PUBLISH, "Publicar", "Gobierno", "Pasar una app a Producción, publicar hojas y editar lo ya publicado."),
            new Def(USERS, "Administrar usuarios", "Gobierno", "Configuración: usuarios, roles, permisos y etapas."),
            new Def(EMBED, "Gestionar embedding", "Gobierno", "Crear y revocar tokens para incrustar tableros publicados en otras páginas web."));

    public record RoleDef(String id, String label, String description, List<String> permissions) {}

    public static final List<RoleDef> ROLE_DEFS = List.of(
            new RoleDef("admin", "Administrador", "Control total de la plataforma. No se le puede restringir.",
                    CATALOG.stream().map(Def::id).toList()),
            new RoleDef("editor", "Desarrollador", "Construye y publica aplicaciones, datos, hojas y modelos; no administra usuarios.",
                    List.of(VIEW, AI, APPS_CREATE, EDIT, DATA, CONNECTIONS, ML, PUBLISH)),
            new RoleDef("viewer", "Visualizador", "Solo ve las aplicaciones en Producción y sus hojas publicadas.",
                    List.of(VIEW)));

    public static final List<String> ROLES = ROLE_DEFS.stream().map(RoleDef::id).toList();
    public static final List<String> STAGES = List.of("personal", "desarrollo", "produccion");

    private Permissions() {}

    public static boolean validRole(String r) { return r != null && ROLES.contains(r); }
    public static boolean validPermission(String p) { return CATALOG.stream().anyMatch(d -> d.id().equals(p)); }
    public static boolean validStage(String s) { return s != null && STAGES.contains(s); }

    /** Permisos personalizados por el administrador para un rol (Configuración → Roles y permisos). */
    private static final java.util.concurrent.ConcurrentHashMap<String, Set<String>> OVERRIDES = new java.util.concurrent.ConcurrentHashMap<>();

    /** Fija (o, con null, quita) los permisos personalizados de un rol. El administrador no se puede cambiar. */
    public static void setRoleOverride(String role, Collection<String> perms) {
        if (!validRole(role) || "admin".equals(role)) return;
        if (perms == null) OVERRIDES.remove(role); else OVERRIDES.put(role, new LinkedHashSet<>(perms));
    }

    public static boolean isCustomized(String role) { return OVERRIDES.containsKey(role); }

    /** Permisos de fábrica del rol (sin personalizar). */
    public static Set<String> factoryDefaults(String role) {
        return ROLE_DEFS.stream().filter(r -> r.id().equals(role)).findFirst()
                .map(r -> (Set<String>) new LinkedHashSet<>(r.permissions())).orElseGet(LinkedHashSet::new);
    }

    public static Set<String> roleDefaults(String role) {
        Set<String> custom = OVERRIDES.get(role);
        if (custom != null) return new LinkedHashSet<>(custom);
        return ROLE_DEFS.stream().filter(r -> r.id().equals(role)).findFirst()
                .map(r -> (Set<String>) new LinkedHashSet<>(r.permissions())).orElseGet(LinkedHashSet::new);
    }

    /** Permisos efectivos = (los del rol + concedidos) − denegados. El administrador siempre tiene todos. */
    public static Set<String> effective(String role, Collection<String> grant, Collection<String> deny) {
        if ("admin".equals(role)) return roleDefaults("admin");
        Set<String> s = roleDefaults(role);
        if (grant != null) s.addAll(grant);
        if (deny != null) s.removeAll(deny);
        return s;
    }

    /**
     * Permiso que exige una petición a {@code /api/v1/**}. {@code path} viene SIN el prefijo
     * {@code /api/v1} (p. ej. {@code /apps/ab12/sheets}).
     */
    public static String required(String method, String path) {
        boolean read = "GET".equals(method) || "HEAD".equals(method);
        if (path.startsWith("/users") || path.startsWith("/notifications")) return USERS;
        if (path.startsWith("/connections")) return CONNECTIONS;
        if (path.startsWith("/embeds")) return EMBED;
        // Lectura de un experimento/corrida: la necesitan los tableros publicados que muestran gráficos de ML.
        if (read && path.matches("/ml/experiments/[^/]+(/runs/[^/]+)?")) return VIEW;
        if (path.startsWith("/ml/")) return ML;
        if (path.startsWith("/ai")) return read ? VIEW : AI;
        if (path.startsWith("/collections")) return read ? VIEW : EDIT;
        if (path.equals("/apps")) return read ? VIEW : APPS_CREATE;
        if (path.startsWith("/apps/")) {
            String[] s = path.split("/"); // ["", "apps", id, sub, ...]
            if (s.length <= 3) return read ? VIEW : ("DELETE".equals(method) ? APPS_DELETE : EDIT);
            String sub = s[3];
            String tail = path.substring(("/apps/" + s[2]).length());
            if (tail.equals("/stage")) return VIEW; // lo valida el controlador (reglas por etapa)
            if (sub.equals("query") || tail.equals("/fields/values") || tail.equals("/expressions/parse")) return VIEW;
            // Comentarios: cualquiera que vea la hoja conversa sobre ella (el controlador limita borrar/resolver).
            if (sub.equals("comments")) return VIEW;
            // Certificar una métrica la convierte en definición oficial: es una acción de gobierno.
            if (sub.equals("master-items") && tail.endsWith("/certify")) return PUBLISH;
            if (sub.equals("connections")) return CONNECTIONS;
            if (sub.equals("ml")) return ML;
            if (sub.equals("script")) return DATA;
            if (sub.equals("notes")) return EDIT; // diccionario de datos: lo escribe y lee quien construye
            if (sub.equals("sheets")) return tail.endsWith("/visibility") ? PUBLISH : (read ? VIEW : EDIT);
            if (read) return VIEW;
            if (sub.equals("tables") || sub.equals("associations") || sub.equals("field-overrides")) return DATA;
            return EDIT;
        }
        return read ? VIEW : EDIT;
    }

    /** Id de la app a la que apunta la ruta ({@code /apps/{id}/…}), o null. */
    public static String appIdOf(String path) {
        if (!path.startsWith("/apps/")) return null;
        String[] s = path.split("/");
        return s.length >= 3 && !s[2].isBlank() ? s[2] : null;
    }
}
