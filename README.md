# 🏠 HA Status Bot

![Tests](https://github.com/joaquinhegi/ha-status-bot/actions/workflows/tests.yml/badge.svg)
![Version](https://img.shields.io/badge/version-1.0.0-orange)
![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)
![License](https://img.shields.io/badge/license-MIT-blue)

Bot de **Telegram** que se conecta a **Home Assistant** como add-on del Supervisor y permite consultar el estado del hogar directamente desde una conversación de Telegram: luces encendidas, sensores activos, puertas/ventanas abiertas, baterías bajas y temperaturas.

---

## 📖 Índice

- [Descripción general](#descripción-general)
- [Arquitectura del proyecto](#arquitectura-del-proyecto)
- [Requisitos previos](#requisitos-previos)
- [Instalación y configuración](#instalación-y-configuración)
- [Comandos disponibles](#comandos-disponibles)
- [Estructura de archivos](#estructura-de-archivos)
- [Explicación detallada del código](#explicación-detallada-del-código)
  - [config.yaml](#configyaml)
  - [Dockerfile](#dockerfile)
  - [package.json](#packagejson)
  - [src/index.js](#srcindexjs)
  - [src/haClient.js](#srchaclientjs)
  - [src/telegram.js](#srctelegramjs)
  - [src/formatter.js](#srcformatterjs)
- [Tests](#tests)
- [Docker](#docker)
- [Licencia](#licencia)

---

## Descripción general

**HA Status Bot** es un add-on para Home Assistant que levanta un bot de Telegram con long-polling. Al recibir un comando, consulta la API REST del Supervisor (`http://supervisor/core/api`) para obtener los estados de todas las entidades del hogar y responde con un resumen formateado.

**Flujo de datos simplificado:**

```
Usuario Telegram  →  Bot (polling)  →  Home Assistant API  →  Respuesta formateada  →  Usuario Telegram
```

---

## Arquitectura del proyecto

El proyecto sigue una arquitectura modular con separación de responsabilidades:

| Módulo | Responsabilidad |
|---|---|
| `index.js` | Punto de entrada. Carga configuración e inicializa los demás módulos. |
| `haClient.js` | Cliente HTTP para la API REST de Home Assistant. |
| `telegram.js` | Gestión del bot de Telegram: comandos, autorización y envío de mensajes. |
| `formatter.js` | Funciones puras que filtran y formatean los estados de las entidades en texto legible. |

---

## Requisitos previos

- **Home Assistant** con **Supervisor** (Home Assistant OS o Supervised).
- Un **bot de Telegram** creado a través de [@BotFather](https://t.me/BotFather).
- El **chat_id** del usuario o grupo autorizado (se puede obtener con el comando `/chatid` del propio bot).

---

## Instalación y configuración

1. Añade el repositorio de este add-on a Home Assistant:
   - **Ajustes → Add-ons → Tienda de add-ons → ⋮ → Repositorios**
   - Pega la URL: `https://github.com/joaquinhegi/ha-status-bot`

2. Instala el add-on **HA Status Bot**.

3. Configura las opciones:

   | Opción | Tipo | Descripción |
   |---|---|---|
   | `telegram_token` | `password` | Token del bot proporcionado por BotFather. |
   | `allowed_chat_ids` | `str` | IDs de chat autorizados separados por comas (ej: `12345,67890`). Dejar vacío permite cualquier chat. |
   | `low_battery_threshold` | `int` | Umbral de batería baja en porcentaje (por defecto `20`). |

4. Inicia el add-on. El bot empezará a escuchar mensajes.

---

## Comandos disponibles

| Comando | Descripción |
|---|---|
| `/start` | Muestra el mensaje de bienvenida y lista de comandos. |
| `/help` | Lista rápida de comandos. |
| `/estado` | Resumen completo: luces, puertas, sensores, baterías y temperaturas. |
| `/luces` | Lista de luces actualmente encendidas. |
| `/sensores` | Sensores binarios en estado activo. |
| `/puertas` | Puertas y ventanas abiertas (filtra por `device_class`). |
| `/bateria` | Sensores de batería por debajo del umbral configurado. |
| `/temp` | Todas las lecturas de temperatura disponibles. |
| `/chatid` | Devuelve el `chat_id` de la conversación actual. |

---

## Estructura de archivos

```
ha-status-bot/
├── config.yaml          # Manifiesto del add-on para Home Assistant Supervisor
├── Dockerfile           # Imagen Docker del add-on
├── package.json         # Dependencias y metadatos de Node.js
├── src/
│   ├── index.js         # Punto de entrada principal
│   ├── haClient.js      # Cliente de la API de Home Assistant
│   ├── telegram.js      # Lógica del bot de Telegram
│   └── formatter.js     # Filtrado y formateo de entidades
└── tests/
    ├── formatter.test.js # Tests del módulo formatter
    ├── haClient.test.js  # Tests del módulo haClient
    ├── telegram.test.js  # Tests del módulo telegram
    └── index.test.js     # Tests del punto de entrada
```

---

## Explicación detallada del código

### `config.yaml`

Este archivo es el **manifiesto del add-on** para el Supervisor de Home Assistant. Define los metadatos y la configuración que el usuario puede ajustar desde la UI de Home Assistant.

```yaml
homeassistant_api: true
```

Esta línea es **crítica**: indica al Supervisor que inyecte la variable de entorno `SUPERVISOR_TOKEN` dentro del contenedor. Sin ella, el bot no podría autenticarse contra la API de Home Assistant.

**Sección `options`:** Valores por defecto que se guardan en `/data/options.json` dentro del contenedor.

**Sección `schema`:** Define los tipos de cada opción para que la UI de Home Assistant genere los campos de formulario adecuados (campo de contraseña para el token, campo de texto para IDs, campo numérico para el umbral).

---

### `Dockerfile`

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
CMD ["node", "src/index.js"]
```

- **`node:20-alpine`**: Imagen base ligera (~50 MB) con Node.js 20.
- **`npm ci --omit=dev`**: Instala dependencias de producción de forma determinista usando `package-lock.json`, sin incluir dependencias de desarrollo.
- **Orden de capas optimizado**: primero se copian los archivos de dependencias y luego el código fuente. Esto aprovecha la caché de Docker: si el código cambia pero las dependencias no, Docker reutiliza la capa de `npm ci`.

---

### `package.json`

```json
{
  "type": "module"
}
```

**`"type": "module"`** habilita la sintaxis de **ES Modules** (`import`/`export`) en lugar de CommonJS (`require`). Todo el proyecto usa `import`/`export`.

**Única dependencia:** `node-telegram-bot-api` — librería que gestiona la conexión con la API de Telegram mediante long-polling.

> No se usa `axios` ni `node-fetch` para conectar con Home Assistant: se utiliza el `fetch` nativo de Node.js 20+.

---

### `src/index.js`

Es el **punto de entrada** de la aplicación. Su responsabilidad es:

1. **Cargar opciones del add-on** (`loadOptions`):
   - Lee `/data/options.json`, que es el archivo donde el Supervisor de Home Assistant deposita la configuración del usuario.

2. **Parsear los chat IDs permitidos** (`parseAllowedChatIds`):
   - Recibe una cadena como `"123,456,789"`, la divide por comas, elimina espacios y devuelve un array de strings.
   - Si está vacío, devuelve `[]`, lo que se interpreta como "permitir todos los chats".

3. **Validar configuración obligatoria**:
   - Verifica que exista `telegram_token` (proporcionado por el usuario).
   - Verifica que exista `SUPERVISOR_TOKEN` (inyectado automáticamente por el Supervisor).

4. **Crear el cliente de Home Assistant** pasándole la URL base del Supervisor (`http://supervisor/core/api`) y el token.

5. **Crear el bot de Telegram** pasándole el token, la lista de chats autorizados, el umbral de batería y el cliente de HA.

6. **Manejo de errores**: Si `main()` falla, se imprime el error y el proceso termina con código 1.

---

### `src/haClient.js`

Módulo que encapsula las llamadas HTTP a la API REST de Home Assistant usando un **patrón factory** (función que devuelve un objeto con métodos).

#### `createHomeAssistantClient({ baseUrl, token })`

Retorna un objeto con dos métodos:

- **`getStates()`**: Llama a `GET /states` y devuelve un array con **todas** las entidades registradas en Home Assistant. Cada entidad tiene la forma:
  ```json
  {
    "entity_id": "light.salon",
    "state": "on",
    "attributes": {
      "friendly_name": "Luz del salón",
      "brightness": 200
    }
  }
  ```

- **`callService(domain, service, serviceData)`**: Llama a `POST /services/{domain}/{service}`. Actualmente no se usa desde el bot, pero está preparado para futuras extensiones (por ejemplo: `/apagar_luces`).

#### `request(path, options)` (función interna)

Función genérica que:
1. Construye la URL completa: `baseUrl + path`.
2. Inyecta automáticamente las cabeceras `Authorization: Bearer <token>` y `Content-Type: application/json`.
3. Si la respuesta no es OK (status >= 400), lanza un error con el código de estado y el cuerpo de la respuesta.
4. Devuelve el JSON parseado.

---

### `src/telegram.js`

Módulo que crea y configura el bot de Telegram.

#### `createTelegramBot({ token, allowedChatIds, lowBatteryThreshold, ha })`

1. Crea una instancia de `TelegramBot` con **polling** habilitado (el bot consulta periódicamente a Telegram por nuevos mensajes).

2. Registra los handlers de comandos usando `bot.onText(regex, callback)`.

3. Retorna la instancia del bot.

#### `isAllowed(chatId, allowedChatIds)`

Función de autorización:
- Si `allowedChatIds` está vacío → todo el mundo puede usar el bot.
- Si tiene valores → el `chatId` del mensaje debe estar en la lista.

#### `safeReply(bot, chatId, text)`

Telegram impone un **límite de ~4096 caracteres** por mensaje. Esta función:
- Si el texto cabe en un solo mensaje, lo envía directamente.
- Si excede 3900 caracteres, lo divide en trozos y los envía secuencialmente.

#### `handleCommand(msg, formatter)`

Función genérica que:
1. Verifica autorización.
2. Obtiene los estados de HA (`ha.getStates()`).
3. Aplica la función formateadora recibida.
4. Envía la respuesta.
5. Si hay error, envía un mensaje de error al usuario.

---

### `src/formatter.js`

Módulo de **funciones puras** (sin efectos secundarios) que filtran y formatean los estados de Home Assistant. Cada función recibe el array completo de estados y devuelve datos procesados.

#### Funciones auxiliares internas

| Función | Descripción |
|---|---|
| `friendlyName(entity)` | Devuelve `attributes.friendly_name` o el `entity_id` como fallback. |
| `isUnavailable(entity)` | Retorna `true` si el estado es `"unavailable"` o `"unknown"`. |
| `byFriendlyName(a, b)` | Comparador para ordenar alfabéticamente por nombre amigable con soporte para español. |
| `bulletList(items, emptyText)` | Formatea un array como lista con viñetas `•`. Si está vacío, muestra el texto alternativo. |

#### Funciones de extracción de datos

| Función | Entidades que filtra | Criterio |
|---|---|---|
| `getLightsOn(states)` | `light.*` | `state === "on"` |
| `getActiveBinarySensors(states)` | `binary_sensor.*` | `state === "on"` |
| `getOpenDoorsAndWindows(states)` | `binary_sensor.*` | `state === "on"` + `device_class` ∈ `{door, garage_door, window, opening}` |
| `getLowBatteries(states, threshold)` | `sensor.*` | `device_class === "battery"` + valor ≤ umbral |
| `getTemperatures(states)` | `sensor.*` | `device_class === "temperature"` + no unavailable |

#### Funciones de formateo

Cada función `format*` usa las funciones de extracción y `bulletList` para generar un string legible con emoji y viñetas:

- `formatLights(states)` → `"💡 Luces encendidas\n\n• Salón\n• Cocina"`
- `formatSensors(states)` → `"📡 Sensores activos\n\n• Movimiento cocina (motion)"`
- `formatDoors(states)` → `"🚪 Puertas / ventanas abiertas\n\n• Todo cerrado"`
- `formatBatteries(states, threshold)` → `"🔋 Baterías bajas <= 20%\n\n• Sensor puerta: 12%"`
- `formatTemperatures(states)` → `"🌡️ Temperaturas\n\n• Salón: 22.5°C"`
- `formatFullStatus(states, threshold)` → Combina todas las anteriores en un solo mensaje.

---

## Tests

El proyecto usa [Node.js test runner](https://nodejs.org/api/test.html) (nativo, sin dependencias adicionales).

```bash
npm test
```

Los tests cubren:
- **formatter.js**: Todas las funciones de filtrado y formateo con datos simulados.
- **haClient.js**: Llamadas HTTP con mock de `fetch`.
- **telegram.js**: Autorización, partición de mensajes largos y manejo de comandos.
- **index.js**: Carga de opciones y parseo de chat IDs.

---

## Docker

Para construir la imagen manualmente:

```bash
docker build -t ha-status-bot .
```

Para ejecutarla fuera de Home Assistant (desarrollo):

```bash
docker run \
  -e SUPERVISOR_TOKEN=tu_token \
  -v /path/to/options.json:/data/options.json \
  ha-status-bot
```

---

## Licencia

MIT
