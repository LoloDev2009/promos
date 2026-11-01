// Saca la cantidad del nombre ("500 g", "1 Kg", "100 cc") y la normaliza a kg / l.
const RE = /(\d+(?:[.,]\d+)?)\s*(kgs|kg|kilos|kilo|grs|gr|gramos|g|lts|lt|litros|litro|ml|cc|cm3|l)\b\.?/gi;

function parseCantidad(nombre) {
  const matches = [...(nombre || "").matchAll(RE)];
  if (!matches.length) return { cantidad: null, unidad: null };
  const m = matches[matches.length - 1]; // el último suele ser el tamaño del envase
  const n = parseFloat(m[1].replace(",", "."));
  const u = m[2].toLowerCase();
  if (!(n > 0)) return { cantidad: null, unidad: null };
  if (["kg", "kgs", "kilo", "kilos"].includes(u)) return { cantidad: n, unidad: "kg" };
  if (["g", "gr", "grs", "gramos"].includes(u)) return { cantidad: n / 1000, unidad: "kg" };
  if (["l", "lt", "lts", "litro", "litros"].includes(u)) return { cantidad: n, unidad: "l" };
  return { cantidad: n / 1000, unidad: "l" }; // ml, cc, cm3
}

module.exports = { parseCantidad };
