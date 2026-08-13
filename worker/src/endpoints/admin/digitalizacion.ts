// Digitalización de tests rellenados en papel (README §4.7): el panel de admin
// genera una hoja de respuestas de tipo OMR (casillas a rellenar) + unos pocos
// recuadros de texto libre para los ítems 'abierto', y esta pieza recibe ya la
// interpretación hecha en el navegador del admin (bubbles decodificadas +
// OCR de Tesseract.js sobre los recuadros de texto, public/admin/digitalizar.js)
// para convertirla en una sesión normal — misma corrección y puntuación que
// una sesión respondida en la web, solo cambia de dónde vino la respuesta cruda.
import { crearSesion, marcarCompleto, obtenerToken, upsertRespuesta } from "../../db";
import { corregirRespuesta } from "../../correccion";
import { error, json } from "../../http";
import { bancoItems, itemsPorId, paraCliente } from "../../items";
import { puntuarItem, puntuarSesion } from "../../puntuacion";
import { ordenarTest } from "../../sorteo";
import type { Env } from "../../tipos";
import { validarDemografia } from "../../validacion";

// GET /api/admin/items-impresion: el banco completo en el orden fijo de
// presentación (README §1.4), sin respuestas correctas — para que
// public/admin/hoja.js pueda generar la hoja imprimible. Reutiliza exactamente
// paraCliente()/ordenarTest(), los mismos que usa POST /api/sesion, así que la
// hoja impresa siempre coincide con lo que ve quien hace el test en la web.
export async function getItemsImpresion(env: Env): Promise<Response> {
  const asignaciones = ordenarTest(bancoItems);
  const items = asignaciones.map((a) => paraCliente(itemsPorId.get(a.item_id)!));
  return json(env, { items });
}

export async function postDigitalizacion(request: Request, env: Env): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return error(env, 400, "JSON inválido");
  }
  const b = body as Record<string, unknown>;

  const tokenId = typeof b.token_id === "string" ? b.token_id : "";
  if (!tokenId) {
    return error(env, 400, "Falta token_id (a qué remesa pertenece esta hoja)");
  }
  const token = await obtenerToken(env, tokenId);
  if (!token) {
    return error(env, 404, "Token no encontrado");
  }

  // A diferencia de POST /api/sesion, aquí NO se comprueba caducidad: la hoja
  // de papel se pudo rellenar dentro de la ventana de validez del token y
  // digitalizarse después de que caducara. El token solo tiene que existir,
  // para la referencia (remesa) y la FK de sesiones.token_id.
  if (b.consentimiento !== true || b.compromiso_honestidad !== true) {
    return error(
      env,
      400,
      "La hoja debe tener marcadas las casillas de consentimiento y compromiso de honestidad"
    );
  }

  const demografia = validarDemografia(b.demografia);
  if (!demografia) {
    return error(env, 400, "Demografía inválida o incompleta");
  }

  const respuestasEntrada = b.respuestas;
  if (typeof respuestasEntrada !== "object" || respuestasEntrada === null || Array.isArray(respuestasEntrada)) {
    return error(env, 400, "respuestas debe ser un objeto item_id -> respuesta");
  }
  const mapaRespuestas = respuestasEntrada as Record<string, unknown>;

  const id = crypto.randomUUID();
  const asignaciones = ordenarTest(bancoItems);
  const creadaEn = new Date().toISOString();

  await crearSesion(env, {
    id,
    creadaEn,
    demografia,
    userAgentClase: null,
    asignaciones,
    tokenId,
    origen: "papel",
  });

  // Igual que un abandono parcial en la web: un ítem que la persona dejó en
  // blanco en el papel (o que el pipeline de OMR/OCR no pudo interpretar y el
  // admin no rellenó a mano en la pantalla de revisión) simplemente no genera
  // fila en "respuestas", en vez de forzar un 0 que se confundiría con "lo
  // intentó y falló".
  const escrituras: Promise<void>[] = [];
  for (const a of asignaciones) {
    if (!(a.item_id in mapaRespuestas)) continue;
    const item = itemsPorId.get(a.item_id)!;
    const respuesta = mapaRespuestas[a.item_id];

    const resultado = corregirRespuesta(item, respuesta);
    if (!resultado) continue; // forma inválida para este formato: se descarta esa respuesta, no toda la hoja

    escrituras.push(
      upsertRespuesta(env, {
        sesionId: id,
        itemId: a.item_id,
        respuestaCruda: JSON.stringify(respuesta),
        opcionElegida: item.formato === "opcion_multiple" ? (respuesta as number) : null,
        acierto: resultado.acierto,
        puntuacion: puntuarItem(item, respuesta),
        estadoCorreccion: resultado.estado_correccion,
        tMs: null, // no hay telemetría de tiempo en una hoja de papel (README §3)
        ordenPresentacion: a.orden_presentacion,
        perdioFoco: false,
        enviadaEn: creadaEn,
      })
    );
  }
  await Promise.all(escrituras);

  // Una hoja digitalizada llega siempre completa de golpe (a diferencia del
  // flujo web, que va guardando respuesta a respuesta): si vinieron los N
  // ítems del banco, se marca completa y se calcula la puntuación total ya
  // mismo, en vez de esperar a que llegue una "última respuesta" que aquí no
  // existe como evento independiente.
  if (Object.keys(mapaRespuestas).length >= asignaciones.length) {
    const puntuacionTotal = puntuarSesion(
      asignaciones.map((a) => ({
        item_id: a.item_id,
        respuesta_cruda: a.item_id in mapaRespuestas ? JSON.stringify(mapaRespuestas[a.item_id]) : null,
      })),
      (itemId) => itemsPorId.get(itemId)
    );
    await marcarCompleto(env, id, puntuacionTotal);
  }

  return json(env, { sesion_id: id }, 201);
}
