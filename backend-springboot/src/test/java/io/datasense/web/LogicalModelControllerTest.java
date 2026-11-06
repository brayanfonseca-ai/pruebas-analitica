package io.datasense.web;

import io.datasense.engine.DataFrame;
import io.datasense.engine.LogicalModelService;
import io.datasense.model.AppModels.AppOut;
import io.datasense.repo.AppRepository;
import io.datasense.repo.FieldOverrideRepository;
import io.datasense.repo.LogicalModelRepository;
import io.datasense.repo.TableRepository;
import io.datasense.engine.TableStore;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@WebMvcTest(LogicalModelController.class)
@Import(LogicalModelService.class)
class LogicalModelControllerTest {

    @Autowired MockMvc mvc;
    @MockBean AppRepository apps;
    @MockBean TableRepository tables;
    @MockBean TableStore store;
    @MockBean FieldOverrideRepository fieldOverrides;
    @MockBean LogicalModelRepository models;

    @BeforeEach
    void stub() {
        when(apps.getApp("app1")).thenReturn(Optional.of(new AppOut("app1", "App", "2024-01-01")));
        when(apps.getApp("nope")).thenReturn(Optional.empty());

        when(tables.listTables("app1")).thenReturn(List.of(
                Map.of("id", "t1", "name", "ventas")));
        when(fieldOverrides.list("app1", "t1")).thenReturn(List.of());
        DataFrame df = new DataFrame(
                List.of("Region", "Ventas", "Mes"),
                List.of(
                        List.of("Norte", "100", "2024-01-01"),
                        List.of("Sur", "200", "2024-02-01")));
        when(store.load("app1", "t1")).thenReturn(df);

        when(models.getDocJson("app1")).thenReturn(Optional.empty());
        when(models.isEnabled("app1")).thenReturn(true);
    }

    @Test
    void getSinGuardadoDevuelveDefault() throws Exception {
        mvc.perform(get("/api/v1/apps/app1/logical-model"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.enabled").value(true))
                .andExpect(jsonPath("$.fields[0].field").value("Region"))
                .andExpect(jsonPath("$.fields[0].classification").value("dimension"))
                .andExpect(jsonPath("$.fields[1].classification").value("measure"))
                .andExpect(jsonPath("$.fields[1].defaultAggregation").value("sum"))
                .andExpect(jsonPath("$.summary.fieldsVisible").value(3));
    }

    @Test
    void appInexistente_404() throws Exception {
        mvc.perform(get("/api/v1/apps/nope/logical-model"))
                .andExpect(status().isNotFound());
    }

    @Test
    void putClassificationInvalida_400() throws Exception {
        String body = "{\"fields\":[{\"table\":\"ventas\",\"field\":\"Region\",\"classification\":\"bogus\"}]}";
        mvc.perform(put("/api/v1/apps/app1/logical-model")
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isBadRequest());

        verify(models, never()).upsert(any(), any(), anyBoolean());
    }

    @Test
    void putValido_200YUpsert() throws Exception {
        String body = "{\"enabled\":true,\"fields\":[{\"table\":\"ventas\",\"field\":\"Region\","
                + "\"classification\":\"dimension\",\"visibility\":\"visible\",\"defaultAggregation\":\"none\"}]}";
        mvc.perform(put("/api/v1/apps/app1/logical-model")
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isOk());

        verify(models).upsert(eq("app1"), anyString(), anyBoolean());
    }

    @Test
    void reset_200() throws Exception {
        mvc.perform(post("/api/v1/apps/app1/logical-model/reset"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.fields[0].field").value("Region"));
        verify(models).upsert(eq("app1"), anyString(), anyBoolean());
    }

    @Test
    void enableYDisable_200() throws Exception {
        mvc.perform(post("/api/v1/apps/app1/logical-model/enable"))
                .andExpect(status().isOk());
        verify(models).setEnabled("app1", true);

        mvc.perform(post("/api/v1/apps/app1/logical-model/disable"))
                .andExpect(status().isOk());
        verify(models).setEnabled("app1", false);
    }

    @Test
    void calendarPeriodSinCampoFecha_400() throws Exception {
        // Tabla solo con texto y número: sin campos 'date'.
        DataFrame df = new DataFrame(
                List.of("Region", "Ventas"),
                List.of(List.of("Norte", "100")));
        when(store.load("app1", "t1")).thenReturn(df);

        String body = "{\"name\":\"YTD\"}";
        mvc.perform(post("/api/v1/apps/app1/logical-model/calendar-periods")
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isBadRequest());
    }

    @Test
    void addGroup_200() throws Exception {
        String body = "{\"type\":\"measure\",\"fields\":[\"Ventas\"],\"name\":\"KPIs\"}";
        mvc.perform(post("/api/v1/apps/app1/logical-model/groups")
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isOk());
        verify(models).upsert(eq("app1"), anyString(), anyBoolean());
    }
}
