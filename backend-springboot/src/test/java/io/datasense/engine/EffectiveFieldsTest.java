package io.datasense.engine;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Unitario puro de {@link EffectiveFields}: fija el contrato
 * identidad(física)/display/tipo(efectivo)/hidden que propaga el override por
 * todo el flujo aguas abajo.
 */
class EffectiveFieldsTest {

    private DataFrame sampleFrame() {
        // columnas: Region (text), Ventas (number), Mes (text)
        return new DataFrame(
                List.of("Region", "Ventas", "Mes"),
                List.of(
                        List.of("Norte", "100", "Enero"),
                        List.of("Sur", "200", "Febrero"),
                        List.of("Este", "300", "Marzo")));
    }

    private EffectiveFields.Field byId(List<EffectiveFields.Field> fs, String sourceField) {
        return fs.stream().filter(f -> f.sourceField().equals(sourceField)).findFirst().orElseThrow();
    }

    @Test
    void sinOverrides_displayIgualAFisico_tipoInferido_nadaOculto() {
        List<EffectiveFields.Field> fs = EffectiveFields.resolve("t", sampleFrame(), null);

        assertEquals(3, fs.size());
        assertEquals("Region", byId(fs, "Region").display());
        assertEquals("text", byId(fs, "Region").type());
        assertEquals("number", byId(fs, "Ventas").type());
        assertEquals("text", byId(fs, "Mes").type());
        assertFalse(byId(fs, "Ventas").hidden());
        // La tabla se propaga en cada campo.
        assertEquals("t", byId(fs, "Ventas").table());
    }

    @Test
    void rename_cambiaDisplay_conservaIdentidadFisica() {
        List<Map<String, Object>> ov = List.of(
                Map.of("source_field", "Ventas", "rename", "Ingresos", "forced_type", "", "hidden", false));
        List<EffectiveFields.Field> fs = EffectiveFields.resolve("t", sampleFrame(), ov);

        EffectiveFields.Field v = byId(fs, "Ventas");
        assertEquals("Ventas", v.sourceField());   // identidad estable
        assertEquals("Ingresos", v.display());      // presentación renombrada
        assertEquals("number", v.type());           // sigue siendo medida
        assertFalse(v.hidden());
    }

    @Test
    void forcedType_numberAText_cambiaRolADimension() {
        List<Map<String, Object>> ov = List.of(
                Map.of("source_field", "Ventas", "forced_type", "text"));
        List<EffectiveFields.Field> fs = EffectiveFields.resolve("t", sampleFrame(), ov);

        EffectiveFields.Field v = byId(fs, "Ventas");
        assertEquals("text", v.type());
        assertFalse(EffectiveFields.isMeasureType(v.type())); // ya no es medida
    }

    @Test
    void forcedType_textANumber_cambiaRolAMedida() {
        List<Map<String, Object>> ov = List.of(
                Map.of("source_field", "Region", "forced_type", "number"));
        List<EffectiveFields.Field> fs = EffectiveFields.resolve("t", sampleFrame(), ov);

        EffectiveFields.Field r = byId(fs, "Region");
        assertEquals("number", r.type());
        assertTrue(EffectiveFields.isMeasureType(r.type()));
    }

    @Test
    void hidden_marcaElCampoPeroConservaIdentidadYtipoEfectivo() {
        List<Map<String, Object>> ov = List.of(
                Map.of("source_field", "Mes", "hidden", true, "forced_type", "date"));
        List<EffectiveFields.Field> fs = EffectiveFields.resolve("t", sampleFrame(), ov);

        // Sigue presente en el catálogo (con hidden=true): su identidad es resoluble.
        EffectiveFields.Field m = byId(fs, "Mes");
        assertTrue(m.hidden());
        assertEquals("Mes", m.sourceField());
        assertEquals("date", m.type()); // tipo efectivo aun estando oculto
    }
}
