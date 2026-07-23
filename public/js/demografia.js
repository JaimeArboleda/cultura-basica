// Catálogos demográficos cerrados (README §2). Duplican intencionalmente los de
// worker/src/tipos.ts: el front-end no puede importar TypeScript del Worker
// directamente (son despliegues separados). Si se cambia un catálogo, hay que
// actualizar ambos ficheros.
export const CATALOGOS = {
  sexo: ["Hombre", "Mujer", "Otro", "Prefiero no decirlo"],
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
  profesion: [
    "Directores y gerentes",
    "Técnicos y profesionales científicos e intelectuales",
    "Técnicos y profesionales de apoyo",
    "Empleados contables, administrativos y otros empleados de oficina",
    "Trabajadores de los servicios de restauración, personales, protección y vendedores",
    "Trabajadores cualificados en el sector agrícola, ganadero, forestal y pesquero",
    "Artesanos y trabajadores cualificados de las industrias manufactureras y la construcción",
    "Operadores de instalaciones y maquinaria, y montadores",
    "Ocupaciones elementales",
    "Estudiante",
    "Desempleado/a",
    "Jubilado/a",
  ],
  libros_en_casa: ["0-10", "11-25", "26-100", "101-200", "+200"],
  frecuencia_lectura: ["Nunca", "Rara vez", "Algunas veces al mes", "Varias veces por semana", "A diario"],
  consumo_informativos: ["Nunca", "Rara vez", "Varias veces por semana", "A diario"],
  horas_redes_dia: ["0", "Menos de 1", "1-2", "2-4", "Más de 4"],
  // pais_nacimiento es "cerrado + otros" (README §2): lista corta de los países más
  // frecuentes en la muestra esperada + "Otro" con texto libre.
  paises_frecuentes: [
    "España",
    "México",
    "Argentina",
    "Colombia",
    "Perú",
    "Venezuela",
    "Chile",
    "Ecuador",
    "Otro",
  ],
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

      ${campoSelect("sexo", "Sexo", CATALOGOS.sexo)}

      <label class="campo">
        <span>País de nacimiento</span>
        <select id="pais_nacimiento" name="pais_nacimiento" required>
          <option value="" disabled selected>Selecciona…</option>
          ${CATALOGOS.paises_frecuentes.map((p) => `<option value="${p}">${p}</option>`).join("")}
        </select>
      </label>
      <label class="campo" id="campo-pais-otro" hidden>
        <span>Especifica el país</span>
        <input id="pais_nacimiento_otro" name="pais_nacimiento_otro" type="text" />
      </label>

      ${campoSelect("ccaa_nacimiento", "Comunidad autónoma de nacimiento (si naciste en España)", CATALOGOS.ccaa, { opcional: true })}
      ${campoSelect("ccaa_residencia", "Comunidad autónoma de residencia", CATALOGOS.ccaa)}
      ${campoSelect("nivel_estudios", "Nivel de estudios", CATALOGOS.nivel_estudios)}
      ${campoSelect("area_estudios", "Área de estudios", CATALOGOS.area_estudios)}
      ${campoSelect("profesion", "Profesión", CATALOGOS.profesion)}
      ${campoSelect("estudios_padre", "Nivel de estudios del padre", CATALOGOS.nivel_estudios)}
      ${campoSelect("estudios_madre", "Nivel de estudios de la madre", CATALOGOS.nivel_estudios)}
      ${campoSelect("libros_en_casa", "Libros en casa a los 15 años (aprox.)", CATALOGOS.libros_en_casa)}
      ${campoSelect("frecuencia_lectura", "Frecuencia de lectura", CATALOGOS.frecuencia_lectura)}
      ${campoSelect("consumo_informativos", "Consumo de informativos", CATALOGOS.consumo_informativos)}
      ${campoSelect("horas_redes_dia", "Horas al día en redes sociales", CATALOGOS.horas_redes_dia)}

      <button type="submit" class="boton-principal">Continuar</button>
    </form>`;
}

export function attachListeners(root, onSubmit) {
  const form = root.querySelector("#form-demografia");
  const paisSelect = form.querySelector("#pais_nacimiento");
  const campoOtro = form.querySelector("#campo-pais-otro");
  const inputOtro = form.querySelector("#pais_nacimiento_otro");

  paisSelect.addEventListener("change", () => {
    const esOtro = paisSelect.value === "Otro";
    campoOtro.hidden = !esOtro;
    inputOtro.required = esOtro;
  });

  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const datos = new FormData(form);
    const pais = datos.get("pais_nacimiento") === "Otro" ? datos.get("pais_nacimiento_otro") : datos.get("pais_nacimiento");

    onSubmit({
      anio_nacimiento: Number(datos.get("anio_nacimiento")),
      sexo: datos.get("sexo"),
      pais_nacimiento: (pais || "").trim(),
      ccaa_nacimiento: datos.get("ccaa_nacimiento") || null,
      ccaa_residencia: datos.get("ccaa_residencia"),
      nivel_estudios: datos.get("nivel_estudios"),
      area_estudios: datos.get("area_estudios"),
      profesion: datos.get("profesion"),
      estudios_padre: datos.get("estudios_padre"),
      estudios_madre: datos.get("estudios_madre"),
      libros_en_casa: datos.get("libros_en_casa"),
      frecuencia_lectura: datos.get("frecuencia_lectura"),
      consumo_informativos: datos.get("consumo_informativos"),
      horas_redes_dia: datos.get("horas_redes_dia"),
    });
  });
}
