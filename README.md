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

**10 ítems/preguntas por bloque = 100 ítems en el banco.**

### 1.3 Niveles de dificultad

Cada ítem se etiqueta como `facil`, `medio` o `dificil`.
Distribución objetivo por bloque: 4 / 3 / 3.

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
resultado y se ofrece continuar con los 70 restantes.

> **No se ofrece la elección al principio.** Si el usuario elige entre "30" y "100" al
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

Restricciones:
- **Máximo ~40% de ítems abiertos**, repartidos a lo largo del test (no agrupados).
  Escribir en el móvil tiene coste y aumenta el abandono.
- **No sumar formatos en una misma puntuación bruta.** Un ítem abierto y uno de 6
  opciones no valen lo mismo: el segundo tiene suelo del 16,7%. Para calibrarse juntos se usa TRI 
  (que absorbe esto en el parámetro de pseudo-azar).
- Los distractores de los ítems de opción múltiple deben ser **plausibles**. Seis
  opciones donde cinco son absurdas equivalen a una pregunta de dos opciones. 

### 1.6 Corrección automática del texto libre

Pipeline por ítem:

1. Normalización: minúsculas, eliminar acentos/diacríticos, quitar signos de puntuación,
   colapsar espacios, recortar.
2. Comparación contra una **lista de alias** definida por ítem.
   Ej.: `Platón` acepta `platon`, `plato`, `platon de atenas`.
3. Tolerancia de **distancia de edición (Levenshtein) de 1-2** para erratas, ajustada a
   la longitud de la respuesta canónica (no aplicar a respuestas de ≤4 caracteres).
4. Lo que no empareje queda marcado como `pendiente_revision`.

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
│   └── items.json       # Banco de 100 ítems (fuente de verdad)
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
  acierto           INTEGER,                 -- 0/1/NULL(pendiente_revision)
  estado_correccion TEXT DEFAULT 'auto',     -- 'auto'|'pendiente_revision'|'manual'
  t_ms              INTEGER,
  orden_presentacion INTEGER,
  perdio_foco       INTEGER DEFAULT 0,
  enviada_en        TEXT NOT NULL
);

CREATE INDEX idx_respuestas_sesion ON respuestas(sesion_id);
CREATE INDEX idx_respuestas_item   ON respuestas(item_id);
```

### 4.2 Formato del banco de ítems (`data/items.json`)

```jsonc
[
  {
    "id": "HIS-01",
    "bloque": "historia",
    "dificultad": "facil",          // facil | medio | dificil
    "ancla": false,                  // true en los 10 ítems fijos (uno por bloque, medio)
    "formato": "abierto",            // abierto | opcion_multiple
    "enunciado": "¿En qué año llegó Cristóbal Colón a América?",
    "respuesta_canonica": "1492",
    "alias": ["1492", "año 1492", "1.492"],
    "tolerancia_edicion": 0,         // 0 para números y respuestas cortas
    "opciones": null,
    "indice_correcto": null,
    "fuente_nota": ""
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
  }
]
```

**Invariantes que el código debe validar al arrancar:**
- Exactamente 10 bloques × 10 ítems.
- Exactamente 1 ítem con `ancla: true` por bloque, y su `dificultad` debe ser `medio`.
- Todo ítem `opcion_multiple` tiene exactamente 6 opciones e `indice_correcto` válido.
- Todo ítem `abierto` tiene `respuesta_canonica` y al menos un alias.
- Ítems abiertos ≤ 50% del total.
- 4 fáciles, 3 medias y 3 difíciles.

### 4.3 Endpoints del Worker

```
POST /api/sesion            → crea sesión, devuelve id + set de ítems sorteado
POST /api/respuesta         → guarda una respuesta (idempotente por sesion_id+item_id)
POST /api/extender          → registra aceptación/rechazo y devuelve los 70 restantes
GET  /api/resultado/:id     → devuelve el resultado de esa sesión
GET  /api/export?token=…    → volcado CSV/JSON (protegido con secreto en env)
```

Notas de implementación:
- El sorteo de ítems se hace **en el servidor** y se persiste, para que recargar la
  página no cambie el set y no se pueda "rerodar" hasta obtener preguntas fáciles.
- **Las respuestas correctas nunca se envían al cliente** antes de que el ítem se
  conteste. La corrección ocurre en el Worker.
- Rate limiting básico por IP para evitar envíos automatizados; la IP **no se almacena**.

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
Redactar los 100 ítems con: bloque, dificultad a priori, formato, enunciado,
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
ítem no fijo aparece en ~1/3 de las sesiones del modo corto; se necesitan ≥100 respuestas
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
  a 100 ítems. Es un dato observado, no ruido.

---

## 8. Notas para Claude Code

- `data/items.json` es la **fuente de verdad**. El front-end no debe contener enunciados
  ni respuestas hardcodeadas.
- Escribir el validador de invariantes (§4.2) como test que corre en CI. Con 100 ítems
  redactados a mano, los errores de estructura son inevitables.
- La corrección de respuestas abiertas debe vivir en el Worker y ser **testeable de forma
  aislada**, con una batería de casos por ítem (variantes con y sin acentos, erratas,
  respuestas parciales, respuestas cercanas pero incorrectas).
- Móvil primero: la mayoría de las respuestas llegarán desde el teléfono. Una pregunta
  por pantalla, barra de progreso, campos de texto con el teclado adecuado
  (`inputmode="numeric"` para años y números).
- No usar `localStorage` para nada que deba ser autoritativo (el sorteo de ítems y la
  corrección viven en el servidor); solo para reanudar la sesión.