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
      // Listas largas (10 elementos es lo habitual) se reparten en dos columnas
      // para reducir el alto total y el arrastre en distancias largas con
      // scroll de por medio; listas cortas se quedan en una sola columna, en
      // la que no aporta nada partir en dos. El número de posición se pinta
      // en línea con el propio texto (no en un badge aparte) para que las
      // líneas que envuelven no queden indentadas bajo un hueco fijo. Las
      // columnas se rebalancean tras cada arrastre (ver redistribuirColumnas
      // en attachListeners) para que la mitad/mitad se mantenga siempre, en
      // vez de permitir que una columna se quede vacía y la otra acumule todo.
      const mitad = Math.ceil(orden.length / 2);
      const columnas = orden.length > 4 ? [orden.slice(0, mitad), orden.slice(mitad)] : [orden];
      let numero = 0;
      const filaOrdenar = (el) => {
        numero += 1;
        return `
            <li data-elemento="${escapar(el)}">
              <span class="texto-elemento"><span class="num-orden">${numero}.</span>${escapar(el)}</span>
            </li>`;
      };
      return `
        <div class="columnas-ordenar">
          ${columnas
            .map((columna) => `<ol class="columna-ordenar">${columna.map(filaOrdenar).join("")}</ol>`)
            .join("")}
        </div>
        <button type="button" class="boton-principal" id="boton-responder">Responder</button>`;
    }

    case "clasificar": {
      const previa =
        respuestaPrevia && typeof respuestaPrevia === "object" && !Array.isArray(respuestaPrevia)
          ? respuestaPrevia
          : {};
      // Dos columnas siempre visibles a la vez (elementos ↔ categorías), en vez
      // de una bandeja arriba y las cajas destino más abajo: evita el scroll
      // entre origen y destino que invitaba a rellenar deprisa y mal. Los
      // elementos no se mueven de la columna al asignarse (a diferencia de la
      // "bandeja" anterior): se marcan con la categoría asignada. Para
      // desasignar no hay una entrada "Sin asignar" en la columna de categorías
      // (ver attachListeners): basta con soltar el elemento de vuelta sobre la
      // columna de elementos (arrastre) o tocarlo dos veces (toque).
      return `
        <div class="clasificar-columnas">
          <div class="clasificar-col">
            <h3 class="clasificar-col-titulo">Elementos</h3>
            <ul class="clasificar-lista" id="lista-elementos">
              ${item.elementos
                .map((el) => {
                  const cat = previa[el];
                  return `
                <li class="elemento-clasificar${cat ? " elemento-asignado" : ""}" data-elemento="${escapar(el)}" data-categoria-asignada="${cat ? escapar(cat) : ""}">
                  <span class="elemento-clasificar-texto">${escapar(el)}</span>
                  <span class="elemento-clasificar-categoria">${cat ? escapar(cat) : ""}</span>
                </li>`;
                })
                .join("")}
            </ul>
          </div>
          <div class="clasificar-col">
            <h3 class="clasificar-col-titulo">Categorías</h3>
            <ul class="clasificar-lista" id="lista-categorias">
              ${item.categorias
                .map((cat) => `<li class="categoria-clasificar" data-categoria="${escapar(cat)}">${escapar(cat)}</li>`)
                .join("")}
            </ul>
          </div>
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
    const columnas = [...root.querySelectorAll(".columna-ordenar")];
    const todosLosLi = () => columnas.flatMap((col) => [...col.querySelectorAll("li")]);

    // El número de posición se recalcula tras cada arrastre recorriendo las
    // columnas en orden (izquierda→derecha, arriba→abajo dentro de cada una):
    // ese recorrido define el orden final que se envía al responder.
    const actualizarNumeros = () => {
      let n = 0;
      todosLosLi().forEach((li) => {
        n += 1;
        li.querySelector(".num-orden").textContent = `${n}.`;
      });
    };

    // Tras cada arrastre, reparte de nuevo los elementos a mitades iguales
    // entre las dos columnas (misma proporción que el reparto inicial en
    // html()), en vez de dejar que el usuario apile todo en una columna y
    // vacíe la otra: toma el orden ya resultante del arrastre (izquierda→derecha,
    // arriba→abajo) y reasigna esa secuencia a las columnas por mitades,
    // preservando el orden relativo entre elementos.
    const redistribuirColumnas = () => {
      if (columnas.length < 2) return;
      const enOrden = todosLosLi();
      const mitad = Math.ceil(enOrden.length / 2);
      columnas[0].append(...enOrden.slice(0, mitad));
      columnas[1].append(...enOrden.slice(mitad));
    };

    // Arrastre con Pointer Events (funciona con ratón y con dedo, a diferencia
    // del drag-and-drop nativo de HTML5, que no es fiable en móvil). El elemento
    // arrastrado se saca del flujo (position: fixed) y un "hueco" marca el punto
    // de inserción mientras se mueve, en la columna más cercana al puntero
    // (permite mover elementos también entre columnas).
    let arrastrando = null;
    let hueco = null;
    let offsetX = 0;
    let offsetY = 0;

    const columnaMasCercana = (x) =>
      columnas.reduce(
        (mejor, columna) => {
          const rect = columna.getBoundingClientRect();
          const distancia = Math.abs(x - (rect.left + rect.width / 2));
          return distancia < mejor.distancia ? { columna, distancia } : mejor;
        },
        { columna: columnas[0], distancia: Number.POSITIVE_INFINITY }
      ).columna;

    const siguienteTrasHueco = (columna, y) => {
      const candidatos = [...columna.querySelectorAll("li")].filter((li) => li !== arrastrando && li !== hueco);
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

    todosLosLi().forEach((li) => {
      li.addEventListener("pointerdown", (ev) => {
        arrastrando = li;
        const rect = li.getBoundingClientRect();
        offsetX = ev.clientX - rect.left;
        offsetY = ev.clientY - rect.top;

        hueco = document.createElement("li");
        hueco.className = "hueco-arrastre";
        hueco.style.height = `${rect.height}px`;
        li.parentElement.insertBefore(hueco, li);

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
        const columnaDestino = columnaMasCercana(ev.clientX);
        const siguiente = siguienteTrasHueco(columnaDestino, ev.clientY);
        if (siguiente == null) {
          columnaDestino.appendChild(hueco);
        } else if (siguiente !== hueco.nextSibling || hueco.parentElement !== columnaDestino) {
          columnaDestino.insertBefore(hueco, siguiente);
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
        hueco.parentElement.insertBefore(li, hueco);
        hueco.remove();
        hueco = null;
        arrastrando = null;
        redistribuirColumnas();
        actualizarNumeros();
      };
      li.addEventListener("pointerup", soltar);
      li.addEventListener("pointercancel", soltar);
    });

    boton.addEventListener("click", () => {
      onResponder(todosLosLi().map((li) => li.dataset.elemento));
    });
    return;
  }

  if (item.formato === "clasificar") {
    const listaElementos = root.querySelector("#lista-elementos");
    const listaCategorias = root.querySelector("#lista-categorias");
    const asignacion = {};
    let seleccionado = null;

    // Si el ítem se pinta con una respuesta previa (revisión tras "atrás"), los
    // elementos ya vienen marcados con su categoría asignada (ver html()): se
    // relee ese estado inicial en vez de asumir que todo empieza sin asignar.
    listaElementos.querySelectorAll(".elemento-clasificar").forEach((el) => {
      if (el.dataset.categoriaAsignada) asignacion[el.dataset.elemento] = el.dataset.categoriaAsignada;
    });

    const marcarSeleccion = (elemento) => {
      listaElementos.querySelectorAll(".elemento-clasificar").forEach((el) => el.classList.remove("elemento-seleccionado"));
      seleccionado = elemento;
      if (elemento) elemento.classList.add("elemento-seleccionado");
    };

    // A diferencia de la "bandeja" anterior, el elemento no cambia de columna
    // al asignarse: se queda en su sitio en la columna de elementos y solo
    // cambia su estado (marca + etiqueta con la categoría). "categoria" a null
    // desasigna (equivalente a tocar/soltar sobre "Sin asignar").
    const asignar = (elemento, categoria) => {
      const etiqueta = elemento.querySelector(".elemento-clasificar-categoria");
      if (categoria) {
        elemento.classList.add("elemento-asignado");
        elemento.dataset.categoriaAsignada = categoria;
        etiqueta.textContent = categoria;
        asignacion[elemento.dataset.elemento] = categoria;
      } else {
        elemento.classList.remove("elemento-asignado");
        delete elemento.dataset.categoriaAsignada;
        etiqueta.textContent = "";
        delete asignacion[elemento.dataset.elemento];
      }
    };

    listaCategorias.querySelectorAll(".categoria-clasificar").forEach((categoria) => {
      categoria.addEventListener("click", () => {
        if (!seleccionado) return;
        asignar(seleccionado, categoria.dataset.categoria || null);
        marcarSeleccion(null);
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

    listaElementos.querySelectorAll(".elemento-clasificar").forEach((elemento) => {
      elemento.addEventListener("pointerdown", (ev) => {
        arrastrando = elemento;
        arrastroRealizado = false;
        inicioX = ev.clientX;
        inicioY = ev.clientY;
        const rect = elemento.getBoundingClientRect();
        offsetX = ev.clientX - rect.left;
        offsetY = ev.clientY - rect.top;
        elemento.setPointerCapture(ev.pointerId);
      });

      elemento.addEventListener("pointermove", (ev) => {
        if (arrastrando !== elemento) return;
        if (!arrastroRealizado) {
          if (Math.hypot(ev.clientX - inicioX, ev.clientY - inicioY) < 6) return;
          arrastroRealizado = true;
          const rect = elemento.getBoundingClientRect();
          elemento.classList.add("elemento-arrastrando");
          elemento.style.position = "fixed";
          elemento.style.width = `${rect.width}px`;
          elemento.style.left = `${rect.left}px`;
          elemento.style.top = `${rect.top}px`;
          elemento.style.pointerEvents = "none";
        }
        elemento.style.left = `${ev.clientX - offsetX}px`;
        elemento.style.top = `${ev.clientY - offsetY}px`;
        listaCategorias.querySelectorAll(".categoria-objetivo").forEach((c) => c.classList.remove("categoria-objetivo"));
        const destino = document.elementFromPoint(ev.clientX, ev.clientY);
        const categoria = destino ? destino.closest(".categoria-clasificar") : null;
        if (categoria) categoria.classList.add("categoria-objetivo");
      });

      const soltar = (ev) => {
        if (arrastrando !== elemento) return;
        elemento.releasePointerCapture(ev.pointerId);
        arrastrando = null;
        listaCategorias.querySelectorAll(".categoria-objetivo").forEach((c) => c.classList.remove("categoria-objetivo"));
        if (!arrastroRealizado) return; // deja que "click" gestione la selección por toque

        elemento.classList.remove("elemento-arrastrando");
        elemento.style.position = "";
        elemento.style.left = "";
        elemento.style.top = "";
        elemento.style.width = "";
        elemento.style.pointerEvents = "";

        const destino = document.elementFromPoint(ev.clientX, ev.clientY);
        const categoria = destino ? destino.closest(".categoria-clasificar") : null;
        const vuelveAElementos = destino ? destino.closest("#lista-elementos") : null;

        if (categoria) {
          asignar(elemento, categoria.dataset.categoria || null);
        } else if (vuelveAElementos) {
          asignar(elemento, null);
        }
        marcarSeleccion(null);
      };
      elemento.addEventListener("pointerup", soltar);
      elemento.addEventListener("pointercancel", soltar);

      elemento.addEventListener("click", () => {
        if (arrastroRealizado) {
          arrastroRealizado = false;
          return;
        }
        // Un clic sobre un elemento solo cambia SU selección, nunca reasigna
        // el elemento que estuviera seleccionado antes: si el usuario tenía
        // uno seleccionado y el clic cae por error sobre otro ya asignado, lo
        // peor que puede pasar es que el primero se quede sin asignar
        // (recuperable), nunca que se asigne a la categoría equivocada.
        if (seleccionado === elemento) {
          // Segundo toque sobre el mismo elemento ya seleccionado: si estaba
          // asignado, lo desasigna (no hay entrada "Sin asignar" en categorías
          // para tocar como destino; ver comentario en html()).
          if (elemento.classList.contains("elemento-asignado")) asignar(elemento, null);
          marcarSeleccion(null);
        } else {
          marcarSeleccion(elemento);
        }
      });
    });

    // A diferencia de los otros formatos, "clasificar" permite enviar sin
    // asignar todos los elementos: los que falten cuentan como incorrectos
    // con el sistema de puntuación fraccionaria (puntuarClasificar en
    // worker/src/puntuacion.ts ya los trata como fallo, sin cambios extra).
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
      return elegidas.length
        ? `<ul class="resumen-lista">${elegidas.map((el) => `<li>${escapar(el)}</li>`).join("")}</ul>`
        : `<p class="resumen-respuesta">(sin respuesta)</p>`;
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
                    : `<span class="resumen-clasificar-vacio">(sin elementos)</span>`
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

// Estado del badge en la pantalla "ver mis respuestas" (README §3): además de
// acierto/fallo (que vienen del Worker ya calculados), distingue "sin_respuesta"
// cuando el usuario no llegó a contestar nada, para no confundirlo con un fallo
// activo. "ordenar" nunca puede quedar sin respuesta: siempre envía una
// permutación completa (aunque sea la de partida sin tocar).
export function estadoRespuesta(item) {
  const r = item.respuesta_usuario;
  switch (item.formato) {
    case "abierto":
      if (typeof r !== "string" || r.trim() === "") return "sin_respuesta";
      break;
    case "opcion_multiple":
      if (r == null || r === -1) return "sin_respuesta";
      break;
    case "seleccion_multiple":
      if (!Array.isArray(r) || r.length === 0) return "sin_respuesta";
      break;
    case "clasificar":
      if (!r || typeof r !== "object" || Array.isArray(r) || Object.keys(r).length === 0) return "sin_respuesta";
      break;
  }
  return item.acierto ? "acierto" : "fallo";
}

// Renderizado de solo lectura para la pantalla "ver respuestas" (README §3): toma
// un ItemRevision del Worker (ya incluye la respuesta correcta y lo que respondió
// el usuario) y pinta en verde lo acertado y en rojo lo fallado.
export function htmlRevision(item) {
  switch (item.formato) {
    case "abierto": {
      const clase = item.acierto ? "acierto" : "fallo";
      // Sin respuesta: el badge "Sin respuesta" (estadoRespuesta, arriba) ya lo dice;
      // repetirlo aquí como "Tu respuesta: «(sin respuesta)»" en rojo es redundante y
      // confuso (parece un fallo activo, no una pregunta sin contestar).
      return `
        ${
          estadoRespuesta(item) === "sin_respuesta"
            ? ""
            : `<p class="revision-texto ${clase}">Tu respuesta: «${escapar(String(item.respuesta_usuario))}»</p>`
        }
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
