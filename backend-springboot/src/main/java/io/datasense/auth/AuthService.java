package io.datasense.auth;

import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.ArrayDeque;
import java.util.Base64;
import java.util.Deque;
import java.util.HexFormat;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Inicio de sesión y validación de tokens. El token es aleatorio (256 bits); en la base solo se
 * guarda su SHA-256 junto al usuario y la caducidad (8 h). Tras 5 intentos fallidos en 15 minutos
 * el correo queda bloqueado temporalmente.
 */
@Service
public class AuthService {

    private static final long TTL_MS = 8L * 60 * 60 * 1000;
    private static final int MAX_FAILS = 5;
    private static final long FAIL_WINDOW_MS = 15L * 60 * 1000;

    public record Login(String token, long expiresAt, UserRecord user) {}

    private final JdbcTemplate jdbc;
    private final UserRepository users;
    private final SecureRandom random = new SecureRandom();
    private final Map<String, Deque<Long>> fails = new ConcurrentHashMap<>();

    public AuthService(JdbcTemplate jdbc, UserRepository users) {
        this.jdbc = jdbc;
        this.users = users;
    }

    public Login login(String email, String password) {
        String key = UserRepository.normEmail(email);
        if (locked(key)) {
            throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS,
                    "Demasiados intentos fallidos. Espera unos minutos e inténtalo de nuevo.");
        }
        Optional<UserRecord> found = users.findByEmail(key);
        boolean ok = found.isPresent() && found.get().active() && PasswordHasher.verify(password, found.get().passwordHash());
        if (!ok) {
            recordFail(key);
            // Mismo mensaje exista o no el usuario, para no revelar qué correos están registrados.
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Correo o contraseña incorrectos.");
        }
        fails.remove(key);
        UserRecord u = found.get();
        String token = newToken();
        long exp = System.currentTimeMillis() + TTL_MS;
        jdbc.update("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
                sha256(token), u.id(), System.currentTimeMillis(), exp);
        users.touchLogin(u.id());
        jdbc.update("DELETE FROM sessions WHERE expires_at < ?", System.currentTimeMillis());
        return new Login(token, exp, users.get(u.id()).orElse(u));
    }

    /** Usuario dueño del token si la sesión sigue vigente y la cuenta está activa. */
    public Optional<UserRecord> validate(String token) {
        if (token == null || token.isBlank()) return Optional.empty();
        var ids = jdbc.queryForList("SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at > ?",
                String.class, sha256(token), System.currentTimeMillis());
        if (ids.isEmpty()) return Optional.empty();
        return users.get(ids.get(0)).filter(UserRecord::active);
    }

    public void logout(String token) {
        if (token != null) jdbc.update("DELETE FROM sessions WHERE token_hash = ?", sha256(token));
    }

    /** Cierra todas las sesiones del usuario (al desactivarlo, borrarlo o cambiar su contraseña). */
    public void revokeAll(String userId) {
        jdbc.update("DELETE FROM sessions WHERE user_id = ?", userId);
    }

    private boolean locked(String key) {
        Deque<Long> d = fails.get(key);
        if (d == null) return false;
        synchronized (d) {
            long now = System.currentTimeMillis();
            while (!d.isEmpty() && now - d.peekFirst() > FAIL_WINDOW_MS) d.pollFirst();
            return d.size() >= MAX_FAILS;
        }
    }

    private void recordFail(String key) {
        Deque<Long> d = fails.computeIfAbsent(key, k -> new ArrayDeque<>());
        synchronized (d) { d.addLast(System.currentTimeMillis()); }
    }

    private String newToken() {
        byte[] b = new byte[32];
        random.nextBytes(b);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(b);
    }

    static String sha256(String s) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }
}
