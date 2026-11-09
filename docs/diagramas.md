# Diagramas de flujo

Diagramas en [Mermaid](https://mermaid.js.org/) (se renderizan en GitHub y en editores compatibles).

## 1. Arquitectura general

```mermaid
flowchart TB
    U[Usuario / Navegador] -->|fetch /api/v1| B[Spring Boot Backend]
    A[Agente IA externo] -->|stdio| M[Servidor MCP TypeScript]
    M -->|HTTP /api/v1| B
    B --> DB[(SQLite datasense.db)]
    B --> CSV[(CSV por app/tabla)]
    B -->|Converse API| BR[Amazon Bedrock Nova Micro]
    B -->|SDK / JDBC| EXT[Fuentes externas: S3, Athena, BD]
    B -->|sirve| FE[Frontend vanilla JS/ESM]
    FE --> U
```

## 2. Carga de datos (Excel/CSV)

```mermaid
flowchart LR
    F[Archivo .xlsx/.csv] -->|POST /apps/ID/tables| DC[DataController]
    DC --> P[Profiler: infiere text/number/date]
    P --> T[(tables + columns en SQLite)]
    P --> S[TableStore: materializa CSV]
    T --> M[Modelo de datos]
    S --> Q[QueryEngine puede agregar]
```

## 3. Consulta asociativa (Hoja)

```mermaid
flowchart TB
    Click[Usuario hace una selección] --> SEL[selections por campo]
    SEL -->|POST /apps/ID/query| QC[QueryController]
    QC --> QE[QueryEngine]
    QE --> AJ[AssociativeJoin: propaga el filtro entre tablas]
    AJ --> AGG[Agrega la medida por la dimensión]
    AGG --> R[QueryResult labels+values]
    R --> CH[Chart.js pinta el objeto]
```

## 4. Capa de presentación: overrides y modelo lógico

```mermaid
flowchart LR
    RAW[Columna física del CSV] --> OV[field_overrides: rename / forced_type / hidden]
    OV --> FIELDS[GET /fields: display, type efectivo, hidden]
    FIELDS --> LM[LogicalModelService: clasifica dimension/measure/date]
    LM --> DOC[Modelo lógico: fields, grupos, jerarquías, calendario]
    FIELDS --> HOJA[Rótulos y roles en la Hoja]
    DOC --> IA[El asistente interpreta mejor los datos]
```

## 5. Asistente de IA (estrellita)

```mermaid
flowchart TB
    Pregunta[Usuario pregunta en el chat] --> CTX[buildContext: datos del módulo]
    CTX -->|POST /ai/modelar o /analizar o /disenar| AIC[AiController]
    AIC --> BS[BedrockService: Converse]
    BS --> NOVA[Nova Micro us-east-2]
    NOVA --> RESP[ok + message + action?]
    RESP --> REND[estrellita.js: Markdown + botón de acción]
    REND -->|action build-sheet| APPLY[applyPlan crea objetos en la hoja]
```

## 6. Generación de informes PDF

```mermaid
flowchart TB
    Modo{Modo} -->|Plantilla| TPL[Plantilla base]
    Modo -->|Desde una hoja| SH[listSheets: objetos reales]
    Modo -->|Conversacional| CHAT[specFromPrompt: el agente arma la spec]
    TPL --> DATA[query: datos reales]
    SH --> DATA
    CHAT --> PREV[Vista previa en vivo]
    PREV --> DATA
    DATA --> CHARTS[Chart.js a imagen PNG]
    DATA --> NARR[Agente redacta análisis]
    CHARTS --> PDF[jsPDF + autotable]
    NARR --> PDF
    PDF --> DL[Descarga .pdf]
```

## 7. Conexión de datos real

```mermaid
flowchart LR
    CFG[Config de conexión] -->|POST /connections/test| CC[ConnectionController]
    CC --> EX{ConnectionExecutor}
    EX -->|s3| S3[S3Executor: HeadBucket / lee objeto]
    EX -->|athena| AT[AthenaExecutor: StartQueryExecution]
    EX -->|postgres/mysql/...| JDBC[JdbcExecutor: SELECT real]
    EX -->|rest/webfile| HTTP[HttpExecutor: GET]
    S3 & AT & JDBC & HTTP --> RES[ok real o error real de la fuente]
    RES -->|POST /connections/ID/load| MAT[Materializa tabla en el motor]
```

## 8. MCP (agente externo opera la plataforma)

```mermaid
flowchart TB
    AG[Agente / Kiro] -->|initialize + tools/list| MCP[Servidor MCP stdio]
    AG -->|tools/call| MCP
    MCP -->|list_apps / read_table / run_query / create_sheet| API[/api/v1 del backend/]
    API --> MCP
    MCP --> AG
```

## 9. Navegación de la app (router in-app)

```mermaid
flowchart LR
    CAT[Catálogo] -->|abrir app| APP[pages/app.html?app=ID]
    APP --> SEL[Selector de vista]
    SEL --> G[General]
    SEL --> H[Hoja / Analizar]
    SEL --> I[Informes]
    SEL --> D[Gestor de datos]
    SEL --> E[Editor de carga]
    SEL --> MO[Visor del modelo]
    SEL --> L[Modelo lógico]
```

## 10. Laboratorio de ML

```mermaid
flowchart LR
    T[Tarjeta de algoritmo] -->|Abrir| W[Flujo guiado]
    T -->|Ejecutar ejemplo| EX[Configuración automática]
    W --> D[1 Datos] --> V[2 Variables] --> P[3 Parámetros] --> TR[4 Entrenar]
    EX --> TR
    TR -->|POST /ml/run| C[MlController]
    C --> S[TableStore: CSV de la tabla]
    C --> M[MlService: algoritmo]
    M --> R[Resultado: métricas, gráficos, lectura]
    R --> RS[5 Resultados]
    RS --> CASO[6 Probar un caso / Muestra]
    CASO -->|POST /ml/run con input| C
```
