package io.datasense.web;

import io.datasense.repo.AppRepository;
import io.datasense.repo.SheetRepository;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.Map;

/** CRUD de hojas. Equivale a routers/sheets.py. */
@RestController
@RequestMapping("/api/v1/apps/{appId}/sheets")
public class SheetController {

    private final AppRepository apps;
    private final SheetRepository sheets;

    public SheetController(AppRepository apps, SheetRepository sheets) {
        this.apps = apps;
        this.sheets = sheets;
    }

    private void requireApp(String appId) {
        apps.getApp(appId).orElseThrow(() ->
                new ResponseStatusException(HttpStatus.NOT_FOUND, "App no encontrada: " + appId));
    }

    @GetMapping
    public List<Map<String, Object>> list(@PathVariable String appId) {
        requireApp(appId);
        return sheets.list(appId);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> create(@PathVariable String appId, @RequestBody Map<String, Object> body) {
        requireApp(appId);
        return sheets.create(appId, body);
    }

    @PutMapping("/{sheetId}")
    public Map<String, Object> update(@PathVariable String appId, @PathVariable String sheetId,
                                      @RequestBody Map<String, Object> body) {
        requireApp(appId);
        return sheets.update(sheetId, body).orElseThrow(() ->
                new ResponseStatusException(HttpStatus.NOT_FOUND, "Hoja no encontrada: " + sheetId));
    }

    @PutMapping("/{sheetId}/visibility")
    public Map<String, Object> visibility(@PathVariable String appId, @PathVariable String sheetId,
                                          @RequestBody Map<String, String> body) {
        requireApp(appId);
        return sheets.setVisibility(sheetId, body.getOrDefault("visibility", "privada")).orElseThrow(() ->
                new ResponseStatusException(HttpStatus.NOT_FOUND, "Hoja no encontrada: " + sheetId));
    }

    @DeleteMapping("/{sheetId}")
    public ResponseEntity<Void> delete(@PathVariable String appId, @PathVariable String sheetId) {
        requireApp(appId);
        if (!sheets.delete(sheetId)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Hoja no encontrada: " + sheetId);
        }
        return ResponseEntity.noContent().build();
    }
}
