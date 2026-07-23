# Test de Cultura General — Estudio sobre la transmisión de la cultura básica occidental

Estudio observacional sobre el nivel de cultura general básica en la población española, 
segmentado por edad, sexo, nivel de estudios y profesión.

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


### 1.2 Bloques temáticos (10)

1. Filosofía
2. Historia
3. Lengua y Literatura
4. Física y Química
5. Biología y Geología
6. Economía y Política
7. Geografía
8. Matemáticas
9. Arte
10. Religión

**12 ítems/preguntas por bloque = 120 ítems en el banco.**

Dentro de los bloques anteriores se incluyen también, en el hueco que mejor
encaja temáticamente, algunos ítems de disciplinas que de otro modo quedarían
sin ningún ítem propio: **Derecho** (en Economía y Política), **Psicología**
(en Filosofía), **Medicina** (en Biología y Geología) y **Tecnología** (en
Física y Química). No constituyen bloques nuevos ni cambian el reparto por
bloque; son ítems más dentro del bloque que mejor los acoge.

### 1.3 Niveles de dificultad

Cada ítem se etiqueta como `facil`, `medio` o `dificil`.
Distribución objetivo por bloque: 4 / 4 / 4.

- Los ítems **fáciles** existen para documentar el efecto techo: son "mínimos absolutos"
  que una persona de cultura normal debería acertar. Su unidad de análisis es el **ítem**,
  no la persona ("el X% de los mayores de 60 sabe quién pintó Las Meninas frente al Y%
  de los menores de 30"). Sirve como titular del estudio.
- Los ítems **difíciles** existen para generar varianza y permitir modelar edad × estudios
  a nivel individual.

> **Regla de análisis: NO agregar los tres niveles en una única nota global.**
> Son dos estudios distintos conviviendo en el mismo instrumento. Se reportan por separado.

**Las etiquetas de dificultad a priori son provisionales.** Está documentado que quien
redacta un test estima mal la dificultad de sus propios ítems. Tras el piloto se
**reetiquetan según el porcentaje de acierto real**.

### 1.4 Modo corto y modo completo

**Todo el mundo hace primero el modo corto de 30 ítems.** Al terminar, se muestra el
resultado y se ofrece continuar con los 90 restantes.

> **No se ofrece la elección al principio.** Si el usuario elige entre "30" y "120" al
> entrar, la elección está correlacionada con conocimiento y motivación, y las dos
> submuestras dejan de ser comparables. Ofrecer la continuación *después* de terminar los
> 30 resuelve esto: se obtienen datos del núcleo de todos los participantes, sube la tasa
> de entrada, y la decisión de continuar se convierte en un **dato observado** en lugar de
> un sesgo invisible.

**Composición del modo corto (30 ítems, 3 por bloque):**

| Por cada bloque | Cantidad | Selección |
|---|---|---|
| Ítem de dificultad **media** | 1 | **Fijo** (ancla) |
| Ítem de dificultad **fácil** | 1 | Aleatorio |
| Ítem de dificultad **difícil** | 1 | Aleatorio |

Los **10 ítems fijos son el conjunto de anclaje**: permiten poner en la misma escala a
quien contestó 30 y a quien contestó 100. Se eligen de dificultad **media** a propósito:
un ítem que acierta el 95% no ancla nada porque no discrimina en el rango donde está
casi toda la muestra.

### 1.5 Formato de respuesta: mixto

- **Texto libre** cuando el espacio de respuestas es **cerrado y corto**: un año, un
  nombre propio, un número, una palabra. Mide **recuerdo**, elimina el azar, y un campo
  vacío significa inequívocamente "no lo sé".
- **Opción múltiple (6 opciones)** para todo lo demás, y **obligatoriamente** para
  definiciones y comparaciones ("¿qué es la refracción?", "¿qué diferencia hay entre
  agnosticismo y ateísmo?"). En texto libre esas producen miles de párrafos que habría
  que codificar a mano, lo que mataría el proyecto.
- **Ordenar (drag-and-drop)** para ítems de secuencia/cronología (p.ej. ordenar
  compositores o estilos artísticos de más antiguo a más moderno). El usuario arrastra
  cajitas en vez de elegir entre listas completas ya ordenadas como opciones de MC —
  evita el problema de legibilidad en móvil de leer 6 permutaciones enteras. La
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
- **No sumar formatos en una misma puntuación bruta.** Un ítem `opcion_multiple` tiene
  suelo de azar (16,7% con 6 opciones); un ítem `abierto` no tiene suelo; un ítem
  `ordenar` tampoco (el azar de acertar una permutación completa de 6 al azar es
  ~0,14%), ni un ítem `clasificar` (el azar de acertar una asignación completa de
  varios elementos a varias categorías es igual de despreciable), así que a efectos de
  TRI se tratan junto con `abierto` (sin parámetro de pseudo-azar) en vez de junto con
  `opcion_multiple`. Para calibrarse todos juntos se usa TRI 3PL, que absorbe el suelo
  de MC en el parámetro de pseudo-azar.
- Los distractores de los ítems de opción múltiple deben ser **plausibles**. Seis
  opciones donde cinco son absurdas equivalen a una pregunta de dos opciones. 

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
| `pais_nacimiento` | Cerrado + otros | Imprescindible: la inmigración distorsiona todo lo canónico |
| `ccaa_nacimiento` | Cerrado (19) | Solo si nació en España |
| `ccaa_residencia` | Cerrado (19) | Puede diferir de la anterior |
| `nivel_estudios` | Cerrado | **Categorías CINE/ISCED del INE**: sin estudios / primaria / ESO / bachillerato / FP grado medio / FP grado superior / grado o licenciatura / máster / doctorado |
| `area_estudios` | Cerrado (~6) | Artes y humanidades / Ciencias sociales y jurídicas / Ciencias / Ingeniería y arquitectura / Ciencias de la salud / No aplica. **No texto libre.** |
| `profesion` | Cerrado (~10) | **CNO-11 a 1 dígito** (9 grandes grupos + estudiante/desempleado/jubilado). Texto libre condenaría a codificar miles de respuestas a mano. |
| `estudios_padre` | Cerrado | Mismas categorías que `nivel_estudios` |
| `estudios_madre` | Cerrado | Ídem |
| `libros_en_casa` | Cerrado (5) | Nº aproximado de libros en casa a los 15 años (0-10 / 11-25 / 26-100 / 101-200 / +200). **Indicador estándar de PISA**, muy predictivo y bien recordado. |
| `frecuencia_lectura` | Cerrado | |
| `consumo_informativos` | Cerrado | |
| `horas_redes_dia` | Cerrado | |

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
- **Aleatorizar el orden de los bloques.** Si Arte siempre va al final, el cansancio se
  disfraza de ignorancia sobre arte.
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
│   ├── items/            # Banco de ítems, un JSON por ítem, en carpetas por bloque (fuente de verdad)
│   ├── items.json         # Generado: `npm run build:items` fusiona data/items/
│   ├── build-items.mjs
│   ├── build-debug.mjs    # Genera data/debug.html — `npm run build:debug` (ver §4.4)
│   ├── debug.html         # Generado: web de debug autocontenida, no se edita a mano
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
  completo_corto    INTEGER DEFAULT 0,       -- terminó los 30
  acepto_extension  INTEGER,                 -- NULL si no llegó a la oferta
  completo_largo    INTEGER DEFAULT 0,       -- terminó los 120 (30 + 90)
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

-- Idempotencia real de POST /api/respuesta (§4.3): el Worker hace
-- INSERT ... ON CONFLICT(sesion_id, item_id) DO UPDATE, así que un reintento de
-- red tras un timeout nunca duplica la respuesta a un mismo ítem.
CREATE UNIQUE INDEX idx_respuestas_sesion_item ON respuestas(sesion_id, item_id);

-- Persiste el sorteo de ítems hecho en el servidor: "el sorteo de ítems se hace
-- en el servidor y se persiste, para que recargar la página no cambie el set"
-- (§4.3). No contiene contenido de ítems, solo el id: el contenido vive
-- únicamente en data/items.json, que el Worker importa como módulo estático
-- (§4.2) — D1 nunca se usa como copia del banco de ítems, así que editar un
-- ítem y regenerar data/items.json no requiere ninguna migración de datos.
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
```

### 4.2 Formato del banco de ítems (`data/items.json`)

```jsonc
[
  {
    "id": "HIS-01",
    "bloque": "historia",
    "dificultad": "facil",          // facil | medio | dificil
    "ancla": false,                  // true en los 10 ítems fijos (uno por bloque, medio)
    "formato": "abierto",            // abierto | opcion_multiple | ordenar | clasificar
    "enunciado": "¿En qué año llegó Cristóbal Colón a América?",
    "respuesta_canonica": "1492",
    "alias": ["1492", "año 1492", "1.492"],
    "alias_parcial": null,           // opcional: respuestas de conocimiento parcial (§1.6)
    "tolerancia_edicion": 0,         // 0 para números y respuestas cortas
    "opciones": null,
    "indice_correcto": null
  },
  {
    "id": "FIS-07",
    "bloque": "fisica_quimica",
    "dificultad": "medio",
    "ancla": true,
    "formato": "opcion_multiple",
    "enunciado": "¿Qué es la refracción?",
    "opciones": [
      "El cambio de dirección de una onda al pasar de un medio a otro",
      "…", "…", "…", "…", "…"
    ],
    "indice_correcto": 0,
    "respuesta_canonica": null,
    "alias": null
  },
  {
    "id": "ART-01",
    "bloque": "arte",
    "dificultad": "dificil",
    "ancla": false,
    "formato": "ordenar",
    "enunciado": "Ordena estos compositores de más antiguo a más moderno:",
    "elementos": ["Beethoven", "Bach", "Brahms", "Haydn", "Mozart", "Schubert"],
    "elementos_ordenados": ["Bach", "Haydn", "Mozart", "Beethoven", "Schubert", "Brahms"],
    "respuesta_canonica": null,
    "alias": null,
    "opciones": null,
    "indice_correcto": null
  },
  {
    "id": "FIL-06",
    "bloque": "filosofia",
    "dificultad": "medio",
    "ancla": true,
    "formato": "clasificar",
    "enunciado": "Clasifica a cada filósofo según la corriente ética que defendió:",
    "categorias": ["Utilitarismo", "Deontología", "Ética de la virtud", "Estoicismo"],
    "elementos": ["Kant", "Séneca", "Bentham", "Aristóteles", "Epicteto", "Stuart Mill", "Tomás de Aquino"],
    "clasificacion_correcta": {
      "Kant": "Deontología",
      "Séneca": "Estoicismo",
      "Bentham": "Utilitarismo",
      "Aristóteles": "Ética de la virtud",
      "Epicteto": "Estoicismo",
      "Stuart Mill": "Utilitarismo",
      "Tomás de Aquino": "Ética de la virtud"
    },
    "respuesta_canonica": null,
    "alias": null,
    "opciones": null,
    "indice_correcto": null
  }
]
```

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
acierto.

**Invariantes que el código debe validar al arrancar:**
- Exactamente 10 bloques × 12 ítems.
- Exactamente 1 ítem con `ancla: true` por bloque, y su `dificultad` debe ser `medio`.
- Todo ítem `opcion_multiple` tiene exactamente 6 opciones e `indice_correcto` válido.
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
- Ítems `abierto` ≤ 50% del total por bloque (`ordenar` y `clasificar` no cuentan para
  este tope, ver §1.5).
- 4 fáciles, 4 medias y 4 difíciles.

### 4.3 Endpoints del Worker

```
POST /api/sesion            → crea sesión, devuelve id + set de ítems sorteado
POST /api/respuesta         → guarda una respuesta (idempotente por sesion_id+item_id)
POST /api/extender          → registra aceptación/rechazo y devuelve los 90 restantes
GET  /api/resultado/:id     → devuelve el resultado de esa sesión
GET  /api/export?token=…    → volcado CSV/JSON (protegido con secreto en env)
```

Notas de implementación:
- El sorteo de ítems se hace **en el servidor** y se persiste (tabla `sesion_items`,
  §4.1), para que recargar la página no cambie el set y no se pueda "rerodar" hasta
  obtener preguntas fáciles. `POST /api/sesion` y `POST /api/extender` son idempotentes
  respecto al sorteo: si la sesión ya tiene un sorteo persistido para esa fase, se
  devuelve el mismo en vez de generar uno nuevo.
- `GET /api/resultado/:id` tiene dos formas de respuesta según el estado de la sesión:
  si `completo_corto=0` (test en curso, típicamente tras recargar la página o volver
  más tarde), devuelve `{ estado: 'en_progreso', fase_actual, items_pendientes }` en
  vez de un resultado, para que el cliente pueda **reanudar sin volver a sortear nada
  en el propio front-end** — el `localStorage` del cliente solo necesita guardar el
  `sesion_id` (§8), nunca qué ítems tocan ni en qué orden. Si la sesión está completa
  (o al menos completó el modo corto), devuelve los agregados de resultado.
- **Las respuestas correctas nunca se envían al cliente** antes de que el ítem se
  conteste. La corrección ocurre en el Worker. Para ítems `ordenar`, esto significa que
  `elementos_ordenados` no se envía al cliente hasta contestar; solo se envía
  `elementos` (el orden de presentación, ya desordenado en los datos). Análogamente,
  para ítems `clasificar` no se envía `clasificacion_correcta` hasta contestar; solo se
  envían `categorias` y `elementos`.
- Rate limiting básico por IP para evitar envíos automatizados; la IP **no se almacena**.

### 4.4 Web de debug de ítems (`data/debug.html`)

Mientras se redacta el banco (Fase 1), antes de que exista el Worker/front-end
definitivo, hace falta poder revisar visualmente cada ítem tal y como se vería en
la app real y comprobar que la corrección automática lo clasifica como se espera.
Para eso existe `data/debug.html`: una página **autocontenida** (HTML+CSS+JS
embebidos, sin llamadas de red ni dependencias) generada por
`data/build-debug.mjs` a partir de los ficheros en `data/items/<bloque>/*.json`.

Se puede abrir directamente con doble clic (`file://…`) o descargarse y probarse
en cualquier navegador, sin servidor.

Qué muestra, por bloque y por ítem:
- Las preguntas agrupadas por bloque y renderizadas como en la web definitiva
  (texto libre, opción múltiple de 6 opciones, ordenar por arrastre, clasificar en
  cajas por arrastre).
- Metadatos que la web de usuario **nunca** mostrará: id del ítem, dificultad,
  formato y si es el ítem `ancla` del bloque.
- Estadísticas por bloque: nº de ítems por dificultad y por formato, y cuál es
  el ancla.
- Un botón **"Comprobar todo"** que aplica el algoritmo de corrección del §1.6
  (normalización, Levenshtein, alias/alias_parcial) y anota cada ítem como
  acierto / fallo / parcial / sin responder, con el alias que hizo match y la
  distancia — para verificar que la política de corrección de cada ítem hace lo
  que se pretendía.

**Los bloques o ítems que aún no están redactados (carpeta con solo
`.gitkeep`) no aparecen y no producen error** — es el estado esperado mientras el
banco se completa bloque a bloque.

**Regenerar tras cualquier cambio en `data/items/`:**

```bash
npm run build:debug
```

Este comando lee de nuevo todos los JSON de `data/items/<bloque>/` y sobrescribe
`data/debug.html`. `data/debug.html` es un **artefacto generado** (como
`data/items.json`): no se edita a mano, se regenera cada vez que se añade,
corrige o completa un ítem. Conviene tenerlo abierto en el navegador con
recarga automática (o simplemente refrescar la pestaña) mientras se va
ejecutando `npm run build:debug` en la redacción de cada nuevo ítem.

### 4.5 Despliegue manual a Cloudflare

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
`data/items/<bloque>/*.json` (§4.2, §8):

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
Redactar los 120 ítems con: bloque, dificultad a priori, formato, enunciado,
respuesta canónica + alias (abiertos) o 6 opciones con distractores plausibles.
Empezar por Filosofía e Historia y validar el estilo antes de continuar.

### Fase 2 — App
Front-end + Worker + D1 según §4.

### Fase 3 — Piloto (100-150 respuestas)
Objetivos:
- **Reetiquetar la dificultad** según el % de acierto real. Es probable que haya
  sorpresas, y esas sorpresas son material para el paper.
- Eliminar ítems con discriminación baja o dificultad extrema.
- Afinar las listas de alias con las respuestas reales.
- Medir tiempo real de cumplimentación y tasa de abandono por posición.

### Fase 4 — Lanzamiento
Objetivo: **≥300-400 sesiones**. Con 10 bloques × 3 niveles y sorteo aleatorio, cada
ítem no fijo aparece en ~1/4 de las sesiones del modo corto; se necesitan ≥100 respuestas
por ítem para calibrarlo.

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
- **Fiabilidad:** alfa de Cronbach por bloque.
- **DIF (funcionamiento diferencial del ítem)** por sexo y por cohorte: si un ítem
  funciona distinto en mayores y jóvenes a igual nivel general, **eso es el efecto
  cohorte hecho visible**, y es material central para el paper.
- **Análisis de abandono:** quién abandona, en qué posición, y quién acepta la extensión
  a 120 ítems. Es un dato observado, no ruido.

---

## 8. Notas para Claude Code

- `data/items.json` es la **fuente de verdad**. El front-end no debe contener enunciados
  ni respuestas hardcodeadas.
- Escribir el validador de invariantes (§4.2) como test que corre en CI. Con 120 ítems
  redactados a mano, los errores de estructura son inevitables.
- La corrección de respuestas abiertas debe vivir en el Worker y ser **testeable de forma
  aislada**, con una batería de casos por ítem (variantes con y sin acentos, erratas,
  respuestas parciales, respuestas cercanas pero incorrectas).
- Móvil primero: la mayoría de las respuestas llegarán desde el teléfono. Una pregunta
  por pantalla, barra de progreso, campos de texto con el teclado adecuado
  (`inputmode="numeric"` para años y números).
- No usar `localStorage` para nada que deba ser autoritativo (el sorteo de ítems y la
  corrección viven en el servidor); solo para reanudar la sesión.