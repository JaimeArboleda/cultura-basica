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
| `01-letra-clara` | 19/25 (76%) | 7/7 (100%) |
| `02-con-correcciones` | 17/23 (74%) | 7/7 (100%) |
| `03-valores-invalidos-e-incompletas` | 19/25 (76%) | 7/7 (100%) |
| `04-descuidada-ruidosa` | 16/23 (70%) | 6/6 (100%) |

Los fallos que quedan son sobre todo de acento ("PLUSVALIA" en vez de
"PLUSVALÍA"), de espacios perdidos en respuestas largas de varias palabras
("ISABELDECASTILLA...") o casos donde el modelo no aplicó bien la
precedencia Respuesta/Corrección en un `clasificar` — `igual()` en este
script compara con igualdad estricta, más exigente que la tolerancia de
edición real de `worker/src/correccion.ts::corregirAbierto`, así que la
precisión real de puntuación es probablemente algo mayor que estos
porcentajes.

**Bug real encontrado con esta batería, ya corregido:** la fuente de tinta
de `04-descuidada-ruidosa` era `Caveat[wght].ttf`, una fuente VARIABLE —
`pdf-lib`/`fontkit` subsettean mal sus glifos con
`embedFont(..., { subset: true })` y casi toda la tinta salía invisible en
el PDF (una letra suelta, al azar, sí renderizaba). Antes de corregirlo
esta instancia medía 6/23 (26%) ítems y 3/6 (50%) demografía — no porque el
modelo leyera mal, sino porque la imagen que se le mandaba estaba casi en
blanco. Cambiada a Gochi Hand (estática); los números de la tabla ya
reflejan la fuente corregida. Lección: antes de atribuir un fallo al motor
de OCR-IA, comprobar primero que la imagen de entrada tiene tinta visible —
inspeccionar el JPEG generado antes de gastar cuota de la API.

**Bug real encontrado y NO corregido todavía** (afecta también a la hoja
real, no solo a estas fixtures): el ítem `02` tiene `casillasAbierto: 18`
(constante fija en `hoja.js::CONFIG_POR_DEFECTO`) pero su
`respuesta_canonica` completa ("Isabel de Castilla y Fernando de Aragón")
ocupa 40 caracteres con espacios — no cabe físicamente en la fila de
casillas impresa, ni en la hoja real ni en estas fixtures. Cualquiera que
escriba la respuesta completa y correcta no puede terminarla. Pendiente de
decidir el arreglo (más casillas solo para este ítem, cambiar a
`estiloAbierto: "linea"`, o acortar la respuesta canónica esperada).
