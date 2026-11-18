package io.datasense.ask;

import io.datasense.engine.Expressions;
import io.datasense.repo.AppRepository;

import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.nio.charset.StandardCharsets;
import java.util.Map;

/**
 * Análisis (solo lectura; exigen ver la app):
 * <pre>
 *   POST /api/v1/apps/{appId}/insights/explain    {expression | master_id, time_field?, current?, previous?, selections?, dimensions?, top?}
 *   POST /api/v1/apps/{appId}/insights/rows       {table?, selections?, where?, fields?, sort?, desc?, limit?}  → registros
 *   POST /api/v1/apps/{appId}/insights/rows.csv   lo mismo, como CSV para Excel
 *   POST /api/v1/apps/{appId}/insights/whatif     {measures:[{expression | master_id, label?}], changes:[...], dimension?, selections?}
 * </pre>
 */
@RestController
@RequestMapping("/api/v1/apps/{appId}/insights")
public class InsightController {

    private final AppRepository apps;
    private final InsightService insights;

    public InsightController(AppRepository apps, InsightService insights) {
        this.apps = apps;
        this.insights = insights;
    }

    private void requireApp(String appId) {
        apps.getApp(appId).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "App no encontrada: " + appId));
    }

    private static ResponseStatusException bad(RuntimeException e) { return new ResponseStatusException(HttpStatus.BAD_REQUEST, e.getMessage()); }

    @PostMapping("/explain")
    public Map<String, Object> explain(@PathVariable String appId, @RequestBody Map<String, Object> body) {
        requireApp(appId);
        try { return insights.explain(appId, body); } catch (IllegalArgumentException | Expressions.ExpressionError e) { throw bad(e); }
    }

    @PostMapping("/rows")
    public Map<String, Object> rows(@PathVariable String appId, @RequestBody Map<String, Object> body) {
        requireApp(appId);
        try { return insights.rows(appId, body); } catch (IllegalArgumentException | Expressions.ExpressionError e) { throw bad(e); }
    }

    @PostMapping(value = "/rows.csv")
    public ResponseEntity<byte[]> csv(@PathVariable String appId, @RequestBody Map<String, Object> body) {
        requireApp(appId);
        Map<String, Object> q = new java.util.HashMap<>(body);
        q.putIfAbsent("limit", 10000);
        Map<String, Object> r;
        try { r = insights.rows(appId, q); } catch (IllegalArgumentException | Expressions.ExpressionError e) { throw bad(e); }
        String name = String.valueOf(body.getOrDefault("filename", r.get("table"))).replaceAll("[^\\w\\-]+", "_");
        return ResponseEntity.ok()
                .contentType(new MediaType("text", "csv", StandardCharsets.UTF_8))
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + name + ".csv\"")
                .header("X-Total-Rows", String.valueOf(r.get("total")))
                .body(InsightService.csv(r).getBytes(StandardCharsets.UTF_8));
    }

    @PostMapping("/whatif")
    public Map<String, Object> whatIf(@PathVariable String appId, @RequestBody Map<String, Object> body) {
        requireApp(appId);
        try { return insights.whatIf(appId, body); } catch (IllegalArgumentException | Expressions.ExpressionError | ClassCastException e) { throw bad(e); }
    }
}
