package io.datasense.ai;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import software.amazon.awssdk.auth.credentials.DefaultCredentialsProvider;
import software.amazon.awssdk.auth.credentials.ProfileCredentialsProvider;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.bedrockruntime.BedrockRuntimeClient;
import software.amazon.awssdk.services.bedrockruntime.model.ContentBlock;
import software.amazon.awssdk.services.bedrockruntime.model.ConversationRole;
import software.amazon.awssdk.services.bedrockruntime.model.ConverseResponse;
import software.amazon.awssdk.services.bedrockruntime.model.InferenceConfiguration;
import software.amazon.awssdk.services.bedrockruntime.model.Message;
import software.amazon.awssdk.services.bedrockruntime.model.SystemContentBlock;

/**
 * Puente hacia Amazon Bedrock para el asistente de IA ("estrellita"). Invoca
 * Nova Micro a través de la API Converse usando el inference profile
 * {@code us.amazon.nova-micro-v1:0} en us-east-2.
 *
 * <p>La autenticación usa {@link DefaultCredentialsProvider} (perfiles en
 * {@code ~/.aws}); NUNCA se hardcodean claves. Si {@code datasense.ai.profile}
 * no es "default" se usa {@link ProfileCredentialsProvider}.
 *
 * <p>El cliente se construye de forma perezosa y TODA invocación está envuelta
 * en try/catch: cualquier fallo (credenciales, red, Bedrock, validación) se
 * degrada a un {@link AiResult} con {@code ok=false} en lugar de propagar, de
 * modo que el controlador nunca devuelva 5xx.
 */
@Service
public class BedrockService {

    private static final Logger log = LoggerFactory.getLogger(BedrockService.class);

    @Value("${datasense.ai.region}")
    private String region;

    @Value("${datasense.ai.model-id}")
    private String modelId;

    @Value("${datasense.ai.profile}")
    private String profile;

    @Value("${datasense.ai.agent-name}")
    private String agentName;

    @Value("${datasense.ai.max-tokens}")
    private int maxTokens;

    private volatile BedrockRuntimeClient client;

    /** Resultado de una invocación: ok indica éxito; text el contenido o el mensaje de error. */
    public record AiResult(boolean ok, String text, String message) {
        public static AiResult success(String text) {
            return new AiResult(true, text, null);
        }

        public static AiResult error(String message) {
            return new AiResult(false, "", message);
        }
    }

    public String getAgentName() {
        return agentName;
    }

    public String getModelId() {
        return modelId;
    }

    public String getRegion() {
        return region;
    }

    /** Construye el cliente de forma perezosa (double-checked locking). */
    private BedrockRuntimeClient client() {
        BedrockRuntimeClient c = client;
        if (c == null) {
            synchronized (this) {
                c = client;
                if (c == null) {
                    var builder = BedrockRuntimeClient.builder().region(Region.of(region));
                    if (profile != null && !profile.isBlank() && !"default".equals(profile)) {
                        builder.credentialsProvider(ProfileCredentialsProvider.create(profile));
                    } else {
                        builder.credentialsProvider(DefaultCredentialsProvider.create());
                    }
                    c = builder.build();
                    client = c;
                }
            }
        }
        return c;
    }

    /**
     * Invoca Nova Micro vía Converse. Devuelve el texto concatenado de la
     * respuesta. Ante cualquier error devuelve un {@link AiResult} con ok=false.
     */
    public AiResult converse(String systemPrompt, String userPrompt) {
        try {
            Message userMessage = Message.builder()
                    .role(ConversationRole.USER)
                    .content(ContentBlock.fromText(userPrompt == null ? "" : userPrompt))
                    .build();

            InferenceConfiguration inference = InferenceConfiguration.builder()
                    .maxTokens(maxTokens)
                    .temperature(0.4f)
                    .build();

            ConverseResponse response = client().converse(req -> req
                    .modelId(modelId)
                    .messages(userMessage)
                    .system(SystemContentBlock.fromText(systemPrompt == null ? "" : systemPrompt))
                    .inferenceConfig(inference));

            StringBuilder sb = new StringBuilder();
            if (response.output() != null
                    && response.output().message() != null
                    && response.output().message().content() != null) {
                for (ContentBlock block : response.output().message().content()) {
                    if (block.text() != null) sb.append(block.text());
                }
            }

            String text = sb.toString().trim();
            if (text.isEmpty()) {
                return AiResult.error("El modelo no devolvió contenido.");
            }
            return AiResult.success(text);
        } catch (Exception e) {
            log.error("Fallo al invocar Bedrock ({}): {}", modelId, e.getMessage(), e);
            return AiResult.error("No se pudo contactar al asistente de IA: " + e.getMessage());
        }
    }
}
