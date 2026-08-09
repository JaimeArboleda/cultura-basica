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
> (El banco tuvo originalmente un tercer nivel, `medio`: se eliminó porque en la
> práctica esos ítems no cumplían ninguno de los dos papeles — ni suficientemente
> fáciles para ser titular, ni suficientemente difíciles para discriminar.)

**Las etiquetas de dificultad a priori son provisionales.** Está documentado que quien
redacta un test estima mal la dificultad de sus propios ítems. Tras el piloto se
**reetiquetan según el porcentaje de acierto real**.

### 1.4 Un único test fijo (25 ítems)

**Todo el mundo hace el mismo test: los 25 ítems del banco, sin sorteo de
contenido.** No hay banco de reserva ni fase de extensión: el banco entero es el
test. Lo único que se aleatoriza es el **orden de presentación** (§3).

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
  El banco actual de 25 ítems no incluye ninguno de este formato, pero el código lo
  sigue soportando end-to-end.

Restricciones:
- **Máximo ~40% de ítems `abierto`**, repartidos a lo largo del test (no agrupados).
  Escribir en el móvil tiene coste y aumenta el abandono. Los ítems `ordenar` y
  `clasificar` **no cuentan para este tope**: no hay tecleo, el coste de fricción es
  más parecido al de MC.
- **No sumar formatos en una misma puntuación bruta.** Un ítem `opcion_multiple` tiene
  suelo de azar (16,7% con 6 opciones); un ítem `abierto` no tiene suelo; un ítem
  `ordenar` tampoco (el azar de acertar una permutación completa al azar es
  despreciable), ni un ítem `clasificar` ni `seleccion_multiple` (el azar de acertar
  una selección exacta entre varias opciones también lo es), así que a efectos de TRI
  se tratan junto con `abierto` (sin parámetro de pseudo-azar) en vez de junto con
  `opcion_multiple`. Para calibrarse todos juntos se usa TRI 3PL, que absorbe el suelo
  de MC en el parámetro de pseudo-azar.
- Los distractores de los ítems de opción múltiple y selección múltiple deben ser
  **plausibles**. Seis opciones donde cinco son absurdas equivalen a una pregunta de
  dos opciones.

**Puntuación mostrada al usuario:** el Worker calcula internamente una puntuación
ponderada (peso 4 por acierto fácil, 2 por acierto difícil, 3 por el comentario de
texto — ver `worker/src/puntuacion.ts`), pero **nunca se le enseña esa cifra en
bruto**. Al terminar el test, la única cifra que se muestra es el **percentil**
empírico frente a las demás sesiones ya completadas (§3, `GET /api/resultado/:id`):
una pequeña recompensa simbólica, no un resultado analítico. El análisis real usa la
respuesta cruda por ítem, no esta puntuación ponderada (§7).

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
- **Aleatorizar el orden de presentación de los 25 ítems.** Si un ítem concreto siempre
  va al final, el cansancio se disfraza de ignorancia sobre ese tema.
- **Guardar cada respuesta según se envía**, no al final. Los abandonos son un dato en
  sí mismo y deben quedar registrados.
- **Sin navegación hacia atrás**: evita revisar respuestas tras haber visto pistas en
  ítems posteriores.
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
│   ├── index.html       # App autocontenida
│   ├── app.js
│   └── styles.css
├── worker/              # Cloudflare Worker (API)
│   ├── src/index.ts
│   └── wrangler.toml
├── data/
│   ├── items/            # Banco de ítems, un JSON por ítem, en faciles/dificiles/comentario_texto (fuente de verdad)
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
CREATE TABLE sesiones (
  id                TEXT PRIMARY KEY,        -- UUID generado en cliente
  creada_en         TEXT NOT NULL,           -- ISO 8601 UTC
  actualizada_en    TEXT,
  consentimiento    INTEGER NOT NULL,        -- 0/1
  compromiso_honestidad INTEGER NOT NULL,
  completo          INTEGER DEFAULT 0,       -- terminó los 25 ítems
  -- Puntuación ponderada interna (0-75, peso 4/2/3 fácil/difícil/comentario de texto,
  -- ver worker/src/puntuacion.ts). Nunca se muestra al usuario: solo sirve para
  -- calcular el percentil de la pantalla de resultado (§1.5, §4.3).
  puntuacion_ponderada REAL,
  user_agent_clase  TEXT,                    -- 'movil' | 'escritorio' (no UA completo)
  -- demografía
  anio_nacimiento   INTEGER,
  sexo              TEXT,
  ccaa_educacion_secundaria TEXT,
  nivel_estudios    TEXT,
  area_estudios     TEXT,
  estudios_mayor_progenitor TEXT,
  libros_en_casa    TEXT
);

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

```jsonc
[
  {
    "id": "F02",
    "tipo": "trivia",                // trivia | comentario_texto
    "dificultad": "facil",           // facil | dificil | null (null solo si tipo=comentario_texto)
    "formato": "abierto",            // abierto | opcion_multiple | seleccion_multiple | ordenar | clasificar
    "enunciado": "¿Quién reinaba en Castilla cuando Cristóbal Colón llegó a América?",
    "texto": null,                   // opcional: pasaje de 2-3 párrafos (tipo comentario_texto, ver más abajo)
    "respuesta_canonica": "Isabel la Católica",
    "alias": ["isabel la catolica", "isabel i", "isabel i de castilla"],
    "alias_parcial": null,           // opcional: respuestas de conocimiento parcial (§1.6)
    "tolerancia_edicion": 1,
    "opciones": null,
    "indice_correcto": null,
    "opciones_correctas": null
  },
  {
    "id": "D04",
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
    "id": "D06",
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
    "id": "F03",
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
    "id": "CT-01",
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
aparte con su propio peso en la puntuación interna (§1.5).

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
acierto. El banco actual no incluye ningún ítem de este formato (§1.5).

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
  una apuntando a una categoría existente, y con las `categorias` usadas al menos una
  vez cada una.

### 4.3 Endpoints del Worker

```
POST /api/sesion            → crea sesión, devuelve id + los 25 ítems en orden aleatorio
POST /api/respuesta         → guarda una respuesta (idempotente por sesion_id+item_id)
GET  /api/resultado/:id     → devuelve el resultado de esa sesión
GET  /api/export?token=…    → volcado CSV/JSON (protegido con secreto en env)
```

Notas de implementación:
- El orden de presentación se decide **en el servidor** y se persiste (tabla
  `sesion_items`, §4.1), para que recargar la página no cambie el orden.
  `POST /api/sesion` es idempotente: si la sesión ya existe, no se puede volver a
  llamar (cada sesión se crea una sola vez); reanudar usa `GET /api/resultado/:id`.
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