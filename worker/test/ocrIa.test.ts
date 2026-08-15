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
import { construirEsquemaCompleto } from "../src/endpoints/admin/ocrIa";

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

  it("400 con un ítem sin numero (posición impresa en el círculo)", async () => {
    const auth = await tokenAdmin();
    const res = await postOcrIa(
      { paginas: [{ id: "p1", imagen: IMAGEN_VALIDA, tipo: "items", items: [{ id: "x", formato: "opcion_multiple" }] }] },
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

  it("acepta consentimiento/compromiso_honestidad como campos de demografía válidos (antes solo OMR)", async () => {
    const auth = await tokenAdmin();
    const res = await postOcrIa(
      {
        paginas: [
          { id: "p1", imagen: IMAGEN_VALIDA, tipo: "demografia", campos: ["consentimiento", "compromiso_honestidad"] },
        ],
      },
      auth
    );
    // Body válido: sin OPENAI_API_KEY en el entorno de test, el 400 de validación
    // ya no debería dispararse — solo el 500 de "falta la API key" más abajo.
    expect(res.status).toBe(500);
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

  it("opcion_multiple: enum de A a la letra numOpciones-ésima, nada más", () => {
    const esquema = construirEsquemaCompleto([
      { id: "p", imagen: "x", tipo: "items", items: [{ id: "i", formato: "opcion_multiple", numero: 1, numOpciones: 3 }] },
    ]);
    expect(propiedad(esquema, "p::i")).toEqual({ type: "string", enum: ["A", "B", "C"] });
  });

  it("seleccion_multiple: patrón limitado a las letras válidas y a la longitud máxima", () => {
    const esquema = construirEsquemaCompleto([
      {
        id: "p",
        imagen: "x",
        tipo: "items",
        items: [{ id: "i", formato: "seleccion_multiple", numero: 1, numOpciones: 4 }],
      },
    ]);
    expect(propiedad(esquema, "p::i")).toEqual({ type: "string", pattern: "^[A-D]{0,4}$" });
  });

  it("ordenar: cada posición restringida a las letras de los propios elementos (n == numOpciones)", () => {
    const esquema = construirEsquemaCompleto([
      { id: "p", imagen: "x", tipo: "items", items: [{ id: "i", formato: "ordenar", numero: 1, n: 3 }] },
    ]);
    const propOrden = propiedad(esquema, "p::i") as { properties: Record<string, unknown> };
    expect(propOrden.properties["1"]).toEqual({ type: "string", enum: ["A", "B", "C"] });
    expect(propOrden.properties["3"]).toEqual({ type: "string", enum: ["A", "B", "C"] });
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
    const propClasificar = propiedad(esquema, "p::i") as { properties: Record<string, unknown> };
    expect(Object.keys(propClasificar.properties)).toHaveLength(5); // n=5 elementos
    expect(propClasificar.properties["1"]).toEqual({ type: "string", enum: ["A", "B"] }); // numCategorias=2
  });

  it("demografía: catálogo restringido a su propio nº de opciones (sexo tiene 4)", () => {
    const esquema = construirEsquemaCompleto([{ id: "p", imagen: "x", tipo: "demografia", campos: ["sexo"] }]);
    expect(propiedad(esquema, "p::sexo")).toEqual({ type: "string", enum: ["A", "B", "C", "D"] });
  });

  it("demografía: anio_nacimiento restringido a dígitos, máximo 4", () => {
    const esquema = construirEsquemaCompleto([
      { id: "p", imagen: "x", tipo: "demografia", campos: ["anio_nacimiento"] },
    ]);
    expect(propiedad(esquema, "p::anio_nacimiento")).toEqual({ type: "string", pattern: "^[0-9]{0,4}$" });
  });

  it("demografía: checkboxes siguen restringidas a SI/NO", () => {
    const esquema = construirEsquemaCompleto([
      { id: "p", imagen: "x", tipo: "demografia", campos: ["consentimiento"] },
    ]);
    expect(propiedad(esquema, "p::consentimiento")).toEqual({ type: "string", enum: ["SI", "NO"] });
  });
});
