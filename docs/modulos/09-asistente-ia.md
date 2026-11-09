# Módulo: Asistente de IA "estrellita"

Un asistente conversacional flotante (botón ✦) integrado en los módulos, impulsado por **Amazon Bedrock · Nova Micro**. Cambia de rol (persona) según dónde se abre.

## A nivel de usuario
- Botón flotante ✦ siempre visible dentro de una app. Abre un panel de chat moderno (estilo Copilot/Gemini).
- **Personas** según el contexto:
  - *Ingeniero de datos* (Editor de carga): propone modelo (estrella/copo/araña), llaves y script.
  - *Analista* (Hoja/vista): responde preguntas sobre el tablero y las selecciones, con datos reales.
  - *Diseñador* (Hoja/edición): propone y **crea** gráficos, KPIs y dashboards; puede construir uno completo.
- Respuestas con **Markdown** renderizado.
- Botón **Ampliar** (pantalla completa) con **historial de conversaciones** (crear, cambiar, renombrar, eliminar), persistido por app.
- Cuando el agente propone una acción (p.ej. "crear dashboard"), aparece un botón para **ejecutarla** en la hoja.

## A nivel visual
- FAB con gradiente/acento azul de marca y glow sutil; panel con burbujas, estado "pensando", textarea con autosize. En fullscreen, barra lateral de historial. Estilos en `css/estrellita.css` (clases `star-*`).

## A nivel de desarrollo
- Frontend: `js/estrellita.js` — `mountEstrellita(opts)` devuelve `cleanup()` con `.setPersona(...)`. Consumido por `app-editor.js` (una instancia) y `app-hoja.js` (una instancia que alterna analista/diseñador). Render Markdown seguro; historial en `localStorage`.
- Backend:
  - `AiController` — `POST /ai/modelar`, `/analizar`, `/disenar`; `GET /ai/health`. Contrato defensivo: errores → `{ok:false}` 200, nunca 500. Puede devolver `action` (plan de acción) que el frontend ejecuta (`applyPlan`).
  - `BedrockService` — invoca Nova Micro vía **Converse API**, con el *inference profile* `us.amazon.nova-micro-v1:0` en `us-east-2`. Credenciales con `DefaultCredentialsProvider` (`~/.aws`). Lazy client; todo envuelto en try/catch.
- Config (`application.yml`, `datasense.ai.*`): región, model-id, profile, agent-name (`prueba`), max-tokens — por variables de entorno con defaults.

## Prompts (personas)
Los system prompts son **conversacionales y abiertos pero anclados a datos**: saludan breve, responden lo que se pregunta, no vuelcan estructura enlatada, no inventan cifras, y distinguen cada medida por su nombre.

## Archivos
`js/estrellita.js`, `css/estrellita.css`,
`backend: web/AiController.java`, `ai/BedrockService.java`, `resources/application.yml`.
