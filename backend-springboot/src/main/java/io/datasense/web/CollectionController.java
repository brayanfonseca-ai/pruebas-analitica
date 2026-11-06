package io.datasense.web;

import io.datasense.model.AppModels.CollectionCreate;
import io.datasense.model.AppModels.CollectionOut;
import io.datasense.repo.CollectionRepository;

import jakarta.validation.Valid;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;

/** Endpoints de colecciones. Equivale a routers/collections.py. */
@RestController
@RequestMapping("/api/v1/collections")
public class CollectionController {

    private final CollectionRepository repo;

    public CollectionController(CollectionRepository repo) {
        this.repo = repo;
    }

    @GetMapping
    public List<CollectionOut> list() {
        return repo.list();
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public CollectionOut create(@Valid @RequestBody CollectionCreate body) {
        return repo.create(body.name(), body.description(), body.visibility());
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable String id) {
        if (!repo.delete(id)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Colección no encontrada: " + id);
        }
        return ResponseEntity.noContent().build();
    }
}
