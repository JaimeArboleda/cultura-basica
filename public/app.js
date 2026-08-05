// Orquestador del front-end (README §4, §8). Máquina de estados lineal, sin
// navegación hacia atrás. localStorage solo guarda el id de sesión para poder
// reanudar (§8): la fuente de verdad de qué ítems tocan y en qué orden es siempre
// el Worker (ver GET /api/resultado/:id en modo 'en_progreso').
import * as api from "./js/api.js";
import * as demografia from "./js/demografia.js";
import * as renderItem from "./js/render-item.js";
import { nombreBonito } from "./js/bloques.js";

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

// --- Ejecución del test (36 ítems fijos) ---

const TOTAL_ITEMS = 36;

function ejecutarTest(sesionId, itemsPendientes) {
  const cola = [...itemsPendientes];
  const total = TOTAL_ITEMS;

  function siguiente() {
    if (cola.length === 0) {
      onTestCompleto(sesionId);
      return;
    }
    const item = cola.shift();
    renderItemActual(sesionId, item, total - cola.length, total, siguiente);
  }

  siguiente();
}

function renderItemActual(sesionId, item, posicion, total, onSiguiente) {
  const root = montar(`
    <section class="pantalla pantalla-item">
      <div class="barra-progreso" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${posicion}">
        <div class="barra-progreso-relleno" style="width:${(posicion / total) * 100}%"></div>
      </div>
      <p class="contador">${posicion} / ${total}</p>
      ${item.texto ? `<p class="texto-lectura">${escaparHtml(item.texto)}</p>` : ""}
      <h2>${escaparHtml(item.enunciado)}</h2>
      <div id="zona-respuesta">${renderItem.html(item)}</div>
    </section>`);

  const tInicio = performance.now();
  let perdioFoco = false;
  const onVisibility = () => {
    if (document.hidden) perdioFoco = true;
  };
  document.addEventListener("visibilitychange", onVisibility);

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
    onSiguiente();
  });
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
  pantallaResultado(resultado.resultado);
}

const ICONO_CHECK =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5l3.2 3.2L13 4.8"/></svg>';

const ETIQUETA_DIFICULTAD = { facil: "Fácil", medio: "Media", dificil: "Difícil" };

function formatearPuntos(n) {
  return n.toLocaleString("es-ES", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function filaCategoria(bloque, marcas) {
  const total = ["facil", "medio", "dificil"].filter((d) => marcas[d]).length;
  const puntos = ["facil", "medio", "dificil"]
    .map(
      (d) => `
    <div class="dificultad-punto">
      <span class="dificultad-etiqueta">${ETIQUETA_DIFICULTAD[d]}</span>
      <span class="marca-acierto ${marcas[d] ? "si" : "no"}">${marcas[d] ? ICONO_CHECK : ""}</span>
    </div>`
    )
    .join("");

  return `
    <div class="categoria">
      <div>
        <div class="categoria-nombre">${escaparHtml(nombreBonito(bloque))}</div>
        <div class="categoria-total">${total} / 3 aciertos</div>
      </div>
      <div class="dificultades">${puntos}</div>
    </div>`;
}

function pantallaResultado(resultado) {
  const { puntuacion, puntuacion_maxima: maxima, percentil, media, por_bloque } = resultado;
  const posicionPuntuacion = (puntuacion / maxima) * 100;
  const posicionMedia = media != null ? (media / maxima) * 100 : null;

  const categorias = Object.keys(por_bloque)
    .sort((a, b) => nombreBonito(a).localeCompare(nombreBonito(b), "es"))
    .map((bloque) => filaCategoria(bloque, por_bloque[bloque]))
    .join("");

  montar(`
    <section class="pantalla">
      <div class="agradecimiento">
        <h1>Gracias por tu tiempo</h1>
        <p>
          Has completado el test. Cada respuesta ayuda a entender qué parte de la cultura
          general se sigue transmitiendo entre generaciones.
        </p>
      </div>

      <div class="resumen">
        <div class="resumen-cabecera">
          <div>
            <div class="puntuacion">${formatearPuntos(puntuacion)}<span> / ${maxima} puntos</span></div>
            <p class="resumen-nota" style="margin-top: 0.3rem;">Puntuación normalizada por dificultad</p>
          </div>
          <div>
            <div class="percentil-etiqueta">Percentil</div>
            <div class="percentil-valor">${percentil}</div>
          </div>
        </div>
        <div>
          <div class="gauge-pista">
            ${posicionMedia != null ? `<div class="gauge-media" style="left: ${posicionMedia}%;"></div>` : ""}
            <div class="gauge-marca" style="left: ${posicionPuntuacion}%;"></div>
          </div>
          <div class="gauge-leyenda"><span>0</span><span>${media != null ? `Media: ${formatearPuntos(media)}` : ""}</span><span>${maxima}</span></div>
        </div>
        <p class="resumen-nota">
          ${
            media != null
              ? `Tu puntuación queda por encima del <strong>${percentil} %</strong> de quienes han completado el test hasta ahora (media: ${formatearPuntos(media)} / ${maxima}).`
              : `Eres de las primeras personas en completar el test, así que todavía no hay con quién comparar tu puntuación.`
          }
        </p>
      </div>

      <div>
        <h2>Resultado por bloque</h2>
        <p class="resumen-nota" style="margin-bottom: 0.75rem;">Un acierto o fallo por cada nivel de dificultad.</p>
        <div class="categorias">${categorias}</div>
      </div>

      <footer class="cierre">Puedes cerrar esta página cuando quieras. No se guarda ningún dato identificativo.</footer>
    </section>`);
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
