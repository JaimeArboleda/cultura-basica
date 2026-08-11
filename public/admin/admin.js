// Panel de administración (README §4.5, issue #2). Vanilla JS sin build, igual
// que public/app.js: no hay framework en este proyecto. Autenticación por
// cookie httpOnly (worker/src/adminAuth.ts), de ahí `credentials: "include"`
// en todas las peticiones.
//
// API_BASE duplica intencionalmente la constante de ../js/api.js: son despliegues
// separados y el front-end del test no debe depender del panel ni viceversa.
const API_BASE = "https://cultura-basica.cultura-basica.workers.dev";

async function peticion(path, opciones = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...opciones,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...opciones.headers },
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
  logout: () => peticion("/api/admin/auth/logout", { method: "POST" }),
  tokens: () => peticion("/api/admin/tokens"),
  crearToken: (body) => peticion("/api/admin/tokens", { method: "POST", body: JSON.stringify(body) }),
  revocarToken: (id) => peticion(`/api/admin/tokens/${encodeURIComponent(id)}`, { method: "DELETE" }),
  borrarSesionesToken: (id) =>
    peticion(`/api/admin/tokens/${encodeURIComponent(id)}/sesiones`, { method: "DELETE" }),
  sesiones: (query) => peticion(`/api/admin/sesiones?${query}`),
  borrarSesion: (id) => peticion(`/api/admin/sesiones/${encodeURIComponent(id)}`, { method: "DELETE" }),
  stats: (query) => peticion(`/api/admin/stats?${query}`),
  solicitudes: () => peticion("/api/admin/solicitudes"),
  marcarSolicitud: (id) => peticion(`/api/admin/solicitudes/${id}`, { method: "PATCH" }),
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

  root.querySelector("#boton-salir").addEventListener("click", async () => {
    await api.logout();
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
              <td>${s.atendida ? "" : `<button type="button" class="boton-tabla" data-atender="${s.id}">Marcar atendida</button>`}</td>
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
  try {
    const yo = await api.yo();
    // Limpia ?error= de la URL si el login tuvo éxito en un intento anterior.
    history.replaceState(null, "", location.pathname);
    await pantallaPanel(yo.email);
  } catch {
    pantallaLogin();
  }
}

init();
