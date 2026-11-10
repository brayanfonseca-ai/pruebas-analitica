package io.datasense.repo;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Traduce los objetos de una hoja del formato AMIGABLE/PLANO (el que acepta la
 * herramienta MCP {@code create_sheet} y el endpoint REST
 * {@code POST /api/v1/apps/{appId}/sheets}) al formato INTERNO que el frontend
 * (js/app-hoja.js + chart-types.js) sabe renderizar.
 *
 * <p>Formato plano de entrada (por objeto):
 * <pre>{ type, title, dimension:"&lt;campo&gt;", measure:{ field, agg }, x, y, w, h }</pre>
 *
 * <p>Formato interno de salida (por objeto):
 * <pre>{ id, type, x, y, w, h, props:{ title, dims:[{id,source:"field",table,field}],
 *        measures:[{id,source:"field",table,field,agg}] } }</pre>
 *
 * <p>Es IDEMPOTENTE: si un objeto ya viene en formato interno (trae {@code id} y
 * {@code props} con {@code dims}/{@code measures}), se deja pasar intacto. Así las
 * hojas que crea el propio frontend no se tocan.
 *
 * <p>La TABLA de cada campo se resuelve contra los campos reales de la app
 * (mapa campo → tabla que construye {@link SheetRepository} con el mismo criterio
 * que {@code GET /api/v1/apps/{appId}/fields}). Un campo que no existe en la app
 * se omite (no se inventa, no se rompe).
 */
final class SheetObjectNormalizer {

    private SheetObjectNormalizer() {}

    private static final List<String> AGGS = List.of("sum", "count", "avg", "min", "max");

    /** Máximo de dimensiones/medidas por tipo (espejo de roles en chart-types.js). */
    private static int maxDims(String type) {
        return switch (type) {
            case "kpi", "gauge", "histogram", "animator", "button", "layoutcontainer",
                 "matrixcontainer", "tabcontainer", "slider", "variableinput", "image",
                 "nlinsights", "hline", "navmenu", "video", "datepicker", "text" -> 0;
            case "sankey", "gridchart", "orgchart", "pivot", "network" -> 2;
            case "filterpane" -> 4;
            default -> 1;
        };
    }

    private static int maxMeasures(String type) {
        return switch (type) {
            case "orgchart", "network", "filterpane", "animator", "button", "layoutcontainer",
                 "matrixcontainer", "tabcontainer", "slider", "variableinput", "image",
                 "nlinsights", "hline", "navmenu", "video", "datepicker", "text" -> 0;
            case "bar", "line", "radar" -> 3;
            case "kpi", "combo", "scatter", "mekko" -> 2;
            case "annotationtable", "table" -> 5;
            default -> 1;
        };
    }

    /**
     * Normaliza una lista de objetos. Devuelve una nueva lista; los objetos ya
     * internos se preservan, los planos se traducen y los campos inexistentes se omiten.
     *
     * @param objects lista cruda de objetos del body / doc_json
     * @param fieldTable mapa campo → tabla resuelto a partir de los datos reales de la app
     */
    @SuppressWarnings("unchecked")
    static List<Object> normalize(List<?> objects, Map<String, String> fieldTable) {
        List<Object> out = new ArrayList<>();
        if (objects == null) return out;
        for (Object raw : objects) {
            if (!(raw instanceof Map)) { continue; }
            Map<String, Object> o = (Map<String, Object>) raw;
            if (isInternal(o)) {
                out.add(o);
                continue;
            }
            Map<String, Object> normalized = normalizeOne(o, fieldTable);
            if (normalized != null) out.add(normalized);
        }
        return out;
    }

    /**
     * ¿Ya está el objeto en formato interno? Se considera interno si trae un
     * {@code props} con {@code dims} o {@code measures} (arrays), que es lo que
     * el frontend genera. Un objeto plano del MCP no tiene {@code props.dims}.
     */
    /** ¿Todos los objetos ya vienen en formato interno? (entonces no hace falta resolver campos). */
    @SuppressWarnings("unchecked")
    static boolean allInternal(List<?> objects) {
        if (objects == null) return true;
        for (Object raw : objects) if (raw instanceof Map && !isInternal((Map<String, Object>) raw)) return false;
        return true;
    }

    @SuppressWarnings("unchecked")
    private static boolean isInternal(Map<String, Object> o) {
        Object props = o.get("props");
        if (!(props instanceof Map)) return false;
        Map<String, Object> p = (Map<String, Object>) props;
        return p.get("dims") instanceof List || p.get("measures") instanceof List;
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> normalizeOne(Map<String, Object> o, Map<String, String> fieldTable) {
        String type = str(o.get("type"));
        if (type.isBlank()) return null;

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("id", o.get("id") == null ? Ids.newId() : o.get("id"));
        result.put("type", type);
        if (o.containsKey("x")) result.put("x", o.get("x"));
        if (o.containsKey("y")) result.put("y", o.get("y"));
        if (o.containsKey("w")) result.put("w", o.get("w"));
        if (o.containsKey("h")) result.put("h", o.get("h"));

        Map<String, Object> props = new LinkedHashMap<>();
        if (o.get("props") instanceof Map) props.putAll((Map<String, Object>) o.get("props"));

        if (o.get("title") != null) props.put("title", str(o.get("title")));
        else if (!props.containsKey("title")) props.put("title", "");

        // --- Dimensiones ---
        List<Object> dims = new ArrayList<>();
        int dimMax = maxDims(type);
        for (Object src : collectDimSources(o)) {
            if (dims.size() >= dimMax) break;
            Map<String, Object> item = dimItem(src, fieldTable);
            if (item != null) dims.add(item);
        }
        props.put("dims", dims);

        // --- Medidas ---
        List<Object> measures = new ArrayList<>();
        int measMax = maxMeasures(type);
        for (Object src : collectMeasureSources(o)) {
            if (measures.size() >= measMax) break;
            Map<String, Object> item = measureItem(src, fieldTable);
            if (item != null) measures.add(item);
        }
        props.put("measures", measures);

        result.put("props", props);
        return result;
    }

    /** Fuentes de dimensión del objeto plano: {@code dimension} (string/lista) y/o {@code dims}. */
    @SuppressWarnings("unchecked")
    private static List<Object> collectDimSources(Map<String, Object> o) {
        List<Object> list = new ArrayList<>();
        Object dimension = o.get("dimension");
        if (dimension instanceof List) list.addAll((List<Object>) dimension);
        else if (dimension != null) list.add(dimension);
        Object dims = o.get("dims");
        if (dims instanceof List) list.addAll((List<Object>) dims);
        return list;
    }

    /** Fuentes de medida del objeto plano: {@code measure} (obj/lista) y/o {@code measures}. */
    @SuppressWarnings("unchecked")
    private static List<Object> collectMeasureSources(Map<String, Object> o) {
        List<Object> list = new ArrayList<>();
        Object measure = o.get("measure");
        if (measure instanceof List) list.addAll((List<Object>) measure);
        else if (measure != null) list.add(measure);
        Object measures = o.get("measures");
        if (measures instanceof List) list.addAll((List<Object>) measures);
        return list;
    }

    /** Construye un item de dimensión interno; {@code null} si el campo no existe. */
    @SuppressWarnings("unchecked")
    private static Map<String, Object> dimItem(Object src, Map<String, String> fieldTable) {
        String field;
        if (src instanceof Map) field = str(((Map<String, Object>) src).get("field"));
        else field = str(src);
        if (field.isBlank()) return null;
        String table = fieldTable.get(field);
        if (table == null) return null;
        Map<String, Object> item = new LinkedHashMap<>();
        item.put("id", Ids.newId());
        item.put("source", "field");
        item.put("table", table);
        item.put("field", field);
        return item;
    }

    /** Construye un item de medida interno; {@code null} si el campo no existe. */
    @SuppressWarnings("unchecked")
    private static Map<String, Object> measureItem(Object src, Map<String, String> fieldTable) {
        String field;
        String agg = "sum";
        if (src instanceof Map) {
            Map<String, Object> m = (Map<String, Object>) src;
            field = str(m.get("field"));
            String a = str(m.get("agg"));
            if (AGGS.contains(a)) agg = a;
        } else {
            field = str(src);
        }
        if (field.isBlank()) return null;
        String table = fieldTable.get(field);
        if (table == null) return null;
        Map<String, Object> item = new LinkedHashMap<>();
        item.put("id", Ids.newId());
        item.put("source", "field");
        item.put("table", table);
        item.put("field", field);
        item.put("agg", agg);
        return item;
    }

    private static String str(Object o) { return o == null ? "" : String.valueOf(o); }
}
