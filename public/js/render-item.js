// Renderizado y captura de respuesta por formato de ítem (README §1.5).
// Todas las funciones aquí trabajan sobre datos ya "públicos" (sin respuesta
// correcta) tal como los sirve el Worker.

// Escapa para uso seguro tanto en texto como dentro de atributos HTML entre
// comillas dobles (el uso que se le da en todo este fichero, p. ej.
// data-categoria="${escapar(cat)}"). textContent → innerHTML ya cubre &, < y
// >, pero NO las comillas dobles: un valor real como la categoría
// 'Leopoldo Alas "Clarín"' (data/items/04.json) rompía el atributo a mitad de
// cadena y truncaba el valor que luego se leía por dataset, provocando que la
// clasificación se guardase con la categoría equivocada sin ningún error
// visible (issue #3, bug "La Regenta").
function escapar(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML.replaceAll('"', "&quot;");
}

// respuestaPrevia (opcional) es la respuesta ya enviada anteriormente para este
// ítem, tal como la construye onResponder en cada formato (README §"navegación
// atrás"). Si está presente, el ítem se pinta ya con ese estado para poder
// revisarlo/corregirlo sin perderlo al volver atrás.
export function html(item, respuestaPrevia) {
  switch (item.formato) {
    case "abierto": {
      const valorPrevio = typeof respuestaPrevia === "string" ? respuestaPrevia : "";
      return `
        <input id="respuesta-abierta" type="text" inputmode="text" autocomplete="off"
               placeholder="Escribe tu respuesta" value="${escapar(valorPrevio)}" />
        <button type="button" class="boton-principal" id="boton-responder">Responder</button>`;
    }

    case "opcion_multiple": {
      const elegida = typeof respuestaPrevia === "number" ? respuestaPrevia : null;
      return `
        <div class="opciones opciones-multiples" role="group">
          ${item.opciones
            .map(
              (op, i) => `
            <label class="opcion-radio">
              <input type="radio" name="opcion-unica" data-indice="${i}" ${i === elegida ? "checked" : ""} />
              <span>${escapar(op)}</span>
            </label>`
            )
            .join("")}
        </div>
        <button type="button" class="boton-principal" id="boton-responder">Responder</button>`;
    }

    case "seleccion_multiple": {
      const elegidas = new Set(Array.isArray(respuestaPrevia) ? respuestaPrevia : []);
      return `
        <div class="opciones opciones-multiples" role="group">
          ${item.opciones
            .map(
              (op, i) => `
            <label class="opcion-checkbox">
              <input type="checkbox" data-indice="${i}" ${elegidas.has(i) ? "checked" : ""} />
              <span>${escapar(op)}</span>
            </label>`
            )
            .join("")}
        </div>
        <button type="button" class="boton-principal" id="boton-responder">Responder</button>`;
    }

    case "ordenar": {
      const esPermutacionValida =
        Array.isArray(respuestaPrevia) &&
        respuestaPrevia.length === item.elementos.length &&
        item.elementos.every((el) => respuestaPrevia.includes(el));
      const orden = esPermutacionValida ? respuestaPrevia : item.elementos;
      return `
        <ol id="lista-ordenar" class="lista-ordenar">
          ${orden
            .map(
              (el, i) => `
            <li data-elemento="${escapar(el)}">
              <span class="asa-arrastre" aria-hidden="true">⠿</span>
              <span class="texto-elemento">${escapar(el)}</span>
              <span class="controles-orden">
                <button type="button" data-mover="arriba" ${i === 0 ? "disabled" : ""} aria-label="Subir">▲</button>
                <button type="button" data-mover="abajo" ${i === orden.length - 1 ? "disabled" : ""} aria-label="Bajar">▼</button>
              </span>
            </li>`
            )
            .join("")}
        </ol>
        <button type="button" class="boton-principal" id="boton-responder">Responder</button>`;
    }

    case "clasificar": {
      const previa =
        respuestaPrevia && typeof respuestaPrevia === "object" && !Array.isArray(respuestaPrevia)
          ? respuestaPrevia
          : {};
      const ficha = (el) => `<button type="button" class="ficha" data-elemento="${escapar(el)}">${escapar(el)}</button>`;
      return `
        <div class="bandeja" id="bandeja-elementos">
          ${item.elementos
            .filter((el) => !(el in previa))
            .map(ficha)
            .join("")}
        </div>
        <div class="cajas-clasificar">
          ${item.categorias
            .map(
              (cat) => `
            <div class="caja" data-categoria="${escapar(cat)}">
              <h3>${escapar(cat)}</h3>
              <div class="caja-contenido" data-categoria="${escapar(cat)}">
                ${item.elementos
                  .filter((el) => previa[el] === cat)
                  .map(ficha)
                  .join("")}
              </div>
            </div>`
            )
            .join("")}
        </div>
        <button type="button" class="boton-principal" id="boton-responder">Responder</button>`;
    }

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
    const radios = [...root.querySelectorAll('input[type="radio"]')];
    // -1: "sin respuesta", igual que el resto de formatos (abierto vacío, selección
    // múltiple sin marcar…) permiten enviar sin haber elegido nada. corregirOpcionMultiple
    // (worker/src/correccion.ts) nunca la marca como acierto porque ningún índice real es -1.
    boton.addEventListener("click", () => {
      const elegida = radios.find((radio) => radio.checked);
      onResponder(elegida ? Number(elegida.dataset.indice) : -1);
    });
    return;
  }

  if (item.formato === "seleccion_multiple") {
    boton.addEventListener("click", () => {
      const seleccionadas = [...root.querySelectorAll('input[type="checkbox"]:checked')]
        .map((input) => Number(input.dataset.indice))
        .sort((a, b) => a - b);
      onResponder(seleccionadas);
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

    // Si el ítem se pinta con una respuesta previa (revisión tras "atrás"), las
    // fichas ya vienen colocadas en su caja-contenido (ver html()): se relee ese
    // estado inicial en vez de asumir que todo empieza vacío.
    root.querySelectorAll(".caja-contenido").forEach((contenido) => {
      contenido.querySelectorAll(".ficha").forEach((f) => {
        asignacion[f.dataset.elemento] = contenido.dataset.categoria;
      });
    });

    const marcarSeleccion = (ficha) => {
      root.querySelectorAll(".ficha").forEach((f) => f.classList.remove("ficha-seleccionada"));
      seleccionado = ficha;
      if (ficha) ficha.classList.add("ficha-seleccionada");
    };

    const colocarEnCaja = (caja) => {
      if (!seleccionado) return;
      const categoria = caja.dataset.categoria;
      const contenido = caja.querySelector(".caja-contenido");
      contenido.appendChild(seleccionado);
      seleccionado.classList.remove("ficha-seleccionada");
      asignacion[seleccionado.dataset.elemento] = categoria;
      seleccionado = null;
    };

    // El clic en la caja solo se atiende cuando cae directamente sobre su fondo:
    // si cae sobre una ficha ya colocada dentro (fichas y cajas están anidadas),
    // el evento burbujea desde la ficha hasta aquí y, sin este filtro, dispara
    // los dos listeners para el mismo clic — eso desincronizaba `asignacion`
    // (bug: una ficha recién seleccionada se perdía en silencio si el siguiente
    // clic caía sobre una ficha ya colocada en la caja destino).
    root.querySelectorAll(".caja").forEach((caja) => {
      caja.addEventListener("click", (ev) => {
        if (ev.target.closest(".ficha")) return;
        colocarEnCaja(caja);
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
      };
      ficha.addEventListener("pointerup", soltar);
      ficha.addEventListener("pointercancel", soltar);

      ficha.addEventListener("click", () => {
        if (arrastroRealizado) {
          arrastroRealizado = false;
          return;
        }
        // Un clic sobre una ficha solo cambia SU selección, nunca coloca la
        // ficha que estuviera pendiente de otra selección anterior: si el
        // usuario tenía una ficha seleccionada y el clic cae por error sobre
        // otra ficha ya colocada (en vez de en el fondo vacío de la caja
        // destino), lo peor que puede pasar es que esa ficha se quede sin
        // colocar (recuperable), nunca que se coloque en la caja equivocada.
        if (seleccionado === ficha) {
          marcarSeleccion(null);
        } else {
          marcarSeleccion(ficha);
        }
      });
    });

    // A diferencia de los otros formatos, "clasificar" permite enviar sin
    // colocar todas las fichas: los elementos que falten cuentan como
    // incorrectos con el sistema de puntuación fraccionaria (puntuarClasificar
    // en worker/src/puntuacion.ts ya los trata como fallo, sin cambios extra).
    boton.addEventListener("click", () => onResponder({ ...asignacion }));
    return;
  }
}

// Renderizado de solo lectura para la pantalla de revisión final previa al
// envío (respuesta ya guardada localmente en el cliente, tal como la
// construye onResponder en cada formato, pero todavía sin corregir por el
// Worker): a diferencia de htmlRevision, aquí no hay acierto/fallo ni
// respuesta correcta, solo lo que el usuario ha contestado hasta ahora.
export function htmlResumen(item, respuesta) {
  switch (item.formato) {
    case "abierto": {
      const valor = typeof respuesta === "string" ? respuesta.trim() : "";
      return `<p class="resumen-respuesta">${valor ? `Tu respuesta: «${escapar(valor)}»` : "(sin respuesta)"}</p>`;
    }

    case "opcion_multiple": {
      const elegida = typeof respuesta === "number" ? item.opciones[respuesta] : null;
      return `<p class="resumen-respuesta">${elegida ? escapar(elegida) : "(sin respuesta)"}</p>`;
    }

    case "seleccion_multiple": {
      const elegidas = Array.isArray(respuesta) ? respuesta.map((i) => item.opciones[i]).filter(Boolean) : [];
      return `<p class="resumen-respuesta">${elegidas.length ? elegidas.map(escapar).join(", ") : "(sin respuesta)"}</p>`;
    }

    case "ordenar": {
      const orden = Array.isArray(respuesta) ? respuesta : [];
      return `<ol class="resumen-orden">${orden.map((el) => `<li>${escapar(el)}</li>`).join("")}</ol>`;
    }

    case "clasificar": {
      const asignacion = respuesta && typeof respuesta === "object" && !Array.isArray(respuesta) ? respuesta : {};
      return `
        <div class="resumen-clasificar">
          ${item.categorias
            .map((cat) => {
              const elementos = item.elementos.filter((el) => asignacion[el] === cat);
              return `
              <div class="resumen-clasificar-caja">
                <h4>${escapar(cat)}</h4>
                ${
                  elementos.length
                    ? elementos.map((el) => `<span class="resumen-clasificar-elemento">${escapar(el)}</span>`).join("")
                    : `<span class="resumen-clasificar-vacio">(sin clasificar)</span>`
                }
              </div>`;
            })
            .join("")}
        </div>`;
    }

    default:
      return "";
  }
}

// Renderizado de solo lectura para la pantalla "ver respuestas" (README §3): toma
// un ItemRevision del Worker (ya incluye la respuesta correcta y lo que respondió
// el usuario) y pinta en verde lo acertado y en rojo lo fallado.
export function htmlRevision(item) {
  switch (item.formato) {
    case "abierto": {
      const clase = item.acierto ? "acierto" : "fallo";
      const respuesta = item.respuesta_usuario || "(sin respuesta)";
      return `
        <p class="revision-texto ${clase}">Tu respuesta: «${escapar(String(respuesta))}»</p>
        ${
          item.acierto
            ? ""
            : `<p class="revision-nota-correcta">Respuesta correcta: «${escapar(String(item.respuesta_correcta))}»</p>`
        }`;
    }

    case "opcion_multiple": {
      const elegida = item.respuesta_usuario;
      const correcta = item.respuesta_correcta;
      return `
        <div class="revision-opciones">
          ${item.opciones
            .map((op, i) => {
              let clase = "";
              let marca = "";
              if (i === elegida && i === correcta) {
                clase = "acierto";
                marca = " ✓";
              } else if (i === elegida) {
                clase = "fallo";
                marca = " ✗";
              } else if (i === correcta) {
                clase = "acierto no-marcada";
                marca = " (correcta)";
              }
              return `<div class="revision-opcion ${clase}">${escapar(op)}<span class="marca">${marca}</span></div>`;
            })
            .join("")}
        </div>`;
    }

    case "seleccion_multiple": {
      const elegidas = new Set(item.respuesta_usuario || []);
      const correctas = new Set(item.respuesta_correcta || []);
      return `
        <div class="revision-opciones">
          ${item.opciones
            .map((op, i) => {
              const marcada = elegidas.has(i);
              const esCorrecta = correctas.has(i);
              let clase = "";
              let marca = "";
              if (marcada && esCorrecta) {
                clase = "acierto";
                marca = " ✓";
              } else if (marcada && !esCorrecta) {
                clase = "fallo";
                marca = " ✗";
              } else if (!marcada && esCorrecta) {
                clase = "acierto no-marcada";
                marca = " (correcta, no marcada)";
              }
              return `<div class="revision-opcion ${clase}">${escapar(op)}<span class="marca">${marca}</span></div>`;
            })
            .join("")}
        </div>`;
    }

    case "ordenar": {
      const usuario = item.respuesta_usuario || [];
      const correcto = item.respuesta_correcta || [];
      return `
        <ol class="revision-orden">
          ${usuario
            .map((el, i) => {
              const clase = el === correcto[i] ? "acierto" : "fallo";
              return `<li class="${clase}">${escapar(el)}</li>`;
            })
            .join("")}
        </ol>
        ${
          item.acierto
            ? ""
            : `<p class="revision-nota-correcta">Orden correcto: ${correcto.map(escapar).join(" → ")}</p>`
        }`;
    }

    case "clasificar": {
      const usuario = item.respuesta_usuario || {};
      const correcto = item.respuesta_correcta || {};
      return `
        <div class="revision-clasificar">
          ${item.categorias
            .map((cat) => {
              const elementos = Object.keys(correcto).filter((el) => correcto[el] === cat);
              return `
              <div class="revision-clasificar-caja">
                <h4>${escapar(cat)}</h4>
                ${elementos
                  .map((el) => {
                    const clase = usuario[el] === correcto[el] ? "acierto" : "fallo";
                    return `<span class="revision-clasificar-elemento ${clase}">${escapar(el)}</span>`;
                  })
                  .join("")}
              </div>`;
            })
            .join("")}
        </div>`;
    }

    default:
      return "";
  }
}
