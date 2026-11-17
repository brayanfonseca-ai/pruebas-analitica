package io.datasense.web;

import io.datasense.auth.AccessService;
import io.datasense.auth.Permissions;
import io.datasense.auth.UserRecord;
import io.datasense.repo.NotificationRepository;
import io.datasense.repo.NotificationRepository.NotificationFeed;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

/**
 * Notificaciones de la campana. El administrador (users:manage) ve la actividad de la plataforma (nuevas apps,
 * datos cargados, hojas, maestros, conexiones, ML) y todos los eventos de automatización; cualquier otro usuario
 * ve sus propios eventos (alertas disparadas o resueltas, recargas programadas). El estado de lectura es por usuario.
 *
 * <ul>
 *   <li>{@code GET  /api/v1/notifications?limit=50&unread=false} → {items, unread, total}</li>
 *   <li>{@code POST /api/v1/notifications/read-all} → marca todas como leídas</li>
 *   <li>{@code POST /api/v1/notifications/{id}/read} → marca una (id tipo {@code sheet:<id>} o {@code evt:<id>})</li>
 *   <li>{@code POST /api/v1/notifications/clear} → vacía el panel (no borra datos)</li>
 * </ul>
 */
@RestController
@RequestMapping("/api/v1/notifications")
public class NotificationController {

    private final NotificationRepository repo;

    public NotificationController(NotificationRepository repo) {
        this.repo = repo;
    }

    private static UserRecord me(HttpServletRequest req) { return AccessService.current(req); }

    @GetMapping
    public NotificationFeed list(HttpServletRequest req, @RequestParam(defaultValue = "50") int limit,
                                 @RequestParam(defaultValue = "false") boolean unread) {
        UserRecord u = me(req);
        return repo.feed(u.id(), u.has(Permissions.USERS), limit, unread);
    }

    @PostMapping("/read-all")
    public Map<String, Object> readAll(HttpServletRequest req) {
        repo.markAllRead(me(req).id());
        return Map.of("ok", true, "unread", 0);
    }

    @PostMapping("/{id}/read")
    public ResponseEntity<Void> read(HttpServletRequest req, @PathVariable String id) {
        repo.markRead(me(req).id(), id);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/clear")
    public Map<String, Object> clear(HttpServletRequest req) {
        repo.clear(me(req).id());
        return Map.of("ok", true);
    }
}
