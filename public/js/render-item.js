// Renderizado y captura de respuesta por formato de ítem (README §1.5).
// Todas las funciones aquí trabajan sobre datos ya "públicos" (sin respuesta
// correcta) tal como los sirve el Worker.

function escapar(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

export function html(item) {
  switch (item.formato) {
    case "abierto":
      return `
        <input id="respuesta-abierta" type="text" inputmode="text" autocomplete="off"
               placeholder="Escribe tu respuesta" />
        <button type="button" class="boton-principal" id="boton-responder">Responder</button>`;

    case "opcion_multiple":
      return `
        <div class="opciones" role="group">
          ${item.opciones
            .map((op, i) => `<button type="button" class="boton-opcion" data-indice="${i}">${escapar(op)}</button>`)
            .join("")}
        </div>`;

    case "ordenar":
      return `
        <ol id="lista-ordenar" class="lista-ordenar">
          ${item.elementos
            .map(
              (el, i) => `
            <li data-elemento="${escapar(el)}">
              <span>${escapar(el)}</span>
              <span class="controles-orden">
                <button type="button" data-mover="arriba" ${i === 0 ? "disabled" : ""} aria-label="Subir">▲</button>
                <button type="button" data-mover="abajo" ${i === item.elementos.length - 1 ? "disabled" : ""} aria-label="Bajar">▼</button>
              </span>
            </li>`
            )
            .join("")}
        </ol>
        <button type="button" class="boton-principal" id="boton-responder">Responder</button>`;

    case "clasificar":
      return `
        <div class="bandeja" id="bandeja-elementos">
          ${item.elementos.map((el) => `<button type="button" class="ficha" data-elemento="${escapar(el)}">${escapar(el)}</button>`).join("")}
        </div>
        <div class="cajas-clasificar">
          ${item.categorias
            .map(
              (cat) => `
            <div class="caja" data-categoria="${escapar(cat)}">
              <h3>${escapar(cat)}</h3>
              <div class="caja-contenido" data-categoria="${escapar(cat)}"></div>
            </div>`
            )
            .join("")}
        </div>
        <button type="button" class="boton-principal" id="boton-responder" disabled>Responder</button>`;

    default:
      return "";
  }
}

// Wire de eventos. onResponder(respuesta) se llama una sola vez, cuando el usuario
// confirma. onPerdioFoco() se llama si el usuario cambia de pestaña mientras el ítem
// está en pantalla.
export function attachListeners(root, item, onResponder) {
  const boton = root.querySelector("#boton-responder");

  if (item.formato === "abierto") {
    const input = root.querySelector("#respuesta-abierta");
    boton.addEventListener("click", () => onResponder(input.value ?? ""));
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") onResponder(input.value ?? "");
    });
    input.focus();
    return;
  }

  if (item.formato === "opcion_multiple") {
    root.querySelectorAll(".boton-opcion").forEach((btn) => {
      btn.addEventListener("click", () => onResponder(Number(btn.dataset.indice)));
    });
    return;
  }

  if (item.formato === "ordenar") {
    const lista = root.querySelector("#lista-ordenar");
    const actualizarBotones = () => {
      const items = [...lista.children];
      items.forEach((li, i) => {
        li.querySelector('[data-mover="arriba"]').disabled = i === 0;
        li.querySelector('[data-mover="abajo"]').disabled = i === items.length - 1;
      });
    };
    lista.addEventListener("click", (ev) => {
      const btn = ev.target.closest("[data-mover]");
      if (!btn) return;
      const li = btn.closest("li");
      if (btn.dataset.mover === "arriba" && li.previousElementSibling) {
        lista.insertBefore(li, li.previousElementSibling);
      } else if (btn.dataset.mover === "abajo" && li.nextElementSibling) {
        lista.insertBefore(li.nextElementSibling, li);
      }
      actualizarBotones();
    });
    boton.addEventListener("click", () => {
      const orden = [...lista.children].map((li) => li.dataset.elemento);
      onResponder(orden);
    });
    return;
  }

  if (item.formato === "clasificar") {
    const bandeja = root.querySelector("#bandeja-elementos");
    const asignacion = {};
    let seleccionado = null;

    const marcarSeleccion = (ficha) => {
      root.querySelectorAll(".ficha").forEach((f) => f.classList.remove("ficha-seleccionada"));
      seleccionado = ficha;
      if (ficha) ficha.classList.add("ficha-seleccionada");
    };

    const actualizarBotonResponder = () => {
      const total = item.elementos.length;
      boton.disabled = Object.keys(asignacion).length !== total;
    };

    root.querySelectorAll(".ficha").forEach((ficha) => {
      ficha.addEventListener("click", () => {
        if (seleccionado === ficha) {
          marcarSeleccion(null);
        } else {
          marcarSeleccion(ficha);
        }
      });
    });

    root.querySelectorAll(".caja").forEach((caja) => {
      caja.addEventListener("click", () => {
        if (!seleccionado) return;
        const categoria = caja.dataset.categoria;
        const contenido = caja.querySelector(".caja-contenido");
        contenido.appendChild(seleccionado);
        seleccionado.classList.remove("ficha-seleccionada");
        asignacion[seleccionado.dataset.elemento] = categoria;
        seleccionado = null;
        actualizarBotonResponder();
      });
    });

    // Devolver una ficha ya asignada a la bandeja, para poder reasignarla.
    bandeja.addEventListener("click", () => {}); // la bandeja en sí no hace nada; las fichas ya tienen su listener

    boton.addEventListener("click", () => onResponder({ ...asignacion }));
    return;
  }
}
