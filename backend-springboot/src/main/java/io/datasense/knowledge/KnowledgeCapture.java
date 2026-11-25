package io.datasense.knowledge;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;

import io.datasense.auth.AccessService;
import io.datasense.auth.UserRecord;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import org.springframework.core.MethodParameter;
import org.springframework.http.MediaType;
import org.springframework.http.converter.HttpMessageConverter;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.http.server.ServletServerHttpRequest;
import org.springframework.stereotype.Component;
import org.springframework.web.bind.annotation.ControllerAdvice;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.web.servlet.mvc.method.annotation.ResponseBodyAdvice;
import org.springframework.web.util.ContentCachingRequestWrapper;
import org.springframework.web.util.WebUtils;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Alimenta la base de conocimiento con lo que la persona hace en la plataforma, sin tocar los controladores: lee la
 * petición (guardada por {@link BodyCache}) y la respuesta de unas pocas acciones con valor (preguntas, IA, qué cambió,
 * hojas, medidas, cuadernos). Solo actúa si la persona tiene la base activa; nunca cambia la respuesta.
 */
@ControllerAdvice
public class KnowledgeCapture implements ResponseBodyAdvice<Object> {

    private static final String P = "/api/v1";
    private static final Pattern ASK = Pattern.compile(P + "/apps/([^/]+)/ask");
    private static final Pattern AI = Pattern.compile(P + "/ai/(analizar|disenar|modelar)");
    private static final Pattern EXPLAIN = Pattern.compile(P + "/apps/([^/]+)/insights/explain");
    private static final Pattern WHATIF = Pattern.compile(P + "/apps/([^/]+)/insights/whatif");
    private static final Pattern SHEET = Pattern.compile(P + "/apps/([^/]+)/sheets(?:/([^/]+))?");
    private static final Pattern MASTER = Pattern.compile(P + "/apps/([^/]+)/master-items(?:/([^/]+))?");
    private static final Pattern NOTEBOOK = Pattern.compile(P + "/apps/([^/]+)/notebooks(?:/([^/]+))?");

    private final KnowledgeService knowledge;
    private final ObjectMapper mapper = new ObjectMapper();

    public KnowledgeCapture(KnowledgeService knowledge) {
        this.knowledge = knowledge;
    }

    @Override
    public boolean supports(MethodParameter returnType, Class<? extends HttpMessageConverter<?>> converterType) { return true; }

    @Override
    public Object beforeBodyWrite(Object body, MethodParameter returnType, MediaType contentType,
                                  Class<? extends HttpMessageConverter<?>> converterType, ServerHttpRequest request, ServerHttpResponse response) {
        try {
            if (!(request instanceof ServletServerHttpRequest sr) || !(body instanceof Map<?, ?>)) return body;
            HttpServletRequest req = sr.getServletRequest();
            String m = req.getMethod();
            if (!"POST".equals(m) && !"PUT".equals(m)) return body;
            UserRecord u = AccessService.current(req);
            if (u == null || !knowledge.enabled(u.id())) return body;
            @SuppressWarnings("unchecked") Map<String, Object> res = (Map<String, Object>) body;
            route(u, req.getRequestURI(), requestBody(req), res);
        } catch (Exception ignored) { /* capturar nunca rompe la respuesta */ }
        return body;
    }

    private Map<String, Object> requestBody(HttpServletRequest req) {
        ContentCachingRequestWrapper w = WebUtils.getNativeRequest(req, ContentCachingRequestWrapper.class);
        if (w == null) return Map.of();
        byte[] b = w.getContentAsByteArray();
        if (b.length == 0) return Map.of();
        try { return mapper.readValue(new String(b, StandardCharsets.UTF_8), new TypeReference<Map<String, Object>>() {}); }
        catch (Exception e) { return Map.of(); }
    }

    private void route(UserRecord u, String uri, Map<String, Object> rq, Map<String, Object> rs) {
        Matcher x;
        if ((x = ASK.matcher(uri)).matches()) { ask(u, x.group(1), rq, rs); return; }
        if ((x = AI.matcher(uri)).matches()) { ai(u, x.group(1), rq, rs); return; }
        if ((x = EXPLAIN.matcher(uri)).matches()) { explain(u, x.group(1), rs); return; }
        if ((x = WHATIF.matcher(uri)).matches()) { whatif(u, x.group(1), rq, rs); return; }
        if ((x = SHEET.matcher(uri)).matches()) { sheet(u, x.group(1), rs); return; }
        if ((x = MASTER.matcher(uri)).matches()) { master(u, x.group(1), rs); return; }
        if ((x = NOTEBOOK.matcher(uri)).matches() && !"run".equals(x.group(2))) notebook(u, x.group(1), rs);
    }

    /* ----------------------------- fuentes ----------------------------- */

    @SuppressWarnings("unchecked")
    private void ask(UserRecord u, String app, Map<String, Object> rq, Map<String, Object> rs) {
        if (!Boolean.TRUE.equals(rs.get("ok"))) return;
        String q = s(rq.get("question"));
        List<KnowledgeService.Hint> hints = new ArrayList<>();
        StringBuilder t = new StringBuilder(s(rs.get("answer")));
        if (rs.get("how") instanceof Map<?, ?> how) {
            Object me = how.get("measure");
            String ml = me instanceof Map<?, ?> mm ? s(mm.get("label")) : s(me);
            if (!ml.isBlank()) { hints.add(new KnowledgeService.Hint(ml, "measure")); t.append("\nMedida: ").append(ml); }
            Object di = how.get("dimension");
            String dl = di instanceof Map<?, ?> dm ? first(s(dm.get("label")), s(dm.get("display")), s(dm.get("field"))) : s(di);
            if (!dl.isBlank()) { hints.add(new KnowledgeService.Hint(dl, "dimension")); t.append(" · por ").append(dl); }
            if (how.get("filters") instanceof List<?> fl) for (Object f : fl) if (f instanceof Map<?, ?> fm) values(fm.get("values"), hints);
            if (how.get("filters") instanceof Map<?, ?> fm) for (Object v : fm.values()) values(v, hints);
        }
        if (rs.get("result") instanceof Map<?, ?> r && r.get("labels") instanceof List<?> labels) {
            List<?> vals = r.get("values") instanceof List<?> v ? v : List.of();
            StringBuilder top = new StringBuilder();
            for (int i = 0; i < Math.min(8, labels.size()); i++) top.append(i == 0 ? "" : "; ").append(labels.get(i)).append(i < vals.size() ? " = " + vals.get(i) : "");
            if (top.length() > 0) t.append("\nResultado: ").append(top);
            for (int i = 0; i < Math.min(5, labels.size()); i++) hints.add(new KnowledgeService.Hint(s(labels.get(i)), "value"));
        }
        knowledge.capture(u, app, "ask", null, q.isBlank() ? s(rs.get("answer")) : q, t.toString(), hints, Map.of("chart", s(rs.get("chart"))));
    }

    private void ai(UserRecord u, String persona, Map<String, Object> rq, Map<String, Object> rs) {
        if (!Boolean.TRUE.equals(rs.get("ok")) || s(rs.get("message")).isBlank()) return;
        String app = first(s(rq.get("appId")), s(rq.get("app_id")));
        String q = first(s(rq.get("pregunta")), s(rq.get("question")), s(rq.get("prompt")), lastUser(rq.get("messages")), lastUser(rq.get("historial")));
        String label = Map.of("analizar", "Analista", "disenar", "Diseñador", "modelar", "Ingeniero de datos").getOrDefault(persona, persona);
        knowledge.capture(u, app.isBlank() ? null : app, "ai", null, q.isBlank() ? "Consulta al asistente (" + label + ")" : q,
                s(rs.get("message")), List.of(new KnowledgeService.Hint("Asistente · " + label, "concept")), Map.of("persona", persona));
    }

    @SuppressWarnings("unchecked")
    private void explain(UserRecord u, String app, Map<String, Object> rs) {
        String measure = rs.get("measure") instanceof Map<?, ?> mm ? first(s(mm.get("label")), s(mm.get("expression"))) : s(rs.get("measure"));
        List<KnowledgeService.Hint> hints = new ArrayList<>();
        if (!measure.isBlank()) hints.add(new KnowledgeService.Hint(measure, "measure"));
        StringBuilder t = new StringBuilder();
        if (rs.get("story") instanceof List<?> st) for (Object o : st) t.append(o).append(' ');
        else t.append(s(rs.get("story")));
        if (rs.get("drivers") instanceof List<?> dr) for (Object o : dr) if (o instanceof Map<?, ?> d) {
            String dim = first(s(d.get("display")), s(d.get("dimension")));
            if (!dim.isBlank()) hints.add(new KnowledgeService.Hint(dim, "dimension"));
            if (d.get("items") instanceof List<?> it) for (int i = 0; i < Math.min(3, it.size()); i++) if (it.get(i) instanceof Map<?, ?> im) hints.add(new KnowledgeService.Hint(s(im.get("value")), "value"));
        }
        if (t.toString().isBlank()) return;
        String title = "Qué cambió: " + (measure.isBlank() ? "medida" : measure) + (rs.get("current") != null ? " · " + rs.get("previous") + " → " + rs.get("current") : "");
        knowledge.capture(u, app, "insight", null, title, t.toString().trim(), hints, Map.of("delta_pct", s(rs.get("delta_pct"))));
    }

    private void whatif(UserRecord u, String app, Map<String, Object> rq, Map<String, Object> rs) {
        String story = rs.get("story") instanceof List<?> st ? String.join(" ", st.stream().map(String::valueOf).toList()) : first(s(rs.get("story")), s(rs.get("summary")), s(rs.get("message")));
        if (story.isBlank()) return;
        String measure = rs.get("measure") instanceof Map<?, ?> mm ? first(s(mm.get("label")), s(mm.get("expression"))) : first(s(rs.get("measure")), s(rq.get("label")));
        knowledge.capture(u, app, "insight", null, "¿Qué pasaría si…? " + measure, story,
                measure.isBlank() ? List.of() : List.of(new KnowledgeService.Hint(measure, "measure")), Map.of("type", "whatif"));
    }

    @SuppressWarnings("unchecked")
    private void sheet(UserRecord u, String app, Map<String, Object> rs) {
        String id = s(rs.get("id")), title = s(rs.get("title"));
        if (id.isBlank() || title.isBlank()) return;
        List<String> objs = new ArrayList<>();
        collectTitles(rs.get("doc"), objs, 0);
        collectTitles(rs.get("objects"), objs, 0);
        String text = first(s(rs.get("description")), "") + (objs.isEmpty() ? "" : "\nObjetos: " + String.join(" · ", objs.stream().distinct().limit(30).toList()));
        knowledge.capture(u, app, "sheet", "sheet:" + id, "Hoja · " + title, text, List.of(), Map.of("sheet_id", id));
    }

    private void master(UserRecord u, String app, Map<String, Object> rs) {
        String id = s(rs.get("id")), name = s(rs.get("name"));
        if (id.isBlank() || name.isBlank()) return;
        boolean measure = "measure".equals(s(rs.get("kind")));
        String text = (measure ? "Medida" : "Dimensión") + (Boolean.TRUE.equals(rs.get("certified")) ? " certificada" : "") + ": " + s(rs.get("expression"))
                + (s(rs.get("description")).isBlank() ? "" : "\n" + s(rs.get("description")));
        knowledge.capture(u, app, "master", "master:" + id, name, text, List.of(new KnowledgeService.Hint(name, measure ? "measure" : "dimension")), Map.of("item_id", id));
    }

    private void notebook(UserRecord u, String app, Map<String, Object> rs) {
        String id = s(rs.get("id")), name = first(s(rs.get("name")), s(rs.get("title")));
        if (id.isBlank() || name.isBlank()) return;
        StringBuilder t = new StringBuilder(s(rs.get("description")));
        if (rs.get("cells") instanceof List<?> cells) for (Object c : cells) if (c instanceof Map<?, ?> cm) {
            String ct = first(s(cm.get("title")), s(cm.get("text")), s(cm.get("sql")));
            if (!ct.isBlank()) t.append("\n· ").append(KnowledgeService.clip(ct, 240));
        }
        knowledge.capture(u, app, "notebook", "nb:" + id, "Cuaderno · " + name, t.toString(), List.of(), Map.of("notebook_id", id));
    }

    /* ----------------------------- utilidades ----------------------------- */

    private static void values(Object v, List<KnowledgeService.Hint> hints) {
        if (v instanceof List<?> l) for (Object o : l) { if (hints.size() < 14) hints.add(new KnowledgeService.Hint(s(o), "value")); }
        else if (v != null && !s(v).isBlank()) hints.add(new KnowledgeService.Hint(s(v), "value"));
    }

    private static void collectTitles(Object o, List<String> out, int depth) {
        if (o == null || depth > 5 || out.size() > 40) return;
        if (o instanceof Map<?, ?> m) {
            Object t = m.get("title");
            if (t != null && !s(t).isBlank() && (m.containsKey("type") || m.containsKey("props"))) out.add(s(t));
            for (Object v : m.values()) collectTitles(v, out, depth + 1);
        } else if (o instanceof List<?> l) for (Object v : l) collectTitles(v, out, depth + 1);
    }

    private static String lastUser(Object o) {
        if (!(o instanceof List<?> l)) return "";
        for (int i = l.size() - 1; i >= 0; i--) if (l.get(i) instanceof Map<?, ?> m && "user".equals(s(m.get("role")))) return s(m.get("content"));
        return "";
    }

    private static String first(String... v) { for (String x : v) if (x != null && !x.isBlank()) return x; return ""; }

    static String s(Object o) { return o == null ? "" : String.valueOf(o); }

    /** Guarda el cuerpo de las peticiones JSON para que la captura pueda leer la pregunta original. */
    @Component
    public static class BodyCache extends OncePerRequestFilter {
        @Override
        protected boolean shouldNotFilter(HttpServletRequest req) {
            String ct = req.getContentType();
            return !req.getRequestURI().startsWith(P + "/") || !("POST".equals(req.getMethod()) || "PUT".equals(req.getMethod()))
                    || ct == null || !ct.toLowerCase(Locale.ROOT).contains("json");
        }

        @Override
        protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain) throws ServletException, IOException {
            chain.doFilter(new ContentCachingRequestWrapper(req, 256 * 1024), res);
        }
    }
}
