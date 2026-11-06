package io.datasense.engine;

import java.util.ArrayList;
import java.util.List;

/**
 * Tabla en memoria: cabeceras + filas de valores en texto, más el tipo lógico
 * inferido por columna. Es el equivalente mínimo de un DataFrame de pandas para
 * el motor de consulta.
 */
public class DataFrame {

    private final List<String> columns;
    private final List<String> types;       // tipo lógico por columna (paralelo a columns)
    private final List<List<String>> rows;  // cada fila: valores en texto

    public DataFrame(List<String> columns, List<List<String>> rows) {
        this.columns = columns;
        this.rows = rows;
        this.types = new ArrayList<>();
        for (int c = 0; c < columns.size(); c++) {
            types.add(Profiler.inferType(columnValues(c)));
        }
    }

    public List<String> columns() { return columns; }
    public List<List<String>> rows() { return rows; }
    public int rowCount() { return rows.size(); }

    public int indexOf(String column) { return columns.indexOf(column); }

    public String typeOf(String column) {
        int i = indexOf(column);
        return i < 0 ? "text" : types.get(i);
    }

    public List<String> columnValues(int c) {
        List<String> out = new ArrayList<>(rows.size());
        for (List<String> row : rows) out.add(c < row.size() ? row.get(c) : null);
        return out;
    }

    public List<String> columnValues(String column) {
        int i = indexOf(column);
        if (i < 0) return List.of();
        return columnValues(i);
    }
}
