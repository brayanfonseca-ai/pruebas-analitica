package io.datasense.config;

import io.datasense.auth.AuthInterceptor;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * Sirve el frontend estático ({@code frontend/}: pages, css, js) desde el mismo
 * origen que la API. Así no se necesita CORS. Además protege {@code /api/v1/**} con
 * {@link AuthInterceptor} (sesión + permisos + etapas).
 *
 * <p>Estructura: {@code frontend/pages/*.html} (páginas), {@code frontend/css},
 * {@code frontend/js}. Las páginas referencian assets con {@code ../css/} y
 * {@code ../js/}.</p>
 */
@Configuration
public class WebConfig implements WebMvcConfigurer {

    private final AuthInterceptor authInterceptor;

    public WebConfig(AuthInterceptor authInterceptor) {
        this.authInterceptor = authInterceptor;
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(authInterceptor).addPathPatterns("/api/v1/**");
    }

    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        // setCachePeriod(0) + sin resourceChain: el navegador siempre recibe la
        // última versión del frontend (evita ver una página cacheada/antigua).
        registry.addResourceHandler("/**")
                .addResourceLocations("file:../frontend/")
                .setCachePeriod(0)
                .resourceChain(false);
    }
}
