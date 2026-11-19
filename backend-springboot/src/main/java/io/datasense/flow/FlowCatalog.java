package io.datasense.flow;

import java.util.*;

/**
 * Catálogo de nodos de las automatizaciones. Es la única fuente de verdad: lo usa el motor para validar, el editor
 * visual para pintar la paleta y los formularios, y el MCP para saber qué nodos existen y qué parámetros piden.
 *
 * <p>Tipos de parámetro: text, textarea, number, select, bool, app, table, field, measure, credential:&lt;kind&gt;,
 * json, kv (pares clave → plantilla), code. Cualquier texto admite plantillas {@code {{ $json.campo }}}.</p>
 */
public final class FlowCatalog {

    private FlowCatalog() {}

    public static final List<Map<String, Object>> CATEGORIES = List.of(
            cat("trigger", "Disparadores", "#f59e0b", "Cuándo empieza el flujo"),
            cat("data", "Datos DataSense", "#6366f1", "Recargar, consultar y analizar tus apps"),
            cat("ai", "Agentes de IA", "#a855f7", "Agentes que leen tus datos, razonan y redactan"),
            cat("logic", "Lógica", "#0ea5e9", "Condiciones, filtros y transformaciones"),
            cat("action", "Acciones", "#10b981", "Correo, WhatsApp, Teams/Slack, HTTP y avisos"));

    public static final List<Map<String, Object>> NODES = new ArrayList<>();

    static {
        /* ------------------------------ Disparadores ------------------------------ */
        node("trigger.manual", "trigger", "Ejecutar manualmente", "play", "El flujo arranca al pulsar «Ejecutar». Puedes darle datos de prueba.",
                List.of("out"), false,
                p("sample", "Datos de prueba (JSON, opcional)", "json", null, "{\"cliente\": \"Ana\"}", false, "Llega a los siguientes nodos como $json."));
        node("trigger.schedule", "trigger", "Programado", "clock", "Arranca solo: cada N minutos, a diario o cada semana.",
                List.of("out"), false,
                sel("mode", "Frecuencia", "daily", List.of(o("interval", "Cada N minutos"), o("hourly", "Cada hora"), o("daily", "Todos los días"), o("weekly", "Cada semana"))),
                p("minutes", "Cada (minutos)", "number", 60, null, false, "Mínimo 5.").when("mode", "interval"),
                p("time", "Hora (HH:MM)", "text", "07:00", "07:00", false, null).when("mode", "daily", "weekly"),
                sel("weekday", "Día", "1", List.of(o("1", "Lunes"), o("2", "Martes"), o("3", "Miércoles"), o("4", "Jueves"), o("5", "Viernes"), o("6", "Sábado"), o("7", "Domingo"))).when("mode", "weekly"));
        node("trigger.webhook", "trigger", "Webhook (URL)", "link", "Arranca cuando otro sistema llama a la URL del flujo (POST o GET). Responde con la salida del último nodo.",
                List.of("out"), false);
        node("trigger.reload", "trigger", "Al recargar datos", "refresh", "Arranca cada vez que se recargan los datos de una app (manual o programada).",
                List.of("out"), false,
                p("app", "Aplicación", "app", null, null, true, null),
                sel("status", "Solo si la carga", "any", List.of(o("any", "Termina (cualquier resultado)"), o("ok", "Sale bien"), o("fail", "Falla o tiene advertencias"))));
        node("trigger.alert", "trigger", "Al dispararse una alerta", "bell", "Arranca cuando una alerta de datos de la app se dispara.",
                List.of("out"), false,
                p("app", "Aplicación", "app", null, null, true, null),
                p("alert_name", "Solo la alerta (nombre, opcional)", "text", null, "Rotación alta", false, "Vacío = cualquier alerta de la app."));

        /* ------------------------------ Datos ------------------------------ */
        node("data.reload", "data", "Recargar datos", "refresh", "Vuelve a cargar los datos de una app desde sus conexiones (como «Cargar datos»).",
                List.of("out"), true,
                p("app", "Aplicación", "app", null, null, true, null));
        node("data.query", "data", "Calcular medida", "sigma", "Calcula una medida (fx simple o compuesta, o maestra) en total o por una dimensión. Por dimensión devuelve un registro por valor.",
                List.of("out"), true,
                p("app", "Aplicación", "app", null, null, true, null),
                p("measure", "Medida", "measure", null, "Count(DISTINCT [CEDULA])", true, "Expresión fx o «m:<id>» de una medida maestra."),
                p("label", "Nombre", "text", null, "Conductores", false, null),
                p("dimension", "Agrupar por (opcional)", "field", null, null, false, null),
                p("filters", "Filtros (JSON)", "json", null, "{\"SUCURSAL\": [\"CALI\"]}", false, null),
                p("top", "Top N", "number", null, null, false, "Solo con dimensión: los N mayores."));
        node("data.rows", "data", "Buscar registros", "table", "Los registros que cumplen filtros y una condición (p. ej. conductores con probabilidad de retiro > 0.7). Un registro por fila.",
                List.of("out"), true,
                p("app", "Aplicación", "app", null, null, true, null),
                p("table", "Tabla (opcional)", "table", null, null, false, null),
                p("filters", "Filtros (JSON)", "json", null, "{\"ESTADO CONTRATO\": [\"Activo\"]}", false, null),
                p("where", "Condición por fila", "text", null, "[probabilidad_retiro] > 0.7", false, null),
                p("fields", "Columnas (coma)", "text", null, "cedula, probabilidad_retiro", false, null),
                p("sort", "Ordenar por (desc.)", "field", null, null, false, null),
                p("limit", "Máximo", "number", 100, null, false, null));
        node("data.ask", "data", "Preguntar a los datos", "chat", "Pregunta en español («% de inactivos por sucursal»); devuelve la respuesta, los números y cómo se calculó.",
                List.of("out"), true,
                p("app", "Aplicación", "app", null, null, true, null),
                p("question", "Pregunta", "textarea", null, "¿Cuántos conductores hay por sucursal?", true, "Admite plantillas: {{ $json.pregunta }}."));
        node("data.explain", "data", "Qué cambió y por qué", "trend", "Compara una medida entre el último periodo y el anterior y explica qué segmentos lo causan.",
                List.of("out"), true,
                p("app", "Aplicación", "app", null, null, true, null),
                p("measure", "Medida", "measure", null, "Round(Sum(If([ESTADO CONTRATO] = 'Inactivo', 1, 0)) / Count([CEDULA]) * 100, 2)", true, null),
                p("label", "Nombre", "text", null, "% Inactivos", false, null),
                p("filters", "Filtros (JSON)", "json", null, null, false, null));
        node("data.health", "data", "Salud de datos", "heart", "Puntaje 0-100 y problemas de calidad de los datos de una app.",
                List.of("out"), true,
                p("app", "Aplicación", "app", null, null, true, null));
        node("data.whatif", "data", "¿Qué pasaría si…?", "flask", "Simula un cambio sobre una copia de los datos y devuelve la medida antes y después.",
                List.of("out"), true,
                p("app", "Aplicación", "app", null, null, true, null),
                p("measure", "Medida", "measure", null, null, true, null),
                p("label", "Nombre", "text", null, null, false, null),
                p("field", "Campo a cambiar", "field", null, null, true, null),
                sel("op", "Operación", "set", List.of(o("set", "Fijar el valor"), o("multiply", "Multiplicar por"), o("add", "Sumar"))),
                p("value", "Valor", "text", null, "Activo", true, null),
                p("share", "% de filas", "number", 100, null, false, null),
                p("filters", "Solo en (JSON)", "json", null, "{\"ESTADO CONTRATO\": [\"Inactivo\"]}", false, null));

        /* ------------------------------ IA ------------------------------ */
        node("ai.agent", "ai", "Agente de IA", "sparkles", "Un agente especializado: lee los datos que le llegan, puede consultar la app por su cuenta (preguntas, registros, qué cambió) y responde en texto o JSON.",
                List.of("out"), true,
                sel("role", "Especialidad", "analyst", List.of(o("analyst", "Analista de datos"), o("writer", "Redactor de mensajes (correo / WhatsApp)"),
                        o("classifier", "Clasificador / priorizador"), o("hr", "Experto en rotación de personal"), o("custom", "Personalizado"))),
                p("instructions", "Instrucciones del agente", "textarea", null, "Eres el analista de rotación. Sé breve y concreto.", false, "Su rol y reglas. Se suman a la especialidad."),
                p("prompt", "Tarea", "textarea", null, "Resume para el gerente qué pasó con la rotación: {{ $json.story }}", true, "Admite plantillas."),
                p("app", "App que puede consultar (opcional)", "app", null, null, false, "Con app, el agente puede usar herramientas: preguntar, buscar registros y explicar cambios (hasta 4 pasos)."),
                p("include_input", "Darle los datos que llegan", "bool", true, null, false, null),
                sel("format", "Responder en", "text", List.of(o("text", "Texto"), o("json", "JSON (para usar sus campos en otros nodos)"))));

        /* ------------------------------ Lógica ------------------------------ */
        node("logic.if", "logic", "Si / sino", "split", "Envía cada registro por «sí» o «no» según una condición.",
                List.of("true", "false"), true,
                p("left", "Valor", "text", null, "{{ $json.value }}", true, null),
                sel("op", "Condición", ">", List.of(o("=", "es igual a"), o("!=", "es distinto de"), o(">", "es mayor que"), o(">=", "es mayor o igual a"),
                        o("<", "es menor que"), o("<=", "es menor o igual a"), o("contains", "contiene"), o("empty", "está vacío"), o("not_empty", "no está vacío"))),
                p("right", "Comparar con", "text", null, "10", false, null));
        node("logic.filter", "logic", "Filtrar", "filter", "Deja pasar solo los registros que cumplen la condición.",
                List.of("out"), true,
                p("left", "Valor", "text", null, "{{ $json.probabilidad_retiro }}", true, null),
                sel("op", "Condición", ">", List.of(o("=", "es igual a"), o("!=", "es distinto de"), o(">", "es mayor que"), o(">=", "es mayor o igual a"),
                        o("<", "es menor que"), o("<=", "es menor o igual a"), o("contains", "contiene"), o("empty", "está vacío"), o("not_empty", "no está vacío"))),
                p("right", "Comparar con", "text", null, "0.8", false, null));
        node("logic.set", "logic", "Preparar campos", "edit", "Crea o cambia campos de cada registro con plantillas (p. ej. un mensaje por persona).",
                List.of("out"), true,
                p("fields", "Campos", "kv", null, null, true, "nombre del campo → valor o plantilla"),
                p("keep", "Conservar los demás campos", "bool", true, null, false, null));
        node("logic.aggregate", "logic", "Agrupar en uno", "layers", "Junta todos los registros en uno solo (con la lista, el conteo y una tabla HTML lista para el correo).",
                List.of("out"), true);
        node("logic.wait", "logic", "Esperar", "hourglass", "Pausa el flujo unos segundos (máx. 300).",
                List.of("out"), true,
                p("seconds", "Segundos", "number", 5, null, true, null));

        /* ------------------------------ Acciones ------------------------------ */
        node("action.email", "action", "Enviar correo", "mail", "Envía un correo por SMTP (Gmail, Outlook/Office 365, tu servidor). Puede adjuntar los registros como CSV.",
                List.of("out"), true,
                p("credential", "Cuenta de correo", "credential:smtp", null, null, true, null),
                p("to", "Para", "text", null, "gerente@empresa.com", true, "Varios separados por coma. Admite plantillas."),
                p("cc", "CC", "text", null, null, false, null),
                p("subject", "Asunto", "text", null, "Rotación de la semana", true, null),
                p("body", "Mensaje (HTML o texto)", "textarea", null, "<p>Hola,</p><p>{{ $json.text }}</p>", true, "{{ $items | table }} pinta los registros como tabla."),
                p("attach_csv", "Adjuntar los registros como CSV", "bool", false, null, false, null),
                p("per_item", "Un correo por cada registro", "bool", false, null, false, null));
        node("action.whatsapp", "action", "Enviar WhatsApp", "whatsapp", "Envía un WhatsApp por WhatsApp Business Cloud API (Meta) o Twilio.",
                List.of("out"), true,
                p("credential", "Cuenta de WhatsApp", "credential:whatsapp", null, null, true, null),
                p("to", "Número(s)", "text", null, "+573001234567", true, "Con indicativo de país; varios separados por coma."),
                p("message", "Mensaje", "textarea", null, "Hola {{ $json.nombre }}, …", true, null),
                p("template", "Plantilla aprobada (Meta, opcional)", "text", null, "hello_world", false, "Fuera de la ventana de 24 h Meta exige una plantilla aprobada."),
                p("per_item", "Un mensaje por cada registro", "bool", false, null, false, null));
        node("action.chat", "action", "Teams / Slack / Google Chat", "chat", "Publica un mensaje en un canal mediante su webhook entrante.",
                List.of("out"), true,
                p("credential", "Webhook del canal", "credential:webhook", null, null, true, null),
                p("text", "Mensaje", "textarea", null, "⚠ {{ $json.title }}", true, null));
        node("action.http", "action", "Petición HTTP", "globe", "Llama a cualquier API (GET/POST/PUT/DELETE) y devuelve su respuesta.",
                List.of("out"), true,
                sel("method", "Método", "POST", List.of(o("GET", "GET"), o("POST", "POST"), o("PUT", "PUT"), o("PATCH", "PATCH"), o("DELETE", "DELETE"))),
                p("url", "URL", "text", null, "https://api.ejemplo.com/eventos", true, null),
                p("headers", "Cabeceras", "kv", null, null, false, null),
                p("credential", "Autenticación (opcional)", "credential:http", null, null, false, null),
                p("body", "Cuerpo (JSON / texto)", "textarea", null, "{\"total\": {{ $json.value }}}", false, null));
        node("action.notify", "action", "Aviso en la campana", "bell", "Deja un aviso en la campana de DataSense de quien creó el flujo.",
                List.of("out"), true,
                p("title", "Título", "text", null, "Revisar rotación", true, null),
                p("message", "Mensaje", "textarea", null, "{{ $json.text }}", false, null));
    }

    public static final Map<String, Map<String, Object>> BY_TYPE = new LinkedHashMap<>();
    static { for (Map<String, Object> n : NODES) BY_TYPE.put((String) n.get("type"), n); }

    /** Tipos de credencial y sus campos (los marcados secret no se devuelven nunca). */
    public static final List<Map<String, Object>> CREDENTIALS = List.of(
            cred("smtp", "Correo (SMTP)", "Gmail: smtp.gmail.com, 465 SSL y una contraseña de aplicación. Office 365: smtp.office365.com, 587 STARTTLS.",
                    f("host", "Servidor SMTP", false, "smtp.gmail.com"), f("port", "Puerto", false, "465"),
                    f("security", "Seguridad (ssl | starttls | none)", false, "ssl"), f("user", "Usuario", false, "alertas@empresa.com"),
                    f("password", "Contraseña / contraseña de aplicación", true, ""), f("from", "Remitente", false, "DataSense <alertas@empresa.com>")),
            cred("whatsapp_meta", "WhatsApp Business (Meta Cloud API)", "En Meta for Developers: el «Phone number ID» y un token permanente de un usuario del sistema.",
                    f("phone_number_id", "Phone number ID", false, "123456789012345"), f("token", "Token de acceso", true, ""),
                    f("api_base", "URL de la API", false, "https://graph.facebook.com/v20.0")),
            cred("whatsapp_twilio", "WhatsApp (Twilio)", "Account SID, Auth Token y el número remitente habilitado para WhatsApp.",
                    f("account_sid", "Account SID", false, "AC…"), f("auth_token", "Auth Token", true, ""),
                    f("from", "Remitente", false, "whatsapp:+14155238886"), f("api_base", "URL de la API", false, "https://api.twilio.com")),
            cred("webhook", "Webhook de canal (Teams / Slack / Google Chat)", "La URL del «webhook entrante» del canal.",
                    f("url", "URL del webhook", true, "https://…")),
            cred("http", "Autenticación HTTP", "Una cabecera que se añade a las peticiones (p. ej. Authorization: Bearer …).",
                    f("header", "Cabecera", false, "Authorization"), f("value", "Valor", true, "Bearer …")));

    /* ------------------------------ helpers ------------------------------ */

    static final class P extends LinkedHashMap<String, Object> {
        P when(String key, String... values) { put("show_if", Map.of("key", key, "values", List.of(values))); return this; }
    }

    private static P p(String key, String label, String type, Object def, String placeholder, boolean required, String help) {
        P m = new P();
        m.put("key", key); m.put("label", label); m.put("type", type);
        if (def != null) m.put("default", def);
        if (placeholder != null) m.put("placeholder", placeholder);
        m.put("required", required);
        if (help != null) m.put("help", help);
        return m;
    }

    private static P sel(String key, String label, String def, List<Map<String, String>> options) {
        P m = p(key, label, "select", def, null, false, null);
        m.put("options", options);
        return m;
    }

    private static Map<String, String> o(String v, String l) { return Map.of("value", v, "label", l); }

    private static void node(String type, String category, String label, String icon, String description, List<String> outputs, boolean input, Map<?, ?>... params) {
        Map<String, Object> n = new LinkedHashMap<>();
        n.put("type", type); n.put("category", category); n.put("label", label); n.put("icon", icon);
        n.put("description", description); n.put("outputs", outputs); n.put("input", input);
        n.put("params", List.of(params));
        NODES.add(n);
    }

    private static Map<String, Object> cat(String id, String label, String color, String desc) {
        return Map.of("id", id, "label", label, "color", color, "description", desc);
    }

    private static Map<String, Object> cred(String kind, String label, String help, Map<?, ?>... fields) {
        return Map.of("kind", kind, "label", label, "help", help, "fields", List.of(fields));
    }

    private static Map<String, Object> f(String key, String label, boolean secret, String placeholder) {
        return Map.of("key", key, "label", label, "secret", secret, "placeholder", placeholder);
    }

    /** ¿La credencial {@code kind} sirve para un parámetro {@code credential:<want>}? */
    static boolean credentialFits(String want, String kind) {
        return want.equals(kind) || ("whatsapp".equals(want) && kind.startsWith("whatsapp_"));
    }
}
