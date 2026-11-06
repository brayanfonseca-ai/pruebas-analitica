package io.datasense.repo;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.UUID;

/** Utilidades compartidas: ids hex y timestamps ISO-8601 UTC. */
public final class Ids {
    private Ids() {}

    public static String newId() {
        return UUID.randomUUID().toString().replace("-", "");
    }

    public static String now() {
        return OffsetDateTime.now(ZoneOffset.UTC).toString();
    }
}
