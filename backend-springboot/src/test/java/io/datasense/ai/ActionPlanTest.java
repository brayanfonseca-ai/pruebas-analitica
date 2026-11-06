package io.datasense.ai;

import io.datasense.ai.ActionPlan.ParseResult;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Verifica el parseo y saneamiento del PLAN DE ACCIONES. El foco es que
 * ActionPlan NUNCA lance y que el contrato { kind, objects?, script? } quede
 * saneado: tipos mapeados, campos validados contra el contexto, agg normalizada
 * y geometría dentro de la rejilla de 24 columnas sin solapes.
 */
class ActionPlanTest {

    @Test
    void bloqueValido_retiraBloqueYDevuelveAction() {
        String text = "Aquí tienes tu dashboard.\n"
                + "<<<DS_ACTION>>>{\"kind\":\"build-sheet\",\"objects\":[{\"type\":\"kpi\",\"title\":\"Ventas\"}]}<<<END_DS_ACTION>>>\n"
                + "Avísame si quieres ajustarlo.";

        ParseResult r = ActionPlan.parseFromModelText(text);

        assertNotNull(r.action());
        assertFalse(r.visibleText().contains("<<<DS_ACTION>>>"));
        assertFalse(r.visibleText().contains("<<<END_DS_ACTION>>>"));
        assertTrue(r.visibleText().contains("Aquí tienes tu dashboard."));
        assertTrue(r.visibleText().contains("Avísame si quieres ajustarlo."));
    }

    @Test
    void variosBloques_retiraTodosYFusionaObjects() {
        // Nova Micro puede emitir un bloque por objeto; no debe perderse ninguno
        // ni filtrarse marcadores al texto visible.
        String text = "Aquí tienes tu dashboard.\n"
                + "<<<DS_ACTION>>>{\"kind\":\"build-sheet\",\"objects\":[{\"type\":\"kpi\",\"title\":\"Ventas\"}]}<<<END_DS_ACTION>>>\n"
                + "Y un gráfico más.\n"
                + "<<<DS_ACTION>>>{\"kind\":\"build-sheet\",\"objects\":[{\"type\":\"bar\",\"title\":\"Por categoría\"}]}<<<END_DS_ACTION>>>\n"
                + "Avísame si quieres ajustarlo.";

        ParseResult r = ActionPlan.parseFromModelText(text);

        assertNotNull(r.action());
        assertFalse(r.visibleText().contains("<<<DS_ACTION>>>"));
        assertFalse(r.visibleText().contains("<<<END_DS_ACTION>>>"));
        assertTrue(r.visibleText().contains("Aquí tienes tu dashboard."));
        assertTrue(r.visibleText().contains("Avísame si quieres ajustarlo."));
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> objects = (List<Map<String, Object>>) r.action().get("objects");
        assertEquals(2, objects.size(), "los objects de ambos bloques deben fusionarse");
    }

    @Test
    void sinBloque_devuelveTextoIntactoYActionNull() {
        String text = "Solo una respuesta en prosa, sin plan de acciones.";

        ParseResult r = ActionPlan.parseFromModelText(text);

        assertEquals(text, r.visibleText());
        assertNull(r.action());
    }

    @Test
    void bloqueConJsonCorrupto_actionNullNoLanza() {
        String text = "Texto.\n<<<DS_ACTION>>>{esto no es json valido]<<<END_DS_ACTION>>>";

        ParseResult r = ActionPlan.parseFromModelText(text);

        assertNull(r.action());
        assertFalse(r.visibleText().contains("<<<DS_ACTION>>>"));
    }

    @Test
    void sanitizeDesign_descartaTipoDesconocidoYCampoInexistente() {
        Set<String> campos = Set.of("Ventas", "Categoria");

        Map<String, Object> obj = new LinkedHashMap<>();
        obj.put("type", "piramide"); // tipo desconocido -> se descarta
        obj.put("dimension", "Categoria");

        Map<String, Object> valido = new LinkedHashMap<>();
        valido.put("type", "bar");
        valido.put("dimension", "NoExiste"); // campo inexistente -> null
        Map<String, Object> measure = new LinkedHashMap<>();
        measure.put("field", "Ventas");
        measure.put("agg", "sum");
        valido.put("measure", measure);

        Map<String, Object> raw = new LinkedHashMap<>();
        raw.put("objects", List.of(obj, valido));

        Map<String, Object> out = ActionPlan.sanitizeDesign(raw, campos);

        assertNotNull(out);
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> objects = (List<Map<String, Object>>) out.get("objects");
        assertEquals(1, objects.size()); // solo el 'bar' sobrevive
        Map<String, Object> only = objects.get(0);
        assertEquals("bar", only.get("type"));
        assertNull(only.get("dimension")); // campo inexistente -> null
        @SuppressWarnings("unchecked")
        Map<String, Object> m = (Map<String, Object>) only.get("measure");
        assertEquals("Ventas", m.get("field"));
    }

    @Test
    void sanitizeDesign_normalizaAggYClavaWMayorQue24() {
        Set<String> campos = Set.of("Ventas", "Categoria");

        Map<String, Object> o = new LinkedHashMap<>();
        o.put("type", "bar");
        o.put("dimension", "Categoria");
        o.put("w", 40); // excede la rejilla de 24
        o.put("h", 6);
        Map<String, Object> measure = new LinkedHashMap<>();
        measure.put("field", "Ventas");
        measure.put("agg", "promedio"); // agg invalida -> sum
        o.put("measure", measure);

        Map<String, Object> raw = new LinkedHashMap<>();
        raw.put("objects", List.of(o));

        Map<String, Object> out = ActionPlan.sanitizeDesign(raw, campos);

        assertNotNull(out);
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> objects = (List<Map<String, Object>>) out.get("objects");
        Map<String, Object> only = objects.get(0);
        @SuppressWarnings("unchecked")
        Map<String, Object> m = (Map<String, Object>) only.get("measure");
        assertEquals("sum", m.get("agg"));
        int w = ((Number) only.get("w")).intValue();
        assertTrue(w <= 24, "w debe clavarse a <=24");
        int x = ((Number) only.get("x")).intValue();
        assertTrue(x + w <= 24, "x+w debe caber en la rejilla de 24");
    }

    @Test
    void sanitizeDesign_noDejaDosObjetosSolapados() {
        Set<String> campos = Set.of("Ventas", "Categoria");

        List<Map<String, Object>> raws = new ArrayList<>();
        for (int i = 0; i < 2; i++) {
            Map<String, Object> o = new LinkedHashMap<>();
            o.put("type", "bar");
            o.put("dimension", "Categoria");
            o.put("x", 0);
            o.put("y", 0);
            o.put("w", 20);
            o.put("h", 6);
            Map<String, Object> measure = new LinkedHashMap<>();
            measure.put("field", "Ventas");
            measure.put("agg", "sum");
            o.put("measure", measure);
            raws.add(o);
        }

        Map<String, Object> raw = new LinkedHashMap<>();
        raw.put("objects", raws);

        Map<String, Object> out = ActionPlan.sanitizeDesign(raw, campos);

        assertNotNull(out);
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> objects = (List<Map<String, Object>>) out.get("objects");
        assertEquals(2, objects.size());
        assertFalse(overlaps(objects.get(0), objects.get(1)), "los dos objetos no deben solaparse");
    }

    private static boolean overlaps(Map<String, Object> a, Map<String, Object> b) {
        int ax = i(a, "x"), ay = i(a, "y"), aw = i(a, "w"), ah = i(a, "h");
        int bx = i(b, "x"), by = i(b, "y"), bw = i(b, "w"), bh = i(b, "h");
        boolean sepX = ax + aw <= bx || bx + bw <= ax;
        boolean sepY = ay + ah <= by || by + bh <= ay;
        return !(sepX || sepY);
    }

    private static int i(Map<String, Object> m, String k) {
        return ((Number) m.get(k)).intValue();
    }
}
