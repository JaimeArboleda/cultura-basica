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
