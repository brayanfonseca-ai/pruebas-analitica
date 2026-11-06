package io.datasense.engine.connect;

import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.AwsSessionCredentials;
import software.amazon.awssdk.auth.credentials.AwsCredentialsProvider;
import software.amazon.awssdk.auth.credentials.DefaultCredentialsProvider;
import software.amazon.awssdk.auth.credentials.ProfileCredentialsProvider;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;

import java.util.Map;

/**
 * Utilidades compartidas por los executors de AWS (S3, Athena). Resuelve el
 * {@link AwsCredentialsProvider} igual que {@code BedrockService}:
 * {@link DefaultCredentialsProvider} por defecto (perfiles en {@code ~/.aws}),
 * {@link StaticCredentialsProvider} SOLO si {@code authType=='iam'} y hay claves
 * explícitas, o {@link ProfileCredentialsProvider} si se indica un perfil.
 * NUNCA se hardcodean ni se registran claves.
 */
final class AwsSupport {

    private AwsSupport() {}

    static AwsCredentialsProvider credentials(Map<String, Object> config) {
        String authType = str(config.get("authType"));
        String accessKeyId = str(config.get("accessKeyId"));
        String secretKey = str(config.get("secretKey"));
        String sessionToken = str(config.get("sessionToken"));
        if ("iam".equalsIgnoreCase(authType) && !accessKeyId.isBlank() && !secretKey.isBlank()) {
            if (!sessionToken.isBlank()) {
                return StaticCredentialsProvider.create(
                        AwsSessionCredentials.create(accessKeyId, secretKey, sessionToken));
            }
            return StaticCredentialsProvider.create(AwsBasicCredentials.create(accessKeyId, secretKey));
        }
        String profile = str(config.get("profile"));
        if (!profile.isBlank() && !"default".equalsIgnoreCase(profile)) {
            return ProfileCredentialsProvider.create(profile);
        }
        return DefaultCredentialsProvider.create();
    }

    /** Región del config con fallback a us-east-2 (región probada de la cuenta). */
    static String region(Map<String, Object> config) {
        String r = str(config.get("awsRegion"));
        if (r.isBlank()) r = str(config.get("region"));
        return r.isBlank() ? "us-east-2" : r;
    }

    static String str(Object o) {
        return o == null ? "" : String.valueOf(o);
    }
}
