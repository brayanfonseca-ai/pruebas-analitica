package io.datasense.web;

import io.datasense.repo.NotificationRepository;
import io.datasense.repo.NotificationRepository.NotificationFeed;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

/**
 * Notificaciones de actividad (nuevas apps, datos cargados, hojas, colecciones,
 * elementos maestros, conexiones, experimentos y ejecuciones de ML).
 *
 * <ul>
 *   <li>{@code GET  /api/v1/notifications?limit=50&unread=false} → {items, unread, total}</li>
 *   <li>{@code POST /api/v1/notifications/read-all} → marca todas como leídas</li>
 *   <li>{@code POST /api/v1/notifications/{id}/read} → marca una (id tipo {@code sheet:<id>})</li>
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

    @GetMapping
    public NotificationFeed list(@RequestParam(defaultValue = "50") int limit,
                                 @RequestParam(defaultValue = "false") boolean unread) {
        return repo.feed(limit, unread);
    }

    @PostMapping("/read-all")
    public Map<String, Object> readAll() {
        repo.markAllRead();
        return Map.of("ok", true, "unread", 0);
    }

    @PostMapping("/{id}/read")
    public ResponseEntity<Void> read(@PathVariable String id) {
        repo.markRead(id);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/clear")
    public Map<String, Object> clear() {
        repo.clear();
        return Map.of("ok", true);
    }
}
