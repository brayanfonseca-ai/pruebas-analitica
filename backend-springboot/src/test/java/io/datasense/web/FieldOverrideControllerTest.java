package io.datasense.web;

import io.datasense.model.AppModels.AppOut;
import io.datasense.repo.AppRepository;
import io.datasense.repo.FieldOverrideRepository;

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

@WebMvcTest(FieldOverrideController.class)
class FieldOverrideControllerTest {

    @Autowired MockMvc mvc;
    @MockBean AppRepository apps;
    @MockBean FieldOverrideRepository overrides;

    @BeforeEach
    void stubApp() {
        when(apps.getApp("app1")).thenReturn(Optional.of(new AppOut("app1", "App", "2024-01-01")));
    }

    @Test
    void getDevuelveLista() throws Exception {
        when(overrides.list("app1", "t1")).thenReturn(List.of(
                Map.of("source_field", "ciudad", "rename", "Ciudad", "forced_type", "text", "hidden", false)));

        mvc.perform(get("/api/v1/apps/app1/tables/t1/field-overrides"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].source_field").value("ciudad"))
                .andExpect(jsonPath("$[0].rename").value("Ciudad"));
    }

    @Test
    void putUpsertYDevuelveLista() throws Exception {
        when(overrides.list("app1", "t1")).thenReturn(List.of(
                Map.of("source_field", "ciudad", "rename", "Ciudad", "forced_type", "number", "hidden", true)));

        String body = "[{\"source_field\":\"ciudad\",\"rename\":\"Ciudad\",\"forced_type\":\"number\",\"hidden\":true}]";
        mvc.perform(put("/api/v1/apps/app1/tables/t1/field-overrides")
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].source_field").value("ciudad"));

        verify(overrides).upsert(eq("app1"), eq("t1"), eq("ciudad"), eq("Ciudad"), eq("number"), eq(true));
    }

    @Test
    void putForcedTypeInvalido_400() throws Exception {
        String body = "[{\"source_field\":\"ciudad\",\"forced_type\":\"boolean\"}]";
        mvc.perform(put("/api/v1/apps/app1/tables/t1/field-overrides")
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isBadRequest());

        verify(overrides, never()).upsert(any(), any(), any(), any(), any(), anyBoolean());
    }

    @Test
    void putSourceFieldVacio_400() throws Exception {
        String body = "[{\"source_field\":\"\",\"rename\":\"X\"}]";
        mvc.perform(put("/api/v1/apps/app1/tables/t1/field-overrides")
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isBadRequest());
    }
}
