-- DDL de D1 (SQLite). Fuente: README.md §4.1

CREATE TABLE sesiones (
  id                TEXT PRIMARY KEY,        -- UUID generado en cliente
  creada_en         TEXT NOT NULL,           -- ISO 8601 UTC
  actualizada_en    TEXT,
  consentimiento    INTEGER NOT NULL,        -- 0/1
  compromiso_honestidad INTEGER NOT NULL,
  completo_corto    INTEGER DEFAULT 0,       -- terminó los 30
  acepto_extension  INTEGER,                 -- NULL si no llegó a la oferta
  completo_largo    INTEGER DEFAULT 0,       -- terminó los 100
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
  respuesta_cruda   TEXT,                    -- SIEMPRE se guarda el texto original
  opcion_elegida    INTEGER,                 -- índice 0-5, NULL si abierta
  acierto           INTEGER,                 -- 0/1
  estado_correccion TEXT DEFAULT 'auto',     -- 'auto'|'parcial'|'pendiente_revision'|'manual'
  t_ms              INTEGER,
  orden_presentacion INTEGER,
  perdio_foco       INTEGER DEFAULT 0,
  enviada_en        TEXT NOT NULL
);

CREATE INDEX idx_respuestas_sesion ON respuestas(sesion_id);
CREATE INDEX idx_respuestas_item   ON respuestas(item_id);
