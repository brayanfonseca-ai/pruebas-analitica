package io.datasense.web;

import io.datasense.auth.AccessService;
import io.datasense.auth.Permissions;
import io.datasense.auth.UserRecord;
import io.datasense.repo.AppRepository;
import io.datasense.repo.CommentRepository;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.Map;

/**
 * Comentarios sobre los objetos de una hoja: el equipo conversa sobre un gráfico (o sobre un punto concreto) en el
 * propio tablero. Cualquiera que vea la app puede leer y comentar ({@code dashboard:view}); borrar un comentario lo
 * puede su autor o quien administra/publica; resolverlo, cualquiera que pueda comentar.
 *
 * <pre>
 *   GET    /apps/{appId}/comments?sheetId=&amp;objectId=
 *   POST   /apps/{appId}/comments               {sheetId, objectId, text, point?, selections?}
 *   PUT    /apps/{appId}/comments/{id}          {resolved}
 *   DELETE /apps/{appId}/comments/{id}
 * </pre>
 */
@RestController
@RequestMapping("/api/v1/apps/{appId}/comments")
public class CommentController {

    private final AppRepository apps;
    private final CommentRepository comments;

    public CommentController(AppRepository apps, CommentRepository comments) {
        this.apps = apps;
        this.comments = comments;
    }

    private void requireApp(String appId) {
        apps.getApp(appId).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "App no encontrada: " + appId));
    }

    @GetMapping
    public List<Map<String, Object>> list(@PathVariable String appId, @RequestParam(required = false) String sheetId,
                                          @RequestParam(required = false) String objectId) {
        requireApp(appId);
        return comments.list(appId, sheetId, objectId);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> create(HttpServletRequest req, @PathVariable String appId, @RequestBody Map<String, Object> body) {
        requireApp(appId);
        String sheetId = str(body.get("sheetId")), objectId = str(body.get("objectId")), text = str(body.get("text")).strip();
        if (sheetId.isBlank() || objectId.isBlank()) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Falta la hoja (sheetId) o el objeto (objectId).");
        if (text.isEmpty()) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Escribe el comentario.");
        if (text.length() > 2000) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "El comentario es muy largo (máximo 2000 caracteres).");
        String point = str(body.get("point")).strip();
        if (point.length() > 200) point = point.substring(0, 200);
        UserRecord me = AccessService.current(req);
        @SuppressWarnings("unchecked")
        Map<String, Object> sel = body.get("selections") instanceof Map<?, ?> s ? (Map<String, Object>) s : null;
        return comments.create(appId, sheetId, objectId, point.isEmpty() ? null : point, text,
                me == null ? null : me.id(), me == null ? null : me.name(), sel);
    }

    @PutMapping("/{commentId}")
    public Map<String, Object> update(@PathVariable String appId, @PathVariable String commentId, @RequestBody Map<String, Object> body) {
        requireApp(appId);
        get(appId, commentId);
        boolean resolved = Boolean.TRUE.equals(body.get("resolved")) || "true".equals(String.valueOf(body.get("resolved")));
        return comments.setResolved(commentId, resolved).orElseThrow();
    }

    @DeleteMapping("/{commentId}")
    public ResponseEntity<Void> delete(HttpServletRequest req, @PathVariable String appId, @PathVariable String commentId) {
        requireApp(appId);
        Map<String, Object> c = get(appId, commentId);
        UserRecord me = AccessService.current(req);
        boolean own = me != null && me.id().equals(c.get("author_id"));
        if (!own && (me == null || !(me.isAdmin() || me.has(Permissions.PUBLISH))))
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Solo el autor del comentario (o quien publica) puede borrarlo.");
        comments.delete(commentId);
        return ResponseEntity.noContent().build();
    }

    private Map<String, Object> get(String appId, String id) {
        Map<String, Object> c = comments.get(id).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Comentario no encontrado."));
        if (!appId.equals(c.get("app_id"))) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Comentario no encontrado.");
        return c;
    }

    private static String str(Object o) { return o == null ? "" : String.valueOf(o); }
}
