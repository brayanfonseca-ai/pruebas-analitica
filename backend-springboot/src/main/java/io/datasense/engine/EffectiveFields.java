package io.datasense.engine;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Catálogo EFECTIVO de campos de una tabla: combina un {@link DataFrame} con su
 * capa de {@code field_overrides} y expone, por campo, su IDENTIDAD ESTABLE (el
 * nombre físico de la columna), su DISPLAY (rename del override o el físico), su
 * TIPO efectivo (forced_type si lo hay, si no el inferido) y si está OCULTO.
 *
 * <p>Decisión de diseño central: la identidad de un campo es su nombre físico;
 * el override es solo una capa de PRESENTACIÓN. Por eso este catálogo conserva
 * SIEMPRE el {@code sourceField} físico (incluso para campos ocultos), de modo
 * que las queries y los objetos de hoja —que guardan el nombre físico— sigan
 * resolviendo tras un rename. Centralizar la derivación aquí evita que
 * {@code /fields}, {@code /fields/values}, {@code /model} y el normalizador de
 * hojas interpreten los overrides de formas distintas.
 *
 * <p>Reusa {@link FieldOverrides#apply} para la lógica de rename/tipo/hidden y
 * NO modifica el DataFrame ni el CSV materializado.
 */
public final class EffectiveFields {

    private EffectiveFields() {}

    /** Un campo efectivo: identidad física + presentación + tipo + visibilidad. */
    public record Field(String table, String sourceField, String display, String type, boolean hidden) {}

    /**
     * Resuelve el catálogo efectivo de una tabla.
     *
     * @param table     nombre de la tabla
     * @param df        DataFrame crudo de la tabla
     * @param overrides lista de overrides (claves {@code source_field, rename,
     *                  forced_type, hidden}); puede ser null/vacía
     * @return campos en orden físico. Los ocultos SE INCLUYEN (con
     *         {@code hidden=true}) para que su identidad siga siendo resoluble;
     *         el consumidor decide si los excluye del catálogo construible.
     */
    public static List<Field> resolve(String table, DataFrame df, List<Map<String, Object>> overrides) {
        List<Field> out = new ArrayList<>();
        // Vista efectiva (solo columnas visibles, con rename y tipo forzado).
        FieldOverrides.Effective eff = FieldOverrides.apply(df, overrides);

        // Índice físico -> posición visible en la vista efectiva.
        List<String> cols = df.columns();
        for (int c = 0; c < cols.size(); c++) {
            String sourceField = cols.get(c);
            int visible = indexOfSource(eff, c);
            if (visible < 0) {
                // Campo oculto: conserva identidad física y tipo efectivo (forced si lo hay).
                out.add(new Field(table, sourceField, sourceField, effectiveTypeFor(df, overrides, sourceField), true));
            } else {
                out.add(new Field(table, sourceField, eff.names().get(visible), eff.typeAt(visible), false));
            }
        }
        return out;
    }

    /** Clasifica un tipo efectivo en rol de medida (number) vs dimensión (text/date). */
    public static boolean isMeasureType(String type) {
        return "number".equals(type);
    }

    private static int indexOfSource(FieldOverrides.Effective eff, int sourceIndex) {
        for (int i = 0; i < eff.size(); i++) {
            if (eff.sourceIndexAt(i) == sourceIndex) return i;
        }
        return -1;
    }

    /** Tipo efectivo de un campo físico (forced_type válido o inferido), aun si está oculto. */
    private static String effectiveTypeFor(DataFrame df, List<Map<String, Object>> overrides, String sourceField) {
        if (overrides != null) {
            for (Map<String, Object> ov : overrides) {
                if (sourceField.equals(String.valueOf(ov.get("source_field")))) {
                    Object ft = ov.get("forced_type");
                    String forced = ft == null ? null : String.valueOf(ft);
                    if (forced != null && !forced.isBlank()) return forced;
                    break;
                }
            }
        }
        return df.typeOf(sourceField);
    }
}
