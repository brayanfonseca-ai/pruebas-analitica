# Módulo: Gestor de datos (preparación visual)

Preparación de datos **por clics**, sin escribir script: renombrar campos, cambiar su tipo y ocultar columnas. Inspirado en el "Gestor de datos" de Qlik y en Power Query.

## A nivel de usuario
- Panel **"Preparar campos"** por tabla: para cada columna puedes
  - **Renombrar** (nombre de presentación),
  - **Cambiar el tipo** (Texto / Número / Fecha),
  - **Ocultar** la columna.
- Los datos de origen **no se borran**: es una capa de vista. Al aplicar, el cambio se refleja en el modelo y (según el diseño de correlación) en las hojas.
- Solo visible para quien puede editar datos (`data:import` / `charts:edit`).

## A nivel visual
- Tabla de campos con: nombre origen, campo de renombrar, selector de tipo, casilla "Ocultar", y botón "Aplicar cambios".
- Estilos en `css/model.css` (clases `q-fieldprep-*`). Acento azul de marca.

## A nivel de desarrollo
- Backend:
  - `FieldOverrideController` — `GET/PUT /apps/{appId}/tables/{tableId}/field-overrides`. Valida `forced_type ∈ {text,number,date}` (400 si inválido, nunca 500).
  - `FieldOverrideRepository` — tabla `field_overrides`.
  - `FieldOverrides` / `EffectiveFields` (engine) — aplican el override como **capa de vista**: `DataController` sirve la tabla con el rename/tipo/oculto; `ScriptController.generated` refleja los overrides.
- Frontend: `js/app-datos.js` + `api.getFieldOverrides/putFieldOverrides`.
- **Identidad estable**: el override cambia la *presentación* (display name, tipo efectivo), pero la *identidad* del campo sigue siendo la columna física. Así renombrar no rompe hojas ni queries que referencian la columna real.

## Relación con otros módulos
- El **Modelo lógico** lee estos overrides para su clasificación/visibilidad/display.
- La **Hoja** muestra el display del override en los rótulos (correlación editor↔hoja).

## Archivos
`js/app-datos.js`, `css/model.css`,
`backend: web/FieldOverrideController.java`, `repo/FieldOverrideRepository.java`,
`engine/FieldOverrides.java`, `engine/EffectiveFields.java`.
