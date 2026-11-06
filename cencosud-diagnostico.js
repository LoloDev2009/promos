// Diagnóstico de UN producto: qué devuelve la API (promos de TODOS los grupos + campos de promo del catálogo).
// Uso: node cencosud-diagnostico.js vea "leche la serenisima barista" [--seller=ID]
const BASES = { jumbo: process.env.JUMBO_URL || "https://www.jumbo.com.ar", disco: process.env.DISCO_URL || "https://www.disco.com.ar", vea: process.env.VEA_URL || "https://www.vea.com.ar" };
const SELLERS = { jumbo: "jumboargentinaj5202martinez", disco: "jumboargentinaj5202martinez", vea: "jumboargentinav700cordoba700" };
const IGNORADOS = { disco: ["jumbo_prime", "sgc"], vea: ["jumbo_prime", "sgc"], jumbo: [] };
const args = process.argv.slice(2), pos = args.filter((a) => !a.startsWith("--"));
const [tienda, consulta] = pos;
if (!BASES[tienda] || !consulta) { console.log('Uso: node cencosud-diagnostico.js [jumbo|disco|vea] "búsqueda" [--seller=ID]'); process.exit(1); }
const seller = (args.find((a) => a.startsWith("--seller=")) || "").slice(9) || SELLERS[tienda];
const base = BASES[tienda];
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const H = { "User-Agent": UA, Accept: "application/json", "Content-Type": "application/json", Origin: base, Referer: base + "/" };
const norm = (s) => String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const corto = (o, n = 1500) => { const t = JSON.stringify(o, null, 1); return t.length > n ? t.slice(0, n) + " …(cortado)" : t; };

(async () => {
  console.log(`tienda: ${tienda} · seller: ${seller} · hoy: ${new Date().toLocaleDateString("sv")}`);
  const r = await fetch(`${base}/api/catalog_system/pub/products/search?ft=${encodeURIComponent(consulta)}&_from=0&_to=49`, { headers: H });
  const prods = await r.json();
  const palabras = norm(consulta).split(/\s+/).filter(Boolean);
  const hallados = prods.filter((p) => palabras.every((w) => norm(p.productName).includes(w))).slice(0, 3);
  console.log(`catálogo HTTP ${r.status}: ${prods.length} productos, ${hallados.length} coinciden con todas las palabras`);
  if (!hallados.length) { console.log("Primeros nombres:", prods.slice(0, 8).map((p) => p.productName).join(" | ")); return; }
  // Verificación de stock por carrito (lo que hace la app): ¿qué responde para TODOS los productos del catálogo?
  const cp = process.env.CP || "1425";
  const simular = async (lista) => {
    const rs = await fetch(`${base}/api/checkout/pub/orderForms/simulation`, { method: "POST", headers: H,
      body: JSON.stringify({ items: lista.map((p) => ({ id: String(p.items?.[0]?.itemId), quantity: 1, seller: p.items?.[0]?.sellers?.[0]?.sellerId ?? "1" })), postalCode: cp, country: "ARG" }) });
    const d = await rs.json().catch(() => ({}));
    return { http: rs.status, items: d.items ?? [], err: rs.ok ? null : JSON.stringify(d).slice(0, 200) };
  };
  const sim = await simular(prods.slice(0, 40));
  const cuenta = {}; for (const x of sim.items) cuenta[x.availability] = (cuenta[x.availability] || 0) + 1;
  console.log(`CARRITO (CP ${cp}, sin sc): HTTP ${sim.http} · ${prods.slice(0, 40).length} productos pedidos · respuesta por disponibilidad: ${JSON.stringify(cuenta)}${sim.err ? " · error: " + sim.err : ""}`);
  const dispo = new Set(sim.items.filter((x) => x.availability === "available").map((x) => String(x.id)));
  console.log(`=> la app dejaría ${dispo.size} de ${Math.min(prods.length, 40)}${dispo.size === 0 && prods.length < 5 ? "  (y como son <5 NO aplica el respaldo de usar el stock del catálogo: quedaría VACÍO)" : ""}`);
  const skus = hallados.map((p) => String(p.items?.[0]?.itemId));
  const rp = await fetch(`${base}/_v/search-promotions`, { method: "POST", headers: H, body: JSON.stringify({ seller, skus }) });
  const data = await rp.json().catch(() => ({}));
  console.log("search-promotions HTTP", rp.status, "· grupos:", Object.keys(data.promotions ?? {}).join(", ") || "ninguno");
  for (const p of hallados) {
    const it = p.items?.[0], sku = String(it?.itemId), co = it?.sellers?.[0]?.commertialOffer ?? {};
    console.log(`\n=== ${p.productName} (sku ${sku}, ean ${it?.ean}) ===\n${p.link}`);
    console.log("STOCK: AvailableQuantity del catálogo =", co.AvailableQuantity, "· sellerId =", it?.sellers?.[0]?.sellerId, "· carrito =", sim.items.find((x) => String(x.id) === sku)?.availability ?? "(no respondió)");
    console.log("PRECIO:", JSON.stringify({ Price: co.Price, ListPrice: co.ListPrice, PriceWithoutDiscount: co.PriceWithoutDiscount, DiscountHighLight: co.DiscountHighLight, Teasers: co.Teasers }));
    console.log("CLUSTERS:", JSON.stringify({ clusterHighlights: p.clusterHighlights, productClusters: p.productClusters }));
    let alguna = false;
    for (const [grupo, g] of Object.entries(data.promotions ?? {})) {
      const x = g?.promotions?.[sku];
      if (!x) continue; alguna = true;
      console.log(`PROMO [${grupo}]${IGNORADOS[tienda].includes(grupo) ? "  <-- la app DESCARTA este grupo" : ""}:\n${corto(x)}`);
    }
    if (!alguna) console.log("PROMOS: este SKU no devuelve ninguna promo en ningún grupo con este seller.");
  }
  console.log("\nPegame toda la salida y decime el texto exacto de la promo en la web y dónde aparece (tarjeta del listado o página del producto).");
})().catch((e) => console.error("Error:", e.message));