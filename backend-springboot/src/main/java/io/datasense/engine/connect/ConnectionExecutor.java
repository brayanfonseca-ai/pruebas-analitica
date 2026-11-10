package io.datasense.engine.connect;

import io.datasense.engine.DataFrame;

import java.util.Map;

/**
 * Ejecutor REAL de una conexión de datos por tipo de conector. A diferencia de
 * la validación de campos previa, {@link #test(Map)} abre una conexión real
 * (AWS/JDBC/HTTP) y {@link #load(Map, Map)} trae datos reales listos para
 * materializar como una tabla del motor (mismo camino que un archivo).
 *
 * <p>Honestidad total: ningún executor devuelve un "ok" simulado. Un error real
 * de AWS/JDBC/HTTP ante un intento real es evidencia válida y se propaga tal
 * cual en {@link ExecResult#message()} o como mensaje de la excepción de
 * {@link #load}.
 */
public interface ConnectionExecutor {

    /**
     * Prueba la conexión abriendo un recurso real. Nunca lanza: cualquier fallo
     * se degrada a {@code ExecResult.fail(mensajeReal)}.
     */
    ExecResult test(Map<String, Object> config);

    /**
     * Trae datos reales y devuelve un {@link DataFrame} (columnas + filas en
     * texto) listo para materializar. Si no puede, lanza una excepción con un
     * mensaje legible que el controlador captura y convierte en {@code ok:false}.
     */
    DataFrame load(Map<String, Object> config, Map<String, Object> params) throws Exception;

    /** Id del conector que maneja este executor (p.ej. "s3", "postgres"). */
    String type();

    /**
     * Explora los objetos disponibles (bases de datos, tablas, archivos) para el
     * selector de datos. Devuelve {@code {level, items:[{name, type, ...}]}}. Los
     * conectores sin exploración lanzan {@link UnsupportedOperationException}.
     */
    default Map<String, Object> browse(Map<String, Object> config, Map<String, Object> params) throws Exception {
        throw new UnsupportedOperationException("Este conector no permite explorar objetos; escribe la tabla o la consulta.");
    }

    /** Resultado de una prueba de conexión. */
    record ExecResult(boolean ok, String message, Map<String, Object> details) {
        public static ExecResult ok(String message) {
            return new ExecResult(true, message, Map.of());
        }

        public static ExecResult ok(String message, Map<String, Object> details) {
            return new ExecResult(true, message, details == null ? Map.of() : details);
        }

        public static ExecResult fail(String message) {
            return new ExecResult(false, message, Map.of());
        }
    }
}
