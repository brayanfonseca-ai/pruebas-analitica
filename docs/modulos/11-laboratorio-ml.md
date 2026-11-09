# 11 · Laboratorio de ML

Vista **Ciencia de datos → Laboratorio de ML** dentro de una aplicación (`Alt + Shift + L`).
Reúne siete algoritmos de aprendizaje automático, cada uno como una tarjeta con un flujo
guiado de principio a fin. Todo el cálculo ocurre en el backend (Java puro, sin librerías de
ML externas); el frontend solo configura, dibuja e interpreta.

## A nivel de usuario

La pantalla inicial muestra dos grupos de tarjetas. Cada tarjeta tiene **Abrir** (flujo
manual) y **Ejecutar ejemplo** (se configura y entrena sola con tus datos).

| Grupo | Tarjeta | Para qué sirve |
|---|---|---|
| Descubrir patrones | **Segmentación** (K-Means) | Agrupa registros parecidos y describe el perfil de cada grupo. |
| | **Reducción de dimensiones** (PCA) | Resume muchas variables en pocos ejes que conservan la información. |
| | **Correlaciones** | Mide qué variables se mueven juntas y detecta redundancias. |
| | **Detección de anomalías** | Encuentra registros que se salen del comportamiento normal. |
| Predecir | **Regresión lineal** | Predice un valor numérico y mide el peso de cada variable. |
| | **Pronóstico de series** | Proyecta una medida a los próximos periodos con banda de confianza. |
| | **Clasificación** (regresión logística) | Estima la probabilidad de que un registro pertenezca a una clase. |

### Flujo de cada tarjeta

1. **Datos** — tabla elegida, número de filas, tipos de variables y primeras filas.
2. **Variables** — se eligen con chips: numéricas, objetivo, medida y periodo según el algoritmo.
3. **Parámetros** — k, proporción de prueba, horizonte, umbral…; los algoritmos sin parámetros lo indican.
4. **Entrenar** — resumen del experimento y botón para entrenar.
5. **Resultados** — métricas, gráficos y un bloque **Lectura del resultado** con la interpretación.
6. **Probar un caso** (K-Means, regresión, clasificación): se ingresan valores (o se cargan de una fila de ejemplo) y se obtiene el segmento, el valor estimado con rango de 95% o la probabilidad. En los demás algoritmos este paso es **Muestra**: una tabla de ejemplo exportable a **CSV**.

### Qué muestra cada resultado

- **K-Means**: mapa 2D de segmentos (PCA), curva de inercia y silueta para elegir k, tarjetas por segmento con su perfil (barras z respecto al promedio) y muestra de asignaciones.
- **PCA**: varianza explicada individual y acumulada, cargas por componente (mapa de calor) y proyección PC1/PC2.
- **Correlaciones**: matriz de Pearson en mapa de calor y pares ordenados por fuerza (Pearson, Spearman, R², significancia).
- **Anomalías**: histograma con atípicos resaltados, dispersión, tabla de registros atípicos con su motivo y estadísticos con límites.
- **Regresión**: R² (prueba), R² ajustado, RMSE, MAE, ecuación, real vs. predicho y tabla de coeficientes con significancia.
- **Pronóstico**: serie real, ajuste, pronóstico y banda; comparación de tres modelos.
- **Clasificación**: exactitud, precisión, sensibilidad, F1, AUC, matriz de confusión, curva ROC y razón de momios por variable.

## A nivel visual

Mismo lenguaje que Modelo lógico y Gestor de datos: iconos SVG de línea, tarjetas sobrias,
azul de marca `#172983` para "descubrir" y verde para "predecir". Estilos en
`frontend/css/lab.css` (prefijo `ml-`). Los gráficos usan Chart.js.

## A nivel de desarrollo

**Backend** (`io.datasense.ml`):

| Clase | Rol |
|---|---|
| `MlController` | `GET /apps/{appId}/ml/datasets` y `POST /apps/{appId}/ml/run`. |
| `MlService` | Los siete algoritmos y la validación de entradas. |
| `MlMath` | Álgebra lineal y estadística: inversa Gauss-Jordan, autovalores por Jacobi, Pearson, rangos, cuantiles. |

- `datasets` devuelve cada tabla con sus campos agrupados en `numeric`, `categorical` y `dates`, usando el **tipo efectivo** (respeta los *field overrides*) y excluyendo los ocultos. `field` es la identidad física y `display` el alias.
- `run` recibe `{table, algorithm, params}` y devuelve el resultado más `elapsedMs`. Si se envía `params.input`, devuelve además `prediction` para ese caso. Las entradas inválidas responden **400** con un mensaje legible.
- Con más de 20 000 filas completas se usa una muestra uniforme; el resultado lo indica.
- Los resultados son **deterministas** (semilla fija en la partición y en K-Means++).

**Algoritmos:**

| Algoritmo | Implementación |
|---|---|
| K-Means | Inicialización K-Means++, 8 reinicios por k, estandarización opcional. k automático por silueta, limitado a ~5 filas por grupo. Proyección 2D vía PCA. |
| PCA | Matriz de correlación + autovalores/autovectores de Jacobi. |
| Correlaciones | Pearson y Spearman (rangos promedio); significancia con t aproximada. |
| Anomalías | Z-score muestral y cercas de Tukey (1.5×IQR); criterio z, IQR o ambos. |
| Regresión lineal | Mínimos cuadrados con ecuaciones normales; error estándar y t por coeficiente; partición entrenamiento/prueba. |
| Pronóstico | Agrega por periodo; modelos ingenuo, tendencia lineal y Holt (rejilla α,β); elige por RMSE en periodos reservados (o en muestra si hay pocos). |
| Clasificación | Regresión logística con descenso de gradiente y regularización L2; AUC por rangos; objetivo numérico por umbral (mediana) o categórico uno-contra-resto. |

**Frontend:** `frontend/js/app-lab.js` (vista registrada en `app.js` como `lab`), cliente en
`api.js` (`getMlDatasets`, `runMl`). El asistente (wizard) mantiene el estado por tarjeta;
"Ejecutar ejemplo" deduce la configuración por nombre (p. ej. un objetivo tipo ventas/ingreso).

## Limitaciones conocidas

- Con pocos datos los resultados son orientativos (el pronóstico advierte si hay menos de 6 periodos).
- Los modelos se reentrenan en cada ejecución; no se guardan ni versionan.
- Regresión y clasificación son lineales; no hay árboles ni redes neuronales.

## Archivos

`frontend/js/app-lab.js`, `frontend/css/lab.css`, `frontend/js/api.js`,
`backend: ml/MlController.java`, `ml/MlService.java`, `ml/MlMath.java`.
