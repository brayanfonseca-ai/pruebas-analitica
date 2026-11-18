# 17 · Qué cambió · ¿qué pasaría si…? · del dato a la acción · agente de guardia

Vista **Qué cambió · simular · actuar** de cada app (selector de vistas → *Analizar*, atajo `Alt+Shift+Q`). La ve cualquiera que vea la app; guardar listas y configurar el agente exige *Editar hojas* (`charts:edit`). Todo se calcula en el motor, sin IA, y nada modifica los datos.

## Qué cambió y por qué
- Eliges una medida (maestra —las certificadas con ✓— o fx simple/compuesta), opcionalmente el campo de tiempo, los dos periodos (por defecto el último contra el anterior) y un filtro.
- Devuelve los dos valores, la variación (en puntos si la medida es un %; en valor y % si no) y un **relato**: «% Inactivos bajó 9,32 puntos: pasó de 19,43 % en 2026-09 a 10,11 % en 2026-10. Lo que más lo explica: TIPO DE NOMINA — CONDUCTORES (21,02 % → 11,4 %; −9,62 puntos, con el 81,49 % de las filas)…».
- **Descomposición** por cada dimensión candidata (texto, 2–60 valores, que no sea identificador ni tiempo):
  - medidas **aditivas** (Sum/Count): cada segmento trae su aporte exacto y el % del cambio. Si un segmento supera el cambio total («otros segmentos lo compensan») se dice así;
  - medidas **no aditivas** (%, promedios, compuestas): los segmentos se ordenan por su cambio **ponderado por su volumen de filas**, para que un segmento de una persona que pasa de 100 % a 0 % no tape lo importante.
- **Ver registros** en cualquier segmento abre *Del dato a la acción* con esos filtros (periodo + segmento).

## ¿Qué pasaría si…?
- Uno o varios **cambios** sobre una copia de los datos: fijar un valor, multiplicar o sumar a un número; solo en las filas que cumplen un filtro (campo = valores) y/o una condición (`[EDAD EN AÑOS] < 30`); y en un **% de esas filas** (reparto determinista).
- Recalcula la medida antes y después, en total y, si eliges una dimensión, por segmento.
- Ejemplo con la app de rotación: retener el 20 % de los inactivos de GALAPA (`ESTADO CONTRATO` = Activo en el 20 % de las filas con `ESTADO CONTRATO` = Inactivo y `SUCURSAL` = GALAPA, 185 filas) → % Inactivos pasaría de 48,27 % a 46,99 %; GALAPA de 40,91 % a 32,76 %.
- Supuesto explícito: el resto de las filas no cambia. Las dimensiones calculadas maestras no se recalculan en el escenario.

## Del dato a la acción
- Los **registros** detrás de una cifra: tabla (automática según los campos usados), filtros, condición por fila (`[probabilidad_retiro] > 0.6`), orden y columnas. Muestra hasta 200 y el total.
- **Exportar CSV**: UTF-8 con BOM y `;` (Excel en español lo abre en columnas); hasta 10 000 filas; los textos que empiezan por `= + - @` se escapan para evitar fórmulas.
- **Listas guardadas**: la misma búsqueda con nombre, para ver, exportar o **enviar a un webhook** (Teams, Power Automate, Zapier, n8n o un API propio). El webhook recibe JSON `{source, app, list, reason, count, columns, rows (≤1000), truncated, generated_at, text}`; `text` sirve tal cual para Teams/Slack. La URL se guarda en el servidor y se muestra enmascarada (suele llevar un secreto). Solo `http`/`https`, sin seguir redirecciones, 10 s de espera.
- **Alerta → acción**: en *Automatizar*, una alerta puede tener una lista asociada; al dispararse la lista se ejecuta y se envía, y el aviso en la campana dice cuántos registros salieron.

## Agente de guardia
- Se activa en la pestaña *Agente de guardia* con un umbral (por defecto 15 %; en métricas que son %, puntos) y, opcionalmente, las métricas a vigilar (vacío = las certificadas; si no hay, las maestras; si tampoco, los registros y los totales numéricos de la tabla principal).
- Revisa **después de cada carga** (manual, programada o «ejecutar ahora») y al menos **una vez al día**: compara el último periodo con el anterior de cada métrica (con *Qué cambió*) y la salud de datos. Si algo supera el umbral o hay problemas críticos, deja un aviso **Agente de guardia** en la campana de quien lo activó, con el relato; el enlace abre esta vista.
- **Revisar ahora** muestra la tabla de métricas (antes, ahora, cambio, aviso / en calma) y la salud.

## API
| Método | Ruta | Descripción |
|---|---|---|
| POST | `/apps/{id}/insights/explain` | `{expression \| master_id, label?, time_field?, current?, previous?, selections?, dimensions?, top?}` |
| POST | `/apps/{id}/insights/rows` · `/rows.csv` | `{table?, selections?, where?, fields?, sort?, desc?, limit?}` |
| POST | `/apps/{id}/insights/whatif` | `{measures:[{expression \| master_id, label?}], changes:[{field, op set\|multiply\|add, value, share?, selections?, where?}], dimension?, selections?}` |
| GET/POST | `/apps/{id}/actions` | Listas `{name, table?, selections?, where?, fields?, sort?, desc?, webhook_url?}` (`charts:edit` para crear) |
| PUT/DELETE | `/apps/{id}/actions/{aid}` · POST `/run` `{send}` · GET `/export.csv` | Editar, borrar, ejecutar/enviar, exportar |
| GET/PUT/DELETE | `/apps/{id}/watchdog` · POST `/watchdog/run` | Agente de guardia `{threshold_pct, measures, enabled}` |

Tablas: `action_lists`, `watchdogs`; `alerts.action_id`.

## MCP
`explain_change`, `find_rows`, `simulate_whatif`, `list_action_lists`, `save_action_list`, `run_action_list` (con `send` ENVÍA DATOS FUERA), `delete_action_list`, `get_watchdog`, `set_watchdog`, `run_watchdog`; `save_alert` acepta `action_id`.

## Archivos
`backend-springboot/.../ask/InsightService.java`, `InsightController.java`; `automation/ActionService.java`, `WatchdogService.java`; `frontend/js/app-insights.js`, `app-automatizar.js` (lista en la alerta), `topbar.js`, `css/theme.css` (sección 37).
