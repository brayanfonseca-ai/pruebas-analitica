package io.datasense.embed;

import com.fasterxml.jackson.databind.ObjectMapper;

import io.datasense.auth.AccessService;
import io.datasense.auth.UserRecord;
import io.datasense.model.AppModels.AppOut;
import io.datasense.repo.AppRepository;
import io.datasense.repo.SheetRepository;

import jakarta.servlet.http.HttpServletRequest;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.*;

/**
 * Gestión de embeds (requiere {@code embed:manage}).
 * <ul>
 *   <li>{@code GET    /api/v1/embeds}</li>
 *   <li>{@code POST   /api/v1/embeds} {name, app_id, sheet_id, allowed_origins?: [..], expires_in_days?, options?: {theme, hideTitle, hideSelections}}</li>
 *   <li>{@code PUT    /api/v1/embeds/{id}} {name?, enabled?, allowed_origins?, expires_in_days? (0 = sin vencimiento), options?}</li>
 *   <li>{@code POST   /api/v1/embeds/{id}/rotate} — token nuevo; el anterior deja de servir</li>
 *   <li>{@code DELETE /api/v1/embeds/{id}}</li>
 * </ul>
 * La página pública es {@code /embed/{token}} (ver {@link EmbedPageController}).
 */
@RestController
@RequestMapping("/api/v1/embeds")
public class EmbedController {

    private final EmbedRepository repo;
    private final EmbedService service;
    private final AppRepository apps;
    private final SheetRepository sheets;
    private final AccessService access;
    private final ObjectMapper mapper = new ObjectMapper();

    public EmbedController(EmbedRepository repo, EmbedService service, AppRepository apps, SheetRepository sheets, AccessService access) {
        this.repo = repo;
        this.service = service;
        this.apps = apps;
        this.sheets = sheets;
        this.access = access;
    }

    private Map<String, Object> view(EmbedRecord e) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", e.id());
        m.put("name", e.name());
        m.put("app_id", e.appId());
        m.put("app_name", apps.getApp(e.appId()).map(AppOut::name).orElse("(app eliminada)"));
        m.put("app_stage", apps.getApp(e.appId()).map(AppOut::stage).orElse(null));
        m.put("sheet_id", e.sheetId());
        m.put("sheet_title", sheets.get(e.sheetId()).map((s) -> (Object) s.get("title")).orElse("(hoja eliminada)"));
        m.put("token", e.token());
        m.put("enabled", e.enabled());
        m.put("status", service.status(e));
        m.put("status_message", EmbedService.statusMessage(service.status(e)));
        m.put("allowed_origins", e.origins());
        m.put("expires_at", e.expiresAt());
        m.put("options", options(e.optionsJson()));
        m.put("created_by", e.createdBy());
        m.put("created_at", e.createdAt());
        m.put("last_used_at", e.lastUsedAt());
        m.put("views", e.views());
        m.put("path", "/embed/" + e.token());
        return m;
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> options(String json) {
        try { return mapper.readValue(json == null ? "{}" : json, Map.class); } catch (Exception ex) { return Map.of(); }
    }

    @GetMapping
    public List<Map<String, Object>> list() {
        return repo.list().stream().map(this::view).toList();
    }

    @SuppressWarnings("unchecked")
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> create(HttpServletRequest req, @RequestBody Map<String, Object> body) {
        UserRecord me = AccessService.current(req);
        String name = str(body.get("name")).trim();
        String appId = str(body.get("app_id"));
        String sheetId = str(body.get("sheet_id"));
        if (name.isBlank()) throw bad("Ponle un nombre al embed (por ejemplo, «Portal de clientes»).");
        AppOut app = apps.getApp(appId).filter((a) -> access.canSee(me, a))
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "App no encontrada: " + appId));
        Map<String, Object> sheet = sheets.get(sheetId).filter((s) -> appId.equals(s.get("app_id")))
                .orElseThrow(() -> bad("La hoja no pertenece a esa aplicación."));
        List<String> origins = origins(body.get("allowed_origins"));
        String expires = null;
        if (body.get("expires_in_days") != null) expires = expiry(body.get("expires_in_days"));
        Map<String, Object> opts = sanitizeOptions(body.get("options") instanceof Map<?, ?> m ? (Map<String, Object>) m : Map.of());
        EmbedRecord rec = repo.create(name, app.id(), String.valueOf(sheet.get("id")), String.join(",", origins), expires, write(opts), me.id());
        return view(rec);
    }

    @SuppressWarnings("unchecked")
    @PutMapping("/{id}")
    public Map<String, Object> update(@PathVariable String id, @RequestBody Map<String, Object> body) {
        EmbedRecord cur = repo.get(id).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Embed no encontrado: " + id));
        String name = body.containsKey("name") ? str(body.get("name")).trim() : null;
        if (name != null && name.isBlank()) throw bad("El nombre no puede estar vacío.");
        Boolean enabled = body.containsKey("enabled") ? Boolean.TRUE.equals(body.get("enabled")) : null;
        String origins = body.containsKey("allowed_origins") ? String.join(",", origins(body.get("allowed_origins"))) : null;
        boolean expProvided = body.containsKey("expires_in_days");
        String expires = expProvided ? expiry(body.get("expires_in_days")) : null;
        String opts = null;
        if (body.get("options") instanceof Map<?, ?> m) {
            Map<String, Object> merged = new LinkedHashMap<>(options(cur.optionsJson()));
            merged.putAll(sanitizeOptions((Map<String, Object>) m));
            opts = write(merged);
        }
        return view(repo.update(id, name, enabled, origins, expires, expProvided, opts).orElseThrow());
    }

    @PostMapping("/{id}/rotate")
    public Map<String, Object> rotate(@PathVariable String id) {
        return view(repo.rotate(id).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Embed no encontrado: " + id)));
    }

    @DeleteMapping("/{id}")
    public Map<String, Object> delete(@PathVariable String id) {
        if (!repo.delete(id)) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Embed no encontrado: " + id);
        return Map.of("ok", true);
    }

    /* ---- utilidades ---- */

    private static ResponseStatusException bad(String m) { return new ResponseStatusException(HttpStatus.BAD_REQUEST, m); }
    private static String str(Object o) { return o == null ? "" : String.valueOf(o); }

    private String write(Object o) {
        try { return mapper.writeValueAsString(o); } catch (Exception e) { return "{}"; }
    }

    /** Orígenes tipo https://portal.empresa.com (sin ruta). Acepta lista o texto separado por comas/espacios. */
    private List<String> origins(Object raw) {
        List<String> in = new ArrayList<>();
        if (raw instanceof List<?> l) for (Object o : l) in.add(String.valueOf(o));
        else if (raw != null) in.addAll(Arrays.asList(String.valueOf(raw).split("[,\\s]+")));
        List<String> out = new ArrayList<>();
        for (String s : in) {
            String t = s.trim();
            if (t.isEmpty()) continue;
            if (t.endsWith("/")) t = t.substring(0, t.length() - 1);
            if (!t.matches("(?i)^https?://[a-z0-9.-]+(:\\d{1,5})?$"))
                throw bad("Origen no válido: «" + s + "». Usa el formato https://portal.empresa.com (sin ruta).");
            if (!out.contains(t)) out.add(t);
        }
        return out;
    }

    private String expiry(Object days) {
        if (days == null) return null;
        int d;
        try { d = Integer.parseInt(String.valueOf(days)); } catch (NumberFormatException e) { throw bad("Los días de vigencia deben ser un número."); }
        if (d <= 0) return null; // sin vencimiento
        if (d > 3650) throw bad("La vigencia máxima es de 3650 días.");
        return OffsetDateTime.now(ZoneOffset.UTC).plusDays(d).toString();
    }

    /** Solo opciones conocidas: theme (light|dark|auto), hideTitle, hideSelections. */
    private Map<String, Object> sanitizeOptions(Map<String, Object> in) {
        Map<String, Object> out = new LinkedHashMap<>();
        if (in.containsKey("theme")) {
            String t = str(in.get("theme"));
            out.put("theme", List.of("light", "dark", "auto").contains(t) ? t : "auto");
        }
        for (String k : List.of("hideTitle", "hideSelections")) if (in.containsKey(k)) out.put(k, Boolean.TRUE.equals(in.get(k)));
        return out;
    }
}
