package io.datasense.automation;

import io.datasense.auth.AccessService;
import io.datasense.auth.Permissions;
import io.datasense.auth.UserRecord;
import io.datasense.repo.AppRepository;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Automatización de una app.
 * <pre>
 *   GET    /apps/{appId}/schedule                → {schedule | null, runs}
 *   PUT    /apps/{appId}/schedule                {frequency, interval_minutes?, time_of_day?, weekday?, notify?, enabled?}   (data:import)
 *   DELETE /apps/{appId}/schedule                                                                                           (data:import)
 *   POST   /apps/{appId}/schedule/run            ejecuta la carga ahora                                                     (data:import)
 *   GET    /apps/{appId}/reload-runs?limit=      historial de cargas (manuales y programadas)
 *   GET    /apps/{appId}/alerts                  · POST /apps/{appId}/alerts {name, expression | master_id, op, threshold, selections?, check_mode?, interval_minutes?, enabled?}
 *   PUT    /apps/{appId}/alerts/{id}             · DELETE /apps/{appId}/alerts/{id} · POST /apps/{appId}/alerts/{id}/check
 *   GET    /apps/{appId}/health                  salud de datos (puntaje, tablas, problemas)
 * </pre>
 * Las alertas son personales: cualquiera que vea la app crea las suyas; solo su dueño (o el administrador o quien
 * publica) las cambia o borra.
 */
@RestController
@RequestMapping("/api/v1/apps/{appId}")
public class AutomationController {

    private final AppRepository apps;
    private final AutomationService auto;
    private final HealthService health;

    public AutomationController(AppRepository apps, AutomationService auto, HealthService health) {
        this.apps = apps;
        this.auto = auto;
        this.health = health;
    }

    private void requireApp(String appId) {
        apps.getApp(appId).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "App no encontrada: " + appId));
    }

    private static ResponseStatusException bad(IllegalArgumentException e) { return new ResponseStatusException(HttpStatus.BAD_REQUEST, e.getMessage()); }

    /* ------------------------------ Carga programada ------------------------------ */

    @GetMapping("/schedule")
    public Map<String, Object> schedule(@PathVariable String appId) {
        requireApp(appId);
        Map<String, Object> out = new HashMap<>();
        out.put("schedule", auto.schedule(appId));
        out.put("runs", auto.runs(appId, 15));
        return out;
    }

    @PutMapping("/schedule")
    public Map<String, Object> saveSchedule(HttpServletRequest req, @PathVariable String appId, @RequestBody Map<String, Object> body) {
        requireApp(appId);
        try { return auto.saveSchedule(appId, body, AccessService.current(req)); } catch (IllegalArgumentException e) { throw bad(e); }
    }

    @DeleteMapping("/schedule")
    public ResponseEntity<Void> deleteSchedule(@PathVariable String appId) {
        requireApp(appId);
        if (!auto.deleteSchedule(appId)) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "La app no tiene carga programada.");
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/schedule/run")
    public Map<String, Object> runNow(HttpServletRequest req, @PathVariable String appId) {
        requireApp(appId);
        return auto.runNow(appId, AccessService.current(req), "now");
    }

    @GetMapping("/reload-runs")
    public List<Map<String, Object>> runs(@PathVariable String appId, @RequestParam(defaultValue = "20") int limit) {
        requireApp(appId);
        return auto.runs(appId, limit);
    }

    /* ------------------------------ Alertas ------------------------------ */

    @GetMapping("/alerts")
    public List<Map<String, Object>> alerts(@PathVariable String appId) {
        requireApp(appId);
        return auto.alerts(appId);
    }

    @PostMapping("/alerts")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> create(HttpServletRequest req, @PathVariable String appId, @RequestBody Map<String, Object> body) {
        requireApp(appId);
        try { return auto.saveAlert(appId, null, body, AccessService.current(req)); } catch (IllegalArgumentException e) { throw bad(e); }
    }

    @PutMapping("/alerts/{alertId}")
    public Map<String, Object> update(HttpServletRequest req, @PathVariable String appId, @PathVariable String alertId, @RequestBody Map<String, Object> body) {
        requireApp(appId);
        guard(req, appId, alertId);
        try { return auto.saveAlert(appId, alertId, body, AccessService.current(req)); } catch (IllegalArgumentException e) { throw bad(e); }
    }

    @DeleteMapping("/alerts/{alertId}")
    public ResponseEntity<Void> delete(HttpServletRequest req, @PathVariable String appId, @PathVariable String alertId) {
        requireApp(appId);
        guard(req, appId, alertId);
        auto.deleteAlert(alertId);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/alerts/{alertId}/check")
    public Map<String, Object> check(@PathVariable String appId, @PathVariable String alertId) {
        requireApp(appId);
        Map<String, Object> a = auto.alert(alertId).filter(x -> appId.equals(x.get("app_id")))
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Alerta no encontrada."));
        return auto.evaluate(a);
    }

    private void guard(HttpServletRequest req, String appId, String alertId) {
        Map<String, Object> a = auto.alert(alertId).filter(x -> appId.equals(x.get("app_id")))
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Alerta no encontrada."));
        UserRecord me = AccessService.current(req);
        boolean own = me != null && me.id().equals(a.get("owner_id"));
        if (!own && (me == null || !(me.isAdmin() || me.has(Permissions.PUBLISH))))
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Solo el dueño de la alerta (o quien publica) puede cambiarla o borrarla.");
    }

    /* ------------------------------ Salud de datos ------------------------------ */

    @GetMapping("/health")
    public Map<String, Object> health(@PathVariable String appId) {
        requireApp(appId);
        return health.health(appId);
    }
}
