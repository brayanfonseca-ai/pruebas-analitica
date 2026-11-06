package io.datasense.engine;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/** Unitario puro de {@link FieldOverrides}: rename / hidden / forced_type. */
class FieldOverridesTest {

    private DataFrame sampleFrame() {
        // columnas: ciudad (text), ventas (number), fecha (date)
        return new DataFrame(
                List.of("ciudad", "ventas", "fecha"),
                List.of(
                        List.of("Bogota", "100", "2024-01-01"),
                        List.of("Medellin", "200", "2024-02-01"),
                        List.of("Cali", "300", "2024-03-01")));
    }

    @Test
    void sinOverrides_vistaIdenticaAlDataFrame() {
        DataFrame df = sampleFrame();
        FieldOverrides.Effective eff = FieldOverrides.apply(df, null);

        assertEquals(List.of("ciudad", "ventas", "fecha"), eff.names());
        assertEquals(3, eff.size());
        // Tipos inferidos intactos.
        assertEquals("text", eff.typeAt(0));
        assertEquals("number", eff.typeAt(1));
        assertEquals("date", eff.typeAt(2));
        // Índices de origen en orden.
        assertEquals(0, eff.sourceIndexAt(0));
        assertEquals(2, eff.sourceIndexAt(2));
    }

    @Test
    void renameCambiaNombreExpuesto_conservaOrigen() {
        DataFrame df = sampleFrame();
        List<Map<String, Object>> overrides = List.of(
                Map.of("source_field", "ciudad", "rename", "Ciudad", "forced_type", "", "hidden", false));
        FieldOverrides.Effective eff = FieldOverrides.apply(df, overrides);

        assertEquals(List.of("Ciudad", "ventas", "fecha"), eff.names());
        // El origen de la columna renombrada sigue siendo la 0 del DataFrame.
        assertEquals(0, eff.sourceIndexAt(0));
        assertEquals(List.of("Bogota", "Medellin", "Cali"), eff.valuesAt(df, 0));
    }

    @Test
    void hiddenExcluyeLaColumna() {
        DataFrame df = sampleFrame();
        List<Map<String, Object>> overrides = List.of(
                Map.of("source_field", "fecha", "hidden", true));
        FieldOverrides.Effective eff = FieldOverrides.apply(df, overrides);

        assertEquals(2, eff.size());
        assertEquals(List.of("ciudad", "ventas"), eff.names());
        assertFalse(eff.names().contains("fecha"));
    }

    @Test
    void forcedTypeSobrescribeElInferido() {
        DataFrame df = sampleFrame();
        // Forzar 'ventas' (number inferido) a text, y 'ciudad' (text) a number.
        List<Map<String, Object>> overrides = List.of(
                Map.of("source_field", "ventas", "forced_type", "text"),
                Map.of("source_field", "ciudad", "forced_type", "number"));
        FieldOverrides.Effective eff = FieldOverrides.apply(df, overrides);

        assertEquals("number", eff.typeAt(0)); // ciudad forzada a number
        assertEquals("text", eff.typeAt(1));   // ventas forzada a text
        assertEquals("date", eff.typeAt(2));   // fecha sin override: inferido
    }

    @Test
    void hiddenEnIntDesdeRepositorio() {
        // El repo entrega hidden como boolean; aquí comprobamos que un entero 1
        // (como podría venir de otra fuente) también oculta.
        DataFrame df = sampleFrame();
        List<Map<String, Object>> overrides = List.of(
                Map.of("source_field", "ventas", "hidden", 1));
        FieldOverrides.Effective eff = FieldOverrides.apply(df, overrides);

        assertEquals(2, eff.size());
        assertFalse(eff.names().contains("ventas"));
    }
}
