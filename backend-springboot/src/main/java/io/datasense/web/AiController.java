package io.datasense.web;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;

import io.datasense.ai.ActionPlan;
import io.datasense.ai.BedrockService;
import io.datasense.ai.BedrockService.AiResult;

import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Asistente de IA ("estrellita") del clon de Qlik. Expone tres capacidades
 * sobre Nova Micro (Bedrock Converse): modelar datos, analizar un tablero y
 * diseñar un dashboard. Es un agente lógico interno llamado "prueba".
 *
 * <p>Contrato defensivo: TODOS los errores (validación, credenciales, red,
 * Bedrock) se devuelven como HTTP 200 con {@code {ok:false, message:...}}.
 * NUNCA se lanza una excepción 5xx. El frontend nunca ve credenciales AWS:
 * todo pasa por el backend.
 */
@RestController
@RequestMapping("/api/v1/ai")
public class AiController {

    private final BedrockService bedrock;
    private final io.datasense.repo.NotesRepository notes;
    private final io.datasense.repo.AppRepository apps;
    private final io.datasense.auth.AccessService access;
    private final ObjectMapper mapper = new ObjectMapper();

    public AiController(BedrockService bedrock, io.datasense.repo.NotesRepository notes,
                        io.datasense.repo.AppRepository apps, io.datasense.auth.AccessService access) {
        this.bedrock = bedrock;
        this.notes = notes;
        this.apps = apps;
        this.access = access;
    }

    /**
     * Notas del equipo (diccionario de datos) de la app del cuerpo, si el usuario puede verla. Se añaden al prompt del
     * sistema para que el agente sepa qué significa cada tabla/columna y con qué se cruza.
     */
    private String notesBlock(Map<String, Object> body) {
        try {
            String appId = str(body == null ? null : body.get("appId"));
            if (appId.isBlank()) return "";
            var attrs = (org.springframework.web.context.request.ServletRequestAttributes)
                    org.springframework.web.context.request.RequestContextHolder.getRequestAttributes();
            var user = attrs == null ? null : io.datasense.auth.AccessService.current(attrs.getRequest());
            var app = apps.getApp(appId);
            if (app.isEmpty() || !access.canSee(user, app.get())) return "";
            String ctx = notes.contextFor(appId);
            if (ctx.isBlank()) return "";
            return "\n\nDICCIONARIO DE DATOS (notas del equipo sobre estos datos). Es la fuente de verdad sobre el SIGNIFICADO de cada tabla "
                    + "y columna, su tipo semántico y con qué se cruzan; úsalo para interpretar, relacionar y modelar, y cítalo cuando ayude:\n" + ctx;
        } catch (Exception e) {
            return "";
        }
    }

    /** Smoke test de arranque: no llama a Bedrock. */
    @GetMapping("/health")
    public Map<String, Object> health() {
        return Map.of(
                "ok", true,
                "agent", bedrock.getAgentName(),
                "model", bedrock.getModelId(),
                "region", bedrock.getRegion());
    }

    /**
     * Propone un modelo de datos (estrella/copo de nieve/araña), llaves PK/FK,
     * relaciones y un script LOAD en sintaxis Qlik a partir del perfil de
     * columnas/tablas cargadas.
     */
    @PostMapping("/modelar")
    public Map<String, Object> modelar(@RequestBody Map<String, Object> body) {
        String system = """
                Eres un ingeniero de datos experto en modelado dimensional y en Qlik Sense, integrado en el
                editor de carga de DataSense. Conversas de forma natural y directa, como un colega senior.
                Tu fuente de verdad es el perfil de tablas y columnas que recibes en el contexto: no inventes
                tablas, columnas ni tipos que no estén ahí.

                Cómo responder:
                - Responde a lo que el usuario pide, con la extensión adecuada. Si solo saluda o pregunta algo
                  general, responde breve y natural y ofrece ayuda; NO vuelques el modelo completo ni el script
                  en cada turno sin que lo pidan.
                - Cuando el usuario pida modelar, proponer el modelo, las llaves o el script (o cuando claramente
                  lo necesite), entrega lo que aplique: el esquema recomendado (estrella / copo de nieve / araña)
                  con su justificación, las llaves candidatas PK/FK por tabla, las relaciones y su cardinalidad, y
                  un script LOAD en sintaxis Qlik con una breve explicación. Adapta la profundidad a la pregunta;
                  no es obligatorio dar siempre las cuatro cosas.
                - Si falta información del perfil para decidir, dilo y pide lo que necesitas.
                - Eres abierto: puedes razonar, comparar alternativas y recomendar, pero enfocado en estos datos.
                - Responde en español, en prosa fluida; usa listas o bloques de código solo cuando aporten.
                - Sé breve y natural en el texto de conversación.

                PLAN DE ACCIONES (opcional): cuando el usuario te pida el script de carga (o claramente quiera
                aplicarlo), emite ADEMÁS del texto, al final, un bloque EXACTO con esta forma y nada más dentro:
                <<<DS_ACTION>>>{"kind":"apply-script","script":"<script LOAD completo en sintaxis Qlik>"}<<<END_DS_ACTION>>>
                El bloque va aparte del texto en prosa (no lo expliques dentro del bloque). Si no procede aplicar un
                script, NO emitas el bloque. Usa SOLO tablas y campos presentes en el contexto.""";
        return run(system, "Perfil de datos cargado (JSON):\n", body, Mode.MODELAR);
    }

    /**
     * Analista profesional: responde una pregunta en lenguaje natural sobre el
     * estado del tablero (KPIs, gráficos, filtros/selecciones activas).
     */
    @PostMapping("/analizar")
    public Map<String, Object> analizar(@RequestBody Map<String, Object> body) {
        String question = str(body.get("pregunta"));
        if (question.isBlank()) {
            return error("Debes incluir una 'pregunta' sobre el tablero.");
        }
        String system = """
                Eres un analista de datos profesional dentro de un tablero de DataSense (estilo Qlik Sense).
                Conversas de forma natural, cálida y directa, como un analista humano sentado al lado del usuario.
                Tu conocimiento se limita al contexto del tablero que recibes (KPIs, gráficos, tabla de detalle,
                filtros y selecciones activas). Esa es tu única fuente de verdad: no inventes cifras, nombres de
                campos ni datos que no estén en el contexto.

                Cómo responder:
                - Responde EXACTAMENTE lo que te preguntan, con la extensión que amerite. Una pregunta corta
                  merece una respuesta corta. Sé conciso.
                - VARÍA tus respuestas: no uses una plantilla fija ni repitas la misma estructura o las mismas
                  frases turno tras turno. Responde a la intención concreta de cada pregunta.
                - Si el usuario solo saluda o charla ("hola", "gracias", "¿cómo vas?"), responde breve y natural,
                  en una o dos frases, y ofrece ayuda. NO describas toda la estructura del tablero ni enumeres
                  todos sus componentes salvo que te lo pidan explícitamente.
                - NUNCA listes por defecto todos los KPIs, gráficos y filtros del tablero. Menciona solo los
                  elementos relevantes a la pregunta concreta; evita las respuestas enlatadas que repiten el
                  inventario completo del tablero.
                - Cuando des cifras o conclusiones, cítalas desde el contexto (p. ej. el valor del KPI o la barra
                  del gráfico). Si el dato necesario no está en el contexto, dilo con franqueza y pide lo que falta
                  o sugiere qué selección hacer para obtenerlo.
                - Eres abierto: puedes razonar, comparar, sugerir siguientes pasos y dar recomendaciones, pero
                  siempre enfocado en estos datos y en este tablero, no en temas ajenos.
                - Responde en español, en prosa fluida. Usa listas solo cuando aporten claridad.
                - Si el contexto trae "modeloML", la hoja la generó un experimento de Machine Learning
                  (botón "Asociar a"). Úsalo para explicar el modelo en lenguaje de negocio: qué algoritmo se
                  usó, con qué variables, qué tan bueno es (métricas como silueta, R², AUC, exactitud, RMSE),
                  qué significa cada segmento o predicción y en qué tabla del modelo quedó el resultado.
                  Interpreta las métricas con criterio (p. ej. silueta < 0.25 = grupos poco definidos) y no
                  inventes valores que no estén en "modeloML".
                - Eres de solo lectura: NO emitas planes de acción ni bloques especiales; solo responde en prosa.""";
        return run(system, "Contexto del tablero (JSON) y pregunta del usuario. Responde a la pregunta usando este contexto como única fuente:\n", body, Mode.ANALIZAR);
    }

    /**
     * Diseñador de dashboards: propone gráficos, KPIs, estructura/layout y qué
     * visualización conviene a cada campo disponible.
     */
    @PostMapping("/disenar")
    public Map<String, Object> disenar(@RequestBody Map<String, Object> body) {
        String system = """
                Eres un diseñador experto de dashboards en Qlik Sense, integrado en el editor de hoja de
                DataSense. Conversas de forma natural y cercana, como un diseñador que acompaña al usuario.
                Tu fuente de verdad son el modelo y los campos disponibles que recibes en el contexto: no
                inventes campos ni medidas que no existan.

                Cómo responder:
                - Responde a lo que el usuario pide, con la extensión adecuada. Si solo saluda o pregunta algo
                  general, responde breve y natural y ofrece ayuda; NO describas un dashboard completo en cada
                  turno sin que lo pidan.
                - Cuando el usuario pida ideas de gráficos, KPIs o cómo estructurar la hoja (o cuando claramente
                  lo necesite), propón lo que aplique: los KPIs relevantes y cómo calcularlos, qué visualización
                  conviene a cada campo (dimensión/medida) y la estructura/layout recomendados (orden, agrupación,
                  jerarquía visual). Adapta la profundidad a la pregunta.
                - Si falta información del modelo para recomendar, dilo y pide lo que necesitas.
                - Eres abierto: puedes razonar, comparar opciones y sugerir siguientes pasos, pero enfocado en
                  estos campos y este dashboard.
                - Responde en español, en prosa fluida; usa listas solo cuando aporten claridad.
                - Sé breve y natural en el texto de conversación.

                PLAN DE ACCIONES (opcional): cuando el usuario pida CREAR/HACER/CONSTRUIR gráficos o un dashboard
                (o claramente quiera que montes la hoja), emite ADEMÁS del texto, al final, un bloque EXACTO con
                esta forma y nada más dentro:
                <<<DS_ACTION>>>{"kind":"build-sheet|add-objects","objects":[{"type":"kpi|bar|pie|line|table|filterpane","title":"...","dimension":"<campo>","measure":{"field":"<campo>","agg":"sum|count|avg|min|max"},"x":0,"y":0,"w":6,"h":3}]}<<<END_DS_ACTION>>>
                Reglas del bloque:
                - Usa SOLO campos presentes en el contexto para dimension y measure.field. No inventes campos.
                - type debe ser uno de: kpi, bar, pie, line, table, filterpane.
                - Para un dashboard COMPLETO usa kind "build-sheet" y organiza en rejilla de 24 columnas sin
                  solapes: los KPIs en una fila arriba, luego barras por dimensión, una tarta por categoría, una
                  línea por tiempo si hay un campo temporal, una tabla de detalle y un panel de filtros.
                - Para añadir uno o pocos objetos usa kind "add-objects".
                - El bloque va aparte del texto en prosa; no lo expliques dentro del bloque. Si el usuario solo
                  conversa o pide ideas sin pedir montarlo, NO emitas el bloque.""";
        return run(system, "Modelo y campos disponibles (JSON):\n", body, Mode.DISENAR);
    }

    /** Qué agente llama a run(): determina cómo (o si) se saca una acción del texto del modelo. */
    private enum Mode { MODELAR, ANALIZAR, DISENAR }

    /**
     * Serializa el cuerpo, invoca Bedrock, extrae y sanea el PLAN DE ACCIONES del
     * texto del modelo y arma la respuesta uniforme {@code {ok, message, agent, action?}}.
     * Nunca lanza: ante fallo del modelo devuelve {@code {ok:false, message, agent}} sin action.
     */
    private Map<String, Object> run(String system, String prefix, Map<String, Object> body, Mode mode) {
        AiResult result = bedrock.converse(system + notesBlock(body), prefix + serialize(body));

        Map<String, Object> out = new HashMap<>();
        out.put("agent", bedrock.getAgentName());

        if (!result.ok()) {
            out.put("ok", false);
            out.put("message", String.valueOf(result.message()));
            return out;
        }

        ActionPlan.ParseResult parsed = ActionPlan.parseFromModelText(result.text());
        out.put("ok", true);
        out.put("message", parsed.visibleText());

        Map<String, Object> action = null;
        switch (mode) {
            case DISENAR -> action = ActionPlan.sanitizeDesign(parsed.action(), camposFromBody(body));
            case MODELAR -> action = ActionPlan.sanitizeScript(parsed.action());
            case ANALIZAR -> action = null; // el analista es de solo lectura
        }
        out.put("action", action);
        return out;
    }

    /**
     * Extrae de forma defensiva el conjunto de nombres de campo del contexto
     * ({@code contexto.campos[].name}). Si no existe, devuelve un set vacío (que
     * hace que sanitizeDesign descarte todas las dimension/measure, sin fallar).
     */
    @SuppressWarnings("unchecked")
    private Set<String> camposFromBody(Map<String, Object> body) {
        Set<String> campos = new HashSet<>();
        if (body == null) return campos;
        Object contextoRaw = body.get("contexto");
        if (!(contextoRaw instanceof Map<?, ?> contexto)) return campos;
        Object camposRaw = ((Map<String, Object>) contexto).get("campos");
        if (!(camposRaw instanceof List<?> list)) return campos;
        for (Object c : list) {
            if (c instanceof Map<?, ?> campo) {
                Object name = campo.get("name");
                if (name != null) campos.add(String.valueOf(name));
            }
        }
        return campos;
    }

    private Map<String, Object> error(String message) {
        return Map.of("ok", false, "message", message, "agent", bedrock.getAgentName());
    }

    private String serialize(Map<String, Object> body) {
        if (body == null) return "{}";
        try {
            return mapper.writeValueAsString(body);
        } catch (JsonProcessingException e) {
            return body.toString();
        }
    }

    private static String str(Object o) {
        return o == null ? "" : String.valueOf(o);
    }
}
