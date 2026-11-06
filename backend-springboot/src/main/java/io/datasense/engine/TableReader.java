package io.datasense.engine;

import org.apache.commons.csv.CSVFormat;
import org.apache.commons.csv.CSVParser;
import org.apache.commons.csv.CSVRecord;
import org.apache.poi.ss.usermodel.Cell;
import org.apache.poi.ss.usermodel.DataFormatter;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.ss.usermodel.Workbook;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/** Lee CSV (Commons CSV) y Excel .xlsx (Apache POI) a un {@link DataFrame}. */
public final class TableReader {

    private TableReader() {}

    public static DataFrame read(byte[] bytes, String filename) throws IOException {
        String lower = filename.toLowerCase();
        if (lower.endsWith(".csv")) return readCsv(bytes);
        if (lower.endsWith(".xlsx")) return readXlsx(bytes);
        throw new IllegalArgumentException("Formato de archivo no soportado: " + filename);
    }

    private static DataFrame readCsv(byte[] bytes) throws IOException {
        try (CSVParser parser = CSVParser.parse(
                new InputStreamReader(new ByteArrayInputStream(bytes), StandardCharsets.UTF_8),
                CSVFormat.DEFAULT.builder().setHeader().setSkipHeaderRecord(true).build())) {
            List<String> headers = new ArrayList<>(parser.getHeaderNames());
            headers.replaceAll(String::trim);
            List<List<String>> rows = new ArrayList<>();
            for (CSVRecord rec : parser) {
                List<String> row = new ArrayList<>(headers.size());
                for (int i = 0; i < headers.size(); i++) row.add(i < rec.size() ? rec.get(i) : null);
                rows.add(row);
            }
            return new DataFrame(headers, rows);
        }
    }

    private static DataFrame readXlsx(byte[] bytes) throws IOException {
        try (Workbook wb = new XSSFWorkbook(new ByteArrayInputStream(bytes))) {
            Sheet sheet = wb.getSheetAt(0);
            DataFormatter fmt = new DataFormatter();
            List<String> headers = new ArrayList<>();
            List<List<String>> rows = new ArrayList<>();
            Row headerRow = sheet.getRow(sheet.getFirstRowNum());
            if (headerRow == null) return new DataFrame(headers, rows);
            int cols = headerRow.getLastCellNum();
            for (int c = 0; c < cols; c++) headers.add(fmt.formatCellValue(headerRow.getCell(c)).trim());
            for (int r = sheet.getFirstRowNum() + 1; r <= sheet.getLastRowNum(); r++) {
                Row row = sheet.getRow(r);
                if (row == null) continue;
                List<String> values = new ArrayList<>(cols);
                boolean anyValue = false;
                for (int c = 0; c < cols; c++) {
                    Cell cell = row.getCell(c);
                    String v = cell == null ? "" : fmt.formatCellValue(cell);
                    if (!v.isBlank()) anyValue = true;
                    values.add(v);
                }
                if (anyValue) rows.add(values);
            }
            return new DataFrame(headers, rows);
        }
    }
}
