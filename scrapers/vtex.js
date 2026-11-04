// Scraper genérico para tiendas VTEX (Carrefour, Día).
const { parsePromo } = require("../lib/promos");
const { parseCantidad } = require("../lib/unidades");
const { analizar } = require("../lib/relevancia");
const { pool } = require("../lib/concurrencia");

// sc:          canal de ventas para el carrito. null = no mandarlo (en Jumbo/Disco/Vea con sc=1 da 400).
// scBusqueda:  si la búsqueda vuelve sin precios, se reintenta con este sc (pasa a veces en Carrefour/Día).
// promos:      "carrito"   = las promos se leen simulando un carrito
//              "precio"    = el descuento ya viene en el precio (precio vs precio de lista)
//              "cencosud"  = se leen del endpoint propio de Cencosud (necesita promoSeller)
//              "pendiente" = todavía no se leen (falta el seller de la tienda)
const TIENDAS = {
  carrefour: { nombre: "Carrefour", base: process.env.CARREFOUR_URL || "https://www.carrefour.com.ar", sc: "1", scBusqueda: "1", promos: "carrito" },
  dia: { nombre: "Día", base: process.env.DIA_URL || "https://diaonline.supermercadosdia.com.ar", sc: "1", scBusqueda: "1", promos: "precio", etiquetas: true },
  // Cencosud: las promos viven en /_v/search-promotions, que pide el "seller" de la tienda (no el "1" del catálogo)
  jumbo: { nombre: "Jumbo", base: process.env.JUMBO_URL || "https://www.jumbo.com.ar", sc: null, scBusqueda: null,
           promos: "cencosud", promoSeller: process.env.JUMBO_PROMO_SELLER || "jumboargentinaj5202martinez" },
  disco: { nombre: "Disco", base: process.env.DISCO_URL || "https://www.disco.com.ar", sc: null, scBusqueda: null,
           promos: process.env.DISCO_PROMO_SELLER ? "cencosud" : "pendiente", promoSeller: process.env.DISCO_PROMO_SELLER || null },
  vea: { nombre: "Vea", base: process.env.VEA_URL || "https://www.vea.com.ar", sc: null, scBusqueda: null,
         promos: process.env.VEA_PROMO_SELLER ? "cencosud" : "pendiente", promoSeller: process.env.VEA_PROMO_SELLER || null },
};

const conSc = (url, sc) => (sc ? `${url}${url.includes("?") ? "&" : "?"}sc=${sc}` : url);

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
  // ListPrice de Jumbo/Disco/Vea viene roto (~82 veces el precio real): si es absurdo o menor al precio, se ignora
  let lista = offer.ListPrice > 0 ? offer.ListPrice : precio;
  if (lista > precio * 3 || lista < precio) lista = precio;
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
    // Las colecciones de Cencosud/Carrefour ("Coca Cola", "Gaseosas"...) no son promos: solo Día las usa como campañas
    etiquetas: TIENDAS[tienda]?.etiquetas
      ? [...new Set(Object.values(p.clusterHighlights ?? {}).filter(Boolean))].slice(0, 3) : [],
    disponible: (offer.AvailableQuantity ?? 0) > 0,
    cantidad,
    unidad,
    promos: [],
  };
}

// Disponibilidad real: simula un carrito con 1 unidad de cada producto (en lotes) y deja solo los
// que VTEX marca como "available". El stock del catálogo (AvailableQuantity) no es confiable.
async function verificarStock(base, items, cfg) {
  const lotes = [];
  for (let i = 0; i < items.length; i += 40) lotes.push(items.slice(i, i + 40));
  const disponibles = new Set();
  let verificado = true;
  await Promise.all(lotes.map(async (lote) => {
    try {
      const data = await getJson(conSc(`${base}/api/checkout/pub/orderForms/simulation`, cfg.sc), {
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
  // Si el carrito no da ningún producto como disponible, lo más probable es que la verificación esté mal
  // configurada para esa tienda/zona (no que esté todo agotado): se usa el stock del catálogo.
  if (disponibles.size === 0 && items.length >= 5) return { items, verificado: false };
  return { items: items.filter((it) => disponibles.has(String(it.itemId))), verificado };
}

// Simula un carrito de 4 unidades para detectar promos ACTIVAS (2x1, 3x2, 2do al X%...)
async function simular(base, item, cfg) {
  const data = await getJson(conSc(`${base}/api/checkout/pub/orderForms/simulation`, cfg.sc), {
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

// ---- Promos de Cencosud (Jumbo/Disco/Vea) ----
const GRUPOS = { generic: null, jumbo_prime: "Jumbo Prime" };
const etiquetaGrupo = (g) => (g in GRUPOS ? GRUPOS[g] : String(g).replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()));
const dia = (iso) => (typeof iso === "string" && /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : null);

// p: promo de un SKU tal como la devuelve /_v/search-promotions; grupo: "generic" | "jumbo_prime" | ...
function promoCencosud(p, grupo, hoy) {
  const desde = dia(p.start), hasta = dia(p.end);
  if (hasta && hasta < hoy) return null; // vencida
  if (desde && desde > hoy) return null; // todavía no arrancó
  const nombre = p.name || "";
  const base = parsePromo(nombre); // "2do al 70% ...", "35% ...", "3x2 ..."
  let { tipo, minUnidades, pctEfectivo } = base;
  const ll = nombre.match(/llev\w*\s*(\d+)/i); // "llevando 2 ... 25%"
  if (ll && minUnidades === 1) minUnidades = +ll[1];
  // effectiveDiscount es el descuento efectivo oficial sobre las unidades de la promo
  // (en "2do al 70%" vale 0.35, el del par): manda sobre lo que se deduce del texto
  const eff = parseFloat(p.effectiveDiscount);
  if (eff > 0 && eff <= 0.95) {
    pctEfectivo = Math.round(eff * 1000) / 10;
    if (minUnidades === 1 || !tipo) tipo = `${pctEfectivo}% off`;
  }
  if (!(pctEfectivo > 0)) return null;

  // Condiciones: grupo distinto de "generic" (ej. membresía), medios de pago puntuales, días puntuales
  const condiciones = [];
  const g = etiquetaGrupo(grupo);
  if (g) condiciones.push(g);
  if ((p.providers?.length || 0) + (p.excludeProviders?.length || 0) > 0) condiciones.push("medio de pago puntual");
  if (p.days && Object.keys(p.days).length) condiciones.push("días puntuales");
  return {
    texto: nombre, tipo, minUnidades, pctEfectivo, desde, hasta, tope: null,
    requierePago: condiciones.length > 0, condicion: condiciones.join(" · ") || null,
  };
}

async function leerPromosCencosud(base, cfg, items) {
  const hoy = new Date().toLocaleDateString("sv");
  const lotes = [];
  for (let i = 0; i < items.length; i += 20) lotes.push(items.slice(i, i + 20)); // lotes de ~20 SKUs
  const porSku = new Map(items.map((it) => [String(it.itemId), it]));
  await pool(lotes, 3, async (lote) => {
    try {
      const data = await getJson(`${base}/_v/search-promotions`, {
        method: "POST",
        headers: { ...HEADERS, "Content-Type": "application/json", Origin: base, Referer: base + "/" },
        body: JSON.stringify({ seller: cfg.promoSeller, skus: lote.map((it) => String(it.itemId)) }),
      });
      if (!data || typeof data.promotions !== "object") throw new Error("respuesta sin promotions");
      for (const [grupo, g] of Object.entries(data.promotions)) {
        for (const [sku, p] of Object.entries(g?.promotions ?? {})) {
          const it = porSku.get(String(sku));
          const promo = it && promoCencosud(p, grupo, hoy);
          if (promo) it.promos.push(promo);
        }
      }
      lote.forEach((it) => (it.promosLeidas = true));
    } catch {
      lote.forEach((it) => (it.promosLeidas = false)); // la página avisa que no se pudieron leer
    }
  });
}

async function buscar(tienda, termino, { paginas = 2, maxSimulaciones = 40, concurrencia = 6, base, soloRelevantes = false, incluir = null } = {}) {
  const cfg = TIENDAS[tienda];
  if (!cfg) throw new Error(`Tienda desconocida: ${tienda}`);
  const BASE = base || cfg.base;
  const q = termino.replace(/['"]/g, " ").trim(); // VTEX rechaza comillas

  // Todas las páginas a la vez. Si falla la primera es un error; las otras son opcionales.
  async function traerPaginas(sc) {
    const pedidas = await Promise.allSettled(
      Array.from({ length: paginas }, (_, p) =>
        getJson(
          conSc(`${BASE}/api/catalog_system/pub/products/search?ft=${encodeURIComponent(q)}&_from=${p * PAGE}&_to=${p * PAGE + PAGE - 1}`, sc),
          { headers: HEADERS }
        )
      )
    );
    if (pedidas[0].status === "rejected") throw pedidas[0].reason;
    return pedidas.flatMap((r) => (r.status === "fulfilled" && Array.isArray(r.value) ? r.value : []));
  }
  let crudos = await traerPaginas(null);
  // VTEX a veces omite los precios si no se manda el canal de ventas: se reintenta con él (solo donde es válido)
  const sinPrecios = (arr) => arr.length > 0 && arr.every((p) => !p.items?.[0]?.sellers?.length);
  if (sinPrecios(crudos) && cfg.scBusqueda) crudos = await traerPaginas(cfg.scBusqueda);

  let items = crudos.map((p) => normalizar(tienda, p)).filter((i) => i.disponible && i.precio > 0);
  items = [...new Map(items.map((i) => [i.itemId, i])).values()]; // sin duplicados entre páginas
  const v = await verificarStock(BASE, items, cfg);
  items = v.items;
  items.forEach((i) => (i.stockVerificado = v.verificado));

  if (cfg.promos === "carrito") {
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
    // soloRelevantes (seguimiento diario): se omiten los que la página ocultaría, salvo los de Mi compra (incluir)
    const aSimular = soloRelevantes ? items.filter((it) => prioridad(it) === 0 || incluir?.has(String(it.itemId))) : items;
    await pool(aSimular.slice(0, maxSimulaciones), concurrencia, async (it) => {
      try {
        it.promos = await simular(BASE, it, cfg);
      } catch {
        /* sin promo detectable para este producto */
      }
    });
  }
  if (cfg.promos === "cencosud") await leerPromosCencosud(BASE, cfg, items);
  return items;
}

module.exports = { buscar, TIENDAS, promoCencosud };
