package io.datasense.engine.connect;

import io.datasense.engine.DataFrame;

import org.springframework.stereotype.Component;

import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.athena.AthenaClient;
import software.amazon.awssdk.services.athena.model.Column;
import software.amazon.awssdk.services.athena.model.ColumnInfo;
import software.amazon.awssdk.services.athena.model.Database;
import software.amazon.awssdk.services.athena.model.ListDatabasesRequest;
import software.amazon.awssdk.services.athena.model.ListDatabasesResponse;
import software.amazon.awssdk.services.athena.model.ListTableMetadataRequest;
import software.amazon.awssdk.services.athena.model.ListTableMetadataResponse;
import software.amazon.awssdk.services.athena.model.TableMetadata;
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
import java.util.LinkedHashMap;
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
        if (AwsSupport.str(p.get("query")).isBlank() && AwsSupport.str(p.get("table")).isBlank()) {
            throw new IllegalArgumentException("Indica 'query' o 'table' para cargar desde Athena.");
        }
        // Mismo SQL que muestra el script: modo (todo/parcial/muestra) + poda de columnas.
        String query = LoadScripts.sqlFor("athena", config, p);
        try (AthenaClient athena = client(config)) {
            String execId = startQuery(athena, config, query);
            QueryExecutionState state = waitFor(athena, execId, timeoutMs(config));
            if (state != QueryExecutionState.SUCCEEDED) {
                GetQueryExecutionResponse r = athena.getQueryExecution(
                        GetQueryExecutionRequest.builder().queryExecutionId(execId).build());
                String reason = r.queryExecution().status().stateChangeReason();
                throw new IllegalStateException("Athena " + state + (reason == null ? "" : ": " + reason));
            }
            return readResults(athena, execId, maxRows(p));
        }
    }

    /** Tope de filas a leer del resultado (vista previa); 0 = todas. */
    private static int maxRows(Map<String, Object> p) {
        try {
            int v = Integer.parseInt(AwsSupport.str(p.get("maxRows")).trim());
            return Math.max(0, v);
        } catch (Exception ignored) {
            return 0;
        }
    }

    /**
     * Sin {@code database}: lista las bases del catálogo. Con {@code database}:
     * lista sus tablas (con columnas y tipos) vía ListTableMetadata.
     */
    @Override
    public Map<String, Object> browse(Map<String, Object> config, Map<String, Object> params) {
        Map<String, Object> p = params == null ? Map.of() : params;
        String catalog = AwsSupport.str(config.get("dataSource"));
        if (catalog.isBlank()) catalog = "AwsDataCatalog";
        String database = AwsSupport.str(p.get("database"));
        try (AthenaClient athena = client(config)) {
            List<Map<String, Object>> items = new ArrayList<>();
            if (database.isBlank()) {
                String token = null;
                do {
                    ListDatabasesRequest.Builder b = ListDatabasesRequest.builder().catalogName(catalog).maxResults(50);
                    if (token != null) b.nextToken(token);
                    ListDatabasesResponse r = athena.listDatabases(b.build());
                    for (Database d : r.databaseList()) items.add(new LinkedHashMap<>(Map.of("name", d.name(), "type", "database")));
                    token = r.nextToken();
                } while (token != null && items.size() < 1000);
                return Map.of("level", "databases", "catalog", catalog,
                        "defaultDatabase", AwsSupport.str(config.get("database")), "items", items);
            }
            String token = null;
            do {
                ListTableMetadataRequest.Builder b = ListTableMetadataRequest.builder()
                        .catalogName(catalog).databaseName(database).maxResults(50);
                if (token != null) b.nextToken(token);
                ListTableMetadataResponse r = athena.listTableMetadata(b.build());
                for (TableMetadata t : r.tableMetadataList()) {
                    List<Map<String, Object>> cols = new ArrayList<>();
                    for (Column c : t.columns()) cols.add(Map.of("name", c.name(), "type", c.type() == null ? "" : c.type()));
                    for (Column c : t.partitionKeys()) cols.add(Map.of("name", c.name(), "type", (c.type() == null ? "" : c.type()) + " (partición)"));
                    Map<String, Object> it = new LinkedHashMap<>();
                    it.put("name", t.name());
                    it.put("type", t.tableType() == null ? "TABLE" : t.tableType());
                    it.put("columns", cols);
                    items.add(it);
                }
                token = r.nextToken();
            } while (token != null && items.size() < 1000);
            return Map.of("level", "tables", "catalog", catalog, "database", database, "items", items);
        }
    }

    /**
     * SELECT que se ejecuta cuando se elige una tabla (sin consulta propia):
     * {@code SELECT * FROM "db"."tabla" LIMIT n}. La base sale de los params
     * (selector) o de la config de la conexión. Identificadores entre comillas
     * dobles (Athena admite guiones en nombres de base, p. ej. analitica-landing).
     */
    public static String selectFor(Map<String, Object> config, Map<String, Object> p) {
        String table = AwsSupport.str(p.get("table"));
        String db = AwsSupport.str(p.get("database"));
        if (db.isBlank()) db = AwsSupport.str(config.get("database"));
        String qualified = db.isBlank() ? quote(table) : quote(db) + "." + quote(table);
        return "SELECT * FROM " + qualified + " LIMIT " + rowLimitOf(p);
    }

    private static String quote(String id) {
        String t = id.trim();
        if (t.startsWith("\"") && t.endsWith("\"")) return t;
        return "\"" + t.replace("\"", "\"\"") + "\"";
    }

    static int rowLimitOf(Map<String, Object> params) {
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

    private DataFrame readResults(AthenaClient athena, String execId, int maxRows) {
        List<String> columns = new ArrayList<>();
        List<List<String>> rows = new ArrayList<>();
        String token = null;
        boolean first = true;
        do {
            if (maxRows > 0 && rows.size() >= maxRows) break;
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
        if (maxRows > 0 && rows.size() > maxRows) rows = new ArrayList<>(rows.subList(0, maxRows));
        return new DataFrame(columns, rows);
    }
}
