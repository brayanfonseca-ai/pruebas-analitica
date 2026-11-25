package io.datasense.auth;

import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Catálogo de roles, permisos y etapas de PROTHEO, y la regla que decide qué permiso exige cada
 * endpoint. Fuente de verdad única: el frontend (página Configuración) y el MCP lo leen de
 * {@code GET /api/v1/auth/catalog}.
 *
 * <p><b>Permisos detallados</b> ({@link #CATALOG}): uno por acción y módulo ({@code sheets:delete},
 * {@code data:reload}, {@code business:certify}…), con su tipo de acción y su nivel de riesgo. Son la fuente de
 * verdad de lo que puede hacer cada persona.</p>
 *
 * <p><b>Permisos de compatibilidad</b> ({@link #LEGACY}): los 11 permisos anteriores ({@code charts:edit},
 * {@code data:import}…) siguen existiendo como nombres derivados. Una persona «tiene» {@code charts:edit} si tiene
 * su permiso ancla ({@code sheets:edit}); así el código y las integraciones que los usaban siguen funcionando. Si un
 * rol o usuario guardado antes trae un permiso antiguo concedido o denegado, se expande a los detallados que
 * cubría.</p>
 *
 * <p><b>Roles</b>: {@code admin} (todo, no se le puede restringir), {@code editor} (desarrollador),
 * {@code viewer} (visualizador) y los <b>roles personalizados</b> que cree el administrador. Cada usuario puede además
 * tener permisos concedidos o denegados a título individual.</p>
 *
 * <p><b>Etapas</b>: {@code personal} (solo su dueño), {@code desarrollo} (equipo técnico) y {@code produccion}.</p>
 */
public final class Permissions {

    /* ---------------- Permisos de compatibilidad (nombres anteriores) ---------------- */
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

    /* ---------------- Permisos detallados ---------------- */
    public static final String APPS_VIEW = "apps:view", APPS_EDIT = "apps:edit";
    public static final String SHEETS_CREATE = "sheets:create", SHEETS_EDIT = "sheets:edit", SHEETS_DELETE = "sheets:delete", SHEETS_PUBLISH = "sheets:publish";
    public static final String DATA_UPLOAD = "data:upload", DATA_SCRIPT = "data:script", DATA_RELOAD = "data:reload", DATA_MODEL = "data:model", DATA_SCHEDULE = "data:schedule";
    public static final String BUSINESS_EDIT = "business:edit", BUSINESS_CERTIFY = "business:certify", NOTES_EDIT = "notes:edit";
    public static final String ASK = "analysis:ask", INSIGHTS = "analysis:insights", NOTEBOOKS_RUN = "analysis:notebooks", NOTEBOOKS_EDIT = "notebooks:edit", COMMENTS = "comments:write";
    public static final String REPORTS_VIEW = "reports:view", REPORTS_EXPORT = "reports:export";
    public static final String AI_CHAT = "ai:chat", AI_EXPR = "ai:expressions";
    public static final String AGENTS_USE = "agents:use", AGENTS_BUILD = "agents:build", KNOWLEDGE = "knowledge:use";
    public static final String ML_VIEW = "ml:view", ML_TRAIN = "ml:train", ML_ASSOCIATE = "ml:associate";
    public static final String FLOWS_VIEW = "flows:view", FLOWS_EDIT = "flows:edit", FLOWS_RUN = "flows:run";
    public static final String ALERTS = "alerts:manage";
    public static final String CONN_USE = "connections:use", CONN_SHARE = "connections:share";
    public static final String ROLES_MANAGE = "roles:manage", AUDIT = "audit:view";

    /** Módulo del catálogo (sección de la matriz). */
    public record Module(String id, String label, String icon, String description) {}

    public static final List<Module> MODULES = List.of(
            new Module("apps", "Aplicaciones", "grid", "Abrir, crear, organizar y publicar aplicaciones."),
            new Module("sheets", "Hojas y tableros", "layout", "Construir y publicar los tableros de cada app."),
            new Module("data", "Datos", "db", "Archivos, script de carga, modelo y cargas programadas."),
            new Module("business", "Capa de negocio", "layers", "Medidas y dimensiones oficiales, modelo lógico y notas."),
            new Module("analysis", "Análisis", "search", "Pregúntale a tus datos, qué cambió, cuadernos y comentarios."),
            new Module("reports", "Informes", "doc", "Historias de datos, presentaciones y PDF."),
            new Module("ai", "Asistente de IA", "spark", "Asistente conversacional y ayuda para escribir expresiones."),
            new Module("agents", "Agentes y conocimiento", "bot", "Agentes de IA propios y base de conocimiento."),
            new Module("ml", "Machine Learning", "brain", "Experimentos, entrenamiento y resultados en apps."),
            new Module("flows", "Automatizaciones", "flow", "Flujos por nodos: correo, WhatsApp, Teams, HTTP."),
            new Module("alerts", "Alertas y vigilancia", "bell", "Alertas, listas de acción y agente de guardia."),
            new Module("connections", "Conexiones", "plug", "Conexiones a S3, Athena y bases de datos."),
            new Module("embed", "Embedding", "code", "Incrustar tableros en otras páginas web."),
            new Module("admin", "Administración", "shield", "Usuarios, roles, permisos y auditoría."));

    /** Tipo de acción (columna de color en la matriz) y nivel de riesgo (bajo, medio, alto). */
    public record Def(String id, String label, String group, String description, String module, String action, String risk) {}

    private static Def d(String id, String module, String action, String risk, String label, String description) {
        String group = MODULES.stream().filter(m -> m.id().equals(module)).findFirst().map(Module::label).orElse(module);
        return new Def(id, label, group, description, module, action, risk);
    }

    public static final List<Def> CATALOG = List.of(
            d(APPS_VIEW, "apps", "ver", "bajo", "Ver aplicaciones y tableros", "Abrir las aplicaciones a las que tiene acceso y consultar sus hojas y datos."),
            d(APPS_CREATE, "apps", "crear", "bajo", "Crear aplicaciones", "Crear aplicaciones nuevas (nacen en etapa Personal)."),
            d(APPS_EDIT, "apps", "editar", "medio", "Editar aplicaciones", "Renombrar, cambiar la descripción y organizar en colecciones."),
            d(APPS_DELETE, "apps", "eliminar", "alto", "Eliminar aplicaciones", "Borrar aplicaciones completas con sus datos y hojas."),
            d(PUBLISH, "apps", "publicar", "alto", "Publicar aplicaciones", "Pasar una app a Producción o sacarla, y modificar lo que ya está publicado."),

            d(SHEETS_CREATE, "sheets", "crear", "bajo", "Crear hojas", "Hojas nuevas, plantillas y «De archivo a tablero»."),
            d(SHEETS_EDIT, "sheets", "editar", "medio", "Editar hojas y gráficos", "Cambiar objetos, gráficos, filtros y diseño de las hojas."),
            d(SHEETS_DELETE, "sheets", "eliminar", "medio", "Eliminar hojas", "Borrar hojas de una aplicación."),
            d(SHEETS_PUBLISH, "sheets", "publicar", "alto", "Publicar hojas", "Hacer visible una hoja para los visualizadores o devolverla a borrador."),

            d(DATA_UPLOAD, "data", "crear", "medio", "Subir archivos y tablas", "Cargar Excel/CSV y borrar tablas de una app."),
            d(DATA_SCRIPT, "data", "editar", "medio", "Editar el script de carga", "Leer y modificar el script SQL de carga."),
            d(DATA_RELOAD, "data", "ejecutar", "medio", "Cargar datos", "Ejecutar el script de carga («Cargar datos») y recargar desde automatizaciones."),
            d(DATA_MODEL, "data", "editar", "medio", "Modelar datos", "Asociaciones entre tablas y preparación de campos."),
            d(DATA_SCHEDULE, "data", "ejecutar", "medio", "Programar cargas", "Crear o cambiar la carga programada de una app."),

            d(BUSINESS_EDIT, "business", "editar", "medio", "Medidas, dimensiones y modelo lógico", "Crear y editar elementos maestros y el modelo lógico."),
            d(BUSINESS_CERTIFY, "business", "publicar", "alto", "Certificar métricas", "Marcar una medida como definición oficial y modificar las certificadas."),
            d(NOTES_EDIT, "business", "editar", "bajo", "Notas para agente", "Escribir el diccionario de datos que leen la IA y el MCP."),

            d(ASK, "analysis", "ver", "bajo", "Pregúntale a tus datos", "Hacer preguntas en español y ver cómo se calculó la respuesta."),
            d(INSIGHTS, "analysis", "ver", "bajo", "Qué cambió, registros y simulación", "Análisis de solo lectura: variaciones, búsqueda de registros y «¿qué pasaría si…?»."),
            d(NOTEBOOKS_RUN, "analysis", "ejecutar", "bajo", "Ejecutar cuadernos", "Correr celdas de los cuadernos de análisis."),
            d(NOTEBOOKS_EDIT, "analysis", "editar", "bajo", "Guardar cuadernos", "Crear, guardar y borrar cuadernos propios."),
            d(COMMENTS, "analysis", "crear", "bajo", "Comentar", "Escribir comentarios en las hojas."),

            d(REPORTS_VIEW, "reports", "ver", "bajo", "Ver informes e historias", "Abrir Informes, la historia de datos y el modo presentación."),
            d(REPORTS_EXPORT, "reports", "exportar", "medio", "Descargar informes en PDF", "Exportar informes y presentaciones a PDF."),

            d(AI_CHAT, "ai", "ejecutar", "bajo", "Usar el asistente de IA", "Conversar con el asistente sobre los datos."),
            d(AI_EXPR, "ai", "ejecutar", "bajo", "Ayuda de IA para expresiones", "Pedir a la IA que escriba medidas y dimensiones."),

            d(AGENTS_USE, "agents", "ejecutar", "bajo", "Conversar con agentes", "Usar los agentes publicados."),
            d(AGENTS_BUILD, "agents", "editar", "medio", "Crear y editar agentes", "Diseñar agentes: rol, herramientas, conocimiento y límites."),
            d(KNOWLEDGE, "agents", "administrar", "bajo", "Base de conocimiento", "Activar, consultar y limpiar la base de conocimiento propia."),

            d(ML_VIEW, "ml", "ver", "bajo", "Ver experimentos", "Abrir experimentos de ML y sus resultados."),
            d(ML_TRAIN, "ml", "ejecutar", "medio", "Crear y entrenar modelos", "Crear experimentos y entrenar algoritmos."),
            d(ML_ASSOCIATE, "ml", "publicar", "medio", "Asociar resultados a apps", "Llevar el resultado de un modelo a una app como tabla y hoja."),

            d(FLOWS_VIEW, "flows", "ver", "bajo", "Ver automatizaciones", "Abrir automatizaciones y su historial."),
            d(FLOWS_EDIT, "flows", "editar", "medio", "Crear y editar automatizaciones", "Diseñar flujos, credenciales y activarlos."),
            d(FLOWS_RUN, "flows", "ejecutar", "medio", "Ejecutar automatizaciones", "Correr un flujo a mano (envía correos, WhatsApp o llama APIs)."),

            d(ALERTS, "alerts", "crear", "bajo", "Alertas y listas de acción", "Crear alertas, listas de acción y el agente de guardia."),

            d(CONN_USE, "connections", "crear", "medio", "Crear y usar conexiones", "Conexiones propias a S3, Athena y bases de datos."),
            d(CONN_SHARE, "connections", "administrar", "alto", "Compartir conexiones", "Dar acceso a otras personas a una conexión propia."),

            d(EMBED, "embed", "administrar", "alto", "Gestionar embedding", "Crear y revocar tokens para incrustar tableros."),

            d(USERS, "admin", "administrar", "alto", "Administrar usuarios", "Crear, editar, desactivar y borrar usuarios."),
            d(ROLES_MANAGE, "admin", "administrar", "alto", "Roles y permisos", "Crear roles y cambiar sus permisos o los de cada persona."),
            d(AUDIT, "admin", "ver", "medio", "Ver auditoría", "Historial de cambios de roles, permisos y accesos."));

    /** Permiso antiguo → permiso detallado que lo representa (ancla) y los detallados que cubría. */
    public record Legacy(String id, String label, String anchor, List<String> covers) {}

    public static final List<Legacy> LEGACY = List.of(
            new Legacy(VIEW, "Ver tableros publicados", APPS_VIEW, List.of(APPS_VIEW, ASK, INSIGHTS, NOTEBOOKS_RUN, COMMENTS, ALERTS, REPORTS_VIEW)),
            new Legacy(AI, "Usar el asistente de IA", AI_CHAT, List.of(AI_CHAT, AI_EXPR, AGENTS_USE, KNOWLEDGE)),
            new Legacy(EDIT, "Editar tableros", SHEETS_EDIT, List.of(APPS_EDIT, SHEETS_CREATE, SHEETS_EDIT, SHEETS_DELETE, BUSINESS_EDIT, NOTES_EDIT,
                    NOTEBOOKS_EDIT, REPORTS_EXPORT, FLOWS_VIEW, FLOWS_EDIT, FLOWS_RUN, AGENTS_BUILD)),
            new Legacy(DATA, "Cargar y preparar datos", DATA_RELOAD, List.of(DATA_UPLOAD, DATA_SCRIPT, DATA_RELOAD, DATA_MODEL, DATA_SCHEDULE)),
            new Legacy(CONNECTIONS, "Gestionar conexiones", CONN_USE, List.of(CONN_USE, CONN_SHARE)),
            new Legacy(ML, "Experimentos de ML", ML_TRAIN, List.of(ML_VIEW, ML_TRAIN, ML_ASSOCIATE)),
            new Legacy(PUBLISH, "Publicar", PUBLISH, List.of(PUBLISH, SHEETS_PUBLISH, BUSINESS_CERTIFY)),
            new Legacy(USERS, "Administrar usuarios", USERS, List.of(USERS, ROLES_MANAGE, AUDIT)));
    // apps:create, apps:delete y embed:manage tienen el mismo nombre antes y ahora.

    private static final Map<String, Legacy> LEGACY_BY_ID = new HashMap<>();
    static { for (Legacy l : LEGACY) LEGACY_BY_ID.put(l.id(), l); }

    public record RoleDef(String id, String label, String description, List<String> permissions) {}

    private static List<String> all() { return CATALOG.stream().map(Def::id).toList(); }

    public static final List<RoleDef> ROLE_DEFS = List.of(
            new RoleDef("admin", "Administrador", "Control total de la plataforma. No se le puede restringir.", all()),
            new RoleDef("editor", "Desarrollador", "Construye y publica aplicaciones, datos, hojas, modelos y agentes; no administra usuarios.",
                    all().stream().filter(p -> !Set.of(APPS_DELETE, EMBED, USERS, ROLES_MANAGE, AUDIT).contains(p)).toList()),
            new RoleDef("viewer", "Visualizador", "Solo ve las aplicaciones en Producción y sus hojas publicadas; puede preguntar y comentar.",
                    List.of(APPS_VIEW, ASK, INSIGHTS, NOTEBOOKS_RUN, COMMENTS, ALERTS, REPORTS_VIEW)));

    public static final List<String> STAGES = List.of("personal", "desarrollo", "produccion");
    /** Roles de fábrica (no se pueden borrar). Los personalizados viven en {@link #CUSTOM}. */
    public static final List<String> BUILTIN = ROLE_DEFS.stream().map(RoleDef::id).toList();
    /** Compatibilidad: lista de roles de fábrica. Para todos (con personalizados) usa {@link #roles()}. */
    public static final List<String> ROLES = BUILTIN;

    private Permissions() {}

    /* ---------------- Roles personalizados y permisos por rol ---------------- */

    private static final Map<String, RoleDef> CUSTOM = new ConcurrentHashMap<>();
    private static final Map<String, Set<String>> OVERRIDES = new ConcurrentHashMap<>();

    public static void putCustomRole(RoleDef r) { CUSTOM.put(r.id(), new RoleDef(r.id(), r.label(), r.description(), List.copyOf(expand(r.permissions())))); }
    public static void removeCustomRole(String id) { CUSTOM.remove(id); }
    public static boolean isCustomRole(String id) { return id != null && CUSTOM.containsKey(id); }

    /** Todos los roles: los de fábrica y luego los personalizados (por nombre). */
    public static List<RoleDef> roles() {
        List<RoleDef> out = new ArrayList<>(ROLE_DEFS);
        CUSTOM.values().stream().sorted(Comparator.comparing(RoleDef::label, String.CASE_INSENSITIVE_ORDER)).forEach(out::add);
        return out;
    }

    public static Optional<RoleDef> role(String id) { return roles().stream().filter(r -> r.id().equals(id)).findFirst(); }

    public static boolean validRole(String r) { return r != null && (BUILTIN.contains(r) || CUSTOM.containsKey(r)); }
    public static boolean validPermission(String p) { return p != null && (CATALOG.stream().anyMatch(d -> d.id().equals(p)) || LEGACY_BY_ID.containsKey(p)); }
    public static boolean isGranular(String p) { return CATALOG.stream().anyMatch(d -> d.id().equals(p)); }
    public static boolean validStage(String s) { return s != null && STAGES.contains(s); }

    /** Fija (o, con null, quita) los permisos personalizados de un rol de fábrica. El administrador no se puede cambiar. */
    public static void setRoleOverride(String role, Collection<String> perms) {
        if (!BUILTIN.contains(role) || "admin".equals(role)) return;
        if (perms == null) OVERRIDES.remove(role); else OVERRIDES.put(role, expand(perms));
    }

    public static boolean isCustomized(String role) { return OVERRIDES.containsKey(role); }

    /** Permisos de fábrica del rol (sin personalizar). Un rol personalizado no tiene fábrica: devuelve los suyos. */
    public static Set<String> factoryDefaults(String role) {
        if (CUSTOM.containsKey(role)) return new LinkedHashSet<>(CUSTOM.get(role).permissions());
        return ROLE_DEFS.stream().filter(r -> r.id().equals(role)).findFirst()
                .map(r -> (Set<String>) new LinkedHashSet<>(r.permissions())).orElseGet(LinkedHashSet::new);
    }

    /** Permisos detallados vigentes del rol. */
    public static Set<String> roleDefaults(String role) {
        if ("admin".equals(role)) return new LinkedHashSet<>(all());
        if (CUSTOM.containsKey(role)) return new LinkedHashSet<>(CUSTOM.get(role).permissions());
        Set<String> custom = OVERRIDES.get(role);
        if (custom != null) return new LinkedHashSet<>(custom);
        return factoryDefaults(role);
    }

    /** Convierte una lista (con permisos antiguos o detallados) en permisos detallados. */
    public static Set<String> expand(Collection<String> perms) {
        Set<String> out = new LinkedHashSet<>();
        if (perms == null) return out;
        for (String p : perms) {
            if (p == null) continue;
            Legacy l = LEGACY_BY_ID.get(p);
            if (l != null) out.addAll(l.covers());
            else if (isGranular(p)) out.add(p);
        }
        return out;
    }

    /** Añade los nombres antiguos cuya ancla está concedida (compatibilidad con código e integraciones). */
    public static Set<String> withLegacy(Set<String> granular) {
        Set<String> s = new LinkedHashSet<>(granular);
        for (Legacy l : LEGACY) if (granular.contains(l.anchor())) s.add(l.id());
        return s;
    }

    /**
     * Permisos efectivos = (los del rol + concedidos) − denegados, en detallados, más los nombres antiguos derivados.
     * El administrador siempre tiene todos.
     */
    public static Set<String> effective(String role, Collection<String> grant, Collection<String> deny) {
        if ("admin".equals(role)) return withLegacy(new LinkedHashSet<>(all()));
        Set<String> s = roleDefaults(role);
        s.addAll(expand(grant));
        s.removeAll(expand(deny));
        // Ver es la base de todo: sin ver aplicaciones el resto no sirve, así que nunca se pierde por herencia.
        if (!s.isEmpty() && !expand(deny).contains(APPS_VIEW)) s.add(APPS_VIEW);
        return withLegacy(s);
    }

    /**
     * Explica de dónde sale cada permiso detallado de una persona: {@code rol}, {@code concedido} (lo tiene por
     * excepción), {@code denegado} (el rol lo da pero se le quitó) o {@code ninguno}.
     */
    public static Map<String, String> explain(String role, Collection<String> grant, Collection<String> deny) {
        Map<String, String> out = new LinkedHashMap<>();
        Set<String> base = roleDefaults(role), g = expand(grant), dn = expand(deny);
        boolean admin = "admin".equals(role);
        for (Def d : CATALOG) {
            String p = d.id();
            String why = admin ? "rol" : dn.contains(p) ? "denegado" : base.contains(p) ? "rol" : g.contains(p) ? "concedido" : "ninguno";
            out.put(p, why);
        }
        return out;
    }

    /**
     * Permiso detallado que exige una petición a {@code /api/v1/**}. {@code path} viene SIN el prefijo
     * {@code /api/v1} (p. ej. {@code /apps/ab12/sheets}).
     */
    public static String required(String method, String path) {
        boolean read = "GET".equals(method) || "HEAD".equals(method);
        boolean del = "DELETE".equals(method), post = "POST".equals(method);
        if (path.startsWith("/users/roles")) return read ? USERS : ROLES_MANAGE;
        if (path.startsWith("/users/audit")) return AUDIT;
        if (path.startsWith("/users")) return USERS;
        // La campana es de todos: cada uno ve sus alertas y recargas; el administrador, además, la actividad global.
        if (path.startsWith("/notifications")) return APPS_VIEW;
        if (path.startsWith("/connections")) return path.matches("/connections/[^/]+/shares") || path.equals("/connections/share-targets") ? CONN_SHARE : CONN_USE;
        if (path.startsWith("/embeds")) return EMBED;
        if (path.startsWith("/flows")) {
            if (read) return FLOWS_VIEW;
            if (post && path.matches("/flows/[^/]+/run")) return FLOWS_RUN;
            return FLOWS_EDIT;
        }
        if (path.startsWith("/agents")) {
            if (read) return AGENTS_USE;
            // Conversar y borrar las conversaciones propias es «usar»; crear, cambiar o borrar agentes es «construir».
            if (post && path.matches("/agents/[^/]+/chat")) return AGENTS_USE;
            if (path.matches("/agents/[^/]+/conversations(/.*)?")) return AGENTS_USE;
            return AGENTS_BUILD;
        }
        if (path.startsWith("/knowledge")) return KNOWLEDGE;
        // Lectura de un experimento/corrida: la necesitan los tableros publicados que muestran gráficos de ML.
        if (read && path.matches("/ml/experiments/[^/]+(/runs/[^/]+)?")) return APPS_VIEW;
        if (path.startsWith("/ml/")) {
            if (read) return ML_VIEW;
            if (path.endsWith("/associate")) return ML_ASSOCIATE;
            return ML_TRAIN;
        }
        if (path.startsWith("/ai")) return read ? APPS_VIEW : AI_CHAT;
        if (path.startsWith("/collections")) return read ? APPS_VIEW : APPS_EDIT;
        if (path.equals("/apps")) return read ? APPS_VIEW : APPS_CREATE;
        if (path.startsWith("/apps/")) {
            String[] s = path.split("/"); // ["", "apps", id, sub, ...]
            if (s.length <= 3) return read ? APPS_VIEW : (del ? APPS_DELETE : APPS_EDIT);
            String sub = s[3];
            String tail = path.substring(("/apps/" + s[2]).length());
            if (tail.equals("/stage")) return APPS_VIEW; // lo valida el controlador (reglas por etapa)
            if (sub.equals("query") || tail.equals("/fields/values") || tail.equals("/expressions/parse") || tail.equals("/expressions/translate")) return APPS_VIEW;
            if (tail.equals("/expressions/assist")) return AI_EXPR;
            if (sub.equals("comments")) return read ? APPS_VIEW : COMMENTS;
            if (sub.equals("ask")) return read ? APPS_VIEW : ASK;
            if (sub.equals("auto-dashboard")) return SHEETS_CREATE;
            if (sub.equals("alerts") || sub.equals("actions") || sub.equals("watchdog")) return read ? APPS_VIEW : ALERTS;
            if (sub.equals("insights")) return INSIGHTS;
            // Cuadernos: leer basta con ver; ejecutar celdas exige su permiso; guardar/borrar lo valida el controlador.
            if (sub.equals("notebooks")) return read ? APPS_VIEW : (tail.equals("/notebooks/run") ? NOTEBOOKS_RUN : NOTEBOOKS_EDIT);
            if (sub.equals("schedule")) {
                if (read) return APPS_VIEW;
                return tail.equals("/schedule/run") ? DATA_RELOAD : DATA_SCHEDULE;
            }
            if (sub.equals("reload-runs")) return APPS_VIEW;
            if (sub.equals("master-items") && tail.endsWith("/certify")) return BUSINESS_CERTIFY;
            if (sub.equals("master-items") || sub.equals("logical-model")) return read ? APPS_VIEW : BUSINESS_EDIT;
            if (sub.equals("connections")) return CONN_USE;
            if (sub.equals("ml")) return read ? ML_VIEW : ML_TRAIN;
            if (sub.equals("script")) return tail.equals("/script/run") ? DATA_RELOAD : DATA_SCRIPT;
            if (sub.equals("notes")) return NOTES_EDIT; // diccionario de datos: lo escribe y lee quien construye
            if (sub.equals("sheets")) {
                if (tail.endsWith("/visibility")) return SHEETS_PUBLISH;
                if (read) return APPS_VIEW;
                if (del) return SHEETS_DELETE;
                return post && tail.equals("/sheets") ? SHEETS_CREATE : SHEETS_EDIT;
            }
            if (read) return APPS_VIEW;
            if (sub.equals("tables")) return tail.contains("/field-overrides") ? DATA_MODEL : DATA_UPLOAD;
            if (sub.equals("associations") || sub.equals("field-overrides")) return DATA_MODEL;
            return SHEETS_EDIT;
        }
        return read ? APPS_VIEW : SHEETS_EDIT;
    }

    /** Permisos que, aunque lleguen por POST, no modifican la app (consultar, analizar, comentar, cuadernos propios). */
    private static final Set<String> NON_WRITING = Set.of(APPS_VIEW, ASK, INSIGHTS, NOTEBOOKS_RUN, NOTEBOOKS_EDIT, COMMENTS);

    /**
     * ¿La petición modifica la app? Si sí, además del permiso se exige poder escribir en ella según su etapa
     * (en Producción, poder publicar). Las alertas personales tampoco la modifican.
     */
    public static boolean modifiesApp(String method, String path) {
        if ("GET".equals(method) || "HEAD".equals(method)) return false;
        if (NON_WRITING.contains(required(method, path))) return false;
        String[] s = path.split("/");
        return !(s.length > 3 && "alerts".equals(s[3]));
    }

    /** Id de la app a la que apunta la ruta ({@code /apps/{id}/…}), o null. */
    public static String appIdOf(String path) {
        if (!path.startsWith("/apps/")) return null;
        String[] s = path.split("/");
        return s.length >= 3 && !s[2].isBlank() ? s[2] : null;
    }
}
