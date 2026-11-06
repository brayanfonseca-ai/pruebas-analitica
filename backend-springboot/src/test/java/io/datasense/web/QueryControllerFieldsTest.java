package io.datasense.web;

import io.datasense.engine.DataFrame;
import io.datasense.engine.TableStore;
import io.datasense.model.AppModels.AppOut;
import io.datasense.repo.AppRepository;
import io.datasense.repo.FieldOverrideRepository;
import io.datasense.repo.TableRepository;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Integración web de {@code /fields} y {@code /query} con la capa de field
 * overrides: rename (identidad física + display), forced-type (rol
 * dimensión/medida), hidden (fuera del catálogo) y no-500 ante agregación
 * imposible (degrada a count).
 */
@WebMvcTest(QueryController.class)
class QueryControllerFieldsTest {

    @Autowired MockMvc mvc;
    @MockBean AppRepository apps;
    @MockBean TableRepository tables;
    @MockBean TableStore store;
    @MockBean FieldOverrideRepository overrides;

    private DataFrame ventasFrame() {
        // Region (text), Ventas (number), Mes (text)
        return new DataFrame(
                List.of("Region", "Ventas", "Mes"),
                List.of(
                        List.of("Norte", "100", "Enero"),
                        List.of("Sur", "87", "Febrero"),
                        List.of("Este", "13", "Marzo")));
    }

    @BeforeEach
    void stub() {
        when(apps.getApp("app1")).thenReturn(Optional.of(new AppOut("app1", "App", "2024-01-01")));
        when(tables.listTables("app1")).thenReturn(List.of(
                Map.of("id", "t1", "name", "datos_demo_ventas")));
        when(store.load("app1", "t1")).thenReturn(ventasFrame());
    }

    @Test
    void fields_sinOverrides_clasificaPorTipoInferido() throws Exception {
        when(overrides.list("app1", "t1")).thenReturn(List.of());

        mvc.perform(get("/api/v1/apps/app1/fields"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.measures[?(@.field=='Ventas')].display").value("Ventas"))
                .andExpect(jsonPath("$.dimensions[?(@.field=='Region')].type").value("text"));
    }

    @Test
    void fields_rename_devuelveIdentidadFisicaYDisplay() throws Exception {
        when(overrides.list("app1", "t1")).thenReturn(List.of(
                Map.of("source_field", "Ventas", "rename", "Ingresos", "forced_type", "", "hidden", false)));

        mvc.perform(get("/api/v1/apps/app1/fields"))
                .andExpect(status().isOk())
                // identidad estable = columna física; display = rename
                .andExpect(jsonPath("$.measures[?(@.field=='Ventas')].display").value("Ingresos"))
                .andExpect(jsonPath("$.measures[?(@.field=='Ingresos')]").doesNotExist());
    }

    @Test
    void fields_forcedTypeTextMueveCampoADimension() throws Exception {
        when(overrides.list("app1", "t1")).thenReturn(List.of(
                Map.of("source_field", "Ventas", "forced_type", "text", "hidden", false)));

        mvc.perform(get("/api/v1/apps/app1/fields"))
                .andExpect(status().isOk())
                // Ya no es medida: aparece en dimensiones
                .andExpect(jsonPath("$.dimensions[?(@.field=='Ventas')].type").value("text"))
                .andExpect(jsonPath("$.measures[?(@.field=='Ventas')]").doesNotExist());
    }

    @Test
    void fields_hiddenExcluyeDelCatalogo() throws Exception {
        when(overrides.list("app1", "t1")).thenReturn(List.of(
                Map.of("source_field", "Mes", "hidden", true)));

        mvc.perform(get("/api/v1/apps/app1/fields"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.dimensions[?(@.field=='Mes')]").doesNotExist())
                .andExpect(jsonPath("$.measures[?(@.field=='Mes')]").doesNotExist());
    }

    @Test
    void query_sumSobreVentas_devuelveTotalFisico() throws Exception {
        when(overrides.list("app1", "t1")).thenReturn(List.of());
        String body = "{\"measures\":[{\"table\":\"datos_demo_ventas\",\"field\":\"Ventas\",\"agg\":\"sum\"}]}";

        mvc.perform(post("/api/v1/apps/app1/query")
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.value").value(200.0)); // 100+87+13
    }

    @Test
    void query_sumSobreCampoForzadoATexto_degradaACount_sin500() throws Exception {
        when(overrides.list("app1", "t1")).thenReturn(List.of(
                Map.of("source_field", "Ventas", "forced_type", "text", "hidden", false)));
        String body = "{\"measures\":[{\"table\":\"datos_demo_ventas\",\"field\":\"Ventas\",\"agg\":\"sum\"}]}";

        mvc.perform(post("/api/v1/apps/app1/query")
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isOk())            // nunca 500
                .andExpect(jsonPath("$.value").value(3.0)); // count de 3 filas, no la suma
    }
}
