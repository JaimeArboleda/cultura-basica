-- DDL de D1 (SQLite). Fuente: README.md §4.1

CREATE TABLE sesiones (
  id                TEXT PRIMARY KEY,        -- UUID generado en cliente
  creada_en         TEXT NOT NULL,           -- ISO 8601 UTC
  actualizada_en    TEXT,
  consentimiento    INTEGER NOT NULL,        -- 0/1
  compromiso_honestidad INTEGER NOT NULL,
  completo_corto    INTEGER DEFAULT 0,       -- terminó los 39
  acepto_extension  INTEGER,                 -- NULL si no llegó a la oferta
  completo_largo    INTEGER DEFAULT 0,       -- terminó los 156
  user_agent_clase  TEXT,                    -- 'movil' | 'escritorio' (no UA completo)
  -- demografía
  anio_nacimiento   INTEGER,
  sexo              TEXT,
  pais_nacimiento   TEXT,
  ccaa_nacimiento   TEXT,
  ccaa_residencia   TEXT,
  nivel_estudios    TEXT,
  area_estudios     TEXT,
  profesion         TEXT,
  estudios_padre    TEXT,
  estudios_madre    TEXT,
  libros_en_casa    TEXT,
  frecuencia_lectura TEXT,
  consumo_informativos TEXT,
  horas_redes_dia   TEXT
);

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

-- Persiste el sorteo de ítems hecho en el servidor (README §4.3: "el sorteo de
-- ítems se hace en el servidor y se persiste, para que recargar la página no
-- cambie el set"). No contiene contenido de ítems, solo el id: el contenido vive
-- únicamente en data/items.json, importado por el Worker (README §4.2).
CREATE TABLE sesion_items (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  sesion_id           TEXT NOT NULL REFERENCES sesiones(id),
  item_id             TEXT NOT NULL,
  fase                TEXT NOT NULL CHECK (fase IN ('corto','extension')),
  orden_presentacion  INTEGER NOT NULL,
  UNIQUE (sesion_id, item_id),
  UNIQUE (sesion_id, fase, orden_presentacion)
);

CREATE INDEX idx_sesion_items_sesion ON sesion_items(sesion_id);
