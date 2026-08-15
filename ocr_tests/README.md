# Fixtures de prueba para el pipeline de digitalización en papel

Este directorio contenía hojas de respuestas ya rellenadas de forma
sintética (generadas con Playwright pintando tinta sobre el DOM de las
versiones v1/OMR y v2/OCR-de-casillas del pipeline de papel) para poder
probar el escaneo sin imprimir hojas de verdad.

Esas dos versiones se han retirado (README del proyecto §4.7, "Historia"): el
pipeline actual genera la hoja como PDF con `pdf-lib`
(`public/admin/papel/hoja.js`) y la lee entera con un modelo de visión de
OpenAI (`worker/src/endpoints/admin/ocrIa.ts`), sin DOM ni Tesseract de por
medio — así que el generador anterior (`generar.mjs`, pintaba tinta sobre
`data-mark`/`data-linea` del DOM) y su depurador (`depurar_demografia.mjs`,
específico de Tesseract) ya no tienen sentido tal cual y se han retirado con
el resto (`git log` conserva el diseño anterior si hace falta consultarlo).

**Este directorio se reconstruye como parte de los tests de digitalización
contra la API real de OpenAI** (README del proyecto, próximo paso tras fijar
el layout definitivo de la hoja): un generador nuevo dibujará directamente
con `pdf-lib` la tinta sintética sobre las coordenadas del manifiesto de
`hoja.js` (en vez de pintar en el DOM), con más variedad de calidad de trazo
y de errores inyectados (valores inválidos en una casilla de opción, texto
libre incompleto, campos en blanco) que las 3 instancias anteriores — y
usará el token de pruebas reservado (`tokens.es_prueba`, README del proyecto
§4.5) para poder digitalizar contra la API real sin ensuciar las
estadísticas del piloto.
