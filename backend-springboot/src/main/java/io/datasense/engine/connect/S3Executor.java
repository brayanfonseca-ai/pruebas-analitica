package io.datasense.engine.connect;

import io.datasense.engine.DataFrame;
import io.datasense.engine.TableReader;

import org.springframework.stereotype.Component;

import software.amazon.awssdk.core.ResponseBytes;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;
import software.amazon.awssdk.services.s3.model.GetObjectResponse;
import software.amazon.awssdk.services.s3.model.HeadBucketRequest;
import software.amazon.awssdk.services.s3.model.ListObjectsV2Request;
import software.amazon.awssdk.services.s3.model.ListObjectsV2Response;
import software.amazon.awssdk.services.s3.model.S3Object;

import java.util.Map;

/**
 * Conector REAL a Amazon S3 (AWS SDK v2). {@code test()} hace HeadBucket (o
 * ListObjectsV2 maxKeys=1) sobre el bucket; {@code load()} hace GetObject del
 * objeto indicado (o del primer CSV/.xlsx bajo el prefijo) y lo parsea con
 * {@link TableReader}. Cliente construido de forma perezosa por invocación.
 */
@Component
public class S3Executor implements ConnectionExecutor {

    @Override
    public String type() {
        return "s3";
    }

    private S3Client client(Map<String, Object> config) {
        return S3Client.builder()
                .region(Region.of(AwsSupport.region(config)))
                .credentialsProvider(AwsSupport.credentials(config))
                .build();
    }

    @Override
    public ExecResult test(Map<String, Object> config) {
        String bucket = AwsSupport.str(config.get("bucket"));
        if (bucket.isBlank()) return ExecResult.fail("Falta el bucket de S3.");
        try (S3Client s3 = client(config)) {
            s3.headBucket(HeadBucketRequest.builder().bucket(bucket).build());
            String prefix = AwsSupport.str(config.get("prefix"));
            ListObjectsV2Request.Builder lb = ListObjectsV2Request.builder().bucket(bucket).maxKeys(1);
            if (!prefix.isBlank()) lb.prefix(prefix);
            ListObjectsV2Response ls = s3.listObjectsV2(lb.build());
            int count = ls.keyCount() == null ? 0 : ls.keyCount();
            String sample = ls.contents().isEmpty() ? "(vacío)" : ls.contents().get(0).key();
            return ExecResult.ok("Conexión S3 correcta: bucket '" + bucket + "' accesible. Objetos encontrados: "
                    + count + (count > 0 ? " (ej. " + sample + ")" : ""),
                    Map.of("bucket", bucket, "objectCount", count));
        } catch (Exception e) {
            return ExecResult.fail(awsMessage(e));
        }
    }

    @Override
    public DataFrame load(Map<String, Object> config, Map<String, Object> params) throws Exception {
        String bucket = AwsSupport.str(config.get("bucket"));
        if (bucket.isBlank()) throw new IllegalArgumentException("Falta el bucket de S3.");
        Map<String, Object> p = params == null ? Map.of() : params;
        String key = AwsSupport.str(p.get("key"));
        if (key.isBlank()) key = AwsSupport.str(p.get("object"));

        try (S3Client s3 = client(config)) {
            if (key.isBlank()) {
                // Buscar el primer objeto CSV/.xlsx bajo el prefijo configurado.
                String prefix = AwsSupport.str(config.get("prefix"));
                ListObjectsV2Request.Builder lb = ListObjectsV2Request.builder().bucket(bucket).maxKeys(1000);
                if (!prefix.isBlank()) lb.prefix(prefix);
                ListObjectsV2Response ls = s3.listObjectsV2(lb.build());
                for (S3Object o : ls.contents()) {
                    String k = o.key().toLowerCase();
                    if (k.endsWith(".csv") || k.endsWith(".xlsx")) { key = o.key(); break; }
                }
                if (key.isBlank()) {
                    throw new IllegalStateException("No se encontró ningún objeto CSV/.xlsx en s3://"
                            + bucket + "/" + prefix + ". Indica 'key' en los parámetros de carga.");
                }
            }
            String lower = key.toLowerCase();
            if (lower.endsWith(".parquet")) {
                throw new IllegalStateException("Parquet pendiente; usa CSV/Excel (objeto: " + key + ").");
            }
            if (!lower.endsWith(".csv") && !lower.endsWith(".xlsx")) {
                throw new IllegalStateException("Formato no soportado para '" + key + "'. Usa CSV o .xlsx.");
            }
            ResponseBytes<GetObjectResponse> bytes = s3.getObjectAsBytes(
                    GetObjectRequest.builder().bucket(bucket).key(key).build());
            return TableReader.read(bytes.asByteArray(), key);
        }
    }

    /** Lista los objetos CSV/.xlsx del bucket bajo el prefijo (config o params); máx. 1000. */
    @Override
    public Map<String, Object> browse(Map<String, Object> config, Map<String, Object> params) {
        String bucket = AwsSupport.str(config.get("bucket"));
        if (bucket.isBlank()) throw new IllegalArgumentException("Falta el bucket de S3.");
        Map<String, Object> p = params == null ? Map.of() : params;
        String prefix = AwsSupport.str(p.get("prefix"));
        if (prefix.isBlank()) prefix = AwsSupport.str(config.get("prefix"));
        try (S3Client s3 = client(config)) {
            java.util.List<Map<String, Object>> items = new java.util.ArrayList<>();
            String token = null;
            do {
                ListObjectsV2Request.Builder lb = ListObjectsV2Request.builder().bucket(bucket).maxKeys(1000);
                if (!prefix.isBlank()) lb.prefix(prefix);
                if (token != null) lb.continuationToken(token);
                ListObjectsV2Response ls = s3.listObjectsV2(lb.build());
                for (S3Object o : ls.contents()) {
                    String k = o.key().toLowerCase();
                    if (!(k.endsWith(".csv") || k.endsWith(".xlsx"))) continue;
                    Map<String, Object> it = new java.util.LinkedHashMap<>();
                    it.put("name", o.key());
                    it.put("type", k.endsWith(".csv") ? "CSV" : "Excel");
                    it.put("size", o.size());
                    items.add(it);
                }
                token = Boolean.TRUE.equals(ls.isTruncated()) ? ls.nextContinuationToken() : null;
            } while (token != null && items.size() < 1000);
            return Map.of("level", "objects", "bucket", bucket, "items", items);
        }
    }

    /** Mensaje real de AWS: usa el detail message del SDK (NoSuchBucket/AccessDenied/region…). */
    static String awsMessage(Exception e) {
        String m = e.getMessage();
        return (m == null || m.isBlank()) ? e.getClass().getSimpleName() : m;
    }
}
