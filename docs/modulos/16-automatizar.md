# 16 · Automatizar: carga programada, alertas y salud de datos

Vista **Automatizar · alertas y salud** de cada app (selector de vistas → *Operar*, atajo `Alt+Shift+T`). La ve cualquiera que vea la app; programar la carga exige *Importar datos* (`data:import`).

## Salud de datos
Puntaje 0–100 (Buena ≥ 85, Regular ≥ 60, Mala) con los problemas ordenados por gravedad y una recomendación:
- **Crítico** (−25 c/u): tabla vacía; perdió ≥ 50 % de filas frente a la carga anterior; la última carga programada falló.
- **Advertencia** (−8 c/u, máx. −48): perdió ≥ 20 % de filas; columna totalmente vacía o con ≥ 50 % vacíos; ≥ 5 % de filas duplicadas; números mezclados con texto en una columna casi numérica; datos más recientes con más de 120 días; carga programada atrasada o con advertencias.
- **Aviso** (−2 c/u, máx. −10): 20–50 % vacíos; columnas con un único valor (agrupadas por tabla); pocos duplicados; datos de 45–120 días; app sin carga programada.
- Por tabla muestra filas, variación frente a la carga anterior (`table_loads`), fecha de carga y dato más reciente.

## Carga programada
- Frecuencias: **cada N minutos** (5–10080), **cada hora**, **diaria** a una hora, **semanal** (día + hora). Una por app.
- Corre el mismo «Cargar datos» del editor (re-extrae de las conexiones) **con los permisos de quien la guardó**. Si esa persona ya no existe o está inactiva, la ejecución falla y queda registrado.
- **Avisarme**: solo si falla (por defecto), siempre o nunca → evento en la campana de quien programó. Si tras la carga hay problemas críticos de salud, también avisa.
- **Ejecutar ahora** y **Historial de cargas** (manuales desde el editor, programadas y «ejecutar ahora», con estado, duración y detalle; se guardan las últimas 60).
- El reloj del servidor (`AutomationService.tick`, cada 30 s) ejecuta lo que toca; la próxima ejecución se fija antes de correr.

## Alertas
- Medida: **expresión fx** (simple o compuesta, p. ej. `Count([FECHA RETIRO]) / Count([CEDULA]) * 100`) o una **medida maestra** (las certificadas con ✓).
- Condición: `>`, `≥`, `<`, `≤`, `=`, `≠` o **cambia más de X %** respecto a la revisión anterior. Filtro opcional (campo + valores).
- Revisión: **cada vez que se recargan los datos** (por defecto) o **cada N minutos**.
- Al **dispararse** y al **resolverse** avisan en la campana de su dueño (no se repite mientras siga disparada). Estados: *Disparada*, *En calma*, *Error* (la medida ya no se puede calcular) y *Sin revisar*.
- Son personales: cualquiera que vea la app (también un visualizador en Producción) crea las suyas; editar o borrar una ajena exige ser administrador o tener `apps:publish`.

## Campana
- Ahora la tiene **todo usuario**: cada uno ve sus eventos de automatización (alerta disparada / resuelta, recarga completada / con problemas, salud de datos) con filtro **Alertas**.
- El administrador ve además la actividad de la plataforma, como antes. El estado de lectura («marcar leído», «vaciar») es por usuario.

## API
| Método | Ruta | Descripción |
|---|---|---|
| GET | `/apps/{id}/schedule` | `{schedule \| null, runs}` |
| PUT/DELETE | `/apps/{id}/schedule` | `{frequency, interval_minutes?, time_of_day?, weekday?, notify?, enabled?}` (`data:import`) |
| POST | `/apps/{id}/schedule/run` | Ejecuta la carga ahora → `{ok, status, message, log, tables, alerts_checked}` |
| GET | `/apps/{id}/reload-runs?limit=` | Historial de cargas |
| GET/POST | `/apps/{id}/alerts` | Lista / crea `{name, expression \| master_id, op, threshold, selections?, check_mode?, interval_minutes?, enabled?}` |
| PUT/DELETE | `/apps/{id}/alerts/{alertId}` | Edita / borra (dueño o `apps:publish`) |
| POST | `/apps/{id}/alerts/{alertId}/check` | Revisa ahora |
| GET | `/apps/{id}/health` | Salud de datos |
| GET | `/notifications` | Ahora para todo usuario (`dashboard:view`) |

Tablas: `schedules`, `reload_runs`, `table_loads`, `alerts`, `automation_events`.

## MCP
`get_schedule`, `set_schedule`, `delete_schedule`, `run_reload_now`, `list_reload_runs`, `list_alerts`, `save_alert`, `check_alert`, `delete_alert`, `get_data_health`; `list_notifications` devuelve también los eventos `evt:*`.

## Archivos
`backend-springboot/.../automation/AutomationService.java`, `HealthService.java`, `AutomationController.java`; `repo/NotificationRepository.java`, `web/NotificationController.java`, `web/ScriptController.java` (`runAs` + evento `ReloadDone`); `frontend/js/app-automatizar.js`, `topbar.js`, `css/theme.css` (sección 36).
