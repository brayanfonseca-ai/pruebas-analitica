# DataSense — plataforma de analítica local estilo Qlik

Plataforma analítica autocontenida inspirada en **Qlik Sense**: cargas datos (Excel, CSV o
conexiones reales), construyes un modelo asociativo, diseñas hojas y dashboards, generas
informes PDF, experimentas con **machine learning** y conversas con un asistente de IA que
lee tus datos reales.

- **Backend** — Spring Boot 3 (Java 21). Única fuente de verdad de datos y cálculo:
  perfilado, asociaciones, consultas agregadas con filtro asociativo, modelo lógico,
  conexiones reales y **experimentos de ML** (24 algoritmos). Persiste en **SQLite** + CSV en disco. Sirve
  también el frontend, así que todo vive en el mismo origen (sin CORS).
- **Frontend** — HTML + CSS + JavaScript ESM, sin framework ni build. Chart.js, jsPDF,
  CodeMirror y SheetJS llegan por CDN.
- **IA** — Amazon Bedrock (Nova Micro) mediante la API Converse.
- **MCP** — servidor TypeScript que expone la plataforma a agentes de IA.

La documentación completa (arquitectura, glosario, diagramas, API y un documento por
módulo) está en [`docs/`](./docs/README.md).

## Estructura del repositorio

```
Preuba/
  frontend/
    pages/            Páginas HTML: index (login), inicio, crear, catalogo, hub, app,
                      experimentos (lista) y experimento (estudio)
    css/              Estilos por módulo (hub, editor, hoja, datos, logico, informes, lab…)
    js/               Módulos ES: app.js (shell) y un módulo por vista (app-*.js)
  backend-springboot/ API REST + motor analítico + servidor del frontend
    src/main/java/io/datasense/
      config/         Base de datos SQLite, servidor de estáticos (WebConfig)
      web/            Controladores REST /api/v1
      engine/         Perfilado, consulta asociativa, overrides, modelo lógico, conexiones
      ml/             Experimentos de ML (controladores, algoritmos, AutoML)
      ai/             Cliente de Amazon Bedrock
      repo/           Repositorios JDBC
      model/          DTOs
    data/             Estado en ejecución (SQLite + CSV). Reseteable, fuera de git
  mcp-server/         Servidor MCP (TypeScript)
  docs/               Documentación técnica y de usuario
  samples/            Datos de ejemplo (datos_demo_ventas.xlsx)
```

Las páginas viven en `frontend/pages/` y referencian sus recursos con `../css/` y `../js/`.
El backend sirve `frontend/` en la raíz web, por lo que las URLs son
`http://localhost:8080/pages/<pagina>.html`; la raíz `/` redirige al login.

## Requisitos

- **JDK 21** (Eclipse Temurin) y **Maven**.
- **Node.js** solo si vas a compilar el servidor MCP (`mcp-server/`).
- Internet en la primera carga del navegador (CDNs de Chart.js, jsPDF, CodeMirror, SheetJS).
- Para el asistente de IA: credenciales AWS en `~/.aws` con acceso a Bedrock (us-east-2).

## Arrancar

Desde `backend-springboot/`:

```powershell
$env:JAVA_HOME="C:\Program Files\Eclipse Adoptium\jdk-21.0.13.9-hotspot"
& "C:\Users\brayan.fonseca\tools\apache-maven-3.9.9\bin\mvn.cmd" -q -DskipTests spring-boot:run
```

Abre **http://localhost:8080/** (puerto 8080). Detener con **Ctrl+C**. Tras cambios en el
frontend basta **Ctrl+F5**; los cambios en Java requieren reiniciar.

## Apariencia: modo claro / oscuro

Identidad visual propia «Neon Grid»: marco oscuro con línea de neón, fondo con rejilla y
aurora, tarjetas con miniaturas generativas y brillo que sigue al cursor.

- Botón **sol/luna** junto a la campana: modo claro / oscuro (se recuerda en el navegador).
- Menú lateral **Temas**: modo (claro, oscuro, sistema), 5 colores de acento, 3 fondos y
  animaciones activables.
- **Ctrl + K** en cualquier página: paleta de comandos para abrir apps, ir a páginas y
  cambiar la apariencia.

Detalle en [`docs/arquitectura.md`](./docs/arquitectura.md).

## Barra superior: menú, ayuda y notificaciones

- **☰ (hamburguesa)**: pliega el menú lateral a una columna de iconos con tooltip; se recuerda.
- **? (Ayuda, también F1)**: centro de ayuda con guía de primeros pasos, manual técnico, preguntas
  frecuentes y atajos, con buscador. Contenido editable en [`frontend/help/ayuda.json`](./frontend/help/ayuda.json).
- **Campana (Notificaciones)**: actividad de la plataforma para el administrador (nuevas apps, datos
  cargados, hojas, colecciones, elementos maestros, conexiones, experimentos y modelos de ML), con
  contador real, filtros, agrupado por día, avisos emergentes y «Marcar todo como leído» / «Vaciar».

## Cuentas de demostración

| Rol    | Correo               | Contraseña |
|--------|----------------------|------------|
| admin  | admin@datasense.io   | admin123   |
| editor | editor@datasense.io  | editor123  |
| viewer | viewer@datasense.io  | viewer123  |

La autenticación del cliente solo proyecta permisos en la interfaz; no es seguridad real.

## Módulos dentro de una aplicación

Se navega con el **selector de vista** de la barra superior (atajos `Alt + Shift + letra`).

| Grupo | Vista | Qué hace |
|---|---|---|
| Analizar | **Hoja** | Dashboards con selecciones asociativas; modo vista y modo edición. |
| Narrar | **Informes** | PDF con métricas de negocio, Pareto, variación y recomendaciones. |
| Ciencia de datos | **Experimentos de ML** | Experimentos de esta app; abre el módulo de Experimentos. |
| Preparar | **Gestor de datos** | Perfilado, vista previa, preparación de campos y asociaciones. |
| Preparar | **Editor de carga** | Script Qlik, ejecución por capas y carga de archivos. |
| Preparar | **Visor del modelo** | Tablas, campos clave y asociaciones. |
| Lógica de negocio | **Modelo lógico** | Clasificación de campos, jerarquías y períodos de calendario. |

Además: asistente de IA flotante, conexiones reales (S3, Athena, JDBC, HTTP) y servidor MCP.
En el Editor de carga, **Conexiones realizadas** lista todas las conexiones creadas; cada una
abre un selector que valida la extracción con una muestra real y genera el script
`LIB CONNECT TO … SQL SELECT …` en paralelo. En Experimentos de ML, **Asociar a…** lleva
el resultado (segmentos, predicciones, atípicos, pronóstico) a una app como tabla del modelo
y hoja nueva que el analista IA puede explicar.
Cada módulo tiene su documento en [`docs/modulos/`](./docs/modulos).

## Experimentos de ML

Módulo propio (**Crear → Experimento de ML** o menú lateral **Experimentos de ML**). Un
experimento apunta a una tabla de cualquier aplicación y tiene tres pestañas: **Datos**
(perfil de variables), **Modelado** (24 algoritmos con variables, hiperparámetros,
resultados y prueba de casos) y **Ejecuciones** (historial guardado, abrir, comparar y
eliminar). Todo en Java puro, sin librerías externas.

| Familia | Algoritmos |
|---|---|
| Segmentación | K-Means · Jerárquico · DBSCAN |
| Exploración | PCA · Correlaciones · Anomalías · Reglas de asociación |
| Regresión | Lineal · Ridge · Lasso · Polinómica · Árbol · Bosque aleatorio · Gradient Boosting · KNN |
| Clasificación | Logística · Naive Bayes · Árbol · Bosque aleatorio · Gradient Boosting · KNN |
| Series y AutoML | Pronóstico · AutoML de regresión y de clasificación |

Datos de ejemplo para probarlo: `samples/clientes_demo_ml.csv`. Detalle en [`docs/modulos/11-laboratorio-ml.md`](./docs/modulos/11-laboratorio-ml.md).

## Datos en ejecución

El backend crea `backend-springboot/data/` al vuelo: `datasense.db` (SQLite con apps, hojas,
conexiones, overrides y modelo lógico) y `tables/<appId>/<tableId>.csv`. Es estado
reseteable: borrar la carpeta reinicia la plataforma. Está excluida de git porque puede
contener credenciales de conexiones.

## Servidor MCP

```powershell
cd mcp-server
& "C:\Program Files\nodejs\npm.cmd" run build
```

El punto de entrada compilado es `mcp-server/dist/src/index.js`. Ver
[`mcp-server/README.md`](./mcp-server/README.md) y [`docs/modulos/10-mcp.md`](./docs/modulos/10-mcp.md).

## Concepto de asociación (Qlik)

Las tablas se asocian automáticamente cuando comparten nombres de campo; compartir más de
un campo entre dos tablas genera una clave sintética que conviene resolver. El motor detecta
ambos casos y los expone como advertencias del modelo. Referencia: <https://help.qlik.com/>.
