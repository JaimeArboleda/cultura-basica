# Fixtures de prueba para el pipeline de digitalización en papel

Este directorio contiene hojas de respuestas ya rellenadas de forma
sintética, para poder probar el pipeline de digitalización (README del
proyecto §4.7) sin imprimir hojas de verdad ni depender de voluntarios.

El pipeline actual genera la hoja como PDF con `pdf-lib`
(`public/admin/papel/hoja.js`) y la lee entera con un modelo de visión de
OpenAI (`worker/src/endpoints/admin/ocrIa.ts`), sin DOM, Tesseract ni OMR de
por medio (versiones anteriores del pipeline se retiraron; `git log`
conserva el diseño si hace falta consultarlo).

## `generar.mjs` — genera las instancias

```
node ocr_tests/generar.mjs
```

Para cada "persona" (perfil de quien rellena la hoja, definidas en
`PERSONAS` dentro del script) genera una carpeta `ocr_tests/<persona-id>/`
con:

- `pagina-NN.jpg`: cada página de la hoja, ya "rellenada" con tinta
  sintética dibujada directamente sobre las casillas reales por
  `hoja.js::construirHoja` (mismo mecanismo que produce la hoja en blanco,
  con un parámetro extra que solo usa este script) y con un efecto de
  escaneo/foto ligero (rotación, ruido, desenfoque) aplicado en un
  `<canvas>` vía Playwright/Chromium.
- `hoja-completa.pdf`: las mismas páginas, en orden, como un único PDF
  (simula el caso "escáner de sobremesa" de la subida en bloque, README
  §4.10).
- `subida-en-bloque/foto-NN.jpg`: las mismas páginas, sueltas y barajadas
  (simula fotos de móvil subidas sin orden).
- `respuestas-esperadas.json`: la respuesta definitiva de cada ítem y de
  cada campo de demografía según el propio plan de la persona, aplicando la
  misma precedencia Respuesta/Corrección que usa la lectura real — sirve
  para comparar contra lo que devuelve la API en `probar_ocr_ia.mjs`.

Las personas actuales cubren, deliberadamente, los fallos reportados en
producción: letra muy clara con todos los campos censales (para comprobar
que ya no se pierden), corrección de una respuesta previa (precedencia
Respuesta/Corrección), valores fuera de formato en una casilla de una sola
letra (p. ej. escribir "B) La" en vez de "B") y respuestas abiertas
incompletas, y letra descuidada con foto más ruidosa y campos en blanco.

Necesita red (descarga 3 fuentes de imitación manuscrita desde el espejo de
Google Fonts en jsdelivr en cada ejecución) pero no ninguna API key.

## `probar_ocr_ia.mjs` — prueba contra la API real de OpenAI

```
CULTURA_BASICA_API_BASE=http://127.0.0.1:8787 \
CULTURA_BASICA_ADMIN_TOKEN=<token de sesión de admin> \
node ocr_tests/probar_ocr_ia.mjs
```

Manda cada instancia generada por `generar.mjs` al Worker real
(`POST /api/admin/ocr-ia`, y luego `POST /api/admin/digitalizacion` para
probar también el extremo a extremo), compara el resultado contra
`respuestas-esperadas.json` y muestra un resumen de aciertos por instancia
(ítems y demografía por separado, con el detalle de cada fallo).

Usa la remesa de pruebas reservada (`tokens.es_prueba`, README del proyecto
§4.5) — la crea la primera vez si no existe — así que las sesiones que crea
quedan excluidas de `/api/admin/stats` sin ensuciar el dataset del piloto,
pero siguen siendo consultables filtrando explícitamente por esa remesa.

Variables de entorno:

- `CULTURA_BASICA_API_BASE` (obligatoria): URL base del Worker, p. ej.
  `http://127.0.0.1:8787` (`wrangler dev` local) o el `*.workers.dev`
  desplegado.
- `CULTURA_BASICA_ADMIN_TOKEN` (obligatoria): token de sesión de admin
  (`Authorization: Bearer …`) — se obtiene entrando al panel (`/admin`) y
  copiando `cb_admin_token` de `localStorage` tras iniciar sesión con
  Google.
- `CULTURA_BASICA_MODELO` (opcional, por defecto `gpt-5-mini`).
- `CULTURA_BASICA_PERSONAS` (opcional): lista separada por comas de
  carpetas de `ocr_tests/` a probar (por defecto, todas las que tengan
  `respuestas-esperadas.json`).

Deliberadamente **no** se ejecuta como parte de `npm test`: necesita red,
un Worker ya desplegado (o `wrangler dev` local) y una API key de OpenAI
real configurada en el Worker (gasta cuota real). Es un script aparte,
igual que `generar.mjs`.

Manda una llamada por página (nunca la hoja completa junta), igual que el
valor por defecto del selector de agrupación del panel — ver README del
proyecto §4.7 para por qué: medido con este mismo script, mandar todas las
páginas juntas mezclaba respuestas entre ellas con más frecuencia.

**Última corrida de referencia** (`gpt-5-mini`, 16 de agosto de 2026, contra
`wrangler dev` local): con el esquema restringido a enums/patterns (§4.7) y
las casillas de consentimiento/compromiso ya fuera del alcance de OCR-IA,
las 4 instancias crearon su sesión de extremo a extremo sin fallos:

| Instancia | Ítems | Demografía |
|---|---|---|
| `01-letra-clara` | 20/25 (80%) | 7/7 (100%) |
| `02-con-correcciones` | 18/23 (78%) | 7/7 (100%) |
| `03-valores-invalidos-e-incompletas` | 17/25 (68%) | 7/7 (100%) |
| `04-descuidada-ruidosa` | 15/23 (65%) | 6/6 (100%) |

Los fallos que quedan son casi todos de acento ("PLUSVALIA" en vez de
"PLUSVALÍA") o de espacios perdidos en respuestas largas de varias palabras
("ISABELDECASTILLAYFERNANDODEARAGON...") — `igual()` en este script compara
con igualdad estricta, más exigente que la tolerancia de edición real de
`worker/src/correccion.ts::corregirAbierto`, así que la precisión real de
puntuación es probablemente bastante mayor que estos porcentajes. El resto
son errores genuinos de lectura, incluido al menos un caso reproducible
donde el modelo no aplicó la precedencia Respuesta/Corrección en un
`clasificar` con una rejilla grande (9 casillas) — usó la fila "Respuesta"
(incorrecta) e ignoró la fila "Corrección" (100% correcta) que estaba justo
debajo, pese a que el prompt lo pide explícitamente.

**Dos bugs reales encontrados con esta batería, ya corregidos** (ninguno
era el motor de OCR-IA leyendo mal):

1. La fuente de tinta de `04-descuidada-ruidosa` era `Caveat[wght].ttf`,
   una fuente VARIABLE — `pdf-lib`/`fontkit` subsettean mal sus glifos con
   `embedFont(..., { subset: true })` y casi toda la tinta salía invisible
   en el PDF (una letra suelta, al azar, sí renderizaba). Antes de
   corregirlo esta instancia medía 6/23 (26%) ítems y 3/6 (50%) demografía
   — no porque el modelo leyera mal, sino porque la imagen que se le
   mandaba estaba casi en blanco. Cambiada a Gochi Hand (estática).
2. El ítem `02` tenía `casillasAbierto: 18` fijo (`hoja.js::
   CONFIG_POR_DEFECTO`) pero su `respuesta_canonica` completa ("Isabel de
   Castilla y Fernando de Aragón") ocupa 40 caracteres con espacios — no
   cabía físicamente en la fila de casillas impresa, **también en la hoja
   real**, no solo en estas fixtures: cualquiera que escribiera la
   respuesta completa y correcta no podía terminarla. Corregido calculando
   el nº de casillas por ítem a partir de la longitud de su
   `respuesta_canonica` (con margen), envolviendo a una segunda fila si
   hace falta (`construirFilaCasillas` ahora soporta múltiples filas).

Lección de ambos: antes de atribuir un fallo al motor de OCR-IA, comprobar
primero que la imagen de entrada tiene tinta visible y que la respuesta
correcta cabía físicamente en la casilla — inspeccionar el JPEG generado
antes de gastar cuota de la API.

## Rediseño de prompts/esquema para las páginas de ítems (16 de agosto de 2026)

La corrida de referencia de arriba seguía teniendo una tasa de fallo alta
para tratarse de un banco de solo 25 ítems. Dos sospechas de diseño, no de
lectura:

1. El esquema JSON exigía como clave `item.id` (p. ej. `"05"`), una
   numeración que el modelo nunca ve impresa en la hoja — el círculo junto a
   cada enunciado imprime el número SIN ceros a la izquierda
   (`hoja.js::construirEnunciado`, `String(numero)`). El modelo tenía que
   traducir mentalmente "círculo nº5" → clave `"05"` a partir del texto del
   prompt, un paso indirecto y una fuente de desalineación.
2. El modelo resolvía él mismo la precedencia Respuesta/Corrección para los
   ítems (no solo para demografía) — y la corrida anterior ya había cazado
   un caso reproducible donde lo hacía mal en un `clasificar` con rejilla
   grande (ver arriba).

Cambio (solo en las páginas de tipo `items`; demografía —100% de acierto—
no se ha tocado, `worker/src/endpoints/admin/ocrIa.ts::SYSTEM_PROMPT_DEMOGRAFIA`
sigue siendo literalmente el mismo prompt de antes):

- El esquema y el prompt de usuario ahora piden como clave el número de
  pregunta que el modelo lee impreso en el círculo (`SYSTEM_PROMPT_ITEMS`,
  `construirContenidoPagina`, `construirEsquemaCompleto`) — sin traducción.
- El modelo ya NO resuelve la precedencia: devuelve `respuesta_inicial` y
  `correccion` por separado para cada pregunta, y la resolución
  (¿tiene contenido el bloque Corrección? si sí, manda él entero; si no,
  manda Respuesta) se hace en código, determinista
  (`bloqueTieneContenido` en `ocrIa.ts`).

**Bug real encontrado y corregido durante esta misma batería** (antes de
las cifras finales de abajo): la primera versión del prompt para ítems
`abierto` ("respetando espacios en blanco si hay") hizo que el modelo
metiera un espacio entre CADA letra de respuestas de varias palabras —
p. ej. `"D I E G O V E L Á Z Q U E Z"` en vez de `"DIEGO VELÁZQUEZ"` — un
fallo real (la tolerancia de edición de `corregirAbierto` es 1, muy por
debajo de la distancia que introduce espaciar cada letra), no solo un
artefacto de comparación estricta. Corregido añadiendo una frase explícita:
"Entre casilla y casilla NO hay un espacio. Los espacios solo los dan las
casillas en blanco."

**Corrida con el nuevo diseño** (`gpt-5-mini`, mismo día, mismas 4
instancias, contra `wrangler dev` local):

| Instancia | Ítems (antes → ahora) | Demografía |
|---|---|---|
| `01-letra-clara` | 20/25 (80%) → **23/25 (92%)** | 7/7 (100%) |
| `02-con-correcciones` | 18/23 (78%) → **23/23 (100%)** | 7/7 (100%) |
| `03-valores-invalidos-e-incompletas` | 17/25 (68%) → **21/25 (84%)** | 7/7 (100%) |
| `04-descuidada-ruidosa` | 15/23 (65%) → **19/23 (83%)** | 6/6 (100%) |

Mejora en las 4 instancias (72.9% → 89.6% de acierto agregado en ítems), sin
tocar demografía (sigue en 100%). De los fallos que quedan, la mayoría siguen
siendo el mismo artefacto de siempre (acentos: `igual()` compara con
igualdad estricta, pero `correccion.ts::normalizar()` ya ignora acentos en
la puntuación real). Dos casos residuales para vigilar en próximas corridas,
ninguno de los dos sistemático (aparecen una vez cada uno en 4×25 ítems):

- Una respuesta de dos filas de casillas (solo le pasa hoy al ítem `02`, el
  único que necesita envolver a una segunda fila) volvió con un `\n` real
  dentro del string y sin espacio entre palabras — el prompt no dice nada
  sobre qué hacer al pasar de una fila a la siguiente.
- En la instancia con texto invertido sin sentido (`04-descuidada-ruidosa`,
  pensada para cazar que el modelo "corrija" en vez de transcribir), una
  respuesta volvió como la palabra real en vez de la cadena literal
  invertida que estaba escrita — la instrucción "reconstruye el texto"
  puede empujar en esa dirección para cadenas que no son palabras reales.

## Segunda ronda: esquema de "abierto" exacto, ground truth completo, tolerancia a espacios/acentos (16 de agosto de 2026)

Tras revisar página a página los fallos de la ronda anterior, varios cambios
más, todos verificados contra la API real:

1. **`respuestas-esperadas.json` incluye SIEMPRE los 25 ítems** (antes, un
   ítem que la persona dejaba en blanco se omitía del todo, así que ni
   sumaba ni restaba — `ocr_tests/generar.mjs::construirPlan`/
   `planDemografia` ahora escriben `null` en vez de omitir la clave). Esto
   cambia el denominador de todas las cifras de abajo respecto a la ronda
   anterior (antes 23 o 23 en vez de 25 para `02`/`04`) y, de paso, sacó a la
   luz un fallo real que antes quedaba invisible (ver más abajo,
   "alucinación en preguntas en blanco").
2. **Los acentos ya no cuentan como fallo** en la comparación de este script
   (`igual()` en `probar_ocr_ia.mjs`) — antes comparaba con igualdad
   estricta, más exigente que la puntuación real.
3. **Tolerancia a espacios de más o de menos entre palabras**, tanto en la
   puntuación real (`worker/src/correccion.ts::variantesSinEspacios`, nueva)
   como en la comparación de este script: cada alias se expande a todas sus
   variantes quitando cualquier subconjunto de sus espacios (2ⁿ variantes
   para n espacios) antes de comparar — "isabel y fernando" también acepta
   "isabely fernando", "isabel yfernando" e "isabelyfernando".
4. **El esquema de "abierto" ahora usa el nº EXACTO de casillas impresas**
   (`numCasillas`/`item.numCasillas`) en vez de un string libre — de paso se
   encontró y arregló un bug real independiente de OCR-IA: la hoja en
   producción (`GET /api/admin/items-impresion` → `paraCliente()`) nunca
   exponía `respuesta_canonica` al cliente (README §4.3, no debe revelar la
   respuesta correcta), así que `hoja.js` SIEMPRE caía al mínimo fijo de 18
   casillas pese a la corrección de la ronda de bugs anterior — el cálculo
   dinámico solo funcionaba en los scripts de `ocr_tests/`, que cargan el
   banco crudo directamente. Corregido moviendo el cálculo al servidor
   (`worker/src/items.ts::casillasAbiertoPara`) y exponiendo solo la
   LONGITUD (nunca el texto) como `ItemPublico.casillas_abierto`.
5. **Nomenclatura del prompt de usuario simplificada**: "Debes digitalizar la
   página 1" en vez de citar el id interno de la página (p. ej.
   `"01-letra-clara-6"`, sin significado para el modelo).
6. **Claves del esquema de ítems sin prefijo de página**: `"19"` en vez de
   `"01-letra-clara-6::19"` — `item.numero` ya es único en todo el examen
   (posición absoluta 1-25), así que namespacear por página era innecesario
   (demografía sigue namespaceada, no se ha tocado).

**Bug real encontrado y corregido durante esta misma batería**: la primera
versión del esquema de "abierto" forzaba la longitud EXACTA
(`minLength = maxLength = numCasillas`) — contra la API real, esto hizo que
el modelo, obligado a completar hasta esa longitud, rellenara el resto con
basura inventada en vez de espacios cuando la respuesta real era más corta
que las casillas impresas: `"INFLACIÓN   NULL"`, `"AMINOÁCIDOS    A"`,
`"SODICÁONIMAÑIÑIÑIÑ"` — un efecto secundario real del grammar-constrained
decoding de Structured Outputs (el modelo no puede simplemente "terminar
antes"), no una mala lectura. Corregido quitando `minLength` y usando
`maxLength`/`pattern` con longitud variable (`{0,N}` en vez de `{N}`): el
modelo ya puede parar de escribir en cuanto termina la respuesta real, sin
verse obligado a rellenar.

**Corrida final** (`gpt-5-mini`, mismo día, mismas 4 instancias, ground
truth completo de 25 ítems + 7 campos de demografía en las 4):

| Instancia | Ítems | Demografía |
|---|---|---|
| `01-letra-clara` | **25/25 (100%)** | 7/7 (100%) |
| `02-con-correcciones` | **24/25 (96%)** | 7/7 (100%) |
| `03-valores-invalidos-e-incompletas` | **22/25 (88%)** | 7/7 (100%) |
| `04-descuidada-ruidosa` | **23/25 (92%)** | 6/7 (86%) |

**94/100 (94%) de acierto agregado en ítems**, sobre el ground truth
completo (denominador más exigente que la ronda anterior, que excluía los
ítems en blanco). Fallos que quedan, todos revisados página a página contra
el prompt/esquema/salida cruda real:

- **Alucinación en preguntas en blanco** (el hallazgo más relevante de esta
  ronda, invisible hasta el cambio nº1 de arriba): en dos casos donde el
  plan dejó una pregunta ENTERAMENTE sin rellenar (ítem `04`, `clasificar`
  de 9 elementos, en `02-con-correcciones`; el campo `libros_en_casa` en
  `04-descuidada-ruidosa`), el modelo devolvió una asignación/letra completa
  y plausible en vez de reconocer que no había nada escrito — no es un
  problema de espacios ni acentos, es contenido inventado de la nada.
  Candidato claro para una futura iteración del prompt (algo como "si TODAS
  las casillas de una pregunta están vacías, no inventes ninguna letra").
- Autocompletar una respuesta a medias sigue ocurriendo alguna vez pese a la
  instrucción explícita ("nunca completes palabras escritas a medias"):
  `"PLUSV"` (deliberadamente incompleta en el plan) volvió como
  `"PLUSVALIA"` — la instrucción reduce pero no elimina del todo esta
  tendencia.
- El espaciado letra a letra reaparece, pero ahora SOLO en la instancia con
  texto invertido sin sentido (`04-descuidada-ruidosa`) — nunca en texto
  real (una palabra de verdad, aunque esté mal escrita a mano, siempre salió
  bien unida en las 4 instancias). Coherente con que sea más difícil de
  "leer como palabra" un texto que no es una palabra real — caso adversarial
  a propósito, no representativo de una hoja real.
- El resto son 2-3 fallos genuinos de lectura sin patrón claro
  (`03-valores-invalidos-e-incompletas`, la instancia con valores fuera de
  formato a propósito).

## Rediseño del layout de la hoja en papel: Respuesta/Corrección lado a lado (16 de agosto de 2026)

Cambio posterior de layout (no de prompts/esquema): la hoja en papel
comprimió la página de datos a 1 sola página y reordenó el banco de ítems
para caber en 5 páginas de preguntas (6 en total con la de datos, antes 7) —
ver el git log de `public/admin/papel/hoja.js`/`geometria.js`/
`data/orden-test.json` para el detalle de cada cambio. El más relevante para
OCR-IA: en opción única, selección múltiple, ordenar y clasificar, los
bloques "Respuesta" y "Corrección" pasan de ir apilados (Corrección debajo)
a ir **en la misma fila, lado a lado** (Respuesta a la izquierda, Corrección
a la derecha) — solo "abierto" sigue apilado (demasiadas casillas para caber
lado a lado). `SYSTEM_PROMPT_ITEMS` (`worker/src/endpoints/admin/ocrIa.ts`)
describía un único layout apilado para los 5 formatos ("y, debajo, un bloque
Corrección..., separado por una línea discontinua" — esa línea discontinua,
además, nunca se llegó a dibujar en ningún layout, apilado o no: pura
descripción inexacta ya desde antes de este cambio). Corregido para describir
ambos layouts explícitamente según el formato. El esquema JSON
(`construirEsquemaCompleto`/`esquemaCampoRespuestaItem`) no dependía de la
posición del bloque Corrección, solo de su formato/recuento de opciones —
no hizo falta tocarlo.

Como el pipeline entero calcula la paginación al vuelo a partir del banco de
ítems (`hoja.js::calcularManifiesto`, README del proyecto §4.7) y ni
`generar.mjs` ni `probar_ocr_ia.mjs` asumen un nº de páginas fijo en ningún
sitio (leen `manifiesto.length`), regenerar las fixtures con el nuevo layout
fue solo volver a ejecutar `node ocr_tests/generar.mjs` — las 4 instancias
pasaron de 7 a 6 páginas (`pagina-07.jpg` desaparece en las 4) sin tocar
ningún dato de las personas ni de sus planes de respuesta.

**Corrida de verificación** (`gpt-5-mini`, mismo día, mismas 4 instancias,
fixtures regeneradas con el layout nuevo, prompt corregido, contra
`wrangler dev` local):

| Instancia | Ítems | Demografía |
|---|---|---|
| `01-letra-clara` | **25/25 (100%)** | 7/7 (100%) |
| `02-con-correcciones` | **23/25 (92%)** | 7/7 (100%) |
| `03-valores-invalidos-e-incompletas` | **22/25 (88%)** | 7/7 (100%) |
| `04-descuidada-ruidosa` | **25/25 (100%)** | 6/7 (86%) |

**95/100 (95%) de acierto agregado en ítems**, en línea con la corrida de
referencia anterior (94%) — sin regresión atribuible al nuevo layout lado a
lado: ninguno de los fallos de esta corrida es una confusión entre columna
Respuesta/columna Corrección (se revisó la respuesta cruda de cada fallo
contra el prompt). Los fallos que quedan repiten los mismos patrones ya
documentados arriba — alucinación en preguntas en blanco (`02-con-
correcciones` ítem 01, "SIGMUND FREUD" donde el plan dejaba la pregunta en
blanco; `04-descuidada-ruidosa` demografía.libros_en_casa, "0-10" también
sobre un campo en blanco) y autocompletar una respuesta a medias
("PLUSV" → ya contaba como fallo esperado en el plan) — ninguno nuevo.

## Refuerzo anti-alucinación + comparativa de 5 modelos (issue #31, 16 de agosto de 2026)

Cambios de esta ronda, los tres verificados contra la API real:

1. **`SYSTEM_PROMPT_ITEMS` refuerza explícitamente "no inventes"** — añadido
   un párrafo final ("nunca modifiques lo consignado: no te inventes la
   respuesta si no está... tu misión no es corregir, sino digitalizar de
   manera absolutamente exacta") y una frase específica para el caso ya
   documentado arriba (pregunta entera en blanco → `null`, nunca una
   respuesta plausible inventada).
2. **`SYSTEM_PROMPT_DEMOGRAFIA` deja de describir un bloque "Corrección" que
   nunca existió en esa página.** Comparado el prompt contra
   `public/admin/papel/hoja.js::construirBloquesDemografia`: los campos de
   demografía (catálogos + año de nacimiento) imprimen un único bloque
   "Respuesta", nunca un bloque "Corrección" — a diferencia de las páginas de
   ítems. El prompt anterior (copiado por error del diseño de ítems) le pedía
   al modelo resolver una precedencia sobre un bloque que no está impreso en
   ningún sitio: puro ruido. Simplificado para describir solo lo que hay
   realmente en la hoja. De paso, el texto del prompt de usuario de esta
   página ya no cita el id interno de la página (p. ej. una cadena como
   `"01-letra-clara-1"`, sin significado para el modelo) sino el mismo
   "Debes digitalizar la página N" que ya usaban las páginas de ítems.
3. **El esquema JSON de demografía ahora admite `null` explícitamente**
   (antes solo el enum de letras válidas, o el patrón de dígitos, sin
   posibilidad real de "no hay nada" pese a que el prompt ya se lo pedía).
4. **Bug real encontrado y corregido contra la API real, no de lectura sino
   de compatibilidad**: `gpt-5.4-nano`/`gpt-5.4-mini` (probados por primera
   vez en esta ronda) rechazan con 400 el valor `reasoning_effort: "minimal"`
   que el Worker manda siempre a cualquier modelo `gpt-5*`
   ("Unsupported value: 'reasoning_effort' does not support 'minimal' with
   this model. Supported values are: 'none', 'low', 'medium', 'high', and
   'xhigh'." — esta generación lo renombró a `"none"`). En vez de mantener a
   mano una tabla modelo→valor soportado (se habría quedado desactualizada
   con el próximo modelo), `postOcrIa` ahora reintenta una vez leyendo del
   propio mensaje de error qué valores soporta ese modelo y eligiendo el más
   barato de la lista (`elegirReasoningEffortDesdeError`,
   `worker/src/endpoints/admin/ocrIa.ts`).

**Corrida comparativa de 5 modelos** (mismas 4 instancias de siempre, mismo
prompt/esquema ya con los cambios de arriba, contra `wrangler dev` local):

| Modelo | Ítems (100 totales) | Demografía (28 totales) | Coste estimado / 100 exámenes* |
|---|---|---|---|
| `gpt-4o` | 69/100 (69%) | 21/28 (75%) | ~$4.29 |
| `gpt-5-nano` | 45/100 (45%) | 23/28 (82%) | ~$0.19 |
| `gpt-5.4-nano` | 78/100 (78%) | 26/28 (93%) | ~$0.60 |
| `gpt-5-mini` | 91/100 (91%) | 28/28 (100%) | ~$0.92 |
| `gpt-5.4-mini` | **92/100 (92%)** | 26/28 (93%) | ~$2.15 |

\* Estimado a partir del `usage` real devuelto por la API en esta misma
corrida (`prompt_tokens`/`completion_tokens` medios por página, ver
`console.log("[ocr-ia] uso", ...)` en `ocrIa.ts`), extrapolado a 6
páginas/examen (el manifiesto actual: 1 de datos + 5 de ítems) × 100
exámenes, con el precio estándar por token de cada modelo en la propia
documentación de OpenAI (agosto de 2026) — no incluye el margen de la API de
imágenes de OpenAI si difiriera del recuento de tokens que ya reporta
`usage`, ni reintentos por 429/5xx.

**Conclusión: `gpt-5-mini` (el modelo por defecto actual, `OPENAI_MODEL` en
`wrangler.toml`) sigue siendo la mejor relación precisión/coste** — acierto
prácticamente idéntico a `gpt-5.4-mini` (91% vs 92%, dentro del ruido de 4
instancias) a menos de la mitad de coste, y muy por delante de `gpt-4o`
(-22 puntos de acierto en ítems por 4.7× más caro) y de ambos modelos
`nano` (demasiado fallo en ítems para un banco de solo 25 preguntas). No se
ha cambiado el modelo por defecto del Worker como consecuencia de esta
corrida — la decisión es del propietario del proyecto.

**Alucinación en preguntas en blanco: reducida, no eliminada**, pese al
refuerzo del prompt (punto 1 de arriba) — sigue apareciendo, con distinta
frecuencia según el modelo:
- `gpt-5-mini`: 2 casos en 100 ítems + 28 campos de demografía (`02-con-
  correcciones` ítem 01 "SIGMUND FREUD" e ítem 21, ambos con la pregunta
  realmente en blanco en el plan).
- `gpt-4o`: 1 caso (mismo ítem 01 de `02-con-correcciones`, "FREUD").
- `gpt-5.4-mini`: 1 caso (mismo ítem 01, "SIGMUND FREUD" — parece ser el caso
  más "atractivo" para alucinar del set: es el primer ítem del banco y una
  respuesta plausible y célebre, "Freud", encaja con varias preguntas de
  psicología cercanas en la hoja).
- `gpt-5-nano`/`gpt-5.4-nano`: no se observó ningún caso nuevo en esta
  corrida, pero ambos modelos ya fallan tanto en lectura normal que un caso
  aislado de alucinación no se distingue del ruido de fondo.

Los demás patrones de fallo (autocompletar una respuesta a medias, texto
invertido reconstruido como palabra real, algún error de lectura suelto)
siguen apareciendo igual que en rondas anteriores, sin patrón nuevo
atribuible a estos cambios.

## Ejemplo de una sola vez (few-shot): 91% → 97-98% en `gpt-5-mini`, alucinación en blanco no reproducida (issue #31, mismo día)

Siguiente paso, ya implementado: mandar un ejemplo de muestra (few-shot)
junto con el prompt real de cada llamada a una página de tipo `items` —
generado por `ocr_tests/generar_one_shot.mjs`, artefactos en
`ocr_tests/one_shot_example/` (`pagina.jpg`, `user_prompt.txt`,
`respuesta_esperada.json`, `items.json` con la definición de los 4 ítems y
la tinta sintética) e inyectado en producción por `worker/src/endpoints/
admin/ocrIa.ts::construirMensajesEjemplo` como un turno `user`+`assistant`
adicional ANTES de la página real — **solo en peticiones que incluyen alguna
página de tipo `items`** (demografía ya mide 100% sin él).

**Una sola página, 4 preguntas, contenido distinto al banco real** (issue
#31: "una página de ejemplo con preguntas diferentes a las del test"),
numeradas 1-4 en la propia imagen (con aviso explícito en el texto de que es
un ejemplo aparte, sin relación con la numeración de la página real que
sigue en el turno siguiente) — cada una ataca un caso concreto de
alucinación ya documentado arriba:

1. **Abierto**: la respuesta canónica sería "JOSE DE ARIMATEA", pero lo
   escrito es mucho más corto ("JUAN" en Respuesta, "JOSE" en Corrección) —
   enseña a transcribir literalmente, nunca a completar hacia la respuesta
   que "debería" ser.
2. **Opción múltiple**: Respuesta y Corrección COMPLETAMENTE en blanco —
   enseña que la salida correcta es `null` en ambas, el caso exacto de
   alucinación en blanco de la ronda anterior.
3. **Selección múltiple**: una casilla vacía en medio de la selección
   ("A E" / "A B", con el hueco preservado como espacio literal) en los dos
   bloques — enseña a no "cerrar" el hueco ni completar hacia el conjunto
   que se supone correcto.
4. **Ordenar**: la Corrección tiene una posición sin rellenar — enseña a
   dejar esa clave como cadena vacía en el diccionario, no la letra "que
   tocaría" según el resto de la secuencia.

**Corrida de verificación** (`gpt-5-mini`, el modelo por defecto — mejor
relación precisión/coste de la comparativa de 5 modelos de arriba —, mismas
4 instancias, mismo `wrangler dev` local, con el ejemplo activado):

| Instancia | Ítems (sin ejemplo → con ejemplo) | Demografía |
|---|---|---|
| `01-letra-clara` | 25/25 (100%) → **25/25 (100%)** | 7/7 (100%) |
| `02-con-correcciones` | 22/25 (88%) → **25/25 (100%)** | 7/7 (100%) |
| `03-valores-invalidos-e-incompletas` | 19/25 (76%) → **22/25 (88%)** (88% y 92% en dos corridas repetidas, ítems distintos fallando cada vez) | 7/7 (100%) |
| `04-descuidada-ruidosa` | 25/25 (100%) → **25/25 (100%)** | 7/7 (100%) |

**91/100 → 97/100 (97%) de acierto agregado en ítems**, demografía sigue en
28/28 (100%). Más importante que el número agregado: **los dos casos de
alucinación en preguntas en blanco de la corrida anterior (`02-con-
correcciones` ítem 01 "SIGMUND FREUD" e ítem 21) NO se reprodujeron en
ninguna de las dos corridas de verificación** — esa instancia pasó de 22/25
a 25/25 exactamente por eso. Los fallos que quedan en `03-valores-invalidos-
e-incompletas` son de los patrones YA documentados y no relacionados con
blancos: autocompletar una respuesta a medias ("PLUSV" → "PLUSVALIA"), un
error de lectura suelto en una opción múltiple, y en una corrida una
respuesta `abierto` deliberadamente incompleta con un dígito de más
("4/1" → "4/10").

**Coste**: el turno adicional (imagen + texto + respuesta de ejemplo) suma
~3200 tokens de prompt por llamada de media (4595 → 7768 tokens de prompt
por página, medido con el mismo `usage` real de la API) — el coste estimado
de `gpt-5-mini` por 100 exámenes sube de ~$0.92 a **~$1.33**, un incremento
del 45% sobre una cifra ya muy baja en términos absolutos. Dado que elimina
justo el patrón de fallo más preocupante (contenido inventado de la nada, no
solo un error de lectura), el coste adicional parece razonable — decisión
final del propietario del proyecto.

**No implementado todavía**: no se ha vuelto a probar el ejemplo contra los
otros 4 modelos de la comparativa (`gpt-4o`, `gpt-5-nano`, `gpt-5.4-nano`,
`gpt-5.4-mini`) — el propio issue #31 pidió esta ronda solo con el modelo
por defecto.

## Amplía el ejemplo a 6 preguntas — intento de eliminar el autocompletado (issue #31, mismo día)

Segunda iteración sobre el ejemplo de una sola vez: de 4 a 6 preguntas
(añadidas `clasificar`, con dos clasificaciones completas y distintas entre
Respuesta y Corrección; y un segundo `abierto` con Respuesta rellena y
Corrección completamente en blanco → `null`), el antiguo ítem 4 de
`ordenar` (elementos ficticios "Elemento W/X/Y/Z") sustituido por una
pregunta con contenido real pero ajeno al banco (ordenar países por
superficie), y — el cambio dirigido directamente al fallo de autocompletado
— la Corrección del ítem 1 (`abierto`) pasa de "JOSE" (un nombre corto pero
completo) a **"JOSE DE ARIMAT"**, la palabra cortada literalmente a medias,
mucho más parecida al patrón real que seguía fallando ("PLUSV" →
"PLUSVALIA"). También se quitaron las etiquetas "(EJEMPLO)" y la aclaración
"(sin relación con el banco real)" que se imprimían en la propia página —
ahora es visualmente indistinguible de una página real, la aclaración de que
es un ejemplo vive solo en el texto que acompaña a la imagen (fuera de lo
impreso).

**Corrida de verificación** (`gpt-5-mini`, mismas 4 instancias):

| Instancia | Ítems |
|---|---|
| `01-letra-clara` | 25/25 (100%) |
| `02-con-correcciones` | 25/25 (100%) |
| `03-valores-invalidos-e-incompletas` | 23/25 (92%) |
| `04-descuidada-ruidosa` | 25/25 (100%) |

**98/100 (98%)**, demografía 28/28 (100%) — se mantiene la mejora de la
ronda anterior (ningún caso de alucinación en blanco) y sube un punto más
sobre el 97% anterior.

**El autocompletado de "PLUSV" NO se resolvió** — sigue siendo el único
fallo sistemático que queda. Repetido 5 veces seguidas solo la instancia
`03-valores-invalidos-e-incompletas` (mismo ítem 19 cada vez, mismo plan
determinista): falló 4 de 5 veces, exactamente igual que "PLUSVALIA" (antes
"PLUSVALÍA", el acento no cuenta como fallo). El refuerzo del ejemplo
(Corrección cortada a medias en la pregunta 1) no cambió esta tasa de forma
apreciable — parece un sesgo del modelo especialmente fuerte para ESTE caso
concreto ("PLUSV" es una compleción casi inequívoca hacia una palabra muy
común en español, "PLUSVALÍA"), no un problema general de autocompletado que
el ejemplo pueda corregir con un solo caso de refuerzo. Candidatos para una
tercera ronda, ninguno probado todavía: un ejemplo dedicado exclusivamente a
este patrón (una palabra española muy reconocible cortada a la mitad, sin
compartir turno con otras 5 preguntas que puedan diluir la lección) o
aceptar que este caso concreto es un límite práctico del enfoque de prompt/
few-shot con este modelo.

## Detección determinista de tinta por casilla para "ordenar"/"clasificar" con huecos (issue #35, 17 de agosto de 2026)

Seguimiento del fallo de #33 (una o varias casillas sin rellenar en medio de
la rejilla de `ordenar`/`clasificar`: el modelo, al no saber de antemano
cuáles están vacías, desplaza las letras siguientes para rellenar el hueco en
vez de dejar esa posición como cadena vacía). El propio issue #33 ya había
verificado que forzar en el esquema JSON las posiciones ya sabidas en blanco
arregla el fallo (4/4), pero faltaba la mitad determinista: ¿se puede saber
de antemano, sin LLM, qué casillas están vacías, con la fidelidad suficiente
para restringir el esquema sin riesgo de borrar contenido real?

**Paso 1 — verificación pura de imagen, sin ningún LLM de por medio.**
`hoja.js::calcularGeometriaCasillas` (nuevo) expone la posición exacta de
cada casilla de ordenar/clasificar sin generar ningún PDF, reutilizando los
mismos bloques que ya calcula `calcularManifiesto` para saber dónde cae cada
ítem. `ocr_tests/verificar_casillas_vacias.mjs` (nuevo) endereza cada
`pagina-NN.jpg` con el mismo mecanismo que usa producción
(`comun.js::detectarFiduciales`+`warpearImagen`), muestrea la densidad de
tinta del interior de cada casilla (22% de margen para no coger el borde
impreso ni tinta de la vecina) y compara contra el ground truth exacto de
`generar.mjs::construirPlan` (reproducible sin volver a generar imágenes:
`generar.mjs` ahora exporta `PERSONAS`/`construirPlan`/`hashCadena` y protege
su `main()` tras un guard de punto de entrada).

**Resultado: separación limpia.** En las 312 casillas de las 4 instancias
(78 casillas × 4 personas), la casilla "con tinta" más tenue midió 8.1 de
densidad media; la "en blanco" más oscura (ruido/JPEG) midió 4.5. Cualquier
umbral en ese hueco de +3.5 puntos da 0 falsos positivos y 0 falsos
negativos — `comun.js::detectarTintaCasillas` (umbral 8, mismo inset 22%,
exportado para producción y para el propio test) acierta 312/312.

**Bug real encontrado y corregido de camino, bloqueante para esta
verificación**: `comun.js::detectarFiduciales` buscaba el fiducial en el 8%
del encuadre de la foto, un valor que quedó desactualizado desde que
`FIDUCIAL_INSET_MM` pasó de 3mm a `PADDING_MM` (15mm) en un cambio de layout
anterior — el fiducial cae ahora al 8.3% de la página YA SIN contar ningún
margen de encuadre real, así que con cualquier foto real (confirmado 11-12%/
8-9% del encuadre incluso con solo un 3% de margen simulado) la autodetección
de esquinas fallaba siempre, cayendo en silencio al selector manual. Subido a
20%.

**Paso 2 — implementación completa** (cliente + servidor + esquema, issue
#35 trabajo pendiente #1-#2, y el diff server-side ya prototipado en el
propio issue):

- `hoja.js`: `calcularGeometriaCasillas` (arriba) + método `casillas()` en
  paralelo a `dibujar()` en los builders de casillas.
- `comun.js`: `detectarTintaCasillas(canvasEnderezado, casillas)`, umbral e
  inset calibrados arriba.
- `digitalizar.js`/`subirLote.js`: `obtenerManifiesto()` calcula también
  `geometriaCasillas`; `construirEntradaPaginaIA` muestrea la tinta del
  `warpCanvas` ya enderezado y enriquece cada ítem ordenar/clasificar con
  `posicionesEnBlancoRespuesta`/`posicionesEnBlancoCorreccion` (1-based, solo
  si hay alguna) antes de mandarlo a OCR-IA.
- `worker/src/endpoints/admin/ocrIa.ts`: `ItemEntrada` acepta esos dos
  campos; `esquemaPosicionesNullable` fuerza esas posiciones a `enum: [""]`
  en vez del patrón normal; `esquemaPregunta` construye Respuesta/Corrección
  por separado cuando el ítem los trae (antes compartían el mismo esquema).
  Validación explícita en `motivoItemInvalido` (solo válido en ordenar/
  clasificar, posiciones entre 1 y n). 6 tests nuevos en `ocrIa.test.ts`
  (198/198 en total, sin regresiones).
- `probar_ocr_ia.mjs`: antes mandaba la foto cruda (sin enderezar) a OCR-IA
  para CUALQUIER formato — nunca ejercía el paso de enderezado que sí corre
  siempre en producción. Ahora, solo para páginas con ordenar/clasificar (las
  únicas que necesitan esta detección), endereza con el mecanismo real y
  calcula `posicionesEnBlanco*` muestreando la tinta — igual que hará el
  cliente real, nunca a partir del ground truth. El resto de páginas se sigue
  mandando cruda (cambiar eso afectaría a todos los números históricos de
  este README para otros formatos, fuera de alcance de este issue).

**Verificación end-to-end contra la API real** (`gpt-5-mini`, `wrangler dev`
local, mismo día): para los 4 casos ya documentados en #33/generar.mjs
(`HUECOS_CLASIFICAR`, un hueco deliberado en el ítem `04`/`22` de cada
persona), comparando la MISMA llamada con y sin las posiciones detectadas
automáticamente (nunca el ground truth):

| Instancia / ítem | Sin fix (baseline) | Con fix (posiciones detectadas) |
|---|---|---|
| `01-letra-clara` / `04` | FALLO (desplazó elementos tras el hueco) | OK |
| `02-con-correcciones` / `22` | OK (no reprodujo el fallo esta vez) | OK |
| `03-valores-invalidos-e-incompletas` / `04` | FALLO (mismo patrón) | OK |
| `04-descuidada-ruidosa` / `22` | FALLO (mismo patrón) | OK |

**4/4 con el fix**, 3/4 reproduciendo el fallo exacto descrito en el issue
sin él (el 4º no lo reprodujo esta vez concreta — el issue ya documentaba
~50% de fallo, no 100%). A continuación, la batería completa de las 4
instancias con `probar_ocr_ia.mjs` ya actualizado (enderezado + detección
real en las páginas que lo necesitan):

| Instancia | Ítems | Demografía |
|---|---|---|
| `01-letra-clara` | **25/25 (100%)** | 7/7 (100%) |
| `02-con-correcciones` | **24/25 (96%)** | 7/7 (100%) |
| `03-valores-invalidos-e-incompletas` | **23/25 (92%)** | 7/7 (100%) |
| `04-descuidada-ruidosa` | **24/25 (96%)** | 7/7 (100%) |

**96/100 (96%) de acierto agregado en ítems**, 28/28 (100%) demografía. Los 4
fallos que quedan son los dos patrones YA documentados arriba, ninguno nuevo
y ninguno relacionado con huecos en ordenar/clasificar: el ítem `19`
("PLUSV"/texto invertido, `02-con-correcciones` y el propio patrón
"PLUSVALIA" ya conocido) y dos errores de lectura sueltos en
`03-valores-invalidos-e-incompletas` (ítems `12`/`23`, opción única).

**Qué falta** (issue #35 trabajo pendiente #3-#4, no cubierto por esta
ronda): calibrar el umbral contra fotos/escaneos reales de calidad muy
distinta (móvil con mala luz, escáner de sobremesa, papel con sombras) — esta
verificación es 100% contra las 4 fixtures sintéticas de `ocr_tests/`, con un
efecto de escaneo/foto ya simulado (rotación, ruido, desenfoque) pero nunca
sustituto perfecto de una foto real. El margen de separación (8.1 vs 4.5) da
bastante colchón, pero sigue siendo trabajo pendiente antes de confiar en
esto contra el piloto real sin supervisión.

## Ampliación a los 5 formatos, y un hallazgo real sobre techos exactos (issue #35, mismo día)

Con la detección de tinta funcionando tan bien en ordenar/clasificar, se
amplió a los otros 3 formatos:

- `hoja.js::calcularGeometriaCasillas` ya no se limita a ordenar/clasificar —
  cada builder de casillas (`construirFilaCasillas`/`construirBloqueCasillas`/
  `construirBloqueCasillasDoble`) ya exponía `.casillas()` genéricamente desde
  la primera ronda; solo faltaba enganchar los 3 formatos restantes en
  `construirBloqueItem` (abierto necesita dos bloques con `lado` etiquetado a
  mano, Respuesta/Corrección van apilados, no lado a lado como el resto).
- `digitalizar.js::conDeteccionDeTinta` calcula, según formato: posiciones en
  blanco (ordenar/clasificar/opcion_multiple, reutilizando el mismo mecanismo
  — opcion_multiple tiene una única casilla, así que "en blanco" ahí es "todo
  el bloque vacío"), nº de casillas con tinta (seleccion_multiple) o longitud
  del tramo con tinta (abierto, primera a última casilla inkada).
- `ocrIa.ts`: `ItemEntrada` gana `numSeleccionadasRespuesta/Correccion` y
  `longitudDetectadaRespuesta/Correccion`, con su propia validación de rango.

**Hallazgo real durante la verificación end-to-end** (contra la API real, las
4 instancias completas): el primer diseño para `seleccion_multiple` forzaba
el nº EXACTO de letras detectadas con tinta. En la instancia
`01-letra-clara`, el ítem `18` (3 opciones correctas realmente marcadas) bajó
de 25/25 a 24/25 — la 3ª casilla midió una densidad de **7.9, justo por
debajo del umbral 8** (`comun.js::UMBRAL_TINTA_CASILLA`), el detector contó 2
en vez de 3, y el esquema forzó exactamente 2 letras: el modelo, aunque
probablemente veía la 3ª marca, no tenía forma de reportarla — Structured
Outputs no le deja "desobedecer" el esquema.

A diferencia de forzar posiciones individuales a cadena vacía (ordenar/
clasificar/opcion_multiple, donde un fallo puntual del detector solo afecta a
ESA casilla, nunca bloquea el resto del ítem), un **techo exacto sobre un
conteo agregado es un único punto de fallo**: basta con que UNA casilla caiga
del lado equivocado del umbral para volver inexpresable una respuesta
correcta entera. Corregido en dos frentes:

1. **`seleccion_multiple`** ya no fuerza ningún nº exacto de letras — solo usa
   la detección para "0 casillas con tinta → `null`" (la única señal
   verdaderamente inequívoca: requiere fallar TODAS las casillas del bloque a
   la vez, no solo una). Con una o más, el patrón queda tan libre como antes
   de esta ronda.
2. **`abierto`** mantiene el techo de longitud (es la mitigación directa del
   patrón "PLUSV" → "PLUSVALIA"), pero le suma un margen de seguridad fijo
   (`MARGEN_SEGURIDAD_TECHO = 2` casillas) al tramo detectado antes de usarlo
   como `maxLength`, para absorber exactamente este mismo tipo de casilla
   borderline sin arriesgar truncar una respuesta real.

**Corrida de verificación tras el fix** (`gpt-5-mini`, mismo día, mismas 4
instancias, `probar_ocr_ia.mjs` ahora enderezando y detectando tinta en
CUALQUIER página de tipo `items`, no solo las de ordenar/clasificar):

| Instancia | Ítems | Demografía |
|---|---|---|
| `01-letra-clara` | **25/25 (100%)** | 7/7 (100%) |
| `02-con-correcciones` | **25/25 (100%)** | 7/7 (100%) |
| `03-valores-invalidos-e-incompletas` | **23/25 (92%)** | 7/7 (100%) |
| `04-descuidada-ruidosa` | **24/25 (96%)** | 7/7 (100%) |

**97/100 (97%) de acierto agregado en ítems**, 28/28 (100%) demografía —
mejora sobre el 96% de la ronda anterior (solo ordenar/clasificar) y el ítem
`18` que había regresionado con el diseño de techo exacto vuelve a acertar.
Los 3 fallos que quedan, revisados uno a uno contra el plan/imagen real, son
errores de lectura genuinos sin relación con la detección de tinta:

- Ítem `10` (`03-valores-invalidos-e-incompletas`, `abierto`): la persona
  escribió literalmente "4/1" (respuesta deliberadamente incompleta, 3
  caracteres — `tasaAbiertaIncompleta`), el modelo devolvió "4/" (perdió el
  último dígito). El esquema permitía hasta 5 caracteres (3 detectados + 2 de
  margen) — sobraba margen de sobra para los 3 reales, así que NO es un
  truncamiento del esquema, es una lectura incompleta del propio modelo.
- Ítem `23` (`03-valores-invalidos-e-incompletas`, `opcion_multiple`): letra
  incorrecta, sin relación con ningún bloque en blanco.
- Ítem `22` (`04-descuidada-ruidosa`, `clasificar`): una única categoría mal
  asignada (Liszt → Impresionismo en vez de Romanticismo) en una posición que
  el detector correctamente identificó CON tinta — error de lectura, no de
  huecos.

Ningún fallo de los 3 corresponde a una casilla forzada incorrectamente ni a
un truncamiento — la lección de este hallazgo (techos exactos son frágiles,
suelos/posiciones individuales son seguros) queda documentada en los propios
comentarios de `esquemaCampoRespuestaItemLado` (`worker/src/endpoints/admin/ocrIa.ts`)
para la próxima vez que se considere restringir el esquema con una señal
determinista.

## Desalineamiento sistemático de fiduciales, ~9-10px (issue #38, 18 de agosto de 2026)

Investigando por qué varianza/Otsu/componentes conexas (exploradas en una
ronda anterior no documentada aquí) no separaban en escaneos reales pese a
funcionar en las fixtures sintéticas, se encontró que `detectarFiduciales`
(`comun.js`) devolvía centros sistemáticamente desplazados ~9-10px
(~0.9-1mm a `ANCHO_OBJETIVO = 2200`) respecto a su posición teórica
(`geometria.js::fiducialesFijos()`) — reproducido incluso con un PDF "puro"
(`construirHoja()`, sin cámara/escáner/JPEG de por medio), así que no era
ruido de escaneo: el propio grid de referencia usado para recortar cada
casilla estaba mal.

**Causa confirmada** en `localizarBlobEnRegion`/`refinarCentroide`
(`comun.js`): `refinarCentroide` acota su ventana a un radio fijo
(`FIDUCIAL_BLOQUE * 1.5 = 18px`) que a la resolución de trabajo es MENOR que
el semilado real de un fiducial de `FIDUCIAL_SIZE_MM = 5mm` (~26px a
`ANCHO_OBJETIVO = 2200`, ~10.5 px/mm) — la ventana solo ve una porción
truncada y asimétrica del blob, y el centroide heredaba ese sesgo. Un poco
más abajo, `localizarBlobEnRegion` SÍ mide la extensión real del blob en las
4 direcciones (`medirExtensionEje`, con un radio de sobra) para el chequeo de
aspect-ratio/tamaño, pero esa información solo se usaba para validar, nunca
para recentrar el punto devuelto — el descentrado quedaba ahí, sin usar,
disponible como `ext - izq` / `abajo - arriba`. Menor, no la magnitud
completa: `refinarCentroide` también ponderaba con el índice de píxel
(`x`/`y`) en vez de su centro (`x+0.5`/`y+0.5`), un sesgo fijo de -0.5px en
ambos ejes.

**Reproducido de forma aislada** (sin PDF/Playwright, `detectarFiduciales`
contra una `ImageData` sintética con 4 cuadrados en su posición teórica
exacta): -9.3 a -11.1px por eje/esquina antes del fix, prácticamente
idéntico a los números medidos contra el PDF real del issue (-9.26 a
-11.10). Confirma que la causa es enteramente el sesgo de
`localizarBlobEnRegion`, no ruido de renderizado/impresión.

**Fix**: recentrar con `ext`/`izq`/`arriba`/`abajo` (ya calculados, antes
descartados) y sumar el `+0.5` de centro de píxel en `refinarCentroide`. Sin
tocar `FIDUCIAL_BLOQUE`/el radio de refinamiento — no hacía falta asumir
ninguna escala px/mm concreta (frágil: una foto real recorta la hoja con
zoom/encuadre variable), el propio blob ya revelaba su descentrado.
Resultado sobre la misma `ImageData` sintética: <1.1px de desviación
(reducción >90%). `node ocr_tests/verificar_casillas_vacias.mjs` sigue en
312/312 (100%, 0 falsos positivos peligrosos) tras el fix, con el margen
entre "con tinta" y "en blanco" ligeramente MEJOR (mínimo con tinta 8.1→9.2,
máximo en blanco sin cambios en 4.5) — consistente con que parte del
solapamiento que motivó este issue era en efecto el borde impreso de la
casilla colándose en la región muestreada, y no ruido real. No se ha tocado
`INSET_RELATIVO_CASILLA`/`UMBRAL_TINTA_CASILLA`: con el desalineamiento
corregido ya no hay separación peligrosa que recalibrar en las fixtures
disponibles en este repo.

**Verificación adicional contra los 2 escaneos reales del issue original**
(`ocr_tests/05-escaneo-real/escaneo-1.pdf`/`escaneo-2.pdf`, recuperados de la
rama `claude/issue-37-implementation-tgdly8` y versionados aquí): con el fix
aplicado, `detectarFiduciales` + `warpearImagen` (mismo camino que
`digitalizar.js`/`subirLote.js`) y overlay visual de la geometría de
`ordenar`/`clasificar` (`calcularGeometriaCasillas`) sobre la imagen ya
enderezada — inspeccionado a simple vista con capturas ampliadas — confirma
que el rectángulo completo de cada casilla traza el borde impreso real y la
región muestreada (tras `INSET_RELATIVO_CASILLA`) queda cómodamente dentro,
sin tocar el borde ni en casillas vacías ni con tinta, en ambos escaneos.
