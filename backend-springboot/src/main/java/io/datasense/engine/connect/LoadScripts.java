package io.datasense.engine.connect;

import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Genera el bloque de script de carga (sintaxis estilo Qlik) que corresponde a
 * una extracción desde una conexión: {@code LIB CONNECT TO}, la tabla con su
 * {@code LOAD} de campos y la sentencia {@code SQL SELECT} (bases de datos /
 * Athena) o el {@code FROM [lib://…]} (archivos en S3). Es el mismo texto que el
 * editor muestra "en paralelo" a la vista previa y el que aparece en el script
 * auto-generado tras cargar.
 */
public final class LoadScripts {

    private LoadScripts() {}

    private static final Set<String> SQL = Set.of("athena", "postgres", "mysql", "mariadb", "sqlserver", "oracle", "redshift", "odbc", "rds");

    /** Sentencia SQL efectiva de la extracción (consulta propia o SELECT de la tabla elegida). */
    public static String sqlFor(String connector, Map<String, Object> config, Map<String, Object> params) {
        String query = AwsSupport.str(params.get("query")).trim();
        if (!query.isEmpty()) return query.replaceAll(";\\s*$", "");
        String table = AwsSupport.str(params.get("table")).trim();
        if (table.isEmpty()) return "";
        if ("athena".equals(connector)) return AthenaExecutor.selectFor(config, params);
        return "SELECT * FROM " + table;
    }

    public static String block(String connName, String connector, Map<String, Object> config,
                               Map<String, Object> params, String tableName, List<String> columns) {
        StringBuilder sb = new StringBuilder();
        String libName = connName.replace("'", "''");
        if (SQL.contains(connector)) {
            sb.append("LIB CONNECT TO '").append(libName).append("';\n\n");
            sb.append("[").append(tableName).append("]:\n");
            appendLoad(sb, columns);
            sb.append(";\n");
            sb.append("SQL ").append(sqlFor(connector, config, params)).append(";\n");
            return sb.toString();
        }
        if ("s3".equals(connector)) {
            String key = AwsSupport.str(params.get("key"));
            if (key.isBlank()) key = AwsSupport.str(params.get("object"));
            boolean xlsx = key.toLowerCase().endsWith(".xlsx");
            sb.append("[").append(tableName).append("]:\n");
            appendLoad(sb, columns);
            sb.append("\nFROM [lib://").append(connName).append("/").append(key).append("]\n")
              .append(xlsx ? "(ooxml, embedded labels);\n" : "(txt, utf8, embedded labels, delimiter is ',', msq);\n");
            return sb.toString();
        }
        sb.append("LIB CONNECT TO '").append(libName).append("';\n\n");
        sb.append("[").append(tableName).append("]:\n");
        appendLoad(sb, columns);
        sb.append(";\n// Origen: ").append(connector);
        String obj = AwsSupport.str(params.get("object")).isBlank() ? AwsSupport.str(params.get("url")) : AwsSupport.str(params.get("object"));
        if (!obj.isBlank()) sb.append(" · ").append(obj);
        sb.append("\n");
        return sb.toString();
    }

    private static void appendLoad(StringBuilder sb, List<String> columns) {
        if (columns == null || columns.isEmpty()) { sb.append("LOAD *"); return; }
        sb.append("LOAD\n");
        for (int i = 0; i < columns.size(); i++) {
            sb.append("    [").append(columns.get(i)).append("]");
            if (i < columns.size() - 1) sb.append(",\n");
        }
    }
}
