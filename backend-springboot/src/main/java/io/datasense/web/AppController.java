package io.datasense.web;

import io.datasense.auth.AccessService;
import io.datasense.auth.Permissions;
import io.datasense.auth.UserRecord;
import io.datasense.auth.UserRepository;
import io.datasense.model.AppModels.AppCreate;
import io.datasense.model.AppModels.AppOut;
import io.datasense.repo.AppRepository;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.Map;

/**
 * Endpoints de aplicaciones. Cada app tiene una <b>etapa</b> (personal → desarrollo → produccion) y un
 * dueño. {@code GET} devuelve solo las apps que el usuario puede ver (ver {@link AccessService}).
 * {@code PUT /{appId}/stage} {stage, owner_id?} cambia la etapa:
 * <ul>
 *   <li>entrar o salir de {@code produccion} exige {@code apps:publish};</li>
 *   <li>entre {@code personal} y {@code desarrollo} basta poder editar la app (dueño o administrador en Personal).</li>
 * </ul>
 */
@RestController
@RequestMapping("/api/v1/apps")
public class AppController {

    private final AppRepository repo;
    private final AccessService access;
    private final UserRepository users;

    public AppController(AppRepository repo, AccessService access, UserRepository users) {
        this.repo = repo;
        this.access = access;
        this.users = users;
    }

    @GetMapping
    public List<AppOut> list(HttpServletRequest req) {
        return access.visibleApps(AccessService.current(req), repo.listApps());
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public AppOut create(HttpServletRequest req, @Valid @RequestBody AppCreate body) {
        return repo.createApp(body.name(), AccessService.current(req).id());
    }

    @GetMapping("/{appId}")
    public AppOut get(@PathVariable String appId) {
        return repo.getApp(appId).orElseThrow(() ->
                new ResponseStatusException(HttpStatus.NOT_FOUND, "App no encontrada: " + appId));
    }

    @PutMapping("/{appId}/stage")
    public AppOut stage(HttpServletRequest req, @PathVariable String appId, @RequestBody Map<String, Object> body) {
        UserRecord me = AccessService.current(req);
        AppOut app = repo.getApp(appId).orElseThrow(() ->
                new ResponseStatusException(HttpStatus.NOT_FOUND, "App no encontrada: " + appId));
        String stage = String.valueOf(body.getOrDefault("stage", ""));
        if (!Permissions.validStage(stage)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Etapa inválida. Usa: personal, desarrollo o produccion.");
        }
        boolean touchesProd = "produccion".equals(stage) || "produccion".equals(app.stage());
        if (touchesProd && !me.has(Permissions.PUBLISH)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Pasar una app a (o sacarla de) Producción requiere el permiso «Publicar» (apps:publish).");
        }
        if (!touchesProd && !(me.has(Permissions.EDIT) && access.canWrite(me, app))) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "No puedes cambiar la etapa de esta app.");
        }
        if (body.get("owner_id") != null && me.isAdmin()) {
            String owner = String.valueOf(body.get("owner_id"));
            if (users.get(owner).isEmpty()) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "El nuevo dueño no existe.");
            repo.setOwner(appId, owner);
        }
        return repo.setStage(appId, stage).orElseThrow();
    }

    @DeleteMapping("/{appId}")
    public ResponseEntity<Void> delete(@PathVariable String appId) {
        if (!repo.deleteApp(appId)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "App no encontrada: " + appId);
        }
        return ResponseEntity.noContent().build();
    }
}
