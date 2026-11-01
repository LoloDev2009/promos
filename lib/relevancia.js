// Relevancia de un producto respecto de la búsqueda.
// Idea: en los nombres el producto va primero ("Leche Las Tres Niñas…") y los ingredientes después
// ("Dulce de Leche", "Chocolate con Leche"). Medimos en qué posición del nombre aparece la
// primera palabra buscada.
const STOP = new Set(["de", "del", "la", "el", "los", "las", "con", "en", "y", "a", "por", "para", "un", "una"]);

const normalizar = (s) =>
  String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9ñ\s]/g, " ").split(/\s+/).filter(Boolean);

// Tolera singular/plural y género: yogurt~yogur, fideo~fideos, descremado~descremada. leche≠lechuga.
function parecidas(a, b) {
  if (a === b) return true;
  const min = Math.min(a.length, b.length);
  if (min < 4) return false;
  const maxDif = min >= 7 ? 2 : 1;
  if (Math.abs(a.length - b.length) > maxDif) return false;
  let p = 0;
  while (p < min && a[p] === b[p]) p++;
  return p >= Math.max(4, min - 1);
}

// -> { coincide: todas las palabras buscadas están en el nombre, pos: posición de la primera }
function analizar(consulta, nombre) {
  const buscadas = normalizar(consulta).filter((t) => !STOP.has(t));
  const palabras = normalizar(nombre); // las stopwords cuentan para la posición
  if (!buscadas.length) return { coincide: true, pos: 0 };
  const posDe = (t) => palabras.findIndex((w) => parecidas(w, t));
  const posiciones = buscadas.map(posDe);
  return { coincide: posiciones.every((p) => p >= 0), pos: posiciones[0] >= 0 ? posiciones[0] : 99 };
}

const esExacto = (rel) => rel.coincide && rel.pos <= 1;

// Para la lista de seguimiento: lo exacto si hay suficiente, si no, lo que coincide, si no, todo
function filtrarRelevantes(items, minimo = 3) {
  const exactos = items.filter((i) => i.rel && esExacto(i.rel));
  if (exactos.length >= minimo) return exactos;
  const coinciden = items.filter((i) => i.rel?.coincide);
  return coinciden.length >= minimo ? coinciden : items;
}

module.exports = { analizar, esExacto, filtrarRelevantes };
