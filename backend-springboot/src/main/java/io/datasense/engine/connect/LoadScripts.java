package io.datasense.engine.connect;

import io.datasense.engine.transform.DataTransform;

import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * SQL de extracción y bloque de script de carga (sintaxis estilo Qlik) para una
 * conexión: {@code LIB CONNECT TO}, la tabla con su {@code LOAD} (columnas,
 * renombres AS, tipos Num/Text/Date, Alt, WHERE NOT IsNull…, calculadas) y la
 * sentencia {@code SQL SELECT} (o {@code FROM [lib://…]} para S3).
 *
 * <p>Modos de extracción ({@code params.mode}): {@code all} (todo, sin límite),
 * {@code partial} (primeras N filas) y {@code sample} (N filas al azar). Sin modo
 * = {@code partial} con {@code limit} (1000 por defecto), por compatibilidad.
 */
public final class LoadScripts {

    private LoadScripts() {}

    private static final Set<String> SQL = Set.of("athena", "postgres", "mysql", "mariadb", "sqlserver", "oracle", "redshift", "odbc", "rds");

    public static String mode(Map<String, Object> p) {
        String m = AwsSupport.str(p.get("mode")).trim().toLowerCase();
        return switch (m) { case "all", "todo" -> "all"; case "sample", "muestra" -> "sample"; default -> "partial"; };
    }

    public static int limit(Map<String, Object> p) {
        try {
            int v = Integer.parseInt(AwsSupport.str(p.get("limit")).trim());
            if (v > 0) return v;
        } catch (Exception ignored) {}
        return 1000;
    }

    private static String quoteId(String connector, String id) {
        String t = id.trim();
        return switch (connector) {
            case "mysql", "mariadb" -> t.startsWith("`") ? t : "`" + t.replace("`", "``") + "`";
            case "sqlserver" -> t.startsWith("[") ? t : "[" + t.replace("]", "]]") + "]";
            default -> t.startsWith("\"") ? t : "\"" + t.replace("\"", "\"\"") + "\"";
        };
    }

    private static String random(String connector) {
        return switch (connector) {
            case "athena" -> "rand()";
            case "mysql", "mariadb" -> "RAND()";
            case "sqlserver" -> "NEWID()";
            case "oracle" -> "DBMS_RANDOM.VALUE";
            default -> "random()";
        };
    }

    /** Aplica el modo/límite a un SELECT completo (sin LIMIT propio). */
    private static String limited(String connector, String select, String mode, int n, boolean isWrapped) {
        if ("all".equals(mode)) return select;
        String order = "sample".equals(mode) ? " ORDER BY " + random(connector) : "";
        switch (connector) {
            case "sqlserver": {
                String s = select.replaceFirst("(?i)^SELECT\\s+", "SELECT TOP " + n + " ");
                return s + order;
            }
            case "oracle":
                return select + order + " FETCH FIRST " + n + " ROWS ONLY";
            default:
                return select + order + " LIMIT " + n;
        }
    }

    /**
     * Sentencia SQL efectiva de la extracción.
     * @param columns columnas a traer (SELECT col1, col2…) o null para *
     */
    public static String sqlFor(String connector, Map<String, Object> config, Map<String, Object> params, List<String> columns) {
        String mode = mode(params);
        int n = limit(params);
        String query = AwsSupport.str(params.get("query")).trim().replaceAll(";\\s*$", "");
        if (!query.isEmpty()) {
            if ("all".equals(mode)) return query;
            return limited(connector, "SELECT * FROM (" + query + ") t", mode, n, true);
        }
        String table = AwsSupport.str(params.get("table")).trim();
        if (table.isEmpty()) return "";
        String from;
        if ("athena".equals(connector)) {
            String db = AwsSupport.str(params.get("database"));
            if (db.isBlank()) db = AwsSupport.str(config.get("database"));
            from = db.isBlank() ? quoteId(connector, table) : quoteId(connector, db) + "." + quoteId(connector, table);
        } else {
            from = table;
        }
        boolean canList = Set.of("athena", "postgres", "redshift", "mysql", "mariadb", "sqlserver", "oracle").contains(connector);
        String sel = columns == null || columns.isEmpty() || !canList ? "*"
                : columns.stream().map(c -> quoteId(connector, c)).collect(Collectors.joining(", "));
        return limited(connector, "SELECT " + sel + " FROM " + from, mode, n, false);
    }

    /** SQL de la extracción considerando la poda de columnas del transform. */
    public static String sqlFor(String connector, Map<String, Object> config, Map<String, Object> params) {
        return sqlFor(connector, config, params, DataTransform.pushdown(params.get("transform")));
    }

    /**
     * Bloque de carga completo.
     * @param fallbackColumns columnas de origen si el transform no las lista (p. ej. las del DataFrame)
     */
    public static String block(String connName, String connector, Map<String, Object> config,
                               Map<String, Object> params, String tableName, List<String> fallbackColumns) {
        DataTransform.Spec spec = DataTransform.from(params.get("transform"));
        List<String> items = DataTransform.loadItems(spec, fallbackColumns == null ? List.of() : fallbackColumns);
        String where = DataTransform.where(spec);
        StringBuilder sb = new StringBuilder();
        String libName = connName.replace("'", "''");
        String head = "[" + tableName + "]:\nLOAD " + (spec.distinct() ? "DISTINCT " : "");
        String fields = items.isEmpty() ? "*" : "\n    " + String.join(",\n    ", items);
        String whereLine = where == null ? "" : "\nWHERE " + where;
        if (SQL.contains(connector)) {
            sb.append("LIB CONNECT TO '").append(libName).append("';\n\n");
            sb.append(head).append(fields).append(whereLine).append(";\n");
            sb.append("SQL ").append(sqlFor(connector, config, params)).append(";\n");
            return sb.toString();
        }
        if ("s3".equals(connector)) {
            String key = AwsSupport.str(params.get("key"));
            if (key.isBlank()) key = AwsSupport.str(params.get("object"));
            boolean xlsx = key.toLowerCase().endsWith(".xlsx");
            sb.append(head).append(fields)
              .append("\nFROM [lib://").append(connName).append("/").append(key).append("]\n")
              .append(xlsx ? "(ooxml, embedded labels)" : "(txt, utf8, embedded labels, delimiter is ',', msq)")
              .append(whereLine).append(";\n");
            return sb.toString();
        }
        sb.append("LIB CONNECT TO '").append(libName).append("';\n\n");
        sb.append(head).append(fields).append(whereLine).append(";\n// Origen: ").append(connector);
        String obj = AwsSupport.str(params.get("object")).isBlank() ? AwsSupport.str(params.get("url")) : AwsSupport.str(params.get("object"));
        if (!obj.isBlank()) sb.append(" · ").append(obj);
        sb.append("\n");
        return sb.toString();
    }
}
