package io.datasense.embed;

import com.fasterxml.jackson.databind.ObjectMapper;

import jakarta.servlet.http.HttpServletRequest;

import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.ResponseBody;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Página pública del embed: {@code GET /embed/{token}}. No pide inicio de sesión; el token manda.
 * Fija {@code Content-Security-Policy: frame-ancestors} con los orígenes permitidos del embed (o cualquiera si no
 * se restringió) y, si el navegador envía {@code Referer}, rechaza orígenes no permitidos. Entrega una página mínima
 * (frontend/pages/embed.html) que pinta la hoja en solo lectura usando el mismo motor de las hojas.
 */
@Controller
public class EmbedPageController {

    private final EmbedService service;
    private final EmbedRepository repo;
    private final ObjectMapper mapper = new ObjectMapper();

    public EmbedPageController(EmbedService service, EmbedRepository repo) {
        this.service = service;
        this.repo = repo;
    }

    @GetMapping(value = "/embed/{token}", produces = MediaType.TEXT_HTML_VALUE + ";charset=UTF-8")
    @ResponseBody
    public ResponseEntity<String> page(@PathVariable String token, HttpServletRequest req) {
        EmbedService.Authn a = service.authenticate(token);
        if (!a.ok()) return error(a.status(), a.error(), a.embed() == null ? List.of() : a.embed().origins());

        EmbedRecord e = a.embed();
        List<String> origins = e.origins();
        String from = originOf(req.getHeader("Origin"), req.getHeader("Referer"));
        String self = req.getScheme() + "://" + req.getServerName() + ((req.getServerPort() == 80 || req.getServerPort() == 443) ? "" : ":" + req.getServerPort());
        if (!origins.isEmpty() && from != null && !from.equalsIgnoreCase(self)
                && origins.stream().noneMatch((o) -> o.equalsIgnoreCase(from))) {
            return error(403, "Este sitio (" + from + ") no está autorizado para mostrar este tablero.", origins);
        }

        String html;
        try {
            html = Files.readString(Path.of("../frontend/pages/embed.html"), StandardCharsets.UTF_8);
        } catch (Exception ex) {
            return error(500, "No se encontró la plantilla de embedding.", origins);
        }
        Map<String, Object> cfg = new LinkedHashMap<>();
        cfg.put("token", e.token());
        cfg.put("appId", e.appId());
        cfg.put("sheetId", e.sheetId());
        cfg.put("name", e.name());
        try { cfg.put("options", mapper.readValue(e.optionsJson() == null ? "{}" : e.optionsJson(), Map.class)); } catch (Exception ex) { cfg.put("options", Map.of()); }
        String json;
        try { json = mapper.writeValueAsString(cfg).replace("<", "\\u003c"); } catch (Exception ex) { json = "{}"; }
        html = html.replace("/*__DS_EMBED__*/", "window.__DS_EMBED = " + json + ";");
        repo.touch(e.id());
        return ResponseEntity.ok().headers(headers(origins)).body(html);
    }

    private static HttpHeaders headers(List<String> origins) {
        HttpHeaders h = new HttpHeaders();
        h.set("Content-Security-Policy", "frame-ancestors " + (origins.isEmpty() ? "*" : "'self' " + String.join(" ", origins)));
        h.set("Cache-Control", "no-store");
        h.set("X-Content-Type-Options", "nosniff");
        return h;
    }

    private ResponseEntity<String> error(int status, String msg, List<String> origins) {
        String safe = msg.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
        String body = "<!doctype html><html lang=\"es\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
                + "<title>DataSense · Embed</title><style>html,body{height:100%;margin:0}body{display:grid;place-items:center;font-family:Segoe UI,system-ui,sans-serif;"
                + "background:#0b1022;color:#e6ebf5}div{max-width:420px;text-align:center;padding:28px;border:1px solid #222e4d;border-radius:16px;background:#10182c}"
                + "b{display:block;font-size:1.05rem;margin-bottom:8px}p{margin:0;color:#94a3b8;font-size:.9rem;line-height:1.5}</style></head><body><div>"
                + "<b>No se puede mostrar este tablero</b><p>" + safe + "</p></div></body></html>";
        return ResponseEntity.status(status).headers(headers(origins)).body(body);
    }

    /** Origen (esquema://host[:puerto]) del encabezado Origin o, si falta, del Referer. */
    private static String originOf(String origin, String referer) {
        String src = origin != null && !origin.isBlank() && !"null".equals(origin) ? origin : referer;
        if (src == null || src.isBlank()) return null;
        try {
            URI u = URI.create(src);
            if (u.getScheme() == null || u.getHost() == null) return null;
            return u.getScheme() + "://" + u.getHost() + (u.getPort() > 0 ? ":" + u.getPort() : "");
        } catch (Exception e) {
            return null;
        }
    }
}
