# DataSense — Documentación

Plataforma de analítica de datos **estilo Qlik Sense**, local y autocontenida: cargas datos (Excel/CSV o conexiones reales), construyes un modelo, diseñas hojas/dashboards, generas informes PDF y conversas con un asistente de IA que lee tus datos reales (Amazon Bedrock · Nova Micro). Incluye un servidor **MCP** para que agentes externos operen la plataforma.

> Esta documentación describe **qué es cada módulo, cómo funciona por dentro (desarrollo), cómo se ve (visual) y cómo se usa (usuario)**.

---

## Mapa de la documentación

| Documento | Para qué |
|---|---|
| [`arquitectura.md`](./arquitectura.md) | Visión técnica global: stack, capas, cómo corre, flujo de datos. |
| [`glosario.md`](./glosario.md) | Términos del dominio (app, hoja, dimensión, medida, modelo lógico…). |
| [`diagramas.md`](./diagramas.md) | Diagramas de flujo (carga de datos, consulta asociativa, IA, informes, MCP). |
| [`api-referencia.md`](./api-referencia.md) | Catálogo de endpoints REST del backend. |
| **Módulos** | |
| [`modulos/00-login-hub.md`](./modulos/00-login-hub.md) | Login, Inicio, Catálogo, Crear. |
| [`modulos/01-editor-carga.md`](./modulos/01-editor-carga.md) | Editor de carga de datos (script Qlik). |
| [`modulos/02-gestor-datos.md`](./modulos/02-gestor-datos.md) | Gestor de datos: preparación visual (renombrar/tipo/ocultar). |
| [`modulos/03-modelo-datos.md`](./modulos/03-modelo-datos.md) | Visor del modelo de datos (tablas y asociaciones). |
| [`modulos/04-hoja-analizar.md`](./modulos/04-hoja-analizar.md) | Hoja: análisis, selecciones asociativas, gráficos. |
| [`modulos/05-editor-hoja.md`](./modulos/05-editor-hoja.md) | Editor de hoja: construcción de dashboards. |
| [`modulos/06-modelo-logico.md`](./modulos/06-modelo-logico.md) | Modelo lógico (Business Logic de Qlik). |
| [`modulos/07-conexiones.md`](./modulos/07-conexiones.md) | Conexiones de datos reales (S3, Athena, JDBC…). |
| [`modulos/08-informes.md`](./modulos/08-informes.md) | Generador de informes PDF (3 modos + agente). |
| [`modulos/09-asistente-ia.md`](./modulos/09-asistente-ia.md) | Asistente "estrellita" (Bedrock Nova Micro). |
| [`modulos/10-mcp.md`](./modulos/10-mcp.md) | Servidor MCP (TypeScript). |
| [`modulos/11-laboratorio-ml.md`](./modulos/11-laboratorio-ml.md) | Experimentos de ML: 24 algoritmos, historial, comparación y AutoML. |

---

## Cómo correr (resumen)

**Backend (Spring Boot, Java 21):**
```powershell
$env:JAVA_HOME="C:\Program Files\Eclipse Adoptium\jdk-21.0.13.9-hotspot"
& "C:\Users\brayan.fonseca\tools\apache-maven-3.9.9\bin\mvn.cmd" `
  -f ".\backend-springboot\pom.xml" -q -DskipTests spring-boot:run
```
Sirve el frontend y la API en **http://localhost:8080**.

**Frontend:** vanilla JS/ESM en `frontend/` (`pages/`, `css/`, `js/`), servido por el propio backend (no requiere build). Las páginas se abren en `http://localhost:8080/pages/<pagina>.html`. Tras cambios, **Ctrl+F5** para recargar sin caché.

**MCP:** ver [`modulos/10-mcp.md`](./modulos/10-mcp.md).

---

## Estado por módulo (alto nivel)

| Módulo | Estado |
|---|---|
| Login / Hub / Catálogo / Crear | ✅ funcional |
| Editor de carga | ✅ funcional |
| Gestor de datos (preparación visual) | ✅ funcional |
| Visor del modelo de datos | ✅ funcional |
| Hoja (analizar) | ✅ funcional |
| Editor de hoja | ✅ funcional |
| Modelo lógico | ✅ funcional |
| Conexiones reales | ✅ S3 / Athena verificadas; otras implementadas |
| Informes PDF | ✅ 3 modos con análisis especializado (margen, rentabilidad, Pareto, variación) |
| Experimentos de ML | ✅ 24 algoritmos verificados con datos de verdad conocida y QA en navegador |
| Asistente IA (Bedrock Nova Micro) | ✅ funcional |
| MCP (TypeScript) | ✅ funcional |

Esta documentación se actualiza junto con cada cambio funcional o de estructura del repositorio.
