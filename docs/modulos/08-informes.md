# Módulo: Generador de informes PDF

Generar informes PDF profesionales desde los datos reales de la app, en **cuatro modos** (Historia y presentación, Plantillas, Desde una hoja, Asistente), con ayuda del agente de IA. Segmentado por aplicación.

## A nivel de usuario
Vista **Informes** (selector de vista → Narrar → Informes, `Alt+Shift+R`), con un selector de modo:
1. **Plantillas**: tarjetas (Resumen Ejecutivo, por Región, por Categoría, Tendencias, Completo). Un clic → PDF completo.
2. **Desde una hoja**: elige una hoja/dashboard de la app; el PDF **replica** sus objetos (KPIs y gráficos) con datos reales.
3. **Asistente (conversacional)**: describes el informe en lenguaje natural ("ventas por región y una tabla por categoría", "quita el KPI", "agrega un análisis", "reemplaza la barra por una tarta"); ves una **vista previa en vivo** y ajustas; al final **Descargar PDF** y **Guardar plantilla** (persiste por app en `localStorage`).

El PDF incluye portada de marca, KPIs, gráficos, tablas con % y un **análisis escrito** que el agente redacta interpretando las cifras reales (distingue cada medida; no inventa).

## Historia de datos y modo presentación (modo por defecto)
Primer modo del selector («Historia y presentación»). En vez de un KPI por medida, arma una **secuencia de mensajes**: cada diapositiva tiene un titular con la conclusión, un gráfico, 2–3 viñetas, un recuadro «¿Cómo leerlo?» (modo didáctico) y notas del presentador.

- **Diapositivas**: portada → KPIs clave (máx. 4) → tendencia → Pareto (qué explica el 80 %) → mezcla/participación → tasa de rendimiento (p. ej. % margen por dimensión) → tasa de riesgo (p. ej. % devoluciones) → hallazgos y recomendaciones (resumen IA opcional con `aiAnalizar`) → anexo con tabla.
- **Selección de medidas**: usa las **medidas maestras** de la app (compiladas con `/expressions/parse`, datos con `/query`). La medida principal se elige por significado (ventas/ingresos/facturación primero), no por orden alfabético; los KPIs van principal → aditivas → tasas → riesgo.
- **Estudio**: miniaturas de todas las diapositivas, activar/ocultar cada una, elegir medida principal y dimensión, modo didáctico on/off.
- **Modo presentación** (pantalla completa, tarjetas animadas): `←/→`, `Espacio`, `RePág/AvPág`, `Inicio/Fin`, `O` (vista general en cuadrícula), `N` (notas), `F` (pantalla completa), `Esc` (salir).
- **PDF**: horizontal 960×540 pt, **una idea por página**, misma estructura que la presentación. Gráficos en JPEG sobre fondo blanco (un informe pasó de 53 MB a ~256 KB), ejes de barras siempre desde cero y texto Helvetica saneado (signo menos, espacios finos).
- **MCP**: la tool `data_story` devuelve la misma historia en JSON (`mcp-server/src/tools/story.ts`, port de `buildStory`).
- **No se pierde**: la última historia de cada app (diapositivas, cuáles están quitadas, título y opciones) se guarda en el navegador (`ds.story.<appId>`) y vuelve al regresar a Informes o al recargar; «Descartar» la quita. Informes recuerda el último modo (`ds.informes.mode.<appId>`) y el modo asistente conserva su conversación y vista previa (`ds.informes.chat.<appId>`).
- Código: `frontend/js/informe-historia.js` (`buildStory`, `visibleSlides`, `slideThumb`, `openPresentation`, `exportStoryPdf`, `mountStoryStudio`); estilos `.st-*` en `frontend/css/theme.css`.

## A nivel visual
- Galería de tarjetas con preview; overlay de progreso paso a paso; panel de chat + preview en el modo conversacional. Estilos en `frontend/css/informes.css`. Acento azul de marca; gráficos con la paleta de series.

## A nivel de desarrollo
- Frontend: `frontend/js/app-informes.js`. Piezas:
  - Compositor PDF (`buildPdf`/`buildCustomPdf`) con **jsPDF + autotable**.
  - Gráficos a imagen con **Chart.js** en canvas (`chartImage`), leídos tras un tick (robusto en headless).
  - Narrativa con `aiAnalizar` + **respaldo determinista** (si el agente no responde, redacta desde las cifras) y timeout para no bloquear.
  - Modo conversacional: `specFromPrompt` entiende añadir/quitar/reemplazar secciones y un tipo `text` (análisis); `renderPreview` pinta la vista previa.
- CDNs (en `frontend/pages/app.html`): Chart.js, jsPDF, jspdf-autotable.
- Segmentación: todo usa `ctx.appId`; plantillas guardadas en `ds.informes.<appId>`.

## Buenas prácticas de datos
- Los KPIs usan **solo medidas numéricas** (blindado contra dimensiones mal clasificadas).
- Los gráficos son dimensión (eje) × medida (valor); se valida que la consulta traiga datos antes de pintar.

## Limitaciones honestas
- Con un dataset de **un solo periodo** no hay comparación "vs. periodo anterior" (no se inventa). Se replica la arquitectura y la riqueza narrativa adaptadas a lo que los datos permiten (ranking, participación, tendencia).

## Archivos
`frontend/js/app-informes.js`, `frontend/css/informes.css`, `frontend/pages/app.html` (CDNs).

## Análisis especializado

Los tres modos (Plantillas, Desde una hoja y Asistente) comparten el mismo análisis cuando la
tabla tiene un campo de ingresos/ventas:

- **Métricas de negocio**: ingresos, margen bruto, % de margen, ticket promedio y costo unitario (con semáforo según el margen).
- **Rentabilidad por dimensión**: ingresos, costo, margen y % de margen por categoría/región.
- **Pareto**: contribución individual y acumulada, y cuántas categorías explican el 80%.
- **Variación mes a mes**: absoluta y porcentual, con el mejor y el peor salto.
- **Hallazgos, recomendaciones y análisis escrito** redactados con esas cifras.

Las dimensiones se eligen validando que produzcan señal (suma mayor a 0), de modo que un campo mal clasificado no genere un informe lleno de ceros. Sin campo de ingresos, el informe usa el formato base.
