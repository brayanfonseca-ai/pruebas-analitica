package io.datasense.engine;

import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Motor del modelo lógico, PURO (sin JDBC): testeable aislado como POJO y a la
 * vez inyectable como bean (patrón de {@link FieldOverrides} / {@link Profiler},
 * con métodos de instancia para poder mockearlo en los tests de controlador).
 *
 * <p>Genera la lógica de negocio por defecto a partir de los campos reales de
 * las tablas (nombre, tipo efectivo) respetando los field-overrides, mezcla los
 * ajustes guardados por el usuario sobre esa base regenerada, y resume el
 * documento para la UI.</p>
 *
 * <p>El documento es un mapa con las claves {@code enabled, fields, groups,
 * packages, hierarchies, behaviors, calendarPeriods}. Cada campo de
 * {@code fields} lleva {@code table, field, display, classification, type,
 * visibility, dataValueSearch, defaultAggregation, hiddenByOverride}.</p>
 */
@Service
public class LogicalModelService {

    /** Columna real de una tabla, con su tipo efectivo y su override resuelto. */
    public static final class FieldInput {
        public final String table;
        public final String field;      // nombre real (original) de la columna
        public final String display;    // rename del override o el nombre real
        public final String type;        // tipo efectivo: text|number|date
        public final boolean hidden;     // oculto por override

        public FieldInput(String table, String field, String display, String type, boolean hidden) {
            this.table = table;
            this.field = field;
            this.display = display;
            this.type = type;
            this.hidden = hidden;
        }
    }

    /**
     * Genera el documento por defecto desde los campos reales. {@code inputs} es
     * la lista de columnas de todas las tablas ya resueltas con su tipo efectivo
     * y su override (ver el controlador, que las arma con TableStore +
     * FieldOverrideRepository).
     */
    public Map<String, Object> generateDefault(List<FieldInput> inputs) {
        List<Map<String, Object>> fields = new ArrayList<>();
        if (inputs != null) {
            for (FieldInput in : inputs) {
                fields.add(buildField(in));
            }
        }
        Map<String, Object> doc = new LinkedHashMap<>();
        doc.put("enabled", true);
        doc.put("fields", fields);
        doc.put("groups", new ArrayList<Map<String, Object>>());
        doc.put("packages", new ArrayList<Map<String, Object>>());
        doc.put("hierarchies", new ArrayList<Map<String, Object>>());
        doc.put("behaviors", new ArrayList<Map<String, Object>>());
        doc.put("calendarPeriods", new ArrayList<Map<String, Object>>());
        return doc;
    }

    private static Map<String, Object> buildField(FieldInput in) {
        String type = normalizeType(in.type);
        String classification;
        String defaultAggregation;
        boolean dataValueSearch;
        switch (type) {
            case "number" -> {
                classification = "measure";
                defaultAggregation = "sum";
                dataValueSearch = false;
            }
            case "date" -> {
                classification = "date";
                defaultAggregation = "none";
                dataValueSearch = false;
            }
            default -> { // text
                classification = "dimension";
                defaultAggregation = "none";
                dataValueSearch = true;
            }
        }
        Map<String, Object> f = new LinkedHashMap<>();
        f.put("table", in.table);
        f.put("field", in.field);
        f.put("display", in.display != null && !in.display.isBlank() ? in.display : in.field);
        f.put("classification", classification);
        f.put("type", type);
        f.put("visibility", in.hidden ? "hidden" : "visible");
        f.put("dataValueSearch", dataValueSearch);
        f.put("defaultAggregation", defaultAggregation);
        f.put("hiddenByOverride", in.hidden);
        return f;
    }

    private static String normalizeType(String type) {
        if ("number".equals(type) || "date".equals(type)) return type;
        return "text";
    }

    /**
     * Mezcla el documento guardado por el usuario sobre la base regenerada.
     * Parte de {@code base} (campos reales actuales) y superpone, por
     * (table, field), los ajustes del usuario (classification, display,
     * visibility, dataValueSearch, defaultAggregation). Los campos guardados que
     * ya no existen se descartan; los campos nuevos aparecen con su default. Las
     * colecciones (groups/packages/hierarchies/behaviors/calendarPeriods) se
     * toman de lo guardado si están presentes.
     */
    @SuppressWarnings("unchecked")
    public Map<String, Object> merge(Map<String, Object> base, Map<String, Object> saved) {
        if (saved == null) return base;

        List<Map<String, Object>> baseFields = asList(base.get("fields"));
        List<Map<String, Object>> savedFields = asList(saved.get("fields"));

        Map<String, Map<String, Object>> savedByKey = new LinkedHashMap<>();
        for (Map<String, Object> sf : savedFields) {
            savedByKey.put(key(sf), sf);
        }

        List<Map<String, Object>> merged = new ArrayList<>();
        for (Map<String, Object> bf : baseFields) {
            Map<String, Object> sf = savedByKey.get(key(bf));
            if (sf == null) {
                merged.add(bf);
                continue;
            }
            Map<String, Object> out = new LinkedHashMap<>(bf);
            overlay(out, sf, "classification");
            overlay(out, sf, "display");
            overlay(out, sf, "visibility");
            overlay(out, sf, "dataValueSearch");
            overlay(out, sf, "defaultAggregation");
            merged.add(out);
        }

        Map<String, Object> doc = new LinkedHashMap<>();
        doc.put("enabled", saved.containsKey("enabled") ? saved.get("enabled") : base.get("enabled"));
        doc.put("fields", merged);
        doc.put("groups", savedCollection(base, saved, "groups"));
        doc.put("packages", savedCollection(base, saved, "packages"));
        doc.put("hierarchies", savedCollection(base, saved, "hierarchies"));
        doc.put("behaviors", savedCollection(base, saved, "behaviors"));
        doc.put("calendarPeriods", savedCollection(base, saved, "calendarPeriods"));
        return doc;
    }

    private static Object savedCollection(Map<String, Object> base, Map<String, Object> saved, String k) {
        Object v = saved.get(k);
        if (v instanceof List) return v;
        Object b = base.get(k);
        return b != null ? b : new ArrayList<>();
    }

    private static void overlay(Map<String, Object> target, Map<String, Object> source, String key) {
        if (source.containsKey(key) && source.get(key) != null) {
            target.put(key, source.get(key));
        }
    }

    private static String key(Map<String, Object> f) {
        return String.valueOf(f.get("table")) + "\u0000" + String.valueOf(f.get("field"));
    }

    /**
     * Resumen del documento para la UI: conteos de visibilidad de campos, de
     * grupos por tipo, de jerarquías y de periodos de calendario.
     */
    public Map<String, Object> summarize(Map<String, Object> doc) {
        int visible = 0, hidden = 0, excluded = 0;
        for (Map<String, Object> f : asList(doc == null ? null : doc.get("fields"))) {
            String vis = String.valueOf(f.get("visibility"));
            switch (vis) {
                case "hidden" -> hidden++;
                case "excluded" -> excluded++;
                default -> visible++;
            }
        }
        int gCal = 0, gMeasure = 0, gDimension = 0;
        for (Map<String, Object> g : asList(doc == null ? null : doc.get("groups"))) {
            String t = String.valueOf(g.get("type"));
            switch (t) {
                case "calendar" -> gCal++;
                case "measure" -> gMeasure++;
                case "dimension" -> gDimension++;
                default -> { /* ignorar tipos desconocidos */ }
            }
        }
        int hierarchies = asList(doc == null ? null : doc.get("hierarchies")).size();
        int calendarPeriods = asList(doc == null ? null : doc.get("calendarPeriods")).size();

        Map<String, Object> s = new LinkedHashMap<>();
        s.put("fieldsVisible", visible);
        s.put("fieldsHidden", hidden);
        s.put("fieldsExcluded", excluded);
        s.put("groupsCalendar", gCal);
        s.put("groupsMeasure", gMeasure);
        s.put("groupsDimension", gDimension);
        s.put("hierarchies", hierarchies);
        s.put("calendarPeriods", calendarPeriods);
        return s;
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> asList(Object o) {
        if (o instanceof List<?> l) {
            List<Map<String, Object>> out = new ArrayList<>();
            for (Object item : l) {
                if (item instanceof Map) out.add((Map<String, Object>) item);
            }
            return out;
        }
        return new ArrayList<>();
    }
}
