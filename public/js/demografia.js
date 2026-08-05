// Catálogos demográficos cerrados (README §2). Duplican intencionalmente los de
// worker/src/tipos.ts: el front-end no puede importar TypeScript del Worker
// directamente (son despliegues separados). Si se cambia un catálogo, hay que
// actualizar ambos ficheros.
export const CATALOGOS = {
  ccaa: [
    "Andalucía",
    "Aragón",
    "Asturias",
    "Cantabria",
    "Castilla-La Mancha",
    "Castilla y León",
    "Cataluña",
    "Comunidad Valenciana",
    "Extremadura",
    "Galicia",
    "Islas Baleares",
    "Canarias",
    "La Rioja",
    "Comunidad de Madrid",
    "Región de Murcia",
    "Navarra",
    "País Vasco",
    "Ceuta",
    "Melilla",
  ],
  nivel_estudios: [
    "sin estudios",
    "primaria",
    "ESO",
    "bachillerato",
    "FP grado medio",
    "FP grado superior",
    "grado o licenciatura",
    "máster",
    "doctorado",
  ],
  area_estudios: [
    "Artes y humanidades",
    "Ciencias sociales y jurídicas",
    "Ciencias",
    "Ingeniería y arquitectura",
    "Ciencias de la salud",
    "No aplica",
  ],
  libros_en_casa: ["0-10", "11-25", "26-100", "101-200", "+200"],
};

function campoSelect(id, etiqueta, opciones, { opcional = false } = {}) {
  const opcs = opciones.map((o) => `<option value="${o}">${o}</option>`).join("");
  return `
    <label class="campo">
      <span>${etiqueta}${opcional ? " (opcional)" : ""}</span>
      <select id="${id}" name="${id}" ${opcional ? "" : "required"}>
        <option value="" disabled selected>Selecciona…</option>
        ${opcs}
      </select>
    </label>`;
}

export function html() {
  return `
    <form id="form-demografia" novalidate>
      <label class="campo">
        <span>Año de nacimiento</span>
        <input id="anio_nacimiento" name="anio_nacimiento" type="number" inputmode="numeric"
               min="1920" max="${new Date().getFullYear() - 5}" required />
      </label>

      ${campoSelect("ccaa_educacion_secundaria", "Comunidad autónoma donde cursaste la educación secundaria", CATALOGOS.ccaa)}
      ${campoSelect("nivel_estudios", "Nivel de estudios", CATALOGOS.nivel_estudios)}
      ${campoSelect("area_estudios", "Área de estudios", CATALOGOS.area_estudios)}
      ${campoSelect("estudios_mayor_progenitor", "Mayor nivel de estudios de tu padre o madre", CATALOGOS.nivel_estudios)}
      ${campoSelect("libros_en_casa", "Libros en casa a los 15 años (aprox.)", CATALOGOS.libros_en_casa)}

      <button type="submit" class="boton-principal">Continuar</button>
    </form>`;
}

export function attachListeners(root, onSubmit) {
  const form = root.querySelector("#form-demografia");

  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const datos = new FormData(form);

    onSubmit({
      anio_nacimiento: Number(datos.get("anio_nacimiento")),
      ccaa_educacion_secundaria: datos.get("ccaa_educacion_secundaria"),
      nivel_estudios: datos.get("nivel_estudios"),
      area_estudios: datos.get("area_estudios"),
      estudios_mayor_progenitor: datos.get("estudios_mayor_progenitor"),
      libros_en_casa: datos.get("libros_en_casa"),
    });
  });
}
