package io.datasense.embed;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;

/**
 * Un embed: el token que permite incrustar UNA hoja publicada en otra página web.
 * {@code allowedOrigins}: orígenes permitidos separados por coma/espacio (vacío = cualquiera).
 */
public record EmbedRecord(String id, String name, String appId, String sheetId, String token, boolean enabled,
                          String allowedOrigins, String expiresAt, String optionsJson, String createdBy,
                          String createdAt, String lastUsedAt, int views) {

    public List<String> origins() {
        List<String> out = new ArrayList<>();
        if (allowedOrigins != null) {
            for (String o : allowedOrigins.split("[,\\s]+")) {
                String t = o.trim();
                if (!t.isEmpty()) out.add(t.endsWith("/") ? t.substring(0, t.length() - 1) : t);
            }
        }
        return out;
    }

    public boolean expired() {
        if (expiresAt == null || expiresAt.isBlank()) return false;
        try { return OffsetDateTime.parse(expiresAt).toInstant().isBefore(Instant.now()); }
        catch (Exception e) { return false; }
    }
}
