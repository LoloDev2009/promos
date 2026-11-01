// Resume coto-sample.json: estructura del producto sin las listas largas de precios por sucursal.
// Uso: node coto-probe2.js   (después de correr coto-probe.js)
const data = require("./coto-sample.json");
const results = (data.response ?? data).results ?? [];
if (!results.length) { console.log("coto-sample.json no tiene resultados"); process.exit(1); }

// Recorta arrays a 2 elementos e indica cuántos había
const recortar = (x) =>
  Array.isArray(x)
    ? [...x.slice(0, 2).map(recortar), ...(x.length > 2 ? [`... (${x.length} elementos en total)`] : [])]
    : x && typeof x === "object"
    ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, recortar(v)]))
    : x;

const p = results[0];
console.log("=== PRODUCTO 1 (listas recortadas) ===");
console.log(JSON.stringify(recortar(p), null, 1));

// Busca listas de precios por sucursal (objetos con "store") en cualquier parte del producto
function buscarListas(obj, ruta = "") {
  if (Array.isArray(obj)) {
    if (obj.length && obj.every((o) => o && typeof o === "object" && "store" in o)) {
      const claves = new Set(obj.flatMap((o) => Object.keys(o)));
      console.log(`\n=== LISTA POR SUCURSAL en "${ruta}" ===`);
      console.log("Cantidad de sucursales:", obj.length);
      console.log("Sucursales:", obj.map((o) => o.store).join(", ").slice(0, 300));
      console.log("Todas las claves que aparecen:", [...claves].join(", "));
      const conOferta = obj.filter((o) => o.saleImage1);
      console.log("Entradas con saleImage1:", conOferta.length);
      const e200 = obj.find((o) => String(o.store) === "200");
      if (e200) console.log("Entrada de la sucursal 200:", JSON.stringify(e200));
      // entradas con claves distintas a la primera (suelen tener los datos de promo)
      const base = Object.keys(obj[0]).sort().join();
      const raras = obj.filter((o) => Object.keys(o).sort().join() !== base).slice(0, 2);
      raras.forEach((o) => console.log("Entrada con claves distintas:", JSON.stringify(o)));
    }
    obj.forEach((o, i) => buscarListas(o, `${ruta}[${i}]`));
  } else if (obj && typeof obj === "object") {
    for (const [k, v] of Object.entries(obj)) buscarListas(v, ruta ? `${ruta}.${k}` : k);
  }
}
buscarListas(p);
