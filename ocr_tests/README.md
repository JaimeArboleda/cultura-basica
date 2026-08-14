# Hojas de prueba para el pipeline de digitalización en papel

Este directorio contiene hojas de respuestas **ya rellenadas** (a mano alzada
de forma sintética) y **con un efecto de escaneo/foto ligero**, para poder
probar de verdad `public/admin/papel/v{1,2}/digitalizar.js` (subir foto →
ajustar esquinas → OMR/OCR → crear sesión) sin tener que imprimir y rellenar
hojas de papel de verdad.

No son capturas de pantalla ni maquetas aproximadas: se generan construyendo
la hoja con los **mismos módulos** que usa el panel de admin
(`public/admin/papel/v1/hoja.js` y `v2/hoja.js`) en un Chromium real, y
pintando la tinta encima de las marcas/casillas reales (`data-mark` /
`data-linea`) — mismo layout exacto que vería el pipeline de digitalización.

## Qué hay aquí

```
ocr_tests/
  v1/<instancia>/pagina-NN.jpg           # hoja v1 (OMR), una foto por página, EN ORDEN
  v1/<instancia>/hoja-completa.pdf       # las mismas páginas, en orden, como un único PDF
  v1/<instancia>/subida-en-bloque/foto-NN.jpg  # las mismas páginas, sueltas y BARAJADAS
  v1/<instancia>/respuestas-esperadas.json
  v2/<instancia>/pagina-NN.jpg           # hoja v2 (OCR de letras), ídem
  v2/<instancia>/hoja-completa.pdf
  v2/<instancia>/subida-en-bloque/foto-NN.jpg
  v2/<instancia>/respuestas-esperadas.json
  harness.html                           # construye la hoja real y pinta la tinta (cargado por generar.mjs)
  generar.mjs                            # script que genera todo lo anterior
```

Cada hoja lleva un **QR grande** (remesa + versión + `exam_id`, solo en la
página 1) y un **QR pequeño de página** (`exam_id` + número de página) en
**todas** las páginas (README del proyecto, §4.9/§4.10) — `exam_id_qr` en
`respuestas-esperadas.json` es el identificador de esa hoja física concreta,
distinto de `token_id_qr` (la remesa).

Cada `<instancia>` es una "persona" que rellenó la hoja con un perfil
distinto (ver `PERSONAS` en `generar.mjs`):

| Instancia | Perfil | Letra | Qué prueba |
|---|---|---|---|
| `01-limpia` | Cuidadosa, casi sin correcciones (~88% acierto) | Architects Daughter | El caso feliz: hoja limpia, letra clara |
| `02-con-correcciones` | Se equivoca a menudo (~50% acierto) y corrige la mayoría | Patrick Hand | La precedencia Respuesta/Corrección (§4.9 del README del proyecto) — incluida la casilla "no responder" de v1 |
| `03-descuidada-incompleta` | Letra desordenada, deja ítems y filas en blanco, un campo de demografía sin rellenar | Caveat (más cursiva) | Robustez ante blancos parciales y letra peor para el OCR |

Cada instancia usa un color de tinta y unos parámetros de escaneo (ángulo,
ruido, desenfoque) ligeramente distintos, y trae su propio código QR de
remesa sintético (`TEST-V{1,2}-<INSTANCIA>`) — no corresponde a ningún token
real de tu base de datos, así que al digitalizar el panel no lo reconocerá y
pedirá elegir la remesa a mano (comportamiento normal y ya previsto por la
app, ver `bloqueToken` en `v{1,2}/digitalizar.js`).

## `respuestas-esperadas.json`

Junto a las fotos de cada instancia hay un JSON con lo que **debería** salir
del pipeline si digitaliza perfectamente: se calcula aplicando la misma
lógica de precedencia Respuesta/Corrección que usa cada `digitalizar.js`
real, pero directamente sobre el plan de respuestas (sin pasar por OCR/OMR).
Sirve para comparar a ojo lo digitalizado por la app contra lo esperado y ver
dónde falla el reconocimiento real (letra ambigua, umbral de marca, etc.) —
que es precisamente lo que README §4.7 del proyecto señala como la incógnita
principal a validar con datos reales.

## Cómo probarlas

**Flujo secuencial de siempre** (README del proyecto §4.7), con las fotos
EN ORDEN:

1. Panel de admin → pestaña "Digitalizar tests" → "2. Digitalizar una hoja
   rellenada".
2. Sube las fotos de una instancia **en orden** (`pagina-01.jpg`,
   `pagina-02.jpg`, ...): el pipeline espera las páginas de datos primero y
   luego las de ítems, en el mismo orden en que se generó la hoja.
3. Ajusta las esquinas si la detección automática de fiduciales no las
   clava (el efecto de escaneo es deliberadamente ligero para que suela
   detectarlas sola, pero conviene probar también el ajuste manual).
4. Al terminar, compara la sesión creada contra `respuestas-esperadas.json`
   de esa instancia.

**Subida en bloque** (README del proyecto §4.10), pensada justo para probar
que no hace falta orden ni una sola visita:

1. Panel de admin → pestaña "Subir en bloque".
2. Sube TODO el contenido de `subida-en-bloque/` de una instancia de una vez
   (los nombres `foto-NN.jpg` están deliberadamente barajados: no siguen el
   orden real de la hoja) — cada una se identifica sola por su QR y se coloca
   en su sitio. Cuando el examen llegue a estar completo, aparece listo para
   "Finalizar" en la lista de abajo.
3. Alternativa: sube directamente `hoja-completa.pdf` (mismas páginas, ya en
   orden, como un único PDF) — caso "mejor" de README §4.10, se procesa de
   una sin tener que ir página a página.
4. Al terminar, compara la sesión creada contra `respuestas-esperadas.json`
   de esa instancia (mismo `exam_id_qr`).

## Depurar la lectura OCR de la demografía

```
node ocr_tests/depurar_demografia.mjs [instancia...]
```

Mientras `generar.mjs` PINTA hojas de prueba, este script las LEE: ejecuta el
pipeline real de recorte (`comun.js::detectarFiduciales/warpearImagen/
recortarLinea`, vía `ocr_tests/lectura_harness.html` en un Chromium real)
sobre las fotos ya generadas de cada instancia (v1 y v2), reconoce cada
casilla de demografía con `tesseract.js` en Node y compara el resultado
contra `respuestas-esperadas.json`. Imprime una tabla `OK`/`FALLO` por campo
y vuelca en `ocr_tests/_debug_output/` (no versionado) el recorte PNG EXACTO
que recibió Tesseract para cada campo — los que fallan llevan sufijo
`-FALLO` en el nombre — así se puede ver a ojo si el fallo está en el
recorte (mal encuadrado, con sobrante en blanco, borde de la casilla
colándose…) o es genuinamente un error de reconocimiento de Tesseract sobre
un recorte limpio.

Sin argumentos corre las 3 instancias; si solo quieres una:
`node ocr_tests/depurar_demografia.mjs 02-con-correcciones`. Necesita
`tesseract.js` (`devDependencies`, `npm install` lo trae) y red saliente la
primera vez (descarga el modelo de idioma "spa", que tesseract.js cachea en
disco) — si la red solo está disponible vía proxy HTTP(S), antepón
`NODE_USE_ENV_PROXY=1` (el `fetch` nativo de Node no lee `HTTPS_PROXY` por
defecto). El propio Chromium no necesita red en ningún momento: todo el
recorte ocurre offline sobre las fotos locales.

Diagnóstico ya encontrado con esta herramienta (agosto 2026): las líneas de
1 sola casilla (cualquier catálogo de demografía, y también cada casilla
individual de 'ordenar'/'clasificar') se medían con el ancho COMPLETO de la
página de contenido en vez del ancho real de la casilla —
`comun.js::bloqueCasillasTexto` documentaba la intención de medir "una
única casilla... de forma completamente independiente", pero el `<div
data-linea>` que envuelve la fila es un bloque normal que por defecto ocupa
todo el ancho disponible; el recorte que veía Tesseract salía >90% de
sobrante en blanco. Corregido con `width: fit-content` en
`.hoja-bloque-casillas-texto` (no cambia la posición impresa de ninguna
casilla, solo qué región se recorta para leerla). Con el recorte ya
ajustado siguen quedando dos fallos genuinos, no de encuadre:

- Algunas letras sueltas dentro de su casilla siguen fallando de forma
  esporádica (a veces vacío, a veces una letra distinta) — el borde
  impreso de la propia casilla, justo pegado al recorte ya ajustado,
  parece colarse en el reconocimiento; un inset fijo lo arregla en algunos
  casos y lo rompe en otros, así que no hay todavía una solución simple.
- El año de nacimiento (4 dígitos) se leía como una sola línea de 4
  casillas (un único recorte, una sola pasada de Tesseract) y fallaba en
  el 100% de las instancias probadas — no solo el número entero salía
  mal, los dígitos ni se recortaban de forma independiente. Se cambió a 4
  claves independientes `demografia:anio_nacimiento:0..3`
  (`comun.js::filaCasillasIndividuales`, mismo mecanismo que ya usaban
  'ordenar'/'clasificar'), igual que el resto de casillas de 1 solo
  carácter. Mejora el MODO de fallo (antes: cadenas de 4 caracteres
  inventadas tipo "2104" para un "2001" real; ahora: huecos en blanco en
  posiciones concretas, y una parte de los dígitos sale bien: ~40% de
  aciertos por dígito en las 6 instancias probadas) pero NO resuelve el
  problema de fondo — Tesseract, sin lista blanca, ni siquiera clasifica
  como dígitos varios de estos trazos (aunque el recorte sea limpio y esté
  perfectamente encuadrado, comprobado a ojo contra los PNG volcados). Da
  la impresión de que Tesseract (un motor de LÍNEAS de texto con contexto
  de diccionario) no es la herramienta adecuada para clasificar un
  carácter aislado de un alfabeto cerrado — ese es un problema tipo
  MNIST/EMNIST, uno donde una CNN pequeña entrenada a propósito (vía
  ONNX Runtime Web o TensorFlow.js con backend wasm, posiblemente usando
  el propio generador de tinta sintética de este directorio como fuente
  de datos de entrenamiento) previsiblemente daría muchísimo mejor
  resultado que seguir ajustando Tesseract.

## Regenerar / crear más instancias

```
node ocr_tests/generar.mjs
```

Necesita `playwright` y `pdf-lib` (`devDependencies` del `package.json` de la
raíz — `npm install` los trae) y Chromium disponible para Playwright
(`npx playwright install chromium` si no lo tienes ya). Descarga 3 fuentes de
Google Fonts (una vez, ~90 KB) y genera todas las instancias desde cero
(sobrescribe lo que hubiera). Necesita red saliente (fuentes vía HTTPS, más
el CDN de `qrcode-generator` que ya usa la propia app — se sirve
interceptado sin tocar la red del navegador, ver comentarios en
`generar.mjs`).

Variables de entorno para iterar rápido sin regenerar las 6 instancias
completas (usadas durante el desarrollo de este generador, se han dejado
porque son útiles para seguir ajustando esto en el futuro):

- `OCR_TESTS_QUICK=1` — solo la primera persona y solo v1. También se salta
  `hoja-completa.pdf`/`subida-en-bloque/` (solo tiene sentido generarlos con
  todas las páginas presentes).
- `OCR_TESTS_QUICK_VERSION=2` — con `QUICK=1`, fuerza la versión (1 o 2).
- `OCR_TESTS_QUICK_PERSONA=<índice>` — con `QUICK=1`, elige la persona (0, 1 o 2).
- `OCR_TESTS_QUICK_PAGES=<n>` — con `QUICK=1`, limita cuántas páginas generar (por defecto 2).

Todo el plan de respuestas es determinista (semillas fijas por persona y
versión, ver `rngDesde`/`hashCadena`): volver a ejecutar `generar.mjs` sin
tocar `data/items.json` ni `PERSONAS` reproduce exactamente las mismas
hojas.
