package io.datasense.ai;

import com.fasterxml.jackson.databind.ObjectMapper;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Parsea y sanea el PLAN DE ACCIONES que el modelo de IA emite dentro de un
 * bloque delimitado por marcadores en su respuesta de texto.
 *
 * <p>El modelo responde en prosa natural y, cuando procede, incluye ADEMÁS un
 * bloque {@code <<<DS_ACTION>>> {json} <<<END_DS_ACTION>>>}. Este helper extrae
 * ese JSON, lo RETIRA del texto visible y lo sanea a una acción segura:
 * {@code { kind, objects?, script? }} con {@code kind in
 * {build-sheet, add-objects, apply-script}}.
 *
 * <p>Robustez: si no hay bloque o el JSON es inválido, se devuelve el texto
 * original intacto y {@code action=null}. NUNCA lanza.
 */
public final class ActionPlan {

    private static final String START = "<<<DS_ACTION>>>";
    private static final String END = "<<<END_DS_ACTION>>>";

    /** Bloque DS_ACTION completo (no greedy), con el JSON interior en el grupo 1. */
    private static final Pattern BLOCK = Pattern.compile(
            Pattern.quote(START) + "(.*?)" + Pattern.quote(END),
            Pattern.DOTALL);

    /** Rejilla de 24 columnas usada por la hoja del frontend. */
    private static final int GRID_COLS = 24;

    /** Aggregaciones permitidas; cualquier otra se normaliza a sum. */
    private static final Set<String> VALID_AGG = Set.of("sum", "count", "avg", "min", "max");

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private ActionPlan() {
    }

    /** Resultado del parseo: texto visible (sin el bloque) y la acción cruda (o null). */
    public record ParseResult(String visibleText, Map<String, Object> action) {
    }

    /**
     * Extrae los bloques {@code <<<DS_ACTION>>>...<<<END_DS_ACTION>>>} del texto
     * del modelo. RETIRA del texto visible TODOS los bloques (incluidos los
     * marcadores) y devuelve la acción cruda parseada (o null si no hay ningún
     * bloque válido). NUNCA lanza.
     *
     * <p>Nova Micro a veces emite VARIOS bloques (p. ej. con "dashboard completo":
     * un bloque por objeto). Para no perder objetos ni dejar marcadores sueltos en
     * el mensaje: (1) se retiran TODOS los bloques del texto visible; (2) si varios
     * bloques traen {@code objects}, sus arrays se FUSIONAN en una sola acción; si
     * no hay objects, se conserva el primer bloque válido (p. ej. apply-script).
     */
    public static ParseResult parseFromModelText(String modelText) {
        if (modelText == null) {
            return new ParseResult("", null);
        }
        Matcher m = BLOCK.matcher(modelText);

        StringBuilder visibleBuf = new StringBuilder();
        int last = 0;
        Map<String, Object> merged = null;          // acción base (primer bloque válido)
        List<Object> mergedObjects = null;           // objects fusionados de todos los bloques

        while (m.find()) {
            // Acumula el texto entre bloques (lo de antes de este bloque).
            visibleBuf.append(modelText, last, m.start());
            last = m.end();

            String json = m.group(1).trim();
            Map<String, Object> parsed;
            try {
                @SuppressWarnings("unchecked")
                Map<String, Object> p = MAPPER.readValue(json, Map.class);
                parsed = p;
            } catch (Exception e) {
                continue; // bloque corrupto: se ignora (pero igual se retira del texto)
            }

            if (merged == null) {
                merged = parsed;
                Object objs = parsed.get("objects");
                if (objs instanceof List<?> list) {
                    mergedObjects = new ArrayList<>(list);
                }
            } else if (parsed.get("objects") instanceof List<?> list) {
                // Bloques posteriores con objects: fusionar en la acción base.
                if (mergedObjects == null) {
                    mergedObjects = new ArrayList<>();
                }
                mergedObjects.addAll(list);
            }
        }

        if (last == 0) {
            // No había ningún bloque: texto intacto, sin acción.
            return new ParseResult(modelText, null);
        }
        visibleBuf.append(modelText, last, modelText.length());
        String visible = visibleBuf.toString().trim();

        if (merged != null && mergedObjects != null) {
            merged.put("objects", mergedObjects);
        }
        return new ParseResult(visible, merged);
    }

    /** Alias de tipo de objeto -> tipo real soportado por chart-types.js. */
    private static String mapType(String rawType) {
        if (rawType == null) return null;
        switch (rawType.trim().toLowerCase()) {
            case "kpi":
                return "kpi";
            case "bar":
            case "barchart":
            case "barras":
                return "bar";
            case "pie":
            case "piechart":
            case "tarta":
                return "pie";
            case "line":
            case "linechart":
            case "linea":
                return "line";
            case "table":
            case "tabla":
                return "table";
            case "filterpane":
            case "filtros":
            case "filter":
                return "filterpane";
            default:
                return null;
        }
    }

    /**
     * Normaliza una acción de diseño: mapea tipos por alias, descarta objetos de
     * tipo desconocido, conserva dimension/measure.field solo si existen en
     * {@code camposValidos}, normaliza agg, clava la geometría a la rejilla de 24
     * columnas y reempaqueta por filas para evitar solapes. NUNCA lanza.
     *
     * @return {@code { kind, objects }} o null si no queda ningún objeto válido.
     */
    public static Map<String, Object> sanitizeDesign(Map<String, Object> rawAction, Set<String> camposValidos) {
        if (rawAction == null) {
            return null;
        }
        Set<String> campos = camposValidos == null ? Set.of() : camposValidos;

        List<Map<String, Object>> clean = new ArrayList<>();
        Object objsRaw = rawAction.get("objects");
        if (objsRaw instanceof List<?> list) {
            for (Object o : list) {
                if (!(o instanceof Map<?, ?> rawObj)) continue;
                String type = mapType(str(rawObj.get("type")));
                if (type == null) continue;

                Map<String, Object> obj = new LinkedHashMap<>();
                obj.put("type", type);

                String title = str(rawObj.get("title"));
                if (!title.isBlank()) {
                    obj.put("title", title);
                }

                String dimension = str(rawObj.get("dimension"));
                obj.put("dimension", campos.contains(dimension) ? dimension : null);

                Map<String, Object> measure = new LinkedHashMap<>();
                Object rawMeasure = rawObj.get("measure");
                String field = null;
                String agg = "sum";
                if (rawMeasure instanceof Map<?, ?> mm) {
                    field = str(mm.get("field"));
                    agg = normalizeAgg(str(mm.get("agg")));
                }
                measure.put("field", (field != null && campos.contains(field)) ? field : null);
                measure.put("agg", agg);
                obj.put("measure", measure);

                clean.add(obj);
            }
        }

        if (clean.isEmpty()) {
            return null;
        }

        packRows(clean);

        boolean wantsDashboard = "build-sheet".equalsIgnoreCase(str(rawAction.get("kind")));
        String kind = (clean.size() >= 3 || wantsDashboard) ? "build-sheet" : "add-objects";

        Map<String, Object> out = new HashMap<>();
        out.put("kind", kind);
        out.put("objects", clean);
        return out;
    }

    /**
     * Si {@code rawAction} trae un {@code script} string no vacío, devuelve
     * {@code { kind:'apply-script', script }}; en caso contrario null. NUNCA lanza.
     */
    public static Map<String, Object> sanitizeScript(Map<String, Object> rawAction) {
        if (rawAction == null) {
            return null;
        }
        String script = str(rawAction.get("script"));
        if (script == null || script.isBlank()) {
            return null;
        }
        Map<String, Object> out = new HashMap<>();
        out.put("kind", "apply-script");
        out.put("script", script);
        return out;
    }

    /** Normaliza agg a uno de sum|count|avg|min|max; default sum. */
    private static String normalizeAgg(String raw) {
        if (raw == null) return "sum";
        String v = raw.trim().toLowerCase();
        return VALID_AGG.contains(v) ? v : "sum";
    }

    /**
     * Clava x,y,w,h a enteros dentro de la rejilla de 24 columnas y reasigna
     * posiciones por filas para evitar solapes (empaquetado simple). Cada objeto
     * recibe w acotado a [1,24] y se coloca secuencialmente: cuando no cabe en la
     * fila actual salta a la siguiente.
     */
    private static void packRows(List<Map<String, Object>> objects) {
        int x = 0;
        int y = 0;
        int rowHeight = 0;
        for (Map<String, Object> obj : objects) {
            int w = clamp(asInt(obj.get("w"), defaultW(str(obj.get("type")))), 1, GRID_COLS);
            int h = Math.max(1, asInt(obj.get("h"), defaultH(str(obj.get("type")))));

            if (x + w > GRID_COLS) {
                x = 0;
                y += rowHeight;
                rowHeight = 0;
            }

            obj.put("x", x);
            obj.put("y", y);
            obj.put("w", w);
            obj.put("h", h);

            x += w;
            rowHeight = Math.max(rowHeight, h);
        }
    }

    private static int defaultW(String type) {
        if ("kpi".equals(type)) return 6;
        if ("filterpane".equals(type)) return 6;
        return 12;
    }

    private static int defaultH(String type) {
        if ("kpi".equals(type)) return 3;
        return 6;
    }

    private static int clamp(int v, int min, int max) {
        return Math.max(min, Math.min(max, v));
    }

    private static int asInt(Object o, int fallback) {
        if (o instanceof Number n) {
            return n.intValue();
        }
        if (o instanceof String s) {
            try {
                return (int) Math.round(Double.parseDouble(s.trim()));
            } catch (NumberFormatException e) {
                return fallback;
            }
        }
        return fallback;
    }

    private static String str(Object o) {
        return o == null ? "" : String.valueOf(o);
    }
}
