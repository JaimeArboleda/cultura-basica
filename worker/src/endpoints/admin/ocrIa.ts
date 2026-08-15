// Motor de OCR-IA de la v2 del pipeline en papel (README §4.7, "Motor
// gpt-mini"): alternativa a Tesseract.js (que corre entero en el navegador,
// public/admin/papel/comun.js::ocrLinea) para leer las casillas de
// letra/dígito de una hoja escaneada, con más precisión sobre letra
// manuscrita real a costa de depender de una API de pago. El panel deja
// elegir entre los dos motores por hoja (public/admin/papel/v2/digitalizar.js)
// para poder compararlos con datos reales antes de decidir cuál usar en el
// piloto — ninguno sustituye al otro, conviven igual que v1/v2 (README §4.9).
//
// Deliberadamente NO toca la lectura del QR (README §4.9): remesa, exam_id y
// número de página siguen decodificándose de forma determinista con jsQR en
// el propio navegador, motor de OCR elegido aparte — aunque con un modelo de
// visión ya no haría falta en teoría, mantenerlo evita tener DOS diseños
// distintos de identificación de hoja (uno determinista, otro dependiente de
// IA) conviviendo a la vez.
import { error, json } from "../../http";
import type { Env } from "../../tipos";

const MODELO_POR_DEFECTO = "gpt-4o-mini";
// Límites de tamaño de la petición: una casilla es un recorte minúsculo (unos
// pocos mm impresos), así que estos topes son generosos para cualquier hoja
// real del banco de ítems actual y solo están para no dejar pasar una
// petición desproporcionada (coste, tiempo de CPU del Worker) por error del
// cliente.
const MAX_PAGINAS_POR_PETICION = 40;
const MAX_CASILLAS_POR_PETICION = 800;

type TipoCasilla = "letra" | "digito" | "texto";

interface CasillaEntrada {
  clave: string;
  tipo: TipoCasilla;
  imagen: string; // data URL (image/jpeg o image/png)
}

interface PaginaEntrada {
  id: string;
  casillas: CasillaEntrada[];
}

const TIPOS_VALIDOS = new Set<TipoCasilla>(["letra", "digito", "texto"]);

function validarCasilla(c: unknown): c is CasillaEntrada {
  if (typeof c !== "object" || c === null) return false;
  const o = c as Record<string, unknown>;
  return (
    typeof o.clave === "string" &&
    o.clave.length > 0 &&
    typeof o.tipo === "string" &&
    TIPOS_VALIDOS.has(o.tipo as TipoCasilla) &&
    typeof o.imagen === "string" &&
    o.imagen.startsWith("data:image/")
  );
}

function validarPagina(p: unknown): p is PaginaEntrada {
  if (typeof p !== "object" || p === null) return false;
  const o = p as Record<string, unknown>;
  return typeof o.id === "string" && o.id.length > 0 && Array.isArray(o.casillas) && o.casillas.every(validarCasilla);
}

// Descripción breve de qué se espera en cada casilla, para el prompt: el
// modelo no tiene coordenadas ni layout, solo la propia imagen recortada y
// esta pista de formato (README §4.9: mayúsculas de imprenta, una letra o
// dígito por casilla salvo los bloques de texto libre de varias casillas).
function describirTipo(tipo: TipoCasilla): string {
  if (tipo === "digito") return "una única casilla con, como mucho, UN dígito (0-9) escrito a mano";
  if (tipo === "letra") return "una única casilla con, como mucho, UNA letra mayúscula (A-Z) escrita a mano";
  return "una fila de casillas con letras/dígitos mayúsculos escritos a mano, una palabra o sigla corta";
}

function construirMensajeUsuario(paginas: PaginaEntrada[]) {
  const partes: Array<Record<string, unknown>> = [
    {
      type: "text",
      text:
        "Voy a mandarte recortes de casillas de una hoja de examen en papel escaneada, agrupados por página. " +
        "Cada recorte va precedido de una etiqueta con el formato \"<id_pagina>::<clave>\" y una descripción de qué " +
        "se esperaba escrito ahí. Lee SOLO lo que hay escrito a mano dentro de cada recorte (ignora el propio marco " +
        "impreso de la casilla). Responde ÚNICAMENTE con un objeto JSON plano, sin explicación ni markdown, cuyas " +
        "claves sean exactamente esas etiquetas \"<id_pagina>::<clave>\" (una por cada recorte que te mando, todas " +
        "presentes) y cuyo valor sea el texto reconocido en MAYÚSCULAS (cadena vacía \"\" si la casilla está en " +
        "blanco o no se distingue nada).",
    },
  ];
  for (const pagina of paginas) {
    for (const casilla of pagina.casillas) {
      partes.push({ type: "text", text: `${pagina.id}::${casilla.clave} — ${describirTipo(casilla.tipo)}:` });
      partes.push({ type: "image_url", image_url: { url: casilla.imagen } });
    }
  }
  return partes;
}

export async function postOcrIa(request: Request, env: Env): Promise<Response> {
  // Validar la forma del body ANTES de comprobar OPENAI_API_KEY: así un
  // cliente con un body mal formado se entera del error real (400) en vez de
  // un "falta la clave" que podría no tener nada que ver, y el Worker no
  // gasta ni un solo request de la API de pago con una entrada inválida.
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return error(env, 400, "JSON inválido");
  }
  const b = body as Record<string, unknown>;

  if (!Array.isArray(b.paginas) || b.paginas.length === 0 || !b.paginas.every(validarPagina)) {
    return error(
      env,
      400,
      "Falta paginas: array de {id, casillas:[{clave, tipo:'letra'|'digito'|'texto', imagen:data-url}]}"
    );
  }
  const paginas = b.paginas as PaginaEntrada[];

  if (paginas.length > MAX_PAGINAS_POR_PETICION) {
    return error(env, 400, `Demasiadas páginas en una sola petición (máximo ${MAX_PAGINAS_POR_PETICION})`);
  }
  const totalCasillas = paginas.reduce((n, p) => n + p.casillas.length, 0);
  if (totalCasillas === 0) {
    return error(env, 400, "Ninguna página trae casillas que leer");
  }
  if (totalCasillas > MAX_CASILLAS_POR_PETICION) {
    return error(env, 400, `Demasiadas casillas en una sola petición (máximo ${MAX_CASILLAS_POR_PETICION})`);
  }

  if (!env.OPENAI_API_KEY) {
    return error(
      env,
      500,
      "El motor de OCR-IA no está configurado en este Worker (falta el secreto OPENAI_API_KEY) — usa el motor Tesseract mientras tanto."
    );
  }

  const modelo = typeof b.modelo === "string" && b.modelo ? b.modelo : (env.OPENAI_MODEL ?? MODELO_POR_DEFECTO);

  let respuestaOpenAI: Response;
  try {
    respuestaOpenAI = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: modelo,
        response_format: { type: "json_object" },
        // Sin `temperature`: los modelos de la familia gpt-5 (a diferencia de
        // gpt-4o-mini) rechazan con 400 cualquier valor que no sea el 1 por
        // defecto ("Unsupported value: 'temperature' does not support 0.0
        // with this model"), así que fijarla a 0 para "más determinismo" en
        // el OCR rompía el modelo más nuevo — mejor un único código que
        // funcione con cualquier modelo (README: "por no tener dos diseños")
        // que perseguir un determinismo que tampoco es crítico aquí (el
        // admin revisa el 100% de las respuestas igualmente, README §4.7).
        messages: [
          {
            role: "system",
            content:
              "Eres un sistema de OCR especializado en leer letra manuscrita de imprenta en mayúsculas sobre " +
              "casillas cuadradas de un examen escaneado en papel. Devuelves siempre JSON plano, nunca prosa.",
          },
          { role: "user", content: construirMensajeUsuario(paginas) },
        ],
      }),
    });
  } catch (e) {
    return error(env, 502, `No se pudo contactar con la API de OpenAI: ${(e as Error).message}`);
  }

  if (!respuestaOpenAI.ok) {
    const detalle = await respuestaOpenAI.text().catch(() => "");
    return error(env, 502, `La API de OpenAI respondió ${respuestaOpenAI.status}: ${detalle.slice(0, 500)}`);
  }

  const cuerpo = (await respuestaOpenAI.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const contenido = cuerpo.choices?.[0]?.message?.content;
  if (!contenido) {
    return error(env, 502, "La API de OpenAI no devolvió contenido reconocible");
  }

  let plano: Record<string, unknown>;
  try {
    plano = JSON.parse(contenido);
  } catch {
    return error(env, 502, "La respuesta del modelo no era JSON válido");
  }

  // Reparte el JSON plano "<id_pagina>::<clave>" -> texto en {resultados:
  // {[id_pagina]: {[clave]: texto}}}: una clave ausente o de tipo raro en la
  // respuesta del modelo se trata como "no reconocido" (cadena vacía), no
  // como error — el admin revisa el 100% de las respuestas igualmente
  // (README §4.7, "revisión instantánea"), así que degradar con blancos es
  // preferible a que un fallo puntual del modelo tumbe la página entera.
  const resultados: Record<string, Record<string, string>> = {};
  for (const pagina of paginas) {
    const textos: Record<string, string> = {};
    for (const casilla of pagina.casillas) {
      const valor = plano[`${pagina.id}::${casilla.clave}`];
      textos[casilla.clave] = typeof valor === "string" ? valor.trim().toUpperCase() : "";
    }
    resultados[pagina.id] = textos;
  }

  return json(env, { modelo, resultados });
}
