# 11 · Experimentos de ML

Módulo **independiente** (no es una vista más de una aplicación) para crear experimentos de
aprendizaje automático sobre los datos de cualquier aplicación, entrenar y comparar modelos,
probar casos y guardar cada ejecución. Todo el cálculo ocurre en el backend en Java puro, sin
librerías de ML externas.

## A nivel de usuario

### Cómo se llega

- **Crear → Experimento de ML** abre directamente el formulario de nuevo experimento.
- **Menú lateral → Experimentos de ML** abre la lista (`pages/experimentos.html`).
- Dentro de una aplicación, la vista **Ciencia de datos → Experimentos de ML** (`Alt+Shift+L`) lista los experimentos de esa app y crea uno nuevo con la app preseleccionada.

### Flujo

1. **Nuevo experimento**: nombre, aplicación, tabla (muestra cuántas filas tiene) y descripción opcional.
2. **Estudio del experimento** (`pages/experimento.html?id=…`), con tres pestañas:
   - **Datos**: cada variable con su tipo, valores distintos, vacíos y uso típico, más una vista previa de filas reales.
   - **Modelado**: catálogo de 24 algoritmos a la izquierda (con buscador). Al elegir uno se configuran las **variables** con chips (objetivo, predictoras, medida, periodo) y los **hiperparámetros**. **Entrenar y guardar** ejecuta, muestra los resultados y los guarda en el historial.
   - **Ejecuciones**: historial con fecha, algoritmo, etiqueta, variables y métrica principal. Permite **abrir** una ejecución (restaura su configuración y resultado), **comparar** dos o más (tabla de métricas y gráfico) y **eliminar**.
3. **Probar un caso** (segmentación con K-Means, todos los modelos de regresión y clasificación, y AutoML): se escriben valores o se carga una fila real, y el modelo devuelve el grupo, el valor estimado con rango del 95% o la probabilidad de la clase. No se guarda en el historial.
4. **Exportar CSV** del resultado: grupos, componentes, reglas, atípicos, pronóstico, tabla de posiciones o predicciones.
5. **Asociar a…** (en el resultado de cualquier ejecución guardada): elige la aplicación del catálogo y el título de la hoja. Se crea automáticamente:
   - una **tabla del modelo de datos** `ML_<algoritmo>_<tabla>_<etiqueta>` con el resultado **por registro** (segmento/grupo y distancia al centro; valor estimado y error; probabilidad y clase predicha; atípico y puntaje) enlazada a la tabla de origen por su **clave única** (p. ej. `Cliente`), como una asociación de Qlik. Pronóstico, correlaciones, PCA y reglas generan una tabla resumen (periodos, pares, componentes, reglas). En otra aplicación la tabla incluye las columnas de origen para que la hoja sea autónoma.
   - una **hoja nueva** con texto de lectura, KPIs, barras/dona por grupo o clase, perfil promedio por grupo (medidas de la tabla de origen cruzadas por la clave), real vs. estimado, tabla de detalle y filtro.
   - en la hoja, `props.ml` con el resumen del modelo (algoritmo, variables, métricas, segmentos, coeficientes/importancias, lectura). El **agente analista** de la hoja lo recibe como `modeloML` y puede explicar el modelo.
   - Re-asociar la misma ejecución **reemplaza** su tabla y su hoja (no duplica). El aviso del resultado trae **Abrir hoja** (`app.html?app=…&sheet=…#hoja`).

### Catálogo

| Familia | Algoritmos |
|---|---|
| Segmentación | K-Means · Clúster jerárquico (Ward, promedio, completo, simple) · DBSCAN |
| Exploración y estructura | PCA · Correlaciones (Pearson y Spearman) · Detección de anomalías (Z-score, IQR) · Reglas de asociación (Apriori) |
| Regresión | Lineal · Ridge · Lasso · Polinómica · Árbol de decisión · Bosque aleatorio · Gradient Boosting · K vecinos |
| Clasificación | Logística · Naive Bayes · Árbol de decisión · Bosque aleatorio · Gradient Boosting · K vecinos |
| Series de tiempo | Pronóstico (ingenuo, tendencia lineal y Holt; elige el mejor) |
| AutoML | Regresión (compara 8 modelos) · Clasificación (compara 6) |

### Qué muestra cada resultado

- **Segmentación**: mapa 2D de grupos, curva para elegir k (K-Means), altura de fusión (jerárquico) o distancia al k-ésimo vecino (DBSCAN), una tarjeta por grupo con su perfil y una muestra de asignaciones. DBSCAN separa el ruido.
- **PCA / correlaciones / anomalías**: varianza y cargas; matrices de Pearson y Spearman con pares significativos; histograma, dispersión, atípicos con motivo y límites.
- **Reglas de asociación**: reglas *si… entonces…* con soporte, confianza y lift, y los valores más frecuentes.
- **Regresión**: R² de prueba, RMSE, MAE, comparación con el R² de entrenamiento (aviso de sobreajuste), real vs. predicho, importancia de variables por permutación y coeficientes en los modelos lineales.
- **Clasificación**: exactitud frente a la clase mayoritaria, precisión, sensibilidad, F1, AUC, matriz de confusión, curva ROC e importancia de variables.
- **AutoML**: tabla de posiciones con todos los modelos sobre la misma partición, gráfico por métrica y el detalle completo del ganador.
- Todos incluyen **Lectura del resultado** con la interpretación en lenguaje claro.

## A nivel visual

Mismo lenguaje que Modelo lógico y Gestor de datos: iconos SVG de línea, tarjetas sobrias, azul
`#172983`. Las métricas se colorean por calidad (verde, ámbar, rojo). Estilos en
`frontend/css/lab.css` (prefijos `ml-` y `mx-`).

## A nivel de desarrollo

**Backend** (`io.datasense.ml`, `io.datasense.repo`):

| Clase | Rol |
|---|---|
| `ExperimentController` | `/api/v1/ml/experiments` (CRUD) y `/{id}/runs` (entrenar, historial, abrir, eliminar). |
| `ExperimentRepository` | Tablas `ml_experiments` y `ml_runs` (parámetros, resultado completo y métrica principal). |
| `MlService` | Despachador y algoritmos base: K-Means, PCA, correlaciones, anomalías, regresión lineal, logística y pronóstico. |
| `MlSupervised` | Motor supervisado genérico (partición, métricas, ROC, importancia por permutación, caso) y AutoML. |
| `MlModels` | Ridge, Lasso (descenso por coordenadas), polinómica, árbol CART, bosque aleatorio, gradient boosting, KNN, Naive Bayes y logística. |
| `MlUnsupervised` | Clúster jerárquico (Lance-Williams), DBSCAN y reglas de asociación (Apriori). |
| `MlController` | `/api/v1/apps/{appId}/ml/run`, ejecución directa sin guardar (la usa el MCP). |

- Resultados **deterministas** (semilla fija en particiones, K-Means++, bosques y boosting).
- Muestreo por rendimiento: 20 000 filas en general; 4 000 para entrenar árboles, bosque, boosting y KNN; 600 para el jerárquico y 3 000 para DBSCAN. El resultado lo indica.
- El pronóstico ordena los periodos cronológicamente: números, nombres de mes (español e inglés) y fechas. Si no reconoce el formato, lo avisa.
- Las entradas inválidas responden **400** con un mensaje legible que se muestra en pantalla.

**Frontend**: `frontend/js/ml-catalog.js` define cada algoritmo (roles, hiperparámetros y
petición al backend), `ml-render.js` renderiza los resultados y la exportación,
`experimentos.js` gestiona la lista y la creación, y `experimento.js` el estudio.
`app-lab.js` es solo la vista de enlace dentro de una app.

## Validación

Se verificó con un conjunto sintético de 2 000 registros con verdad conocida: 3 segmentos
latentes, ventas no lineales, abandono dependiente de satisfacción, visitas y gasto, 12 meses
y 12 atípicos inyectados.

- K-Means y el jerárquico encuentran k = 3 automáticamente (silueta de 0,70).
- DBSCAN encuentra 3 grupos.
- Detección de anomalías: 12 de 12 atípicos.
- Reglas: recupera Joven digital → Online (confianza 0,86, lift 1,65).
- Regresión: R² de prueba entre 0,88 (árbol) y 0,996 (polinómica).
- Clasificación: AUC entre 0,95 y 0,97.
- Pronóstico: los meses quedan en orden.

Además se recorrió el flujo completo en Chrome real: login, Crear → Experimento de ML, los
24 algoritmos con clics, prueba de casos, validaciones, historial, comparación, renombrar y
la vista dentro de la app. Se revisó que no haya errores de JavaScript ni gráficos vacíos.

## Limitaciones

- Los modelos se reentrenan en cada ejecución; se guarda el resultado, no el modelo serializado para publicarlo como servicio. **Asociar a** vuelve a entrenar con los mismos parámetros y semilla (resultado idéntico) para puntuar cada fila.
- Jerárquico (muestra de 600) y DBSCAN (muestra de 3 000): las filas que quedan fuera de la muestra se asignan al grupo más cercano (jerárquico: centroide; DBSCAN: punto muestral dentro de eps, si no, ruido); la hoja lo indica.
- La asociación por clave necesita una columna con un valor único por fila; si no la hay, la tabla ML copia las columnas de origen.
- La clasificación es binaria (una clase frente al resto); con objetivos numéricos se separa por umbral.
- Las variables categóricas no se usan como predictoras (sin codificación one-hot).

## Archivos

`frontend/pages/experimentos.html`, `frontend/pages/experimento.html`, `frontend/js/experimentos.js`,
`frontend/js/experimento.js`, `frontend/js/ml-catalog.js`, `frontend/js/ml-render.js`,
`frontend/js/app-lab.js`, `frontend/css/lab.css`,
`backend: ml/*.java`, `repo/ExperimentRepository.java`, `config/DatabaseConfig.java`.
