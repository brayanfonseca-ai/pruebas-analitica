package io.datasense.web;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import io.datasense.ai.BedrockService;
import io.datasense.ai.BedrockService.AiResult;
import io.datasense.auth.AccessService;
import io.datasense.repo.AppRepository;
import io.datasense.repo.NotesRepository;

import jakarta.servlet.http.HttpServletRequest;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.util.*;

/**
 * Notas para el agente (diccionario de datos de una app).
 * <ul>
 *   <li>{@code GET  /api/v1/apps/{appId}/notes} — tablas, columnas (perfil + notas + muestras + cruces detectados) y cobertura.</li>
 *   <li>{@code PUT  /api/v1/apps/{appId}/notes} — guarda {app_text?, tables:[{name, description?, grain?, columns:[{name, description?, semantic?, synonyms?, joins?}]}]}.</li>
 *   <li>{@code GET  /api/v1/apps/{appId}/notes/context} — el texto que recibe el agente (IA y MCP).</li>
 *   <li>{@code POST /api/v1/apps/{appId}/notes/suggest} — pide a la IA borradores de descripción para lo no documentado (no guarda).</li>
 * </ul>
 * Requiere {@code charts:edit}.
 */
@RestController
@RequestMapping("/api/v1/apps/{appId}/notes")
public class NotesController {

    private final AppRepository apps;
    private final NotesRepository notes;
    private final BedrockService bedrock;
    private final ObjectMapper mapper = new ObjectMapper();

    public NotesController(AppRepository apps, NotesRepository notes, BedrockService bedrock) {
        this.apps = apps;
        this.notes = notes;
        this.bedrock = bedrock;
    }

    private void requireApp(String appId) {
        apps.getApp(appId).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "App no encontrada: " + appId));
    }

    @GetMapping
    public Map<String, Object> get(@PathVariable String appId) {
        requireApp(appId);
        return notes.get(appId);
    }

    @PutMapping
    public Map<String, Object> put(@PathVariable String appId, HttpServletRequest req, @RequestBody Map<String, Object> body) {
        requireApp(appId);
        try {
            notes.save(appId, AccessService.current(req).id(), body);
        } catch (IllegalArgumentException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, e.getMessage());
        }
        return notes.get(appId);
    }

    @GetMapping("/context")
    public Map<String, Object> context(@PathVariable String appId) {
        requireApp(appId);
        String text = notes.contextFor(appId);
        return Map.of("app_id", appId, "text", text, "empty", text.isBlank());
    }

    /**
     * Borradores de descripción con IA para lo que aún no está documentado. NO guarda nada: la persona revisa y acepta.
     * Se envían a la IA nombres de tablas/columnas, tipos y hasta 4 valores de ejemplo por columna.
     */
    @SuppressWarnings("unchecked")
    @PostMapping("/suggest")
    public Map<String, Object> suggest(@PathVariable String appId, @RequestBody(required = false) Map<String, Object> body) {
        requireApp(appId);
        String only = body == null || body.get("table") == null ? "" : String.valueOf(body.get("table"));
        Map<String, Object> g = notes.get(appId);
        StringBuilder prompt = new StringBuilder();
        prompt.append("Contexto del negocio (puede estar vacío): ").append(g.get("app_text")).append("\n\nTablas y columnas por documentar:\n");
        int pending = 0;
        for (Map<String, Object> t : (List<Map<String, Object>>) g.get("tables")) {
            if (!only.isBlank() && !only.equals(t.get("name"))) continue;
            prompt.append("\nTabla ").append(t.get("name")).append(t.get("rows") == null ? "" : " (" + t.get("rows") + " filas)").append("\n");
            for (Map<String, Object> c : (List<Map<String, Object>>) t.get("columns")) {
                if (Boolean.TRUE.equals(c.get("documented"))) continue;
                pending++;
                prompt.append("- ").append(c.get("name")).append(" [").append(c.get("type")).append("] ejemplos: ")
                        .append(c.get("samples")).append("\n");
            }
        }
        if (pending == 0) return Map.of("ok", true, "tables", List.of(), "message", "Todo está documentado.");
        String system = """
                Eres un analista de datos que documenta un diccionario de datos para que un agente de IA entienda cada columna.
                Con los nombres, tipos y ejemplos recibidos, propone para cada columna: una descripción breve y concreta en español
                (qué representa, unidad si se infiere) y su tipo semántico, uno de: id, dimension, measure, date, category, text, flag.
                No inventes datos que no se puedan inferir: si no estás seguro, describe lo que se ve y marca la duda.
                Responde SOLO con JSON válido, sin texto extra ni bloques de código, con esta forma:
                {"tables":[{"name":"<tabla>","description":"<qué contiene>","columns":[{"name":"<columna>","description":"<...>","semantic":"<tipo>"}]}]}""";
        AiResult r = bedrock.converse(system, prompt.toString());
        if (!r.ok()) return Map.of("ok", false, "message", String.valueOf(r.message()));
        try {
            String txt = r.text();
            int a = txt.indexOf('{'), b = txt.lastIndexOf('}');
            if (a < 0 || b <= a) return Map.of("ok", false, "message", "La IA no devolvió un formato válido. Inténtalo de nuevo.");
            JsonNode root = mapper.readTree(txt.substring(a, b + 1));
            List<Object> tables = new ArrayList<>();
            Set<String> valid = new HashSet<>(NotesRepository.SEMANTICS);
            for (JsonNode t : root.path("tables")) {
                Map<String, Object> to = new LinkedHashMap<>();
                to.put("name", t.path("name").asText());
                to.put("description", t.path("description").asText(""));
                List<Object> cols = new ArrayList<>();
                for (JsonNode c : t.path("columns")) {
                    String sem = c.path("semantic").asText("").toLowerCase();
                    cols.add(Map.of("name", c.path("name").asText(), "description", c.path("description").asText(""),
                            "semantic", valid.contains(sem) ? sem : ""));
                }
                to.put("columns", cols);
                tables.add(to);
            }
            return Map.of("ok", true, "tables", tables, "message", "Borradores listos: revísalos y acepta los que te sirvan.");
        } catch (Exception e) {
            return Map.of("ok", false, "message", "No se pudo interpretar la respuesta de la IA: " + e.getMessage());
        }
    }
}
