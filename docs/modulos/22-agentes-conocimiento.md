# 22 · Agentes de IA y base de conocimiento

## Para qué sirve
Un **agente** es un especialista de IA que trabaja con los datos de una aplicación. Le das un rol (analista, vigía de riesgos, narrador, estratega, experto en el modelo), una app y unas herramientas. Cuando le preguntas, el agente:
1. Decide qué consultar.
2. Usa las cifras reales de PROTHEO.
3. Responde citando de dónde sale cada número.

Si no puede comprobar un dato, lo dice. Ejemplos:
- «¿Por qué subió Andina?»: usa *Qué cambió y por qué* y devuelve el segmento que explica el aumento.
- «¿Qué pasa si subimos precios un 5 %?»: usa *¿Qué pasaría si…?* y compara el antes y el después.
- «Escribe el resumen para la junta»: redacta con las medidas oficiales.

No hay conexiones externas. El cerebro es el motor interno de la plataforma (Amazon Bedrock, el mismo del asistente) y todas las herramientas son de **solo lectura**.

## Estudio de agentes (`pages/agentes.html`, menú «Agentes», permiso `agents:use`)
- **Galería**: explica qué hace un agente, muestra el estado de la base de conocimiento, «Tus agentes» y las plantillas (crear exige `agents:build`).
- **Estudio por nodos**, al estilo de n8n:
  - El agente va al centro.
  - **Entradas** a la izquierda: chat en PROTHEO, automatizaciones y MCP.
  - **Salidas** a la derecha: respuesta con fuentes, traza de herramientas y conocimiento.
  - **Herramientas** en la banda superior y **piezas** abajo: cerebro, datos (la app), memoria, conocimiento y límites.
  - Las líneas se animan y la herramienta que se usa se ilumina.
  - Los nodos se arrastran (la posición se guarda); hay zoom, desplazamiento y «Ordenar».
- **Paleta**: siete herramientas que se agregan con doble clic o arrastrándolas al lienzo, y el estilo de respuesta (breve, ejecutivo o detallado).
- **Probador**: conversaciones guardadas. Cada respuesta muestra la **traza** (herramienta, entrada, resultado y tiempo) y las **fuentes** de la base de conocimiento ([K1], [K2]…).
- **Configurar**:
  - Descripción, ícono, color y app.
  - Instrucciones propias.
  - Memoria (0–20 turnos) y pasos máximos (1–8).
  - Usar conocimiento y ocultar datos personales (correos, teléfonos y documentos salen como •••).
  - Preguntas sugeridas.
  - Publicar: un agente publicado lo usa cualquiera con `agents:use` que vea su app.

### Herramientas (solo lectura)
| id | Qué hace |
|---|---|
| `preguntar` | «Pregúntale a tus datos». Devuelve además el **total y la participación de cada grupo ya calculados**, para que el modelo no tenga que dividir por su cuenta. |
| `que_cambio` | Último periodo frente al anterior y los segmentos que lo explican. Reconoce las medidas maestras por su nombre. |
| `registros` | Filas con filtros o una condición (máximo 50). Oculta datos personales si el agente lo tiene activado. |
| `simular` | «¿Qué pasaría si…?» |
| `salud` | Puntaje y problemas de calidad de los datos. |
| `medidas` | Medidas y dimensiones maestras con su definición y si están certificadas. |
| `conocimiento` | Búsqueda en la base personal. |

**Reglas del agente**:
- Antes de dar una cifra, debe consultarla en ese mismo turno.
- Si una herramienta falla, se le indica que no invente y que diga que no pudo obtener el dato.
- Corre siempre con los permisos de **quien conversa**.

## Base de conocimiento (`pages/conocimiento.html`, permiso `knowledge:use`)
- **Apagada por defecto y personal.** La activa cada persona, desde la galería de Agentes o desde la propia página. Solo entonces aparece «Conocimiento» en el menú. Nadie más la ve, ni el administrador.
- **Qué la alimenta** (cada fuente se puede apagar):
  - Pregúntale a tus datos: pregunta, respuesta y cifras.
  - Asistente de IA.
  - Qué cambió y simulaciones.
  - Informes: historias de datos, con titulares y hallazgos.
  - Conversaciones con agentes.
  - Hojas que se guardan.
  - Medidas y dimensiones maestras.
  - Cuadernos.
  - Notas escritas a mano.
- **Cómo se conecta**: de cada documento se extraen entidades y se unen las que aparecen juntas. Las entidades son la app, medidas, dimensiones, campos, valores (nombres propios como «Andina» o «Yopal»), agentes y conceptos. El resultado es una red que crece con el uso.
- **Vista de grafo**: red neuronal animada en canvas, con simulación de fuerzas e impulsos que viajan por las conexiones.
  - Cada color es un tipo de entidad y el tamaño indica cuántos documentos la mencionan.
  - Pasar el cursor ilumina los vecinos.
  - Clic abre los documentos y las entidades cercanas.
  - La búsqueda ilumina lo relacionado.
  - Filtros por fuente, «Mostrar documentos», zoom, arrastre, recentrar y pausar.
- **Vista de lista**: búsqueda por relevancia (BM25 con normalización del español y refuerzo por entidad) y notas manuales.
- **Fuentes**: interruptor y volumen de cada fuente.
- **Ajustes**: apagar, retención (siempre, 30 días, 90 días, 6 meses o 1 año), exportar en JSON y vaciar.
- La captura no toca los controladores. Un filtro guarda el cuerpo de la petición y un `ResponseBodyAdvice` lee la respuesta. Corre en segundo plano, nunca cambia ni frena la respuesta y solo actúa si la persona tiene la base activa. Al leer, se vuelve a comprobar que siga viendo la app.

## API
| Método | Ruta | |
|---|---|---|
| GET | `/agents/catalog` | Plantillas, herramientas, estilos y motor |
| GET/POST | `/agents` | Lista / crea `{template, name?, app_id?, tools?…}` |
| GET/PUT/DELETE | `/agents/{id}` | Leer / cambiar / borrar (dueño o admin) |
| POST | `/agents/{id}/chat` | `{message, conversation_id?}` → `{answer, steps[], knowledge[], conversation_id, duration_ms}` |
| GET/DELETE | `/agents/{id}/conversations[/{cid}]` | Conversaciones propias |
| GET/PUT | `/knowledge/settings` | `{enabled, sources, retention_days}` + estadísticas |
| GET | `/knowledge/docs[/{id}]`, `/knowledge/search?q=`, `/knowledge/graph`, `/knowledge/entities/{key}`, `/knowledge/export` | Lectura |
| POST | `/knowledge/notes`, `/knowledge/capture` (informes desde el navegador) | Escritura |
| DELETE | `/knowledge/docs/{id}`, `/knowledge/docs` | Borrar uno / vaciar |

Tablas: `agents`, `agent_conversations`, `knowledge_settings`, `knowledge_docs`, `knowledge_entities` y `knowledge_edges`.

## MCP
- Agentes: `agent_catalog`, `list_agents`, `get_agent`, `save_agent`, `delete_agent` (ACCIÓN DESTRUCTIVA), `agent_chat`, `list_agent_conversations`.
- Conocimiento: `knowledge_settings`, `knowledge_search`, `knowledge_docs`, `knowledge_graph`, `knowledge_add_note`, `knowledge_delete` (ACCIÓN DESTRUCTIVA).

## Archivos
- Backend: `agent/AgentService.java`, `agent/AgentController.java`, `knowledge/KnowledgeService.java`, `knowledge/KnowledgeController.java`, `knowledge/KnowledgeCapture.java`.
- Frontend: `pages/agentes.html`, `pages/conocimiento.html`, `js/agentes.js`, `js/conocimiento.js`, `css/agentes.css`, el menú en `js/hub-nav.js` y la captura de historias en `js/informe-historia.js`.

## Limitaciones
- El cerebro es Nova Micro, un modelo pequeño. Por eso las participaciones se le entregan ya calculadas y se le prohíbe inventar cuando falla una herramienta. Aun así, las respuestas largas pueden redondear o resumir de más: la traza muestra siempre el dato original.
- La búsqueda es léxica (BM25), sin embeddings, y funciona sin servicios externos.
