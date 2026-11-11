package io.datasense.engine.transform;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.List;

/** Conversión de valores de texto a número / entero / fecha (tolerante a formatos comunes). */
public final class Values {

    private Values() {}

    /** Número desde texto: "1.234,56", "1,234.56", "1234.00", "$ 1 200", "12%". null si no es número. */
    public static Double toNumber(String raw) {
        if (raw == null) return null;
        String t = raw.trim().replace("\u00a0", "").replace(" ", "").replace("$", "");
        boolean pct = t.endsWith("%");
        if (pct) t = t.substring(0, t.length() - 1);
        if (t.isEmpty()) return null;
        int lc = t.lastIndexOf(','), ld = t.lastIndexOf('.');
        if (lc >= 0 && ld >= 0) {
            if (lc > ld) t = t.replace(".", "").replace(',', '.');   // 1.234,56
            else t = t.replace(",", "");                                // 1,234.56
        } else if (lc >= 0) {
            // Una sola coma = decimal (1,5); varias = separador de miles (1,234,567).
            t = t.indexOf(',') != lc ? t.replace(",", "") : t.replace(',', '.');
        } else if (ld >= 0 && t.indexOf('.') != ld) {
            t = t.replace(".", "");                                     // 1.234.567
        }
        try {
            double v = Double.parseDouble(t);
            if (!Double.isFinite(v)) return null;
            return pct ? v / 100 : v;
        } catch (NumberFormatException e) {
            return null;
        }
    }

    public static String toInteger(String raw) {
        Double d = toNumber(raw);
        if (d == null) return null;
        return new BigDecimal(d).setScale(0, java.math.RoundingMode.HALF_UP).toPlainString();
    }

    public static String toDecimal(String raw) {
        Double d = toNumber(raw);
        if (d == null) return null;
        return RowExpression.format(d);
    }

    private static final List<DateTimeFormatter> DATES = List.of(
            DateTimeFormatter.ofPattern("yyyy-MM-dd"), DateTimeFormatter.ofPattern("yyyy/MM/dd"),
            DateTimeFormatter.ofPattern("dd/MM/yyyy"), DateTimeFormatter.ofPattern("d/M/yyyy"),
            DateTimeFormatter.ofPattern("dd-MM-yyyy"), DateTimeFormatter.ofPattern("yyyyMMdd"),
            DateTimeFormatter.ofPattern("yyyy-MM"));
    private static final List<DateTimeFormatter> DATETIMES = List.of(
            DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss[.SSS][.SS][.S]"), DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss[.SSS][XXX]"),
            DateTimeFormatter.ofPattern("dd/MM/yyyy HH:mm[:ss]"));

    /** Fecha ISO yyyy-MM-dd desde formatos comunes; null si no se reconoce. */
    public static String toDate(String raw) {
        if (raw == null) return null;
        String t = raw.trim();
        if (t.isEmpty()) return null;
        for (DateTimeFormatter f : DATETIMES) {
            try { return LocalDateTime.parse(t, f).toLocalDate().toString(); } catch (Exception ignored) {}
        }
        for (DateTimeFormatter f : DATES) {
            try {
                if (f.toString().contains("yyyy-MM") && t.length() == 7) return LocalDate.parse(t + "-01").toString();
                return LocalDate.parse(t, f).toString();
            } catch (Exception ignored) {}
        }
        return null;
    }
}
