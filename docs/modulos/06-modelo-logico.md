# Módulo: Modelo lógico (Business Logic)

Capa conceptual de metadatos sobre el modelo, equivalente a la **Lógica de negocio** de Qlik Sense. Define cómo se interpretan los campos para el análisis y el asistente.

## A nivel de usuario
Vista con pestañas (selector de vista → Lógica de negocio → **Modelo lógico**, `Alt+Shift+G`):
- **General**: tarjetas resumen — campos visibles/ocultos/excluidos, nº de grupos (calendario/medida/dimensión), jerarquías, períodos de calendario, y el estado habilitado/deshabilitado de la lógica. Botones **Restablecer** (regenera desde los datos) y **Habilitar/Deshabilitar la lógica**.
- **Campos y grupos**: tabla editable por clic — clasificación (**Dimensión / Medida / Fecha**), visibilidad (Visible/Oculto/Excluido), búsqueda de valores (sí/no) y **agregación por defecto** (Suma/Promedio/Conteo/—). Los cambios se guardan al instante.
- **Jerarquías**: crear rutas de desglose (p.ej. Región › Categoría) marcando campos en orden.
- **Períodos del calendario**: si hay un campo clasificado como fecha, crear períodos (Día/Mes/Trimestre/Año); si no hay fecha, lo indica.

## A nivel visual
- Tarjetas y tablas con acento azul de marca; modales para crear jerarquías y períodos. Estilos en `frontend/css/logico.css` (clases `lm-*`).

## A nivel de desarrollo
- Backend (ya era la fuente de verdad):
  - `LogicalModelController` — `GET` (genera default desde los datos + mezcla lo guardado + `summary` + `enabled`), `PUT`, `reset`, `enable`/`disable`, y CRUD de `groups/packages/hierarchies/behaviors/calendar-periods`. Contrato defensivo (404/400, nunca 500).
  - `LogicalModelService` — genera la lógica por defecto: `number→measure/sum`, `date→date`, `text→dimension`; respeta los **field-overrides** (display, tipo forzado, oculto); `merge` superpone los ajustes del usuario; `summarize` calcula los conteos.
  - `LogicalModelRepository` — tabla `logical_model` (doc JSON + enabled).
- Frontend: `frontend/js/app-logico.js` (vista con pestañas) + wrappers en `frontend/js/api.js` (`getLogicalModel`, `putLogicalModel`, `resetLogicalModel`, `enable/disableLogicalModel`, `addHierarchy`, `addCalendarPeriod`, …). Activado en el router de `frontend/js/app.js` (key `logico`).

## Documento del modelo
```
{ enabled, summary, fields:[{table, field, display, classification,
  type, visibility, dataValueSearch, defaultAggregation, hiddenByOverride}],
  groups[], packages[], hierarchies[], behaviors[], calendarPeriods[] }
```

## Nota de datos
La clasificación depende del **tipo inferido** del campo. Si una tabla quedó con
un tipo mal perfilado (p.ej. una dimensión de texto detectada como número),
recarga el origen limpio para que la clasificación sea correcta.

## Archivos
`frontend/js/app-logico.js`, `frontend/css/logico.css`,
`backend: web/LogicalModelController.java`, `engine/LogicalModelService.java`, `repo/LogicalModelRepository.java`.

## Interfaz actual

Pestañas **Resumen** (tarjetas por tipo y estado de la lógica), **Campos** (tipo, visibilidad y agregación por campo con guardado automático), **Jerarquías** y **Calendario**. Iconos SVG de línea y un color por tipo (dimensión azul, medida verde, fecha ámbar, jerarquía violeta); la lógica se activa con un interruptor. Estilos en `frontend/css/logico.css` (prefijo `lm-`).
