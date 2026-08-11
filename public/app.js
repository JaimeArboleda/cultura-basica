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

function pantallaConsentimiento(token) {
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
  boton.addEventListener("click", () => pantallaHonestidad(token));
}

function pantallaHonestidad(token) {
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
  boton.addEventListener("click", () => pantallaDemografia(token));
}

function pantallaDemografia(token) {
  montar(`
    <section class="pantalla">
      <h1>Unas preguntas antes de empezar</h1>
      ${demografia.html()}
    </section>`);

  demografia.attachListeners(app, async (datosDemografia) => {
    montar(`<section class="pantalla"><p>Preparando el test…</p></section>`);
    try {
      const { sesion_id, items } = await api.crearSesion({
        token,
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

// --- Control de acceso por token (issue #2) ---
// El token identifica una *remesa* de invitación compartida por varias
// personas, no a quien responde (README §4.5): solo hace falta para poder
// CREAR una sesión nueva. Ver un resultado ya existente (§ enlace permanente
// más abajo) nunca depende de él.

function pantallaTokenCaducado() {
  montar(`
    <section class="pantalla">
      <h1>El enlace ha caducado</h1>
      <p>
        El enlace de invitación que has usado ya no es válido. Pide a quien te lo
        compartió que te envíe uno nuevo.
      </p>
    </section>`);
}

function pantallaSinAcceso() {
  const root = montar(`
    <section class="pantalla">
      <h1>No tienes acceso al test</h1>
      <p>
        Este test solo está disponible con invitación. Si crees que deberías
        tener acceso, dinos cómo contactarte y te avisaremos si podemos dártelo.
      </p>
      <form id="form-solicitud-acceso" class="formulario">
        <label class="campo">
          <span>Cómo contactarte (email, teléfono…)</span>
          <input type="text" id="campo-contacto" required maxlength="200" />
        </label>
        <label class="campo">
          <span>¿Algo que quieras contarnos? (opcional)</span>
          <textarea id="campo-motivo" maxlength="500"></textarea>
        </label>
        <button type="submit" class="boton-principal">Solicitar acceso</button>
      </form>
    </section>`);

  root.querySelector("#form-solicitud-acceso").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const contacto = root.querySelector("#campo-contacto").value.trim();
    const motivo = root.querySelector("#campo-motivo").value.trim();
    if (!contacto) return;
    try {
      await api.solicitarAcceso({ contacto, motivo: motivo || undefined });
      montar(`
        <section class="pantalla">
          <h1>Solicitud enviada</h1>
          <p>Gracias. Nos pondremos en contacto contigo si podemos darte acceso.</p>
        </section>`);
    } catch (e) {
      pantallaError(e.message);
    }
  });
}

async function iniciarConToken(token) {
  montar(`<section class="pantalla"><p>Comprobando acceso…</p></section>`);
  let estado;
  try {
    estado = await api.tokenValido(token);
  } catch (e) {
    pantallaError(e.message);
    return;
  }
  if (!estado.valido) {
    if (estado.motivo === "caducado") {
      pantallaTokenCaducado();
    } else {
      pantallaSinAcceso();
    }
    return;
  }
  pantallaConsentimiento(token);
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
      // Editando desde la revisión final (§"Modificar respuesta"): se oculta la
      // navegación Atrás/Adelante para no arrastrar al usuario de vuelta al
      // recorrido pregunta a pregunta; solo puede guardar (Responder) o
      // cancelar y volver directamente a la vista general.
      puedeVolver: !editandoDesdeRevision && pos > 0,
      puedeAvanzar: !editandoDesdeRevision && pos < posMaxVisitada,
      modoEdicion: editandoDesdeRevision,
      onSiguiente: (respuestaEnviada) => {
        respuestas[item.id] = respuestaEnviada;
        if (editandoDesdeRevision) {
          editandoDesdeRevision = false;
          mostrarRevisionFinal(pos);
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

  // indiceDestacado (opcional): al volver de editar una pregunta concreta, se
  // hace scroll hasta su tarjeta en vez de dejar la vista general en lo alto,
  // para que quede claro cuál se acaba de modificar.
  function mostrarRevisionFinal(indiceDestacado) {
    pantallaRevisionRespuestas(items, respuestas, yaRespondidos, total, {
      onEditar: (indice) => {
        pos = indice;
        editandoDesdeRevision = true;
        mostrarActual();
      },
      onConfirmar: () => onTestCompleto(sesionId),
      indiceDestacado,
    });
  }

  mostrarActual();
}

// Formatos con puntuación fraccionaria por sub-respuesta (README §4.4,
// worker/src/puntuacion.ts): a diferencia de "abierto"/"opcion_multiple"
// (todo o nada), aquí cada asignación/selección/pareja de orden cuenta por
// separado, así que merece la pena avisar de que no hace falta rellenarlo
// todo para sumar puntos. "ordenar" puntúa por pareja relativa (§4.4), no por
// "asignación", así que lleva su propio texto.
const NOTAS_PARCIALES = {
  seleccion_multiple: "Rellena las que sepas; se puntúa cada asignación correcta por separado.",
  clasificar: "Rellena las que sepas; se puntúa cada asignación correcta por separado.",
  ordenar: "Rellena lo mejor que sepas; se puntúa cada ordenación relativa por separado.",
};

function renderItemActual(
  sesionId,
  item,
  posicion,
  total,
  respuestaPrevia,
  { puedeVolver, puedeAvanzar, modoEdicion, onSiguiente, onAtras, onAdelante }
) {
  const root = montar(`
    <section class="pantalla pantalla-item">
      <div class="barra-progreso" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${posicion}">
        <div class="barra-progreso-relleno" style="width:${(posicion / total) * 100}%"></div>
      </div>
      <div class="cabecera-item">
        ${
          modoEdicion
            ? `<button type="button" class="boton-atras" id="boton-volver-revision">← Volver a la revisión</button>`
            : puedeVolver
              ? `<button type="button" class="boton-atras" id="boton-atras">← Atrás</button>`
              : "<span></span>"
        }
        <div class="cabecera-item-derecha">
          ${puedeAvanzar ? `<button type="button" class="boton-atras" id="boton-adelante">Adelante →</button>` : ""}
          <p class="contador">${posicion} / ${total}</p>
        </div>
      </div>
      ${item.texto ? `<p class="texto-lectura">${escaparHtml(item.texto)}</p>` : ""}
      <h2>${escaparHtml(item.enunciado)}</h2>
      ${NOTAS_PARCIALES[item.formato] ? `<p class="nota-formato">${NOTAS_PARCIALES[item.formato]}</p>` : ""}
      <div id="zona-respuesta">${renderItem.html(item, respuestaPrevia)}</div>
    </section>`);

  const tInicio = performance.now();
  let perdioFoco = false;
  const onVisibility = () => {
    if (document.hidden) perdioFoco = true;
  };
  document.addEventListener("visibilitychange", onVisibility);

  if (modoEdicion) {
    // "Volver a la revisión" guarda igual que "Responder" (dispara el mismo
    // botón: todos los formatos permiten enviar en cualquier estado, ver
    // attachListeners en render-item.js) en vez de descartar la edición, para
    // que no se pierda un cambio hecho sin llegar a pulsar "Responder".
    root.querySelector("#boton-volver-revision").addEventListener("click", () => {
      root.querySelector("#boton-responder").click();
    });
  } else if (puedeVolver) {
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
function pantallaRevisionRespuestas(items, respuestas, yaRespondidos, total, { onEditar, onConfirmar, indiceDestacado }) {
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

  if (indiceDestacado != null) {
    const tarjeta = root.querySelectorAll(".pregunta-revision")[indiceDestacado];
    if (tarjeta) {
      tarjeta.scrollIntoView({ block: "center" });
      tarjeta.classList.add("pregunta-revision-destacada");
      setTimeout(() => tarjeta.classList.remove("pregunta-revision-destacada"), 1500);
    }
  }
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
  pantallaResultado(resultado.resultado, resultado.revision, sesionId);
}

// El resultado destacado al terminar es la nota global (0-10), una cifra de
// gamificación para dar feedback inmediato; el percentil queda como dato
// secundario. Ninguno de los dos desglosa por dificultad ni expone la puntuación
// en bruto por ítem (ver worker/src/endpoints/resultado.ts). El detalle pregunta a
// pregunta sí se enseña, pero solo bajo demanda (enlace "Ver mis respuestas"), como
// feedback para quien lo quiera y no como parte del resumen principal.
//
// Esta pantalla también se usa para el enlace permanente "?resultado=" (§ init):
// alguien puede llegar aquí sin haber hecho el test él mismo (p. ej. un amigo al
// que se le compartió el resultado), así que la llamada a "hacer tú el test" solo
// se muestra si esta sesión NO es la que hay en localStorage de este navegador.
function pantallaResultado(resultado, revision, sesionId) {
  const { primera, percentil, nota_global } = resultado;
  const enlacePermanente = `${location.origin}${location.pathname}?resultado=${encodeURIComponent(sesionId)}`;
  const esPropia = localStorage.getItem(CLAVE_SESION) === sesionId;

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

      <div class="bloque-compartir">
        <button type="button" class="boton-secundario" id="boton-compartir">
          ${esPropia ? "Compartir tus resultados" : "Compartir este resultado"}
        </button>
        ${
          esPropia
            ? `<p class="nota-formato">
                 Guarda este enlace para volver a ver tu resultado cuando quieras, aunque el
                 enlace de invitación haya caducado: <code id="enlace-permanente">${enlacePermanente}</code>
               </p>`
            : ""
        }
      </div>

      ${
        esPropia
          ? ""
          : `<div class="bloque-invitar">
               <p>¿Te gustaría hacer tú también el test?</p>
               <button type="button" class="enlace-ver-respuestas" id="boton-solicitar-acceso">Solicitar acceso →</button>
             </div>`
      }

      <footer class="cierre">Puedes cerrar esta página cuando quieras. No se guarda ningún dato identificativo.</footer>
    </section>`);

  root.querySelector("#boton-ver-respuestas").addEventListener("click", () => {
    pantallaRevision(revision, resultado, () => pantallaResultado(resultado, revision, sesionId));
  });

  root.querySelector("#boton-compartir").addEventListener("click", async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: "Test de cultura general",
          text: `He sacado un ${nota_global.toFixed(1)} sobre 10 en el test de cultura general básica.`,
          url: enlacePermanente,
        });
      } catch {
        // el usuario canceló el diálogo de compartir; no hace falta hacer nada
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(enlacePermanente);
      const boton = root.querySelector("#boton-compartir");
      const textoOriginal = boton.textContent;
      boton.textContent = "¡Enlace copiado!";
      setTimeout(() => (boton.textContent = textoOriginal), 2000);
    } catch {
      // portapapeles no disponible: no hay más que ofrecer en ese caso
    }
  });

  const botonSolicitar = root.querySelector("#boton-solicitar-acceso");
  if (botonSolicitar) {
    botonSolicitar.addEventListener("click", () => pantallaSinAcceso());
  }
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
          .map((item) => {
            const estado = renderItem.estadoRespuesta(item);
            const etiqueta =
              estado === "sin_respuesta" ? "Sin respuesta" : estado === "acierto" ? "Correcta" : "Incorrecta";
            const clase = estado === "sin_respuesta" ? "sin-respuesta" : estado;
            return `
          <article class="pregunta-revision">
            <div class="pregunta-revision-cabecera">
              <h2 class="pregunta-revision-enunciado">${escaparHtml(item.enunciado)}</h2>
              <span class="etiqueta-acierto ${clase}">${etiqueta}</span>
            </div>
            ${item.texto ? `<p class="texto-lectura">${escaparHtml(item.texto)}</p>` : ""}
            ${renderItem.htmlRevision(item)}
          </article>`;
          })
          .join("")}
      </div>
    </section>`);

  root.querySelector("#boton-volver-revision").addEventListener("click", onVolver);
}

// --- Arranque (issue #2) ---
// Prioridad: (1) enlace permanente de resultado, funciona pase lo que pase con
// el token; (2) sesión en curso en este navegador (localStorage); (3) enlace de
// invitación con token, para empezar de cero; (4) sin nada de lo anterior, no
// hay forma de entrar: pantalla "sin acceso" con el formulario de solicitud.

async function mostrarResultadoPermanente(sesionId) {
  montar(`<section class="pantalla"><p>Cargando resultado…</p></section>`);
  try {
    const resultado = await api.obtenerResultado(sesionId);
    mostrarSegunEstado(sesionId, resultado);
  } catch (e) {
    if (e.status === 404) {
      pantallaError("Este enlace de resultados ya no está disponible.");
    } else {
      pantallaError(e.message);
    }
  }
}

async function reanudarSesion(sesionId) {
  montar(`<section class="pantalla"><p>Reanudando…</p></section>`);
  try {
    const resultado = await api.obtenerResultado(sesionId);
    mostrarSegunEstado(sesionId, resultado);
  } catch (e) {
    if (e.status === 404) {
      // La sesión ya no existe (p. ej. un admin borró sus datos, README §4.5):
      // se limpia el localStorage y, si sigue teniendo el enlace de invitación
      // a mano, puede volver a empezar con él.
      localStorage.removeItem(CLAVE_SESION);
      const token = new URLSearchParams(location.search).get("token");
      if (token) {
        await iniciarConToken(token);
      } else {
        pantallaSinAcceso();
      }
    } else {
      pantallaError(e.message);
    }
  }
}

async function init() {
  const params = new URLSearchParams(location.search);
  const resultadoId = params.get("resultado");
  if (resultadoId) {
    await mostrarResultadoPermanente(resultadoId);
    return;
  }

  const sesionId = localStorage.getItem(CLAVE_SESION);
  if (sesionId) {
    await reanudarSesion(sesionId);
    return;
  }

  const token = params.get("token");
  if (token) {
    await iniciarConToken(token);
    return;
  }

  pantallaSinAcceso();
}

init();
