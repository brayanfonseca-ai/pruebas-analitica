package io.datasense.embed;

import io.datasense.auth.UserRecord;
import io.datasense.model.AppModels.AppOut;
import io.datasense.repo.AppRepository;
import io.datasense.repo.Ids;
import io.datasense.repo.SheetRepository;

import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Reglas del embedding. Un token solo sirve si:
 * <ol>
 *   <li>no fue revocado ni venció;</li>
 *   <li>la aplicación está en <b>Producción</b> y la hoja está <b>publicada</b> (la misma regla que ve un visualizador).</li>
 * </ol>
 * El token se comporta como un visualizador de solo lectura limitado a SU aplicación: ver {@code AuthInterceptor}.
 */
@Service
public class EmbedService {

    /** Resultado de autenticar un token de embedding. */
    public record Authn(EmbedRecord embed, UserRecord user, int status, String error) {
        public boolean ok() { return error == null; }
    }

    private final EmbedRepository repo;
    private final AppRepository apps;
    private final SheetRepository sheets;

    public EmbedService(EmbedRepository repo, AppRepository apps, SheetRepository sheets) {
        this.repo = repo;
        this.apps = apps;
        this.sheets = sheets;
    }

    /** Estado legible: active | revoked | expired | unpublished. */
    public String status(EmbedRecord e) {
        if (!e.enabled()) return "revoked";
        if (e.expired()) return "expired";
        Optional<AppOut> app = apps.getApp(e.appId());
        Optional<Map<String, Object>> sheet = sheets.get(e.sheetId());
        if (app.isEmpty() || sheet.isEmpty() || !"produccion".equals(app.get().stage())
                || !"publica".equals(sheet.get().get("visibility"))) return "unpublished";
        return "active";
    }

    public static String statusMessage(String status) {
        return switch (status) {
            case "revoked" -> "Este embed fue desactivado.";
            case "expired" -> "El token de este embed venció.";
            case "unpublished" -> "El tablero no está publicado: la aplicación debe estar en Producción y la hoja publicada.";
            default -> "";
        };
    }

    public Authn authenticate(String token) {
        Optional<EmbedRecord> found = token == null ? Optional.empty() : repo.findByToken(token);
        if (found.isEmpty()) return new Authn(null, null, 401, "Token de embedding no válido.");
        EmbedRecord e = found.get();
        String st = status(e);
        if (!"active".equals(st)) return new Authn(e, null, 403, statusMessage(st));
        return new Authn(e, principal(e), 200, null);
    }

    /** Usuario sintético de solo lectura (rol visualizador) que representa al token. */
    public static UserRecord principal(EmbedRecord e) {
        String now = Ids.now();
        return new UserRecord("embed:" + e.id(), "embed@datasense.local", "Embed · " + e.name(), "viewer", true,
                List.of(), List.of(), now, now, null, "");
    }
}
