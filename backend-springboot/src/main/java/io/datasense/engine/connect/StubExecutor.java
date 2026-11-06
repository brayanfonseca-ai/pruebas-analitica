package io.datasense.engine.connect;

import io.datasense.engine.DataFrame;

import java.util.Map;

/**
 * Executor honesto para conectores implementados pero sin credenciales/driver
 * disponibles en el entorno (OneDrive, SharePoint, GDrive, GCS, AzureBlob,
 * Dropbox, BigQuery, Snowflake, Databricks, MongoDB, DynamoDB, GraphQL, OData,
 * Bedrock/SageMaker/Comprehend/OpenAI/AzureOpenAI como fuente, MCP). NUNCA
 * devuelve un "ok" simulado: {@code test()} informa que requiere X para operar
 * y {@code load()} lanza con el mismo mensaje.
 */
public class StubExecutor implements ConnectionExecutor {

    private final String connector;
    private final String requirement;

    public StubExecutor(String connector, String requirement) {
        this.connector = connector;
        this.requirement = requirement;
    }

    private String message() {
        return "Conector " + connector + " implementado; requiere " + requirement + " para operar end-to-end.";
    }

    @Override
    public ExecResult test(Map<String, Object> config) {
        return ExecResult.fail(message());
    }

    @Override
    public DataFrame load(Map<String, Object> config, Map<String, Object> params) {
        throw new IllegalStateException(message());
    }

    @Override
    public String type() {
        return connector;
    }
}
