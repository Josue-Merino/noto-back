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

> ⚠️ **Importante:** La variable `SUPABASE_SERVICE_ROLE_KEY` otorga acceso total de administrador sin restricciones RLS. **Nunca** debe exponerse en el frontend ni subirse a repositorios públicos.

---

## 🗄️ Configuración en Supabase

### 1. Crear el proyecto
1. Ve a [Supabase Dashboard](https://app.supabase.com) y crea un nuevo proyecto.
2. Anota la **Project URL**, la **Anon Key** y la **service_role Key** desde `Project Settings` > `API`.

### 2. Ejecutar la migración SQL
1. En el panel de Supabase, entra al **SQL Editor**.
2. Copia y ejecuta el contenido del archivo [`supabase/migrations/001_create_user_table.sql`](./supabase/migrations/001_create_user_table.sql).
3. Este script creará:
   - La tabla `public."user"` vinculada a `auth.users(id)`.
   - Triggers automáticos para `updated_at`.
   - Políticas de seguridad a nivel de fila (**Row Level Security - RLS**).

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
│  │  ├─ notFound.js              # Manejador 404 uniforme
│  │  └─ errorHandler.js          # Manejador de errores centralizado
│  ├─ errors/
│  │  ├─ AppError.js              # Clase base de error operacional
│  │  └─ httpErrors.js            # Errores semánticos HTTP (BadRequest, Unauthorized, etc.)
│  ├─ utils/
│  │  ├─ asyncHandler.js          # Envoltura asíncrona para Express
│  │  └─ apiResponse.js           # Helpers uniformes success() y fail()
│  ├─ models/
│  │  └─ user.model.js            # Mapeos fila de BD <-> dominio <-> DTO público
│  └─ modules/
│     ├─ auth/                    # Módulo de Autenticación
│     │  ├─ auth.routes.js
│     │  ├─ auth.controller.js
│     │  ├─ auth.service.js
│     │  ├─ auth.schemas.js
│     │  └─ auth.errors.js
│     └─ users/                   # Módulo de Usuarios
│        └─ user.repository.js    # Acceso a la tabla public."user"
├─ supabase/
│  └─ migrations/
│     └─ 001_create_user_table.sql
├─ tests/
│  ├─ auth.register.test.js
│  ├─ auth.login.test.js
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
