package io.datasense.web;

import io.datasense.model.AppModels.AppCreate;
import io.datasense.model.AppModels.AppOut;
import io.datasense.repo.AppRepository;

import jakarta.validation.Valid;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;

/** Endpoints de aplicaciones. Equivale a routers/apps.py. */
@RestController
@RequestMapping("/api/v1/apps")
public class AppController {

    private final AppRepository repo;

    public AppController(AppRepository repo) {
        this.repo = repo;
    }

    @GetMapping
    public List<AppOut> list() {
        return repo.listApps();
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public AppOut create(@Valid @RequestBody AppCreate body) {
        return repo.createApp(body.name());
    }

    @GetMapping("/{appId}")
    public AppOut get(@PathVariable String appId) {
        return repo.getApp(appId).orElseThrow(() ->
                new ResponseStatusException(HttpStatus.NOT_FOUND, "App no encontrada: " + appId));
    }

    @DeleteMapping("/{appId}")
    public ResponseEntity<Void> delete(@PathVariable String appId) {
        if (!repo.deleteApp(appId)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "App no encontrada: " + appId);
        }
        return ResponseEntity.noContent().build();
    }
}
