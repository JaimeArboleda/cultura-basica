// Panel de administración (README §4.5, issue #2). Vanilla JS sin build, igual
// que public/app.js: no hay framework en este proyecto.
//
// Autenticación por token firmado en `Authorization: Bearer` (worker/src/adminAuth.ts),
// no por cookie: el panel se sirve desde Cloudflare Pages (*.pages.dev) y la
// API desde el Worker (*.workers.dev), dominios distintos a efectos de
// cookies. El token llega en el fragmento de la URL tras el login (ver init())
// y se guarda en localStorage.
//
// API_BASE duplica intencionalmente la constante de ../js/api.js: son despliegues
// separados y el front-end del test no debe depender del panel ni viceversa.
const API_BASE = "https://cultura-basica.cultura-basica.workers.dev";
const CLAVE_TOKEN_ADMIN = "cb_admin_token";

async function peticion(path, opciones = {}) {
  const token = localStorage.getItem(CLAVE_TOKEN_ADMIN);
  const res = await fetch(`${API_BASE}${path}`, {
    ...opciones,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...opciones.headers,
    },
  });
  if (!res.ok) {
    let mensaje = `Error ${res.status}`;
    try {
      const cuerpo = await res.json();
      if (cuerpo?.error) mensaje = cuerpo.error;
    } catch {
      // sin cuerpo JSON, se mantiene el mensaje genérico
    }
    const error = new Error(mensaje);
    error.status = res.status;
    throw error;
  }
  if (res.status === 204) return null;
  return res.json();
}

const api = {
  yo: () => peticion("/api/admin/me"),
  tokens: () => peticion("/api/admin/tokens"),
  crearToken: (body) => peticion("/api/admin/tokens", { method: "POST", body: JSON.stringify(body) }),
  revocarToken: (id) => peticion(`/api/admin/tokens/${encodeURIComponent(id)}`, { method: "DELETE" }),
  borrarSesionesToken: (id) =>
    peticion(`/api/admin/tokens/${encodeURIComponent(id)}/sesiones`, { method: "DELETE" }),
  borrarTokenCompleto: (id) =>
    peticion(`/api/admin/tokens/${encodeURIComponent(id)}/completo`, { method: "DELETE" }),
  sesiones: (query) => peticion(`/api/admin/sesiones?${query}`),
  borrarSesion: (id) => peticion(`/api/admin/sesiones/${encodeURIComponent(id)}`, { method: "DELETE" }),
  stats: (query) => peticion(`/api/admin/stats?${query}`),
  dataset: (query) => peticion(`/api/admin/dataset?${query}`),
  solicitudes: () => peticion("/api/admin/solicitudes"),
  marcarSolicitud: (id) => peticion(`/api/admin/solicitudes/${id}`, { method: "PATCH" }),
  borrarSolicitud: (id) => peticion(`/api/admin/solicitudes/${id}`, { method: "DELETE" }),
  admins: () => peticion("/api/admin/admins"),
  agregarAdmin: (email) => peticion("/api/admin/admins", { method: "POST", body: JSON.stringify({ email }) }),
  quitarAdmin: (email) => peticion(`/api/admin/admins/${encodeURIComponent(email)}`, { method: "DELETE" }),
};

const app = document.getElementById("app");
function montar(html) {
  app.innerHTML = html;
  return app;
}

function escaparHtml(s) {
  const div = document.createElement("div");
  div.textContent = s ?? "";
  return div.innerHTML;
}

function formatearFecha(iso) {
  return new Date(iso).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" });
}

// --- Confirmación con texto (papelera): para las acciones más destructivas
// (borrar un token entero con todas sus sesiones, borrar una solicitud) un
// simple confirm() del navegador es fácil de pulsar sin leer. Exige teclear
// la frase exacta antes de habilitar el botón de confirmar.
function pedirConfirmacionTexto({ titulo, mensaje, frase }) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal-caja" role="dialog" aria-modal="true" aria-labelledby="modal-titulo">
        <h2 id="modal-titulo">${escaparHtml(titulo)}</h2>
        <p>${escaparHtml(mensaje)}</p>
        <p>Escribe <strong>${escaparHtml(frase)}</strong> para confirmar:</p>
        <input type="text" class="modal-input" autocomplete="off" spellcheck="false" />
        <div class="modal-botones">
          <button type="button" class="boton-secundario" data-accion="cancelar">Cancelar</button>
          <button type="button" class="boton-principal boton-peligro-solido" data-accion="confirmar" disabled>Confirmar</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const cerrar = (resultado) => {
      overlay.remove();
      resolve(resultado);
    };

    const input = overlay.querySelector(".modal-input");
    const botonConfirmar = overlay.querySelector('[data-accion="confirmar"]');
    input.addEventListener("input", () => {
      botonConfirmar.disabled = input.value.trim().toLowerCase() !== frase.toLowerCase();
    });
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && !botonConfirmar.disabled) cerrar(true);
      if (ev.key === "Escape") cerrar(false);
    });
    overlay.addEventListener("click", (ev) => {
      if (ev.target === overlay) cerrar(false);
    });
    overlay.querySelector('[data-accion="cancelar"]').addEventListener("click", () => cerrar(false));
    botonConfirmar.addEventListener("click", () => cerrar(true));

    input.focus();
  });
}

// --- Login ---

const ERRORES_LOGIN = {
  state: "Fallo de autenticación (el enlace de login caducó o se reutilizó). Vuelve a intentarlo.",
  google: "No se ha podido verificar la cuenta de Google.",
  no_autorizado: "Esa cuenta de Google no tiene acceso al panel de administración.",
};

function pantallaLogin() {
  const motivoError = new URLSearchParams(location.search).get("error");
  montar(`
    <section class="pantalla">
      <h1>Panel de administración</h1>
      <p>Entra con una cuenta de Google autorizada para gestionar el test y sus datos.</p>
      ${motivoError ? `<p class="mensaje-error">${escaparHtml(ERRORES_LOGIN[motivoError] ?? "No se ha podido iniciar sesión.")}</p>` : ""}
      <a class="boton-principal" href="${API_BASE}/api/admin/auth/login">Entrar con Google</a>
    </section>`);
}

// --- Estructura del panel: cabecera + pestañas ---

const PESTANAS = [
  { id: "stats", etiqueta: "Estadísticas", render: renderStats },
  { id: "avanzado", etiqueta: "Estadísticas avanzadas", render: renderAvanzado },
  { id: "tokens", etiqueta: "Tokens", render: renderTokens },
  { id: "sesiones", etiqueta: "Sesiones", render: renderSesiones },
  { id: "solicitudes", etiqueta: "Solicitudes de acceso", render: renderSolicitudes },
  { id: "admins", etiqueta: "Administradores", render: renderAdmins },
];

async function pantallaPanel(email, pestanaActivaId = "stats") {
  const root = montar(`
    <section class="pantalla panel">
      <header class="panel-cabecera">
        <h1>Panel de administración</h1>
        <div class="panel-sesion">
          <span>${escaparHtml(email)}</span>
          <button type="button" class="boton-secundario" id="boton-salir">Cerrar sesión</button>
        </div>
      </header>
      <nav class="panel-pestanas">
        ${PESTANAS.map(
          (p) => `<button type="button" class="pestana ${p.id === pestanaActivaId ? "activa" : ""}" data-pestana="${p.id}">${p.etiqueta}</button>`
        ).join("")}
      </nav>
      <div id="panel-contenido"><p>Cargando…</p></div>
    </section>`);

  root.querySelector("#boton-salir").addEventListener("click", () => {
    // Sesión stateless (§ cabecera del fichero): "salir" es solo olvidar el
    // token en este navegador, no hay nada que invalidar en el servidor.
    localStorage.removeItem(CLAVE_TOKEN_ADMIN);
    location.reload();
  });

  root.querySelectorAll("[data-pestana]").forEach((boton) => {
    boton.addEventListener("click", () => pantallaPanel(email, boton.dataset.pestana));
  });

  const contenedor = root.querySelector("#panel-contenido");
  const pestana = PESTANAS.find((p) => p.id === pestanaActivaId) ?? PESTANAS[0];
  const recargar = () => pantallaPanel(email, pestanaActivaId);
  try {
    await pestana.render(contenedor, recargar);
  } catch (e) {
    contenedor.innerHTML = `<p class="mensaje-error">${escaparHtml(e.message)}</p>`;
  }
}

// --- Pestaña: Estadísticas ---

const TITULOS_DISTRIBUCION = {
  por_sexo: "Sexo",
  por_nivel_estudios: "Nivel de estudios",
  por_area_estudios: "Área de estudios",
  por_ccaa: "CCAA de educación secundaria",
};

function tablaDistribucion(clave, filas) {
  if (!filas || filas.length === 0) return "";
  return `
    <details class="distribucion">
      <summary>${TITULOS_DISTRIBUCION[clave]}</summary>
      <ul>${filas.map((f) => `<li>${escaparHtml(f.valor)}: ${f.n}</li>`).join("")}</ul>
    </details>`;
}

async function renderStats(contenedor) {
  const { tokens } = await api.tokens();
  contenedor.innerHTML = `
    <label class="campo">
      <span>Filtrar por token</span>
      <select id="filtro-token-stats">
        <option value="">Todos</option>
        ${tokens.map((t) => `<option value="${t.id}">${escaparHtml(t.descripcion)}</option>`).join("")}
      </select>
    </label>
    <div id="stats-datos"><p>Cargando…</p></div>`;

  const destino = contenedor.querySelector("#stats-datos");
  const cargar = async () => {
    const tokenId = contenedor.querySelector("#filtro-token-stats").value;
    const stats = await api.stats(tokenId ? `token_id=${encodeURIComponent(tokenId)}` : "");
    const pct = stats.objetivo_min > 0 ? Math.min(100, Math.round((stats.total / stats.objetivo_min) * 100)) : 0;
    destino.innerHTML = `
      <div class="stats-resumen">
        <div><strong>${stats.total}</strong> sesiones totales</div>
        <div><strong>${stats.completas}</strong> completas</div>
        <div><strong>${stats.en_progreso}</strong> en progreso</div>
      </div>
      <p>Progreso hacia el objetivo del piloto (${stats.objetivo_min}-${stats.objetivo_max} respuestas): ${stats.total} / ${stats.objetivo_min}</p>
      <div class="barra-progreso" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}">
        <div class="barra-progreso-relleno" style="width:${pct}%"></div>
      </div>
      ${Object.keys(TITULOS_DISTRIBUCION)
        .map((clave) => tablaDistribucion(clave, stats[clave]))
        .join("")}`;
  };
  contenedor.querySelector("#filtro-token-stats").addEventListener("change", cargar);
  await cargar();
}

// --- Pestaña: Estadísticas avanzadas ---
//
// Consola de Python en el propio navegador vía Pyodide (WebAssembly): sin
// backend Python ni estadísticas precalculadas, para poder explorar
// libremente el dataset completo (GET /api/admin/dataset) con pandas,
// matplotlib y scikit-learn. El "kernel" (Pyodide + el dataset ya cargado
// como DataFrames) se guarda a nivel de módulo, así que sobrevive a cambiar
// de pestaña dentro del panel y solo se descarga una vez por visita.
//
// No es un notebook Jupyter real (protocolo de kernel, celdas reordenables,
// etc.): cada "celda" se ejecuta con exec()/eval() sobre un único espacio de
// nombres compartido (igual que una consola de Python), que es justo lo que
// hace falta para "sesiones.groupby(...)", "plt.plot(...)" o un
// LinearRegression de sklearn sin tener que montar toda la UI de Jupyter.

const PYODIDE_VERSION = "314.0.3";
const PYODIDE_INDEX_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

// Ejecuta código arbitrario en el espacio de nombres persistente del kernel:
// si la última sentencia es una expresión (como en una consola de Python),
// se evalúa aparte y su repr() se devuelve como "resultado" (auto-display,
// igual que Jupyter/IPython) en vez de perderse. Las figuras de matplotlib
// abiertas al terminar se capturan como PNG en base64 (backend "Agg": no hay
// canvas del navegador de por medio) y se cierran, para no arrastrarlas a la
// siguiente celda.
const PRELUDIO_PYTHON = `
import ast, base64, contextlib, io, json, traceback
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pandas as pd
import numpy as np

_globales_celda = globals()

def _ejecutar_celda(codigo):
    salida = io.StringIO()
    resultado = None
    error = None
    try:
        arbol = ast.parse(codigo, mode="exec")
        ultima = None
        if arbol.body and isinstance(arbol.body[-1], ast.Expr):
            ultima = arbol.body.pop()
        with contextlib.redirect_stdout(salida), contextlib.redirect_stderr(salida):
            exec(compile(arbol, "<celda>", "exec"), _globales_celda)
            if ultima is not None:
                valor = eval(compile(ast.Expression(ultima.value), "<celda>", "eval"), _globales_celda)
                if valor is not None:
                    resultado = repr(valor)
    except Exception:
        error = traceback.format_exc()

    figuras = []
    for num in plt.get_fignums():
        buf = io.BytesIO()
        plt.figure(num).savefig(buf, format="png", bbox_inches="tight")
        figuras.append(base64.b64encode(buf.getvalue()).decode("ascii"))
    plt.close("all")

    return json.dumps({"stdout": salida.getvalue(), "resultado": resultado, "error": error, "figuras": figuras})
`;

// Carga el dataset (ya en el kernel como JSON) en tres DataFrames. Un print()
// en vez de dejar el mensaje como expresión final: así queda en "stdout" sin
// el escapado de comillas de repr() sobre un f-string.
const CODIGO_CARGA_DATASET = [
  "sesiones = pd.DataFrame(json.loads(_dataset_json)['sesiones'])",
  "respuestas = pd.DataFrame(json.loads(_dataset_json)['respuestas'])",
  "tokens = pd.DataFrame(json.loads(_dataset_json)['tokens'])",
  "print(f'sesiones: {len(sesiones)} filas · respuestas: {len(respuestas)} filas · tokens: {len(tokens)} filas')",
].join("\n");

let promesaPyodide = null;
// Clave del token con el que está cargado el dataset en el kernel ahora mismo
// ("" = todos los tokens); null = todavía no se ha cargado nada.
let datasetCargadoPara = null;
// [{codigo, salida}], sobrevive a cambiar de pestaña (no a recargar la página).
let historialCeldas = [];

async function cargarPyodide(avisar) {
  if (!promesaPyodide) {
    promesaPyodide = (async () => {
      avisar("Descargando Pyodide…");
      const { loadPyodide } = await import(`${PYODIDE_INDEX_URL}pyodide.mjs`);
      const pyodide = await loadPyodide({ indexURL: PYODIDE_INDEX_URL });
      avisar("Cargando pandas, matplotlib y scikit-learn…");
      await pyodide.loadPackage(["pandas", "matplotlib", "scikit-learn"]);
      await pyodide.runPythonAsync(PRELUDIO_PYTHON);
      return pyodide;
    })();
  }
  return promesaPyodide;
}

async function ejecutarCelda(pyodide, codigo) {
  // pyodide.globals.set hace la conversión JS->Python del string (comillas,
  // saltos de línea, unicode…) sin tener que escapar nada a mano aquí.
  pyodide.globals.set("_codigo_celda", codigo);
  const textoJson = await pyodide.runPythonAsync("_ejecutar_celda(_codigo_celda)");
  return JSON.parse(textoJson);
}

function renderCeldaHtml({ codigo, salida }) {
  const figuras = (salida.figuras ?? [])
    .map((b64) => `<img class="celda-figura" src="data:image/png;base64,${b64}" alt="Gráfico" />`)
    .join("");
  return `
    <div class="celda">
      <pre class="celda-codigo">${escaparHtml(codigo)}</pre>
      ${salida.stdout ? `<pre class="celda-salida">${escaparHtml(salida.stdout)}</pre>` : ""}
      ${salida.resultado != null ? `<pre class="celda-salida celda-resultado">${escaparHtml(salida.resultado)}</pre>` : ""}
      ${figuras}
      ${salida.error ? `<pre class="celda-salida celda-salida-error">${escaparHtml(salida.error)}</pre>` : ""}
    </div>`;
}

async function renderAvanzado(contenedor) {
  const { tokens } = await api.tokens();
  contenedor.innerHTML = `
    <p class="nota-formato">
      Consola de Python en tu propio navegador (<a href="https://pyodide.org" target="_blank" rel="noopener">Pyodide</a>):
      pandas, matplotlib y scikit-learn sobre el dataset completo de sesiones y respuestas. No hay backend Python:
      nada de esto sale de este navegador.
    </p>
    <label class="campo">
      <span>Cargar dataset filtrado por token</span>
      <select id="filtro-token-avanzado">
        <option value="">Todos</option>
        ${tokens.map((t) => `<option value="${t.id}">${escaparHtml(t.descripcion)}</option>`).join("")}
      </select>
    </label>
    <button type="button" class="boton-principal boton-ancho-auto" id="boton-cargar-kernel">
      ${promesaPyodide ? "Recargar con este filtro" : "Cargar entorno"}
    </button>
    <p id="estado-kernel" class="nota-formato"></p>
    <div id="consola-celdas" class="consola-celdas"></div>
    <form id="form-celda" class="formulario-celda" hidden>
      <textarea id="campo-codigo" rows="6" spellcheck="false" placeholder="sesiones.describe()"></textarea>
      <div class="botones-celda">
        <button type="submit" class="boton-principal boton-ancho-auto">Ejecutar (Ctrl+Enter)</button>
        <button type="button" class="boton-secundario boton-ancho-auto" id="boton-reiniciar-kernel">Reiniciar entorno</button>
      </div>
    </form>`;

  const botonCargar = contenedor.querySelector("#boton-cargar-kernel");
  const estadoKernel = contenedor.querySelector("#estado-kernel");
  const consolaCeldas = contenedor.querySelector("#consola-celdas");
  const formCelda = contenedor.querySelector("#form-celda");
  const campoCodigo = contenedor.querySelector("#campo-codigo");
  const selectToken = contenedor.querySelector("#filtro-token-avanzado");
  if (datasetCargadoPara) selectToken.value = datasetCargadoPara;

  function pintarHistorial() {
    consolaCeldas.innerHTML = historialCeldas.map(renderCeldaHtml).join("");
    consolaCeldas.scrollTop = consolaCeldas.scrollHeight;
  }

  async function iniciar(tokenId) {
    const claveToken = tokenId ?? "";
    if (datasetCargadoPara !== null && datasetCargadoPara !== claveToken && historialCeldas.length > 1) {
      if (!confirm("Cambiar de token recarga el dataset y borra las celdas ya ejecutadas. ¿Continuar?")) {
        selectToken.value = datasetCargadoPara;
        return;
      }
    }
    botonCargar.disabled = true;
    selectToken.disabled = true;
    try {
      const pyodide = await cargarPyodide((msg) => (estadoKernel.textContent = msg));
      if (datasetCargadoPara !== claveToken) {
        estadoKernel.textContent = "Cargando el dataset…";
        const dataset = await api.dataset(tokenId ? `token_id=${encodeURIComponent(tokenId)}` : "");
        pyodide.globals.set("_dataset_json", JSON.stringify(dataset));
        const salida = await ejecutarCelda(pyodide, CODIGO_CARGA_DATASET);
        historialCeldas = [{ codigo: CODIGO_CARGA_DATASET, salida }];
        datasetCargadoPara = claveToken;
      }
      estadoKernel.textContent = "";
      botonCargar.textContent = "Recargar con este filtro";
      formCelda.hidden = false;
      pintarHistorial();
      campoCodigo.focus();
    } catch (e) {
      estadoKernel.textContent = `Error cargando el entorno: ${e.message}`;
    } finally {
      botonCargar.disabled = false;
      selectToken.disabled = false;
    }
  }

  async function ejecutar() {
    const codigo = campoCodigo.value;
    if (!codigo.trim()) return;
    const pyodide = await promesaPyodide;
    const botonEjecutar = formCelda.querySelector('button[type="submit"]');
    botonEjecutar.disabled = true;
    try {
      const salida = await ejecutarCelda(pyodide, codigo);
      historialCeldas.push({ codigo, salida });
      pintarHistorial();
      campoCodigo.value = "";
    } finally {
      botonEjecutar.disabled = false;
      campoCodigo.focus();
    }
  }

  botonCargar.addEventListener("click", () => iniciar(selectToken.value || undefined));
  formCelda.addEventListener("submit", (ev) => {
    ev.preventDefault();
    ejecutar();
  });
  campoCodigo.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) {
      ev.preventDefault();
      ejecutar();
    }
  });
  contenedor.querySelector("#boton-reiniciar-kernel").addEventListener("click", async () => {
    if (!confirm("¿Reiniciar el entorno? Se perderán las variables definidas y el historial de celdas.")) return;
    promesaPyodide = null;
    datasetCargadoPara = null;
    historialCeldas = [];
    formCelda.hidden = true;
    await iniciar(selectToken.value || undefined);
  });

  // Si el kernel ya estaba cargado de una visita anterior a esta pestaña, se
  // reengancha solo (sin volver a descargar Pyodide ni el dataset).
  if (promesaPyodide) await iniciar(selectToken.value || undefined);
}

// --- Pestaña: Tokens ---

function filaToken(t) {
  const caducado = new Date(t.expira_en).getTime() < Date.now();
  const enlace = `${location.origin}/?token=${t.id}`;
  return `
    <tr>
      <td>${escaparHtml(t.descripcion)}</td>
      <td>${escaparHtml(t.creado_por)}</td>
      <td>${formatearFecha(t.expira_en)}${caducado ? ' <span class="etiqueta-caducado">caducado</span>' : ""}</td>
      <td>${t.n_sesiones}</td>
      <td>${t.n_completas}</td>
      <td><button type="button" class="boton-tabla" data-copiar-token="${enlace}">Copiar enlace</button></td>
      <td class="acciones-tabla">
        ${caducado ? "" : `<button type="button" class="boton-tabla" data-revocar="${t.id}">Revocar</button>`}
        <button type="button" class="boton-tabla boton-peligro" data-borrar-remesa="${t.id}">Borrar respuestas</button>
        <button type="button" class="boton-tabla boton-peligro" data-borrar-token="${t.id}" title="Borra el token entero y todas sus sesiones, sin dejar rastro">Borrar token</button>
      </td>
    </tr>`;
}

async function renderTokens(contenedor, recargar) {
  const { tokens } = await api.tokens();
  contenedor.innerHTML = `
    <form id="form-crear-token" class="formulario">
      <label class="campo">
        <span>Descripción (de dónde viene esta remesa)</span>
        <input type="text" id="campo-descripcion" required maxlength="200" placeholder="p. ej. familia de Gerardo" />
      </label>
      <label class="campo">
        <span>Validez en horas (2-240; por defecto 48)</span>
        <input type="number" id="campo-horas" min="2" max="240" value="48" />
      </label>
      <button type="submit" class="boton-principal">Crear token</button>
    </form>
    <div class="tabla-scroll">
      <table>
        <thead>
          <tr><th>Descripción</th><th>Creado por</th><th>Expira</th><th>Sesiones</th><th>Completas</th><th>Enlace</th><th>Acciones</th></tr>
        </thead>
        <tbody>${tokens.map(filaToken).join("")}</tbody>
      </table>
    </div>`;

  contenedor.querySelector("#form-crear-token").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const descripcion = contenedor.querySelector("#campo-descripcion").value.trim();
    const horas = Number(contenedor.querySelector("#campo-horas").value);
    if (!descripcion) return;
    try {
      await api.crearToken({ descripcion, horas_validez: horas });
      recargar();
    } catch (e) {
      alert(e.message);
    }
  });

  contenedor.querySelectorAll("[data-copiar-token]").forEach((boton) => {
    boton.addEventListener("click", async () => {
      await navigator.clipboard.writeText(boton.dataset.copiarToken);
      const textoOriginal = boton.textContent;
      boton.textContent = "¡Copiado!";
      setTimeout(() => (boton.textContent = textoOriginal), 1500);
    });
  });

  contenedor.querySelectorAll("[data-revocar]").forEach((boton) => {
    boton.addEventListener("click", async () => {
      if (!confirm("¿Revocar este token? Dejará de servir para crear sesiones nuevas de inmediato.")) return;
      await api.revocarToken(boton.dataset.revocar);
      recargar();
    });
  });

  contenedor.querySelectorAll("[data-borrar-remesa]").forEach((boton) => {
    boton.addEventListener("click", async () => {
      if (
        !confirm(
          "¿Borrar TODAS las sesiones y respuestas creadas con este token? El token seguirá activo: quien lo use podrá volver a hacer el test."
        )
      )
        return;
      await api.borrarSesionesToken(boton.dataset.borrarRemesa);
      recargar();
    });
  });

  contenedor.querySelectorAll("[data-borrar-token]").forEach((boton) => {
    boton.addEventListener("click", async () => {
      const confirmado = await pedirConfirmacionTexto({
        titulo: "Borrar token definitivamente",
        mensaje:
          "Se borrará el token, junto con todas las sesiones y respuestas creadas con él. No se puede deshacer.",
        frase: "borrar token",
      });
      if (!confirmado) return;
      await api.borrarTokenCompleto(boton.dataset.borrarToken);
      recargar();
    });
  });
}

// --- Pestaña: Sesiones ---

async function renderSesiones(contenedor) {
  const { tokens } = await api.tokens();
  contenedor.innerHTML = `
    <div class="filtros-sesiones">
      <label class="campo">
        <span>Token</span>
        <select id="filtro-token-sesiones">
          <option value="">Todos</option>
          ${tokens.map((t) => `<option value="${t.id}">${escaparHtml(t.descripcion)}</option>`).join("")}
        </select>
      </label>
      <label class="campo">
        <span>Estado</span>
        <select id="filtro-estado-sesiones">
          <option value="">Todas</option>
          <option value="completo">Completas</option>
          <option value="en_progreso">En progreso</option>
        </select>
      </label>
    </div>
    <div id="tabla-sesiones"><p>Cargando…</p></div>`;

  const destino = contenedor.querySelector("#tabla-sesiones");

  const cargar = async () => {
    const tokenId = contenedor.querySelector("#filtro-token-sesiones").value;
    const estado = contenedor.querySelector("#filtro-estado-sesiones").value;
    const params = new URLSearchParams();
    if (tokenId) params.set("token_id", tokenId);
    if (estado) params.set("estado", estado);
    const { sesiones } = await api.sesiones(params.toString());

    destino.innerHTML = `
      <div class="tabla-scroll">
        <table>
          <thead><tr><th>Creada</th><th>Estado</th><th>Nota</th><th>Sexo</th><th>Nivel de estudios</th><th>Acciones</th></tr></thead>
          <tbody>
            ${sesiones
              .map(
                (s) => `
              <tr>
                <td>${formatearFecha(s.creada_en)}</td>
                <td>${s.completo ? "Completa" : "En progreso"}</td>
                <td>${s.puntuacion_total != null ? s.puntuacion_total.toFixed(1) : "—"}</td>
                <td>${escaparHtml(s.sexo ?? "—")}</td>
                <td>${escaparHtml(s.nivel_estudios ?? "—")}</td>
                <td><button type="button" class="boton-tabla boton-peligro" data-borrar-sesion="${s.id}">Borrar</button></td>
              </tr>`
              )
              .join("")}
          </tbody>
        </table>
      </div>
      <p class="nota-formato">${sesiones.length} sesión(es)</p>`;

    destino.querySelectorAll("[data-borrar-sesion]").forEach((boton) => {
      boton.addEventListener("click", async () => {
        if (
          !confirm(
            "¿Borrar esta sesión y sus respuestas? La persona podrá repetir el test reabriendo su enlace original."
          )
        )
          return;
        await api.borrarSesion(boton.dataset.borrarSesion);
        cargar();
      });
    });
  };

  contenedor.querySelector("#filtro-token-sesiones").addEventListener("change", cargar);
  contenedor.querySelector("#filtro-estado-sesiones").addEventListener("change", cargar);
  await cargar();
}

// --- Pestaña: Solicitudes de acceso ---

async function renderSolicitudes(contenedor, recargar) {
  const { solicitudes } = await api.solicitudes();
  contenedor.innerHTML = `
    <div class="tabla-scroll">
      <table>
        <thead><tr><th>Contacto</th><th>Motivo</th><th>Fecha</th><th>Estado</th><th>Acciones</th></tr></thead>
        <tbody>
          ${solicitudes
            .map(
              (s) => `
            <tr>
              <td>${escaparHtml(s.contacto)}</td>
              <td>${escaparHtml(s.motivo ?? "—")}</td>
              <td>${formatearFecha(s.creada_en)}</td>
              <td>${s.atendida ? "Atendida" : "Pendiente"}</td>
              <td class="acciones-tabla">
                ${s.atendida ? "" : `<button type="button" class="boton-tabla" data-atender="${s.id}">Marcar atendida</button>`}
                <button type="button" class="boton-tabla boton-peligro" data-borrar-solicitud="${s.id}">Borrar</button>
              </td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table>
    </div>
    ${solicitudes.length === 0 ? `<p class="nota-formato">No hay solicitudes.</p>` : ""}`;

  contenedor.querySelectorAll("[data-atender]").forEach((boton) => {
    boton.addEventListener("click", async () => {
      await api.marcarSolicitud(boton.dataset.atender);
      recargar();
    });
  });

  contenedor.querySelectorAll("[data-borrar-solicitud]").forEach((boton) => {
    boton.addEventListener("click", async () => {
      const confirmado = await pedirConfirmacionTexto({
        titulo: "Borrar solicitud de acceso",
        mensaje: "Se borrará esta solicitud de acceso. No se puede deshacer.",
        frase: "borrar solicitud",
      });
      if (!confirmado) return;
      await api.borrarSolicitud(boton.dataset.borrarSolicitud);
      recargar();
    });
  });
}

// --- Pestaña: Administradores ---

async function renderAdmins(contenedor, recargar) {
  const { admins } = await api.admins();
  contenedor.innerHTML = `
    <form id="form-agregar-admin" class="formulario">
      <label class="campo">
        <span>Email de Gmail a autorizar</span>
        <input type="email" id="campo-email-admin" required />
      </label>
      <button type="submit" class="boton-principal">Añadir administrador</button>
    </form>
    <div class="tabla-scroll">
      <table>
        <thead><tr><th>Email</th><th>Añadido por</th><th>Fecha</th><th>Acciones</th></tr></thead>
        <tbody>
          ${admins
            .map(
              (a) => `
            <tr>
              <td>${escaparHtml(a.email)}</td>
              <td>${escaparHtml(a.anadido_por ?? "—")}</td>
              <td>${formatearFecha(a.anadido_en)}</td>
              <td><button type="button" class="boton-tabla boton-peligro" data-quitar-admin="${a.email}">Quitar</button></td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table>
    </div>`;

  contenedor.querySelector("#form-agregar-admin").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const email = contenedor.querySelector("#campo-email-admin").value.trim();
    if (!email) return;
    try {
      await api.agregarAdmin(email);
      recargar();
    } catch (e) {
      alert(e.message);
    }
  });

  contenedor.querySelectorAll("[data-quitar-admin]").forEach((boton) => {
    boton.addEventListener("click", async () => {
      if (!confirm(`¿Quitar a ${boton.dataset.quitarAdmin} del panel de administración?`)) return;
      try {
        await api.quitarAdmin(boton.dataset.quitarAdmin);
        recargar();
      } catch (e) {
        alert(e.message);
      }
    });
  });
}

// --- Arranque ---

async function init() {
  // Tras el login, el callback redirige aquí con #token=... (nunca query
  // string: el fragmento no sale del navegador en la petición HTTP). Se lee
  // una vez, se guarda y se retira de la URL de inmediato.
  const tokenRecibido = new URLSearchParams(location.hash.replace(/^#/, "")).get("token");
  if (tokenRecibido) {
    localStorage.setItem(CLAVE_TOKEN_ADMIN, tokenRecibido);
  }
  history.replaceState(null, "", location.pathname + (tokenRecibido ? "" : location.search));

  try {
    const yo = await api.yo();
    await pantallaPanel(yo.email);
  } catch {
    pantallaLogin();
  }
}

init();
