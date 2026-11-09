// ml-catalog.js — catálogo de algoritmos del módulo de Experimentos de ML.
// Cada entrada define qué variables pide (roles), qué hiperparámetros expone y
// qué envía al backend (/api/v1/ml/experiments/{id}/runs).

const TEST = { key: "testSize", label: "Datos de prueba", type: "select", default: 0.2,
  options: [[0.1, "10%"], [0.2, "20%"], [0.25, "25%"], [0.3, "30%"]], help: "Filas reservadas que el modelo no ve al entrenar." };
const THRESH = { key: "threshold", label: "Umbral del objetivo", type: "number", default: "", placeholder: "Mediana", step: "any",
  help: "Solo para objetivos numéricos: separa en alto / bajo.", when: "numericTarget" };

export const FAMILIES = [
  { id: "segment", label: "Segmentación", desc: "Agrupar registros parecidos", algos: ["kmeans", "hierarchical", "dbscan"] },
  { id: "explore", label: "Exploración y estructura", desc: "Relaciones, dimensiones y rarezas", algos: ["pca", "correlation", "anomaly", "rules"] },
  { id: "regression", label: "Regresión", desc: "Predecir un valor numérico", algos: ["linear", "ridge", "lasso", "poly", "tree_r", "forest_r", "gbm_r", "knn_r"] },
  { id: "classification", label: "Clasificación", desc: "Predecir una clase o probabilidad", algos: ["logistic", "bayes", "tree_c", "forest_c", "gbm_c", "knn_c"] },
  { id: "series", label: "Series de tiempo", desc: "Proyectar hacia el futuro", algos: ["forecast"] },
  { id: "automl", label: "AutoML", desc: "Comparar modelos y elegir el mejor", algos: ["automl_r", "automl_c"] },
];

const FEATS_NUM2 = { features: { kind: "numeric", min: 2, label: "Variables numéricas" } };
const SUP_R = { target: { kind: "numeric", label: "Variable a predecir" }, features: { kind: "numeric", min: 1, label: "Variables predictoras" } };
const SUP_C = { target: { kind: "any", label: "Qué clasificar" }, features: { kind: "numeric", min: 1, label: "Variables predictoras" } };

export const ALGOS = {
  kmeans: { algorithm: "kmeans", name: "K-Means", family: "segment", kind: "No supervisado",
    desc: "Divide los registros en k grupos alrededor de centroides. Elige k automáticamente por silueta.",
    roles: FEATS_NUM2, caseTest: true,
    params: [
      { key: "k", label: "Número de grupos (k)", type: "select", default: 0, options: [[0, "Automático"], ...[2, 3, 4, 5, 6, 7, 8, 9, 10].map((v) => [v, String(v)])] },
      { key: "standardize", label: "Estandarizar variables", type: "select", default: true, options: [[true, "Sí (recomendado)"], [false, "No"]] },
    ] },
  hierarchical: { algorithm: "hierarchical", name: "Clúster jerárquico", family: "segment", kind: "No supervisado",
    desc: "Une los registros de abajo hacia arriba y corta el árbol donde los grupos se separan más.",
    roles: FEATS_NUM2,
    params: [
      { key: "linkage", label: "Enlace", type: "select", default: "ward", options: [["ward", "Ward (varianza mínima)"], ["average", "Promedio"], ["complete", "Completo"], ["single", "Simple"]] },
      { key: "k", label: "Número de grupos", type: "select", default: 0, options: [[0, "Automático (mayor salto)"], ...[2, 3, 4, 5, 6, 7, 8].map((v) => [v, String(v)])] },
    ] },
  dbscan: { algorithm: "dbscan", name: "DBSCAN", family: "segment", kind: "No supervisado",
    desc: "Agrupa por densidad: encuentra grupos de cualquier forma y separa el ruido.",
    roles: FEATS_NUM2,
    params: [
      { key: "eps", label: "Radio (eps)", type: "number", default: "", placeholder: "Automático", step: "any", help: "Distancia en unidades estandarizadas." },
      { key: "minPts", label: "Mínimo de vecinos", type: "number", default: "", placeholder: "Automático", step: 1, min: 2 },
    ] },
  pca: { algorithm: "pca", name: "PCA", family: "explore", kind: "Reducción", desc: "Resume variables correlacionadas en componentes que conservan la varianza.",
    roles: FEATS_NUM2, params: [] },
  correlation: { algorithm: "correlation", name: "Correlaciones", family: "explore", kind: "Exploratorio", desc: "Pearson y Spearman entre todas las variables, con significancia.",
    roles: FEATS_NUM2, params: [] },
  anomaly: { algorithm: "anomaly", name: "Detección de anomalías", family: "explore", kind: "No supervisado", desc: "Marca registros fuera de patrón con Z-score y rango intercuartil.",
    roles: { features: { kind: "numeric", min: 1, label: "Variables numéricas" } },
    params: [
      { key: "method", label: "Criterio", type: "select", default: "both", options: [["both", "Z-score o IQR"], ["zscore", "Solo Z-score"], ["iqr", "Solo IQR"]] },
      { key: "threshold", label: "Umbral Z (desviaciones)", type: "number", default: 2.5, min: 1, step: 0.1 },
    ] },
  rules: { algorithm: "rules", name: "Reglas de asociación", family: "explore", kind: "No supervisado", desc: "Apriori: combinaciones de valores que ocurren juntas (si A entonces B).",
    roles: { features: { kind: "categorical", min: 2, label: "Variables categóricas" } },
    params: [
      { key: "minSupport", label: "Soporte mínimo", type: "number", default: 0.1, min: 0.01, max: 0.9, step: 0.01, help: "Fracción de registros donde aparece la combinación." },
      { key: "minConfidence", label: "Confianza mínima", type: "number", default: 0.5, min: 0.05, max: 1, step: 0.05 },
    ] },
  linear: { algorithm: "linear", name: "Regresión lineal", family: "regression", kind: "Supervisado", desc: "Mínimos cuadrados con errores estándar y significancia por coeficiente.",
    roles: SUP_R, caseTest: true, params: [TEST] },
  ridge: { algorithm: "ridge", name: "Ridge (L2)", family: "regression", kind: "Supervisado", desc: "Regresión lineal con penalización L2: estable con variables correlacionadas.",
    roles: SUP_R, caseTest: true, params: [{ key: "lambda", label: "Penalización (λ)", type: "number", default: 1, min: 0, step: "any" }, TEST] },
  lasso: { algorithm: "lasso", name: "Lasso (L1)", family: "regression", kind: "Supervisado", desc: "Penalización L1: lleva a cero los coeficientes poco útiles (selección de variables).",
    roles: SUP_R, caseTest: true, params: [{ key: "lambda", label: "Penalización (λ)", type: "number", default: 0.1, min: 0, step: "any" }, TEST] },
  poly: { algorithm: "poly", name: "Regresión polinómica", family: "regression", kind: "Supervisado", desc: "Agrega potencias e interacciones para capturar curvas.",
    roles: SUP_R, caseTest: true, params: [{ key: "degree", label: "Grado", type: "select", default: 2, options: [[2, "2"], [3, "3"], [4, "4"]] }, { key: "lambda", label: "Penalización (λ)", type: "number", default: 1, min: 0, step: "any" }, TEST] },
  tree_r: { algorithm: "tree", task: "regression", name: "Árbol de decisión", family: "regression", kind: "Supervisado", desc: "Reglas de corte sucesivas (CART). Interpretable y no lineal.",
    roles: SUP_R, caseTest: true, params: [{ key: "maxDepth", label: "Profundidad máxima", type: "number", default: 5, min: 1, max: 12, step: 1 }, { key: "minLeaf", label: "Mínimo por hoja", type: "number", default: 5, min: 1, step: 1 }, TEST] },
  forest_r: { algorithm: "forest", task: "regression", name: "Bosque aleatorio", family: "regression", kind: "Supervisado", desc: "Promedio de muchos árboles sobre muestras aleatorias. Robusto y preciso.",
    roles: SUP_R, caseTest: true, params: [{ key: "nTrees", label: "Número de árboles", type: "number", default: 60, min: 5, max: 300, step: 5 }, { key: "maxDepth", label: "Profundidad máxima", type: "number", default: 8, min: 1, max: 12, step: 1 }, { key: "minLeaf", label: "Mínimo por hoja", type: "number", default: 3, min: 1, step: 1 }, TEST] },
  gbm_r: { algorithm: "gbm", task: "regression", name: "Gradient Boosting", family: "regression", kind: "Supervisado", desc: "Árboles en secuencia, cada uno corrige el error del anterior.",
    roles: SUP_R, caseTest: true, params: [{ key: "rounds", label: "Rondas", type: "number", default: 80, min: 10, max: 400, step: 10 }, { key: "learningRate", label: "Tasa de aprendizaje", type: "number", default: 0.1, min: 0.01, max: 1, step: 0.01 }, { key: "maxDepth", label: "Profundidad por árbol", type: "number", default: 3, min: 1, max: 6, step: 1 }, TEST] },
  knn_r: { algorithm: "knn", task: "regression", name: "K vecinos más cercanos", family: "regression", kind: "Supervisado", desc: "Predice con el promedio de los k registros más parecidos.",
    roles: SUP_R, caseTest: true, params: [{ key: "k", label: "Vecinos (k)", type: "number", default: 5, min: 1, max: 50, step: 1 }, TEST] },
  logistic: { algorithm: "logistic", name: "Regresión logística", family: "classification", kind: "Supervisado", desc: "Probabilidad de la clase positiva con coeficientes interpretables.",
    roles: SUP_C, caseTest: true, params: [TEST, THRESH] },
  bayes: { algorithm: "bayes", name: "Naive Bayes", family: "classification", kind: "Supervisado", desc: "Clasificador probabilístico gaussiano, rápido y robusto con pocos datos.",
    roles: SUP_C, caseTest: true, params: [TEST, THRESH] },
  tree_c: { algorithm: "tree", task: "classification", name: "Árbol de decisión", family: "classification", kind: "Supervisado", desc: "Reglas de corte que separan las clases.",
    roles: SUP_C, caseTest: true, params: [{ key: "maxDepth", label: "Profundidad máxima", type: "number", default: 5, min: 1, max: 12, step: 1 }, { key: "minLeaf", label: "Mínimo por hoja", type: "number", default: 5, min: 1, step: 1 }, TEST, THRESH] },
  forest_c: { algorithm: "forest", task: "classification", name: "Bosque aleatorio", family: "classification", kind: "Supervisado", desc: "Votación promedio de muchos árboles.",
    roles: SUP_C, caseTest: true, params: [{ key: "nTrees", label: "Número de árboles", type: "number", default: 60, min: 5, max: 300, step: 5 }, { key: "maxDepth", label: "Profundidad máxima", type: "number", default: 8, min: 1, max: 12, step: 1 }, TEST, THRESH] },
  gbm_c: { algorithm: "gbm", task: "classification", name: "Gradient Boosting", family: "classification", kind: "Supervisado", desc: "Boosting con pérdida logística.",
    roles: SUP_C, caseTest: true, params: [{ key: "rounds", label: "Rondas", type: "number", default: 80, min: 10, max: 400, step: 10 }, { key: "learningRate", label: "Tasa de aprendizaje", type: "number", default: 0.1, min: 0.01, max: 1, step: 0.01 }, { key: "maxDepth", label: "Profundidad por árbol", type: "number", default: 3, min: 1, max: 6, step: 1 }, TEST, THRESH] },
  knn_c: { algorithm: "knn", task: "classification", name: "K vecinos más cercanos", family: "classification", kind: "Supervisado", desc: "Clase mayoritaria entre los k registros más parecidos.",
    roles: SUP_C, caseTest: true, params: [{ key: "k", label: "Vecinos (k)", type: "number", default: 5, min: 1, max: 50, step: 1 }, TEST, THRESH] },
  forecast: { algorithm: "forecast", name: "Pronóstico", family: "series", kind: "Series de tiempo", desc: "Compara modelo ingenuo, tendencia lineal y Holt; proyecta con banda de confianza.",
    roles: { measure: { kind: "numeric", label: "Medida" }, period: { kind: "period", label: "Campo de periodo" } },
    params: [
      { key: "horizon", label: "Periodos a pronosticar", type: "number", default: 3, min: 1, max: 24, step: 1 },
      { key: "aggregation", label: "Agregación por periodo", type: "select", default: "sum", options: [["sum", "Suma"], ["avg", "Promedio"]] },
    ] },
  automl_r: { algorithm: "automl", task: "regression", name: "AutoML · Regresión", family: "automl", kind: "AutoML", desc: "Entrena 8 modelos de regresión con la misma partición y elige el de menor error.",
    roles: SUP_R, caseTest: true, params: [TEST] },
  automl_c: { algorithm: "automl", task: "classification", name: "AutoML · Clasificación", family: "automl", kind: "AutoML", desc: "Entrena 6 clasificadores y elige el de mayor AUC.",
    roles: SUP_C, caseTest: true, params: [TEST, THRESH] },
};

export const ALGO_BY_BACKEND = (algorithm, task) =>
  Object.entries(ALGOS).find(([, a]) => a.algorithm === algorithm && (!a.task || !task || a.task === task))?.[0] || null;

/** Configuración inicial razonable para un algoritmo y un dataset. */
export function defaultsFor(key, ds) {
  const a = ALGOS[key];
  const N = ds.numeric.map((f) => f.field);
  const C = ds.categorical.map((f) => f.field);
  const D = ds.dates.map((f) => f.field);
  // Objetivo sugerido por prioridad de nombre (ventas antes que ingreso, etc.), no por orden de columnas.
  const PRIORITY = [/venta|sales/i, /ingreso|revenue/i, /monto|importe|total/i, /precio|price/i];
  const pref = PRIORITY.map((re) => N.find((f) => re.test(f))).find(Boolean) || N[0];
  const cfg = { roles: {}, params: {} };
  a.params.forEach((p) => { cfg.params[p.key] = p.default; });
  const r = a.roles;
  if (r.target) cfg.roles.target = pref || "";
  if (r.features) {
    const pool = r.features.kind === "categorical" ? C : N.filter((f) => f !== cfg.roles.target);
    cfg.roles.features = pool.slice(0, r.features.kind === "categorical" ? 4 : 6);
  }
  if (r.measure) cfg.roles.measure = pref || "";
  if (r.period) cfg.roles.period = D[0] || C.find((f) => /mes|periodo|fecha|date|month|a[nñ]o|year|trimestre|semana/i.test(f)) || C[0] || "";
  return cfg;
}

export function validateCfg(key, cfg) {
  const r = ALGOS[key].roles;
  if (r.target && !cfg.roles.target) return "Elige la variable objetivo.";
  if (r.features && (cfg.roles.features || []).length < r.features.min)
    return `Selecciona al menos ${r.features.min} ${r.features.kind === "categorical" ? "variable(s) categórica(s)" : "variable(s) numérica(s)"}.`;
  if (r.measure && !cfg.roles.measure) return "Elige la medida.";
  if (r.period && !cfg.roles.period) return "Elige el campo de periodo.";
  return null;
}

/** Cuerpo de la petición al backend. */
export function payloadFor(key, cfg, input) {
  const a = ALGOS[key];
  const params = {};
  Object.entries(cfg.roles).forEach(([k, v]) => { params[k] = v; });
  a.params.forEach((p) => {
    const v = cfg.params[p.key];
    if (v === "" || v === null || v === undefined) return;
    params[p.key] = p.type === "number" ? Number(v) : v === "true" ? true : v === "false" ? false : (typeof p.default === "number" && !Number.isNaN(Number(v)) ? Number(v) : v);
  });
  if (cfg.positive) params.positive = cfg.positive;
  if (a.task) params.task = a.task;
  if (input) params.input = input;
  return { algorithm: a.algorithm, params };
}
