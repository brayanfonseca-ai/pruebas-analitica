package io.datasense.embed;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;

/**
 * Un embed: el token que permite incrustar una o VARIAS hojas publicadas de una app en otra página web.
 * {@code sheetId} es la primera hoja; {@code sheetIdsCsv} la lista completa en el orden de las pestañas
 * (vacía en los embeds creados antes de admitir varias hojas: entonces solo cuenta {@code sheetId}).
 * {@code allowedOrigins}: orígenes permitidos separados por coma/espacio (vacío = cualquiera).
 */
public record EmbedRecord(String id, String name, String appId, String sheetId, String token, boolean enabled,
                          String allowedOrigins, String expiresAt, String optionsJson, String createdBy,
                          String createdAt, String lastUsedAt, int views, String sheetIdsCsv) {

    /** Hojas del embed en orden (sin repetidos). */
    public List<String> sheets() {
        List<String> out = new ArrayList<>();
        if (sheetIdsCsv != null) for (String s : sheetIdsCsv.split(",")) { String t = s.trim(); if (!t.isEmpty() && !out.contains(t)) out.add(t); }
        if (out.isEmpty() && sheetId != null && !sheetId.isBlank()) out.add(sheetId);
        return out;
    }

    public boolean includesSheet(String id) { return id != null && sheets().contains(id); }

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
