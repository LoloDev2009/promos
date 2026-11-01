// Scraper genérico para tiendas VTEX (Carrefour, Día).
const { parsePromo } = require("../lib/promos");
const { parseCantidad } = require("../lib/unidades");
const { analizar } = require("../lib/relevancia");
const { pool } = require("../lib/concurrencia");

const TIENDAS = {
  // simular=true: las promos viven en el carrito (hay que simularlo para verlas)
  carrefour: { base: process.env.CARREFOUR_URL || "https://www.carrefour.com.ar", simular: true },
  // Día: el descuento ya viene en el precio (precio vs precio de lista)
  dia: { base: process.env.DIA_URL || "https://diaonline.supermercadosdia.com.ar", simular: false },
};

const PAGE = 50;
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept: "application/json",
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, opts = {}) {
  const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(12000) });
  if (!res.ok && res.status !== 206) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function normalizar(tienda, p) {
  const sku = p.items?.[0];
  const seller = sku?.sellers?.[0];
  const offer = seller?.commertialOffer ?? {};
  const precio = offer.Price ?? 0;
  const lista = offer.ListPrice ?? precio;
  const { cantidad, unidad } = parseCantidad(p.productName);
  return {
    tienda,
    itemId: sku?.itemId ?? null,
    sellerId: seller?.sellerId ?? "1",
    nombre: p.productName,
    marca: p.brand,
    ean: sku?.ean || null,
    link: p.link,
    imagen: sku?.images?.[0]?.imageUrl ?? null,
    precio,
    precioLista: lista,
    descuentoPct: lista > precio ? Math.round((1 - precio / lista) * 100) : 0,
    etiquetas: Object.values(p.clusterHighlights ?? {}).filter(Boolean),
    disponible: (offer.AvailableQuantity ?? 0) > 0,
    cantidad,
    unidad,
    promos: [],
  };
}

// Disponibilidad real: simula un carrito con 1 unidad de cada producto (en lotes) y deja solo los
// que VTEX marca como "available". El stock del catálogo (AvailableQuantity) no es confiable.
async function verificarStock(base, items) {
  const lotes = [];
  for (let i = 0; i < items.length; i += 40) lotes.push(items.slice(i, i + 40));
  const disponibles = new Set();
  let verificado = true;
  await Promise.all(lotes.map(async (lote) => {
    try {
      const data = await getJson(`${base}/api/checkout/pub/orderForms/simulation?sc=1`, {
        method: "POST",
        headers: { ...HEADERS, "Content-Type": "application/json" },
        body: JSON.stringify({
          items: lote.map((it) => ({ id: it.itemId, quantity: 1, seller: it.sellerId })),
          postalCode: process.env.CP || "1425",
          country: "ARG",
        }),
      });
      for (const x of data.items ?? []) if (x.availability === "available") disponibles.add(String(x.id));
    } catch {
      // si la verificación falla no descartamos el lote: mejor mostrar de más que perder todo
      verificado = false;
      lote.forEach((it) => disponibles.add(String(it.itemId)));
    }
  }));
  return { items: items.filter((it) => disponibles.has(String(it.itemId))), verificado };
}

// Simula un carrito de 4 unidades para detectar promos ACTIVAS (2x1, 3x2, 2do al X%...)
async function simular(base, item) {
  const data = await getJson(`${base}/api/checkout/pub/orderForms/simulation?sc=1`, {
    method: "POST",
    headers: { ...HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify({
      items: [{ id: item.itemId, quantity: 4, seller: item.sellerId }],
      postalCode: process.env.CP || "1425",
      country: "ARG",
    }),
  });
  const nombres = [...new Set((data.ratesAndBenefitsData?.teaser ?? []).map((t) => t.name).filter(Boolean))];
  return nombres.map((n) => parsePromo(n));
}

async function buscar(tienda, termino, { paginas = 2, maxSimulaciones = 40, concurrencia = 6, base } = {}) {
  const cfg = TIENDAS[tienda];
  if (!cfg) throw new Error(`Tienda desconocida: ${tienda}`);
  const BASE = base || cfg.base;
  const q = termino.replace(/['"]/g, " ").trim(); // VTEX rechaza comillas

  // Todas las páginas de resultados a la vez. Si falla la primera es un error; las otras son opcionales.
  const pedidas = await Promise.allSettled(
    Array.from({ length: paginas }, (_, p) =>
      getJson(
        `${BASE}/api/catalog_system/pub/products/search?ft=${encodeURIComponent(q)}&_from=${p * PAGE}&_to=${p * PAGE + PAGE - 1}`,
        { headers: HEADERS }
      )
    )
  );
  if (pedidas[0].status === "rejected") throw pedidas[0].reason;
  const crudos = pedidas.flatMap((r) => (r.status === "fulfilled" && Array.isArray(r.value) ? r.value : []));

  let items = crudos.map((p) => normalizar(tienda, p)).filter((i) => i.disponible && i.precio > 0);
  items = [...new Map(items.map((i) => [i.itemId, i])).values()]; // sin duplicados entre páginas
  const v = await verificarStock(BASE, items);
  items = v.items;
  items.forEach((i) => (i.stockVerificado = v.verificado));

  if (cfg.simular) {
    // Las promos se consultan primero para los productos que realmente son lo buscado:
    // son los que muestra la página por defecto (los demás quedan ocultos por el filtro).
    const prioridad = (it) => {
      const r = analizar(termino, it.nombre);
      return r.coincide && r.pos <= 1 ? 0 : r.coincide ? 1 : 2;
    };
    items = items
      .map((it, k) => ({ it, k, p: prioridad(it) }))
      .sort((a, b) => a.p - b.p || a.k - b.k)
      .map((x) => x.it);
    await pool(items.slice(0, maxSimulaciones), concurrencia, async (it) => {
      try {
        it.promos = await simular(BASE, it);
      } catch {
        /* sin promo detectable para este producto */
      }
    });
  }
  return items;
}

module.exports = { buscar, TIENDAS };
