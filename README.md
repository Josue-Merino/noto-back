# Noto Backend API

API REST principal para **Noto**, la plataforma de generación de apuntes y material de estudio con IA a partir de audio.

Desarrollada en **Node.js** con **Express**, siguiendo **Clean Architecture**, **Inyección de Dependencias manual** y el patrón **Repository**, integrada con **Supabase** (PostgreSQL, Auth y Storage).

---

## 🚀 Requisitos previos

- **Node.js**: versión 20.x o superior.
- **pnpm**: gestor de paquetes (v9 o v12 con Corepack).
- **Cuenta en Supabase**: para la base de datos PostgreSQL y servicio de Autenticación.

---

## 📦 Instalación

```bash
# 1. Clonar o posicionarse en la carpeta del backend
cd backend

# 2. Instalar dependencias con pnpm
corepack pnpm install
```

---

## ⚙️ Variables de entorno

Copia el archivo `.env.example` como `.env` y define los valores de tu proyecto:

```bash
cp .env.example .env
```

| Variable | Descripción | Valor por defecto |
|---|---|---|
| `NODE_ENV` | Entorno de ejecución (`development`, `production`, `test`) | `development` |
| `PORT` | Puerto de escucha del servidor Express | `3000` |
| `FRONTEND_URL` | URL base de la aplicación React de frontend | `http://localhost:5173` |
| `CORS_ORIGINS` | Orígenes permitidos separados por comas | `http://localhost:5173` |
| `SUPABASE_URL` | URL del proyecto en Supabase (`https://<project-ref>.supabase.co`) | *Requerido* |
| `SUPABASE_ANON_KEY` | Llave pública anónima de Supabase | *Requerido* |
| `SUPABASE_SERVICE_ROLE_KEY` | Llave secreta con rol administrativo (solo para el backend) | *Requerido* |
| `EMAIL_REDIRECT_URL` | URL a la que se redirige tras verificar correo | `http://localhost:5173/login` |
| `PASSWORD_RESET_REDIRECT_URL` | URL para el enlace de recuperación de contraseña | `http://localhost:5173/reset-password` |
| `LOG_LEVEL` | Nivel de logs de Pino (`debug`, `info`, `warn`, `error`) | `debug` |
| `NOTO_AI_URL` | URL base del servicio de IA (`noto-ai-server`) | `http://localhost:8000` |
| `NOTO_AI_TIMEOUT_MS` | Tiempo máximo de espera de una generación (transcripción + IA) | `3600000` (60 min) |
| `GENERATION_MAX_FILE_SIZE_MB` | Tamaño máximo del archivo de audio/video aceptado | `1536` (1.5 GB) |
| `GENERATION_MAX_DURATION_SEC` | Duración máxima del audio (se mide con ffmpeg) | `7200` (2 h) |
| `GENERATION_TMP_DIR` | Carpeta donde se guardan los audios recibidos mientras dura el trabajo | `<tmp del sistema>/noto-uploads` |
| `GENERATION_NORMALIZE_ABOVE_MB` | Por encima de este tamaño (o si es video) el audio se convierte a Opus mono 16 kHz antes de enviarlo a la IA | `25` |
| `GENERATION_RETENTION_HOURS` | Horas que se conserva el audio para reintentar, generar más material o reproducirlo | `24` |
| `HTTP_REQUEST_TIMEOUT_MS` | Tiempo máximo de una petición HTTP (subidas grandes; Node corta a los 300 s por defecto) | `3600000` (1 h) |

> 🔗 **Supabase compartido con la IA:** el backend reenvía el JWT del usuario a `noto-ai-server`, que lo valida con el JWKS de **su** `SUPABASE_URL`. Los dos servicios deben usar el **mismo proyecto de Supabase**; si no, la generación responde `502 AI_AUTH_REJECTED`.

> ⚠️ **Importante:** La variable `SUPABASE_SERVICE_ROLE_KEY` otorga acceso total de administrador sin restricciones RLS. **Nunca** debe exponerse en el frontend ni subirse a repositorios públicos.

---

## 🗄️ Configuración en Supabase

### 1. Proyecto
El proyecto de Noto es **`eluxfpkoastufmznbuzf`**, que ya tiene todo el esquema.
1. Anota la **Project URL**, la **Anon Key** y la **service_role Key** desde `Project Settings` > `API`
   y ponlas en `.env`.
2. **noto-ai-server debe apuntar al mismo proyecto**: valida el JWT que le reenvía el back contra
   `SUPABASE_JWS_URL` (`https://<ref>.supabase.co/auth/v1/.well-known/jwks.json`).

### 2. Migraciones SQL (desde el **SQL Editor**, en orden)
En `eluxfp` las tablas ya existen; la 002 ya se corrió ahí y solo agregó índices, triggers de
`updated_at`, RLS y permisos. Para crear un proyecto nuevo desde cero, corre las dos:
1. [`001_create_user_table.sql`](./supabase/migrations/001_create_user_table.sql): tabla
   `public."user"` vinculada a `auth.users(id)`, la función `handle_updated_at` y RLS.
2. [`002_create_study_material_tables.sql`](./supabase/migrations/002_create_study_material_tables.sql):
   tablas del material de estudio, índices, RLS y permisos.
   Es idempotente y al final recarga el esquema de la API (`notify pgrst`).

Tablas que usa el backend (`public`):

| Tabla | Para qué |
|---|---|
| `user` | Perfil: `name`, `last_name`, `nickname` (obligatorio; si no hay, se usa el nombre), `credits`, `image_url`. El correo y la fecha de alta salen de Supabase Auth; el segundo nombre y el segundo apellido, de `user_metadata`. |
| `note` + `block` | El apunte. `note_id` = id del trabajo de generación. Los bloques son una lista enlazada (`previous_block_id` / `next_block_id`) con el mismo formato que escribe la IA: Resumen → Contenido → Items de Acción / Material de Apoyo / Tarea. |
| `mazo` + `flashcard` | Las flashcards (`orden`, `frente`, `reverso`). |
| `flashcard_review` | Repaso espaciado SM-2: una fila de estado por tarjeta (`ease_factor`, `interval_days`, `repetitions`, `next_review_at`). |
| `cuestionario` + `pregunta` + `opcion` | El cuestionario (`es_correcta` marca la opción correcta). |
| `intento` + `respuesta` | Intentos del cuestionario, calificados en el servidor. |

`folder` también se crea (`note.folder_id`), pero todavía no se usa. El backend escribe con la
**service_role key** y filtra siempre por el usuario autenticado; las políticas RLS son defensa en
profundidad.

### 3. Configurar Auth y confirmación de correo
1. Ve a **Authentication** > **Providers** > **Email**.
2. Asegúrate de tener activada la opción **"Confirm email"** (para requerir verificación previa al inicio de sesión).
3. Ve a **Authentication** > **URL Configuration**:
   - **Site URL**: `http://localhost:5173`
   - **Redirect URLs**: Agrega:
     - `http://localhost:5173/login`
     - `http://localhost:5173/reset-password`

---

## 📜 Scripts disponibles

```bash
# Iniciar en modo desarrollo con recarga automática (Node --watch)
corepack pnpm dev

# Iniciar en producción
corepack pnpm start

# Ejecutar suite de pruebas con Vitest
corepack pnpm test

# Ejecutar linter con ESLint (Flat Config)
corepack pnpm lint
```

---

## 🏗️ Estructura del proyecto

```
backend/
├─ src/
│  ├─ app.js                      # Configuración de Express, middlewares y rutas
│  ├─ server.js                   # Arranque del servidor y apagado ordenado (graceful shutdown)
│  ├─ container.js                # Composición manual de dependencias (IoC Container)
│  ├─ config/
│  │  ├─ env.js                   # Validación estricta de variables de entorno con Zod
│  │  ├─ supabase.js              # Fábricas de clientes Supabase (Admin y Anon)
│  │  ├─ cors.js                  # Configuración segura de CORS
│  │  └─ logger.js                # Logger estructurado de alto rendimiento (Pino)
│  ├─ routes/
│  │  └─ index.js                 # Montaje de /api/v1 y endpoints generales
│  ├─ middlewares/
│  │  ├─ authenticate.js          # Validador de JWT de Supabase
│  │  ├─ validate.js              # Validador de esquemas Zod (body, query, params)
│  │  ├─ rateLimiters.js          # Limitadores de peticiones por IP
│  │  ├─ requestId.js             # Trazabilidad con X-Request-Id
│  │  ├─ upload.js                # Subida multipart de audio/video con multer (a disco)
│  │  ├─ notFound.js              # Manejador 404 uniforme
│  │  └─ errorHandler.js          # Manejador de errores centralizado
│  ├─ errors/
│  │  ├─ AppError.js              # Clase base de error operacional
│  │  └─ httpErrors.js            # Errores semánticos HTTP (BadRequest, Unauthorized, etc.)
│  ├─ utils/
│  │  ├─ asyncHandler.js          # Envoltura asíncrona para Express
│  │  └─ apiResponse.js           # Helpers uniformes success() y fail()
│  ├─ models/
│  │  ├─ user.model.js            # Mapeos fila de BD <-> dominio <-> DTO público
│  │  └─ studyMaterial.model.js   # Mapeo respuesta de la IA (snake_case) <-> DTO público (camelCase)
│  └─ modules/
│     ├─ auth/                    # Módulo de Autenticación
│     │  ├─ auth.routes.js
│     │  ├─ auth.controller.js
│     │  ├─ auth.service.js
│     │  ├─ auth.schemas.js
│     │  └─ auth.errors.js
│     ├─ generation/              # Módulo de Generación de material de estudio
│     │  ├─ generation.routes.js
│     │  ├─ generation.controller.js
│     │  ├─ generation.service.js # Trabajos asíncronos: crear, procesar, cancelar, reintentar, generar más
│     │  ├─ generation.schemas.js
│     │  ├─ generation.config.js  # Valores por defecto (URL, timeouts, límites, retención)
│     │  ├─ generationJob.repository.js # Puerto + implementación en memoria de los trabajos
│     │  ├─ audio.storage.js      # Audios en disco temporal (crear ruta, existe, borrar)
│     │  ├─ audio.preparer.js     # ffmpeg-static: duración (≤ 2 h) y conversión a Opus
│     │  └─ noto-ai.client.js     # Única clase que habla con noto-ai-server (+ mapeo de errores)
│     ├─ study/                   # Material guardado en Supabase y repaso
│     │  ├─ study.mappers.js      # Dominio ↔ filas (note/block, mazo/flashcard, cuestionario…) + SM-2
│     │  ├─ study.store.supabase.js # Puerto: guardar, leer, listar, calificar flashcards, intentos
│     │  ├─ study.store.memory.js # Misma interfaz en memoria (pruebas y demo)
│     │  └─ study.{service,controller,routes,schemas}.js # POST /study/…
│     └─ users/                   # Módulo de Usuarios
│        └─ user.repository.js    # Acceso a la tabla public."user"
├─ supabase/
│  └─ migrations/
│     └─ 001_create_user_table.sql
├─ tests/
│  ├─ auth.register.test.js
│  ├─ auth.login.test.js
│  ├─ generation.jobs.test.js     # Trabajos de generación con IA y preparador falsos
│  ├─ audio.preparer.test.js      # ffmpeg real con archivos sintéticos de pocos segundos
│  ├─ notoAi.client.test.js       # Cliente de la IA con fetch simulado (multipart desde disco y errores)
│  └─ helpers/
│     └─ fakeSupabase.js          # Doble de prueba aislado de Supabase
├─ .env.example
├─ eslint.config.js
└─ package.json
```

---

## 📡 Endpoints de la API (`/api/v1`)

Formato de respuesta uniforme:
- **Éxito:** `{ "success": true, "data": {...}, "message": "..." }`
- **Error:** `{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "...", "details": [...] } }`

| Método | Endpoint | Auth | Descripción |
|---|---|---|---|
| `GET` | `/api/v1/health` | No | Estado del servicio y tiempo de actividad |
| `POST` | `/api/v1/auth/register` | No | Registro de cuenta y perfil de usuario |
| `POST` | `/api/v1/auth/resend-verification` | No | Reenvío de correo de activación |
| `POST` | `/api/v1/auth/login` | No | Inicio de sesión (requiere correo verificado) |
| `POST` | `/api/v1/auth/refresh` | No | Renovación de token de sesión |
| `POST` | `/api/v1/auth/logout` | Sí | Cierre de sesión e invalidación de token |
| `POST` | `/api/v1/auth/forgot-password` | No | Solicitud de restablecimiento de contraseña |
| `POST` | `/api/v1/auth/reset-password` | Sí | Restablecer contraseña con token de recuperación |
| `POST` | `/api/v1/auth/change-password` | Sí | Cambio de contraseña verificando la actual |
| `GET` | `/api/v1/auth/me` | Sí | Consulta de perfil del usuario autenticado |
| `POST` | `/api/v1/generation/create` | Sí | Sube un audio y crea un trabajo de generación (`202`) |
| `GET` | `/api/v1/generation` | Sí | Trabajos del usuario (más recientes primero) |
| `GET` | `/api/v1/generation/:id` | Sí | Estado y contenido de un trabajo |
| `GET` | `/api/v1/generation/:id/audio` | Sí | Audio original guardado (para reproducirlo) |
| `POST` | `/api/v1/generation/:id/cancel` | Sí | Cancela un trabajo en curso |
| `POST` | `/api/v1/generation/:id/retry` | Sí | Reintenta un trabajo fallido o cancelado con el audio guardado (`202`) |
| `POST` | `/api/v1/generation/:id/materials` | Sí | Genera los materiales que faltan con el audio guardado (`202`) |

### Generación de material de estudio (trabajos asíncronos)

La IA tarda minutos y no informa avance, así que cada generación es un **trabajo**:
`queued → preparing (ffmpeg) → processing (IA) → completed | failed | cancelled`. El frontend lo
crea, recibe `202` al instante y consulta `GET /generation/:id` cada pocos segundos. Las consultas
tienen su propio límite (900 cada 15 min) y no cuentan para el límite general.

`POST /api/v1/generation/create` recibe `multipart/form-data`:

| Campo | Obligatorio | Descripción |
|---|---|---|
| `file` | Sí | Audio o video (`audio/*`, `video/*` o extensión conocida). Máx. `GENERATION_MAX_FILE_SIZE_MB` (1.5 GB). Se guarda en disco, no en memoria. |
| `outputType` | Sí | `flashcards` → solo flashcards · `quiz` → solo cuestionario · `full` → notas + flashcards + cuestionario |
| `originType` | No | `file` o `recording` |
| `originalName`, `originalSize`, `durationSec` | No | Metadatos del archivo original (antes de comprimirlo en el navegador). `durationSec` se usa si la cabecera del archivo no trae la duración. |

En segundo plano:
1. `FfmpegAudioPreparer` lee la duración y rechaza los audios de más de 2 horas (`AUDIO_TOO_LONG`).
2. Si es video o pesa más de `GENERATION_NORMALIZE_ABOVE_MB`, lo convierte a Opus mono 16 kHz
   32 kbps. Así la IA nunca recibe un archivo de 1.5 GB: dos horas de clase quedan en unos 30-40 MB.
3. Llama a `POST {NOTO_AI_URL}/study-material/` leyendo el audio del disco y reenviando el JWT del
   usuario en el header `access-token`. Con `full`, los tres materiales salen de **una sola**
   transcripción.

El audio se conserva `GENERATION_RETENTION_HOURS` para reintentar, generar más material y
reproducirlo, y un barrido cada 30 min borra los vencidos.

**Persistencia.** El estado de un trabajo en curso (en cola, procesando, falló) vive en memoria
(`InMemoryGenerationJobRepository`): el esquema no tiene dónde guardarlo. Al completarse, el material
se guarda en Supabase (`SupabaseStudyMaterialStore`) como una `note` con `note_id` = id del trabajo,
y desde ese momento el contenido se lee de ahí:

- `GET /generation` junta las notas guardadas (con `counts` y `content: null`) y los trabajos en
  memoria que todavía no tienen nota.
- `GET /generation/:id` devuelve el contenido completo con ids de tarjetas, preguntas y opciones,
  el estado de repaso de cada tarjeta y los últimos intentos del cuestionario.
- **Tras reiniciar el back** las notas siguen disponibles por el mismo id. Se pierden el audio y la
  metadata del archivo (nombre, duración), porque no hay columnas para guardarlos.
- Si la IA responde pero falla el guardado, el trabajo queda `failed` con `PERSISTENCE_FAILED` y el
  contenido en memoria: **Reintentar** solo vuelve a guardar, sin llamar otra vez a la IA.

Respuesta (la misma forma en todas las rutas del módulo):

```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "status": "completed",
    "title": "Fotosíntesis",
    "outputType": "full",
    "materials": ["notes", "flashcards", "quiz"],
    "pendingMaterials": [],
    "createdAt": "2026-11-24T20:00:00.000Z",
    "updatedAt": "2026-11-24T20:03:10.000Z",
    "startedAt": "2026-11-24T20:00:01.000Z",
    "finishedAt": "2026-11-24T20:03:10.000Z",
    "source": { "originType": "file", "originalName": "clase.mp4", "mimeType": "audio/webm", "sizeBytes": 1048576, "originalSizeBytes": 104857600, "durationSec": 3125 },
    "audio": { "available": true, "mimeType": "audio/webm", "sizeBytes": 1048576, "expiresAt": "2026-11-25T20:00:00.000Z" },
    "content": {
      "notes": { "title": "...", "language": "es", "summary": "...", "blocks": [{ "type": "heading1", "text": "...", "emoji": "🌱" }], "actionItems": [], "supportMaterial": [], "homework": [] },
      "flashcards": { "title": "...", "language": "es", "cards": [{ "front": "...", "back": "..." }] },
      "quiz": { "title": "...", "language": "es", "questions": [{ "question": "...", "options": ["..."], "correctOptionIndex": 0, "explanation": "..." }] }
    },
    "error": null
  }
}
```

Los materiales que no se generaron vienen en `null`. Si el trabajo falla, `error` es
`{ code, message, statusCode }` y el audio sigue disponible para reintentar.

Errores al **subir** (respuesta HTTP):

| Status | Código | Causa |
|---|---|---|
| `400` | `FILE_REQUIRED` · `INVALID_FILE_TYPE` · `VALIDATION_ERROR` | Falta el archivo, no es audio/video o `outputType` inválido |
| `404` | `GENERATION_NOT_FOUND` | El trabajo no existe o es de otro usuario |
| `409` | `JOB_NOT_ACTIVE` · `JOB_NOT_RETRYABLE` · `JOB_ACTIVE` | Cancelar uno que ya terminó, reintentar uno que no falló o generar más con uno en curso |
| `400` | `NOTHING_TO_GENERATE` | Los materiales pedidos ya existen |
| `410` | `AUDIO_EXPIRED` | El audio ya se borró (pasó el tiempo de retención) |
| `413` | `FILE_TOO_LARGE` | El archivo supera el límite |
| `429` | `RATE_LIMITED` | Más de 30 generaciones o reintentos por hora desde la misma IP |

Errores del **procesamiento** (quedan en `job.error`):

| Status | Código | Causa |
|---|---|---|
| `422` | `AUDIO_TOO_LONG` · `PREPARATION_FAILED` | Audio de más de 2 horas o archivo que ffmpeg no puede leer |
| `422` | `TRANSCRIPTION_FAILED` | La IA no pudo transcribir el audio (vacío, sin voz o formato inválido) |
| `502` | `AI_AUTH_REJECTED` | La IA rechazó el JWT (proyectos de Supabase distintos). No es `401` a propósito, para que el frontend no cierre la sesión |
| `502` | `AI_GENERATION_FAILED` · `AI_SERVICE_ERROR` · `AI_BAD_REQUEST` · `AI_INVALID_RESPONSE` | Falla del servicio de IA |
| `503` | `AI_SERVICE_UNAVAILABLE` | `noto-ai-server` no está levantado o no es accesible |
| `504` | `AI_TIMEOUT` | La generación superó `NOTO_AI_TIMEOUT_MS` |

### Repaso (`/api/v1/study`)

| Método | Ruta | Cuerpo | Respuesta |
|---|---|---|---|
| `POST` | `/study/flashcards/:flashcardId/review` | `{ "rating": "again" \| "hard" \| "good" \| "easy" }` | `200` · `{ flashcardId, review: { easeFactor, intervalDays, repetitions, nextReviewAt, lastReviewedAt } }` |
| `POST` | `/study/quizzes/:quizId/attempts` | `{ "startedAt"?: ISO, "answers": [{ "questionId", "optionId" }] }` | `201` · `{ id, score, total, correctCount, startedAt, finishedAt }` |

- La calificación usa SM-2: "Otra vez" deja la tarjeta pendiente de inmediato; "Bien" da 1 día,
  luego 6 y después `intervalo × ease factor`.
- El intento se califica en el servidor con `opcion.es_correcta` (no se confía en el cliente).
- `404 FLASHCARD_NOT_FOUND` / `QUIZ_NOT_FOUND` si no existe o es de otro usuario. Límite propio:
  600 peticiones cada 15 min por IP.

### Ejemplos `curl`

#### 1. Registro de usuario
```bash
curl -X POST http://localhost:3000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "firstName": "Alejandro",
    "middleName": "Mateo",
    "lastName": "Pérez",
    "secondLastName": "Gómez",
    "email": "alejandro@noto.com",
    "password": "Password123",
    "confirmPassword": "Password123"
  }'
```

#### 2. Inicio de sesión
```bash
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "alejandro@noto.com",
    "password": "Password123"
  }'
```

#### 3. Consultar usuario autenticado
```bash
curl -X GET http://localhost:3000/api/v1/auth/me \
  -H "Authorization: Bearer <ACCESS_TOKEN>"
```

#### 4. Generar material de estudio (requiere `noto-ai-server` levantado)
```bash
curl -X POST http://localhost:3000/api/v1/generation/create \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -F "file=@clase.webm" \
  -F "outputType=full"
# → 202 con data.id

# Consultar hasta que status sea completed o failed
curl http://localhost:3000/api/v1/generation/<ID> \
  -H "Authorization: Bearer <ACCESS_TOKEN>"
```

---

## 🧩 Cómo agregar un nuevo módulo siguiendo la arquitectura

Para mantener el desacoplamiento y la consistencia del proyecto:

1. **Crear la carpeta del módulo** en `src/modules/<nombre-modulo>/` (ej. `notes/`).
2. **Definir el Repositorio** (`<nombre>.repository.js`): única clase que realiza consultas a Supabase para ese modelo.
3. **Definir los Esquemas Zod** (`<nombre>.schemas.js`): validaciones de entrada para body/query/params.
4. **Implementar el Servicio** (`<nombre>.service.js`): reglas de negocio, llamando al repositorio o a microservicios externos (ej. microservicio FastAPI de IA).
5. **Implementar el Controlador** (`<nombre>.controller.js`): recepción de peticiones HTTP con `asyncHandler` y respuestas mediante `apiResponse`.
6. **Definir las Rutas** (`<nombre>.routes.js`): configuración de endpoints usando `validate(schema)` y `authenticate` cuando aplique.
7. **Registrar en el Contenedor** (`src/container.js`): instanciar el repositorio, servicio y controlador, inyectándoles sus dependencias.
8. **Montar en el Router** (`src/routes/index.js`): asociar las rutas bajo `/api/v1/<nombre-modulo>`.
