package io.datasense.engine.connect;

import io.datasense.engine.DataFrame;

import org.springframework.stereotype.Component;

import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.athena.AthenaClient;
import software.amazon.awssdk.services.athena.model.ColumnInfo;
import software.amazon.awssdk.services.athena.model.Datum;
import software.amazon.awssdk.services.athena.model.GetQueryExecutionRequest;
import software.amazon.awssdk.services.athena.model.GetQueryExecutionResponse;
import software.amazon.awssdk.services.athena.model.GetQueryResultsRequest;
import software.amazon.awssdk.services.athena.model.GetQueryResultsResponse;
import software.amazon.awssdk.services.athena.model.QueryExecutionContext;
import software.amazon.awssdk.services.athena.model.QueryExecutionState;
import software.amazon.awssdk.services.athena.model.ResultConfiguration;
import software.amazon.awssdk.services.athena.model.Row;
import software.amazon.awssdk.services.athena.model.StartQueryExecutionRequest;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Conector REAL a Amazon Athena (AWS SDK v2). {@code test()} ejecuta
 * 'SELECT 1' (StartQueryExecution + polling de GetQueryExecution) para validar
 * región/workgroup/outputLocation/credenciales; {@code load()} ejecuta la query
 * indicada y mapea el ResultSet a un {@link DataFrame}. Cliente perezoso por
 * invocación.
 */
@Component
public class AthenaExecutor implements ConnectionExecutor {

    @Override
    public String type() {
        return "athena";
    }

    private AthenaClient client(Map<String, Object> config) {
        return AthenaClient.builder()
                .region(Region.of(AwsSupport.region(config)))
                .credentialsProvider(AwsSupport.credentials(config))
                .build();
    }

    private long timeoutMs(Map<String, Object> config) {
        String t = AwsSupport.str(config.get("queryTimeout"));
        try {
            long v = Long.parseLong(t.trim());
            if (v > 0) return v * 1000L;
        } catch (Exception ignored) {}
        return 30_000L;
    }

    @Override
    public ExecResult test(Map<String, Object> config) {
        try (AthenaClient athena = client(config)) {
            String execId = startQuery(athena, config, "SELECT 1");
            QueryExecutionState state = waitFor(athena, execId, timeoutMs(config));
            if (state == QueryExecutionState.SUCCEEDED) {
                return ExecResult.ok("Conexión Athena correcta: 'SELECT 1' ejecutado (workgroup '"
                        + AwsSupport.str(config.get("workgroup")) + "').");
            }
            GetQueryExecutionResponse r = athena.getQueryExecution(
                    GetQueryExecutionRequest.builder().queryExecutionId(execId).build());
            String reason = r.queryExecution().status().stateChangeReason();
            return ExecResult.fail("Athena " + state + (reason == null ? "" : ": " + reason));
        } catch (Exception e) {
            return ExecResult.fail(S3Executor.awsMessage(e));
        }
    }

    @Override
    public DataFrame load(Map<String, Object> config, Map<String, Object> params) throws Exception {
        Map<String, Object> p = params == null ? Map.of() : params;
        String query = AwsSupport.str(p.get("query"));
        if (query.isBlank()) {
            String table = AwsSupport.str(p.get("table"));
            if (table.isBlank()) {
                throw new IllegalArgumentException("Indica 'query' o 'table' para cargar desde Athena.");
            }
            String db = AwsSupport.str(config.get("database"));
            int limit = rowLimit(p);
            String qualified = db.isBlank() ? table : db + "." + table;
            query = "SELECT * FROM " + qualified + " LIMIT " + limit;
        }
        try (AthenaClient athena = client(config)) {
            String execId = startQuery(athena, config, query);
            QueryExecutionState state = waitFor(athena, execId, timeoutMs(config));
            if (state != QueryExecutionState.SUCCEEDED) {
                GetQueryExecutionResponse r = athena.getQueryExecution(
                        GetQueryExecutionRequest.builder().queryExecutionId(execId).build());
                String reason = r.queryExecution().status().stateChangeReason();
                throw new IllegalStateException("Athena " + state + (reason == null ? "" : ": " + reason));
            }
            return readResults(athena, execId);
        }
    }

    private int rowLimit(Map<String, Object> params) {
        String l = AwsSupport.str(params.get("limit"));
        try {
            int v = Integer.parseInt(l.trim());
            if (v > 0) return v;
        } catch (Exception ignored) {}
        return 1000;
    }

    private String startQuery(AthenaClient athena, Map<String, Object> config, String sql) {
        QueryExecutionContext.Builder ctx = QueryExecutionContext.builder();
        String database = AwsSupport.str(config.get("database"));
        String catalog = AwsSupport.str(config.get("dataSource"));
        if (!database.isBlank()) ctx.database(database);
        if (!catalog.isBlank()) ctx.catalog(catalog);

        StartQueryExecutionRequest.Builder req = StartQueryExecutionRequest.builder()
                .queryString(sql)
                .queryExecutionContext(ctx.build());

        String workgroup = AwsSupport.str(config.get("workgroup"));
        if (!workgroup.isBlank()) req.workGroup(workgroup);

        String s3Output = AwsSupport.str(config.get("s3Output"));
        if (s3Output.isBlank()) s3Output = AwsSupport.str(config.get("outputLocation"));
        if (!s3Output.isBlank()) {
            req.resultConfiguration(ResultConfiguration.builder().outputLocation(s3Output).build());
        }
        return athena.startQueryExecution(req.build()).queryExecutionId();
    }

    private QueryExecutionState waitFor(AthenaClient athena, String execId, long timeoutMs) {
        long deadline = System.currentTimeMillis() + timeoutMs;
        while (true) {
            GetQueryExecutionResponse r = athena.getQueryExecution(
                    GetQueryExecutionRequest.builder().queryExecutionId(execId).build());
            QueryExecutionState state = r.queryExecution().status().state();
            if (state == QueryExecutionState.SUCCEEDED
                    || state == QueryExecutionState.FAILED
                    || state == QueryExecutionState.CANCELLED) {
                return state;
            }
            if (System.currentTimeMillis() > deadline) {
                throw new IllegalStateException("Athena: timeout esperando el resultado de la consulta.");
            }
            try {
                Thread.sleep(800L);
            } catch (InterruptedException ie) {
                Thread.currentThread().interrupt();
                throw new IllegalStateException("Interrumpido esperando a Athena.");
            }
        }
    }

    private DataFrame readResults(AthenaClient athena, String execId) {
        List<String> columns = new ArrayList<>();
        List<List<String>> rows = new ArrayList<>();
        String token = null;
        boolean first = true;
        do {
            GetQueryResultsRequest.Builder rb = GetQueryResultsRequest.builder()
                    .queryExecutionId(execId).maxResults(1000);
            if (token != null) rb.nextToken(token);
            GetQueryResultsResponse res = athena.getQueryResults(rb.build());

            if (columns.isEmpty()) {
                for (ColumnInfo ci : res.resultSet().resultSetMetadata().columnInfo()) {
                    columns.add(ci.name());
                }
            }
            List<Row> page = res.resultSet().rows();
            for (int i = 0; i < page.size(); i++) {
                // La primera fila del primer page son las cabeceras: se omite.
                if (first && i == 0) continue;
                List<String> values = new ArrayList<>(columns.size());
                for (Datum d : page.get(i).data()) values.add(d.varCharValue());
                rows.add(values);
            }
            first = false;
            token = res.nextToken();
        } while (token != null);
        return new DataFrame(columns, rows);
    }
}
