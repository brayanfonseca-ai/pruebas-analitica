package io.datasense.engine;

import io.datasense.engine.LogicalModelService.FieldInput;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/** Unitario puro de {@link LogicalModelService}: clasificación, agg, overrides y summarize. */
class LogicalModelServiceTest {

    private final LogicalModelService service = new LogicalModelService();

    private List<FieldInput> sampleInputs() {
        return List.of(
                new FieldInput("ventas", "Region", "Region", "text", false),
                new FieldInput("ventas", "Ventas", "Ventas", "number", false),
                new FieldInput("ventas", "Mes", "Mes", "date", false));
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> fieldByName(Map<String, Object> doc, String name) {
        for (Object o : (List<Object>) doc.get("fields")) {
            Map<String, Object> f = (Map<String, Object>) o;
            if (name.equals(f.get("field"))) return f;
        }
        fail("campo no encontrado: " + name);
        return null;
    }

    @Test
    void clasificaPorTipoYAggPorDefecto() {
        Map<String, Object> doc = service.generateDefault(sampleInputs());

        Map<String, Object> region = fieldByName(doc, "Region");
        assertEquals("dimension", region.get("classification"));
        assertEquals("none", region.get("defaultAggregation"));
        assertEquals(true, region.get("dataValueSearch"));
        assertEquals("visible", region.get("visibility"));

        Map<String, Object> ventas = fieldByName(doc, "Ventas");
        assertEquals("measure", ventas.get("classification"));
        assertEquals("sum", ventas.get("defaultAggregation"));
        assertEquals(false, ventas.get("dataValueSearch"));

        Map<String, Object> mes = fieldByName(doc, "Mes");
        assertEquals("date", mes.get("classification"));
        assertEquals("none", mes.get("defaultAggregation"));
        assertEquals(false, mes.get("dataValueSearch"));

        assertEquals(true, doc.get("enabled"));
        assertTrue(doc.get("groups") instanceof List);
        assertTrue(doc.get("calendarPeriods") instanceof List);
    }

    @Test
    void numberForzadoATextSeClasificaDimension() {
        List<FieldInput> inputs = List.of(
                new FieldInput("ventas", "Codigo", "Codigo", "text", false)); // forced_type text ya aplicado
        Map<String, Object> doc = service.generateDefault(inputs);
        Map<String, Object> codigo = fieldByName(doc, "Codigo");
        assertEquals("dimension", codigo.get("classification"));
    }

    @Test
    void renameYHiddenPorOverride() {
        List<FieldInput> inputs = List.of(
                new FieldInput("ventas", "reg", "Region", "text", false),  // display = rename
                new FieldInput("ventas", "Costo", "Costo", "number", true)); // oculto
        Map<String, Object> doc = service.generateDefault(inputs);

        Map<String, Object> reg = fieldByName(doc, "reg");
        assertEquals("Region", reg.get("display"));

        Map<String, Object> costo = fieldByName(doc, "Costo");
        assertEquals("hidden", costo.get("visibility"));
        assertEquals(true, costo.get("hiddenByOverride"));
    }

    @Test
    void summarizeCuentaVisibilidadesYColecciones() {
        Map<String, Object> doc = service.generateDefault(List.of(
                new FieldInput("ventas", "Region", "Region", "text", false),
                new FieldInput("ventas", "Ventas", "Ventas", "number", false),
                new FieldInput("ventas", "Costo", "Costo", "number", true)));
        Map<String, Object> summary = service.summarize(doc);

        assertEquals(2, summary.get("fieldsVisible"));
        assertEquals(1, summary.get("fieldsHidden"));
        assertEquals(0, summary.get("fieldsExcluded"));
        assertEquals(0, summary.get("hierarchies"));
        assertEquals(0, summary.get("calendarPeriods"));
    }

    @Test
    void mergeSuperponeAjustesYDescartaCamposInexistentes() {
        Map<String, Object> base = service.generateDefault(sampleInputs());

        // Guardado: el usuario ocultó 'Ventas' y renombró su display; además un campo viejo que ya no existe.
        Map<String, Object> savedField = new LinkedHashMap<>();
        savedField.put("table", "ventas");
        savedField.put("field", "Ventas");
        savedField.put("display", "Total Ventas");
        savedField.put("visibility", "hidden");

        Map<String, Object> ghost = new LinkedHashMap<>();
        ghost.put("table", "ventas");
        ghost.put("field", "CampoViejo");
        ghost.put("visibility", "excluded");

        Map<String, Object> saved = new LinkedHashMap<>();
        saved.put("fields", new ArrayList<>(List.of(savedField, ghost)));
        Map<String, Object> grp = new LinkedHashMap<>();
        grp.put("id", "g1");
        grp.put("type", "measure");
        saved.put("groups", new ArrayList<>(List.of(grp)));

        Map<String, Object> merged = service.merge(base, saved);

        Map<String, Object> ventas = fieldByName(merged, "Ventas");
        assertEquals("Total Ventas", ventas.get("display"));
        assertEquals("hidden", ventas.get("visibility"));
        // measure original conservada tras el merge
        assertEquals("measure", ventas.get("classification"));

        // El campo fantasma no aparece (ya no existe en base).
        for (Object o : (List<?>) merged.get("fields")) {
            @SuppressWarnings("unchecked")
            Map<String, Object> f = (Map<String, Object>) o;
            assertNotEquals("CampoViejo", f.get("field"));
        }
        // Las colecciones guardadas se conservan.
        assertEquals(1, ((List<?>) merged.get("groups")).size());
    }
}
