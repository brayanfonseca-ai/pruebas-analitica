# Arquitectura

## Visión general

DataSense es una aplicación **cliente-servidor monolítica local**:

- **Backend**: Spring Boot (Java 21). Expone una API REST bajo `/api/v1/**`, sirve el frontend estático y es la **única fuente de verdad** de los datos (apps, tablas, hojas, modelo, conexiones, modelo lógico). Persiste en **SQLite** (`backend-springboot/data/datasense.db`) y materializa las tablas como **CSV** en `backend-springboot/data/tables/<appId>/<tableId>.csv`.
- **Frontend**: HTML + CSS + **JavaScript vanilla (ESM)** en la carpeta `frontend/` (`pages/`, `css/`, `js/`), servida por el backend (`WebConfig` apunta a `../frontend/`). La raíz `/` redirige a `/pages/index.html`. No hay framework ni paso de build. Chart.js, jsPDF y SheetJS se cargan por CDN.
- **IA**: el backend llama a **Amazon Bedrock (Nova Micro)** vía la API Converse, usando un *inference profile* en `us-east-2`. Las credenciales salen de `~/.aws` (DefaultCredentialsProvider); nunca se hardcodean ni llegan al navegador.
- **MCP**: un servidor aparte en **TypeScript/Node** que expone la plataforma como herramientas para agentes de IA, consumiendo la misma API REST.

```
Navegador (vanilla JS/ESM)
      │  fetch /api/v1/**
      ▼
Spring Boot  ───────────────►  Amazon Bedrock (Nova Micro, us-east-2)
  ├─ web/      controladores REST
  ├─ engine/   motor analítico (perfilado, consulta asociativa, conexiones)
  ├─ repo/     acceso a SQLite
  └─ data/     datasense.db + tables/<appId>/*.csv

Servidor MCP (TypeScript) ──► consume /api/v1/** del mismo backend
```

## Stack y herramientas

| Pieza | Tecnología |
|---|---|
| Backend | Java 21 (Temurin), Spring Boot 3.3.5, Maven |
| Persistencia | SQLite (`org.xerial:sqlite-jdbc`) + CSV en disco |
| Lectura de datos | Apache POI (Excel), Commons CSV |
| IA | AWS SDK v2 `bedrockruntime` (Converse API) |
| Conexiones reales | AWS SDK v2 (S3, Athena), JDBC (Postgres/MySQL/SQL Server/…), HTTP |
| Frontend | HTML/CSS/JS ESM, Chart.js 4, jsPDF 2.5 + autotable, SheetJS |
| MCP | TypeScript, `@modelcontextprotocol/sdk`, Node 26 |

## Estructura del backend (`io.datasense`)

```
config/    DatabaseConfig (SQLite + esquema), WebConfig (sirve el frontend)
web/       Controladores REST:
           AppController, DataController, QueryController, ModelController,
           SheetController, MasterController, ScriptController, CollectionController,
           ConnectionController, FieldOverrideController, LogicalModelController,
           AiController, RootController
ml/        MlController, MlService (7 algoritmos), MlMath (álgebra y estadística)
engine/    Profiler (infiere tipos), DataFrame, TableReader, TableStore (CSV),
           QueryEngine (agregación + asociativo), AssociativeJoin, Associations,
           Expressions, FieldOverrides, EffectiveFields, LogicalModelService,
           connect/ (ConnectionExecutor: S3, Athena, JDBC, HTTP, stubs),
           ai/ BedrockService
repo/      AppRepository, TableRepository, SheetRepository (+SheetObjectNormalizer),
           CollectionRepository, MasterItemRepository, AssociationRepository,
           ConnectionRepository, FieldOverrideRepository, LogicalModelRepository, Ids
model/     AppModels (DTOs)
```

## Estructura del frontend (`frontend/js/`)

```
app.js            Shell de la app in-app (?app=<id>), router de vistas
app-editor.js     Editor de carga de datos
app-datos.js      Gestor de datos (preparación visual)
app-modelo.js     Visor del modelo de datos
app-hoja.js       Hoja: vista (analizar) + edición (construir dashboard)
app-logico.js     Modelo lógico (Business Logic)
app-informes.js   Generador de informes PDF
app-lab.js        Laboratorio de ML (tarjetas + flujo guiado)
estrellita.js     Widget del asistente de IA (flotante, fullscreen, historial)
conn-hub.js       Apertura de conexiones desde el hub
connections.js    Catálogo + asistente de conexiones de datos
hoja-render.js    Render de gráficos (Chart.js) y tablas
hoja-templates.js Plantillas de hoja; constantes de rejilla
chart-types.js    Catálogo de tipos de objeto/gráfico + PALETTE
api.js            Cliente REST (fetch) de todos los endpoints
auth.js / auth-service.js / store.js   Sesión y estado del cliente
hub-nav.js / inicio.js / hub.js / crear.js / catalogo.js   Hub
```

## Estructura del repositorio

```
frontend/             pages/ (HTML), css/, js/
backend-springboot/   API + motor + servidor de estáticos (data/ = estado, fuera de git)
mcp-server/           Servidor MCP (TypeScript)
docs/                 Esta documentación
samples/              Datos de ejemplo
```

El proyecto no incluye pruebas automáticas ni scaffolds sin uso; la verificación se hace
contra el servidor en ejecución.

## Modelo de datos (SQLite)

Tablas principales: `apps`, `tables`, `columns`, `app_sheets`, `collections`,
`master_items`, `associations`, `connections`, `field_overrides`, `logical_model`.
Los **datos** de cada tabla no viven en SQLite sino como **CSV** por app/tabla
(`TableStore`), para que el motor los lea y agregue.

## Flujo de datos (resumen)

1. **Cargar**: el usuario sube Excel/CSV → `DataController` lo perfila (`Profiler`
   infiere text/number/date), crea la tabla en SQLite y materializa el CSV.
2. **Script**: `ScriptController` genera/ejecuta un script Qlik (`LOAD ... FROM
   [lib://DataFiles/...]`) y reconstruye el modelo.
3. **Modelo**: `ModelController` expone tablas y asociaciones (por nombre de campo).
4. **Consulta**: la Hoja llama `QueryController /query`; `QueryEngine` agrega sobre
   el CSV y propaga **selecciones asociativas** entre tablas.
5. **Capa de presentación**: `field_overrides` (renombrar/tipo/ocultar) y
   `logical_model` (clasificación, grupos, jerarquías) ajustan cómo se interpretan
   los campos sin tocar el dato físico.
6. **Laboratorio de ML**: `MlController /ml/run` lee la tabla desde `TableStore`, ejecuta el algoritmo en `MlService` y devuelve métricas, datos de gráficos y una lectura del resultado.
7. **IA / Informes / MCP** consumen lo anterior vía REST.

## Seguridad

- Credenciales AWS: solo en `~/.aws`, nunca en el repo ni en el navegador.
- Secretos de conexiones: enmascarados en las respuestas (`ConnectionRepository`).
- El repositorio git excluye `data/` (base de datos con conexiones), `target/`,
  `node_modules/`, credenciales y temporales (`.gitignore`).
