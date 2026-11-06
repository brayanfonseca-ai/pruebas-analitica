package io.datasense.engine.connect;

import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Registro de todos los {@link ConnectionExecutor} por id de conector.
 * Inyectable en {@code ConnectionController}. Los executors con dependencias
 * de Spring (S3, Athena) se inyectan; el resto se construyen aquí (JDBC, HTTP,
 * stubs). {@link #get(String)} devuelve el executor del conector o {@code null}
 * si no hay ninguno registrado.
 */
@Component
public class ConnectionExecutors {

    private final Map<String, ConnectionExecutor> registry = new LinkedHashMap<>();

    public ConnectionExecutors(S3Executor s3, AthenaExecutor athena) {
        register(s3);
        register(athena);

        // Bases de datos vía JDBC (drivers en el pom).
        for (String db : new String[]{"postgres", "mysql", "mariadb", "sqlserver", "oracle", "redshift"}) {
            register(new JdbcExecutor(db));
        }

        // HTTP real: descarga de archivo y REST GET.
        register(new HttpExecutor("webfile"));
        register(new HttpExecutor("rest"));

        // Conectores implementados sin credenciales/driver disponibles: error honesto.
        stub("onedrive", "credenciales OAuth de Microsoft Graph y registro de app");
        stub("sharepoint", "credenciales OAuth de Microsoft Graph y registro de app");
        stub("gdrive", "credenciales OAuth de Google y registro de app");
        stub("gcs", "credenciales de servicio de Google Cloud");
        stub("azureblob", "cadena de conexión/credenciales de Azure Storage");
        stub("dropbox", "token OAuth de Dropbox");
        stub("bigquery", "credenciales de servicio de Google Cloud y el driver de BigQuery");
        stub("snowflake", "cuenta, credenciales y el driver JDBC de Snowflake");
        stub("databricks", "host, token y el driver JDBC de Databricks");
        stub("mongodb", "URI de conexión y el driver de MongoDB");
        stub("dynamodb", "credenciales AWS con permisos de DynamoDB");
        stub("graphql", "endpoint y token del servicio GraphQL");
        stub("odata", "endpoint y credenciales del servicio OData");
        stub("bedrock", "acceso a Amazon Bedrock como fuente de datos");
        stub("sagemaker", "endpoint y credenciales de Amazon SageMaker");
        stub("comprehend", "credenciales AWS con permisos de Amazon Comprehend");
        stub("openai", "clave de API de OpenAI");
        stub("azureopenai", "endpoint y clave de Azure OpenAI");
        stub("mcp-stdio", "configuración del servidor MCP (stdio)");
        stub("mcp-http", "configuración del servidor MCP (HTTP)");
    }

    private void register(ConnectionExecutor exec) {
        registry.put(exec.type(), exec);
    }

    private void stub(String connector, String requirement) {
        registry.put(connector, new StubExecutor(connector, requirement));
    }

    /** Devuelve el executor del conector, o {@code null} si no hay registrado. */
    public ConnectionExecutor get(String connector) {
        return connector == null ? null : registry.get(connector);
    }
}
