package io.datasense.engine.connect;

import io.datasense.engine.DataFrame;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Properties;

/**
 * Conector REAL a bases de datos vía JDBC, parametrizable por motor (postgres,
 * mysql, mariadb, sqlserver, oracle, redshift). {@code test()} abre la conexión
 * con un loginTimeout corto y ejecuta 'SELECT 1'; {@code load()} ejecuta la
 * query/tabla indicada y mapea el ResultSet a un {@link DataFrame} (todo a
 * texto). Un host inválido produce un error de conexión JDBC real (no una
 * validación de campos).
 */
public class JdbcExecutor implements ConnectionExecutor {

    private final String connector;

    public JdbcExecutor(String connector) {
        this.connector = connector;
    }

    @Override
    public String type() {
        return connector;
    }

    private String buildUrl(Map<String, Object> config) {
        String host = AwsSupport.str(config.get("host"));
        String port = AwsSupport.str(config.get("port"));
        String database = AwsSupport.str(config.get("database"));
        switch (connector) {
            case "postgres":
                return "jdbc:postgresql://" + host + ":" + def(port, "5432") + "/" + database;
            case "redshift":
                // Reutiliza el driver de PostgreSQL (jdbc:postgresql) salvo URL explícita.
                return "jdbc:postgresql://" + host + ":" + def(port, "5439") + "/" + database;
            case "mysql":
            case "mariadb":
                return "jdbc:mysql://" + host + ":" + def(port, "3306") + "/" + database;
            case "sqlserver":
                return "jdbc:sqlserver://" + host + ":" + def(port, "1433") + ";databaseName=" + database
                        + ";encrypt=true;trustServerCertificate=true";
            case "oracle":
                return "jdbc:oracle:thin:@" + host + ":" + def(port, "1521") + "/" + database;
            default:
                throw new IllegalArgumentException("Motor JDBC no soportado: " + connector);
        }
    }

    private static String def(String v, String fallback) {
        return v == null || v.isBlank() ? fallback : v;
    }

    private Connection open(Map<String, Object> config) throws SQLException {
        String url = buildUrl(config);
        String user = AwsSupport.str(config.get("username"));
        if (user.isBlank()) user = AwsSupport.str(config.get("user"));
        String password = AwsSupport.str(config.get("password"));
        Properties props = new Properties();
        if (!user.isBlank()) props.setProperty("user", user);
        if (!password.isBlank()) props.setProperty("password", password);
        DriverManager.setLoginTimeout(8);
        return DriverManager.getConnection(url, props);
    }

    @Override
    public ExecResult test(Map<String, Object> config) {
        String host = AwsSupport.str(config.get("host"));
        if (host.isBlank()) return ExecResult.fail("Falta el host de la base de datos.");
        try (Connection c = open(config);
             Statement st = c.createStatement();
             ResultSet rs = st.executeQuery("SELECT 1")) {
            rs.next();
            return ExecResult.ok("Conexión " + connector + " correcta: 'SELECT 1' respondió.");
        } catch (SQLException e) {
            return ExecResult.fail("Error de conexión JDBC (" + connector + "): " + e.getMessage());
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
                throw new IllegalArgumentException("Indica 'query' o 'table' para cargar desde " + connector + ".");
            }
            query = "SELECT * FROM " + table;
        }
        int maxRows = 0;
        try { maxRows = Math.max(0, Integer.parseInt(AwsSupport.str(p.get("maxRows")).trim())); } catch (Exception ignored) {}
        try (Connection c = open(config);
             Statement st = c.createStatement()) {
            if (maxRows > 0) st.setMaxRows(maxRows);
            ResultSet rs = st.executeQuery(query);
            ResultSetMetaData md = rs.getMetaData();
            int n = md.getColumnCount();
            List<String> columns = new ArrayList<>(n);
            for (int i = 1; i <= n; i++) columns.add(md.getColumnLabel(i));
            List<List<String>> rows = new ArrayList<>();
            while (rs.next()) {
                List<String> row = new ArrayList<>(n);
                for (int i = 1; i <= n; i++) {
                    Object v = rs.getObject(i);
                    row.add(v == null ? null : String.valueOf(v));
                }
                rows.add(row);
            }
            rs.close();
            return new DataFrame(columns, rows);
        }
    }

    /** Lista tablas y vistas (esquema.tabla) vía DatabaseMetaData; máx. 1000. */
    @Override
    public Map<String, Object> browse(Map<String, Object> config, Map<String, Object> params) throws Exception {
        try (Connection c = open(config);
             ResultSet rs = c.getMetaData().getTables(null, null, "%", new String[]{"TABLE", "VIEW"})) {
            List<Map<String, Object>> items = new ArrayList<>();
            while (rs.next() && items.size() < 1000) {
                String schema = rs.getString("TABLE_SCHEM");
                if (schema != null && (schema.equalsIgnoreCase("information_schema") || schema.equalsIgnoreCase("pg_catalog")
                        || schema.equalsIgnoreCase("sys"))) continue;
                String name = rs.getString("TABLE_NAME");
                Map<String, Object> it = new java.util.LinkedHashMap<>();
                it.put("name", schema == null || schema.isBlank() ? name : schema + "." + name);
                it.put("type", rs.getString("TABLE_TYPE"));
                items.add(it);
            }
            return Map.of("level", "tables", "items", items);
        }
    }
}
