// Seguimiento: recorre los términos en todas las tiendas y guarda precios + promos.
// Las tiendas van en paralelo (como en las búsquedas de la página); dentro de cada tienda, hasta `concurrencia`
// búsquedas a la vez. Reintenta una vez los errores de una tienda que venía bien y abandona la que no responde.
const scrapers = require("../scrapers");
const db = require("../db");
const { pool } = require("./concurrencia");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const seg = (t0) => `${((Date.now() - t0) / 1000).toFixed(1)} s`;

async function rastrear({
  terminos, tiendas = Object.keys(scrapers.TIENDAS), pausaMs = 300, concurrencia = 2, reintentos = 1, maxFallasSeguidas = 3,
  log = console.log, buscarFn = scrapers.buscar, guardarFn = db.guardar, incluir = null,
}) {
  const qs = [...new Set(terminos.map((t) => String(t).trim().toLowerCase()).filter(Boolean))];
  const paraIncluir = incluir || db.compraItemIds(); // productos de Mi compra: sus promos se mantienen al día
  const t0 = Date.now();
  const resumen = [];

  await Promise.all(tiendas.map(async (tienda) => {
    let seguidas = 0, abandonada = false;
    await pool(qs, concurrencia, async (q) => {
      if (abandonada) {
        log(`– ${q} @ ${tienda}: omitida (la tienda no responde)`);
        resumen.push({ q, tienda, ok: false, error: "omitida: la tienda no responde" });
        return;
      }
      const t1 = Date.now();
      try {
        let items;
        for (let intento = 0; ; intento++) {
          try {
            items = await buscarFn(tienda, q, { soloRelevantes: true, incluir: paraIncluir.get(tienda) });
            break;
          } catch (e) {
            if (intento >= reintentos || seguidas > 0) throw e; // si la tienda ya venía fallando, no se insiste
            await sleep(pausaMs * 4);
          }
        }
        guardarFn(tienda, q, items);
        seguidas = 0;
        const conPromo = items.filter((i) => i.promos?.length || i.descuentoPct > 0).length;
        log(`✓ ${q} @ ${tienda}: ${items.length} productos, ${conPromo} con promo (${seg(t1)})`);
        resumen.push({ q, tienda, ok: true, n: items.length, conPromo, ms: Date.now() - t1 });
      } catch (e) {
        if (++seguidas >= maxFallasSeguidas) abandonada = true;
        log(`✗ ${q} @ ${tienda}: ${e.message} (${seg(t1)})`);
        resumen.push({ q, tienda, ok: false, error: e.message });
      }
      if (pausaMs) await sleep(pausaMs);
    });
  }));
  resumen.duracionMs = Date.now() - t0;
  return resumen;
}

module.exports = { rastrear };
