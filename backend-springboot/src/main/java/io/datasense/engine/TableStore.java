package io.datasense.engine;

import org.apache.commons.csv.CSVFormat;
import org.apache.commons.csv.CSVParser;
import org.apache.commons.csv.CSVPrinter;
import org.apache.commons.csv.CSVRecord;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.io.Reader;
import java.io.UncheckedIOException;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

/**
 * Almacén de datos de tablas en disco (CSV por tabla), equivalente a
 * persistence/tablestore.py. Ruta: {dataDir}/{appId}/{tableId}.csv
 */
@Component
public class TableStore {

    private final Path dataDir;

    public TableStore(@Value("${datasense.data-dir}") String dataDir) {
        this.dataDir = Path.of(dataDir, "tables");
    }

    private Path pathFor(String appId, String tableId) {
        return dataDir.resolve(appId).resolve(tableId + ".csv");
    }

    public void save(String appId, String tableId, DataFrame df) {
        Path p = pathFor(appId, tableId);
        try {
            Files.createDirectories(p.getParent());
            try (Writer w = Files.newBufferedWriter(p, StandardCharsets.UTF_8);
                 CSVPrinter printer = new CSVPrinter(w, CSVFormat.DEFAULT.builder()
                         .setHeader(df.columns().toArray(new String[0])).build())) {
                for (List<String> row : df.rows()) printer.printRecord(row);
            }
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    public DataFrame load(String appId, String tableId) {
        Path p = pathFor(appId, tableId);
        try (Reader r = Files.newBufferedReader(p, StandardCharsets.UTF_8);
             CSVParser parser = CSVParser.parse(r, CSVFormat.DEFAULT.builder()
                     .setHeader().setSkipHeaderRecord(true).build())) {
            List<String> headers = new ArrayList<>(parser.getHeaderNames());
            List<List<String>> rows = new ArrayList<>();
            for (CSVRecord rec : parser) {
                List<String> row = new ArrayList<>(headers.size());
                for (int i = 0; i < headers.size(); i++) row.add(i < rec.size() ? rec.get(i) : null);
                rows.add(row);
            }
            return new DataFrame(headers, rows);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    /** Borra el CSV de una tabla (si existe). */
    public void delete(String appId, String tableId) {
        try { Files.deleteIfExists(pathFor(appId, tableId)); } catch (IOException ignored) {}
    }

    public void deleteApp(String appId) {
        Path dir = dataDir.resolve(appId);
        if (!Files.exists(dir)) return;
        try (var walk = Files.walk(dir)) {
            walk.sorted((a, b) -> b.getNameCount() - a.getNameCount())
                .forEach(path -> { try { Files.deleteIfExists(path); } catch (IOException ignored) {} });
        } catch (IOException ignored) {}
    }
}
