# DataSense — plataforma de analítica local estilo Qlik

Mini-plataforma analítica inspirada en **Qlik Sense**. Tiene dos partes:

- **Backend Spring Boot (Java 21)**: un **motor** que es la única fuente de
  verdad del **modelo de datos** y de las **agregaciones** (perfilado de columnas,
  detección de asociaciones, agregación con anti *fan-out* + filtro asociativo,
  carga de Excel/CSV y validador de expresiones `fx`). El mismo proceso sirve
  además el frontend estático, así que **todo vive en el mismo origen sin CORS**.
  Persistencia en **SQLite** (`backend-springboot/data/datasense.db`) + tablas en
  disco (CSV).
- **Frontend estático** (HTML + CSS + JavaScript módulos ES, sin framework ni build):
  solo **renderiza lo que el backend devuelve**. Las librerías de terceros llegan
  **solo por CDN**.

> El backend Python (FastAPI) original fue **migrado a Spring Boot** y eliminado.
> Ver `MIGRACION.md` para el detalle de la migración y la paridad de endpoints.

## Requisitos

- **JDK 21** (Eclipse Temurin). En esta máquina está en
  `C:\Program Files\Eclipse Adoptium\jdk-21.0.13.9-hotspot`.
- **Maven** (portable en `C:\Users\brayan.fonseca\tools\apache-maven-3.9.9`).
- **No** se necesita Node/npm para el frontend actual (no hay build de JS).
- La **primera carga** del frontend necesita internet para las CDNs
  (Chart.js, CodeMirror 5, SheetJS).

## Arrancar el servidor

Desde la carpeta **`backend-springboot/`**:

```powershell
cd backend-springboot
$env:JAVA_HOME="C:\Program Files\Eclipse Adoptium\jdk-21.0.13.9-hotspot"
& "C:\Users\brayan.fonseca\tools\apache-maven-3.9.9\bin\mvn.cmd" spring-boot:run
```

Abre **http://localhost:8080/** · Detener: **Ctrl+C**.

> Usa el puerto **8080**. Si estaba ocupado por una ejecución anterior, ciérrala antes.

## Cuentas por defecto

Se siembran tres usuarios (uno por rol) en el primer uso del login:

| Rol    | Correo                 | Contraseña |
|--------|------------------------|------------|
| admin  | admin@datasense.io     | admin123   |
| editor | editor@datasense.io    | editor123  |
| viewer | viewer@datasense.io    | viewer123  |

- **admin** → **todos los permisos**, sin excepción.
- **editor** → importa/edita datos y crea/edita gráficas.
- **viewer** → solo ve la analítica.

> **La autenticación del cliente NO es seguridad real.** Las contraseñas demo viven en
> `localStorage` y el token es simulado; la UI solo *proyecta* permisos. En un
> despliegue real, la autorización verdadera la impondría el **backend** (guards por
> rol sobre los endpoints del motor Python). El gating actual es solo de interfaz.

## Flujo de la aplicación

1. **Login** (`http://localhost:8080/` → `index.html`) → **Inicio** (hub).
2. **Catálogo** (`catalogo.html`): lista/crea/abre aplicaciones. También puedes entrar
   desde **Crear → Aplicación**.
3. Dentro de una app (`app.html?app=<id>`) se navega como en **Qlik Sense**: no hay
   menú lateral, solo el **selector de vista** de la barra superior, agrupado en
   *Inicio / Analizar / Narrar / Preparar / Lógica de negocio*, con atajos
   **Alt + Shift + letra**. Las vistas que aún no existen (General, Narración, Informes,
   Modelo lógico, Vocabulario) aparecen en gris como *Próximamente*. La vista por
   defecto es **Hoja**. Vistas disponibles:
   - **Gestor de datos** — sube `.csv/.xlsx/.xls` al backend; muestra el **perfilado de
     columnas** (tipo texto/número/fecha, nulos, distintos), una **vista de burbujas**
     de asociaciones, acepta **asociaciones recomendadas**, crea **asociaciones
     personalizadas** y muestra un **banner de advertencia** de clave sintética.
   - **Editor de carga** — layout de 3 regiones estilo Qlik: lista de **Secciones**
     (capas QDF Extract/Transform/Model, reordenables) a la izquierda, el **script QDF
     auto-generado** en **CodeMirror 5** (modo SQL, con **números de línea**) al centro
     con una mini-toolbar (Secciones/Buscar/Historial/Depurar), y un panel **Añadir
     datos** a la derecha ("Añadir desde el catálogo de datos" es un stub
     *Próximamente*; **Seleccionar archivo** sube de verdad). El botón verde **Cargar
     datos** ejecuta la carga en el backend y vuelca la **consola por capas**
     (Extract → Transform → Model).
   - **Visor del modelo** — lienzo estilo Qlik: cada tabla es una **caja** (cabecera con
     nombre y nº de filas, una fila por campo, **campos clave marcados**) y las
     asociaciones se dibujan como **líneas SVG** entre cajas con su etiqueta
     (1:1 / 1:N / N:N). Un **rail de zoom** a la derecha acerca/aleja/ajusta. Se
     conservan las **advertencias** de clave sintética y referencia circular.
   - **Hoja** (Analizar) — dos modos, como en Qlik:
     - **Modo vista**: los objetos de la hoja. Un clic en un valor (panel de filtrado,
       barra, porción, fila de tabla) es una **selección** que el motor propaga de forma
       asociativa. La **barra de selecciones** muestra los chips por campo, con
       atrás/adelante y borrar. El panel de filtrado pinta los estados
       **seleccionado / posible / alternativo / excluido** calculados por el motor.
     - **Modo edición** (**Editar hoja**): barra de herramientas (cortar, copiar, pegar,
       eliminar, deshacer, rehacer, Propiedades), **riel de activos** (Hojas,
       Marcadores, Disparadores, Campos, Elementos maestros, Gráficos, Análisis, Objetos
       personalizados, Variables), **rejilla de 24 columnas** y **panel de propiedades**.
       Los gráficos se **arrastran** desde *Gráficos* a la rejilla (sombra verde
       "Crear nuevo gráfico"), se **mueven** y se **redimensionan** con asas, sin
       superponerse. El objeto nuevo entra vacío y pide sus **roles** (p. ej. *Línea* /
       *Altura de línea*). **Añadir** abre un catálogo con buscador, elementos
       maestros, campos y **fx** (expresión validada por el motor). Arrastrar un campo
       o elemento maestro sobre un objeto lo añade; soltarlo en la rejilla crea un panel
       de filtrado (dimensión) o un KPI (medida).
     - **Propiedades del objeto** en acordeón: *Datos* (dimensiones, medidas, filtros
       propios del objeto), *Ordenar*, *Módulos adicionales* (limitación Top N, líneas
       de referencia) y *Aspecto* (General, Presentación, Colores y leyenda, Ejes,
       Información sobre herramientas). Sin objeto seleccionado se ven las
       **Propiedades de hoja** (título, descripción, espaciado de rejilla, Ampliar hoja).
     - **Crear nueva hoja** abre las **plantillas** (Destacadas, Todas, Recientes,
       Favoritas, Categorías). Una plantilla deja casillas vacías ubicadas en la
       rejilla, o se puede **crear sin plantilla**.
     - Tipos implementados: barras, líneas/área, tarta/dona, combinado, dispersión,
       KPI, tabla simple (totales calculados por el motor), panel de filtrado y texto.
       El resto del catálogo de Qlik se muestra como *Próximamente*.
     - Las hojas y los **elementos maestros** se guardan **en el motor** (SQLite), con
       guardado automático. Si un elemento maestro cambia, todos los gráficos que lo
       usan se actualizan.

## Flujo manual de verificación (E2E)

1. Abre **http://localhost:8080/** y entra con **admin@datasense.io / admin123**.
2. **Catálogo → Crear aplicación** → abre la app.
3. **Gestor de datos**: sube **2 CSV/Excel que compartan UNA columna clave** → observa
   el perfilado de columnas y la **asociación recomendada**; acéptala.
4. Sube un **par que comparta DOS columnas** → aparece la **advertencia de clave
   sintética**.
5. **Visor del modelo**: cajas de tabla con campos (claves marcadas) + **líneas SVG**
   entre tablas asociadas + rail de zoom + advertencias.
6. **Editor de carga**: lista de **Secciones**, script auto-generado (RAW_/QVD_/FACT_)
   con **números de línea**; pulsa **Cargar datos** y mira la consola por capas.
7. **Hoja**: pulsa **Editar hoja** → *Hojas* → **Crear nueva hoja** → elige una
   plantilla o *Crear sin plantilla*. Desde *Gráficos* arrastra un **Gráfico de barras**
   a la rejilla, pulsa **Añadir** en Dimensiones y en Medidas, y prueba **fx** con
   `Sum([TuCampo])`. Crea una **medida maestra** en *Elementos maestros* y arrástrala al
   gráfico. Pulsa **Listo**, haz clic en un valor del panel de filtrado y confirma que
   los demás objetos cambian **sin multiplicar los totales**. Recarga: la hoja se
   conserva, porque está guardada en el motor.
8. La consola de devtools debe quedar **sin errores**.

## Implementado vs. pendiente

- **Implementado**: catálogo de apps; subida/perfilado; asociaciones recomendadas y
  personalizadas; detección de clave sintética y referencia circular; modelo
  (nodos/enlaces/advertencias); script QDF + ejecución por capas; consultas de gráfica
  y KPI con anti *fan-out* y filtro asociativo; todos los tipos de Chart.js.
- **Implementado (Hoja)**: hojas y elementos maestros persistidos en el motor
  (`/sheets`, `/master-items`); analizador **fx** seguro (sin `eval`) en
  `/expressions/parse`; valores de campo con estado asociativo en `/fields/values`;
  la rejilla se valida en el servidor (dentro de 24 columnas, sin superposición).
- **Editor de carga que SE EJECUTA**: si el script fue editado, "Cargar datos" lo
  **interpreta de verdad** en el motor Python (`engine/script_engine.py`) y reconstruye
  el modelo. Subconjunto soportado del lenguaje de carga de Qlik: `SET`/`LET` con
  `$(var)`, `LOAD` con alias `AS` y evaluador de expresiones seguro (sin `eval`),
  `RESIDENT` / `INLINE` / `FROM`, `WHERE`, `GROUP BY` con `Sum/Count/Avg/Min/Max`,
  `JOIN`/`LEFT/INNER/OUTER JOIN`, `CONCATENATE`, `STORE ... INTO (qvd/parquet/csv)`,
  `DROP TABLE`, `RENAME TABLE` y secciones `///$tab`. Los errores reportan el número de
  línea. Las instrucciones de control (`FOR`, `IF`, `SUB`…) no están soportadas. El
  panel "Añadir datos" trae Conexiones (DataFiles local; Athena/S3/Bedrock como
  *Próximamente*), Seleccionar archivo, Insertar Store e Incluir script.
- **Catálogo de gráficos completo**: los 41 objetos del panel Gráficos están
  disponibles y se arrastran (barras, línea, área, tarta, dona, combinado, dispersión,
  radar, mekko, treemap/bloques, heatmap/cuadrícula, embudo, cascada, boxplot,
  histograma, indicador/gauge, KPI con comparación, bullet, sankey, pivot, tabla,
  organigrama/red, mapa en lista, nube de palabras, y objetos de cuadro de mando: texto,
  imagen, vídeo, botón, contenedores, menú de navegación, línea, etc.).
- **Limitaciones del `fx` de la Hoja**: las expresiones de elementos maestros aceptan
  `Sum/Avg/Count/Min/Max([campo])` y dimensiones de campo; sin aritmética,
  `Count(DISTINCT)` ni set analysis. Las selecciones viven en la sesión del navegador.
- **Próximamente**: marcadores, variables, estados alternos, disparadores, análisis
  asistidos, títulos con expresión, narración, informes, modelo lógico, vocabulario
  y el resto de tipos de gráfico del catálogo.
- **Diferido**: orígenes de datos externos (bases de datos/nube); seguridad real de
  backend.
- Las hojas creadas con la vista *Analizar* anterior estaban en `localStorage`
  (`datasense.sheet.<appId>`) y no se migran.

## Estructura

```
Preuba/
  index.html            # login
  inicio.html           # hub Inicio
  crear.html            # hub Crear (la tarjeta "Aplicación" crea y abre una app)
  catalogo.html         # lista/crea/abre aplicaciones
  app.html              # marco in-app (selector de vista agrupado, ?app=<id>)
  css/
    hub.css             # tema claro Qlik (tokens --q-green #0a8f3c / acento #178923)
    editor.css          # editor 3-paneles + componentes in-app (burbujas, modelo)
    hoja.css            # Hoja: toolbar, riel, rejilla, objetos, propiedades, plantillas
  js/
    hub-nav.js          # chrome centralizado del hub (sidebar/topbar, NAV/ICON/svg/renderNav)
    api.js              # wrapper fetch de /api/v1 (mismo origen, sin CORS)
    auth-service.js     # auth + permisos por rol (admin = todo) — SOLO gating de UI
    auth.js             # controlador del login
    store.js            # estado de CLIENTE: sesión/usuarios/tema/prefs (los datos viven en backend)
    inicio.js / crear.js / catalogo.js
    app.js              # router de la app (carga perezosa de las 4 vistas + selector de vista)
    app-datos.js        # Gestor de datos (subida, perfilado, burbujas de asociación)
    app-editor.js       # Editor de carga (3 regiones: Secciones + CodeMirror + Añadir datos)
    app-modelo.js       # Visor del modelo (cajas + líneas SVG + rail de zoom)
    app-hoja.js         # Hoja: modos vista/edición, rejilla, arrastrar/soltar, propiedades
    chart-types.js      # registro de tipos de objeto (roles, tamaño, presentación)
    hoja-render.js      # dibujo de cada objeto con lo que devuelve el motor
    hoja-templates.js   # plantillas de "Crear nueva hoja" y miniaturas de diseño
    sheet-menu.js       # menú "···" de la hoja
  backend-springboot/   # Backend Spring Boot (Java 21) — ver MIGRACION.md
    pom.xml
    src/main/java/io/datasense/
      DataSenseApplication.java
      config/           # DatabaseConfig (SQLite + esquema), WebConfig (frontend estático)
      engine/           # motor: Profiler, DataFrame, TableReader, TableStore,
                        #        QueryEngine, AssociativeJoin, Associations, Expressions
      repo/             # repositorios JDBC (apps, collections, tables, sheets, master, assoc)
      web/              # controllers REST /api/v1 (app, collection, data, query, model,
                        #                          sheet, master, script)
      model/            # records (DTO) del contrato JSON
    data/               # ESTADO EN TIEMPO DE EJECUCIÓN (ver abajo)
  frontend-angular/     # frontend Angular (andamiado; requiere npm — ver MIGRACION.md)
```

## Datos en tiempo de ejecución

El backend crea **`backend-springboot/data/`** al vuelo: un SQLite de metadatos
(`apps/tables/columns/associations/app_sheets/master_items/collections`) y los datos
por app en disco, bajo `data/tables/<app_id>/<table_id>.csv`. **Es estado reseteable**:
puedes borrar `backend-springboot/data/` para empezar de cero.

## Dependencias de frontend (CDN)

- **Chart.js 4.4.x** — gráficas.
- **CodeMirror 5** (`5.65.16`, modo `sql`) — editor del script de carga.
- **SheetJS / xlsx 0.18.5** — previsualización opcional de archivos en el cliente (la
  lectura y el perfilado autoritativos ocurren en el backend).

## Concepto de asociación (Qlik)

El modelo asociativo sigue la idea de Qlik: las tablas se **asocian automáticamente
cuando comparten nombres de campo**, y compartir **más de un campo** entre dos tablas
genera una **clave sintética** que conviene resolver. El motor Python detecta ambos
casos y los expone como advertencias del modelo. Contenido reformulado para cumplir con
las restricciones de licencia; ver la documentación oficial de Qlik sobre asociación de
datos y claves sintéticas en <https://help.qlik.com/>.
