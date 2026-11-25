package io.datasense.knowledge;

import io.datasense.auth.AccessService;
import io.datasense.auth.UserRecord;
import io.datasense.repo.AppRepository;

import jakarta.servlet.http.HttpServletRequest;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.util.*;

/**
 * Base de conocimiento personal (exige {@code knowledge:use}; cada persona ve solo lo suyo).
 * <ul>
 *   <li>{@code GET/PUT /api/v1/knowledge/settings} — {enabled, sources:{kind:bool}, retention_days} + estadísticas.</li>
 *   <li>{@code GET /api/v1/knowledge/docs?kind=&app_id=&limit=&offset=} — documentos recientes.</li>
 *   <li>{@code GET /api/v1/knowledge/search?q=&app_id=&kind=&limit=} — búsqueda por relevancia.</li>
 *   <li>{@code GET /api/v1/knowledge/graph?app_id=&kind=&limit=&docs=} — nodos y aristas del grafo.</li>
 *   <li>{@code GET /api/v1/knowledge/entities/{key}} — documentos y vecinos de una entidad.</li>
 *   <li>{@code POST /api/v1/knowledge/notes} {title, text, app_id?} — nota manual.</li>
 *   <li>{@code POST /api/v1/knowledge/capture} {kind: report, app_id?, title, text, entities?} — eventos que ocurren en el
 *       navegador (historias de datos, presentaciones, PDF).</li>
 *   <li>{@code DELETE /api/v1/knowledge/docs/{id}} y {@code DELETE /api/v1/knowledge/docs} (vaciar todo).</li>
 *   <li>{@code GET /api/v1/knowledge/export} — todo en JSON.</li>
 * </ul>
 */
@RestController
@RequestMapping("/api/v1/knowledge")
public class KnowledgeController {

    private final KnowledgeService kb;
    private final AppRepository apps;
    private final AccessService access;

    public KnowledgeController(KnowledgeService kb, AppRepository apps, AccessService access) {
        this.kb = kb;
        this.apps = apps;
        this.access = access;
    }

    private static UserRecord me(HttpServletRequest req) {
        UserRecord u = AccessService.current(req);
        if (u == null) throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Sesión no válida.");
        return u;
    }

    private void requireOn(UserRecord u) {
        if (!kb.enabled(u.id())) throw new ResponseStatusException(HttpStatus.CONFLICT, "Tu base de conocimiento está apagada. Actívala en Conocimiento → Ajustes.");
    }

    private String checkApp(UserRecord u, Object appId) {
        if (appId == null || String.valueOf(appId).isBlank()) return null;
        String id = String.valueOf(appId);
        var a = apps.getApp(id).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "App no encontrada: " + id));
        if (!access.canSee(u, a)) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "App no encontrada: " + id);
        return id;
    }

    @GetMapping("/settings")
    public Map<String, Object> settings(HttpServletRequest req) { return kb.withStats(me(req).id()); }

    @PutMapping("/settings")
    public Map<String, Object> update(HttpServletRequest req, @RequestBody Map<String, Object> body) { return kb.updateSettings(me(req).id(), body); }

    @GetMapping("/docs")
    public List<Map<String, Object>> docs(HttpServletRequest req, @RequestParam(required = false) String kind, @RequestParam(name = "app_id", required = false) String appId,
                                          @RequestParam(defaultValue = "50") int limit, @RequestParam(defaultValue = "0") int offset) {
        UserRecord u = me(req);
        return kb.list(u, kind, appId, limit, offset);
    }

    @GetMapping("/docs/{id}")
    public Map<String, Object> doc(HttpServletRequest req, @PathVariable String id) {
        return kb.doc(me(req), id).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Documento no encontrado."));
    }

    @GetMapping("/search")
    public Map<String, Object> search(HttpServletRequest req, @RequestParam String q, @RequestParam(name = "app_id", required = false) String appId,
                                      @RequestParam(required = false) String kind, @RequestParam(defaultValue = "20") int limit) {
        UserRecord u = me(req);
        if (q.length() > 300) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "La búsqueda es demasiado larga (máximo 300).");
        return kb.search(u, q, appId, kind, Math.max(1, Math.min(100, limit)));
    }

    @GetMapping("/graph")
    public Map<String, Object> graph(HttpServletRequest req, @RequestParam(name = "app_id", required = false) String appId, @RequestParam(required = false) String kind,
                                     @RequestParam(defaultValue = "200") int limit, @RequestParam(defaultValue = "false") boolean docs) {
        return kb.graph(me(req), appId, kind, limit, docs);
    }

    @GetMapping("/entities/{key}")
    public Map<String, Object> entity(HttpServletRequest req, @PathVariable String key) {
        try { return kb.entity(me(req), key); }
        catch (NoSuchElementException e) { throw new ResponseStatusException(HttpStatus.NOT_FOUND, e.getMessage()); }
    }

    @PostMapping("/notes")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> note(HttpServletRequest req, @RequestBody Map<String, Object> body) {
        UserRecord u = me(req);
        requireOn(u);
        String title = String.valueOf(body.getOrDefault("title", "")).trim();
        if (title.isBlank()) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Ponle un título a la nota.");
        return kb.captureNow(u, checkApp(u, body.get("app_id")), "note", null, title, String.valueOf(body.getOrDefault("text", "")), hints(body.get("entities")), Map.of());
    }

    @PostMapping("/capture")
    public Map<String, Object> capture(HttpServletRequest req, @RequestBody Map<String, Object> body) {
        UserRecord u = me(req);
        String kind = String.valueOf(body.getOrDefault("kind", "report"));
        if (!Set.of("report").contains(kind)) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Desde el navegador solo se capturan informes (kind=report).");
        if (!kb.enabled(u.id())) return Map.of("ok", true, "stored", false, "reason", "La base de conocimiento está apagada.");
        String title = String.valueOf(body.getOrDefault("title", "")).trim();
        if (title.isBlank()) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Falta el título.");
        String ref = body.get("ref") == null ? null : "report:" + body.get("ref");
        kb.capture(u, checkApp(u, body.get("app_id")), kind, ref, title, String.valueOf(body.getOrDefault("text", "")), hints(body.get("entities")), Map.of());
        return Map.of("ok", true, "stored", kb.sourceOn(u.id(), kind));
    }

    private static List<KnowledgeService.Hint> hints(Object raw) {
        List<KnowledgeService.Hint> out = new ArrayList<>();
        if (raw instanceof List<?> l) for (Object o : l) {
            if (out.size() >= 20) break;
            if (o instanceof Map<?, ?> m) out.add(new KnowledgeService.Hint(String.valueOf(m.get("label")), m.get("type") == null ? "concept" : String.valueOf(m.get("type"))));
            else if (o != null) out.add(new KnowledgeService.Hint(String.valueOf(o), "concept"));
        }
        return out;
    }

    @DeleteMapping("/docs/{id}")
    public Map<String, Object> delete(HttpServletRequest req, @PathVariable String id) {
        if (!kb.delete(me(req), id)) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Documento no encontrado.");
        return Map.of("ok", true);
    }

    @DeleteMapping("/docs")
    public Map<String, Object> clear(HttpServletRequest req) {
        return Map.of("ok", true, "deleted", kb.clear(me(req).id()));
    }

    @GetMapping("/export")
    public Map<String, Object> export(HttpServletRequest req) {
        UserRecord u = me(req);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("exported_at", io.datasense.repo.Ids.now());
        out.put("user", u.email());
        out.put("settings", kb.settings(u.id()));
        out.put("documents", kb.export(u));
        return out;
    }
}
