package io.datasense.flow;

import io.datasense.auth.AccessService;
import io.datasense.auth.UserRecord;

import jakarta.mail.MessagingException;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.mail.javamail.JavaMailSenderImpl;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.util.*;

/**
 * Automatizaciones por nodos.
 * <pre>
 *   GET  /api/v1/flows/catalog                       nodos, categorías y tipos de credencial
 *   GET  /api/v1/flows/templates                     galería de plantillas
 *   GET  /api/v1/flows · POST /api/v1/flows          {name, description?, graph}
 *   GET/PUT/DELETE /api/v1/flows/{id}
 *   POST /api/v1/flows/{id}/enabled                  {enabled}
 *   POST /api/v1/flows/{id}/run                      {data?} → ejecución con el detalle por nodo
 *   GET  /api/v1/flows/{id}/runs · /runs/{runId}
 *   POST /api/v1/flows/{id}/webhook/rotate
 *   GET/POST /api/v1/flows/credentials · PUT/DELETE /credentials/{id} · POST /credentials/{id}/test
 *   POST|GET /api/v1/hooks/flows/{token}             PÚBLICO: dispara el flujo (disparador webhook)
 * </pre>
 * Cada persona ve y edita sus flujos (el administrador, todos). Las credenciales son siempre privadas.
 */
@RestController
public class FlowController {

    private final FlowRepository repo;
    private final FlowService service;

    public FlowController(FlowRepository repo, FlowService service) {
        this.repo = repo;
        this.service = service;
    }

    private static UserRecord me(HttpServletRequest req) { return AccessService.current(req); }
    private static ResponseStatusException bad(String m) { return new ResponseStatusException(HttpStatus.BAD_REQUEST, m); }

    private Map<String, Object> own(HttpServletRequest req, String id) {
        Map<String, Object> f = repo.raw(id).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Automatización no encontrada."));
        UserRecord u = me(req);
        if (!u.isAdmin() && !u.id().equals(f.get("owner_id"))) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Automatización no encontrada.");
        return f;
    }

    private Map<String, Object> full(String id) {
        Map<String, Object> o = repo.get(id).orElseThrow();
        @SuppressWarnings("unchecked") Map<String, Object> g = (Map<String, Object>) o.get("graph");
        o.put("problems", service.problems(g));
        o.put("webhook_path", "/api/v1/hooks/flows/" + o.get("webhook_token"));
        return o;
    }

    @GetMapping("/api/v1/flows/catalog")
    public Map<String, Object> catalog() {
        return Map.of("categories", FlowCatalog.CATEGORIES, "nodes", FlowCatalog.NODES, "credentials", FlowCatalog.CREDENTIALS,
                "template_help", List.of(
                        Map.of("expr", "{{ $json.campo }}", "desc", "Campo del registro que llega al nodo"),
                        Map.of("expr", "{{ $node[\"Nombre\"].json.campo }}", "desc", "Campo de la salida de un nodo anterior"),
                        Map.of("expr", "{{ $items | table }}", "desc", "Todos los registros como tabla HTML (para correos)"),
                        Map.of("expr", "{{ $items.length }}", "desc", "Cuántos registros llegan"),
                        Map.of("expr", "{{ $json.value | number:2 }}", "desc", "Número con formato (también percent, upper, json, join, list:campo)"),
                        Map.of("expr", "{{ $trigger.campo }}", "desc", "Dato con el que arrancó el flujo"),
                        Map.of("expr", "{{ $today }}", "desc", "Fecha de hoy ($now: fecha y hora)")));
    }

    @GetMapping("/api/v1/flows/templates")
    public List<Map<String, Object>> templates() { return FlowService.templates(); }

    @GetMapping("/api/v1/flows")
    public List<Map<String, Object>> list(HttpServletRequest req) {
        UserRecord u = me(req);
        return repo.list(u.id(), u.isAdmin());
    }

    @PostMapping("/api/v1/flows")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> create(HttpServletRequest req, @RequestBody Map<String, Object> body) {
        String name = FlowEngine.str(body.get("name")).strip();
        if (name.isEmpty()) throw bad("Ponle un nombre a la automatización.");
        Map<String, Object> g;
        try { g = service.normalize(body.getOrDefault("graph", Map.of("nodes", List.of(), "edges", List.of()))); }
        catch (IllegalArgumentException e) { throw bad(e.getMessage()); }
        UserRecord u = me(req);
        String id = repo.create(name.length() > 120 ? name.substring(0, 120) : name, blank(body.get("description")), g, u.id(), u.name());
        return full(id);
    }

    @GetMapping("/api/v1/flows/{id}")
    public Map<String, Object> get(HttpServletRequest req, @PathVariable String id) {
        own(req, id);
        return full(id);
    }

    @PutMapping("/api/v1/flows/{id}")
    public Map<String, Object> update(HttpServletRequest req, @PathVariable String id, @RequestBody Map<String, Object> body) {
        Map<String, Object> f = own(req, id);
        String name = body.get("name") == null ? FlowEngine.str(f.get("name")) : FlowEngine.str(body.get("name")).strip();
        if (name.isEmpty()) throw bad("Ponle un nombre a la automatización.");
        Map<String, Object> g;
        try { g = body.get("graph") == null ? repo.graph(f) : service.normalize(body.get("graph")); }
        catch (IllegalArgumentException e) { throw bad(e.getMessage()); }
        repo.update(id, name, body.containsKey("description") ? blank(body.get("description")) : (String) f.get("description"), g);
        // si está activa, el horario puede haber cambiado
        if (FlowRepository.toInt(f.get("enabled")) == 1) {
            List<String> pr = service.problems(g).stream().filter(s -> !s.startsWith("Hay ")).toList();
            if (pr.isEmpty()) repo.setEnabled(id, true, FlowService.nextRun(g, java.time.Instant.now()));
            else repo.setEnabled(id, false, null);
        }
        return full(id);
    }

    @DeleteMapping("/api/v1/flows/{id}")
    public ResponseEntity<Void> delete(HttpServletRequest req, @PathVariable String id) {
        own(req, id);
        repo.delete(id);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/api/v1/flows/{id}/enabled")
    public Map<String, Object> enabled(HttpServletRequest req, @PathVariable String id, @RequestBody Map<String, Object> body) {
        own(req, id);
        boolean on = Boolean.TRUE.equals(body.get("enabled")) || "true".equals(String.valueOf(body.get("enabled")));
        try { service.setEnabled(id, on); } catch (IllegalArgumentException e) { throw bad(e.getMessage()); }
        return full(id);
    }

    @SuppressWarnings("unchecked")
    @PostMapping("/api/v1/flows/{id}/run")
    public Map<String, Object> run(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> body) {
        Map<String, Object> f = own(req, id);
        Map<String, Object> data = body != null && body.get("data") instanceof Map<?, ?> m ? (Map<String, Object>) m : null;
        return service.runNow(f, me(req), data);
    }

    @GetMapping("/api/v1/flows/{id}/runs")
    public List<Map<String, Object>> runs(HttpServletRequest req, @PathVariable String id, @RequestParam(defaultValue = "20") int limit) {
        own(req, id);
        return repo.runs(id, limit);
    }

    @GetMapping("/api/v1/flows/{id}/runs/{runId}")
    public Map<String, Object> runDetail(HttpServletRequest req, @PathVariable String id, @PathVariable String runId) {
        own(req, id);
        return repo.run(runId).filter(r -> id.equals(r.get("flow_id")))
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Ejecución no encontrada."));
    }

    @PostMapping("/api/v1/flows/{id}/webhook/rotate")
    public Map<String, Object> rotate(HttpServletRequest req, @PathVariable String id) {
        own(req, id);
        repo.rotateToken(id);
        return full(id);
    }

    /* ------------------------------ credenciales ------------------------------ */

    @GetMapping("/api/v1/flows/credentials")
    public List<Map<String, Object>> credentials(HttpServletRequest req) { return repo.credentials(me(req).id()); }

    @PostMapping("/api/v1/flows/credentials")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> createCredential(HttpServletRequest req, @RequestBody Map<String, Object> body) {
        return saveCred(req, null, body);
    }

    @PutMapping("/api/v1/flows/credentials/{cid}")
    public Map<String, Object> updateCredential(HttpServletRequest req, @PathVariable String cid, @RequestBody Map<String, Object> body) {
        ownCred(req, cid);
        return saveCred(req, cid, body);
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> saveCred(HttpServletRequest req, String id, Map<String, Object> body) {
        String kind = id == null ? FlowEngine.str(body.get("kind")) : FlowEngine.str(repo.credentialRaw(id).orElseThrow().get("kind"));
        if (FlowCatalog.CREDENTIALS.stream().noneMatch(c -> kind.equals(c.get("kind")))) throw bad("Tipo de credencial inválido.");
        String name = FlowEngine.str(body.get("name")).strip();
        if (name.isEmpty()) throw bad("Ponle un nombre a la credencial.");
        Map<String, Object> cfg = body.get("config") instanceof Map<?, ?> m ? (Map<String, Object>) m : Map.of();
        if (cfg.get("url") != null && !FlowEngine.str(cfg.get("url")).isBlank() && !FlowEngine.str(cfg.get("url")).equals("••••••")
                && !FlowEngine.str(cfg.get("url")).matches("(?i)https?://.+")) throw bad("La URL debe empezar por http:// o https://.");
        String cid = repo.saveCredential(id, me(req).id(), kind, name, cfg);
        return repo.credOut(repo.credentialRaw(cid).orElseThrow());
    }

    @DeleteMapping("/api/v1/flows/credentials/{cid}")
    public ResponseEntity<Void> deleteCredential(HttpServletRequest req, @PathVariable String cid) {
        ownCred(req, cid);
        repo.deleteCredential(cid);
        return ResponseEntity.noContent().build();
    }

    /** Prueba la credencial: SMTP se conecta y se autentica; las demás validan que estén completas. */
    @PostMapping("/api/v1/flows/credentials/{cid}/test")
    public Map<String, Object> testCredential(HttpServletRequest req, @PathVariable String cid) {
        Map<String, Object> row = ownCred(req, cid);
        Map<String, Object> cfg = repo.credentialConfig(row);
        String kind = FlowEngine.str(row.get("kind"));
        try {
            switch (kind) {
                case "smtp" -> {
                    JavaMailSenderImpl s = new JavaMailSenderImpl();
                    s.setHost(FlowEngine.str(cfg.get("host")));
                    s.setPort(Integer.parseInt(FlowEngine.str(cfg.getOrDefault("port", "587")).trim()));
                    s.setUsername(blank(cfg.get("user"))); s.setPassword(blank(cfg.get("password")));
                    Properties p = s.getJavaMailProperties();
                    String sec = FlowEngine.str(cfg.getOrDefault("security", "starttls")).toLowerCase(Locale.ROOT);
                    p.put("mail.smtp.auth", String.valueOf(blank(cfg.get("user")) != null));
                    p.put("mail.smtp.connectiontimeout", "10000"); p.put("mail.smtp.timeout", "10000");
                    if ("ssl".equals(sec)) p.put("mail.smtp.ssl.enable", "true");
                    if ("starttls".equals(sec)) { p.put("mail.smtp.starttls.enable", "true"); p.put("mail.smtp.starttls.required", "true"); }
                    s.testConnection();
                    return Map.of("ok", true, "message", "Conexión y autenticación SMTP correctas.");
                }
                case "whatsapp_meta" -> { req(cfg, "phone_number_id", "token"); return Map.of("ok", true, "message", "Datos completos. Se verifican al enviar el primer mensaje."); }
                case "whatsapp_twilio" -> { req(cfg, "account_sid", "auth_token", "from"); return Map.of("ok", true, "message", "Datos completos. Se verifican al enviar el primer mensaje."); }
                case "webhook" -> { req(cfg, "url"); return Map.of("ok", true, "message", "URL configurada."); }
                default -> { req(cfg, "header", "value"); return Map.of("ok", true, "message", "Cabecera configurada."); }
            }
        } catch (MessagingException e) {
            Throwable t = e; while (t.getCause() != null) t = t.getCause();
            return Map.of("ok", false, "message", "No se pudo conectar: " + (t.getMessage() == null ? t.getClass().getSimpleName() : t.getMessage()));
        } catch (IllegalArgumentException e) {
            return Map.of("ok", false, "message", e.getMessage());
        }
    }

    private static void req(Map<String, Object> cfg, String... keys) {
        for (String k : keys) if (FlowEngine.str(cfg.get(k)).isBlank()) throw new IllegalArgumentException("Falta «" + k + "».");
    }

    private Map<String, Object> ownCred(HttpServletRequest req, String cid) {
        Map<String, Object> r = repo.credentialRaw(cid).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Credencial no encontrada."));
        if (!me(req).id().equals(r.get("owner_id"))) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Credencial no encontrada.");
        return r;
    }

    /* ------------------------------ webhook público ------------------------------ */

    @RequestMapping(value = "/api/v1/hooks/flows/{token}", method = {RequestMethod.POST, RequestMethod.GET})
    public ResponseEntity<Object> hook(HttpServletRequest req, @PathVariable String token, @RequestBody(required = false) Object body) {
        Map<String, Object> data = new LinkedHashMap<>();
        req.getParameterMap().forEach((k, v) -> data.put(k, v.length == 1 ? v[0] : List.of(v)));
        if (body instanceof Map<?, ?> m) m.forEach((k, v) -> data.put(String.valueOf(k), v));
        else if (body != null) data.put("body", body);
        try {
            Map<String, Object> r = service.webhook(token, data);
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("ok", "ok".equals(r.get("status")));
            out.put("run_id", r.get("run_id"));
            if (r.get("error") != null) out.put("error", r.get("error"));
            @SuppressWarnings("unchecked") List<Object> o = (List<Object>) r.get("output");
            out.put("data", o.size() == 1 ? o.get(0) : o);
            return ResponseEntity.status("ok".equals(r.get("status")) ? 200 : 500).body(out);
        } catch (NoSuchElementException e) {
            return ResponseEntity.status(404).body(Map.of("ok", false, "error", e.getMessage()));
        } catch (IllegalStateException e) {
            return ResponseEntity.status(409).body(Map.of("ok", false, "error", e.getMessage()));
        }
    }

    private static String blank(Object o) { String s = FlowEngine.str(o).strip(); return s.isEmpty() ? null : s; }
}
