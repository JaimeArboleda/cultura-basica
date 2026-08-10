import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { bancoItems } from "../src/items";
import { AREA_ESTUDIOS, CCAA, LIBROS_EN_CASA, NIVEL_ESTUDIOS, SEXO } from "../src/tipos";

function demografiaValida() {
  return {
    anio_nacimiento: 1990,
    sexo: SEXO[0],
    ccaa_educacion_secundaria: CCAA[0],
    nivel_estudios: NIVEL_ESTUDIOS[4],
    area_estudios: AREA_ESTUDIOS[2],
    estudios_mayor_progenitor: NIVEL_ESTUDIOS[3],
    libros_en_casa: LIBROS_EN_CASA[2],
  };
}

async function postJson(path: string, body: unknown) {
  return SELF.fetch(`http://worker.test${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function crearSesionDeTest() {
  const res = await postJson("/api/sesion", {
    consentimiento: true,
    compromiso_honestidad: true,
    user_agent_clase: "escritorio",
    demografia: demografiaValida(),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as { sesion_id: string; items: { id: string; formato: string }[] };
}

describe("POST /api/sesion", () => {
  it("crea una sesión y devuelve 25 ítems sin respuestas correctas", async () => {
    const { sesion_id, items } = await crearSesionDeTest();
    expect(sesion_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(items.length).toBe(25);
    for (const item of items) {
      expect(item).not.toHaveProperty("respuesta_canonica");
      expect(item).not.toHaveProperty("indice_correcto");
      expect(item).not.toHaveProperty("opciones_correctas");
      expect(item).not.toHaveProperty("elementos_ordenados");
      expect(item).not.toHaveProperty("clasificacion_correcta");
    }
  });

  it("rechaza sin consentimiento", async () => {
    const res = await postJson("/api/sesion", {
      consentimiento: false,
      compromiso_honestidad: true,
      user_agent_clase: "escritorio",
      demografia: demografiaValida(),
    });
    expect(res.status).toBe(400);
  });

  it("rechaza demografía con valores fuera de catálogo", async () => {
    const res = await postJson("/api/sesion", {
      consentimiento: true,
      compromiso_honestidad: true,
      user_agent_clase: "escritorio",
      demografia: { ...demografiaValida(), nivel_estudios: "invalido" },
    });
    expect(res.status).toBe(400);
  });

  it("rechaza demografía con sexo fuera de catálogo", async () => {
    const res = await postJson("/api/sesion", {
      consentimiento: true,
      compromiso_honestidad: true,
      user_agent_clase: "escritorio",
      demografia: { ...demografiaValida(), sexo: "invalido" },
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/respuesta", () => {
  it("corrige, persiste y es idempotente por sesion_id+item_id", async () => {
    const { sesion_id, items } = await crearSesionDeTest();
    const itemPublico = items.find((i) => i.formato === "opcion_multiple")!;
    const itemReal = bancoItems.find((i) => i.id === itemPublico.id)!;

    const primera = await postJson("/api/respuesta", {
      sesion_id,
      item_id: itemReal.id,
      respuesta: itemReal.indice_correcto,
      t_ms: 1200,
      perdio_foco: false,
    });
    expect(primera.status).toBe(200);
    const cuerpo = await primera.json();
    expect(cuerpo).toEqual({ acierto: 1, estado_correccion: "auto" });

    // Reenviar la misma respuesta no debe duplicar la fila.
    await postJson("/api/respuesta", {
      sesion_id,
      item_id: itemReal.id,
      respuesta: itemReal.indice_correcto,
      t_ms: 1300,
      perdio_foco: false,
    });

    const conteo = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM respuestas WHERE sesion_id = ? AND item_id = ?"
    )
      .bind(sesion_id, itemReal.id)
      .first<{ n: number }>();
    expect(conteo?.n).toBe(1);
  });

  it("rechaza un item_id que no pertenece al sorteo de la sesión", async () => {
    const { sesion_id } = await crearSesionDeTest();

    const res = await postJson("/api/respuesta", {
      sesion_id,
      item_id: "NO-EXISTE-99",
      respuesta: "cualquier cosa",
      t_ms: 100,
      perdio_foco: false,
    });
    expect(res.status).toBe(403);
  });

  it("corrige correctamente un ítem ordenar y uno clasificar", async () => {
    const { sesion_id, items } = await crearSesionDeTest();

    const itemOrdenarPublico = items.find((i) => i.formato === "ordenar");
    if (itemOrdenarPublico) {
      const real = bancoItems.find((i) => i.id === itemOrdenarPublico.id)!;
      const res = await postJson("/api/respuesta", {
        sesion_id,
        item_id: real.id,
        respuesta: real.elementos_ordenados,
        t_ms: 500,
        perdio_foco: false,
      });
      expect((await res.json())).toEqual({ acierto: 1, estado_correccion: "auto" });
    }

    const itemClasificarPublico = items.find((i) => i.formato === "clasificar");
    if (itemClasificarPublico) {
      const real = bancoItems.find((i) => i.id === itemClasificarPublico.id)!;
      const res = await postJson("/api/respuesta", {
        sesion_id,
        item_id: real.id,
        respuesta: real.clasificacion_correcta,
        t_ms: 500,
        perdio_foco: false,
      });
      expect((await res.json())).toEqual({ acierto: 1, estado_correccion: "auto" });
    }

    const itemSeleccionPublico = items.find((i) => i.formato === "seleccion_multiple");
    if (itemSeleccionPublico) {
      const real = bancoItems.find((i) => i.id === itemSeleccionPublico.id)!;
      const res = await postJson("/api/respuesta", {
        sesion_id,
        item_id: real.id,
        respuesta: real.opciones_correctas,
        t_ms: 500,
        perdio_foco: false,
      });
      expect((await res.json())).toEqual({ acierto: 1, estado_correccion: "auto" });
    }
  });
});

async function completarTest(sesionId: string, items: { id: string; formato: string }[]) {
  for (const itemPublico of items) {
    const real = bancoItems.find((i) => i.id === itemPublico.id)!;
    const respuesta =
      real.formato === "opcion_multiple"
        ? real.indice_correcto
        : real.formato === "seleccion_multiple"
          ? real.opciones_correctas
          : real.formato === "ordenar"
            ? real.elementos_ordenados
            : real.formato === "clasificar"
              ? real.clasificacion_correcta
              : real.respuesta_canonica;
    await postJson("/api/respuesta", {
      sesion_id: sesionId,
      item_id: real.id,
      respuesta,
      t_ms: 500,
      perdio_foco: false,
    });
  }
}

describe("GET /api/resultado/:id", () => {
  it("404 para una sesión inexistente", async () => {
    const res = await SELF.fetch("http://worker.test/api/resultado/no-existe");
    expect(res.status).toBe(404);
  });

  it("modo en_progreso mientras el test no está completo", async () => {
    const { sesion_id } = await crearSesionDeTest();
    const res = await SELF.fetch(`http://worker.test/api/resultado/${sesion_id}`);
    const body = (await res.json()) as { estado: string; items_pendientes: unknown[] };
    expect(body.estado).toBe("en_progreso");
    expect(body.items_pendientes.length).toBe(25);
  });

  it("modo completo tras responder los 25 ítems: sin otras sesiones no hay percentil que calcular", async () => {
    const { sesion_id, items } = await crearSesionDeTest();
    await completarTest(sesion_id, items);

    const res = await SELF.fetch(`http://worker.test/api/resultado/${sesion_id}`);
    const body = (await res.json()) as {
      estado: string;
      resultado: { primera: boolean; percentil?: number };
    };
    expect(body.estado).toBe("completo");
    // No se asume aislamiento de almacenamiento entre tests de este fichero, así que
    // no se puede garantizar que esta sea la primera sesión completada: solo se
    // comprueba la forma de la respuesta (percentil ausente sii primera=true).
    expect(typeof body.resultado.primera).toBe("boolean");
    expect(body.resultado.primera === true ? body.resultado.percentil === undefined : typeof body.resultado.percentil === "number").toBe(true);
  });

  it("percentil empírico frente a otra sesión ya completada", async () => {
    const perfecta = await crearSesionDeTest();
    await completarTest(perfecta.sesion_id, perfecta.items);

    const vacia = await crearSesionDeTest();
    for (const item of vacia.items) {
      const real = bancoItems.find((i) => i.id === item.id)!;
      const respuestaIncorrecta =
        real.formato === "opcion_multiple"
          ? (real.indice_correcto! + 1) % 6
          : real.formato === "seleccion_multiple"
            ? []
            : real.formato === "ordenar"
              ? [...real.elementos!].reverse()
              : real.formato === "clasificar"
                ? {}
                : "";
      await postJson("/api/respuesta", {
        sesion_id: vacia.sesion_id,
        item_id: real.id,
        respuesta: respuestaIncorrecta,
        t_ms: 500,
        perdio_foco: false,
      });
    }

    const resVacia = await SELF.fetch(`http://worker.test/api/resultado/${vacia.sesion_id}`);
    const bodyVacia = (await resVacia.json()) as { resultado: { primera: boolean; percentil?: number } };
    expect(bodyVacia.resultado.primera).toBe(false);

    const resPerfecta = await SELF.fetch(`http://worker.test/api/resultado/${perfecta.sesion_id}`);
    const bodyPerfecta = (await resPerfecta.json()) as { resultado: { primera: boolean; percentil?: number } };
    // No se asume aislamiento de almacenamiento entre tests de este fichero: se
    // compara en relativo (la sesión perfecta debe quedar muy por encima de la
    // vacía) en vez de fijar percentiles exactos que dependerían de qué otras
    // sesiones haya creado el resto de tests.
    expect(bodyPerfecta.resultado.percentil!).toBeGreaterThan(bodyVacia.resultado.percentil!);
  });

  it("incluye la revisión completa (enunciado, respuesta correcta y del usuario) cuando el test está completo", async () => {
    const { sesion_id, items } = await crearSesionDeTest();
    await completarTest(sesion_id, items);

    const res = await SELF.fetch(`http://worker.test/api/resultado/${sesion_id}`);
    const body = (await res.json()) as {
      revision: {
        id: string;
        formato: string;
        enunciado: string;
        acierto: number;
        respuesta_usuario: unknown;
        respuesta_correcta: unknown;
      }[];
    };

    expect(body.revision.length).toBe(25);
    // completarTest() siempre responde con la respuesta correcta, así que la
    // revisión entera debe salir marcada como acierto.
    for (const fila of body.revision) {
      const real = bancoItems.find((i) => i.id === fila.id)!;
      expect(fila.acierto).toBe(1);
      expect(fila.enunciado).toBe(real.enunciado);
      expect(fila.respuesta_usuario).not.toBeNull();
    }
  });
});

describe("GET /api/export", () => {
  it("401 sin token o con token incorrecto", async () => {
    const sinToken = await SELF.fetch("http://worker.test/api/export");
    expect(sinToken.status).toBe(401);

    const tokenMalo = await SELF.fetch("http://worker.test/api/export?token=incorrecto");
    expect(tokenMalo.status).toBe(401);
  });

  it("200 con el token correcto", async () => {
    await crearSesionDeTest();
    const res = await SELF.fetch("http://worker.test/api/export?token=token-de-test&formato=json");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sesiones: unknown[] };
    expect(body.sesiones.length).toBeGreaterThan(0);
  });
});
