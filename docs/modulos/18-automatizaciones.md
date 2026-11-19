# 18 · Automatizaciones por nodos

Página **Automatizaciones** (`/pages/automatizaciones.html`, menú lateral). Exige *Editar gráficos* (`charts:edit`). También se llega desde **Crear → Automatización** (abre «Nueva automatización») y desde **Crear → Conexión de automatización** (abre las credenciales).

Una automatización es un flujo de **nodos conectados**, como en n8n: un disparador arranca el flujo y cada nodo recibe una lista de registros JSON, hace su trabajo y pasa su salida a los nodos conectados.

## La lista
- **Plantillas** listas para usar. Al elegir una, pide solo lo que necesita (app, correo, teléfono, cuenta SMTP/WhatsApp/webhook, métrica):
  - Recarga diaria y aviso.
  - Riesgo de retiro por WhatsApp.
  - Informe semanal con agente analista.
  - Alerta → Teams/Slack + CSV por correo.
  - Pregúntale por webhook.
- **Tus automatizaciones**: tarjetas con los nodos, el disparador, la última ejecución y su estado, y la próxima ejecución. El interruptor activa o pausa sin abrir el editor.
- **🔑 Credenciales**: cuentas privadas del usuario. Las contraseñas y tokens nunca vuelven a mostrarse (se ven como `••••••`). Al editar, dejar el secreto vacío conserva el guardado. **Probar** se conecta y se autentica de verdad al SMTP; los demás tipos validan que estén completos.

| Tipo | Campos |
|---|---|
| Correo (SMTP) | host, puerto, seguridad (STARTTLS / SSL / ninguna), usuario, contraseña, remitente |
| WhatsApp Business (Meta Cloud API) | phone_number_id, token, api_base opcional |
| WhatsApp (Twilio) | account_sid, auth_token, número `from` |
| Webhook de canal (Teams / Slack / Google Chat) | URL |
| Cabecera HTTP | nombre de cabecera y valor (p. ej. `Authorization: Bearer …`) |

## El editor
- **Paleta** (izquierda), con buscador y nodos por categoría. Para agregar un nodo:
  - **Arrástralo** al lienzo.
  - O haz **doble clic** en él. Si hay un nodo seleccionado, el nuevo se coloca a su derecha y se conecta solo. El lienzo se desplaza para mostrarlo y nunca queda encima de otro nodo.
- **Lienzo**:
  - Tira del punto derecho de un nodo hasta otro para **conectarlos**. «Si / sino» tiene dos salidas, *sí* y *no*.
  - Arrastra un nodo para moverlo y el fondo para desplazar la vista. La rueda hace zoom; ⤢ muestra todo.
  - **Supr** borra el nodo o la conexión seleccionada (al seleccionar una conexión aparece una ✕) y **Ctrl+D** duplica.
- **Inspector** (derecha): nombre del nodo y sus parámetros. Los selectores de app, tabla, campo, medida maestra y credencial se llenan con tus datos; ＋ crea una credencial sin salir. Además:
  - **Variables disponibles**: tras ejecutar, muestra los campos de los nodos anteriores. Un clic inserta `{{ $json.campo }}` o `{{ $node["Nombre"].json.campo }}` en el último campo que tocaste.
  - **Desactivar**: el nodo deja pasar los datos sin ejecutarse.
  - **Si falla, seguir**: el error pasa como dato `{error, node}`, el paso queda «⚠ siguió» y el flujo continúa.
  - Sin selección, muestra la **URL del webhook** (copiar / regenerar), la ayuda de plantillas y «Eliminar automatización».
- **Guardado automático** (y Ctrl+S). Los **pendientes** aparecen arriba: sin disparador, nodos sueltos, parámetros obligatorios vacíos o una credencial que falta. Con pendientes la automatización no se puede activar.
- **▶ Ejecutar** corre el flujo ya, aunque esté pausado:
  - Cada nodo muestra una insignia: ✓ con el número de registros, ⚠ si siguió tras fallar, ✕ con el error.
  - Las conexiones por donde pasaron datos se animan.
  - Abajo aparece el **registro de pasos**. Un clic en un paso abre su salida en tabla o JSON.
- **Ejecuciones**: historial (manual, programada, webhook, recarga, alerta) con estado, duración y error. «Ver en el lienzo» vuelve a pintar esa ejecución.
- **Activa / Pausada**: activa, corre sola según su disparador.

## Nodos (23)
| Categoría | Nodo | Qué hace |
|---|---|---|
| Disparadores | Ejecutar manualmente | Con datos de prueba opcionales |
| | Programado | Cada N minutos, cada hora, diario o semanal (hora del servidor) |
| | Webhook (URL) | `POST` JSON o `GET` con parámetros a `/api/v1/hooks/flows/{token}`. Responde `{ok, run_id, data}` con la salida del último nodo; 409 si está pausada, 404 si el token no existe |
| | Al recargar datos | Cuando termina una carga de la app (cualquiera / sale bien / falla o tiene advertencias) |
| | Al dispararse una alerta | De una app (opcionalmente una alerta concreta) |
| Datos | Recargar datos | Igual que «Cargar datos» del editor |
| | Calcular medida | fx simple o compuesta, o maestra; total o por dimensión (top N), con filtros |
| | Buscar registros | Filas que cumplen filtros y una condición, ordenadas, con máximo |
| | Preguntar a los datos | «Pregúntale a tus datos» en español |
| | Qué cambió y por qué | Último periodo frente al anterior, con el relato de los segmentos que lo causan |
| | Salud de datos | Puntaje y problemas |
| | ¿Qué pasaría si…? | Simulación antes/después |
| IA | Agente de IA | Ver abajo |
| Lógica | Si / sino · Filtrar | Condiciones `=`, `≠`, `>`, `≥`, `<`, `≤`, contiene, vacío / no vacío |
| | Preparar campos | Crea o cambia campos con plantillas (p. ej. un mensaje por persona) |
| | Agrupar en uno | Junta los registros en uno (lista, conteo y tabla HTML) |
| | Esperar | Hasta 300 s |
| Acciones | Enviar correo | SMTP, HTML, CC, adjuntar los registros en CSV, un correo por registro |
| | Enviar WhatsApp | Meta (texto o plantilla aprobada) o Twilio; varios números; uno por registro |
| | Teams / Slack / Google Chat | Publica `{"text"}` en el webhook entrante del canal |
| | Petición HTTP | GET/POST/PUT/PATCH/DELETE con cabeceras, cuerpo y credencial; devuelve la respuesta |
| | Aviso en la campana | Aviso para quien creó el flujo; abre la automatización |

### Agente de IA
- Usa Amazon Bedrock (el mismo modelo del asistente).
- **Especialidades**: analista de datos, redactor de mensajes (correo / WhatsApp), clasificador / priorizador, experto en rotación de personal o personalizado. Las **instrucciones** propias se suman a la especialidad.
- Recibe los registros que le llegan (opcional) y la **tarea**, que admite plantillas.
- Si se le da una **app**, puede usar herramientas por su cuenta (hasta 4 pasos):
  - preguntar a los datos;
  - buscar registros;
  - explicar qué cambió.
- Responde en **texto** (`text`) o **JSON**, cuyos campos usan los nodos siguientes.

## Plantillas `{{ }}`
Se pueden usar en cualquier campo de texto. No ejecutan código.
- `{{ $json.campo }}`: el registro que llega.
- `{{ $items }}` y `{{ $items.length }}`: todos los registros.
- `{{ $node["Nombre"].json.campo }}` y `$node["Nombre"].items`: salida de otro nodo.
- `{{ $trigger.campo }}`: los datos con que arrancó.
- `$now`, `$today`, `$flow.name`, `$run.id`.
- **Filtros**: `| number:2`, `| percent`, `| round:1`, `| upper`, `| lower`, `| json`, `| count`, `| join:", "`, `| list:campo`, `| table` (tabla HTML para correos), `| default:"—"`.
- Si el campo es solo una expresión (`{{ $items }}`), conserva el tipo: lista, número u objeto.

## Ejecución y seguridad
- El flujo corre **con los permisos de quien lo creó**: solo ve apps que esa persona puede ver, y «Recargar datos» exige que pueda importar y editar.
- Cada persona ve y edita sus automatizaciones; el administrador, todas. Las credenciales son siempre privadas.
- Los disparadores por evento corren en segundo plano (hasta 3 a la vez) y no bloquean la recarga ni la alerta. Un flujo no se vuelve a disparar a sí mismo; por ejemplo, si un flujo «al recargar» recarga la misma app, no se repite en bucle.
- Hay un máximo de 200 pasos por ejecución. Se guardan las últimas ejecuciones con el detalle por nodo (muestras de hasta 25 registros por salida).
- El webhook es **público** y se autentica solo con su token: `AuthInterceptor` exime `/api/v1/hooks/flows/**`. Regenerar la URL invalida la anterior.

## API
| Método | Ruta | Descripción |
|---|---|---|
| GET | `/flows/catalog` | Categorías, nodos con sus parámetros, tipos de credencial y ayuda de plantillas |
| GET | `/flows/templates` | Plantillas con marcadores `{{app}}`, `{{smtp}}`, `{{email}}`, `{{phone}}`, `{{whatsapp}}`, `{{webhook}}`, `{{measure}}`, `{{measure_label}}` |
| GET/POST | `/flows` | Lista / crea `{name, description?, graph}` (201) |
| GET/PUT/DELETE | `/flows/{id}` | Leer (con `problems` y `webhook_path`) / reemplazar / borrar (204) |
| POST | `/flows/{id}/enabled` | `{enabled}`; 400 si hay pendientes |
| POST | `/flows/{id}/run` | `{data?}` → `{run_id, status, error, duration_ms, steps[], output}` |
| GET | `/flows/{id}/runs?limit=` · `/flows/{id}/runs/{runId}` | Historial y detalle |
| POST | `/flows/{id}/webhook/rotate` | URL nueva |
| GET/POST | `/flows/credentials` | Lista / crea `{kind, name, config}` |
| PUT/DELETE | `/flows/credentials/{id}` | Edita / borra |
| POST | `/flows/credentials/{id}/test` | `{ok, message}` |
| POST/GET | `/hooks/flows/{token}` | **Público**: dispara el flujo |

Grafo: `{nodes:[{id, type, name, x, y, params, disabled?}], edges:[{from, port, to}]}`. Los nombres de nodo son únicos porque los usa `$node["Nombre"]`. El servidor rechaza conexiones hacia un disparador o hacia puertos que no existen.

Tablas: `flows`, `flow_runs`, `flow_credentials`.

## MCP
`list_flow_nodes`, `list_flow_templates`, `list_flows`, `get_flow`, `save_flow`, `delete_flow`, `set_flow_enabled`, `run_flow`, `list_flow_runs`, `get_flow_run`, `rotate_flow_webhook`, `list_flow_credentials`, `save_flow_credential`, `delete_flow_credential`, `test_flow_credential`.

## Archivos
- Backend:
  - `backend-springboot/.../flow/FlowCatalog.java` (catálogo, fuente única para el motor, la UI y el MCP)
  - `Templates.java`
  - `FlowEngine.java` (motor y nodos)
  - `FlowService.java` (validación, reloj, eventos, plantillas)
  - `FlowRepository.java`
  - `FlowController.java`
  - `automation/AutomationEvents.java` (eventos de recarga y alerta)
- Frontend: `frontend/pages/automatizaciones.html`, `frontend/js/flows.js`, `css/theme.css` (sección 38).
- Dependencia: `spring-boot-starter-mail`.
