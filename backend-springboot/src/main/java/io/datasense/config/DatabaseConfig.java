package io.datasense.config;

import javax.sql.DataSource;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.core.JdbcTemplate;

import jakarta.annotation.PostConstruct;

import java.io.File;

/**
 * Configura el {@link DataSource} SQLite y crea el esquema (idempotente) al
 * arrancar. Replica las tablas del backend Python: apps, tables, columns,
 * app_sheets, master_items, collections.
 */
@Configuration
public class DatabaseConfig {

    @Value("${datasense.db-path}")
    private String dbPath;

    @Value("${datasense.data-dir}")
    private String dataDir;

    @Bean
    public DataSource dataSource() {
        new File(dataDir).mkdirs();
        DriverManagerDataSource ds = new DriverManagerDataSource();
        ds.setDriverClassName("org.sqlite.JDBC");
        // busy_timeout: con peticiones concurrentes (p. ej. dos cargas a la vez) SQLite
        // espera al otro escritor en lugar de fallar con SQLITE_BUSY.
        // foreign_keys=true en CADA conexión (el PRAGMA de arranque solo afectaba a una):
        // así borrar una app elimina en cascada sus conexiones, hojas, tablas, etc.
        ds.setUrl("jdbc:sqlite:" + dbPath + "?busy_timeout=10000&foreign_keys=true");
        return ds;
    }

    @Bean
    public JdbcTemplate jdbcTemplate(DataSource dataSource) {
        return new JdbcTemplate(dataSource);
    }

    @Bean
    public SchemaInitializer schemaInitializer(JdbcTemplate jdbc) {
        return new SchemaInitializer(jdbc);
    }

    /** Crea el esquema al iniciar (equivalente a db.init_db()). */
    public static class SchemaInitializer {
        private final JdbcTemplate jdbc;

        public SchemaInitializer(JdbcTemplate jdbc) {
            this.jdbc = jdbc;
        }

        @PostConstruct
        public void init() {
            jdbc.execute("PRAGMA foreign_keys = ON");
            jdbc.execute("""
                CREATE TABLE IF NOT EXISTS apps (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    created_at TEXT NOT NULL
                )""");
            jdbc.execute("""
                CREATE TABLE IF NOT EXISTS tables (
                    id TEXT PRIMARY KEY,
                    app_id TEXT NOT NULL,
                    name TEXT NOT NULL,
                    source_name TEXT,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY (app_id) REFERENCES apps (id) ON DELETE CASCADE
                )""");
            jdbc.execute("""
                CREATE TABLE IF NOT EXISTS columns (
                    id TEXT PRIMARY KEY,
                    table_id TEXT NOT NULL,
                    name TEXT NOT NULL,
                    logical_type TEXT,
                    null_count INTEGER,
                    distinct_count INTEGER,
                    FOREIGN KEY (table_id) REFERENCES tables (id) ON DELETE CASCADE
                )""");
            jdbc.execute("""
                CREATE TABLE IF NOT EXISTS app_sheets (
                    id TEXT PRIMARY KEY,
                    app_id TEXT NOT NULL,
                    title TEXT NOT NULL,
                    description TEXT,
                    position INTEGER NOT NULL DEFAULT 0,
                    doc_json TEXT NOT NULL,
                    visibility TEXT NOT NULL DEFAULT 'privada',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    FOREIGN KEY (app_id) REFERENCES apps (id) ON DELETE CASCADE
                )""");
            jdbc.execute("""
                CREATE TABLE IF NOT EXISTS collections (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    description TEXT,
                    visibility TEXT NOT NULL DEFAULT 'privada',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )""");
            jdbc.execute("""
                CREATE TABLE IF NOT EXISTS master_items (
                    id TEXT PRIMARY KEY,
                    app_id TEXT NOT NULL,
                    kind TEXT NOT NULL CHECK (kind IN ('dimension', 'measure')),
                    name TEXT NOT NULL,
                    expression TEXT NOT NULL,
                    description TEXT,
                    resolved_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    FOREIGN KEY (app_id) REFERENCES apps (id) ON DELETE CASCADE
                )""");
            jdbc.execute("""
                CREATE TABLE IF NOT EXISTS scripts (
                    app_id TEXT PRIMARY KEY,
                    text TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    FOREIGN KEY (app_id) REFERENCES apps (id) ON DELETE CASCADE
                )""");
            jdbc.execute("""
                CREATE TABLE IF NOT EXISTS associations (
                    id TEXT PRIMARY KEY,
                    app_id TEXT NOT NULL,
                    left_table TEXT NOT NULL,
                    right_table TEXT NOT NULL,
                    fields_json TEXT NOT NULL,
                    basis TEXT,
                    confidence REAL,
                    is_custom INTEGER NOT NULL DEFAULT 0,
                    FOREIGN KEY (app_id) REFERENCES apps (id) ON DELETE CASCADE
                )""");
            // (La tabla antigua «connections», atada a cada app, se migró a data_connections: ver AuthBootstrap.)
            // Origen de las tablas cargadas desde una conexión (para generar el
            // script LIB CONNECT / SQL SELECT y re-ejecutar la carga).
            jdbc.execute("""
                CREATE TABLE IF NOT EXISTS table_sources (
                    table_id TEXT PRIMARY KEY,
                    app_id TEXT NOT NULL,
                    conn_id TEXT NOT NULL,
                    conn_name TEXT NOT NULL,
                    connector TEXT NOT NULL,
                    params_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY (app_id) REFERENCES apps (id) ON DELETE CASCADE
                )""");
            jdbc.execute("""
                CREATE TABLE IF NOT EXISTS field_overrides (
                    id TEXT PRIMARY KEY,
                    app_id TEXT NOT NULL,
                    table_id TEXT NOT NULL,
                    source_field TEXT NOT NULL,
                    rename TEXT,
                    forced_type TEXT,
                    hidden INTEGER NOT NULL DEFAULT 0,
                    updated_at TEXT NOT NULL,
                    UNIQUE (table_id, source_field),
                    FOREIGN KEY (app_id) REFERENCES apps (id) ON DELETE CASCADE
                )""");
            jdbc.execute("CREATE TABLE IF NOT EXISTS logical_model ("
                    + "app_id TEXT PRIMARY KEY, "
                    + "enabled INTEGER NOT NULL DEFAULT 1, "
                    + "doc_json TEXT NOT NULL, "
                    + "updated_at TEXT NOT NULL, "
                    + "FOREIGN KEY (app_id) REFERENCES apps (id) ON DELETE CASCADE)");
            // Experimentos de ML (proceso independiente de las vistas de una app).
            jdbc.execute("""
                CREATE TABLE IF NOT EXISTS ml_experiments (
                    id TEXT PRIMARY KEY,
                    app_id TEXT NOT NULL,
                    name TEXT NOT NULL,
                    description TEXT,
                    table_ref TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    FOREIGN KEY (app_id) REFERENCES apps (id) ON DELETE CASCADE
                )""");
            jdbc.execute("""
                CREATE TABLE IF NOT EXISTS ml_runs (
                    id TEXT PRIMARY KEY,
                    experiment_id TEXT NOT NULL,
                    algorithm TEXT NOT NULL,
                    label TEXT,
                    params_json TEXT NOT NULL,
                    result_json TEXT NOT NULL,
                    metric_name TEXT,
                    metric_value REAL,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY (experiment_id) REFERENCES ml_experiments (id) ON DELETE CASCADE
                )""");
            // Notificaciones: se derivan de las tablas anteriores (created_at); aquí solo
            // se guarda el estado de lectura (marcas globales + leídas una a una).
            jdbc.execute("""
                CREATE TABLE IF NOT EXISTS notification_state (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                )""");
            jdbc.execute("""
                CREATE TABLE IF NOT EXISTS notification_reads (
                    id TEXT PRIMARY KEY,
                    read_at TEXT NOT NULL
                )""");
            // Seguridad: usuarios (contraseña con PBKDF2), sesiones (solo el SHA-256 del token) y,
            // en apps, dueño y etapa (personal | desarrollo | produccion).
            jdbc.execute("""
                CREATE TABLE IF NOT EXISTS users (
                    id TEXT PRIMARY KEY,
                    email TEXT NOT NULL UNIQUE,
                    name TEXT NOT NULL,
                    role TEXT NOT NULL,
                    active INTEGER NOT NULL DEFAULT 1,
                    permissions_json TEXT NOT NULL DEFAULT '{}',
                    password_hash TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    last_login TEXT
                )""");
            jdbc.execute("""
                CREATE TABLE IF NOT EXISTS sessions (
                    token_hash TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    expires_at INTEGER NOT NULL,
                    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
                )""");
            // Conexiones de datos POR USUARIO (independientes de las apps): su dueño y con quién se comparten.
            jdbc.execute("""
                CREATE TABLE IF NOT EXISTS data_connections (
                    id TEXT PRIMARY KEY,
                    owner_id TEXT,
                    name TEXT NOT NULL,
                    connector TEXT NOT NULL,
                    space TEXT,
                    description TEXT,
                    config_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )""");
            jdbc.execute("""
                CREATE TABLE IF NOT EXISTS connection_shares (
                    connection_id TEXT NOT NULL,
                    user_id TEXT NOT NULL,
                    shared_by TEXT,
                    created_at TEXT NOT NULL,
                    PRIMARY KEY (connection_id, user_id)
                )""");
            // Notas para el agente: diccionario de datos (qué es cada tabla/columna y con qué se cruza).
            jdbc.execute("""
                CREATE TABLE IF NOT EXISTS app_notes (
                    app_id TEXT PRIMARY KEY,
                    text TEXT NOT NULL DEFAULT '',
                    updated_by TEXT,
                    updated_at TEXT NOT NULL,
                    FOREIGN KEY (app_id) REFERENCES apps (id) ON DELETE CASCADE
                )""");
            jdbc.execute("""
                CREATE TABLE IF NOT EXISTS table_notes (
                    app_id TEXT NOT NULL,
                    table_name TEXT NOT NULL,
                    description TEXT NOT NULL DEFAULT '',
                    grain TEXT NOT NULL DEFAULT '',
                    updated_by TEXT,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY (app_id, table_name),
                    FOREIGN KEY (app_id) REFERENCES apps (id) ON DELETE CASCADE
                )""");
            jdbc.execute("""
                CREATE TABLE IF NOT EXISTS column_notes (
                    app_id TEXT NOT NULL,
                    table_name TEXT NOT NULL,
                    column_name TEXT NOT NULL,
                    description TEXT NOT NULL DEFAULT '',
                    semantic TEXT NOT NULL DEFAULT '',
                    synonyms TEXT NOT NULL DEFAULT '',
                    joins_json TEXT NOT NULL DEFAULT '[]',
                    updated_by TEXT,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY (app_id, table_name, column_name),
                    FOREIGN KEY (app_id) REFERENCES apps (id) ON DELETE CASCADE
                )""");
            // Embedding: token por tablero publicado para incrustarlo en otras páginas web.
            jdbc.execute("""
                CREATE TABLE IF NOT EXISTS embeds (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    app_id TEXT NOT NULL,
                    sheet_id TEXT NOT NULL,
                    token TEXT NOT NULL UNIQUE,
                    enabled INTEGER NOT NULL DEFAULT 1,
                    allowed_origins TEXT NOT NULL DEFAULT '',
                    expires_at TEXT,
                    options_json TEXT NOT NULL DEFAULT '{}',
                    created_by TEXT,
                    created_at TEXT NOT NULL,
                    last_used_at TEXT,
                    views INTEGER NOT NULL DEFAULT 0,
                    FOREIGN KEY (app_id) REFERENCES apps (id) ON DELETE CASCADE
                )""");
            addColumn("apps", "owner_id", "TEXT");
            // Las apps que ya existían quedan en Desarrollo (nadie las ve en Producción hasta que se publiquen).
            addColumn("apps", "stage", "TEXT NOT NULL DEFAULT 'desarrollo'");
        }

        /** ALTER TABLE ... ADD COLUMN solo si la columna aún no existe (SQLite no tiene IF NOT EXISTS aquí). */
        private void addColumn(String table, String column, String ddl) {
            boolean exists = jdbc.queryForList("PRAGMA table_info(" + table + ")").stream()
                    .anyMatch(r -> column.equalsIgnoreCase(String.valueOf(r.get("name"))));
            if (!exists) jdbc.execute("ALTER TABLE " + table + " ADD COLUMN " + column + " " + ddl);
        }
    }
}
