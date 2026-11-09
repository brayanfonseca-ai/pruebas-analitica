# Módulo: Hoja — Analizar

La vista de **análisis**: una hoja con objetos (KPIs, gráficos, tablas, filtros) donde hacer **selecciones asociativas**. Es el corazón de la experiencia tipo Qlik.

## A nivel de usuario
- Ves los objetos de la hoja con sus datos reales.
- Al hacer clic en un valor (una barra, una porción, un valor de un filtro), haces una **selección**: todos los objetos se recalculan y el modelo marca qué datos están asociados.
- Barra de selecciones activas; puedes limpiar o combinar selecciones.
- Botón **Editar hoja** para pasar al modo construcción.
- El **asistente "estrellita"** aquí es un *analista*: responde preguntas sobre el tablero, los KPIs y las selecciones, con datos reales (no adivina).

## A nivel visual
- Rejilla de 24 columnas; cada objeto ocupa `{x,y,w,h}`.
- Gráficos con Chart.js; paleta de series en `chart-types.js` (`PALETTE`), independiente del acento de marca.
- Estilos en `frontend/css/hoja.css`.

## A nivel de desarrollo
- Frontend: `frontend/js/app-hoja.js` (maneja **vista** `st.edit=false` y **edición** `st.edit=true`). Render de contenido en `frontend/js/hoja-render.js` (`renderChart`, `renderKpi`, `renderTable`, `renderFilterPane`).
- Cada objeto consulta `POST /query` con `{dimension, measures:[{table,field,agg}], selections}`.
- **Selecciones asociativas**: `QueryEngine` + `AssociativeJoin` propagan el filtro entre tablas relacionadas; `getFieldValues` devuelve valores con su estado (seleccionado/posible/excluido).
- Los **rótulos** de dimensiones/medidas usan el display de `/fields` (respeta overrides).

## Archivos
`frontend/js/app-hoja.js`, `frontend/js/hoja-render.js`, `frontend/js/chart-types.js`, `frontend/css/hoja.css`,
`backend: web/QueryController.java`, `engine/QueryEngine.java`, `engine/AssociativeJoin.java`.
