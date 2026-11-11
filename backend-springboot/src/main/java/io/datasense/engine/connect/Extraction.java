package io.datasense.engine.connect;

import io.datasense.engine.DataFrame;
import io.datasense.engine.transform.DataTransform;

import java.util.List;
import java.util.Map;

/** Extracción desde una conexión + transformaciones previas a la carga (params.transform). */
public final class Extraction {

    private Extraction() {}

    public static DataTransform.Result load(ConnectionExecutor exec, Map<String, Object> config, Map<String, Object> params) throws Exception {
        DataFrame raw = exec.load(config, params);
        if (raw == null) return null;
        DataTransform.Spec spec = DataTransform.from(params == null ? null : params.get("transform"));
        if (spec.isEmpty()) return new DataTransform.Result(raw, List.of(), raw.rowCount(), raw.rowCount());
        return DataTransform.apply(raw, spec);
    }
}
