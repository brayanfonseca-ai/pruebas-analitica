package io.datasense.agent;

import io.datasense.auth.AccessService;
import io.datasense.auth.UserRecord;
import io.datasense.repo.AppRepository;

import jakarta.servlet.http.HttpServletRequest;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.util.*;

/**
 * Agentes de IA propios. Leer y conversar exige {@code agents:use}; crear, editar y borrar, {@code agents:build}.
 * <ul>
 *   <li>{@code GET    /api/v1/agents/catalog} — plantillas, herramientas, estilos y el motor.</li>
 *   <li>{@code GET    /api/v1/agents} · {@code POST /api/v1/agents} {name?, template, app_id?, tools?, …}</li>
 *   <li>{@code GET/PUT/DELETE /api/v1/agents/{id}}</li>
 *   <li>{@code POST   /api/v1/agents/{id}/chat} {message, conversation_id?} → {answer, steps[], knowledge[], conversation_id}</li>
 *   <li>{@code GET    /api/v1/agents/{id}/conversations} · {@code GET/DELETE …/conversations/{cid}}</li>
 * </ul>
 * Un agente lo ve y lo edita su dueño (y el administrador); publicado, lo puede usar cualquiera con {@code agents:use}
 * que vea su app. Siempre corre con los permisos de quien conversa.
 */
@RestController
@RequestMapping("/api/v1/agents")
public class AgentController {

    private final AgentService agents;
    private final AppRepository apps;
    private final AccessService access;

    public AgentController(AgentService agents, AppRepository apps, AccessService access) {
        this.agents = agents;
        this.apps = apps;
        this.access = access;
    }

    private static UserRecord me(HttpServletRequest req) {
        UserRecord u = AccessService.current(req);
        if (u == null) throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Sesión no válida.");
        return u;
    }

    private Map<String, Object> visible(UserRecord u, String id) {
        Map<String, Object> r = agents.raw(id).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Agente no encontrado."));
        if (!agents.canUse(u, r)) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Agente no encontrado.");
        return r;
    }

    private Map<String, Object> editable(UserRecord u, String id) {
        Map<String, Object> r = visible(u, id);
        if (!agents.canEdit(u, r)) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Solo su dueño (o un administrador) puede cambiar este agente.");
        return r;
    }

    private void checkApp(UserRecord u, Object appId) {
        if (appId == null || String.valueOf(appId).isBlank()) return;
        var a = apps.getApp(String.valueOf(appId)).orElseThrow(() -> new ResponseStatusException(HttpStatus.BAD_REQUEST, "La aplicación no existe."));
        if (!access.canSee(u, a)) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "No tienes acceso a esa aplicación.");
    }

    @GetMapping("/catalog")
    public Map<String, Object> catalog() { return agents.catalog(); }

    @GetMapping
    public List<Map<String, Object>> list(HttpServletRequest req) { return agents.list(me(req)); }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> create(HttpServletRequest req, @RequestBody Map<String, Object> body) {
        UserRecord u = me(req);
        checkApp(u, body.get("app_id"));
        String id = agents.create(u, body);
        return agents.out(u, agents.raw(id).orElseThrow());
    }

    @GetMapping("/{id}")
    public Map<String, Object> get(HttpServletRequest req, @PathVariable String id) {
        UserRecord u = me(req);
        return agents.out(u, visible(u, id));
    }

    @PutMapping("/{id}")
    public Map<String, Object> update(HttpServletRequest req, @PathVariable String id, @RequestBody Map<String, Object> body) {
        UserRecord u = me(req);
        editable(u, id);
        if (body.containsKey("app_id")) checkApp(u, body.get("app_id"));
        try { agents.update(id, body); }
        catch (IllegalArgumentException e) { throw new ResponseStatusException(HttpStatus.BAD_REQUEST, e.getMessage()); }
        return agents.out(u, agents.raw(id).orElseThrow());
    }

    @DeleteMapping("/{id}")
    public Map<String, Object> delete(HttpServletRequest req, @PathVariable String id) {
        editable(me(req), id);
        agents.delete(id);
        return Map.of("ok", true);
    }

    @PostMapping("/{id}/chat")
    public Map<String, Object> chat(HttpServletRequest req, @PathVariable String id, @RequestBody Map<String, Object> body) {
        UserRecord u = me(req);
        Map<String, Object> a = visible(u, id);
        String msg = String.valueOf(body.getOrDefault("message", "")).trim();
        if (msg.isBlank()) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Escribe un mensaje.");
        if (msg.length() > 2000) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "El mensaje es demasiado largo (máximo 2.000 caracteres).");
        try {
            return agents.chat(u, a, msg, body.get("conversation_id") == null ? null : String.valueOf(body.get("conversation_id")));
        } catch (IllegalArgumentException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, e.getMessage());
        } catch (Exception e) {
            return Map.of("ok", false, "error", "No se pudo completar la conversación: " + e.getMessage());
        }
    }

    @GetMapping("/{id}/conversations")
    public List<Map<String, Object>> conversations(HttpServletRequest req, @PathVariable String id) {
        UserRecord u = me(req);
        visible(u, id);
        return agents.conversations(id, u.id());
    }

    @GetMapping("/{id}/conversations/{cid}")
    public Map<String, Object> conversation(HttpServletRequest req, @PathVariable String id, @PathVariable String cid) {
        UserRecord u = me(req);
        visible(u, id);
        return agents.conversation(id, u.id(), cid).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Conversación no encontrada."));
    }

    @DeleteMapping("/{id}/conversations/{cid}")
    public Map<String, Object> deleteConversation(HttpServletRequest req, @PathVariable String id, @PathVariable String cid) {
        UserRecord u = me(req);
        visible(u, id);
        if (!agents.deleteConversation(id, u.id(), cid)) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Conversación no encontrada.");
        return Map.of("ok", true);
    }
}
