# Glosario

Términos del dominio de DataSense (muchos heredados de Qlik Sense).

| Término | Definición |
|---|---|
| **Aplicación (app)** | Contenedor de trabajo: agrupa sus tablas, modelo, hojas, conexiones y modelo lógico. Identificada por `appId`. Lo que creas desde "Crear → Aplicación". |
| **Tabla** | Conjunto de datos cargado (desde Excel/CSV o una conexión). Tiene columnas con un tipo inferido. Se materializa como CSV. |
| **Conexiones realizadas** | Stack de todas las conexiones de datos creadas (en cualquier app o desde el hub). En el Editor de carga, cada una abre el **selector de datos**: explorar, validar la extracción con una muestra real y ver el script de carga en paralelo antes de cargar. |
| **Asociar a** | Acción de un resultado de Experimentos de ML: crea en una app una tabla `ML_…` (resultado por registro enlazado por la clave, o tabla resumen) y una hoja con sus gráficos; la hoja guarda en `props.ml` el resumen del modelo para el agente analista. |
| **Campo** | Una columna de una tabla. Puede ser dimensión o medida según su tipo y clasificación. |
| **Dimensión** | Campo categórico (texto/fecha) por el que se agrupa o filtra: Región, Categoría, Mes. |
| **Medida** | Campo numérico que se agrega: Ventas, Unidades, Costo. Se calcula con una agregación. |
| **Agregación** | Operación sobre una medida: `sum`, `avg`, `count`, `min`, `max`. |
| **Hoja** | Un dashboard dentro de una app: una rejilla de 24 columnas con objetos (KPIs, gráficos, tablas, filtros). |
| **Objeto de hoja** | Un elemento de la hoja (`kpi`, `bar`, `pie`, `line`, `table`, `filterpane`…) con su posición `{x,y,w,h}` y `props` (dimensiones/medidas/estilo). |
| **Selección asociativa** | Al hacer clic en un valor, el motor marca qué datos están asociados (verde/gris/blanco) y propaga el filtro por todas las tablas relacionadas. Es el corazón del modelo Qlik. |
| **Asociación** | Relación entre dos tablas que comparten un campo con el mismo nombre. Se infieren automáticamente. |
| **Llave sintética** | Llave que Qlik (y DataSense) crea cuando dos tablas comparten más de un campo; concepto del modelo de datos. |
| **Modelo de datos** | El grafo de tablas y sus asociaciones. Se ve en el "Visor del modelo de datos". |
| **Script de carga** | Código estilo Qlik (`LOAD ... FROM [lib://DataFiles/...]`) que define cómo se cargan y transforman las tablas. |
| **Field override** | Ajuste de presentación sobre un campo sin tocar el dato: renombrar, forzar tipo (texto/número/fecha), ocultar. Vive en `field_overrides`. |
| **Modelo lógico (Business Logic)** | Capa conceptual de metadatos sobre el modelo: clasificación de campos, visibilidad, agregación por defecto, grupos, jerarquías, períodos de calendario. La usa el asistente para interpretar los datos. |
| **Jerarquía** | Ruta de desglose (drill) entre campos: p.ej. Región › Categoría. |
| **Período de calendario** | Rango de tiempo (mes, trimestre, año) definido sobre un campo de fecha. |
| **Elemento maestro** | Dimensión o medida reutilizable definida una vez y usada en varios objetos. |
| **Colección** | Agrupación de apps en el catálogo (como carpetas). |
| **Conexión de datos** | Configuración para leer datos de una fuente externa (S3, Athena, bases de datos, HTTP…). |
| **Conector** | El tipo de una conexión (s3, athena, postgres, mysql, rest, …). |
| **KPI** | Objeto que muestra un único valor agregado destacado (p.ej. Ventas totales). |
| **Asistente "estrellita"** | Agente de IA flotante (botón ✦) que cambia de rol según el módulo: ingeniero de datos (editor), analista (hoja/vista), diseñador (hoja/edición). |
| **Nova Micro** | Modelo de lenguaje de Amazon Bedrock que usa el asistente. Se invoca vía *inference profile* `us.amazon.nova-micro-v1:0` en `us-east-2`. |
| **Inference profile** | Identificador de Bedrock que permite invocar un modelo que no admite invocación on-demand directa. |
| **MCP (Model Context Protocol)** | Protocolo estándar para exponer herramientas a agentes de IA. El servidor MCP de DataSense permite a un agente listar apps, leer datos, consultar, crear hojas, etc. |
| **Informe** | Documento PDF generado desde los datos (plantilla, hoja, o conversación con el agente). |
| **Plantilla de informe** | Conjunto predefinido de secciones (KPIs, gráficos, tablas, análisis) que arma un informe de un clic. |
| **Agente / persona** | El "rol" que adopta el asistente IA según el contexto (ingeniero, analista, diseñador, asesor de informes). |
| **QueryResult** | Respuesta de `/query`: `{labels, values, value, series}`. Sin dimensión → `value` escalar (KPI); con dimensión → `labels`+`values`. |
| **Rejilla (grid)** | El lienzo de la hoja: 24 columnas de ancho, filas variables. Los objetos se posicionan en celdas. |
| **Experimento de ML** | Contenedor de trabajo sobre una tabla: guarda cada entrenamiento (ejecución) con sus parámetros y resultado para compararlos. |
| **Ejecución** | Un entrenamiento guardado de un experimento: algoritmo, variables, hiperparámetros, resultado y métrica principal. |
| **Hiperparámetro** | Ajuste que se fija antes de entrenar (k, profundidad, número de árboles, λ…). |
| **AutoML** | Entrena varios modelos con la misma partición y elige el mejor según la métrica. |
| **Bosque aleatorio / Gradient Boosting** | Conjuntos de árboles: promedio de árboles independientes / árboles en secuencia que corrigen el error anterior. |
| **Ridge / Lasso** | Regresión lineal con penalización L2 / L1 (Lasso puede descartar variables). |
| **DBSCAN** | Segmentación por densidad que detecta grupos de cualquier forma y separa el ruido. |
| **Clúster jerárquico** | Une registros de abajo hacia arriba; el corte del árbol define los grupos. |
| **Reglas de asociación** | Patrones "si A entonces B" con soporte, confianza y lift (Apriori). |
| **Importancia por permutación** | Cuánto empeora el modelo al desordenar una variable: mide su aporte real. |
| **Aprendizaje supervisado / no supervisado** | Supervisado: se predice una variable objetivo conocida (regresión, clasificación). No supervisado: se buscan patrones sin objetivo (segmentación, PCA, anomalías). |
| **K-Means** | Algoritmo de segmentación que agrupa registros en *k* grupos alrededor de centroides. |
| **Silueta** | Medida de −1 a 1 de qué tan bien separados están los grupos. Mayor a 0.5 = separación fuerte. |
| **Inercia** | Suma de distancias cuadradas de cada registro a su centroide; baja al aumentar k. |
| **PCA** | Análisis de componentes principales: resume variables correlacionadas en ejes que conservan la mayor varianza. |
| **Varianza explicada** | Porcentaje de la información total que retiene un componente. |
| **Correlación (Pearson / Spearman)** | Medida de −1 a 1 de cuánto se mueven juntas dos variables (lineal / por rangos). No implica causalidad. |
| **Z-score / IQR** | Criterios de anomalía: desviaciones respecto a la media / distancia a los cuartiles (1.5×IQR). |
| **Regresión lineal** | Modelo que predice un número como combinación lineal de variables. |
| **R² / R² ajustado** | Proporción de la variación que explica el modelo; el ajustado penaliza variables extra. |
| **RMSE / MAE** | Error típico (penaliza errores grandes) / error absoluto medio, en las unidades del objetivo. |
| **Sobreajuste** | El modelo rinde bien en entrenamiento pero mal con datos nuevos. |
| **Conjunto de prueba** | Filas reservadas que el modelo no ve al entrenar, para medir su rendimiento real. |
| **Regresión logística** | Modelo de clasificación que estima la probabilidad de pertenecer a una clase. |
| **Exactitud / precisión / sensibilidad / F1** | Métricas de clasificación: aciertos totales / aciertos entre los predichos positivos / positivos reales detectados / equilibrio entre precisión y sensibilidad. |
| **AUC / curva ROC** | Capacidad de separar clases independiente del umbral (0.5 = azar, 1 = perfecto). |
| **Razón de momios (odds ratio)** | Factor por el que se multiplican las probabilidades al subir una variable una desviación estándar. |
| **Pronóstico (Holt)** | Proyección de una serie con suavizado exponencial de nivel y tendencia. |
| **Banda de confianza** | Rango esperado (95%) alrededor del pronóstico. |
