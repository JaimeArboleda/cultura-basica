// Motor de OCR-IA de v2 (README §4.7, "Motor gpt-mini",
// worker/src/endpoints/admin/ocrIa.ts): solo se testea aquí la validación de
// entrada y el caso "sin OPENAI_API_KEY configurada" — igual que el callback
// de OAuth de Google (worker/src/adminAuth.ts) no se testea contra la red
// real, no se mockea aquí la llamada real a la API de OpenAI (el binding de
// test en vitest.config.ts no define OPENAI_API_KEY a propósito, para poder
// probar ese camino sin tocar la red).
import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { firmarSesionAdmin } from "../src/adminAuth";
import { construirEsquemaCompleto, construirMensajesEjemplo } from "../src/endpoints/admin/ocrIa";

const ADMIN_EMAIL = "admin@example.com";

async function tokenAdmin(email = ADMIN_EMAIL): Promise<string> {
  return firmarSesionAdmin(env, email);
}

async function fetchAdmin(path: string, opciones: RequestInit = {}, auth?: string) {
  return SELF.fetch(`http://worker.test${path}`, {
    ...opciones,
    headers: {
      "Content-Type": "application/json",
      ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
      ...opciones.headers,
    },
  });
}

async function sembrarAdmin(email = ADMIN_EMAIL) {
  await env.DB.prepare("INSERT OR IGNORE INTO admins (email, anadido_por, anadido_en) VALUES (?,?,?)")
    .bind(email, null, new Date().toISOString())
    .run();
}

async function postOcrIa(body: unknown, auth: string) {
  return fetchAdmin("/api/admin/ocr-ia", { method: "POST", body: JSON.stringify(body) }, auth);
}

const IMAGEN_VALIDA = "data:image/jpeg;base64,AAA=";
const PAGINA_DEMOGRAFIA_VALIDA = { id: "p1", imagen: IMAGEN_VALIDA, tipo: "demografia", campos: ["sexo", "anio_nacimiento"] };
const PAGINA_ITEMS_VALIDA = {
  id: "p2",
  imagen: IMAGEN_VALIDA,
  tipo: "items",
  items: [{ id: "item05", formato: "opcion_multiple", numero: 5, numOpciones: 6 }],
};

beforeEach(async () => {
  await sembrarAdmin();
});

describe("POST /api/admin/ocr-ia", () => {
  it("401 sin sesión de admin", async () => {
    const res = await fetchAdmin("/api/admin/ocr-ia", { method: "POST", body: JSON.stringify({}) });
    expect(res.status).toBe(401);
  });

  it("400 con JSON inválido", async () => {
    const auth = await tokenAdmin();
    const res = await fetchAdmin("/api/admin/ocr-ia", { method: "POST", body: "no es json" }, auth);
    expect(res.status).toBe(400);
  });

  it("400 sin paginas", async () => {
    const auth = await tokenAdmin();
    const res = await postOcrIa({}, auth);
    expect(res.status).toBe(400);
  });

  it("400 con paginas vacío", async () => {
    const auth = await tokenAdmin();
    const res = await postOcrIa({ paginas: [] }, auth);
    expect(res.status).toBe(400);
  });

  it("400 con una página sin imagen (data URL)", async () => {
    const auth = await tokenAdmin();
    const res = await postOcrIa({ paginas: [{ id: "p1", imagen: "no-es-una-url", tipo: "demografia" }] }, auth);
    expect(res.status).toBe(400);
  });

  it("400 con tipo inválido", async () => {
    const auth = await tokenAdmin();
    const res = await postOcrIa({ paginas: [{ id: "p1", imagen: IMAGEN_VALIDA, tipo: "invalido" }] }, auth);
    expect(res.status).toBe(400);
  });

  it("400 con página de tipo items sin ningún ítem", async () => {
    const auth = await tokenAdmin();
    const res = await postOcrIa({ paginas: [{ id: "p1", imagen: IMAGEN_VALIDA, tipo: "items", items: [] }] }, auth);
    expect(res.status).toBe(400);
  });

  it("400 con un ítem de formato inválido", async () => {
    const auth = await tokenAdmin();
    const res = await postOcrIa(
      {
        paginas: [
          { id: "p1", imagen: IMAGEN_VALIDA, tipo: "items", items: [{ id: "x", formato: "invalido", numero: 1 }] },
        ],
      },
      auth
    );
    expect(res.status).toBe(400);
  });

  it("400 con un ítem 'ordenar' sin n", async () => {
    const auth = await tokenAdmin();
    const res = await postOcrIa(
      {
        paginas: [{ id: "p1", imagen: IMAGEN_VALIDA, tipo: "items", items: [{ id: "x", formato: "ordenar", numero: 1 }] }],
      },
      auth
    );
    expect(res.status).toBe(400);
  });

  it("400 con un ítem 'opcion_multiple' sin numOpciones", async () => {
    const auth = await tokenAdmin();
    const res = await postOcrIa(
      {
        paginas: [
          { id: "p1", imagen: IMAGEN_VALIDA, tipo: "items", items: [{ id: "x", formato: "opcion_multiple", numero: 1 }] },
        ],
      },
      auth
    );
    expect(res.status).toBe(400);
  });

  it("400 con un ítem 'seleccion_multiple' sin numOpciones", async () => {
    const auth = await tokenAdmin();
    const res = await postOcrIa(
      {
        paginas: [
          {
            id: "p1",
            imagen: IMAGEN_VALIDA,
            tipo: "items",
            items: [{ id: "x", formato: "seleccion_multiple", numero: 1 }],
          },
        ],
      },
      auth
    );
    expect(res.status).toBe(400);
  });

  it("400 con un ítem 'clasificar' con n pero sin numCategorias", async () => {
    const auth = await tokenAdmin();
    const res = await postOcrIa(
      {
        paginas: [
          {
            id: "p1",
            imagen: IMAGEN_VALIDA,
            tipo: "items",
            items: [{ id: "x", formato: "clasificar", numero: 1, n: 5 }],
          },
        ],
      },
      auth
    );
    expect(res.status).toBe(400);
  });

  it("400 con posicionesEnBlancoRespuesta en un formato que no es ordenar/clasificar", async () => {
    const auth = await tokenAdmin();
    const res = await postOcrIa(
      {
        paginas: [
          {
            id: "p1",
            imagen: IMAGEN_VALIDA,
            tipo: "items",
            items: [{ id: "x", formato: "abierto", numero: 1, numCasillas: 5, posicionesEnBlancoRespuesta: [1] }],
          },
        ],
      },
      auth
    );
    expect(res.status).toBe(400);
  });

  it("400 con una posición en posicionesEnBlancoCorreccion fuera de rango (> n)", async () => {
    const auth = await tokenAdmin();
    const res = await postOcrIa(
      {
        paginas: [
          {
            id: "p1",
            imagen: IMAGEN_VALIDA,
            tipo: "items",
            items: [{ id: "x", formato: "ordenar", numero: 1, n: 3, posicionesEnBlancoCorreccion: [4] }],
          },
        ],
      },
      auth
    );
    expect(res.status).toBe(400);
  });

  it("400 con longitudDetectadaRespuesta en un formato que no es abierto ni seleccion_multiple", async () => {
    const auth = await tokenAdmin();
    const res = await postOcrIa(
      {
        paginas: [
          {
            id: "p1",
            imagen: IMAGEN_VALIDA,
            tipo: "items",
            items: [{ id: "x", formato: "ordenar", numero: 1, n: 3, longitudDetectadaRespuesta: 2 }],
          },
        ],
      },
      auth
    );
    expect(res.status).toBe(400);
  });

  it("400 con longitudDetectadaRespuesta fuera de rango (> numCasillas)", async () => {
    const auth = await tokenAdmin();
    const res = await postOcrIa(
      {
        paginas: [
          {
            id: "p1",
            imagen: IMAGEN_VALIDA,
            tipo: "items",
            items: [{ id: "x", formato: "abierto", numero: 1, numCasillas: 5, longitudDetectadaRespuesta: 6 }],
          },
        ],
      },
      auth
    );
    expect(res.status).toBe(400);
  });

  it("400 con un ítem sin numero (posición impresa en el círculo)", async () => {
    const auth = await tokenAdmin();
    const res = await postOcrIa(
      { paginas: [{ id: "p1", imagen: IMAGEN_VALIDA, tipo: "items", items: [{ id: "x", formato: "opcion_multiple" }] }] },
      auth
    );
    expect(res.status).toBe(400);
  });

  it("400 con un ítem 'abierto' sin numCasillas", async () => {
    const auth = await tokenAdmin();
    const res = await postOcrIa(
      { paginas: [{ id: "p1", imagen: IMAGEN_VALIDA, tipo: "items", items: [{ id: "x", formato: "abierto", numero: 1 }] }] },
      auth
    );
    expect(res.status).toBe(400);
  });

  it("400 con página demografia sin campos, con mensaje específico (no genérico)", async () => {
    const auth = await tokenAdmin();
    const res = await postOcrIa({ paginas: [{ id: "p1", imagen: IMAGEN_VALIDA, tipo: "demografia", campos: [] }] }, auth);
    expect(res.status).toBe(400);
    const cuerpo = (await res.json()) as { error: string };
    expect(cuerpo.error).toMatch(/p1/);
    expect(cuerpo.error).toMatch(/campos/);
  });

  it("400 con página demografia con un campo desconocido", async () => {
    const auth = await tokenAdmin();
    const res = await postOcrIa(
      { paginas: [{ id: "p1", imagen: IMAGEN_VALIDA, tipo: "demografia", campos: ["no_existe"] }] },
      auth
    );
    expect(res.status).toBe(400);
  });

  it("400 con consentimiento/compromiso_honestidad como campos de demografía: nunca se piden a OCR-IA", async () => {
    const auth = await tokenAdmin();
    const res = await postOcrIa(
      {
        paginas: [
          { id: "p1", imagen: IMAGEN_VALIDA, tipo: "demografia", campos: ["consentimiento", "compromiso_honestidad"] },
        ],
      },
      auth
    );
    expect(res.status).toBe(400);
  });

  it("500 con mensaje claro si el Worker no tiene OPENAI_API_KEY configurada (aunque el body sea válido)", async () => {
    const auth = await tokenAdmin();
    const res = await postOcrIa({ paginas: [PAGINA_DEMOGRAFIA_VALIDA, PAGINA_ITEMS_VALIDA] }, auth);
    expect(res.status).toBe(500);
    const cuerpo = (await res.json()) as { error: string };
    expect(cuerpo.error).toMatch(/OPENAI_API_KEY/);
  });
});

// El esquema de Structured Outputs es lo que de verdad impide al modelo
// devolver valores fuera de formato (p. ej. "F) 7" en vez de "F", README
// §4.7) — se testea aquí directamente, sin pasar por la API de OpenAI, para
// no depender de una respuesta real del modelo para confirmar que el enum
// está bien construido.
describe("construirEsquemaCompleto: restringe cada campo a sus letras válidas", () => {
  function propiedad(esquema: ReturnType<typeof construirEsquemaCompleto>, clave: string) {
    return (esquema.properties as Record<string, unknown>)[clave];
  }

  // Cada pregunta es {respuesta_inicial, correccion}, ambas con la misma
  // forma — helper para no repetir el envoltorio en cada test.
  function bloqueRespuesta(pregunta: unknown, clave: "respuesta_inicial" | "correccion") {
    return (pregunta as { properties: Record<string, unknown> }).properties[clave];
  }

  it("los ítems se namespacean por NÚMERO de pregunta impreso, SIN prefijo de página ni item.id", () => {
    const esquema = construirEsquemaCompleto([
      {
        id: "p",
        imagen: "x",
        tipo: "items",
        items: [{ id: "id-interno-cualquiera", formato: "abierto", numero: 7, numCasillas: 5 }],
      },
    ]);
    expect(propiedad(esquema, "7")).toBeDefined();
    expect(propiedad(esquema, "p::7")).toBeUndefined();
    expect(propiedad(esquema, "id-interno-cualquiera")).toBeUndefined();
  });

  it("cada pregunta requiere respuesta_inicial y correccion, nada más", () => {
    const esquema = construirEsquemaCompleto([
      { id: "p", imagen: "x", tipo: "items", items: [{ id: "i", formato: "abierto", numero: 1, numCasillas: 5 }] },
    ]);
    const pregunta = propiedad(esquema, "1") as { required: string[]; additionalProperties: boolean };
    expect(pregunta.required.sort()).toEqual(["correccion", "respuesta_inicial"]);
    expect(pregunta.additionalProperties).toBe(false);
  });

  it("opcion_multiple: enum de A a la letra numOpciones-ésima más cadena vacía, o null", () => {
    const esquema = construirEsquemaCompleto([
      { id: "p", imagen: "x", tipo: "items", items: [{ id: "i", formato: "opcion_multiple", numero: 1, numOpciones: 3 }] },
    ]);
    const pregunta = propiedad(esquema, "1");
    expect(bloqueRespuesta(pregunta, "respuesta_inicial")).toEqual({
      anyOf: [{ type: "string", enum: ["", "A", "B", "C"] }, { type: "null" }],
    });
    expect(bloqueRespuesta(pregunta, "correccion")).toEqual(bloqueRespuesta(pregunta, "respuesta_inicial"));
  });

  it("opcion_multiple: posicionesEnBlancoRespuesta=[1] fuerza el bloque respuesta a null; el otro lado, sin nada detectado, TAMBIÉN se fuerza a una letra (única casilla posible por lado, 2 zonas sin término medio)", () => {
    const esquema = construirEsquemaCompleto([
      {
        id: "p",
        imagen: "x",
        tipo: "items",
        items: [{ id: "i", formato: "opcion_multiple", numero: 1, numOpciones: 3, posicionesEnBlancoRespuesta: [1] }],
      },
    ]);
    const pregunta = propiedad(esquema, "1");
    expect(bloqueRespuesta(pregunta, "respuesta_inicial")).toEqual({ type: "null" });
    expect(bloqueRespuesta(pregunta, "correccion")).toEqual({ type: "string", enum: ["A", "B", "C"] });
  });

  it("seleccion_multiple: patrón que admite letras válidas y espacios, sin límite de longitud, o null", () => {
    const esquema = construirEsquemaCompleto([
      {
        id: "p",
        imagen: "x",
        tipo: "items",
        items: [{ id: "i", formato: "seleccion_multiple", numero: 1, numOpciones: 4 }],
      },
    ]);
    const pregunta = propiedad(esquema, "1");
    expect(bloqueRespuesta(pregunta, "respuesta_inicial")).toEqual({
      anyOf: [{ type: "string", pattern: "^[A-D ]*$" }, { type: "null" }],
    });
  });

  it("seleccion_multiple: longitudDetectadaRespuesta fuerza la longitud EXACTA detectada (minLength=maxLength), no un techo con margen (issue #37, 2 zonas)", () => {
    const esquema = construirEsquemaCompleto([
      {
        id: "p",
        imagen: "x",
        tipo: "items",
        items: [{ id: "i", formato: "seleccion_multiple", numero: 1, numOpciones: 4, longitudDetectadaRespuesta: 2 }],
      },
    ]);
    const pregunta = propiedad(esquema, "1");
    expect(bloqueRespuesta(pregunta, "respuesta_inicial")).toEqual({
      type: "string",
      minLength: 2,
      maxLength: 2,
      pattern: "^[A-D ]{2}$",
    });
    // El otro lado, sin nada detectado, sigue con el esquema permisivo normal.
    expect(bloqueRespuesta(pregunta, "correccion")).toEqual({
      anyOf: [{ type: "string", pattern: "^[A-D ]*$" }, { type: "null" }],
    });
  });

  it("seleccion_multiple: longitudDetectadaRespuesta=0 fuerza null (ninguna casilla con tinta)", () => {
    const esquema = construirEsquemaCompleto([
      {
        id: "p",
        imagen: "x",
        tipo: "items",
        items: [{ id: "i", formato: "seleccion_multiple", numero: 1, numOpciones: 4, longitudDetectadaRespuesta: 0 }],
      },
    ]);
    expect(bloqueRespuesta(propiedad(esquema, "1"), "respuesta_inicial")).toEqual({ type: "null" });
  });

  it("ordenar: cada posición admite la letra de un elemento propio o cadena vacía (n == numOpciones), o null entero", () => {
    const esquema = construirEsquemaCompleto([
      { id: "p", imagen: "x", tipo: "items", items: [{ id: "i", formato: "ordenar", numero: 1, n: 3 }] },
    ]);
    const pregunta = propiedad(esquema, "1");
    const bloque = bloqueRespuesta(pregunta, "respuesta_inicial") as {
      anyOf: [{ properties: Record<string, unknown> }, { type: string }];
    };
    expect(bloque.anyOf[1]).toEqual({ type: "null" });
    expect(bloque.anyOf[0].properties["1"]).toEqual({ type: "string", pattern: "^[A-C]?$" });
    expect(bloque.anyOf[0].properties["3"]).toEqual({ type: "string", pattern: "^[A-C]?$" });
  });

  it("ordenar: posicionesEnBlancoRespuesta fuerza esas posiciones a SOLO cadena vacía; TODAS LAS DEMÁS se fuerzan a una letra, sin '?' (2 zonas, issue #37)", () => {
    const esquema = construirEsquemaCompleto([
      {
        id: "p",
        imagen: "x",
        tipo: "items",
        items: [{ id: "i", formato: "ordenar", numero: 1, n: 3, posicionesEnBlancoRespuesta: [2] }],
      },
    ]);
    const pregunta = propiedad(esquema, "1");
    const bloque = bloqueRespuesta(pregunta, "respuesta_inicial") as { properties: Record<string, unknown> };
    expect(bloque.properties["2"]).toEqual({ type: "string", enum: [""] });
    expect(bloque.properties["1"]).toEqual({ type: "string", pattern: "^[A-C]$" });
    expect(bloque.properties["3"]).toEqual({ type: "string", pattern: "^[A-C]$" });
  });

  it("ordenar: posicionesEnBlancoRespuesta y posicionesEnBlancoCorreccion se aplican por SEPARADO a cada bloque", () => {
    const esquema = construirEsquemaCompleto([
      {
        id: "p",
        imagen: "x",
        tipo: "items",
        items: [
          { id: "i", formato: "ordenar", numero: 1, n: 3, posicionesEnBlancoRespuesta: [1], posicionesEnBlancoCorreccion: [3] },
        ],
      },
    ]);
    const pregunta = propiedad(esquema, "1");
    const respuesta = bloqueRespuesta(pregunta, "respuesta_inicial") as { properties: Record<string, unknown> };
    const correccion = bloqueRespuesta(pregunta, "correccion") as { properties: Record<string, unknown> };
    expect(respuesta.properties["1"]).toEqual({ type: "string", enum: [""] });
    expect(respuesta.properties["3"]).toEqual({ type: "string", pattern: "^[A-C]$" });
    expect(correccion.properties["1"]).toEqual({ type: "string", pattern: "^[A-C]$" });
    expect(correccion.properties["3"]).toEqual({ type: "string", enum: [""] });
  });

  it("ordenar: si posicionesEnBlancoRespuesta cubre TODAS las posiciones, el bloque entero se fuerza a null (no un objeto con todo en '')", () => {
    const esquema = construirEsquemaCompleto([
      {
        id: "p",
        imagen: "x",
        tipo: "items",
        items: [{ id: "i", formato: "ordenar", numero: 1, n: 3, posicionesEnBlancoRespuesta: [1, 2, 3] }],
      },
    ]);
    expect(bloqueRespuesta(propiedad(esquema, "1"), "respuesta_inicial")).toEqual({ type: "null" });
  });

  it("ordenar: posicionesEnBlancoRespuesta=[] (detección activa pero ninguna posición vacía) fuerza TODAS las posiciones a una letra", () => {
    const esquema = construirEsquemaCompleto([
      {
        id: "p",
        imagen: "x",
        tipo: "items",
        items: [{ id: "i", formato: "ordenar", numero: 1, n: 3, posicionesEnBlancoRespuesta: [] }],
      },
    ]);
    const bloque = bloqueRespuesta(propiedad(esquema, "1"), "respuesta_inicial") as { properties: Record<string, unknown> };
    expect(bloque.properties["1"]).toEqual({ type: "string", pattern: "^[A-C]$" });
    expect(bloque.properties["2"]).toEqual({ type: "string", pattern: "^[A-C]$" });
    expect(bloque.properties["3"]).toEqual({ type: "string", pattern: "^[A-C]$" });
  });

  it("clasificar: posicionesEnBlancoRespuesta usa las letras de CATEGORÍA para las posiciones no forzadas (distinto de n)", () => {
    const esquema = construirEsquemaCompleto([
      {
        id: "p",
        imagen: "x",
        tipo: "items",
        items: [{ id: "i", formato: "clasificar", numero: 1, n: 5, numCategorias: 2, posicionesEnBlancoRespuesta: [3] }],
      },
    ]);
    const bloque = bloqueRespuesta(propiedad(esquema, "1"), "respuesta_inicial") as { properties: Record<string, unknown> };
    expect(bloque.properties["3"]).toEqual({ type: "string", enum: [""] });
    expect(bloque.properties["1"]).toEqual({ type: "string", pattern: "^[A-B]$" }); // numCategorias=2, no n=5
  });

  it("clasificar: cada elemento restringido a las letras de CATEGORÍA (distinto de n)", () => {
    const esquema = construirEsquemaCompleto([
      {
        id: "p",
        imagen: "x",
        tipo: "items",
        items: [{ id: "i", formato: "clasificar", numero: 1, n: 5, numCategorias: 2 }],
      },
    ]);
    const pregunta = propiedad(esquema, "1");
    const bloque = bloqueRespuesta(pregunta, "respuesta_inicial") as {
      anyOf: [{ properties: Record<string, unknown> }, { type: string }];
    };
    expect(Object.keys(bloque.anyOf[0].properties)).toHaveLength(5); // n=5 elementos
    expect(bloque.anyOf[0].properties["1"]).toEqual({ type: "string", pattern: "^[A-B]?$" }); // numCategorias=2
  });

  it("abierto: string con tope de longitud (maxLength=numCasillas, SIN minLength), alfabeto restringido, o null — nunca admite \\n", () => {
    const esquema = construirEsquemaCompleto([
      { id: "p", imagen: "x", tipo: "items", items: [{ id: "i", formato: "abierto", numero: 1, numCasillas: 20 }] },
    ]);
    const pregunta = propiedad(esquema, "1");
    // Deliberadamente sin minLength ni patrón de longitud exacta: forzar
    // exactamente numCasillas caracteres (probado contra la API real) hacía
    // que el modelo rellenara el resto con basura inventada en vez de
    // espacios cuando la respuesta real era más corta que las casillas
    // impresas — ver el comentario junto a esquemaCampoRespuestaItem.
    expect(bloqueRespuesta(pregunta, "respuesta_inicial")).toEqual({
      anyOf: [{ type: "string", maxLength: 20, pattern: "^[A-Z0-9ÁÉÍÓÚÜÑ /]{0,20}$" }, { type: "null" }],
    });
  });

  it("abierto: longitudDetectadaRespuesta fuerza la longitud EXACTA detectada (minLength=maxLength), no un techo con margen (issue #37, 2 zonas)", () => {
    const esquema = construirEsquemaCompleto([
      {
        id: "p",
        imagen: "x",
        tipo: "items",
        items: [{ id: "i", formato: "abierto", numero: 1, numCasillas: 20, longitudDetectadaRespuesta: 5 }],
      },
    ]);
    const pregunta = propiedad(esquema, "1");
    expect(bloqueRespuesta(pregunta, "respuesta_inicial")).toEqual({
      type: "string",
      minLength: 5,
      maxLength: 5,
      pattern: "^[A-Z0-9ÁÉÍÓÚÜÑ /]{5}$",
    });
    // El otro lado, sin nada detectado, sigue con el esquema normal (0..numCasillas, sin minLength).
    expect(bloqueRespuesta(pregunta, "correccion")).toEqual({
      anyOf: [{ type: "string", maxLength: 20, pattern: "^[A-Z0-9ÁÉÍÓÚÜÑ /]{0,20}$" }, { type: "null" }],
    });
  });

  it("abierto: longitudDetectadaRespuesta puede llegar hasta numCasillas (el tramo cubre toda la casilla)", () => {
    const esquema = construirEsquemaCompleto([
      {
        id: "p",
        imagen: "x",
        tipo: "items",
        items: [{ id: "i", formato: "abierto", numero: 1, numCasillas: 6, longitudDetectadaRespuesta: 6 }],
      },
    ]);
    const bloque = bloqueRespuesta(propiedad(esquema, "1"), "respuesta_inicial") as {
      minLength: number;
      maxLength: number;
    };
    expect(bloque.minLength).toBe(6);
    expect(bloque.maxLength).toBe(6);
  });

  it("abierto: longitudDetectadaRespuesta=0 fuerza null (ninguna casilla con tinta)", () => {
    const esquema = construirEsquemaCompleto([
      {
        id: "p",
        imagen: "x",
        tipo: "items",
        items: [{ id: "i", formato: "abierto", numero: 1, numCasillas: 20, longitudDetectadaRespuesta: 0 }],
      },
    ]);
    expect(bloqueRespuesta(propiedad(esquema, "1"), "respuesta_inicial")).toEqual({ type: "null" });
  });

  it("abierto: el tope de longitud viaja con cada ítem (dos ítems, dos longitudes distintas)", () => {
    const esquema = construirEsquemaCompleto([
      {
        id: "p",
        imagen: "x",
        tipo: "items",
        items: [
          { id: "i1", formato: "abierto", numero: 1, numCasillas: 4 },
          { id: "i2", formato: "abierto", numero: 2, numCasillas: 40 },
        ],
      },
    ]);
    const p1 = bloqueRespuesta(propiedad(esquema, "1"), "respuesta_inicial") as { anyOf: [{ maxLength: number }] };
    const p2 = bloqueRespuesta(propiedad(esquema, "2"), "respuesta_inicial") as { anyOf: [{ maxLength: number }] };
    expect(p1.anyOf[0].maxLength).toBe(4);
    expect(p2.anyOf[0].maxLength).toBe(40);
  });

  it("demografía: catálogo restringido a su propio nº de opciones (sexo tiene 3), con posibilidad de null", () => {
    const esquema = construirEsquemaCompleto([{ id: "p", imagen: "x", tipo: "demografia", campos: ["sexo"] }]);
    expect(propiedad(esquema, "p::sexo")).toEqual({
      anyOf: [{ type: "string", enum: ["A", "B", "C"] }, { type: "null" }],
    });
  });

  it("demografía: anio_nacimiento restringido a dígitos, máximo 4, con posibilidad de null", () => {
    const esquema = construirEsquemaCompleto([
      { id: "p", imagen: "x", tipo: "demografia", campos: ["anio_nacimiento"] },
    ]);
    expect(propiedad(esquema, "p::anio_nacimiento")).toEqual({
      anyOf: [{ type: "string", pattern: "^[0-9]{0,4}$" }, { type: "null" }],
    });
  });
});

// El ejemplo de una sola vez (few-shot, issue #31) solo aporta algo en
// páginas de ítems (es donde se documentó la alucinación) — en demografía
// solo añadiría coste de tokens sin ningún beneficio medido (ya en 100%).
describe("construirMensajesEjemplo", () => {
  const PAGINA_DEMOGRAFIA = { id: "p1", imagen: "x", tipo: "demografia" as const, campos: ["sexo"] };
  const PAGINA_ITEMS = {
    id: "p2",
    imagen: "x",
    tipo: "items" as const,
    items: [{ id: "i", formato: "abierto" as const, numero: 1, numCasillas: 5 }],
  };

  it("no añade nada si ninguna página es de tipo items", () => {
    expect(construirMensajesEjemplo([PAGINA_DEMOGRAFIA])).toEqual([]);
  });

  it("añade un turno user+assistant si hay alguna página de tipo items", () => {
    const mensajes = construirMensajesEjemplo([PAGINA_ITEMS]);
    expect(mensajes).toHaveLength(2);
    expect(mensajes[0].role).toBe("user");
    expect(mensajes[1].role).toBe("assistant");
  });

  it("añade el ejemplo también en peticiones mixtas (demografía + items)", () => {
    expect(construirMensajesEjemplo([PAGINA_DEMOGRAFIA, PAGINA_ITEMS])).toHaveLength(2);
  });

  it("el turno assistant es JSON válido con las 6 preguntas del ejemplo", () => {
    const [, mensajeAssistant] = construirMensajesEjemplo([PAGINA_ITEMS]);
    const respuesta = JSON.parse(mensajeAssistant.content as string);
    expect(Object.keys(respuesta).sort()).toEqual(["1", "2", "3", "4", "5", "6"]);
    expect(respuesta["2"]).toEqual({ respuesta_inicial: null, correccion: null });
    expect(respuesta["6"]).toEqual({ respuesta_inicial: null, correccion: null });
  });
});
