// Recorre los términos de la lista en todas las tiendas y guarda precios + promos.
const { buscar, TIENDAS } = require("../scrapers");
const { guardar } = require("../db");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function rastrear({ terminos, tiendas = Object.keys(TIENDAS), pausaMs = 1500, log = console.log }) {
  const resumen = [];
  for (const termino of terminos) {
    const q = String(termino).trim().toLowerCase();
    if (!q) continue;
    for (const tienda of tiendas) {
      try {
        const items = await buscar(tienda, q);
        guardar(tienda, q, items);
        const conPromo = items.filter((i) => i.promos?.length || i.descuentoPct > 0).length;
        log(`✓ ${q} @ ${tienda}: ${items.length} productos, ${conPromo} con promo`);
        resumen.push({ q, tienda, ok: true, n: items.length, conPromo });
      } catch (e) {
        log(`✗ ${q} @ ${tienda}: ${e.message}`);
        resumen.push({ q, tienda, ok: false, error: e.message });
      }
      if (pausaMs) await sleep(pausaMs);
    }
  }
  return resumen;
}

module.exports = { rastrear };
