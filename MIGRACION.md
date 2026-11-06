# Migración a stack profesional: Spring Boot + Angular

Este documento resume la migración del stack actual (FastAPI + JS vanilla) a un
stack de desarrollo profesional: **Spring Boot (Java)** en el backend y
**Angular + TypeScript** en el frontend. La migración es **incremental**: el
stack actual sigue funcionando mientras el nuevo se completa.

## Estado actual (verificado)

### Backend — Spring Boot 3.3.5 / Java 21  ✅ compila y corre
Carpeta: `backend-springboot/`

- Compila con Maven (`target/classes` generado sin errores).
- Arranca en **http://localhost:8080** (Tomcat embebido, ~3 s).
- API REST bajo `/api/v1`, **mismo contrato** que el backend Python, así el
  frontend no nota la diferencia:
  - `GET/POST/DELETE /api/v1/apps`  — verificado (crear/listar/eliminar).
  - `GET/POST/DELETE /api/v1/collections` — verificado (crear/listar).
- Persistencia **SQLite** (`spring-boot-starter-jdbc` + `sqlite-jdbc`), esquema
  creado al arrancar (apps, tables, columns, app_sheets, master_items, collections).
- Dependencias listas para la carga de datos: Apache POI (Excel) + Commons CSV.

#### Cómo correrlo
```powershell
$env:JAVA_HOME="C:\Program Files\Eclipse Adoptium\jdk-21.0.13.9-hotspot"
cd backend-springboot
& "C:\Users\brayan.fonseca\tools\apache-maven-3.9.9\bin\mvn.cmd" spring-boot:run
```
(JDK 21 ya instalado en `C:\Program Files\Eclipse Adoptium\`; Maven portable en
`C:\Users\brayan.fonseca\tools\apache-maven-3.9.9`.)

### Frontend — Angular 18 + TypeScript  ⏳ andamiado (falta `npm install`)
Carpeta: `frontend-angular/`

- Proyecto Angular standalone completo: `package.json`, `angular.json`,
  `tsconfig*.json`, `proxy.conf.json` (proxya `/api` → `http://localhost:8080`).
- Código portado del frontend vanilla:
  - `src/app/models.ts` — modelos TypeScript (apps, colecciones, tablas, hojas, query).
  - `src/app/api.service.ts` — cliente HTTP de `/api/v1` (equivale a `js/api.js`).
  - `src/app/catalog.component.ts` — Catálogo (lista/crea/elimina apps).
  - `src/app/collections.component.ts` — Colecciones (CRUD contra el backend).
  - `src/app/app.component.ts` — shell (topbar + sidebar + router).
- **No se pudo compilar aún** porque esta máquina no tiene `npm` en el PATH
  (el `node` disponible es el runtime embebido de la herramienta, sin npm).

#### Cómo completarlo
1. Instalar Node.js LTS (incluye npm): https://nodejs.org  (o `winget install OpenJS.NodeJS.LTS`).
2. ```powershell
   cd frontend-angular
   npm install
   npm start        # ng serve con proxy al backend Spring Boot (8080)
   ```
3. Build de producción: `npm run build` → `dist/datasense/`. Para servirlo desde
   Spring Boot, apuntar `WebConfig` a esa carpeta.

### Motor analítico portado a Java  ✅ verificado end-to-end
Paquete `io.datasense.engine`:
- `Profiler` — infiere tipo lógico {text, number, date} y cuenta nulos/distintos
  (umbral 0.8, igual que `engine/profiling.py`).
- `TableReader` — lee CSV (Commons CSV) y Excel .xlsx (Apache POI) a un `DataFrame`.
- `TableStore` — persiste cada tabla en disco (`data/tables/{appId}/{tableId}.csv`).
- `QueryEngine` — agrupa por dimensión y agrega medidas (sum/avg/count/min/max),
  aplicando selecciones como filtro asociativo de tabla única.
- Controllers nuevos: `DataController` (subir/listar tablas con perfilado) y
  `QueryController` (`/query` y `/fields/{field}/values`).

Verificado (subida de CSV real + consultas):
- Perfilado: Region/Categoria→text, Ventas/Unidades→number.
- Agregación por región (sum): Norte=34000, Sur=27900, Centro=16500.
- Filtro asociativo (Categoria=Electronica): Norte=25700, Sur=15200, Centro=9800.
- KPI: sum=78400, avg=9800.

### Asociaciones + agregación multi-tabla  ✅ verificado
Paquete `io.datasense.engine`:
- `Associations` — recomienda enlaces entre tablas que comparten campos con el
  mismo nombre (confianza por solapamiento Jaccard) y construye el grafo del modelo.
- `AssociativeJoin` — une la tabla de la dimensión con la(s) de medidas por la
  clave compartida, pre-agregando cada medida a su grano (ANTI-FAN-OUT).
- `QueryEngine` detecta automáticamente el caso multi-tabla y usa el join.
- `ModelController` expone `/associations/recommend` y `/model`.

Verificado (dos tablas enlazadas por `RegionId`):
- Asociación: regiones_dim ↔ ventas_fact por RegionId, confianza 1.0.
- Query multi-tabla (Ventas por Region, tablas distintas): Norte=34000, Sur=27900,
  Centro=16500 — iguales al caso de tabla única, sin duplicar medidas.

### Limpieza de código muerto del frontend viejo
Eliminados (huérfanos del era pre-backend; nadie los importaba):
`js/aggregate.js`, `js/chart-render.js`, `js/importer.js`. La agregación, el
render de gráficas y la lectura de archivos ya viven en el backend / `hoja-render.js`.

### Paridad de API alcanzada  ✅ verificado endpoint por endpoint
El backend Spring Boot ahora implementa TODOS los endpoints que consume el
frontend (`js/api.js`), así ninguna vista se rompe sobre el motor Java:
- apps, collections, tables (upload/list/get/delete), fields, fields/values,
  query (single + multi-tabla asociativa), associations (recommend + CRUD),
  model, **master-items (CRUD)**, **expressions/parse**, **script (get/put/run)**,
  sheets (CRUD + visibility).
- `expressions/parse` porta la gramática fx de `engine/expressions.py`
  (`Sum([Campo])`, `[Dim]`…) a `engine/Expressions.java`, sin eval.
- `script` genera un QDF a partir de las tablas, guarda ediciones y "run"
  reconstruye el modelo con log por tabla.

Comprobado con una app real (subida de CSV + llamadas a cada endpoint): todos
responden OK con el mismo contrato JSON que el backend Python.

## Qué falta para completar la migración (siguiente iteración)
- Intérprete de script Qlik COMPLETO (ejecutar LOAD/JOIN/WHERE/GROUP BY…); hoy
  `script/run` reconstruye y reporta, suficiente para que la vista funcione.
- Propagación asociativa en cadenas de 3+ tablas (hoy el join resuelve el enlace
  directo dimensión↔medida, que cubre los modelos actuales).
- Portar el resto de vistas del frontend a componentes Angular.
- Tests: JUnit (Spring) y Karma/Jasmine (Angular).

## Sobre "subir el nuevo"
Este workspace no es un repositorio git (no hay `.git`). Para publicar la
migración necesito que indiques el remoto (GitHub/GitLab) o que autorices
`git init` + primer commit local. No se ha subido nada a ningún remoto.

## Nota de alcance
El backend Python (`backend/`) y el frontend vanilla siguen siendo la versión
**funcional completa** mientras la migración avanza. Spring Boot ya demuestra el
camino (API equivalente, verificada); Angular queda listo para compilar en
cuanto haya `npm`.
