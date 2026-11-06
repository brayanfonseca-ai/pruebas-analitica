package io.datasense.web;

import io.datasense.ai.BedrockService;
import io.datasense.ai.BedrockService.AiResult;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Verifica el contrato del asistente de IA sin llamar a Bedrock real:
 * el BedrockService está mockeado. El foco es que el controlador NUNCA
 * devuelva 5xx y siempre responda {ok, message, agent}.
 */
@WebMvcTest(AiController.class)
class AiControllerTest {

    @Autowired
    private MockMvc mvc;

    @MockBean
    private BedrockService bedrock;

    @Test
    void modelar_devuelveOkYTextoCuandoBedrockResponde() throws Exception {
        when(bedrock.getAgentName()).thenReturn("prueba");
        when(bedrock.converse(any(), any())).thenReturn(AiResult.success("Modelo en estrella propuesto."));

        mvc.perform(post("/api/v1/ai/modelar")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"tables\":[{\"name\":\"ventas\"}]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ok").value(true))
                .andExpect(jsonPath("$.message").value("Modelo en estrella propuesto."))
                .andExpect(jsonPath("$.agent").value("prueba"));
    }

    @Test
    void modelar_degradaA200CuandoBedrockFalla() throws Exception {
        when(bedrock.getAgentName()).thenReturn("prueba");
        when(bedrock.converse(any(), any()))
                .thenReturn(AiResult.error("No se pudo contactar al asistente de IA."));

        mvc.perform(post("/api/v1/ai/modelar")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"tables\":[]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ok").value(false))
                .andExpect(jsonPath("$.message").value("No se pudo contactar al asistente de IA."));
    }

    @Test
    void analizar_sinPreguntaDevuelve200OkFalse() throws Exception {
        when(bedrock.getAgentName()).thenReturn("prueba");

        mvc.perform(post("/api/v1/ai/analizar")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"kpis\":[]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ok").value(false));
    }

    @Test
    void disenar_conBloqueDevuelveActionYMessageSinMarcador() throws Exception {
        when(bedrock.getAgentName()).thenReturn("prueba");
        when(bedrock.converse(any(), any())).thenReturn(AiResult.success(
                "Aquí tienes tu dashboard.\n"
                        + "<<<DS_ACTION>>>{\"kind\":\"build-sheet\",\"objects\":["
                        + "{\"type\":\"kpi\",\"title\":\"Ventas\",\"measure\":{\"field\":\"Ventas\",\"agg\":\"sum\"}}]}"
                        + "<<<END_DS_ACTION>>>"));

        mvc.perform(post("/api/v1/ai/disenar")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"contexto\":{\"campos\":[{\"name\":\"Ventas\",\"type\":\"number\"}]}}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ok").value(true))
                .andExpect(jsonPath("$.action").exists())
                .andExpect(jsonPath("$.action.kind").value("build-sheet"))
                .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.not(
                        org.hamcrest.Matchers.containsString("<<<DS_ACTION>>>"))));
    }

    @Test
    void disenar_sinBloqueDevuelveActionNull() throws Exception {
        when(bedrock.getAgentName()).thenReturn("prueba");
        when(bedrock.converse(any(), any()))
                .thenReturn(AiResult.success("Te propongo empezar por un KPI de ventas."));

        mvc.perform(post("/api/v1/ai/disenar")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"contexto\":{\"campos\":[{\"name\":\"Ventas\"}]}}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ok").value(true))
                .andExpect(jsonPath("$.action").value(org.hamcrest.Matchers.nullValue()));
    }

    @Test
    void health_devuelveOkSinLlamarBedrock() throws Exception {
        when(bedrock.getAgentName()).thenReturn("prueba");
        when(bedrock.getModelId()).thenReturn("us.amazon.nova-micro-v1:0");
        when(bedrock.getRegion()).thenReturn("us-east-2");

        mvc.perform(get("/api/v1/ai/health"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ok").value(true))
                .andExpect(jsonPath("$.agent").value("prueba"));
    }
}
