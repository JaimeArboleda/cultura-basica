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
              <span class="asa-arrastre" aria-hidden="true">⠿</span>
              <span class="texto-elemento">${escapar(el)}</span>
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

    // Arrastre con Pointer Events (funciona con ratón y con dedo, a diferencia
    // del drag-and-drop nativo de HTML5, que no es fiable en móvil). El elemento
    // arrastrado se saca del flujo (position: fixed) y un "hueco" marca el punto
    // de inserción mientras se mueve.
    let arrastrando = null;
    let hueco = null;
    let offsetX = 0;
    let offsetY = 0;

    const siguienteTrasHueco = (y) => {
      const candidatos = [...lista.querySelectorAll("li")].filter((li) => li !== arrastrando && li !== hueco);
      return candidatos.reduce(
        (cercania, li) => {
          const rect = li.getBoundingClientRect();
          const desplazamiento = y - rect.top - rect.height / 2;
          if (desplazamiento < 0 && desplazamiento > cercania.desplazamiento) {
            return { desplazamiento, elemento: li };
          }
          return cercania;
        },
        { desplazamiento: Number.NEGATIVE_INFINITY, elemento: null }
      ).elemento;
    };

    lista.querySelectorAll("li").forEach((li) => {
      li.addEventListener("pointerdown", (ev) => {
        if (ev.target.closest("[data-mover]")) return;
        arrastrando = li;
        const rect = li.getBoundingClientRect();
        offsetX = ev.clientX - rect.left;
        offsetY = ev.clientY - rect.top;

        hueco = document.createElement("li");
        hueco.className = "hueco-arrastre";
        hueco.style.height = `${rect.height}px`;
        lista.insertBefore(hueco, li);

        li.style.position = "fixed";
        li.style.left = `${rect.left}px`;
        li.style.top = `${rect.top}px`;
        li.style.width = `${rect.width}px`;
        li.classList.add("arrastrando");
        li.setPointerCapture(ev.pointerId);
      });

      li.addEventListener("pointermove", (ev) => {
        if (arrastrando !== li) return;
        li.style.left = `${ev.clientX - offsetX}px`;
        li.style.top = `${ev.clientY - offsetY}px`;
        const siguiente = siguienteTrasHueco(ev.clientY);
        if (siguiente == null) {
          lista.appendChild(hueco);
        } else if (siguiente !== hueco.nextSibling) {
          lista.insertBefore(hueco, siguiente);
        }
      });

      const soltar = (ev) => {
        if (arrastrando !== li) return;
        li.releasePointerCapture(ev.pointerId);
        li.classList.remove("arrastrando");
        li.style.position = "";
        li.style.left = "";
        li.style.top = "";
        li.style.width = "";
        lista.insertBefore(li, hueco);
        hueco.remove();
        hueco = null;
        arrastrando = null;
        actualizarBotones();
      };
      li.addEventListener("pointerup", soltar);
      li.addEventListener("pointercancel", soltar);
    });

    boton.addEventListener("click", () => {
      const orden = [...lista.querySelectorAll("li")].map((li) => li.dataset.elemento);
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

    // Arrastre con Pointer Events, igual que en "ordenar". Se distingue de un
    // toque/clic normal por umbral de distancia: si el puntero no se mueve más
    // de 6px, se deja que el "click" de siempre gestione la selección por toque.
    let arrastrando = null;
    let arrastroRealizado = false;
    let inicioX = 0;
    let inicioY = 0;
    let offsetX = 0;
    let offsetY = 0;

    root.querySelectorAll(".ficha").forEach((ficha) => {
      ficha.addEventListener("pointerdown", (ev) => {
        arrastrando = ficha;
        arrastroRealizado = false;
        inicioX = ev.clientX;
        inicioY = ev.clientY;
        const rect = ficha.getBoundingClientRect();
        offsetX = ev.clientX - rect.left;
        offsetY = ev.clientY - rect.top;
        ficha.setPointerCapture(ev.pointerId);
      });

      ficha.addEventListener("pointermove", (ev) => {
        if (arrastrando !== ficha) return;
        if (!arrastroRealizado) {
          if (Math.hypot(ev.clientX - inicioX, ev.clientY - inicioY) < 6) return;
          arrastroRealizado = true;
          const rect = ficha.getBoundingClientRect();
          ficha.classList.add("ficha-arrastrando");
          ficha.style.position = "fixed";
          ficha.style.width = `${rect.width}px`;
          ficha.style.pointerEvents = "none";
        }
        ficha.style.left = `${ev.clientX - offsetX}px`;
        ficha.style.top = `${ev.clientY - offsetY}px`;
      });

      const soltar = (ev) => {
        if (arrastrando !== ficha) return;
        ficha.releasePointerCapture(ev.pointerId);
        arrastrando = null;
        if (!arrastroRealizado) return; // deja que "click" gestione la selección por toque

        ficha.classList.remove("ficha-arrastrando");
        ficha.style.position = "";
        ficha.style.left = "";
        ficha.style.top = "";
        ficha.style.width = "";
        ficha.style.pointerEvents = "";

        const destino = document.elementFromPoint(ev.clientX, ev.clientY);
        const caja = destino ? destino.closest(".caja") : null;
        const vuelveABandeja = destino ? destino.closest("#bandeja-elementos") : null;

        if (caja) {
          caja.querySelector(".caja-contenido").appendChild(ficha);
          asignacion[ficha.dataset.elemento] = caja.dataset.categoria;
        } else if (vuelveABandeja) {
          bandeja.appendChild(ficha);
          delete asignacion[ficha.dataset.elemento];
        }
        marcarSeleccion(null);
        actualizarBotonResponder();
      };
      ficha.addEventListener("pointerup", soltar);
      ficha.addEventListener("pointercancel", soltar);

      ficha.addEventListener("click", () => {
        if (arrastroRealizado) {
          arrastroRealizado = false;
          return;
        }
        if (seleccionado === ficha) {
          marcarSeleccion(null);
        } else {
          marcarSeleccion(ficha);
        }
      });
    });

    boton.addEventListener("click", () => onResponder({ ...asignacion }));
    return;
  }
}
