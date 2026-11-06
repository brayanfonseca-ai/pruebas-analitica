package io.datasense.web;

import io.datasense.engine.DataFrame;
import io.datasense.engine.TableStore;
import io.datasense.engine.connect.ConnectionExecutor;
import io.datasense.engine.connect.ConnectionExecutors;
import io.datasense.model.AppModels.AppOut;
import io.datasense.repo.AppRepository;
import io.datasense.repo.ConnectionRepository;
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

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Pruebas del contrato de {@code ConnectionController}: /test y /load NUNCA
 * devuelven 500 y /load materializa vía createTable/save. No toca AWS/JDBC real
 * (executors mockeados).
 */
@WebMvcTest(ConnectionController.class)
class ConnectionControllerTest {

    @Autowired
    private MockMvc mvc;

    @MockBean
    private AppRepository apps;
    @MockBean
    private ConnectionRepository repo;
    @MockBean
    private ConnectionExecutors executors;
    @MockBean
    private TableRepository tables;
    @MockBean
    private TableStore store;

    private static final String APP = "app-1";

    @BeforeEach
    void setup() {
        when(apps.getApp(APP)).thenReturn(Optional.of(new AppOut(APP, "App", "2024-01-01")));
    }

    @Test
    void testMissingFieldsReturnsOkFalseWithoutExecutor() throws Exception {
        mvc.perform(post("/api/v1/apps/{appId}/connections/test", APP)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"connector\":\"s3\",\"config\":{}}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ok").value(false));
        verify(executors, never()).get(anyString());
    }

    @Test
    void testExecutorFailureReturnsOkFalseNever500() throws Exception {
        ConnectionExecutor exec = org.mockito.Mockito.mock(ConnectionExecutor.class);
        when(exec.test(any())).thenThrow(new RuntimeException("boom"));
        when(executors.get("s3")).thenReturn(exec);

        mvc.perform(post("/api/v1/apps/{appId}/connections/test", APP)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"connector\":\"s3\",\"config\":{\"bucket\":\"b\",\"awsRegion\":\"us-east-2\"}}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ok").value(false));
    }

    @Test
    void testExecutorOkReturnsOkTrue() throws Exception {
        ConnectionExecutor exec = org.mockito.Mockito.mock(ConnectionExecutor.class);
        when(exec.test(any())).thenReturn(ConnectionExecutor.ExecResult.ok("conectado"));
        when(executors.get("s3")).thenReturn(exec);

        mvc.perform(post("/api/v1/apps/{appId}/connections/test", APP)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"connector\":\"s3\",\"config\":{\"bucket\":\"b\",\"awsRegion\":\"us-east-2\"}}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ok").value(true));
    }

    @Test
    void loadMaterializesTableViaCreateTableAndSave() throws Exception {
        ConnectionExecutor exec = org.mockito.Mockito.mock(ConnectionExecutor.class);
        DataFrame df = new DataFrame(List.of("a", "b"), List.of(List.of("1", "x"), List.of("2", "y")));
        when(exec.load(any(), any())).thenReturn(df);
        when(executors.get("s3")).thenReturn(exec);
        when(repo.getRaw("c-1")).thenReturn(Optional.of(Map.of(
                "id", "c-1", "app_id", APP, "connector", "s3", "name", "conn",
                "config", Map.of("bucket", "b"))));
        when(tables.createTable(eq(APP), anyString(), anyString(), any()))
                .thenReturn(Map.of("id", "t-1"));

        mvc.perform(post("/api/v1/apps/{appId}/connections/{connId}/load", APP, "c-1")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"tableName\":\"ventas\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ok").value(true))
                .andExpect(jsonPath("$.table.id").value("t-1"));

        verify(tables).createTable(eq(APP), eq("ventas"), eq("conn:s3"), any());
        verify(store).save(eq(APP), eq("t-1"), any(DataFrame.class));
    }

    @Test
    void loadExecutorThrowsReturnsOkFalseNever500() throws Exception {
        ConnectionExecutor exec = org.mockito.Mockito.mock(ConnectionExecutor.class);
        when(exec.load(any(), any())).thenThrow(new RuntimeException("NoSuchBucket"));
        when(executors.get("s3")).thenReturn(exec);
        when(repo.getRaw("c-1")).thenReturn(Optional.of(Map.of(
                "id", "c-1", "app_id", APP, "connector", "s3", "name", "conn",
                "config", Map.of("bucket", "b"))));

        mvc.perform(post("/api/v1/apps/{appId}/connections/{connId}/load", APP, "c-1")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ok").value(false));
        verify(tables, never()).createTable(anyString(), anyString(), anyString(), any());
    }
}
