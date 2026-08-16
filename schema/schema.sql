-- DDL de D1 (SQLite). Fuente: README.md §4.1

-- Administradores del panel (README §4.5): quien esté aquí puede entrar a
-- /admin autenticándose con esa cuenta de Gmail vía OAuth. Sembrada con los
-- admins iniciales en el despliegue (README §4.6); gestionable desde el
-- propio panel a partir de ahí.
CREATE TABLE admins (
  email       TEXT PRIMARY KEY,
  anadido_por TEXT,               -- email de quien lo dio de alta; NULL para la siembra inicial
  anadido_en  TEXT NOT NULL       -- ISO 8601 UTC
);

-- Tokens de acceso al test (README §4.5, issue #2): cada uno identifica una
-- *remesa* de invitación (no a la persona que responde), con descripción
-- libre puesta por quien lo crea para poder rastrear después de dónde
-- vinieron las respuestas. Sin límite de usos: válido para cualquier número
-- de personas mientras no caduque.
CREATE TABLE tokens (
  id          TEXT PRIMARY KEY,    -- código compartido en la URL (?token=) — siempre un UUID
  descripcion TEXT NOT NULL,       -- p. ej. "familia de Gerardo"
  creado_por  TEXT NOT NULL,       -- email del admin que lo creó
  creado_en   TEXT NOT NULL,       -- ISO 8601 UTC
  expira_en   TEXT NOT NULL,       -- ISO 8601 UTC; pasada esta fecha, POST /api/sesion lo rechaza.
                                    -- "Sin caducidad" usa un centinela muy lejano (EXPIRA_EN_INFINITO,
                                    -- worker/src/tipos.ts) en vez de NULL: D1/SQLite no permite relajar
                                    -- un NOT NULL con ALTER TABLE (solo add/drop/rename columna).
  -- Remesa de pruebas (0/1, por defecto 0): sigue siendo un token normal, con un
  -- id igual de impredecible que cualquier otro (nunca un id fijo/adivinable
  -- como "tests" — eso sería una puerta de acceso pública), pero sus sesiones
  -- se excluyen de los agregados sin filtro de worker/src/db.ts::obtenerEstadisticas/
  -- obtenerDatasetCompleto (siguen visibles filtrando el panel explícitamente
  -- por ese token). Pensado para probar el pipeline de digitalización contra la
  -- API real de OpenAI sin ensuciar las estadísticas del piloto.
  es_prueba   INTEGER NOT NULL DEFAULT 0,
  -- "Rehabilitar" (README §4.5, lo contrario de "Revocar"): NULL salvo justo
  -- después de revocar, momento en el que guarda el expira_en que tenía ANTES
  -- de la revocación (revocarToken lo sobrescribe con "ahora") — así
  -- rehabilitarToken puede devolverle exactamente esa misma caducidad
  -- original en vez de inventar una nueva. Se vuelve a poner a NULL al
  -- rehabilitar, así el botón "Rehabilitar" solo aparece tras una revocación
  -- explícita, nunca en un token que simplemente caducó solo por el paso del
  -- tiempo (ahí no hay "caducidad original" distinta que restaurar).
  expira_en_antes_de_revocar TEXT
);

-- Solicitudes de acceso de quien llega sin token válido (README §4.5): solo
-- se guarda un dato de contacto que la propia persona decide dar
-- voluntariamente para pedir acceso; no forma parte del dataset anónimo del
-- estudio (§5) y se gestiona aparte, visible desde el panel de admin.
CREATE TABLE solicitudes_acceso (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  contacto  TEXT NOT NULL,
  motivo    TEXT,
  creada_en TEXT NOT NULL,          -- ISO 8601 UTC
  atendida  INTEGER DEFAULT 0       -- 0/1, marcada a mano desde el panel
);

CREATE TABLE sesiones (
  id                TEXT PRIMARY KEY,        -- UUID generado en cliente
  creada_en         TEXT NOT NULL,           -- ISO 8601 UTC
  actualizada_en    TEXT,
  consentimiento    INTEGER NOT NULL,        -- 0/1
  compromiso_honestidad INTEGER NOT NULL,
  completo          INTEGER DEFAULT 0,       -- terminó los 25 ítems
  -- Puntuación total (0-N, N = nº de ítems del banco, hoy 25): suma de la
  -- puntuación fraccionaria [0,1] de cada ítem (binaria para abierto/opcion_multiple,
  -- parcial para seleccion_multiple/clasificar/ordenar — ver worker/src/puntuacion.ts).
  -- Se muestra al usuario como nota global 0-10 (puntuacion_total/N*10) y alimenta
  -- el percentil de la pantalla de resultado.
  puntuacion_total REAL,
  user_agent_clase  TEXT,                    -- 'movil' | 'escritorio' (no UA completo); NULL si origen='papel'
  -- Token de acceso (remesa) con el que se creó esta sesión (README §4.5). NULL
  -- solo en sesiones creadas antes de este control de acceso.
  token_id          TEXT REFERENCES tokens(id),
  -- 'web' (test normal) | 'papel' (digitalizada desde una hoja impresa vía OMR/OCR
  -- en el panel de admin, README §4.7). DEFAULT 'web' para no requerir el campo en
  -- las inserciones existentes (worker/src/db.ts::crearSesion).
  origen            TEXT NOT NULL DEFAULT 'web',
  -- Versión del pipeline de hoja/digitalización en papel (README §4.7/§4.9):
  -- NULL si origen='web'. Permite que convivan varios diseños de hoja
  -- (public/admin/papel/v1, v2...) y comparar en los datos cuál funciona
  -- mejor, sin que el resto del backend (worker/src/correccion.ts) necesite
  -- saber nada de versiones: la corrección ya opera sobre la respuesta
  -- decodificada, no sobre cómo se capturó.
  version_papel     INTEGER,
  -- Identificador individual de la hoja física de la que viene esta sesión
  -- (README §4.9/§4.10): NULL si origen='web' o si la hoja es de antes de
  -- este campo. Distinto de token_id (que identifica la REMESA, compartida
  -- por muchas hojas): este es el "examenes_papel.exam_id" leído del QR de
  -- cada página, único por hoja impresa. Sirve para trazabilidad y, sobre
  -- todo, para que POST /api/admin/digitalizacion pueda rechazar digitalizar
  -- dos veces la misma hoja física (una por el flujo secuencial de siempre,
  -- otra por la subida en bloque, o dos subidas en bloque duplicadas).
  examen_id         TEXT,
  -- demografía
  anio_nacimiento   INTEGER,
  sexo              TEXT,
  ccaa_educacion_secundaria TEXT,
  nivel_estudios    TEXT,
  area_estudios     TEXT,
  estudios_mayor_progenitor TEXT,
  libros_en_casa    TEXT
);

CREATE INDEX idx_sesiones_token ON sesiones(token_id);
-- UNIQUE (no solo INDEX): impide crear dos sesiones para la misma hoja física
-- (mismo examen_id) por reintento o por subir la misma hoja dos veces desde
-- la subida en bloque. SQLite no aplica UNIQUE entre varios NULL, así que no
-- afecta a sesiones sin examen_id (origen='web' o papel de antes de este campo).
CREATE UNIQUE INDEX idx_sesiones_examen ON sesiones(examen_id);

CREATE TABLE respuestas (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  sesion_id         TEXT NOT NULL REFERENCES sesiones(id),
  item_id           TEXT NOT NULL,
  -- SIEMPRE se guarda el dato crudo tal cual lo envió el cliente, serializado con
  -- JSON.stringify(): un string para 'abierto', un índice para 'opcion_multiple',
  -- un array para 'ordenar', un objeto elemento->categoría para 'clasificar'.
  respuesta_cruda   TEXT,
  opcion_elegida    INTEGER,                 -- índice 0-5, NULL si no es opcion_multiple
  acierto           INTEGER,                 -- 0/1
  -- Puntuación fraccionaria [0,1] de esta respuesta (parcial para
  -- seleccion_multiple/clasificar/ordenar, igual a `acierto` para el resto — ver
  -- worker/src/puntuacion.ts). Es el sumando de sesiones.puntuacion_total; se
  -- persiste aquí para no depender de recalcularla contra un banco de ítems que
  -- puede cambiar. NULL en filas anteriores a este campo.
  puntuacion        REAL,
  estado_correccion TEXT DEFAULT 'auto',     -- 'auto'|'parcial'|'pendiente_revision'|'manual'
  t_ms              INTEGER,
  orden_presentacion INTEGER,
  perdio_foco       INTEGER DEFAULT 0,
  enviada_en        TEXT NOT NULL
);

CREATE INDEX idx_respuestas_sesion ON respuestas(sesion_id);
CREATE INDEX idx_respuestas_item   ON respuestas(item_id);

-- Idempotencia real de POST /api/respuesta (README §4.3): el Worker hace
-- INSERT ... ON CONFLICT(sesion_id, item_id) DO UPDATE, así que un reintento de
-- red tras un timeout nunca duplica la respuesta a un mismo ítem.
CREATE UNIQUE INDEX idx_respuestas_sesion_item ON respuestas(sesion_id, item_id);

-- Persiste el orden de presentación del test hecho en el servidor (README §4.3: "el
-- orden se decide en el servidor y se persiste, para que recargar la página no cambie
-- el orden"). No contiene contenido de ítems, solo el id: el contenido vive
-- únicamente en data/items.json, importado por el Worker (README §4.2).
CREATE TABLE sesion_items (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  sesion_id           TEXT NOT NULL REFERENCES sesiones(id),
  item_id             TEXT NOT NULL,
  orden_presentacion  INTEGER NOT NULL,
  UNIQUE (sesion_id, item_id),
  UNIQUE (sesion_id, orden_presentacion)
);

CREATE INDEX idx_sesion_items_sesion ON sesion_items(sesion_id);

-- Subida en bloque de hojas en papel (README §4.10): registro de progreso de
-- una hoja física concreta ("examen") mientras se van subiendo sus páginas
-- sueltas, en cualquier orden y posiblemente en varias visitas al panel — a
-- diferencia del flujo secuencial de siempre (README §4.7), que solo vive en
-- memoria del navegador durante una única sesión de trabajo. La fila se crea
-- (o actualiza) con el primer POST /api/admin/examenes-papel/paginas que
-- llegue de esa hoja (identificada por exam_id, leído del QR de cada
-- página); no hace falta "registrarla" de antemano al imprimir.
CREATE TABLE examenes_papel (
  exam_id     TEXT PRIMARY KEY,        -- id corto leído del QR de cada página (comun.js::generarExamId)
  token_id    TEXT NOT NULL REFERENCES tokens(id),
  version     INTEGER NOT NULL,        -- versión del pipeline (v1, v2...), igual que sesiones.version_papel
  creado_en   TEXT NOT NULL,           -- cuándo se vio la primera página de esta hoja
  -- Sesión ya creada a partir de este examen (NULL mientras sigue en
  -- progreso). Se rellena al finalizar desde la pantalla de confirmación
  -- (misma que usa el flujo secuencial) y sirve para no ofrecerlo más en el
  -- listado de "exámenes en progreso" ni permitir finalizarlo dos veces.
  sesion_id   TEXT REFERENCES sesiones(id)
);

-- Una fila por página YA DECODIFICADA (nunca la foto en sí — mismo criterio
-- que el resto de la digitalización, README §4.7: solo sale del navegador el
-- resultado ya interpretado). marcas_json guarda lo mismo que produce
-- leerPagina() en cada v{n}/digitalizar.js: { oscuridad: {clave: 0-1},
-- textos: {clave: string} }. miniatura_datauri es opcional (JPEG de baja
-- resolución de la foto ya enderezada, para poder revisar a ojo en la
-- pantalla de confirmación igual que en el flujo secuencial); puede quedar
-- NULL si se prefiere no guardarla.
CREATE TABLE examenes_papel_paginas (
  exam_id           TEXT NOT NULL REFERENCES examenes_papel(exam_id),
  pagina            INTEGER NOT NULL,  -- 1-indexado, continuo entre páginas de datos e ítems
  marcas_json       TEXT NOT NULL,
  miniatura_datauri TEXT,
  subida_en         TEXT NOT NULL,
  PRIMARY KEY (exam_id, pagina)
);
