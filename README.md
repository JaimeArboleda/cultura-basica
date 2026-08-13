# Test de Cultura General — Estudio sobre la transmisión de la cultura básica occidental

Estudio observacional sobre el nivel de cultura general básica en la población española, 
segmentado por edad, sexo, nivel de estudios y área de estudios.

**Pregunta de investigación principal:** ¿en qué medida se ha dejado de transmitir el 
canon cultural occidental con las sucesivas reformas educativas? 
El eje de la **edad** es el foco del estudio;
el resto de variables son controles necesarios (sobre todo el nivel educativo, que
confunde con la edad si no se condiciona por él).

**Producto final esperado:** entrada de blog y/o preprint en arXiv. Sin pretensiones
de encuesta representativa oficial.

---

## 1. Decisiones de diseño

### 1.1 Alcance del contenido

El test mide **cultura clásica / canon occidental** de forma deliberada. La ausencia de
ítems sobre cultura digital, tecnología reciente o cultura popular contemporánea **no es un sesgo, es el objeto de estudio**. 
El objetivo declarado es medir la existencia de analfabetismo funcional, razón por la que el test es fácil a propósito. 


### 1.2 Contenido del banco (25 ítems)

El banco ya no se organiza en bloques temáticos fijos con cuota por bloque: es una
decisión deliberada para poder mantener el test corto (25 ítems) sin diluir cada
bloque en un único ítem por dificultad, que no permitía discriminar bien ni servir
de titular (ver §1.3). Los ítems siguen cubriendo el mismo abanico de temas de
cultura clásica / canon occidental (filosofía, historia, lengua y literatura, física
y química, biología y geología, economía y política, geografía, matemáticas, arte,
religión) más las dos habilidades transversales de siempre — razonamiento (lógica,
sentido común, detección de falacias, sesgos de razonamiento habituales) y
comprensión lectora —, pero el tema de cada ítem ya no es un campo del dato ni una
unidad de análisis: solo importan `dificultad` y `tipo` (§1.3, §4.2).

**Composición fija: 12 ítems fáciles + 12 difíciles (tipo `trivia`) + 1 comentario de
texto (tipo `comentario_texto`) = 25 ítems, el test completo.** El banco no tiene
ítems de reserva: cada persona ve exactamente estos 25 ítems, en orden aleatorio
(§1.4).

### 1.3 Niveles de dificultad

Cada ítem de tipo `trivia` se etiqueta como `facil` o `dificil` (el ítem de tipo
`comentario_texto` no lleva dificultad, ver §4.2).

- Los ítems **fáciles** existen para documentar el efecto techo: son "mínimos absolutos"
  que una persona de cultura normal debería acertar. Su unidad de análisis es el **ítem**
  ("el X% de los mayores de 60 sabe quién pintó Las Meninas frente al Y% de los menores
  de 30"). Sirve como titular del estudio.
- Los ítems **difíciles** existen para generar varianza y permitir modelar edad × estudios
  a nivel individual.

> **Regla de análisis: NO agregar fáciles y difíciles en una única nota global.**
> Son dos estudios distintos conviviendo en el mismo instrumento. Se reportan por separado.
> Esta regla aplica al **análisis** científico (§7): la nota global 0-10 que ve el
> usuario al terminar el test (§1.5) es una cifra de gamificación para dar feedback
> inmediato, no una variable de análisis — el análisis real sigue usando el ítem como
> unidad y TRI a nivel persona, nunca esa suma.
> (El banco tuvo originalmente un tercer nivel, `medio`: se eliminó porque en la
> práctica esos ítems no cumplían ninguno de los dos papeles — ni suficientemente
> fáciles para ser titular, ni suficientemente difíciles para discriminar.)

**Las etiquetas de dificultad a priori son provisionales.** Está documentado que quien
redacta un test estima mal la dificultad de sus propios ítems. Tras el piloto se
**reetiquetan según el porcentaje de acierto real**.

### 1.4 Un único test fijo (25 ítems)

**Todo el mundo hace el mismo test: los 25 ítems del banco, sin sorteo de
contenido.** No hay banco de reserva ni fase de extensión: el banco entero es el
test, y también se presenta a todo el mundo en el mismo **orden fijo** (§3, §4.2).

Esto simplifica la comparabilidad entre participantes (todos ven exactamente los
mismos 25 ítems, así que no hace falta un subconjunto de anclaje para poner las
puntuaciones en la misma escala) a cambio de menos varianza por persona que un banco
más grande. Es una decisión deliberada de diseño: menos preguntas, pero curadas una a
una, frente a un banco grande muestreado en parte al azar.

### 1.5 Formato de respuesta: mixto

- **Texto libre** cuando el espacio de respuestas es **cerrado y corto**: un año, un
  nombre propio, un número, una palabra. Mide **recuerdo**, elimina el azar, y un campo
  vacío significa inequívocamente "no lo sé".
- **Opción múltiple (6 opciones)** para todo lo demás, y **obligatoriamente** para
  definiciones y comparaciones ("¿qué es la refracción?", "¿qué diferencia hay entre
  agnosticismo y ateísmo?"). En texto libre esas producen miles de párrafos que habría
  que codificar a mano, lo que mataría el proyecto.
- **Selección múltiple (checkboxes)** para preguntas con más de una respuesta correcta
  entre varias opciones, sin indicar cuántas son correctas (p.ej. "marca todos los
  compositores de la Primera Escuela de Viena"). Más difícil que `opcion_multiple`
  porque no hay pista sobre el tamaño del conjunto correcto. El acierto exige marcar
  **exactamente** el conjunto de `opciones_correctas`, ni de más ni de menos — no hay
  puntuación parcial por acertar solo alguna.
- **Ordenar (drag-and-drop)** para ítems de secuencia/cronología (p.ej. ordenar
  compositores o estilos artísticos de más antiguo a más moderno). El usuario arrastra
  cajitas en vez de elegir entre listas completas ya ordenadas como opciones de MC —
  evita el problema de legibilidad en móvil de leer permutaciones enteras. La
  corrección es una igualdad exacta de secuencia (sin Levenshtein ni alias).
- **Clasificar (drag-and-drop en cajas)** para ítems de categorización (p.ej.
  clasificar filósofos según la corriente ética que defendieron, o libros según su
  género literario). El usuario arrastra cada elemento de una bandeja común hasta la
  caja de la categoría a la que pertenece, en vez de resolver varias preguntas de
  opción múltiple independientes sobre el mismo elemento. La corrección es una
  igualdad exacta elemento a elemento contra `clasificacion_correcta` (sin tolerancia).

Restricciones:
- **Máximo ~40% de ítems `abierto`**, repartidos a lo largo del test (no agrupados).
  Escribir en el móvil tiene coste y aumenta el abandono. Los ítems `ordenar` y
  `clasificar` **no cuentan para este tope**: no hay tecleo, el coste de fricción es
  más parecido al de MC.
- **No sumar formatos en una misma puntuación bruta (a efectos de análisis, §7).** Un
  ítem `opcion_multiple` tiene suelo de azar (16,7% con 6 opciones); un ítem `abierto`
  no tiene suelo; un ítem `ordenar` tampoco (el azar de acertar una permutación
  completa al azar es despreciable), ni un ítem `clasificar` ni `seleccion_multiple`
  (el azar de acertar una selección exacta entre varias opciones también lo es), así
  que a efectos de TRI se tratan junto con `abierto` (sin parámetro de pseudo-azar) en
  vez de junto con `opcion_multiple`. Para calibrarse todos juntos se usa TRI 3PL, que
  absorbe el suelo de MC en el parámetro de pseudo-azar. Esta regla es sobre el
  **modelo de calibración del análisis**, distinta de la nota global 0-10 que ve el
  usuario (más abajo), que sí mezcla formatos porque es solo gamificación.
- Los distractores de los ítems de opción múltiple y selección múltiple deben ser
  **plausibles**. Seis opciones donde cinco son absurdas equivalen a una pregunta de
  dos opciones.

**Puntuación mostrada al usuario:** el Worker calcula, para cada ítem respondido, una
puntuación fraccionaria en `[0,1]` (`worker/src/puntuacion.ts`): binaria (0 o 1) para
`abierto`/`opcion_multiple`; para `seleccion_multiple` y `clasificar`, la fracción de
sub-decisiones correctas (por opción o por elemento clasificado, respectivamente); y
para `ordenar`, la fracción de parejas de elementos en el orden relativo correcto
(de las `C(k,2)` parejas posibles). Sumando las 25 fracciones se obtiene una
**puntuación total en `[0,25]`**, que se muestra al usuario como **nota global en
escala 0-10** (`puntuacion_total / 25 * 10`) — el resultado destacado de la pantalla
de finalización. El **percentil** empírico frente a las demás sesiones ya completadas
(§3, `GET /api/resultado/:id`), calculado sobre esa misma puntuación total, se muestra
como dato secundario ("Lo has hecho mejor que el X % de participantes"). Ninguna de
las dos cifras distingue fácil/difícil ni se usa en el análisis real, que sigue
utilizando la respuesta cruda por ítem (§7).

### 1.6 Corrección automática del texto libre

Algoritmo por ítem:

1. **Normalizar** la respuesta enviada y cada alias con la misma función:
   minúsculas, eliminar acentos/diacríticos (NFD + strip de marcas combinantes),
   quitar signos de puntuación, colapsar espacios, recortar.
   ```js
   function normalizar(s) {
     return s
       .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
       .toLowerCase()
       .replace(/[^\p{L}\p{N}\s]/gu, "")
       .replace(/\s+/g, " ")
       .trim();
   }
   ```
2. Calcular la **distancia de Levenshtein** entre la respuesta normalizada y cada alias
   normalizado de `alias` (lista de alias por ítem, ej.: `Platón` acepta `platon`,
   `plato`, `platon de atenas`). No se aplica tolerancia a respuestas de ≤4 caracteres
   (deben coincidir exactas tras normalizar).
3. Si la distancia mínima a algún alias de `alias` es ≤ `tolerancia_edicion` (la
   distancia de Levenshtein admitida para ese ítem) → **acierto = 1**,
   `estado_correccion = 'auto'`.
4. Si no, repetir el paso 3 contra `alias_parcial` (lista aparte, opcional, para
   respuestas que revelan conocimiento parcial pero no son la respuesta pedida — ver
   más abajo). Si matchea → **acierto = 0**, `estado_correccion = 'parcial'`.
5. Si tampoco matchea nada → **acierto = 0**, `estado_correccion = 'auto'` (incorrecta
   directa, sin pasar por revisión manual).

`pendiente_revision` deja de ser una consecuencia automática de "no matchea" — con eso
se habría disparado revisión manual del 100% de las respuestas erróneas, incompatible
con el presupuesto del 5-10% de abajo. Sigue existiendo como valor válido de
`estado_correccion` para marcar a mano casos que un revisor decida re-codificar
durante el piloto (Fase 3), pero el pipeline automático nunca lo asigna.

**`alias_parcial`** (opcional, por ítem): respuestas que un revisor decidió que
*merecen categoría propia* en vez de un 0 indistinguible del resto — conocimiento
parcial y no simple azar. Ejemplo: en el ítem del Partenón, la respuesta "Grecia" no
está en `alias` (no es la respuesta pedida, "Atenas") pero sí en `alias_parcial`: cuenta
como fallo a efectos de puntuación (`acierto = 0`) pero queda distinguida en el dato
crudo (`estado_correccion = 'parcial'`) de un fallo cualquiera. Aplica también a otros
ítems marcados como "política de corrección" en la fase de redacción (p.ej.
Bentham/Mill, Anubis/Osiris, √2 irracional/real, Sófocles tragedia/teatro).

> **Presupuestar revisión manual del 5-10% de respuestas abiertas.** Es de lo más
> informativo del estudio: los fallos cercanos dicen muchísimo. Quien contesta "1494" a
> la llegada de Colón sabe algo; quien contesta "1789" no sabe lo mismo que quien deja
> el campo en blanco. Guardar SIEMPRE la respuesta cruda, nunca solo el booleano.

---

## 2. Variables demográficas

Se recogen **antes** del test. Todas las categorías cerradas deben ser **compatibles con
las del INE** para permitir post-estratificación.

| Campo | Tipo | Notas |
|---|---|---|
| `anio_nacimiento` | Entero | **No pedir "edad".** Permite separar edad de cohorte. |
| `sexo` | Cerrado | Hombre / Mujer / Otro / Prefiero no decirlo |
| `ccaa_educacion_secundaria` | Cerrado (19) | Comunidad/ciudad autónoma donde se cursó la educación secundaria. El estudio se limita a España. |
| `nivel_estudios` | Cerrado | **Categorías CINE/ISCED del INE**: sin estudios / primaria / ESO / bachillerato / FP grado medio / FP grado superior / grado o licenciatura / máster / doctorado |
| `area_estudios` | Cerrado (~6) | Artes y humanidades / Ciencias sociales y jurídicas / Ciencias / Ingeniería y arquitectura / Ciencias de la salud / No aplica. **No texto libre.** |
| `estudios_mayor_progenitor` | Cerrado | Mayor nivel de estudios entre padre y madre; mismas categorías que `nivel_estudios` |
| `libros_en_casa` | Cerrado (5) | Nº aproximado de libros en casa a los 15 años (0-10 / 11-25 / 26-100 / 101-200 / +200). **Indicador estándar de PISA**, muy predictivo y bien recordado. |

---

## 3. Telemetría y control de calidad

Se registra por respuesta:

- `t_ms`: milisegundos entre mostrar el ítem y enviar la respuesta.
- `orden_presentacion`: posición del ítem en esa sesión.
- Marca de si el usuario perdió el foco de la pestaña durante el ítem
  (`visibilitychange`), como señal débil de consulta externa.

No se puede impedir que alguien busque en Google, pero sí detectarlo: latencias anómalas
permiten marcar (no necesariamente descartar) respuestas sospechosas. Añadir además una
**casilla de compromiso de honestidad** al inicio: el efecto es pequeño pero real y
sale gratis.

Otras medidas:
- **Orden de presentación fijo e igual para todas las sesiones** (`data/orden-test.json`,
  §4.2), no aleatorizado por sesión: se prioriza la comparabilidad exacta entre
  participantes (todos ven el mismo ítem en la misma posición, así que el cansancio
  al final del test pesa igual para todos) sobre repartir el efecto del cansancio
  entre distintos ítems.
- **Guardar cada respuesta según se envía**, no al final. Los abandonos son un dato en
  sí mismo y deben quedar registrados.
- **Navegación hacia atrás permitida, con revisión final antes de enviar.** Se
  priorizó poder corregir errores de toque/interpretación sobre el riesgo de
  usar pistas de ítems posteriores; `t_ms` por ítem sigue registrado y permite
  detectar a posteriori revisiones con calma anómala.
- `localStorage` para reanudar si se cierra el navegador.

---

## 4. Arquitectura técnica

**Stack: Cloudflare Pages + Workers + D1.** Elegido por: plan gratuito generoso
(~100k peticiones/día), sin pausas por inactividad (a diferencia del tier gratuito de
Supabase, que suspende el proyecto tras 7 días sin uso), SQL real y exportación directa
a CSV.

```
/
├── public/              # Front-end estático → Cloudflare Pages
│   ├── index.html       # App del test, autocontenida
│   ├── app.js
│   ├── admin/           # Panel de administración (§4.5), bajo /admin
│   │   ├── index.html
│   │   ├── admin.js
│   │   ├── admin.css
│   │   ├── hoja.js       # Maquetación de la hoja OMR (§4.7)
│   │   └── digitalizar.js # Impresión + escaneo/OCR de tests en papel (§4.7)
│   └── styles.css
├── worker/              # Cloudflare Worker (API)
│   ├── src/index.ts
│   └── wrangler.toml
├── data/
│   ├── items/            # Banco de ítems, un JSON por ítem (01.json..25.json, fuente de verdad)
│   ├── items.json         # Generado: `npm run build:items` fusiona data/items/
│   ├── build-items.mjs
│   └── validate-items.mjs
├── schema/
│   └── schema.sql       # DDL de D1
├── analysis/            # Scripts de análisis (R / Python)
└── README.md
```

### 4.1 Esquema de datos (D1 / SQLite)

```sql
-- Control de acceso y panel de admin (§4.5): admins y tokens se crean antes que
-- sesiones porque sesiones.token_id las referencia.
CREATE TABLE admins (
  email       TEXT PRIMARY KEY,
  anadido_por TEXT,               -- email de quien lo dio de alta; NULL en la siembra inicial
  anadido_en  TEXT NOT NULL
);

CREATE TABLE tokens (
  id          TEXT PRIMARY KEY,    -- código compartido en la URL (?token=)
  descripcion TEXT NOT NULL,       -- p. ej. "familia de Gerardo": de qué remesa viene
  creado_por  TEXT NOT NULL,
  creado_en   TEXT NOT NULL,
  expira_en   TEXT NOT NULL
);

CREATE TABLE solicitudes_acceso (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  contacto  TEXT NOT NULL,
  motivo    TEXT,
  creada_en TEXT NOT NULL,
  atendida  INTEGER DEFAULT 0
);

CREATE TABLE sesiones (
  id                TEXT PRIMARY KEY,        -- UUID generado en cliente
  creada_en         TEXT NOT NULL,           -- ISO 8601 UTC
  actualizada_en    TEXT,
  consentimiento    INTEGER NOT NULL,        -- 0/1
  compromiso_honestidad INTEGER NOT NULL,
  completo          INTEGER DEFAULT 0,       -- terminó los 25 ítems
  -- Puntuación total (0-25): suma de la puntuación fraccionaria [0,1] de cada ítem
  -- (ver worker/src/puntuacion.ts). Se muestra al usuario como nota global 0-10 y
  -- alimenta el percentil de la pantalla de resultado (§1.5, §4.3).
  puntuacion_total REAL,
  user_agent_clase  TEXT,                    -- 'movil' | 'escritorio' (no UA completo)
  token_id          TEXT REFERENCES tokens(id), -- remesa de invitación (§4.5); NULL en sesiones anteriores a este control de acceso
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

CREATE TABLE respuestas (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  sesion_id         TEXT NOT NULL REFERENCES sesiones(id),
  item_id           TEXT NOT NULL,
  -- SIEMPRE se guarda el dato crudo tal cual lo envió el cliente, serializado con
  -- JSON.stringify(): un string para 'abierto', un índice para 'opcion_multiple', un
  -- array de índices para 'seleccion_multiple', un array para 'ordenar', un objeto
  -- elemento->categoría para 'clasificar'.
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

-- Idempotencia real de POST /api/respuesta (§4.3): el Worker hace
-- INSERT ... ON CONFLICT(sesion_id, item_id) DO UPDATE, así que un reintento de
-- red tras un timeout nunca duplica la respuesta a un mismo ítem.
CREATE UNIQUE INDEX idx_respuestas_sesion_item ON respuestas(sesion_id, item_id);

-- Persiste el orden de presentación del test hecho en el servidor: "el orden se
-- decide en el servidor y se persiste, para que recargar la página no cambie el
-- orden" (§4.3). No contiene contenido de ítems, solo el id: el contenido vive
-- únicamente en data/items.json, que el Worker importa como módulo estático
-- (§4.2) — D1 nunca se usa como copia del banco de ítems, así que editar un
-- ítem y regenerar data/items.json no requiere ninguna migración de datos.
CREATE TABLE sesion_items (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  sesion_id           TEXT NOT NULL REFERENCES sesiones(id),
  item_id             TEXT NOT NULL,
  orden_presentacion  INTEGER NOT NULL,
  UNIQUE (sesion_id, item_id),
  UNIQUE (sesion_id, orden_presentacion)
);

CREATE INDEX idx_sesion_items_sesion ON sesion_items(sesion_id);
```

### 4.2 Formato del banco de ítems (`data/items.json`)

Los 25 ítems viven cada uno en su propio fichero bajo `data/items/*.json` (p. ej.
`data/items/02.json`), fusionados por `data/build-items.mjs` en `data/items.json`. El
campo **`id`** es una cadena numérica correlativa con cero a la izquierda, `"01"` a
`"25"`, sin relación con la dificultad ni el formato — solo un identificador estable
y ordenable. La dificultad de cada ítem se declara aparte, en `dificultad`.

```jsonc
[
  {
    "id": "02",
    "tipo": "trivia",                // trivia | comentario_texto
    "dificultad": "facil",           // facil | dificil | null (null solo si tipo=comentario_texto)
    "formato": "abierto",            // abierto | opcion_multiple | seleccion_multiple | ordenar | clasificar
    "enunciado": "¿Qué dos monarcas financiaron el viaje de Cristóbal Colón a América?",
    "texto": null,                   // opcional: pasaje de 2-3 párrafos (tipo comentario_texto, ver más abajo)
    "respuesta_canonica": "Isabel de Castilla y Fernando de Aragón",
    "alias": ["isabel de castilla y fernando de aragon", "isabel y fernando", "los reyes catolicos"],
    "alias_parcial": null,           // opcional: respuestas de conocimiento parcial (§1.6)
    "tolerancia_edicion": 1,
    "opciones": null,
    "indice_correcto": null,
    "opciones_correctas": null
  },
  {
    "id": "16",
    "tipo": "trivia",
    "dificultad": "dificil",
    "formato": "opcion_multiple",
    "enunciado": "¿Qué dice el principio de incertidumbre de Heisenberg?",
    "opciones": [
      "El resultado de una medida cuántica solo puede predecirse en términos de probabilidad",
      "…", "…", "…", "…", "…"
    ],
    "indice_correcto": 2,
    "respuesta_canonica": null,
    "alias": null,
    "opciones_correctas": null
  },
  {
    "id": "18",
    "tipo": "trivia",
    "dificultad": "dificil",
    "formato": "seleccion_multiple",
    "enunciado": "Marca todos los poderes considerados por Montesquieu en su teoría de la división de poderes del Estado:",
    "opciones": ["Civil", "Judicial", "Militar", "Religioso", "Ejecutivo", "Económico", "Político", "Social", "Legislativo", "Administrativo"],
    "opciones_correctas": [1, 4, 8],   // índices 0-based de las opciones correctas (Judicial, Ejecutivo, Legislativo)
    "indice_correcto": null,
    "respuesta_canonica": null,
    "alias": null
  },
  {
    "id": "03",
    "tipo": "trivia",
    "dificultad": "facil",
    "formato": "ordenar",
    "enunciado": "Ordena estas figuras históricas de más antigua a más moderna:",
    "elementos": ["Napoleón", "Julio César", "Alejandro Magno", "Isaac Newton", "Leonardo Da Vinci", "Mahoma", "Ramsés II", "Santo Tomás de Aquino", "Karl Marx"],
    "elementos_ordenados": ["Ramsés II", "Alejandro Magno", "Julio César", "Mahoma", "Santo Tomás de Aquino", "Leonardo Da Vinci", "Isaac Newton", "Napoleón", "Karl Marx"],
    "respuesta_canonica": null,
    "alias": null,
    "opciones": null,
    "indice_correcto": null,
    "opciones_correctas": null
  },
  {
    "id": "04",
    "tipo": "trivia",
    "dificultad": "facil",
    "formato": "clasificar",
    "enunciado": "Asigna estas obras artísticas a sus correspondientes creadores",
    "elementos": ["La Divina Comedia", "Macbeth", "…"],
    "categorias": ["Dante Alighieri", "William Shakespeare", "…", "Rubens"],
    "clasificacion_correcta": { "La Divina Comedia": "Dante Alighieri", "Macbeth": "William Shakespeare" },
    "respuesta_canonica": null,
    "alias": null,
    "opciones": null,
    "indice_correcto": null,
    "opciones_correctas": null
  },
  {
    "id": "25",
    "tipo": "comentario_texto",
    "dificultad": null,
    "formato": "opcion_multiple",
    "enunciado": "Según el texto, ¿qué enunciado es más correcto?",
    "texto": "Desde este Escorial, rigoroso imperio de la piedra y la geometría…\n\nLa verdad, lo real, el universo, la vida…",
    "opciones": ["…", "…", "…", "…", "…", "…"],
    "indice_correcto": 4,
    "respuesta_canonica": null,
    "alias": null,
    "opciones_correctas": null
  }
]
```

El campo **`tipo`** distingue los 24 ítems de trivia normales (`trivia`, con
`dificultad` obligatoria `facil`/`dificil`) del único ítem de comprensión lectora
(`comentario_texto`, con `dificultad` a `null`): no pertenece al cupo fácil/difícil ni
a su misma lógica de titular/varianza (§1.3), es una prueba de comprensión lectora
aparte. La `dificultad` es metadato para el análisis (§1.3, §7); no influye en la
nota global que ve el usuario (§1.5) ni en el `id` del ítem.

El campo **`texto`** (opcional, `null` salvo que se indique lo contrario) es el pasaje
que precede a la pregunta. Solo se usa en el ítem de tipo `comentario_texto`, donde es
obligatorio; en el resto de ítems va siempre a `null`. Se admite `\n\n` para separar
párrafos; el front-end lo muestra en un bloque de texto aparte, antes del enunciado
(`item.texto`, ver `worker/src/tipos.ts` e `ItemPublico`). Nunca cuenta para el límite
de ítems `abierto` ni cambia la mecánica de corrección.

Para `seleccion_multiple`, `opciones` es la lista de opciones mostradas (orden de
presentación fijo) y `opciones_correctas` son los índices 0-based de las opciones
correctas (fuente de verdad, hace el papel de `indice_correcto`). La respuesta
enviada (array de índices marcados) se compara como conjunto exacto contra
`opciones_correctas`: hace falta marcar todas las correctas y ninguna incorrecta para
contar como acierto (sin puntuación parcial).

Para `ordenar`, `elementos` es el orden **de presentación** (ya desordenado a mano al
redactar el ítem, fijo para todos los usuarios — igual que la posición de
`indice_correcto` en `opcion_multiple` no se aleatoriza por sesión) y
`elementos_ordenados` es la secuencia **correcta** (fuente de verdad, hace el papel de
`respuesta_canonica`). La respuesta enviada se compara por igualdad exacta de array
contra `elementos_ordenados`.

Para `clasificar`, `categorias` son las cajas que se muestran (orden de presentación
fijo), `elementos` es la bandeja de fichas a repartir (orden de presentación fijo) y
`clasificacion_correcta` es un objeto que mapea cada elemento a su categoría correcta
(fuente de verdad, hace el papel de `respuesta_canonica`). La respuesta enviada
(qué elemento quedó en qué caja) se compara elemento a elemento contra
`clasificacion_correcta`; hace falta acertar la asignación completa para contar como
acierto (a efectos del acierto binario del ítem, §1.5) — la nota global sí da
puntuación parcial por elemento correctamente clasificado (§1.5). Una categoría sin
ningún elemento asignado es válida (un distractor deliberado, p. ej. un autor de más
entre las opciones de clasificación): el validador solo avisa, no bloquea el build.

**Invariantes que el código debe validar al arrancar:**
- Exactamente 25 ítems: 12 `trivia`/`facil` + 12 `trivia`/`dificil` + 1
  `comentario_texto`.
- `texto`, si está presente, es una cadena no vacía. Solo se espera si `tipo` es
  `comentario_texto` (obligatorio en ese caso).
- Todo ítem `opcion_multiple` tiene exactamente 6 opciones e `indice_correcto` válido.
- Todo ítem `seleccion_multiple` tiene al menos 2 opciones sin duplicar y al menos 1
  (pero no todas) marcada en `opciones_correctas`, con índices válidos y sin duplicar.
- Todo ítem `abierto` tiene `respuesta_canonica`, al menos un alias y
  `tolerancia_edicion` (distancia de Levenshtein admitida). `alias_parcial`, si existe,
  no se solapa con `alias` (§1.6).
- Todo ítem `ordenar` tiene `elementos` (≥4, sin duplicados, orden de presentación) y
  `elementos_ordenados` (la misma lista permutada a su orden correcto, distinto de
  `elementos`).
- Todo ítem `clasificar` tiene `categorias` (≥2, sin duplicados), `elementos` (≥4, sin
  duplicados) y `clasificacion_correcta` con exactamente una entrada por elemento, cada
  una apuntando a una categoría existente. Una categoría sin ningún elemento asignado
  (distractor deliberado) solo genera un aviso, no un error.

**Orden de presentación (`data/orden-test.json`).** Un array plano con los 25 `id`
del banco, en el orden fijo en que se presentan a todo el mundo (§1.4, §3):

```jsonc
["01", "05", "16", "03", "13", "11", "22", "09", "24", "20", "25", "14", "02", "18", "07", "21", "04", "15", "10", "23", "06", "19", "12", "17", "08"]
```

`worker/src/sorteo.ts` lo importa como módulo estático (igual que `data/items.json`,
ver §4.3/§4.4) y traduce cada `id` a su `orden_presentacion`; un `id` del banco que
falte en el fichero se añade al final en vez de perderse. El orden inicial se generó
con el criterio: 5 ítems fáciles + 5 difíciles barajados al principio (empezando por
2 fáciles), luego el ítem `comentario_texto`, y el resto en un orden sin criterio
particular — pensado como punto de partida editable a mano, no como una regla que el
código deba volver a aplicar.

### 4.3 Endpoints del Worker

```
POST /api/sesion            → crea sesión (exige token de acceso, §4.5), devuelve id + los 25 ítems
POST /api/respuesta         → guarda una respuesta (idempotente por sesion_id+item_id)
GET  /api/resultado/:id     → devuelve el resultado de esa sesión (NO exige token, §4.5)
GET  /api/export?token=…    → volcado CSV/JSON (protegido con secreto en env)
GET  /api/token-valido?token=…      → { valido, motivo? } — comprobación previa al consentimiento
POST /api/solicitud-acceso          → guarda una solicitud de acceso sin token

GET  /api/admin/auth/login          → redirige a Google OAuth
GET  /api/admin/auth/callback       → callback de Google, redirige a /admin/#token=… (sesión, §4.5)
GET  /api/admin/me                  → { email } del admin autenticado
GET  /api/admin/tokens              → lista tokens (con nº de sesiones/completas)
POST /api/admin/tokens              → crea un token { descripcion, horas_validez? }
DELETE /api/admin/tokens/:id        → revoca (caduca de inmediato) un token
DELETE /api/admin/tokens/:id/sesiones → borra todas las sesiones de esa remesa; el token sigue activo
DELETE /api/admin/tokens/:id/completo → papelera: borra el token y todas sus sesiones/respuestas, sin dejar rastro
GET  /api/admin/sesiones            → lista sesiones, filtros ?token_id=&estado=completo|en_progreso
DELETE /api/admin/sesiones/:id      → borra una sesión (y sus respuestas)
GET  /api/admin/stats               → agregados del piloto, opcional ?token_id=
GET  /api/admin/dataset             → dataset crudo {sesiones,respuestas,tokens} para la consola Pyodide (§4.5), opcional ?token_id=
GET  /api/admin/solicitudes         → lista solicitudes de acceso
PATCH /api/admin/solicitudes/:id    → marca una solicitud como atendida
DELETE /api/admin/solicitudes/:id   → borra una solicitud de acceso
GET  /api/admin/admins              → lista administradores
POST /api/admin/admins              → añade un administrador { email }
DELETE /api/admin/admins/:email     → quita un administrador (rechaza si es el último)

GET  /api/admin/items-impresion     → banco en el orden fijo de presentación, sin respuestas (hoja OMR, §4.7)
POST /api/admin/digitalizacion      → crea una sesión origen='papel' a partir de una hoja ya interpretada (§4.7)
```

No hay endpoint de logout: la sesión de admin es un token stateless (§4.5), así
que "salir" es simplemente borrarlo del `localStorage` del navegador.

Todas las rutas `/api/admin/*` salvo `auth/login` y `auth/callback` exigen la
cookie de sesión de admin (§4.5); sin ella devuelven 401.

Notas de implementación:
- El orden de presentación es **fijo** (`data/orden-test.json`, §4.2, igual para
  todas las sesiones) y aun así se persiste por sesión **en el servidor** (tabla
  `sesion_items`, §4.1), para que recargar la página no cambie el orden y para no
  depender de que el fichero de configuración no cambie entre el alta de la sesión
  y su resolución. `POST /api/sesion` es idempotente: si la sesión ya existe, no se
  puede volver a llamar (cada sesión se crea una sola vez); reanudar usa
  `GET /api/resultado/:id`.
- `GET /api/resultado/:id` tiene dos formas de respuesta según el estado de la sesión:
  si `completo=0` (test en curso, típicamente tras recargar la página o volver más
  tarde), devuelve `{ estado: 'en_progreso', items_pendientes }` en vez de un
  resultado, para que el cliente pueda **reanudar sin volver a decidir nada en el
  propio front-end** — el `localStorage` del cliente solo necesita guardar el
  `sesion_id` (§8), nunca qué ítems tocan ni en qué orden. Si la sesión está completa,
  devuelve `{ estado: 'completo', resultado }`, donde `resultado` es `{ primera: true }`
  si aún no hay ninguna otra sesión completada con la que comparar, o
  `{ primera: false, percentil }` en caso contrario (§1.5: nunca se envía la
  puntuación ponderada en bruto, solo el percentil).
- **Las respuestas correctas nunca se envían al cliente** antes de que el ítem se
  conteste. La corrección ocurre en el Worker. Para ítems `seleccion_multiple`, esto
  significa que `opciones_correctas` no se envía al cliente hasta contestar; solo se
  envía `opciones`. Para ítems `ordenar`, `elementos_ordenados` no se envía hasta
  contestar; solo se envía `elementos` (el orden de presentación, ya desordenado en
  los datos). Análogamente, para ítems `clasificar` no se envía
  `clasificacion_correcta` hasta contestar; solo se envían `categorias` y `elementos`.
- Rate limiting básico por IP para evitar envíos automatizados; la IP **no se almacena**.

### 4.4 Despliegue manual a Cloudflare

Nada de esto lo ejecuta Claude Code de forma autónoma: requiere una cuenta de
Cloudflare real y credenciales que no viven en este entorno. Pasos, en orden, desde
la raíz del repo:

```bash
cd worker
npx wrangler login                                   # abre el navegador para autenticar

npx wrangler d1 create cultura-basica                 # crea la base D1
# copiar el database_id que devuelve en worker/wrangler.toml (sustituye
# REEMPLAZAR_TRAS_CREAR_LA_BD)

npx wrangler d1 execute cultura-basica --remote \
  --file=../schema/schema.sql                         # aplica el esquema (§4.1)

npx wrangler kv namespace create RATE_LIMIT            # crea el KV del rate limiting
# copiar el id que devuelve en worker/wrangler.toml (sustituye
# REEMPLAZAR_TRAS_CREAR_EL_KV)

npx wrangler secret put EXPORT_TOKEN                    # token de GET /api/export;
                                                          # pide el valor por stdin, nunca
                                                          # va en wrangler.toml ni en git

npx wrangler deploy                                     # publica el Worker
```

En entornos no interactivos (sin `wrangler login`, p.ej. este agente) hay un
`CLOUDFLARE_API_TOKEN` ya generado en `worker/.dev.vars` para poder desplegar sin
navegador:

```bash
cd worker
export CLOUDFLARE_API_TOKEN=$(grep CLOUDFLARE_API_TOKEN .dev.vars | tail -1 | cut -d= -f2)
npx wrangler deploy
```

Front-end (Cloudflare Pages), desde la raíz del repo:

```bash
npx wrangler pages deploy public/ --project-name=cultura-basica
```

Para que el front-end pueda llamar al Worker sin CORS, se recomienda enrutar
`/api/*` de ese mismo dominio de Pages hacia el Worker (Cloudflare Dashboard →
Pages → el proyecto → Settings → Functions/Routes, o un dominio propio con una
route en `wrangler.toml`). Si en vez de eso Pages y el Worker quedan en dominios
distintos, hay que ajustar `ALLOWED_ORIGIN` en `worker/wrangler.toml` al dominio
real de Pages y volver a desplegar el Worker.

**Actualizar el banco de ítems ya en producción**, tras editar algo en
`data/items/{faciles,dificiles,comentario_texto}/*.json` (§4.2, §8):

```bash
npm run build:items   # regenera data/items.json desde las fuentes
npm test               # valida invariantes + corre los tests del Worker
cd worker && npx wrangler deploy   # el Worker importa data/items.json como módulo
                                    # estático (worker/src/items.ts), así que este
                                    # deploy es todo lo que hace falta
```

**Cambiar el orden fijo del test**, tras editar `data/orden-test.json` (§4.2): basta con
`cd worker && npx wrangler deploy` (se importa igual que `data/items.json`, sin paso de
build previo porque ya es un array plano). El front-end (`public/`) no necesita
redeploy en ninguno de los dos casos anteriores, por el mismo motivo que el resto de
cambios de contenido: nunca contiene enunciados, respuestas ni el orden hardcodeados.

Ningún paso de aquí toca D1: el banco de ítems nunca se replica en la base de
datos (`schema/schema.sql`, tabla `sesion_items`), así que editar un ítem no
implica ninguna migración de datos. El front-end (`public/`) no necesita
redeploy salvo que se toquen sus propios ficheros, porque nunca contiene
enunciados ni respuestas hardcodeadas.

**Migrar el esquema de una D1 ya desplegada** (p. ej. tras añadir una columna
demográfica a `schema/schema.sql`): `wrangler d1 execute --file` vuelve a
ejecutar el `CREATE TABLE` y falla si la tabla ya existe, así que en una base
existente hay que aplicar el cambio a mano con `ALTER TABLE`, por ejemplo:

```bash
npx wrangler d1 execute cultura-basica --remote \
  --command="ALTER TABLE sesiones ADD COLUMN sexo TEXT"
```

Ejemplo real ya aplicado: `respuestas.puntuacion` (puntuación fraccionaria [0,1] de
cada respuesta, antes solo calculada al vuelo para la nota global y ahora también
persistida por fila — `worker/src/puntuacion.ts`):

```bash
npx wrangler d1 execute cultura-basica --remote \
  --command="ALTER TABLE respuestas ADD COLUMN puntuacion REAL"
```

### 4.5 Control de acceso y panel de administración (issue #2)

**Motivación:** publicado sin control, el test es vulnerable a respuestas fuera del
grupo objetivo o repetidas para "jugar" con el resultado. La solución no identifica
a la persona (sigue sin pedir nombre ni email, §5): un **token de acceso** identifica
una *remesa* de invitación compartida por varias personas ("familia de Gerardo",
"primero de matemáticas de la uni"), no a quien responde.

**Tokens de acceso (`tokens`, §4.1):**
- `POST /api/sesion` exige un `token` válido y no caducado; sin él, o caducado, o
  inexistente, se rechaza (401/403).
- Un token **no tiene límite de usos**: sirve para cualquier número de personas
  mientras no caduque. La validez se fija al crearlo (2 horas - 10 días, panel de
  admin), 48h por defecto.
- "Revocar" un token lo caduca de inmediato (no borra sus sesiones/respuestas).
- `GET /api/resultado/:id` **nunca exige token**: reanudar el test o ver un
  resultado ya existente depende solo de conocer el `sesion_id` (§8), nunca de que
  el token siga vivo. Esto es intencional: separa "permiso para crear una sesión
  nueva" (el token) de "identidad de un intento concreto" (`sesion_id`).

**Borrado y repetición del test:** desde el panel se puede borrar una sesión
individual (`DELETE /api/admin/sesiones/:id`) o toda una remesa de golpe
(`DELETE /api/admin/tokens/:id/sesiones`); en ambos casos se borran en cascada sus
`respuestas` y `sesion_items` (a mano, en un batch atómico — el esquema no declara
`ON DELETE CASCADE`, ver `worker/src/db.ts::borrarSesion`). El token **no se
revoca** al borrar sus sesiones: la próxima vez que el navegador de esa persona
consulte `GET /api/resultado/:id` recibirá 404, lo que limpia su `localStorage`
(`public/app.js::reanudarSesion`) y le permite repetir el test **reabriendo el
mismo enlace de invitación** (`?token=…`), mientras el token no haya caducado. El
token no se guarda en `localStorage`: es una decisión deliberada para que "repetir"
siempre pase por el enlace original, no por un estado oculto del navegador.

**Enlace permanente de resultado y "compartir":** al completar el test, la
pantalla de resultado ofrece un enlace `?resultado=<sesion_id>` (con botón de
compartir vía `navigator.share`, o copiar al portapapeles) que funciona
**indefinidamente**, pase lo que pase con el token que se usó para crear la
sesión — es justo lo que no depende del token (párrafo anterior). Si alguien
abre ese enlace sin ser quien hizo el test (se lo compartieron), ve el mismo
resultado y una llamada a la acción para solicitar su propio acceso; esa
llamada se oculta cuando `sesion_id` coincide con el que hay en el
`localStorage` de ese navegador (es decir, para quien lo hizo).

**Solicitudes sin token (`solicitudes_acceso`, §4.1):** quien llega sin token
válido ve un formulario simple (dato de contacto + motivo opcional) en vez del
test. Se guarda en su propia tabla, **no** en el dataset anónimo del estudio
(§5) — solo la ve el panel de admin, que puede marcarla como atendida.

**Panel de admin (`public/admin/`, bajo `/admin`):** seis pestañas — Estadísticas
(total/completas/en progreso, progreso hacia el objetivo del piloto de 100-150
respuestas, distribución demográfica, todo filtrable por token), Estadísticas
avanzadas (ver más abajo), Tokens
(crear/listar/revocar/borrar remesa/copiar enlace/**borrar token entero**), Sesiones
(listar con filtro por token y estado, borrar individual), Solicitudes de acceso
(listar, marcar atendida, **borrar**) y Administradores (añadir/quitar cuentas
autorizadas).

**Estadísticas avanzadas: consola Python en el navegador (sin backend Python).**
La pestaña "Estadísticas" de más arriba muestra agregados fijos; para explorar
libremente (correlaciones, regresiones, gráficos ad hoc) sin tener que ir
precodificando cada estadística nueva en el Worker, esta pestaña carga
[Pyodide](https://pyodide.org) (Python compilado a WebAssembly) directamente en
el navegador del admin:
- `GET /api/admin/dataset` (filtrable por `token_id`, igual que `/api/admin/stats`)
  devuelve `sesiones`, `respuestas`, `tokens` (solo `id`+`descripcion`) e `items`
  (el banco de ítems completo — `id`, `tipo`, `dificultad`, `formato`, `enunciado`,
  `opciones`/`elementos`/`categorias` según el formato, y `respuesta_correcta`;
  `worker/src/items.ts::paraDataset()`) en crudo. `items` no depende del filtro
  por token: es el mismo banco para todas las sesiones — se incluye para poder
  cruzar por `item_id` con `respuestas` y ver en qué preguntas hay más error, sin
  tener que ir a buscar el enunciado a mano en `data/items.json`. **No** incluye
  `solicitudes_acceso`: no forma parte del dataset anónimo del estudio (párrafo de
  más arriba).
- Al pulsar "Cargar entorno", `public/admin/admin.js` descarga Pyodide más los
  paquetes `pandas`, `matplotlib` y `scikit-learn` desde jsdelivr (unos cuantos
  MB, por eso es perezoso: solo al entrar en esta pestaña) y mete el dataset como
  cuatro DataFrames (`sesiones`, `respuestas`, `tokens`, `items`) en un espacio de
  nombres Python persistente.
- Cada celda de código se ejecuta con `exec()`/`eval()` sobre ese mismo espacio de
  nombres (como una consola de Python, con auto-display de la última expresión
  igual que Jupyter/IPython) — no es un notebook real con protocolo de kernel,
  pero cubre pandas/matplotlib/scikit-learn arbitrarios sin montar esa UI. Las
  figuras de matplotlib abiertas al terminar una celda se capturan como PNG
  (backend `Agg`, sin canvas de por medio) y se muestran inline.
- Todo ocurre en el navegador del admin: el dataset no pasa por ningún servidor
  intermedio ni se envía a un backend Python, y el código que se ejecuta nunca
  sale de esa pestaña.
- **"Descargar CSV (.zip)"** en la misma pestaña: para quien solo quiere los
  datos en Excel/otro sitio sin pasar por la consola. Construye el `.zip` a
  mano en JS (formato PKZIP, entradas sin comprimir — el dataset del piloto es
  pequeño) para no añadir ninguna librería nueva; no depende de que Pyodide
  esté cargado. Descarga `sesiones.csv`, `respuestas.csv`, `tokens.csv` e
  `items.csv`, respetando el filtro por token si hay uno seleccionado (`items.csv`
  no cambia con el filtro: es el mismo banco para todas las sesiones).

**Papelera (borrado definitivo, sobre todo para limpiar datos de prueba):**
"Borrar token" en la pestaña Tokens borra el token entero además de todas sus
sesiones/respuestas (a diferencia de "Borrar respuestas", que deja el token vivo
— ver más arriba), y "Borrar" en Solicitudes de acceso borra esa solicitud. Las
dos acciones son irreversibles y usan un modal que exige teclear una frase exacta
("borrar token" / "borrar solicitud", `public/admin/admin.js::pedirConfirmacionTexto`)
en vez de un simple `confirm()` del navegador, para no pulsarlas por error.

**Autenticación de admin: OAuth de Google, sin login propio.** Decisión deliberada
para no gestionar contraseñas siendo un equipo de 3 personas, todas con cuenta de
Gmail — más simple que poner Cloudflare Access delante:
- La lista de administradores vive en la tabla `admins` (§4.1), gestionable desde
  el propio panel una vez dentro (pestaña Administradores); no permite quitar al
  último admin (red de seguridad ante un borrado accidental).
- Flujo: `GET /api/admin/auth/login` redirige a Google (Authorization Code);
  `GET /api/admin/auth/callback` intercambia el código por el email verificado
  (`https://www.googleapis.com/oauth2/v3/userinfo`, sin verificar el JWT del
  `id_token` a mano), comprueba que esté en `admins` y, si lo está, redirige a
  `${ALLOWED_ORIGIN}/admin/#token=…` con un token firmado con HMAC-SHA256
  (`worker/src/adminAuth.ts`, secreto `ADMIN_SESSION_SECRET`), válido 7 días.
  Cualquier fallo redirige en su lugar a `/admin/?error=…` con un mensaje legible.
- **No es una cookie, es un token en `Authorization: Bearer` guardado en
  `localStorage`** (`public/admin/admin.js`): el panel se sirve desde Cloudflare
  Pages (`*.pages.dev`) y la API desde el Worker (`*.workers.dev`), dos dominios
  distintos a efectos de cookies (ambos son sufijos públicos en la lista de
  Mozilla/Chrome, así que ni compartiendo el prefijo `cultura-basica` cuentan como
  el mismo sitio) — una cookie httpOnly no viajaría en las peticiones `fetch` del
  panel. El token va en el **fragmento** de la URL de redirección (`#token=…`, no
  query string) para que no quede en logs de servidor/CDN; `admin.js` lo lee una
  vez, lo guarda en `localStorage` y lo retira de la barra de direcciones. "Salir"
  es solo borrar ese token en el navegador: no hay estado de sesión en el
  servidor que invalidar.
- Cada petición a `/api/admin/*` (salvo `auth/login`/`auth/callback`/`me`) revalida
  la firma del token **y** que el email siga en `admins`: quitar a alguien del
  panel corta su acceso de inmediato, sin esperar a que caduque su token.
- El `state` de CSRF del login OAuth sí es una cookie (`worker/src/adminAuth.ts`):
  se fija y se lee siempre en el dominio del Worker, nunca cruza a Pages, así que
  no tiene el problema anterior.
- Si en el futuro se configura un dominio propio con `/api/*` enrutado al Worker
  bajo el mismo dominio que Pages (README §4.4, "para que el front-end pueda
  llamar al Worker sin CORS"), este mecanismo sigue funcionando sin cambios: la
  `redirect_uri` de Google se deriva del origen real de la petición
  (`worker/src/adminAuth.ts::redirectUriDesde`), no de un valor fijo.

### 4.6 Desplegar el control de acceso (issue #2)

Añade a los pasos de despliegue de §4.4:

**Credenciales OAuth de Google** (una vez, en [Google Cloud Console](https://console.cloud.google.com/apis/credentials)):
crear un "OAuth 2.0 Client ID" de tipo *Web application*, con esta *Authorized
redirect URI* — el dominio donde vive de verdad `/api/admin/auth/callback` (hoy el
`*.workers.dev` del Worker, **no** el `*.pages.dev` de Pages donde vive el panel,
ver el aviso de arriba sobre dominios distintos):

```
https://<subdominio-del-worker>.workers.dev/api/admin/auth/callback
```

Copiar el Client ID a `GOOGLE_CLIENT_ID` en `worker/wrangler.toml` `[vars]`, y el
Client Secret como secret:

```bash
cd worker
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put ADMIN_SESSION_SECRET   # cadena aleatoria larga, p. ej.
                                                 # `openssl rand -base64 32`
```

**Sembrar los administradores iniciales** (problema del "primer admin": la tabla
`admins` empieza vacía y solo alguien ya en `admins` puede añadir a otro desde el
panel):

```bash
npx wrangler d1 execute cultura-basica --remote \
  --command="INSERT INTO admins (email, anadido_por, anadido_en) VALUES ('persona1@gmail.com', NULL, '$(date -u +%Y-%m-%dT%H:%M:%SZ)')"
# repetir para cada admin inicial
```

**Migrar una D1 ya desplegada** (test publicado antes de este control de acceso,
issue #2) a las tablas nuevas, igual que el ejemplo de más arriba:

```bash
npx wrangler d1 execute cultura-basica --remote --command="
  CREATE TABLE admins (email TEXT PRIMARY KEY, anadido_por TEXT, anadido_en TEXT NOT NULL);
  CREATE TABLE tokens (id TEXT PRIMARY KEY, descripcion TEXT NOT NULL, creado_por TEXT NOT NULL, creado_en TEXT NOT NULL, expira_en TEXT NOT NULL);
  CREATE TABLE solicitudes_acceso (id INTEGER PRIMARY KEY AUTOINCREMENT, contacto TEXT NOT NULL, motivo TEXT, creada_en TEXT NOT NULL, atendida INTEGER DEFAULT 0);
  ALTER TABLE sesiones ADD COLUMN token_id TEXT REFERENCES tokens(id);
  CREATE INDEX idx_sesiones_token ON sesiones(token_id);
"
```

Las sesiones creadas antes de esta migración quedan con `token_id` a `NULL`
(siguen visibles y exportables con normalidad, solo no pertenecen a ninguna
remesa). A partir de aquí, `POST /api/sesion` empezará a exigir un token, así que
conviene crear al menos uno desde el panel antes de anunciar el test de nuevo.

### 4.7 Digitalización de tests en papel (OMR + OCR, sin API de pago)

**Motivación:** para poder pasar el test también a quien no quiere/puede
hacerlo en pantalla (encuestas presenciales, personas mayores, aulas sin
dispositivo por persona), hace falta una versión impresa y una forma de meter
esas respuestas en el mismo dataset que las sesiones web, bajo el mismo
control de acceso por token (§4.5) — sin depender de una API de pago de
visión, dado el volumen del piloto (300-400 sesiones, §6).

**Decisión de diseño: la hoja es casi toda "rellena una burbuja", no letra
manuscrita.** Opción múltiple y selección múltiple ya son burbujas/casillas
de forma natural; `ordenar` y `clasificar` se resuelven igual, con una
rejilla de burbujas por elemento (una burbuja por posición o por categoría,
en vez de escribir un número o una letra a mano). Eso convierte la mayor
parte de la hoja en un problema de **OMR** (reconocimiento de marcas:
umbralizar cuánta tinta hay en una región conocida), que es determinista y no
necesita ningún modelo — ni de pago ni local. Solo los ~10 ítems `abierto` y
el año de nacimiento piden texto, y ahí se pide **MAYÚSCULAS de imprenta, una
letra por casilla** para maximizar el acierto del OCR.

**Pipeline, todo en el navegador del admin, sin coste:**
1. **Impresión** (`public/admin/hoja.js`): construye la hoja a partir de
   `GET /api/admin/items-impresion` (mismo `paraCliente()`/`ordenarTest()` que
   ve la web, así que hoja y web nunca pueden divergir en contenido). El
   maquetado usa HTML/CSS real (no canvas): cada bloque de ítem/demografía se
   mide con `getBoundingClientRect()` en un contenedor oculto del mismo ancho
   que la página impresa y se empaqueta vorazmente en páginas A4 sin partir
   ningún bloque — el número de páginas es dinámico según cuánto ocupe el
   banco en ese momento, no un valor fijo. La versión en PDF sale del propio
   diálogo de impresión del navegador ("Guardar como PDF"): no hace falta
   ninguna librería de generación de PDF.
2. **Escaneo** (`public/admin/digitalizar.js`): el admin sube una foto/escaneo
   por página y ajusta 4 puntos sobre las esquinas de la hoja. Con esas 4
   correspondencias se resuelve una **homografía** (sistema lineal 8×8, sin
   ninguna librería de visión) y se "endereza" la foto a un canvas del tamaño
   exacto de la página de referencia (interpolación bilineal, warping
   inverso). Sobre esa imagen ya alineada, cada burbuja se muestrea en la
   coordenada exacta medida en el paso 1 (fracción de tinta en la región:
   burbuja rellena si supera un umbral, ajustable en
   `digitalizar.js::UMBRAL_MARCA`) y cada recuadro de texto libre se recorta y
   se pasa por **[Tesseract.js](https://tesseract.projectnaptha.com/)** (WASM,
   cargado bajo demanda desde CDN — mismo patrón que Pyodide en "Estadísticas
   avanzadas", §4.5). Nada de esto sale del navegador salvo el resultado final
   ya revisado, que se manda a `POST /api/admin/digitalizacion`.
3. **Revisión**: antes de guardar, una pantalla muestra lo detectado
   (preseleccionado) para cada campo, editable, más la foto ya enderezada de
   cada página por si hace falta comparar a ojo. No es la revisión
   sistemática del 5-10% de respuestas abiertas de la web (§1.6) — aquí el
   admin ve y puede corregir el 100% antes de guardar, porque el volumen de
   hojas en papel es bajo y el coste de revisar es prácticamente cero
   comparado con dejar pasar un error de OCR/OMR sin detectar.

**`POST /api/admin/digitalizacion`** crea la sesión igual que `POST
/api/sesion` (mismo `ordenarTest()`, misma tabla `sesion_items`) pero:
- Va asociada a un `token_id` elegido por el admin (la remesa a la que
  pertenece esa hoja física), sin exigir que siga sin caducar — a diferencia
  de `POST /api/sesion` — porque la hoja se pudo rellenar dentro de la
  ventana de validez del token y digitalizarse después.
- Corrige y puntúa con el mismo `corregirRespuesta()`/`puntuarItem()` que usa
  `POST /api/respuesta` (extraído a `worker/src/correccion.ts` para
  compartirlo entre los dos flujos): una respuesta ya interpretada por
  OMR/OCR se trata exactamente igual que una tecleada en la web.
- Marca la sesión con **`sesiones.origen = 'papel'`** (frente a `'web'` por
  defecto), visible en la pestaña Sesiones del panel y en el dataset/CSV —
  para poder controlar por modalidad de respuesta en el análisis (§7) si se
  detectaran diferencias sistemáticas entre hacer el test en papel y en
  pantalla.

**Migrar una D1 ya desplegada** (test publicado antes de esta funcionalidad),
igual que los ejemplos de §4.4:

```bash
npx wrangler d1 execute cultura-basica --remote \
  --command="ALTER TABLE sesiones ADD COLUMN origen TEXT NOT NULL DEFAULT 'web'"
```

**Qué falta validar con pruebas reales en papel** (por eso es una primera
versión, no la definitiva): la calidad de Tesseract.js sobre letra manuscrita
real (aunque sea en mayúsculas de imprenta separadas) es la incógnita
principal, y el umbral de OMR puede necesitar ajuste según el escáner/cámara
y el tipo de bolígrafo. Si tras el piloto en papel la tasa de error resulta
demasiado alta para el volumen de hojas, la opción de subir a una API de
visión de pago (p. ej. con soporte de `vision` en el modelo) queda abierta
como mejora futura — pero acotada solo a los recuadros de texto libre, ya que
el resto de la hoja (OMR) no se beneficia de un modelo más caro.

---

## 5. Privacidad y RGPD

- Pantalla de **consentimiento informado** antes de nada: finalidad, responsable,
  carácter anónimo, derecho a abandonar.
- **No se recoge** email, nombre, ni dirección IP persistida.
- Sin identificadores directos, el tratamiento es de datos anonimizados, lo que evita
  la mayor parte de las obligaciones formales.
- El User-Agent completo no se almacena; solo una clasificación móvil/escritorio.
- Publicar el dataset anonimizado junto al paper (con las celdas demográficas muy
  pequeñas agregadas, para evitar reidentificación).
- **Excepciones deliberadas, fuera del dataset del estudio** (§4.5): la tabla
  `solicitudes_acceso` sí guarda un dato de contacto, pero solo el que la propia
  persona decide dar voluntariamente para pedir acceso — no se cruza nunca con
  `sesiones`/`respuestas` y no se publica. La tabla `admins` guarda los emails de
  Gmail del propio equipo del estudio (autenticación del panel), no de
  participantes.

---

## 6. Fases del proyecto

### Fase 1 — Banco de ítems
Redactar los 25 ítems (12 fáciles + 12 difíciles + 1 comentario de texto) con: tipo,
dificultad, formato, enunciado, respuesta canónica + alias (abiertos) o 6 opciones
con distractores plausibles (opción múltiple) o conjunto de opciones correctas
(selección múltiple).

### Fase 2 — App
Front-end + Worker + D1 según §4.

### Fase 3 — Piloto (100-150 respuestas)
Objetivos:
- **Reetiquetar la dificultad** según el % de acierto real. Es probable que haya
  sorpresas, y esas sorpresas son material para el paper.
- Revisar/sustituir ítems con discriminación baja o dificultad extrema.
- Afinar las listas de alias con las respuestas reales.
- Medir tiempo real de cumplimentación y tasa de abandono por posición.

### Fase 4 — Lanzamiento
Objetivo: **≥300-400 sesiones**. Con un banco fijo de 25 ítems, todas las sesiones ven
los mismos ítems: se necesitan ≥100 respuestas por ítem para calibrarlo.

### Fase 5 — Análisis y publicación

---

## 7. Plan de análisis

### 7.1 Limitación central: representatividad

Una muestra autoseleccionada difundida por redes **no es representativa** y no puede
serlo. Sobrerrepresenta masivamente a titulados universitarios e interesados en
humanidades. En el eje de la edad es aún peor: los mayores de 65 que contestan
cuestionarios online son un subconjunto muy atípico de su cohorte.

**Estrategia adoptada — combinación de (1) y (2):**

1. **Honestidad + análisis relativo.** No reportar medias absolutas ("los españoles
   sacan un 6,2") sino **comparaciones internas condicionadas**: diferencias por edad
   *dentro del mismo nivel educativo*. Mucho más defendible y sigue siendo interesante.
2. **Post-estratificación.** Ponderar (raking / MRP) contra los marginales de edad, sexo,
   nivel de estudios y CCAA del padrón y la EPA. No corrige el sesgo de selección dentro
   de cada celda, pero sí el grosero. **Esto exige que las categorías demográficas sean
   compatibles con el INE desde el primer día — es la decisión que no se puede corregir
   a posteriori.**

### 7.2 Métodos

- **Nivel ítem (protagonista del estudio):** % de acierto por ítem × cohorte de edad,
  condicionado a nivel de estudios. Es el resultado principal y el titular del blog.
- **Nivel persona:** TRI con modelo **2PL** (paquete `mirt` en R), no puntuación bruta.
  Da una escala de habilidad comparable aunque los participantes hayan visto ítems
  distintos, que es exactamente lo que requiere el muestreo aleatorizado. Usar **3PL**
  si se calibran juntos abiertos y opción múltiple, para absorber el pseudo-azar.
- **Fiabilidad:** alfa de Cronbach por nivel de dificultad (fáciles / difíciles).
- **DIF (funcionamiento diferencial del ítem)** por sexo y por cohorte: si un ítem
  funciona distinto en mayores y jóvenes a igual nivel general, **eso es el efecto
  cohorte hecho visible**, y es material central para el paper.
- **Análisis de abandono:** quién abandona y en qué posición del test. Es un dato
  observado, no ruido.

---

## 8. Notas para Claude Code

- `data/items.json` es la **fuente de verdad**. El front-end no debe contener enunciados
  ni respuestas hardcodeadas.
- Escribir el validador de invariantes (§4.2) como test que corre en CI. Con 25 ítems
  redactados a mano, los errores de estructura son inevitables.
- La corrección de respuestas abiertas debe vivir en el Worker y ser **testeable de forma
  aislada**, con una batería de casos por ítem (variantes con y sin acentos, erratas,
  respuestas parciales, respuestas cercanas pero incorrectas).
- Móvil primero: la mayoría de las respuestas llegarán desde el teléfono. Una pregunta
  por pantalla, barra de progreso, campos de texto con el teclado adecuado
  (`inputmode="numeric"` para años y números).
- No usar `localStorage` para nada que deba ser autoritativo (el sorteo de ítems y la
  corrección viven en el servidor); solo para reanudar la sesión.