# 20 · Identidad visual propia (fase 1: marco y nombres)

DataSense deja de imitar la interfaz de Qlik sin perder ninguna función. La fase 1 cambia lo que se ve en todas las pantallas: el marco (barra superior y menú) y los nombres.

## Marco común
- **Sin lanzador de 9 puntos.** El logo **DataSense** lleva a Inicio en todas las páginas (`js/topbar.js`). Se quitó el subtítulo junto al logo («Analítica», «Aplicación», «Catálogo»).
- **Menú lateral dentro de la app.** El selector desplegable de vistas (Analizar / Narrar / Preparar…) se sustituyó por un menú lateral agrupado, igual al del hub: se pliega con **☰**, plegado muestra solo iconos con su nombre al pasar el cursor, y la elección se recuerda (`ds.side`). Arriba, **‹ Aplicaciones** vuelve a la lista.
- **Miga de la barra:** nombre de la app · etapa (Personal / Desarrollo / Producción) › sección actual.
- Cambiar de sección rápido ya no deja un error «Cannot set properties of null»: solo se pinta la última sección pedida (`app.js`, `viewSeq`).

## Nombres nuevos
| Antes (Qlik) | Ahora | Grupo del menú |
|---|---|---|
| Hoja | **Hojas** | Explorar |
| Qué cambió · simular · actuar | **Explicar y actuar** | Explorar |
| Informes | Informes | Comunicar |
| Experimentos de ML (dentro de la app) | **Modelos de ML** | Inteligencia |
| Editor de carga de datos | **Script de datos** | Datos |
| Gestor de datos | **Tablas y campos** | Datos |
| Visor del modelo de datos | **Mapa de relaciones** | Datos |
| Modelo lógico | **Capa de negocio** | Datos |
| Automatizar · alertas y salud | **Automatizar** | Operar |
| Catálogo (hub) | **Aplicaciones** | — |
| Elementos maestros | **Medidas y dimensiones** | — |
| Editar hoja | **Diseñar** | — |
| Cargar datos | **Ejecutar script** | — |
| Secciones (del script) | **Pestañas** | — |
| Añadir datos / Conexiones de datos | **Fuentes / Conexiones** | — |

Las rutas y atajos no cambian (`#hoja`, `#editor`, `#datos`, `#modelo`, `#logico`…; `Alt + Shift + letra`), así que los enlaces guardados siguen funcionando. La API y el MCP no cambian.

## Otros ajustes
- **Inicio:** se quitaron los elementos decorativos sin función («Agregar widgets» y la pestaña «Personal»). Las secciones se llaman «Abiertas hace poco» y «Más aplicaciones».
- **Script de datos:** se quitaron los botones sin función «Depurar» y «Añadir desde el catálogo de datos».
- **Hojas:** el rótulo automático de una medida pasa de `Sum(Ventas)` a «Suma de Ventas».
- **Mapa de relaciones:** los iconos de clave tienen su tamaño real (antes `hub.css` los estiraba) y cada relación se rotula con los campos que comparte, en lugar de «association».

## Archivos
`pages/app.html`, `js/app.js`, `js/topbar.js`, `js/hub-nav.js`, `pages/inicio.html`, `pages/catalogo.html`, `js/app-editor.js`, `js/app-datos.js`, `js/app-modelo.js`, `js/app-logico.js`, `js/app-menu.js`, `js/app-hoja.js`, `help/ayuda.json`, `css/theme.css` (sección «Identidad DataSense»).

## Siguientes fases
Rediseñar por dentro las pantallas que conservan la distribución de Qlik: el Script de datos (tres columnas), el modo Diseñar de las hojas (riel de activos y panel de propiedades), la barra de selecciones y el Mapa de relaciones.
