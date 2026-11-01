// Identidad de producto para juntar el mismo producto de distintas tiendas.
// 1) EAN (código de barras) si es válido; 2) si no, nombre normalizado + tamaño exactos.
const STOP = new Set(["de", "del", "la", "el", "los", "las", "con", "en", "y", "a", "por", "para", "un", "una", "x"]);
const UNIDADES = new Set(["g", "gr", "grs", "gramos", "kg", "kgs", "kilo", "kilos", "ml", "cc", "cm3", "l", "lt", "lts", "litro", "litros", "un", "u", "unidades"]);

const palabras = (s) =>
  String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9ñ\s]/g, " ").split(/\s+/).filter(Boolean);

function eanValido(ean) {
  const d = String(ean ?? "").replace(/\D/g, "").replace(/^0+/, ""); // 0779... y 779... son el mismo código
  return d.length >= 8 ? d : null;
}

function claveProducto(item) {
  const ean = eanValido(item.ean);
  if (ean) return `ean:${ean}`;
  // Sin EAN: solo se junta si hay tamaño conocido y el nombre es idéntico (sin importar orden ni stopwords)
  if (item.cantidad && item.unidad) {
    const sig = [...new Set(palabras(item.nombre).filter((w) => !STOP.has(w) && !UNIDADES.has(w) && !/^\d+([.,]\d+)?$/.test(w)))].sort().join(" ");
    if (sig) return `nom:${sig}|${Math.round(item.cantidad * 1000) / 1000}${item.unidad}`;
  }
  return `solo:${item.tienda}:${item.itemId}`; // no se junta con nada
}

module.exports = { claveProducto, eanValido };
