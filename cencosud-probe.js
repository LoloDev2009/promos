// Sondeo de las promos de Jumbo / Disco / Vea (grupo Cencosud).
// Estas tiendas no ponen sus descuentos en el lugar estándar de VTEX: usan un endpoint interno del sitio.
// Este script solo LEE y muestra qué responde, para poder construir el parser.
//
// Uso: node cencosud-probe.js jumbo yerba
//      node cencosud-probe.js disco leche --seller=<seller>   (el seller sale de DevTools, ver abajo)
const BASES = { jumbo: "https://www.jumbo.com.ar", disco: "https://www.disco.com.ar", vea: "https://www.vea.com.ar" };
// Único seller conocido por documentación pública de terceros; Disco y Vea hay que sacarlos de DevTools
const SELLERS = { jumbo: "jumboargentinaj5202martinez" };

const [tienda, termino = "yerba", ...resto] = process.argv.slice(2);
const base = BASES[tienda];
if (!base) { console.log("Uso: node cencosud-probe.js <jumbo|disco|vea> [término] [--seller=ID]"); process.exit(1); }
const seller = (resto.find((a) => a.startsWith("--seller=")) || "").slice(9) || SELLERS[tienda];

const H = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept: "application/json", "Content-Type": "application/json", Origin: base, Referer: base + "/",
};
const corto = (x, n = 1500) => (typeof x === "string" ? x : JSON.stringify(x, null, 1)).slice(0, n);

(async () => {
  console.log(`== ${tienda} · búsqueda "${termino}" ==`);
  const r = await fetch(`${base}/api/catalog_system/pub/products/search?ft=${encodeURIComponent(termino)}&_from=0&_to=9`, { headers: H });
  console.log("catálogo HTTP", r.status);
  const prods = await r.json();
  if (!Array.isArray(prods) || !prods.length) return console.log("sin resultados");
  const resumen = prods.slice(0, 5).map((p) => {
    const sku = p.items?.[0], of = sku?.sellers?.[0]?.commertialOffer ?? {};
    return { nombre: p.productName, itemId: sku?.itemId, sellers: (sku?.sellers ?? []).map((s) => s.sellerId),
             Price: of.Price, ListPrice: of.ListPrice, Teasers: of.Teasers, DiscountHighLight: of.DiscountHighLight };
  });
  console.log(corto(resumen, 2500));

  const skus = prods.slice(0, 10).map((p) => p.items?.[0]?.itemId).filter(Boolean);
  if (!seller) return console.log("\nFalta el seller de esta tienda. Pasalo con --seller=ID (se ve en DevTools, ver instrucciones).");
  console.log(`\n== promos: POST ${base}/_v/search-promotions  seller=${seller} ==`);
  for (const [etiqueta, body] of [
    ["skus como texto", { seller, skus: skus.map(String) }],
    ["skus como número", { seller, skus: skus.map(Number) }],
  ]) {
    try {
      const rp = await fetch(`${base}/_v/search-promotions`, { method: "POST", headers: H, body: JSON.stringify(body) });
      const txt = await rp.text();
      console.log(`[${etiqueta}] HTTP ${rp.status}\n${corto(txt)}\n`);
      if (rp.ok) break;
    } catch (e) {
      console.log(`[${etiqueta}] error: ${e.message}`);
    }
  }
})().catch((e) => console.error("Error:", e.message));
