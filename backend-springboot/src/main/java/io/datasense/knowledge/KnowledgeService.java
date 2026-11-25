package io.datasense.knowledge;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;

import io.datasense.auth.AccessService;
import io.datasense.auth.UserRecord;
import io.datasense.config.DatabaseConfig.SchemaInitializer;
import io.datasense.repo.AppRepository;
import io.datasense.repo.Ids;
import io.datasense.repo.MasterItemRepository;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Lazy;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.text.Normalizer;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/**
 * Base de conocimiento personal. <b>Está apagada por defecto</b>: solo guarda algo cuando la persona la activa.
 *
 * <p>Cada cosa que alguien hace en la plataforma (una pregunta, una respuesta de la IA, un «qué cambió», un informe,
 * una conversación con un agente, una medida o una hoja) se guarda como un <b>documento</b>. De cada documento se
 * extraen <b>entidades</b> (la app, sus medidas y dimensiones, valores como «Andina» o «Yopal», conceptos) y se
 * enlazan las que aparecen juntas: eso forma el grafo. La búsqueda es por relevancia (BM25 con normalización del
 * español y refuerzo por entidad), local y sin servicios externos.</p>
 *
 * <p>Privacidad: cada documento es de una persona; al leerlo se vuelve a comprobar que siga pudiendo ver la app.</p>
 */
@Service
public class KnowledgeService {

    private static final Logger log = LoggerFactory.getLogger(KnowledgeService.class);

    /** Fuentes que alimentan la base (se pueden apagar una a una). */
    public static final List<Map<String, String>> SOURCES = List.of(
            src("ask", "Pregúntale a tus datos", "Cada pregunta y su respuesta con la cifra."),
            src("ai", "Asistente de IA", "Lo que preguntas al asistente y lo que responde."),
            src("insight", "Qué cambió y simulaciones", "Variaciones explicadas y escenarios «¿qué pasaría si…?»."),
            src("report", "Informes y presentaciones", "Historias de datos, su titular y sus hallazgos."),
            src("agent", "Agentes", "Conversaciones con tus agentes y las herramientas que usaron."),
            src("sheet", "Hojas", "Hojas que creas o cambias: título y objetos."),
            src("master", "Capa de negocio", "Medidas y dimensiones oficiales con su definición."),
            src("notebook", "Cuadernos", "Cuadernos de análisis que guardas."),
            src("note", "Notas", "Notas que escribes a mano en la base."));

    private static Map<String, String> src(String id, String label, String description) {
        Map<String, String> m = new LinkedHashMap<>();
        m.put("id", id); m.put("label", label); m.put("description", description);
        return m;
    }

    public static final Set<String> KINDS = SOURCES.stream().map(s -> s.get("id")).collect(Collectors.toCollection(LinkedHashSet::new));

    private final JdbcTemplate jdbc;
    private final AppRepository apps;
    private final MasterItemRepository masters;
    private final AccessService access;
    private final io.datasense.web.QueryController query;
    private final ObjectMapper mapper = new ObjectMapper();
    private final ExecutorService pool = Executors.newSingleThreadExecutor(r -> { Thread t = new Thread(r, "knowledge"); t.setDaemon(true); return t; });
    private final Map<String, Map<String, Object>> settingsCache = new ConcurrentHashMap<>();
    private final Map<String, Vocab> vocabCache = new ConcurrentHashMap<>();

    public KnowledgeService(SchemaInitializer schema, JdbcTemplate jdbc, AppRepository apps, MasterItemRepository masters,
                            AccessService access, @Lazy io.datasense.web.QueryController query) {
        this.jdbc = jdbc;
        this.apps = apps;
        this.masters = masters;
        this.access = access;
        this.query = query;
        jdbc.execute("CREATE TABLE IF NOT EXISTS knowledge_settings (user_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0, "
                + "sources TEXT, retention_days INTEGER NOT NULL DEFAULT 0, enabled_at TEXT, updated_at TEXT)");
        jdbc.execute("CREATE TABLE IF NOT EXISTS knowledge_docs (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, app_id TEXT, app_name TEXT, kind TEXT NOT NULL, "
                + "ref TEXT, title TEXT NOT NULL, text TEXT, meta_json TEXT, entities TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)");
        jdbc.execute("CREATE INDEX IF NOT EXISTS ix_kdocs_user ON knowledge_docs(user_id, created_at)");
        jdbc.execute("CREATE UNIQUE INDEX IF NOT EXISTS ux_kdocs_ref ON knowledge_docs(user_id, ref)");
        jdbc.execute("CREATE TABLE IF NOT EXISTS knowledge_entities (user_id TEXT NOT NULL, key TEXT NOT NULL, label TEXT NOT NULL, type TEXT NOT NULL, "
                + "app_id TEXT, docs INTEGER NOT NULL DEFAULT 0, first_at TEXT, last_at TEXT, PRIMARY KEY (user_id, key))");
        jdbc.execute("CREATE TABLE IF NOT EXISTS knowledge_edges (user_id TEXT NOT NULL, a TEXT NOT NULL, b TEXT NOT NULL, weight INTEGER NOT NULL DEFAULT 0, "
                + "PRIMARY KEY (user_id, a, b))");
    }

    /* =============================== Ajustes =============================== */

    public Map<String, Object> settings(String userId) {
        return settingsCache.computeIfAbsent(userId, id -> {
            List<Map<String, Object>> rows = jdbc.queryForList("SELECT * FROM knowledge_settings WHERE user_id = ?", id);
            Map<String, Object> m = new LinkedHashMap<>();
            Map<String, Boolean> srcs = new LinkedHashMap<>();
            Set<String> off = new HashSet<>();
            if (!rows.isEmpty() && rows.get(0).get("sources") != null) {
                String s = String.valueOf(rows.get(0).get("sources"));
                if (s.startsWith("-")) off.addAll(Arrays.asList(s.substring(1).split(",")));
            }
            for (String k : KINDS) srcs.put(k, !off.contains(k));
            m.put("enabled", !rows.isEmpty() && toInt(rows.get(0).get("enabled")) == 1);
            m.put("sources", srcs);
            m.put("retention_days", rows.isEmpty() ? 0 : toInt(rows.get(0).get("retention_days")));
            m.put("enabled_at", rows.isEmpty() ? null : rows.get(0).get("enabled_at"));
            return m;
        });
    }

    public boolean enabled(String userId) { return userId != null && Boolean.TRUE.equals(settings(userId).get("enabled")); }

    @SuppressWarnings("unchecked")
    public boolean sourceOn(String userId, String kind) {
        if (!enabled(userId)) return false;
        Object s = settings(userId).get("sources");
        return !(s instanceof Map<?, ?> m) || !Boolean.FALSE.equals(((Map<String, Object>) m).get(kind));
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> updateSettings(String userId, Map<String, Object> body) {
        Map<String, Object> cur = new LinkedHashMap<>(settings(userId));
        boolean wasOn = Boolean.TRUE.equals(cur.get("enabled"));
        boolean on = body.containsKey("enabled") ? Boolean.TRUE.equals(body.get("enabled")) : wasOn;
        Map<String, Boolean> srcs = new LinkedHashMap<>((Map<String, Boolean>) cur.get("sources"));
        if (body.get("sources") instanceof Map<?, ?> in) {
            for (Map.Entry<?, ?> e : in.entrySet()) if (KINDS.contains(String.valueOf(e.getKey()))) srcs.put(String.valueOf(e.getKey()), !Boolean.FALSE.equals(e.getValue()));
        }
        int ret = body.get("retention_days") == null ? toInt(cur.get("retention_days")) : Math.max(0, Math.min(3650, (int) Double.parseDouble(String.valueOf(body.get("retention_days")))));
        String off = "-" + srcs.entrySet().stream().filter(e -> !e.getValue()).map(Map.Entry::getKey).collect(Collectors.joining(","));
        String now = Ids.now();
        jdbc.update("INSERT INTO knowledge_settings (user_id, enabled, sources, retention_days, enabled_at, updated_at) VALUES (?,?,?,?,?,?) "
                + "ON CONFLICT(user_id) DO UPDATE SET enabled = excluded.enabled, sources = excluded.sources, retention_days = excluded.retention_days, "
                + "enabled_at = CASE WHEN excluded.enabled = 1 AND knowledge_settings.enabled = 0 THEN excluded.enabled_at ELSE knowledge_settings.enabled_at END, updated_at = excluded.updated_at",
                userId, on ? 1 : 0, off, ret, now, now);
        settingsCache.remove(userId);
        if (ret > 0) purgeOld(userId, ret);
        return withStats(userId);
    }

    public Map<String, Object> withStats(String userId) {
        Map<String, Object> m = new LinkedHashMap<>(settings(userId));
        m.put("source_catalog", SOURCES);
        m.put("stats", stats(userId));
        return m;
    }

    public Map<String, Object> stats(String userId) {
        Map<String, Object> s = new LinkedHashMap<>();
        s.put("docs", count("SELECT COUNT(*) FROM knowledge_docs WHERE user_id = ?", userId));
        s.put("entities", count("SELECT COUNT(*) FROM knowledge_entities WHERE user_id = ? AND docs > 0", userId));
        s.put("edges", count("SELECT COUNT(*) FROM knowledge_edges WHERE user_id = ? AND weight > 0", userId));
        Map<String, Object> byKind = new LinkedHashMap<>();
        for (String k : KINDS) byKind.put(k, 0L);
        jdbc.queryForList("SELECT kind, COUNT(*) n FROM knowledge_docs WHERE user_id = ? GROUP BY kind", userId)
                .forEach(r -> byKind.put(String.valueOf(r.get("kind")), ((Number) r.get("n")).longValue()));
        s.put("by_kind", byKind);
        s.put("last_at", jdbc.queryForList("SELECT MAX(updated_at) m FROM knowledge_docs WHERE user_id = ?", userId).get(0).get("m"));
        return s;
    }

    private long count(String sql, Object... args) {
        Number n = jdbc.queryForObject(sql, Number.class, args);
        return n == null ? 0 : n.longValue();
    }

    /* =============================== Captura =============================== */

    /** Entidad sugerida por quien captura (p. ej. la medida o la dimensión de una pregunta). */
    public record Hint(String label, String type) {}

    /**
     * Guarda un documento si la persona tiene la base activa y esa fuente encendida. Corre en segundo plano y nunca
     * lanza: capturar conocimiento jamás debe romper ni frenar lo que la persona estaba haciendo.
     * Con {@code ref} se actualiza el mismo documento (p. ej. una hoja que se guarda muchas veces).
     */
    public void capture(UserRecord u, String appId, String kind, String ref, String title, String text, List<Hint> hints, Map<String, Object> meta) {
        if (u == null || !KINDS.contains(kind) || !sourceOn(u.id(), kind)) return;
        if (title == null || title.isBlank()) return;
        final String t = clip(title.trim(), 300), body = clip(text == null ? "" : text.trim(), 8000);
        pool.submit(() -> {
            try { store(u.id(), appId, kind, ref, t, body, hints == null ? List.of() : hints, meta); }
            catch (Exception e) { log.debug("No se pudo guardar conocimiento: {}", e.getMessage()); }
        });
    }

    /** Igual que {@link #capture} pero síncrono; devuelve el documento (para notas manuales y pruebas). */
    public Map<String, Object> captureNow(UserRecord u, String appId, String kind, String ref, String title, String text, List<Hint> hints, Map<String, Object> meta) {
        if (u == null || !KINDS.contains(kind)) throw new IllegalArgumentException("Fuente desconocida: " + kind);
        if (!enabled(u.id())) throw new IllegalStateException("La base de conocimiento está apagada. Actívala primero.");
        if (title == null || title.isBlank()) throw new IllegalArgumentException("Falta el título.");
        String id = store(u.id(), appId, kind, ref, clip(title.trim(), 300), clip(text == null ? "" : text.trim(), 8000), hints == null ? List.of() : hints, meta);
        return doc(u, id).orElseThrow();
    }

    private synchronized String store(String userId, String appId, String kind, String ref, String title, String text, List<Hint> hints, Map<String, Object> meta) {
        String appName = null;
        if (appId != null) appName = apps.getApp(appId).map(a -> a.name()).orElse(null);
        if (appId != null && appName == null) appId = null;
        Map<String, Ent> ents = extract(appId, appName, kind, title + "\n" + text, hints);
        String keys = String.join("|", ents.keySet());
        String now = Ids.now();
        String id = null;
        if (ref != null && !ref.isBlank()) {
            List<Map<String, Object>> prev = jdbc.queryForList("SELECT id, entities FROM knowledge_docs WHERE user_id = ? AND ref = ?", userId, ref);
            if (!prev.isEmpty()) {
                id = String.valueOf(prev.get(0).get("id"));
                unlink(userId, split(String.valueOf(prev.get(0).get("entities"))));
                jdbc.update("UPDATE knowledge_docs SET app_id = ?, app_name = ?, title = ?, text = ?, meta_json = ?, entities = ?, updated_at = ? WHERE id = ?",
                        appId, appName, title, text, json(meta), keys, now, id);
            }
        }
        if (id == null) {
            id = Ids.newId();
            jdbc.update("INSERT INTO knowledge_docs (id, user_id, app_id, app_name, kind, ref, title, text, meta_json, entities, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                    id, userId, appId, appName, kind, ref == null || ref.isBlank() ? null : ref, title, text, json(meta), keys, now, now);
        }
        link(userId, appId, ents, now);
        return id;
    }

    private void link(String userId, String appId, Map<String, Ent> ents, String now) {
        for (Ent e : ents.values()) {
            jdbc.update("INSERT INTO knowledge_entities (user_id, key, label, type, app_id, docs, first_at, last_at) VALUES (?,?,?,?,?,1,?,?) "
                    + "ON CONFLICT(user_id, key) DO UPDATE SET docs = knowledge_entities.docs + 1, last_at = excluded.last_at, label = excluded.label",
                    userId, e.key, e.label, e.type, "app".equals(e.type) ? appId : (e.key.contains("@") ? appId : null), now, now);
        }
        List<String> k = new ArrayList<>(ents.keySet());
        for (int i = 0; i < k.size(); i++) for (int j = i + 1; j < k.size(); j++) {
            String a = k.get(i).compareTo(k.get(j)) < 0 ? k.get(i) : k.get(j), b = a.equals(k.get(i)) ? k.get(j) : k.get(i);
            jdbc.update("INSERT INTO knowledge_edges (user_id, a, b, weight) VALUES (?,?,?,1) ON CONFLICT(user_id, a, b) DO UPDATE SET weight = knowledge_edges.weight + 1",
                    userId, a, b);
        }
    }

    private void unlink(String userId, List<String> keys) {
        for (String key : keys) jdbc.update("UPDATE knowledge_entities SET docs = MAX(0, docs - 1) WHERE user_id = ? AND key = ?", userId, key);
        for (int i = 0; i < keys.size(); i++) for (int j = i + 1; j < keys.size(); j++) {
            String a = keys.get(i).compareTo(keys.get(j)) < 0 ? keys.get(i) : keys.get(j), b = a.equals(keys.get(i)) ? keys.get(j) : keys.get(i);
            jdbc.update("UPDATE knowledge_edges SET weight = MAX(0, weight - 1) WHERE user_id = ? AND a = ? AND b = ?", userId, a, b);
        }
    }

    /* =============================== Entidades =============================== */

    private record Ent(String key, String label, String type) {}

    /** Vocabulario de una app: medidas y dimensiones maestras y campos, con su nombre normalizado. */
    private record Vocab(Map<String, String[]> terms, long at) {}

    @SuppressWarnings("unchecked")
    private Vocab vocab(String appId) {
        Vocab v = vocabCache.get(appId);
        if (v != null && System.currentTimeMillis() - v.at() < 120_000) return v;
        Map<String, String[]> t = new LinkedHashMap<>();
        try {
            for (Map<String, Object> m : masters.list(appId, null)) {
                String name = String.valueOf(m.get("name"));
                t.put(norm(name), new String[]{name, "measure".equals(String.valueOf(m.get("kind"))) ? "measure" : "dimension"});
            }
        } catch (RuntimeException ignored) {}
        try {
            Map<String, Object> f = query.fields(appId);
            for (String kind : List.of("dimensions", "measures")) {
                if (!(f.get(kind) instanceof List<?> l)) continue;
                for (Object o : l) {
                    Map<String, Object> d = (Map<String, Object>) o;
                    String label = d.get("display") != null ? String.valueOf(d.get("display")) : String.valueOf(d.get("field"));
                    String key = norm(label);
                    if (key.length() >= 3) t.putIfAbsent(key, new String[]{label, "field"});
                    String raw = norm(String.valueOf(d.get("field")).replace('_', ' '));
                    if (raw.length() >= 3) t.putIfAbsent(raw, new String[]{label, "field"});
                }
            }
        } catch (RuntimeException ignored) {}
        v = new Vocab(t, System.currentTimeMillis());
        vocabCache.put(appId, v);
        return v;
    }

    private static final Pattern PROPER = Pattern.compile("\\b(\\p{Lu}[\\p{L}\\d]+(?:[ \\t]+(?:de|del|la|las|los|y)?[ \\t]*\\p{Lu}[\\p{L}\\d]+)*)");
    private static final Set<String> STOP_PROPER = Set.of("el", "la", "los", "las", "un", "una", "en", "de", "del", "por", "para", "con", "sin", "que", "qué", "cómo",
            "como", "cuál", "cual", "cuánto", "cuanto", "cuántos", "dónde", "si", "no", "sí", "y", "o", "es", "son", "fue", "hay", "total", "promedio", "datos", "tus",
            "eres", "este", "esta", "estos", "estas", "lo", "al", "se", "su", "sus", "ver", "más", "mas", "menos", "mejor", "peor", "periodo", "anterior", "último",
            "ultimo", "fuente", "resultado", "registros", "app", "aplicación", "hoja", "informe", "respuesta", "pregunta", "nota", "hola", "gracias", "también",
            "medida", "dimension", "objetos", "herramientas", "historia", "cuaderno", "actual", "detalle", "puntaje", "problemas", "consulta", "asistente",
            "cop", "usd", "eur", "sql", "kpi", "kpis");

    private Map<String, Ent> extract(String appId, String appName, String kind, String text, List<Hint> hints) {
        Map<String, Ent> out = new LinkedHashMap<>();
        if (appId != null && appName != null) out.put("app:" + appId, new Ent("app:" + appId, appName, "app"));
        for (Hint h : hints) {
            if (h == null || h.label() == null || h.label().isBlank()) continue;
            String type = h.type() == null ? "concept" : h.type();
            String key = keyFor(type, h.label(), appId);
            out.putIfAbsent(key, new Ent(key, clip(h.label().trim(), 80), type));
        }
        String nt = " " + norm(text) + " ";
        if (appId != null) {
            for (Map.Entry<String, String[]> e : vocab(appId).terms().entrySet()) {
                if (out.size() >= 14) break;
                if (e.getKey().length() >= 3 && nt.contains(" " + e.getKey() + " ")) {
                    String type = e.getValue()[1];
                    // Un campo que es parte del nombre de una medida ya encontrada («ventas» en «Ventas netas») no suma.
                    if ("field".equals(type) && out.values().stream().anyMatch(x -> !x.label().equals(e.getValue()[0]) && (" " + norm(x.label()) + " ").contains(" " + e.getKey() + " "))) continue;
                    String key = keyFor(type, e.getValue()[0], appId);
                    out.putIfAbsent(key, new Ent(key, e.getValue()[0], type));
                }
            }
        }
        // Nombres propios (regiones, ciudades, productos, canales): valores de negocio.
        Matcher m = PROPER.matcher(text);
        int added = 0;
        while (m.find() && added < 8 && out.size() < 16) {
            String w = m.group(1).trim();
            String nw = norm(w);
            if (nw.length() < 3 || STOP_PROPER.contains(nw) || nw.matches("\\d.*")) continue;
            if (appName != null && nw.equals(norm(appName))) continue;
            // Si ya es una medida, dimensión o campo conocido (o una palabra suya) no se repite como valor.
            boolean known = out.values().stream().anyMatch(x -> norm(x.label()).equals(nw) || (!"value".equals(x.type()) && (" " + norm(x.label()) + " ").contains(" " + nw + " ")))
                    || (appId != null && vocab(appId).terms().containsKey(nw));
            if (known) continue;
            String key = keyFor("value", w, appId);
            if (out.putIfAbsent(key, new Ent(key, w, "value")) == null) added++;
        }
        return out;
    }

    private static String keyFor(String type, String label, String appId) {
        String n = norm(label);
        return switch (type) {
            case "measure", "dimension", "field" -> "m:" + n + (appId == null ? "" : "@" + appId);
            case "value" -> "v:" + n;
            case "agent" -> "agent:" + n;
            case "report" -> "r:" + n;
            default -> "c:" + n;
        };
    }

    /* =============================== Lectura =============================== */

    private boolean visible(UserRecord u, Map<String, Object> row) {
        Object app = row.get("app_id");
        if (app == null) return true;
        return apps.getApp(String.valueOf(app)).map(a -> access.canSee(u, a)).orElse(false);
    }

    public Optional<Map<String, Object>> doc(UserRecord u, String id) {
        return jdbc.queryForList("SELECT * FROM knowledge_docs WHERE id = ? AND user_id = ?", id, u.id()).stream()
                .filter(r -> visible(u, r)).findFirst().map(r -> out(u.id(), r, null, null));
    }

    public List<Map<String, Object>> list(UserRecord u, String kind, String appId, int limit, int offset) {
        StringBuilder sql = new StringBuilder("SELECT * FROM knowledge_docs WHERE user_id = ?");
        List<Object> args = new ArrayList<>(List.of(u.id()));
        if (kind != null && !kind.isBlank()) { sql.append(" AND kind = ?"); args.add(kind); }
        if (appId != null && !appId.isBlank()) { sql.append(" AND app_id = ?"); args.add(appId); }
        sql.append(" ORDER BY updated_at DESC LIMIT ? OFFSET ?");
        args.add(Math.max(1, Math.min(200, limit)));
        args.add(Math.max(0, offset));
        return jdbc.queryForList(sql.toString(), args.toArray()).stream().filter(r -> visible(u, r)).map(r -> out(u.id(), r, null, null)).toList();
    }

    private Map<String, Object> out(String userId, Map<String, Object> r, Double score, String snippet) {
        Map<String, Object> m = new LinkedHashMap<>();
        for (String k : List.of("id", "kind", "app_id", "app_name", "title", "text", "created_at", "updated_at")) m.put(k, r.get(k));
        m.put("meta", parse(r.get("meta_json")));
        List<String> keys = split(String.valueOf(r.get("entities")));
        m.put("entities", entitiesByKeys(userId, keys));
        if (score != null) m.put("score", Math.round(score * 100) / 100.0);
        if (snippet != null) m.put("snippet", snippet);
        return m;
    }

    private List<Map<String, Object>> entitiesByKeys(String userId, List<String> keys) {
        if (keys.isEmpty()) return List.of();
        String in = keys.stream().map(k -> "?").collect(Collectors.joining(","));
        List<Object> args = new ArrayList<>(List.of(userId));
        args.addAll(keys);
        return jdbc.queryForList("SELECT key, label, type, docs FROM knowledge_entities WHERE user_id = ? AND key IN (" + in + ")", args.toArray());
    }

    /* =============================== Búsqueda =============================== */

    /**
     * Búsqueda por relevancia (BM25) sobre título y texto, con normalización del español (sin tildes, plural y
     * sufijos comunes) y un refuerzo para los documentos que mencionan una entidad que coincide con la búsqueda.
     */
    public Map<String, Object> search(UserRecord u, String q, String appId, String kind, int limit) {
        Map<String, Object> res = new LinkedHashMap<>();
        List<String> qt = tokens(q);
        res.put("query", q);
        if (qt.isEmpty()) { res.put("results", List.of()); res.put("entities", List.of()); res.put("total", 0); return res; }
        StringBuilder sql = new StringBuilder("SELECT * FROM knowledge_docs WHERE user_id = ?");
        List<Object> args = new ArrayList<>(List.of(u.id()));
        if (appId != null && !appId.isBlank()) { sql.append(" AND app_id = ?"); args.add(appId); }
        if (kind != null && !kind.isBlank()) { sql.append(" AND kind = ?"); args.add(kind); }
        List<Map<String, Object>> docs = jdbc.queryForList(sql.toString(), args.toArray()).stream().filter(r -> visible(u, r)).toList();
        // Entidades que coinciden con la búsqueda (por etiqueta).
        String nq = norm(q);
        List<Map<String, Object>> ents = jdbc.queryForList("SELECT key, label, type, docs FROM knowledge_entities WHERE user_id = ? AND docs > 0", u.id()).stream()
                .filter(e -> { String l = norm(String.valueOf(e.get("label"))); return l.length() >= 3 && (nq.contains(l) || l.contains(nq) || qt.stream().anyMatch(t -> stem(l).contains(t))); })
                .sorted((a, b) -> Long.compare(((Number) b.get("docs")).longValue(), ((Number) a.get("docs")).longValue())).limit(12).toList();
        Set<String> entKeys = ents.stream().map(e -> String.valueOf(e.get("key"))).collect(Collectors.toSet());

        int n = docs.size();
        List<List<String>> toks = new ArrayList<>(n);
        Map<String, Integer> df = new HashMap<>();
        double avg = 0;
        for (Map<String, Object> d : docs) {
            List<String> t = tokens(d.get("title") + " " + d.get("title") + " " + Objects.toString(d.get("text"), ""));
            toks.add(t);
            avg += t.size();
            for (String w : new HashSet<>(t)) df.merge(w, 1, Integer::sum);
        }
        avg = n == 0 ? 1 : avg / n;
        final double k1 = 1.4, b = 0.72;
        List<Object[]> scored = new ArrayList<>();
        for (int i = 0; i < n; i++) {
            Map<String, Integer> tf = new HashMap<>();
            for (String w : toks.get(i)) tf.merge(w, 1, Integer::sum);
            double s = 0;
            for (String w : new LinkedHashSet<>(qt)) {
                Integer f = tf.get(w);
                if (f == null) continue;
                int dfi = df.getOrDefault(w, 0);
                double idf = Math.log(1 + (n - dfi + 0.5) / (dfi + 0.5));
                s += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * toks.get(i).size() / avg));
            }
            List<String> dk = split(String.valueOf(docs.get(i).get("entities")));
            long hits = dk.stream().filter(entKeys::contains).count();
            s += hits * 1.6;
            // Lo reciente pesa un poco más (máx. +15 %).
            s *= 1 + 0.15 * recency(String.valueOf(docs.get(i).get("updated_at")));
            if (s > 0) scored.add(new Object[]{s, i});
        }
        scored.sort((x, y) -> Double.compare((double) y[0], (double) x[0]));
        List<Map<String, Object>> results = new ArrayList<>();
        for (Object[] o : scored.subList(0, Math.min(Math.max(1, limit), scored.size()))) {
            Map<String, Object> d = docs.get((int) o[1]);
            results.add(out(u.id(), d, (double) o[0], snippet(Objects.toString(d.get("text"), ""), qt)));
        }
        res.put("results", results);
        res.put("entities", ents);
        res.put("total", scored.size());
        res.put("searched", n);
        return res;
    }

    /** Contexto para un agente: los documentos más relevantes, compactos, con su id para citarlos. */
    public List<Map<String, Object>> retrieve(UserRecord u, String q, String appId, int k) {
        if (u == null || !enabled(u.id())) return List.of();
        @SuppressWarnings("unchecked") List<Map<String, Object>> r = (List<Map<String, Object>>) search(u, q, appId, null, k).get("results");
        return r;
    }

    private static double recency(String iso) {
        try {
            long days = java.time.Duration.between(OffsetDateTime.parse(iso), OffsetDateTime.now()).toDays();
            return Math.max(0, 1 - days / 90.0);
        } catch (Exception e) { return 0; }
    }

    private static String snippet(String text, List<String> qt) {
        if (text == null || text.isBlank()) return "";
        String[] words = text.split("\\s+");
        int best = 0, bestHits = -1;
        for (int i = 0; i < words.length; i++) {
            int hits = 0;
            for (int j = i; j < Math.min(words.length, i + 24); j++) if (qt.contains(stem(norm(words[j])))) hits++;
            if (hits > bestHits) { bestHits = hits; best = i; }
        }
        int from = Math.max(0, best - 4), to = Math.min(words.length, from + 34);
        return (from > 0 ? "… " : "") + String.join(" ", Arrays.copyOfRange(words, from, to)) + (to < words.length ? " …" : "");
    }

    /* =============================== Grafo =============================== */

    public Map<String, Object> graph(UserRecord u, String appId, String kind, int limit, boolean withDocs) {
        limit = Math.max(10, Math.min(600, limit));
        // Documentos visibles (para filtrar por app/fuente y saber qué entidades cuentan).
        StringBuilder sql = new StringBuilder("SELECT id, kind, title, app_id, entities, updated_at FROM knowledge_docs WHERE user_id = ?");
        List<Object> args = new ArrayList<>(List.of(u.id()));
        if (appId != null && !appId.isBlank()) { sql.append(" AND app_id = ?"); args.add(appId); }
        if (kind != null && !kind.isBlank()) { sql.append(" AND kind = ?"); args.add(kind); }
        sql.append(" ORDER BY updated_at DESC LIMIT 3000");
        List<Map<String, Object>> docs = jdbc.queryForList(sql.toString(), args.toArray()).stream().filter(r -> visible(u, r)).toList();
        Map<String, Integer> weight = new HashMap<>();
        Map<String, Integer> pair = new HashMap<>();
        for (Map<String, Object> d : docs) {
            List<String> k = split(String.valueOf(d.get("entities")));
            for (String x : k) weight.merge(x, 1, Integer::sum);
            for (int i = 0; i < k.size(); i++) for (int j = i + 1; j < k.size(); j++) {
                String a = k.get(i).compareTo(k.get(j)) < 0 ? k.get(i) : k.get(j), b = a.equals(k.get(i)) ? k.get(j) : k.get(i);
                pair.merge(a + "\u0001" + b, 1, Integer::sum);
            }
        }
        List<String> keep = weight.entrySet().stream().sorted((a, b) -> b.getValue() - a.getValue()).limit(limit).map(Map.Entry::getKey).toList();
        Set<String> keepSet = new HashSet<>(keep);
        Map<String, Map<String, Object>> meta = new HashMap<>();
        for (Map<String, Object> e : entitiesByKeys(u.id(), keep)) meta.put(String.valueOf(e.get("key")), e);
        List<Map<String, Object>> nodes = new ArrayList<>();
        for (String k : keep) {
            Map<String, Object> e = meta.get(k);
            if (e == null) continue;
            Map<String, Object> n = new LinkedHashMap<>();
            n.put("id", k);
            n.put("label", e.get("label"));
            n.put("type", e.get("type"));
            n.put("weight", weight.get(k));
            nodes.add(n);
        }
        List<Map<String, Object>> edges = new ArrayList<>();
        for (Map.Entry<String, Integer> p : pair.entrySet()) {
            String[] ab = p.getKey().split("\u0001");
            if (!keepSet.contains(ab[0]) || !keepSet.contains(ab[1])) continue;
            Map<String, Object> e = new LinkedHashMap<>();
            e.put("source", ab[0]);
            e.put("target", ab[1]);
            e.put("weight", p.getValue());
            edges.add(e);
        }
        if (withDocs) {
            for (Map<String, Object> d : docs.subList(0, Math.min(120, docs.size()))) {
                String id = "doc:" + d.get("id");
                Map<String, Object> n = new LinkedHashMap<>();
                n.put("id", id); n.put("label", clip(String.valueOf(d.get("title")), 60)); n.put("type", "doc:" + d.get("kind")); n.put("weight", 1); n.put("doc_id", d.get("id"));
                nodes.add(n);
                for (String k : split(String.valueOf(d.get("entities")))) if (keepSet.contains(k)) edges.add(Map.of("source", id, "target", k, "weight", 1));
            }
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("nodes", nodes);
        out.put("edges", edges);
        out.put("docs", docs.size());
        return out;
    }

    /** Detalle de una entidad: sus documentos (recientes) y las entidades más cercanas. */
    public Map<String, Object> entity(UserRecord u, String key) {
        List<Map<String, Object>> e = entitiesByKeys(u.id(), List.of(key));
        if (e.isEmpty()) throw new NoSuchElementException("Entidad no encontrada.");
        List<Map<String, Object>> docs = jdbc.queryForList("SELECT * FROM knowledge_docs WHERE user_id = ? AND ('|' || entities || '|') LIKE ? ORDER BY updated_at DESC LIMIT 40",
                u.id(), "%|" + key + "|%").stream().filter(r -> visible(u, r)).map(r -> out(u.id(), r, null, null)).toList();
        List<Map<String, Object>> near = jdbc.queryForList("SELECT CASE WHEN a = ? THEN b ELSE a END k, weight FROM knowledge_edges WHERE user_id = ? AND (a = ? OR b = ?) AND weight > 0 ORDER BY weight DESC LIMIT 16",
                key, u.id(), key, key);
        Map<String, Integer> w = new LinkedHashMap<>();
        near.forEach(r -> w.put(String.valueOf(r.get("k")), ((Number) r.get("weight")).intValue()));
        List<Map<String, Object>> neighbors = entitiesByKeys(u.id(), new ArrayList<>(w.keySet())).stream().map(x -> {
            Map<String, Object> m = new LinkedHashMap<>(x);
            m.put("weight", w.get(String.valueOf(x.get("key"))));
            return m;
        }).sorted((a, b) -> ((Integer) b.get("weight")) - ((Integer) a.get("weight"))).toList();
        Map<String, Object> out = new LinkedHashMap<>(e.get(0));
        out.put("documents", docs);
        out.put("neighbors", neighbors);
        return out;
    }

    /* =============================== Borrado =============================== */

    public boolean delete(UserRecord u, String id) {
        List<Map<String, Object>> r = jdbc.queryForList("SELECT entities FROM knowledge_docs WHERE id = ? AND user_id = ?", id, u.id());
        if (r.isEmpty()) return false;
        synchronized (this) {
            unlink(u.id(), split(String.valueOf(r.get(0).get("entities"))));
            jdbc.update("DELETE FROM knowledge_docs WHERE id = ?", id);
        }
        return true;
    }

    public synchronized int clear(String userId) {
        int n = jdbc.update("DELETE FROM knowledge_docs WHERE user_id = ?", userId);
        jdbc.update("DELETE FROM knowledge_entities WHERE user_id = ?", userId);
        jdbc.update("DELETE FROM knowledge_edges WHERE user_id = ?", userId);
        return n;
    }

    private void purgeOld(String userId, int days) {
        String cut = OffsetDateTime.now().minusDays(days).toString();
        jdbc.queryForList("SELECT id FROM knowledge_docs WHERE user_id = ? AND updated_at < ?", userId, cut).forEach(r -> {
            List<Map<String, Object>> e = jdbc.queryForList("SELECT entities FROM knowledge_docs WHERE id = ?", r.get("id"));
            if (!e.isEmpty()) unlink(userId, split(String.valueOf(e.get(0).get("entities"))));
            jdbc.update("DELETE FROM knowledge_docs WHERE id = ?", r.get("id"));
        });
    }

    /** Limpieza diaria según la retención de cada persona. */
    @org.springframework.scheduling.annotation.Scheduled(fixedDelay = 6 * 3600 * 1000L, initialDelay = 120_000L)
    public void retentionSweep() {
        try {
            jdbc.queryForList("SELECT user_id, retention_days FROM knowledge_settings WHERE retention_days > 0")
                    .forEach(r -> purgeOld(String.valueOf(r.get("user_id")), toInt(r.get("retention_days"))));
        } catch (Exception e) { log.debug("Retención de conocimiento: {}", e.getMessage()); }
    }

    /* =============================== Texto =============================== */

    public static String norm(String s) {
        if (s == null) return "";
        return Normalizer.normalize(s, Normalizer.Form.NFD).replaceAll("\\p{M}", "").toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9%ñ]+", " ").trim();
    }

    private static final Set<String> STOP = Set.of("el", "la", "los", "las", "un", "una", "unos", "unas", "de", "del", "al", "a", "en", "y", "o", "u", "que", "por", "para",
            "con", "sin", "se", "su", "sus", "es", "son", "fue", "ser", "como", "mas", "pero", "lo", "le", "les", "me", "mi", "tu", "te", "si", "no", "ya", "este", "esta",
            "esto", "estos", "estas", "ese", "esa", "hay", "muy", "cual", "cuales", "cuanto", "cuantos", "cuanta", "donde", "cuando", "entre", "sobre", "desde", "hasta",
            "the", "of", "and", "to", "in", "vs", "segun", "cada", "todo", "toda", "todos", "otro", "otra", "tambien");

    /** Raíz simple para el español (suficiente para que «ventas», «venta» y «ventas» coincidan). */
    static String stem(String w) {
        if (w.length() <= 3) return w;
        for (String suf : List.of("aciones", "iciones", "amente", "mente", "acion", "icion", "ciones", "cion", "idades", "idad", "ables", "ible", "able", "istas", "ista",
                "es", "s")) {
            if (w.endsWith(suf) && w.length() - suf.length() >= 3) return w.substring(0, w.length() - suf.length());
        }
        return w;
    }

    static List<String> tokens(String s) {
        List<String> out = new ArrayList<>();
        for (String w : norm(s).split("\\s+")) if (!w.isBlank() && !STOP.contains(w) && (w.length() > 1 || w.equals("%"))) out.add(stem(w));
        return out;
    }

    private static List<String> split(String s) {
        if (s == null || s.isBlank() || "null".equals(s)) return new ArrayList<>();
        return new ArrayList<>(Arrays.stream(s.split("\\|")).filter(x -> !x.isBlank()).distinct().toList());
    }

    private String json(Object o) {
        if (o == null) return null;
        try { return mapper.writeValueAsString(o); } catch (Exception e) { return null; }
    }

    private Object parse(Object o) {
        if (o == null) return null;
        try { return mapper.readValue(String.valueOf(o), new TypeReference<Map<String, Object>>() {}); } catch (Exception e) { return null; }
    }

    static String clip(String s, int n) { return s == null ? "" : s.length() <= n ? s : s.substring(0, n) + "…"; }

    private static int toInt(Object o) {
        if (o == null) return 0;
        if (o instanceof Number n) return n.intValue();
        try { return Integer.parseInt(String.valueOf(o)); } catch (Exception e) { return 0; }
    }

    /** Lista de documentos para exportar (todo lo de la persona, JSON). */
    public List<Map<String, Object>> export(UserRecord u) {
        return jdbc.queryForList("SELECT * FROM knowledge_docs WHERE user_id = ? ORDER BY created_at", u.id()).stream()
                .filter(r -> visible(u, r)).map(r -> out(u.id(), r, null, null)).toList();
    }
}
