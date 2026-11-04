// Seguimiento diario. Uso: node track.js            (toda la lista de watchlist.json + búsquedas de Mi compra)
//                         node track.js yerba arroz (solo esos términos)
// Ajustes opcionales (.env): TRACK_CONCURRENCIA (búsquedas simultáneas por tienda, 2 por defecto) y TRACK_PAUSA_MS.
const fs = require("fs");
const path = require("path");
const { rastrear } = require("./lib/track");
const { compraTerminos } = require("./db");
const { TIENDAS } = require("./scrapers");

const archivo = process.env.WATCHLIST_FILE || path.join(__dirname, "watchlist.json");
// Sin argumentos: la lista de seguimiento + las búsquedas de donde salieron los productos de "Mi compra"
const terminos = process.argv.length > 2
  ? process.argv.slice(2)
  : [...new Set([
      ...JSON.parse(fs.readFileSync(archivo, "utf8")).terminos.map((x) => String(x).trim().toLowerCase()),
      ...compraTerminos(),
    ])];
const concurrencia = Math.max(1, +process.env.TRACK_CONCURRENCIA || 2);
const pausaMs = process.env.TRACK_PAUSA_MS !== undefined ? +process.env.TRACK_PAUSA_MS : 300;

console.log(`[${new Date().toLocaleString("es-AR")}] Rastreando ${terminos.length} términos en ${Object.keys(TIENDAS).length} tiendas (hasta ${concurrencia} a la vez por tienda)…`);
rastrear({ terminos, concurrencia, pausaMs }).then((res) => {
  const porTienda = {};
  for (const r of res) (porTienda[r.tienda] ||= { ok: 0, total: 0 }), porTienda[r.tienda].total++, r.ok && porTienda[r.tienda].ok++;
  const ok = res.filter((r) => r.ok).length;
  console.log(`\nListo en ${(res.duracionMs / 1000).toFixed(1)} s — ${ok}/${res.length} búsquedas OK`);
  console.log(Object.entries(porTienda).map(([t, v]) => `${t} ${v.ok}/${v.total}`).join(" · "));
  process.exit(ok === 0 ? 1 : 0);
});
