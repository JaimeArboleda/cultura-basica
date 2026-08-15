// Edición desde el panel de admin de la demografía y las respuestas de UNA
// sesión ya existente (README §4.8) — funciona igual para origen='web' que
// para origen='papel': ambas comparten el mismo `GET/PUT /api/admin/sesiones/:id`
// y el mismo formulario. Dos entradas distintas llevan aquí:
//   - la pestaña Sesiones (admin.js), botón "Editar" en cualquier fila;
//   - papel/digitalizar.js, justo después de crear una sesión desde una hoja
//     escaneada — así la revisión de las 25 respuestas ocurre en la misma
//     pantalla que cualquier otra corrección, en vez de duplicar un
//     formulario de revisión aparte.
// No muestra nunca la respuesta correcta (igual que ItemPublico, no
// ItemRevision, worker/src/tipos.ts): se edita lo que la persona respondió de
// verdad, no lo que "debería" haber puesto.
import { api, escaparHtml, formatearFecha } from "./admin.js";
import { CATALOGOS } from "../js/demografia.js";

const LETRAS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export function campoSelectDemografia(clave, etiqueta, opciones, valorInicial) {
  const opcs = opciones
    .map((o) => `<option value="${escaparHtml(o)}" ${o === valorInicial ? "selected" : ""}>${escaparHtml(o)}</option>`)
    .join("");
  return `
    <label class="campo">
      <span>${etiqueta}</span>
      <select data-campo="${clave}">
        <option value="" ${valorInicial ? "" : "selected"}>Selecciona…</option>
        ${opcs}
      </select>
    </label>`;
}

// [campo del objeto Demografia, clave en CATALOGOS (public/js/demografia.js),
// etiqueta] — mismo mapeo que public/admin/papel/hoja.js.
const CAMPOS_DEMOGRAFIA = [
  ["sexo", "sexo", "Sexo"],
  ["ccaa_educacion_secundaria", "ccaa", "CCAA de educación secundaria"],
  ["nivel_estudios", "nivel_estudios", "Nivel de estudios"],
  ["area_estudios", "area_estudios", "Área de estudios"],
  ["estudios_mayor_progenitor", "nivel_estudios", "Mayor nivel de estudios de padre/madre"],
  ["libros_en_casa", "libros_en_casa", "Libros en casa a los 15 años"],
];

// seed: objeto con forma de Demografia (worker/src/tipos.ts) o vacío. Se
// reutiliza tanto para editar una sesión ya guardada (seed = sesion) como
// para la confirmación previa a crear una sesión digitalizada (seed =
// decodificado por papel/digitalizar.js).
export function bloqueCamposDemografia(seed = {}) {
  const camposCatalogo = CAMPOS_DEMOGRAFIA.map(([campo, claveCatalogo, etiqueta]) =>
    campoSelectDemografia(`demografia:${campo}`, etiqueta, CATALOGOS[claveCatalogo], seed[campo] ?? null)
  ).join("");
  return `
    <div class="revision-item">
      <div class="revision-item-enunciado">Año de nacimiento</div>
      <input type="text" inputmode="numeric" maxlength="4" data-campo="demografia:anio_nacimiento"
             value="${escaparHtml(seed.anio_nacimiento != null ? String(seed.anio_nacimiento) : "")}" />
    </div>
    ${camposCatalogo}`;
}

export function leerDemografiaDelFormulario(root) {
  return {
    anio_nacimiento: Number(root.querySelector('[data-campo="demografia:anio_nacimiento"]').value),
    sexo: root.querySelector('[data-campo="demografia:sexo"]').value,
    ccaa_educacion_secundaria: root.querySelector('[data-campo="demografia:ccaa_educacion_secundaria"]').value,
    nivel_estudios: root.querySelector('[data-campo="demografia:nivel_estudios"]').value,
    area_estudios: root.querySelector('[data-campo="demografia:area_estudios"]').value,
    estudios_mayor_progenitor: root.querySelector('[data-campo="demografia:estudios_mayor_progenitor"]').value,
    libros_en_casa: root.querySelector('[data-campo="demografia:libros_en_casa"]').value,
  };
}

// seed, por formato: abierto=string, opcion_multiple=índice, seleccion_multiple=[índices],
// ordenar=[posición por elemento, en el mismo orden que item.elementos], clasificar={elemento: categoría}.
// Es exactamente la forma que ya devuelve GET /api/admin/sesiones/:id en `respuestas`
// para opcion_multiple/seleccion_multiple/clasificar; para 'ordenar' esa
// respuesta ya viene como array de NOMBRES en orden (respuesta_cruda real),
// así que aquí se traduce a "posición por elemento" para poder preseleccionar
// los <select> (ver renderEditarSesion).
export function bloqueEdicionItem(item, seed) {
  const cabecera = `<div class="revision-item-enunciado">${escaparHtml(item.enunciado)}</div>`;
  switch (item.formato) {
    case "abierto":
      return `<div class="revision-item">${cabecera}
        <input type="text" data-campo="item:${item.id}" value="${escaparHtml(seed ?? "")}" />
      </div>`;
    case "opcion_multiple": {
      const opcs = item.opciones
        .map((o, i) => `<option value="${i}" ${seed === i ? "selected" : ""}>${LETRAS[i]}) ${escaparHtml(o)}</option>`)
        .join("");
      return `<div class="revision-item">${cabecera}
        <select data-campo="item:${item.id}"><option value="">(en blanco)</option>${opcs}</select>
      </div>`;
    }
    case "seleccion_multiple": {
      const marcadas = new Set(seed ?? []);
      const cajas = item.opciones
        .map(
          (o, i) => `
        <label class="revision-checkbox">
          <input type="checkbox" data-campo-multi="item:${item.id}" data-valor="${i}" ${marcadas.has(i) ? "checked" : ""} />
          ${LETRAS[i]}) ${escaparHtml(o)}
        </label>`
        )
        .join("");
      return `<div class="revision-item">${cabecera}${cajas}</div>`;
    }
    case "ordenar": {
      const n = item.elementos.length;
      const posiciones = seed ?? new Array(n).fill(null);
      const filas = item.elementos
        .map((elemento, i) => {
          const opcs = Array.from({ length: n }, (_, pos) => pos)
            .map((pos) => `<option value="${pos}" ${posiciones[i] === pos ? "selected" : ""}>${pos + 1}</option>`)
            .join("");
          return `<label class="campo campo-fila">
            <span>${escaparHtml(elemento)}</span>
            <select data-campo="item:${item.id}:elemento:${i}"><option value="">—</option>${opcs}</select>
          </label>`;
        })
        .join("");
      return `<div class="revision-item">${cabecera}${filas}</div>`;
    }
    case "clasificar": {
      const asignacion = seed ?? {};
      const filas = item.elementos
        .map((elemento, i) => {
          const opcs = item.categorias
            .map((cat) => `<option value="${escaparHtml(cat)}" ${asignacion[elemento] === cat ? "selected" : ""}>${escaparHtml(cat)}</option>`)
            .join("");
          return `<label class="campo campo-fila">
            <span>${escaparHtml(elemento)}</span>
            <select data-campo="item:${item.id}:elemento:${i}"><option value="">—</option>${opcs}</select>
          </label>`;
        })
        .join("");
      return `<div class="revision-item">${cabecera}${filas}</div>`;
    }
    default:
      return "";
  }
}

// Convierte el 'ordenar' guardado (array de nombres en orden, README §4.2) a
// "posición por elemento" (mismo índice que item.elementos) para poder
// preseleccionar los <select> de bloqueEdicionItem.
function posicionesDesdeOrden(item, ordenGuardado) {
  if (!Array.isArray(ordenGuardado)) return new Array(item.elementos.length).fill(null);
  return item.elementos.map((elemento) => {
    const pos = ordenGuardado.indexOf(elemento);
    return pos === -1 ? null : pos;
  });
}

function seedsDesdeRespuestasGuardadas(items, respuestas) {
  const seeds = {};
  for (const item of items) {
    const cruda = respuestas[item.id];
    seeds[item.id] = item.formato === "ordenar" ? posicionesDesdeOrden(item, cruda) : cruda;
  }
  return seeds;
}

export function leerRespuestasDelFormulario(items, root) {
  const respuestas = {};
  for (const item of items) {
    switch (item.formato) {
      case "abierto": {
        const v = root.querySelector(`[data-campo="item:${item.id}"]`).value.trim();
        if (v) respuestas[item.id] = v;
        break;
      }
      case "opcion_multiple": {
        const v = root.querySelector(`[data-campo="item:${item.id}"]`).value;
        if (v !== "") respuestas[item.id] = Number(v);
        break;
      }
      case "seleccion_multiple": {
        const marcadas = [...root.querySelectorAll(`[data-campo-multi="item:${item.id}"]:checked`)].map((el) =>
          Number(el.dataset.valor)
        );
        if (marcadas.length > 0) respuestas[item.id] = marcadas;
        break;
      }
      case "ordenar": {
        const n = item.elementos.length;
        const arr = new Array(n).fill(null);
        let alguna = false;
        item.elementos.forEach((elemento, i) => {
          const v = root.querySelector(`[data-campo="item:${item.id}:elemento:${i}"]`).value;
          if (v !== "") {
            arr[Number(v)] = elemento;
            alguna = true;
          }
        });
        if (alguna) respuestas[item.id] = arr;
        break;
      }
      case "clasificar": {
        const asign = {};
        let alguna = false;
        item.elementos.forEach((elemento, i) => {
          const v = root.querySelector(`[data-campo="item:${item.id}:elemento:${i}"]`).value;
          if (v !== "") {
            asign[elemento] = v;
            alguna = true;
          }
        });
        if (alguna) respuestas[item.id] = asign;
        break;
      }
    }
  }
  return respuestas;
}

export async function renderEditarSesion(contenedor, sesionId, { onVolver }) {
  contenedor.innerHTML = "<p>Cargando sesión…</p>";
  let detalle;
  try {
    detalle = await api.sesionDetalle(sesionId);
  } catch (e) {
    contenedor.innerHTML = `
      <p class="mensaje-error">${escaparHtml(e.message)}</p>
      <button type="button" class="boton-secundario boton-ancho-auto" id="boton-volver-edicion-error">Volver</button>`;
    contenedor.querySelector("#boton-volver-edicion-error").addEventListener("click", () => onVolver());
    return;
  }
  const { sesion, items, respuestas } = detalle;
  const seeds = seedsDesdeRespuestasGuardadas(items, respuestas);

  contenedor.innerHTML = `
    <h3>Editar sesión</h3>
    <p class="nota-formato">
      Origen: ${sesion.origen === "papel" ? '<span class="etiqueta-papel">Papel</span>' : "Web"} ·
      Token: ${escaparHtml(sesion.token_id ?? "—")} ·
      Estado: ${sesion.completo ? "Completa" : "En progreso"} ·
      Creada: ${formatearFecha(sesion.creada_en)}
    </p>
    <p class="nota-formato">
      Se edita lo que la persona respondió de verdad, no la respuesta correcta. Un campo en blanco se
      guarda como "sin responder" (borra esa respuesta si ya existía).
    </p>
    <h4>Demografía</h4>
    ${bloqueCamposDemografia(sesion)}
    <h4>Ítems</h4>
    ${items.map((item) => bloqueEdicionItem(item, seeds[item.id])).join("")}
    <div class="botones-celda">
      <button type="button" class="boton-principal boton-ancho-auto" id="boton-guardar-edicion">Guardar cambios</button>
      <button type="button" class="boton-secundario boton-ancho-auto" id="boton-volver-edicion">Volver</button>
    </div>
    <p id="estado-edicion" class="nota-formato"></p>`;

  contenedor.querySelector("#boton-volver-edicion").addEventListener("click", () => onVolver());

  contenedor.querySelector("#boton-guardar-edicion").addEventListener("click", async (ev) => {
    const boton = ev.currentTarget;
    const estado = contenedor.querySelector("#estado-edicion");
    boton.disabled = true;
    estado.textContent = "Guardando…";
    try {
      const demografia = leerDemografiaDelFormulario(contenedor);
      const nuevasRespuestas = leerRespuestasDelFormulario(items, contenedor);
      const resultado = await api.guardarEdicionSesion(sesionId, { demografia, respuestas: nuevasRespuestas });
      estado.textContent = `Guardado. Estado: ${resultado.completo ? "completa" : "en progreso"}${
        resultado.puntuacion_total != null ? `, puntuación ${resultado.puntuacion_total.toFixed(1)}` : ""
      }.`;
    } catch (e) {
      estado.textContent = `Error: ${e.message}`;
    } finally {
      boton.disabled = false;
    }
  });
}
