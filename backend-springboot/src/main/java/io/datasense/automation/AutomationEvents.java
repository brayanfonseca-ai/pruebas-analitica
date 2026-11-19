package io.datasense.automation;

import java.util.Map;

/** Eventos que publica la automatización para que otros módulos (los flujos por nodos) reaccionen. */
public final class AutomationEvents {

    private AutomationEvents() {}

    /** Terminó una carga de datos de una app (manual, programada, «ejecutar ahora» o desde un flujo). */
    public record AppReloaded(String appId, String trigger, String status, String message, Object tables) {}

    /** Una alerta pasó a disparada. */
    public record AlertFired(String appId, String alertId, String name, String message, Double value, Map<String, Object> alert) {}
}
