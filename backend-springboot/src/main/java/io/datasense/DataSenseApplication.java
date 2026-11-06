package io.datasense;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * Punto de entrada de DataSense (Spring Boot).
 *
 * <p>Equivalente del {@code app.main:app} de FastAPI: expone la API REST bajo
 * {@code /api/v1} y sirve el frontend estático desde el mismo origen (ver
 * {@link io.datasense.config.WebConfig}).</p>
 */
@SpringBootApplication
public class DataSenseApplication {
    public static void main(String[] args) {
        SpringApplication.run(DataSenseApplication.class, args);
    }
}
