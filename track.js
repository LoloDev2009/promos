// Seguimiento diario. Uso: node track.js            (toda la lista de watchlist.json)
//                         node track.js yerba arroz (solo esos términos)
const fs = require("fs");
const path = require("path");
const { rastrear } = require("./lib/track");
const { compraTerminos } = require("./db");

const archivo = process.env.WATCHLIST_FILE || path.join(__dirname, "watchlist.json");
// Sin argumentos: la lista de seguimiento + las búsquedas de donde salieron los productos de "Mi compra"
const terminos = process.argv.length > 2
  ? process.argv.slice(2)
  : [...new Set([
      ...JSON.parse(fs.readFileSync(archivo, "utf8")).terminos.map((x) => String(x).trim().toLowerCase()),
      ...compraTerminos(),
    ])];

console.log(`[${new Date().toLocaleString("es-AR")}] Rastreando ${terminos.length} términos…`);
rastrear({ terminos }).then((res) => {
  const ok = res.filter((r) => r.ok).length;
  console.log(`Listo: ${ok}/${res.length} búsquedas OK.`);
  process.exit(ok === 0 ? 1 : 0);
});
