# Módulo: Visor del modelo de datos

Muestra el **modelo de datos**: las tablas cargadas y cómo se asocian entre sí (por campos con el mismo nombre), como el visor del modelo de Qlik.

## A nivel de usuario
- Un lienzo con cada tabla y sus campos; las líneas conectan tablas que comparten un campo (asociación).
- Permite entender el modelo antes de analizar: qué está conectado y por dónde.
- Controles de zoom.

## A nivel visual
- Cajas de tabla (`q-model-box`) con la lista de campos; los campos llave se resaltan.
- Rail de zoom (`q-zoom-rail`). Estilos en `css/model.css`.

## A nivel de desarrollo
- Backend: `ModelController` `GET /apps/{appId}/model` devuelve nodos (tablas), enlaces (asociaciones) y avisos (p.ej. llaves sintéticas).
- Motor: `Associations` detecta asociaciones por nombre de campo; `AssociativeJoin` las usa para propagar selecciones.
- Frontend: `js/app-modelo.js` dibuja el grafo a partir del `/model`.

## Conceptos
- **Asociación**: dos tablas con un campo homónimo quedan ligadas automáticamente.
- **Llave sintética**: aparece cuando dos tablas comparten *más de un* campo; es un aviso del modelo.

## Archivos
`js/app-modelo.js`, `css/model.css`,
`backend: web/ModelController.java`, `engine/Associations.java`, `engine/AssociativeJoin.java`.
