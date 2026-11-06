package io.datasense.engine.connect;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import io.datasense.engine.DataFrame;
import io.datasense.engine.TableReader;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;

/**
 * Conector REAL para 'webfile' (descarga de un archivo CSV/Excel por URL) y
 * 'rest' (GET a una API, con cabecera de autorización opcional) usando
 * {@link HttpClient}. {@code test()} hace un GET y valida 2xx; {@code load()}
 * descarga y, según el tipo, lo parsea con {@link TableReader} (CSV/Excel) o
 * aplana un array JSON de objetos a filas.
 */
public class HttpExecutor implements ConnectionExecutor {

    private final String connector;
    private final ObjectMapper mapper = new ObjectMapper();

    public HttpExecutor(String connector) {
        this.connector = connector;
    }

    @Override
    public String type() {
        return connector;
    }

    private HttpClient client() {
        return HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();
    }

    private HttpRequest buildRequest(Map<String, Object> config) {
        String url = AwsSupport.str(config.get("url"));
        if (url.isBlank()) throw new IllegalArgumentException("Falta la URL.");
        HttpRequest.Builder b = HttpRequest.newBuilder()
                .uri(URI.create(url))
                .timeout(Duration.ofSeconds(30))
                .GET();
        String authHeader = AwsSupport.str(config.get("authHeader"));
        if (!authHeader.isBlank()) b.header("Authorization", authHeader);
        return b.build();
    }

    @Override
    public ExecResult test(Map<String, Object> config) {
        String url = AwsSupport.str(config.get("url"));
        if (url.isBlank()) return ExecResult.fail("Falta la URL.");
        try {
            HttpResponse<Void> resp = client().send(buildRequest(config), HttpResponse.BodyHandlers.discarding());
            int code = resp.statusCode();
            if (code >= 200 && code < 300) {
                return ExecResult.ok("URL accesible (HTTP " + code + ").");
            }
            return ExecResult.fail("La URL respondió HTTP " + code + ".");
        } catch (Exception e) {
            return ExecResult.fail("Error HTTP (" + connector + "): " + S3Executor.awsMessage(e));
        }
    }

    @Override
    public DataFrame load(Map<String, Object> config, Map<String, Object> params) throws Exception {
        String url = AwsSupport.str(config.get("url"));
        if (url.isBlank()) throw new IllegalArgumentException("Falta la URL.");
        HttpResponse<byte[]> resp = client().send(buildRequest(config), HttpResponse.BodyHandlers.ofByteArray());
        int code = resp.statusCode();
        if (code < 200 || code >= 300) {
            throw new IllegalStateException("La URL respondió HTTP " + code + ".");
        }
        byte[] body = resp.body();
        String contentType = resp.headers().firstValue("content-type").orElse("").toLowerCase();
        String lower = url.toLowerCase();

        if (lower.endsWith(".csv") || contentType.contains("csv")) {
            return TableReader.read(body, "download.csv");
        }
        if (lower.endsWith(".xlsx") || contentType.contains("spreadsheetml")) {
            return TableReader.read(body, "download.xlsx");
        }
        if (lower.endsWith(".json") || contentType.contains("json") || "rest".equals(connector)) {
            return parseJson(body);
        }
        // Último intento: tratar como CSV.
        return TableReader.read(body, "download.csv");
    }

    /** Aplana un array JSON de objetos a filas (claves = columnas). */
    private DataFrame parseJson(byte[] body) throws Exception {
        JsonNode root = mapper.readTree(body);
        JsonNode array = root;
        if (root.isObject()) {
            // Busca el primer array dentro del objeto (p.ej. {"data":[...]}).
            JsonNode found = null;
            var it = root.fields();
            while (it.hasNext()) {
                var e = it.next();
                if (e.getValue().isArray()) { found = e.getValue(); break; }
            }
            if (found == null) {
                throw new IllegalStateException("La respuesta JSON no contiene un array de objetos para tabular.");
            }
            array = found;
        }
        if (!array.isArray()) {
            throw new IllegalStateException("La respuesta JSON no es un array de objetos.");
        }
        LinkedHashSet<String> columns = new LinkedHashSet<>();
        for (JsonNode el : array) {
            if (el.isObject()) el.fieldNames().forEachRemaining(columns::add);
        }
        List<String> cols = new ArrayList<>(columns);
        List<List<String>> rows = new ArrayList<>();
        for (JsonNode el : array) {
            List<String> row = new ArrayList<>(cols.size());
            for (String c : cols) {
                JsonNode v = el.get(c);
                row.add(v == null || v.isNull() ? null : (v.isValueNode() ? v.asText() : v.toString()));
            }
            rows.add(row);
        }
        return new DataFrame(cols, rows);
    }
}
