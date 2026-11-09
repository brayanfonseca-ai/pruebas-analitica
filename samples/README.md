# Datos de ejemplo

| Archivo | Uso |
|---|---|
| `datos_demo_ventas.xlsx` | 20 ventas por región, categoría y mes. Sirve para hojas, informes y el modelo lógico. |
| `clientes_demo_ml.csv` | 2 000 clientes sintéticos para Experimentos de ML. |

## `clientes_demo_ml.csv`

El archivo es sintético y tiene estructura conocida, así que sirve para comprobar que cada
algoritmo encuentra lo que debe.

- **Segmentos**: 3 grupos latentes (Joven digital, Familia, Senior) que difieren en edad, ingreso y visitas. K-Means y el clúster jerárquico deberían encontrar k = 3.
- **Ventas**: dependen sobre todo del gasto, en menor medida de las visitas, y de forma curva de la edad. La regresión polinómica supera ligeramente a la lineal.
- **Abandono** (Sí/No): sube cuando la satisfacción y las visitas bajan. Es útil para clasificación y AutoML.
- **Canal**: el segmento Joven digital compra Online el 85% de las veces. Las reglas de asociación lo detectan.
- **Atípicos**: 12 clientes con gasto 6 veces mayor de lo normal, para probar la detección de anomalías.
- **Mes**: 12 meses con tendencia creciente del gasto, para probar el pronóstico.

Al arrancar el entorno se cargó como la aplicación **Clientes (demo ML)**, con el experimento
de ejemplo **"Clientes: segmentos, ventas y abandono"**.
