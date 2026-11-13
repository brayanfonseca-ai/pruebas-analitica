package io.datasense.model;

import jakarta.validation.constraints.NotBlank;

import java.util.List;
import java.util.Map;

/**
 * Modelos de datos (records) de la API. Equivalen a los Pydantic del backend
 * Python (schemas/models.py) y mantienen los mismos nombres de campo JSON.
 */
public final class AppModels {

    private AppModels() {}

    // ---- apps ----
    public record AppCreate(@NotBlank String name) {}

    /**
     * Aplicación. {@code stage}: personal | desarrollo | produccion. {@code sheets}/{@code published}:
     * total de hojas y cuántas están publicadas (visibles para un visualizador en Producción).
     */
    public record AppOut(String id, String name, String created_at, String stage, String owner_id,
                         String owner_name, int sheets, int published) {}

    // ---- collections ----
    public record CollectionCreate(@NotBlank String name, String description, String visibility) {}

    public record CollectionOut(String id, String name, String description,
                                String visibility, String created_at, String updated_at) {}

    // ---- tables / columns ----
    public record ColumnProfile(String name, String type, int null_count,
                                int distinct_count, int total_count, List<Object> sample) {}

    public record TableOut(String id, String app_id, String name, String source_name,
                           String created_at, int rows, List<ColumnProfile> columns,
                           List<Map<String, Object>> preview) {}

    // ---- sheets ----
    public record SheetDoc(String title, String description,
                           List<Map<String, Object>> objects, Map<String, Object> props) {}

    public record SheetOut(String id, String app_id, String title, String description,
                           int position, List<Map<String, Object>> objects,
                           Map<String, Object> props, String visibility,
                           String created_at, String updated_at) {}

    public record VisibilityUpdate(String visibility) {}

    // ---- query ----
    /** Dimensión: campo físico, o dimensión calculada si trae {@code expr} (se evalúa por fila y se agrupa como {@code field}). */
    public record FieldRef(String table, String field, String expr) {}

    /**
     * Medida de una consulta. Simple: {table, field, agg}. Compuesta (fx con aritmética entre agregaciones,
     * agregación sobre una expresión o Count DISTINCT): además {@code formula} (expresión de fila sobre los
     * marcadores [__a0], [__a1]…) y {@code parts} ([{agg, field|expr, distinct}]), tal como los devuelve
     * {@code Expressions.compile}.
     */
    public record MeasureSpec(String table, String field, String agg, String label,
                              String formula, List<Map<String, Object>> parts) {
        public boolean composite() { return formula != null && !formula.isBlank() && parts != null && !parts.isEmpty(); }
    }

    public record QuerySpec(FieldRef dimension, List<MeasureSpec> measures,
                            String chart_type, Map<String, List<Object>> selections) {}

    public record QueryResult(List<Object> labels, List<Double> values,
                              Double value, List<SeriesOut> series) {}

    public record SeriesOut(String label, List<Double> values) {}
}
