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

## Fase 2: pantallas por dentro
### Script de datos
- El editor ocupa todo el ancho. Las **pestañas** del script son pestañas horizontales encima del editor (con **+** para añadir una).
- **Fuentes** (plantillas y conexiones) es un cajón a la derecha que se abre con el botón **⛁ Fuentes** y se cierra con ✕. Se recuerda (`ds.ed.fuentes`); la primera vez se abre solo si la app no tiene script.
- Los mensajes (comentar líneas, insertar bloques, cargas) salen en una **barra de estado** al pie, visible aunque Fuentes esté cerrado.

### Hojas · modo Diseñar
- Al pulsar **Diseñar**, el menú lateral de la app se pliega solo y vuelve como estaba al pulsar **Listo** o al salir de la hoja (no cambia la preferencia guardada).
- El riel muestra solo iconos (nombre al pasar el cursor) y solo lo que funciona: **Gráficos, Campos, Medidas y dimensiones, Modelos de ML, Hojas**. El panel de elementos y el de propiedades son tarjetas.
- Se quitaron las maquetas sin función: Marcadores, Disparadores de información, Análisis, Variables, Tabla de origen, Expresión de título, Condición para mostrar, Opciones de estilo, Estados alternos, Acciones, Imágenes, Visualizaciones maestras, el botón ✨ y los botones *fx* deshabilitados. Los tipos de gráfico no disponibles ya no se listan.

### Barra de filtros y colores de selección
- La barra de selecciones es ahora **Filtros**: chips «Campo: valor» con ✕, y a la derecha deshacer, rehacer y **Limpiar**. Sin filtros muestra una pista.
- Panel de filtrado: **seleccionado** = degradado de la marca con ✓ (antes verde), **posible** = normal, **alternativo** = tinte suave, **excluido** = atenuado y tachado (antes gris). Los gráficos siguen atenuando lo no seleccionado.

### Mapa de relaciones
- Cada tabla es una tarjeta con franja de color (azul: datos; violeta: tablas de ML; gris: sin relación), icono, nombre y resumen «filas · campos · claves».
- Las **claves** (campos que relacionan tablas) van primero con la etiqueta CLAVE. La tarjeta tiene alto fijo y desplaza sus campos, así ya no se montan unas sobre otras.
- Fondo punteado, líneas y rótulos con el color de la marca.

Archivos de la fase 2: `js/app-editor.js`, `js/app-hoja.js`, `js/app-modelo.js`, `css/theme.css` (secciones «Identidad fase 2»).

## Fase 3: orden y acabado
- **Títulos de página**: color sólido, mismo tamaño y peso en todas las pantallas (antes el degradado partía la palabra en dos colores: «Cre|ar»). Subtítulo bajo el título en Crear, Colecciones, Analizar y Temas. Las cabeceras de Automatizaciones, Informes, Modelos de ML, Capa de negocio, Tablas y campos y Mapa de relaciones usan el mismo estilo (Automatizaciones ya no va dentro de una tarjeta).
- **Crear**: solo acciones reales, en tres grupos (Análisis · Inteligencia y automatización · Datos y conexiones) y según los permisos de cada persona. Se retiraron las tarjetas de relleno copiadas de Qlik («Rodear a», «Guion», «Nota», «Receta de tabla», «Base de conocimientos», «Asistente», «Producto de datos», «Conjunto de datos», «Cargar») y las repetidas. Nuevas: **De archivo a tablero**, **Colección** (abre el formulario), **Tablero incrustado** y **Notas para agente**. Toda la tarjeta es el botón.
- **Analizar**: ya no repite la lista de Aplicaciones; ahora es la galería de **cuadernos de análisis** de todas las apps, y cada app tiene la vista «Cuaderno de análisis» en Explorar (ver [21](./21-cuaderno-analisis.md)).
- **Textos**: trato de *tú* en todas partes (se corrigieron «No tiene», «Puede», «Suelte», «Haga clic», «Seleccione», «Arrástrelos», «Recargue»…); nombres nuevos en los mensajes que aún decían «Gestor de datos», «Editor de carga», «Modelo lógico» o «Cargar datos»; plurales correctos («1 crítico», «2 tablas cargadas» en vez de «crítico(s)», «tabla(s)»); porcentajes en español («100 %» en vez de «100.0%»); plantillas de informe en minúscula de oración («Resumen ejecutivo», «Análisis por región»); modo «Con el asistente».
- **Script de datos**: se ocultó el selector de «espacios» (nombres fijos de ejemplo que no filtraban nada).
- **Tablas y campos**: el botón «Agregar datos» se veía blanco sobre blanco; ahora usa el color de la marca.
- **Informes / Modelos de ML**: títulos alineados con el menú («Informes», «Modelos de ML»).

## Fase 4: hojas adaptables y carga de datos ordenada
- **Cabecera de hoja sin banda de color.** Se quitó la barra degradada con «◆ DataSense · …». Ahora la hoja muestra título, descripción y una navegación en píldora «‹ 1 de N ›» sobre fondo transparente (`js/app-hoja.js` `renderTitle`, `css/hoja.css` `.ho-sheet-title`, `.ho-title-*`).
- **KPIs que se ajustan a cualquier pantalla.** El cuerpo de un KPI es un *container query*: el valor usa `clamp(14px, min(13cqw, 42cqh), 40px)` y no se corta en dos líneas, así crece o encoge con el tamaño real de la tarjeta, no con la ventana.
- **Etiquetas de valor en gráficos densos.** Si hay menos de 46 px por punto, solo se rotulan el máximo, el mínimo y el último valor (`js/hoja-render.js`, `valueLabelsPlugin`).
- **Selector de datos (Seleccionar datos → Transformar).** Se reorganizó en tarjetas plegables (Columnas · Columnas calculadas · Filas), una abierta a la vez; los pasos aplicados son una tira de chips arriba en lugar de una columna lateral. Se retiró el texto «igual que un LOAD de Qlik» (`js/data-selector.js` `drawTransform`, `css/editor.css` `.ed-ds-card`, `.ed-ds-tf-steps`).
