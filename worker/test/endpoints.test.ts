import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { bancoItems } from "../src/items";
import {
  AREA_ESTUDIOS,
  CCAA,
  CONSUMO_INFORMATIVOS,
  FRECUENCIA_LECTURA,
  HORAS_REDES_DIA,
  LIBROS_EN_CASA,
  NIVEL_ESTUDIOS,
  PROFESION,
  SEXO,
} from "../src/tipos";

function demografiaValida() {
  return {
    anio_nacimiento: 1990,
    sexo: SEXO[0],
    pais_nacimiento: "España",
    ccaa_nacimiento: CCAA[0],
    ccaa_residencia: CCAA[0],
    nivel_estudios: NIVEL_ESTUDIOS[4],
    area_estudios: AREA_ESTUDIOS[2],
    profesion: PROFESION[1],
    estudios_padre: NIVEL_ESTUDIOS[3],
    estudios_madre: NIVEL_ESTUDIOS[3],
    libros_en_casa: LIBROS_EN_CASA[2],
    frecuencia_lectura: FRECUENCIA_LECTURA[3],
    consumo_informativos: CONSUMO_INFORMATIVOS[2],
    horas_redes_dia: HORAS_REDES_DIA[1],
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
  it("crea una sesión y devuelve 30 ítems sin respuestas correctas", async () => {
    const { sesion_id, items } = await crearSesionDeTest();
    expect(sesion_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(items.length).toBe(30);
    for (const item of items) {
      expect(item).not.toHaveProperty("respuesta_canonica");
      expect(item).not.toHaveProperty("indice_correcto");
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
    const { sesion_id, items } = await crearSesionDeTest();
    const idsSorteados = new Set(items.map((i) => i.id));
    const itemAjeno = bancoItems.find((i) => !idsSorteados.has(i.id))!;

    const res = await postJson("/api/respuesta", {
      sesion_id,
      item_id: itemAjeno.id,
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
  });
});

describe("POST /api/extender", () => {
  async function completarModoCorto(sesionId: string, items: { id: string; formato: string }[]) {
    for (const itemPublico of items) {
      const real = bancoItems.find((i) => i.id === itemPublico.id)!;
      const respuesta =
        real.formato === "opcion_multiple"
          ? real.indice_correcto
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

  it("rechaza si el modo corto no está completo", async () => {
    const { sesion_id } = await crearSesionDeTest();
    const res = await postJson("/api/extender", { sesion_id, acepta: true });
    expect(res.status).toBe(400);
  });

  it("acepta=false no crea sorteo de extensión", async () => {
    const { sesion_id, items } = await crearSesionDeTest();
    await completarModoCorto(sesion_id, items);

    const res = await postJson("/api/extender", { sesion_id, acepta: false });
    expect(res.status).toBe(200);
    expect((await res.json())).toEqual({ items: [] });
  });

  it("acepta=true crea exactamente 90 ítems y es idempotente ante llamadas repetidas", async () => {
    const { sesion_id, items } = await crearSesionDeTest();
    await completarModoCorto(sesion_id, items);

    const res1 = await postJson("/api/extender", { sesion_id, acepta: true });
    const body1 = (await res1.json()) as { items: unknown[] };
    expect(body1.items.length).toBe(90);

    const res2 = await postJson("/api/extender", { sesion_id, acepta: true });
    const body2 = (await res2.json()) as { items: { id: string }[] };
    expect(body2.items.length).toBe(90);
    expect(body2.items.map((i) => i.id)).toEqual(
      (body1.items as { id: string }[]).map((i) => i.id)
    );
  });
});

describe("GET /api/resultado/:id", () => {
  it("404 para una sesión inexistente", async () => {
    const res = await SELF.fetch("http://worker.test/api/resultado/no-existe");
    expect(res.status).toBe(404);
  });

  it("modo en_progreso mientras el corto no está completo", async () => {
    const { sesion_id } = await crearSesionDeTest();
    const res = await SELF.fetch(`http://worker.test/api/resultado/${sesion_id}`);
    const body = (await res.json()) as { estado: string; items_pendientes: unknown[] };
    expect(body.estado).toBe("en_progreso");
    expect(body.items_pendientes.length).toBe(30);
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
