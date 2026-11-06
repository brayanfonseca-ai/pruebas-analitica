package io.datasense.engine;

import io.datasense.model.AppModels.ColumnProfile;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;

/**
 * Perfilado de columnas: infiere el tipo lógico {text, number, date} y cuenta
 * nulos/distintos. Porta la lógica de engine/profiling.py a Java.
 *
 * <p>Una columna es "number" si la mayoría de sus valores no nulos parsean como
 * número; "date" si parsean como fecha ISO; si no, "text". El umbral de éxito
 * es 0.8, igual que en el backend Python.</p>
 */
public final class Profiler {

    private static final double THRESHOLD = 0.8;

    private Profiler() {}

    /** Infiere el tipo lógico de una columna a partir de sus valores (como texto). */
    public static String inferType(List<String> values) {
        List<String> nonNull = values.stream().filter(v -> v != null && !v.isBlank()).toList();
        if (nonNull.isEmpty()) return "text";

        long numeric = nonNull.stream().filter(Profiler::isNumeric).count();
        if ((double) numeric / nonNull.size() >= THRESHOLD) return "number";

        long dates = nonNull.stream().filter(Profiler::isDate).count();
        if ((double) dates / nonNull.size() >= THRESHOLD) return "date";

        return "text";
    }

    public static boolean isNumeric(String s) {
        if (s == null) return false;
        String t = s.trim().replace(",", "");
        if (t.isEmpty()) return false;
        try { Double.parseDouble(t); return true; } catch (NumberFormatException e) { return false; }
    }

    private static boolean isDate(String s) {
        if (s == null) return false;
        String t = s.trim();
        // Acepta ISO (yyyy-mm-dd) y dd/mm/yyyy — detección pragmática.
        return t.matches("\\d{4}-\\d{1,2}-\\d{1,2}([ T].*)?") || t.matches("\\d{1,2}/\\d{1,2}/\\d{2,4}");
    }

    /** Construye el perfil de una columna dado su nombre y sus valores en texto. */
    public static ColumnProfile profile(String name, List<String> values) {
        String type = inferType(values);
        int total = values.size();
        int nulls = (int) values.stream().filter(v -> v == null || v.isBlank()).count();
        LinkedHashSet<String> distinct = new LinkedHashSet<>();
        List<Object> sample = new ArrayList<>();
        for (String v : values) {
            if (v == null || v.isBlank()) continue;
            if (distinct.add(v) && sample.size() < 10) sample.add(coerce(v, type));
        }
        return new ColumnProfile(name, type, nulls, distinct.size(), total, sample);
    }

    /** Convierte un valor de texto a su tipo lógico (Double para number, String si no). */
    public static Object coerce(String v, String type) {
        if (v == null || v.isBlank()) return null;
        if ("number".equals(type) && isNumeric(v)) {
            double d = Double.parseDouble(v.trim().replace(",", ""));
            return (d == Math.floor(d) && !Double.isInfinite(d)) ? (Object) (long) d : (Object) d;
        }
        return v;
    }
}
