package io.datasense.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * Sirve el frontend estático (el mismo repo raíz) desde el mismo origen que la
 * API, igual que el StaticFiles mount de FastAPI. Así no se necesita CORS.
 *
 * <p>Nota: cuando el frontend Angular esté compilado, apuntar este handler a
 * {@code ../frontend-angular/dist/}. Mientras tanto sirve el frontend actual.</p>
 */
@Configuration
public class WebConfig implements WebMvcConfigurer {

    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        // setCachePeriod(0) + sin resourceChain: el navegador siempre recibe la
        // última versión del frontend (evita ver una página cacheada/antigua).
        registry.addResourceHandler("/**")
                .addResourceLocations("file:../")
                .setCachePeriod(0)
                .resourceChain(false);
    }
}
