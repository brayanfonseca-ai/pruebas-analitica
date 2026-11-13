package io.datasense.ask;

import io.datasense.repo.AppRepository;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.Map;

/**
 * Pregúntale a tus datos y De archivo a tablero.
 * <pre>
 *   POST /api/v1/apps/{appId}/ask              {question} → {ok, answer, chart, result, how, query, sheetObject} | {ok:false, message, suggestions}
 *   GET  /api/v1/apps/{appId}/ask/suggestions  → [pregunta]
 *   POST /api/v1/apps/{appId}/auto-dashboard   {table?, title?} → {sheet, summary, questions}
 * </pre>
 * Preguntar solo exige ver la app (es una consulta); generar el tablero exige editar.
 */
@RestController
@RequestMapping("/api/v1/apps/{appId}")
public class AskController {

    private final AppRepository apps;
    private final AskService ask;
    private final AutoDashboardService auto;

    public AskController(AppRepository apps, AskService ask, AutoDashboardService auto) {
        this.apps = apps;
        this.ask = ask;
        this.auto = auto;
    }

    private void requireApp(String appId) {
        apps.getApp(appId).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "App no encontrada: " + appId));
    }

    @PostMapping("/ask")
    public Map<String, Object> ask(@PathVariable String appId, @RequestBody Map<String, Object> body) {
        requireApp(appId);
        Object q = body == null ? null : body.get("question");
        return ask.ask(appId, q == null ? null : String.valueOf(q));
    }

    @GetMapping("/ask/suggestions")
    public List<String> suggestions(@PathVariable String appId) {
        requireApp(appId);
        return ask.suggestions(appId);
    }

    @PostMapping("/auto-dashboard")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> autoDashboard(@PathVariable String appId, @RequestBody(required = false) Map<String, Object> body) {
        requireApp(appId);
        try {
            return auto.build(appId, body == null || body.get("table") == null ? null : String.valueOf(body.get("table")),
                    body == null || body.get("title") == null ? null : String.valueOf(body.get("title")));
        } catch (IllegalArgumentException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, e.getMessage());
        }
    }
}
