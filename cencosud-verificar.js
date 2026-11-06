// Para comparar a mano con la web: muestra productos de Disco/Vea con la promo que devuelve el seller de Jumbo.
// Uso: node cencosud-verificar.js [disco|vea] [término]     (por defecto: disco, "leche")
const BASES = { disco: process.env.DISCO_URL || "https://www.disco.com.ar", vea: process.env.VEA_URL || "https://www.vea.com.ar" };
const SELLER = process.env.PROMO_SELLER || "jumboargentinaj5202martinez";
const [tienda = "disco", termino = "leche"] = process.argv.slice(2);
const base = BASES[tienda];
if (!base) { console.log("Uso: node cencosud-verificar.js [disco|vea] [término]"); process.exit(1); }
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const H = { "User-Agent": UA, Accept: "application/json", "Content-Type": "application/json", Origin: base, Referer: base + "/" };

(async () => {
  const r = await fetch(`${base}/api/catalog_system/pub/products/search?ft=${encodeURIComponent(termino)}&_from=0&_to=19`, { headers: H });
  const prods = await r.json();
  const porSku = new Map();
  for (const p of prods) { const it = p.items?.[0]; if (it) porSku.set(String(it.itemId), { p, precio: it.sellers?.[0]?.commertialOffer?.Price }); }
  const rp = await fetch(`${base}/_v/search-promotions`, { method: "POST", headers: H, body: JSON.stringify({ seller: SELLER, skus: [...porSku.keys()] }) });
  const data = await rp.json();
  const filas = [];
  for (const [grupo, g] of Object.entries(data.promotions ?? {})) {
    for (const [sku, arr] of Object.entries(g?.promotions ?? {})) {
      const x = porSku.get(String(sku)); if (!x) continue;
      for (const pr of [].concat(arr)) filas.push({ sku, grupo, x, pr });
    }
  }
  filas.sort((a, b) => (a.grupo === "generic" ? 0 : 1) - (b.grupo === "generic" ? 0 : 1));
  console.log(`== ${tienda} · "${termino}" · ${filas.length} promos en ${new Set(filas.map((f) => f.sku)).size} productos ==`);
  console.log("Buscá cada producto en la web de la tienda y fijate si ve la misma promo, con el mismo precio.\n");
  const vistos = new Set();
  for (const f of filas) {
    if (vistos.size >= 5 && !vistos.has(f.sku)) continue;
    vistos.add(f.sku);
    console.log(`• ${f.x.p.productName}  — $${f.x.precio}`);
    console.log(`  ${base}${f.x.p.link ?? ""}`);
    console.log(`  [${f.grupo}] ${f.pr.name} · desc. efectivo ${f.pr.effectiveDiscount} · ${String(f.pr.start).slice(0, 10)} → ${String(f.pr.end).slice(0, 10)}`);
  }
  console.log("\nContame por cada producto: ¿la web muestra esa promo? (sí / no / otra distinta). Y si el precio coincide.");
})().catch((e) => console.error("Error:", e.message));
