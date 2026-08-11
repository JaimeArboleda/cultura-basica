// Orquestador del front-end (README §4, §8). localStorage solo guarda el id de
// sesión para poder reanudar (§8): la fuente de verdad de qué ítems tocan y en
// qué orden es siempre el Worker (ver GET /api/resultado/:id en modo
// 'en_progreso'). Dentro de una misma tanda de ítems servida por el Worker se
// permite volver atrás para corregir una respuesta (POST /api/respuesta es
// idempotente por sesion_id+item_id, así que reenviarla la sobrescribe); no se
// puede volver más atrás de esa tanda porque el Worker no reenvía ítems ya
// respondidos.
import * as api from "./js/api.js";
import * as demografia from "./js/demografia.js";
import * as renderItem from "./js/render-item.js";

const CLAVE_SESION = "cb_sesion_id";
const app = document.getElementById("app");

function montar(html) {
  app.innerHTML = html;
  return app;
}

function claseDispositivo() {
  return window.matchMedia("(max-width: 700px)").matches ? "movil" : "escritorio";
}

// --- Pantallas simples ---

function pantallaError(mensaje) {
  montar(`
    <section class="pantalla">
      <h1>Ha ocurrido un error</h1>
      <p>${mensaje}</p>
      <button class="boton-principal" onclick="location.reload()">Reintentar</button>
    </section>`);
}

function pantallaConsentimiento() {
  montar(`
    <section class="pantalla">
      <h1>Test de cultura general</h1>
      <p>
        Este test forma parte de un estudio observacional anónimo sobre la
        transmisión de la cultura general básica en España. Tus respuestas se
        guardan sin nombre, email ni dirección IP. Puedes abandonar en cualquier
        momento sin ninguna consecuencia.
      </p>
      <label class="campo-checkbox">
        <input type="checkbox" id="check-consentimiento" />
        <span>He leído la información anterior y doy mi consentimiento para participar.</span>
      </label>
      <button class="boton-principal" id="boton-continuar" disabled>Continuar</button>
    </section>`);

  const check = document.getElementById("check-consentimiento");
  const boton = document.getElementById("boton-continuar");
  check.addEventListener("change", () => (boton.disabled = !check.checked));
  boton.addEventListener("click", () => pantallaHonestidad());
}

function pantallaHonestidad() {
  montar(`
    <section class="pantalla">
      <h1>Antes de empezar</h1>
      <p>
        Para que los resultados del estudio sean útiles, es importante que
        respondas con lo que sabes de memoria, sin buscar las respuestas.
      </p>
      <label class="campo-checkbox">
        <input type="checkbox" id="check-honestidad" />
        <span>Me comprometo a responder sin consultar ninguna fuente externa.</span>
      </label>
      <button class="boton-principal" id="boton-continuar" disabled>Continuar</button>
    </section>`);

  const check = document.getElementById("check-honestidad");
  const boton = document.getElementById("boton-continuar");
  check.addEventListener("change", () => (boton.disabled = !check.checked));
  boton.addEventListener("click", () => pantallaDemografia());
}

function pantallaDemografia() {
  montar(`
    <section class="pantalla">
      <h1>Unas preguntas antes de empezar</h1>
      ${demografia.html()}
    </section>`);

  demografia.attachListeners(app, async (datosDemografia) => {
    montar(`<section class="pantalla"><p>Preparando el test…</p></section>`);
    try {
      const { sesion_id, items } = await api.crearSesion({
        consentimiento: true,
        compromiso_honestidad: true,
        demografia: datosDemografia,
        user_agent_clase: claseDispositivo(),
      });
      localStorage.setItem(CLAVE_SESION, sesion_id);
      ejecutarTest(sesion_id, items);
    } catch (e) {
      pantallaError(e.message);
    }
  });
}

// --- Ejecución del test (25 ítems fijos) ---

const TOTAL_ITEMS = 25;

function ejecutarTest(sesionId, itemsPendientes) {
  const items = [...itemsPendientes];
  const total = TOTAL_ITEMS;
  const yaRespondidos = total - items.length;
  let pos = 0;
  // Posición más lejana visitada dentro de esta tanda: permite mostrar un
  // botón "Adelante" cuando se ha ido "Atrás" a revisar una pregunta ya
  // respondida, para no obligar a reenviarla solo por avanzar.
  let posMaxVisitada = 0;
  // true mientras se está corrigiendo una pregunta concreta desde la pantalla
  // de revisión final (enlace "Modificar respuesta"): al confirmarla, se
  // vuelve a esa pantalla en vez de continuar avanzando por el resto.
  let editandoDesdeRevision = false;
  // Respuestas ya enviadas en esta tanda, por item_id: permite que "atrás" (§3)
  // vuelva a mostrar una pregunta ya respondida con su estado en vez de en
  // blanco, y que se pueda revisar/corregir antes de reenviarla (idempotente,
  // ver cabecera del fichero).
  const respuestas = {};

  function mostrarActual() {
    const item = items[pos];
    if (pos > posMaxVisitada) posMaxVisitada = pos;
    renderItemActual(sesionId, item, yaRespondidos + pos + 1, total, respuestas[item.id], {
      puedeVolver: pos > 0,
      puedeAvanzar: pos < posMaxVisitada,
      onSiguiente: (respuestaEnviada) => {
        respuestas[item.id] = respuestaEnviada;
        if (editandoDesdeRevision) {
          editandoDesdeRevision = false;
          mostrarRevisionFinal();
          return;
        }
        pos++;
        if (pos >= items.length) {
          mostrarRevisionFinal();
        } else {
          mostrarActual();
        }
      },
      onAtras: () => {
        pos--;
        mostrarActual();
      },
      onAdelante: () => {
        pos++;
        if (pos >= items.length) {
          mostrarRevisionFinal();
        } else {
          mostrarActual();
        }
      },
    });
  }

  function mostrarRevisionFinal() {
    pantallaRevisionRespuestas(items, respuestas, yaRespondidos, total, {
      onEditar: (indice) => {
        pos = indice;
        editandoDesdeRevision = true;
        mostrarActual();
      },
      onConfirmar: () => onTestCompleto(sesionId),
    });
  }

  mostrarActual();
}

function renderItemActual(
  sesionId,
  item,
  posicion,
  total,
  respuestaPrevia,
  { puedeVolver, puedeAvanzar, onSiguiente, onAtras, onAdelante }
) {
  const root = montar(`
    <section class="pantalla pantalla-item">
      <div class="barra-progreso" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${posicion}">
        <div class="barra-progreso-relleno" style="width:${(posicion / total) * 100}%"></div>
      </div>
      <div class="cabecera-item">
        ${puedeVolver ? `<button type="button" class="boton-atras" id="boton-atras">← Atrás</button>` : "<span></span>"}
        <div class="cabecera-item-derecha">
          ${puedeAvanzar ? `<button type="button" class="boton-atras" id="boton-adelante">Adelante →</button>` : ""}
          <p class="contador">${posicion} / ${total}</p>
        </div>
      </div>
      ${item.texto ? `<p class="texto-lectura">${escaparHtml(item.texto)}</p>` : ""}
      <h2>${escaparHtml(item.enunciado)}</h2>
      <div id="zona-respuesta">${renderItem.html(item, respuestaPrevia)}</div>
    </section>`);

  const tInicio = performance.now();
  let perdioFoco = false;
  const onVisibility = () => {
    if (document.hidden) perdioFoco = true;
  };
  document.addEventListener("visibilitychange", onVisibility);

  if (puedeVolver) {
    root.querySelector("#boton-atras").addEventListener("click", () => {
      document.removeEventListener("visibilitychange", onVisibility);
      onAtras();
    });
  }

  if (puedeAvanzar) {
    root.querySelector("#boton-adelante").addEventListener("click", () => {
      document.removeEventListener("visibilitychange", onVisibility);
      onAdelante();
    });
  }

  renderItem.attachListeners(root.querySelector("#zona-respuesta"), item, async (respuesta) => {
    document.removeEventListener("visibilitychange", onVisibility);
    const tMs = Math.round(performance.now() - tInicio);
    try {
      await api.enviarRespuesta({
        sesion_id: sesionId,
        item_id: item.id,
        respuesta,
        t_ms: tMs,
        perdio_foco: perdioFoco,
      });
    } catch (e) {
      pantallaError(e.message);
      return;
    }
    onSiguiente(respuesta);
  });
}

// Pantalla de revisión final (§3 del encargo): antes de dar por terminado el
// test se muestran todas las respuestas dadas en esta tanda (ya guardadas en
// el Worker respuesta a respuesta, ver cabecera del fichero) para que se
// puedan corregir. "Confirmar y enviar" es lo que dispara el cálculo del
// resultado (onTestCompleto); no reenvía nada por sí solo porque cada
// respuesta ya se guardó al pulsar "Responder" en su momento.
function pantallaRevisionRespuestas(items, respuestas, yaRespondidos, total, { onEditar, onConfirmar }) {
  const root = montar(`
    <section class="pantalla">
      <h1>Revisa tus respuestas</h1>
      <p class="texto-lectura">
        Antes de enviar el test puedes revisar y modificar cualquier respuesta.
        Cuando estés conforme, pulsa «Confirmar y enviar».
      </p>
      <div class="lista-revision">
        ${items
          .map(
            (item, i) => `
          <article class="pregunta-revision">
            <div class="pregunta-revision-cabecera">
              <h2 class="pregunta-revision-enunciado">${yaRespondidos + i + 1}. ${escaparHtml(item.enunciado)}</h2>
              <button type="button" class="enlace-modificar" data-indice="${i}">Modificar respuesta</button>
            </div>
            ${renderItem.htmlResumen(item, respuestas[item.id])}
          </article>`
          )
          .join("")}
      </div>
      <button type="button" class="boton-principal" id="boton-confirmar-envio">Confirmar y enviar</button>
    </section>`);

  root.querySelectorAll(".enlace-modificar").forEach((boton) => {
    boton.addEventListener("click", () => onEditar(Number(boton.dataset.indice)));
  });
  root.querySelector("#boton-confirmar-envio").addEventListener("click", onConfirmar);
}

function escaparHtml(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

// --- Fin del test: pedir resultado al servidor y decidir qué mostrar ---

async function onTestCompleto(sesionId) {
  montar(`<section class="pantalla"><p>Calculando resultado…</p></section>`);
  let resultado;
  try {
    resultado = await api.obtenerResultado(sesionId);
  } catch (e) {
    pantallaError(e.message);
    return;
  }
  mostrarSegunEstado(sesionId, resultado);
}

function mostrarSegunEstado(sesionId, resultado, intento = 0) {
  if (resultado.estado === "en_progreso") {
    if (resultado.items_pendientes.length === 0) {
      // El servidor aún no ha marcado la sesión como completa (posible pequeño
      // retraso de consistencia tras la última respuesta). Reintentamos con
      // espera en vez de entrar en un bucle inmediato que deja la pantalla
      // colgada en "Calculando resultado…".
      if (intento >= 10) {
        pantallaError("No se ha podido calcular el resultado. Vuelve a intentarlo en unos segundos.");
        return;
      }
      setTimeout(async () => {
        try {
          const siguiente = await api.obtenerResultado(sesionId);
          mostrarSegunEstado(sesionId, siguiente, intento + 1);
        } catch (e) {
          pantallaError(e.message);
        }
      }, 500);
      return;
    }
    ejecutarTest(sesionId, resultado.items_pendientes);
    return;
  }
  pantallaResultado(resultado.resultado, resultado.revision);
}

// El resultado destacado al terminar es la nota global (0-10), una cifra de
// gamificación para dar feedback inmediato; el percentil queda como dato
// secundario. Ninguno de los dos desglosa por dificultad ni expone la puntuación
// en bruto por ítem (ver worker/src/endpoints/resultado.ts). El detalle pregunta a
// pregunta sí se enseña, pero solo bajo demanda (enlace "Ver mis respuestas"), como
// feedback para quien lo quiera y no como parte del resumen principal.
function pantallaResultado(resultado, revision) {
  const { primera, percentil, nota_global } = resultado;

  const root = montar(`
    <section class="pantalla">
      <div class="agradecimiento">
        <h1>Gracias por tu tiempo</h1>
        <p>
          Has completado el test. Cada respuesta ayuda a entender qué parte de la cultura
          general se sigue transmitiendo entre generaciones.
        </p>
      </div>

      <div class="resumen resumen-nota-global">
        <div class="resumen-etiqueta">Tu nota global</div>
        <div class="resumen-valor-grande">${nota_global.toFixed(1)}</div>
        <p class="resumen-nota">Sobre 10, a partir de las ${revision.length} preguntas del test.</p>
      </div>

      <div class="resumen resumen-percentil">
        ${
          primera
            ? `<p class="resumen-nota">Eres de las primeras personas en completar el test, así que todavía no hay con quién comparar tu resultado.</p>`
            : `<p class="resumen-nota">Lo has hecho mejor que el <strong>${percentil} %</strong> de participantes.</p>`
        }
      </div>

      <button type="button" class="enlace-ver-respuestas" id="boton-ver-respuestas">Ver mis respuestas →</button>

      <footer class="cierre">Puedes cerrar esta página cuando quieras. No se guarda ningún dato identificativo.</footer>
    </section>`);

  root.querySelector("#boton-ver-respuestas").addEventListener("click", () => {
    pantallaRevision(revision, resultado, () => pantallaResultado(resultado, revision));
  });
}

function pantallaRevision(revision, resultado, onVolver) {
  const root = montar(`
    <section class="pantalla">
      <div class="cabecera-revision">
        <button type="button" class="boton-atras" id="boton-volver-revision">← Volver</button>
        <p class="contador">${resultado.puntuacion_total.toFixed(1)} puntos (máximo de ${revision.length})</p>
      </div>
      <h1>Tus respuestas</h1>
      <div class="lista-revision">
        ${revision
          .map(
            (item) => `
          <article class="pregunta-revision">
            <div class="pregunta-revision-cabecera">
              <h2 class="pregunta-revision-enunciado">${escaparHtml(item.enunciado)}</h2>
              <span class="etiqueta-acierto ${item.acierto ? "acierto" : "fallo"}">${item.acierto ? "Correcta" : "Incorrecta"}</span>
            </div>
            ${item.texto ? `<p class="texto-lectura">${escaparHtml(item.texto)}</p>` : ""}
            ${renderItem.htmlRevision(item)}
          </article>`
          )
          .join("")}
      </div>
    </section>`);

  root.querySelector("#boton-volver-revision").addEventListener("click", onVolver);
}

// --- Arranque: reanudar sesión si existe, si no, empezar de cero ---

async function init() {
  const sesionId = localStorage.getItem(CLAVE_SESION);
  if (!sesionId) {
    pantallaConsentimiento();
    return;
  }

  montar(`<section class="pantalla"><p>Reanudando…</p></section>`);
  try {
    const resultado = await api.obtenerResultado(sesionId);
    mostrarSegunEstado(sesionId, resultado);
  } catch (e) {
    if (e.status === 404) {
      localStorage.removeItem(CLAVE_SESION);
      pantallaConsentimiento();
    } else {
      pantallaError(e.message);
    }
  }
}

init();
