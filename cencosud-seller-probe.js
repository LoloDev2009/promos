// Busca el "seller" propio de Disco y Vea para /_v/search-promotions. Solo LEE.
// Uso: node cencosud-seller-probe.js            (prueba disco y vea)
//      node cencosud-seller-probe.js disco leche --seller=OTRO_ID   (suma un candidato a mano)
const BASES = { disco: "https://www.disco.com.ar", vea: "https://www.vea.com.ar" };
const JUMBO = "jumboargentinaj5202martinez";
const args = process.argv.slice(2);
const manual = args.filter((a) => a.startsWith("--seller=")).map((a) => a.slice(9));
const pos = args.filter((a) => !a.startsWith("--"));
const tiendas = BASES[pos[0]] ? [pos[0]] : Object.keys(BASES);
const termino = BASES[pos[0]] ? pos[1] || "leche" : "leche";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const hdr = (base) => ({ "User-Agent": UA, Accept: "application/json", "Content-Type": "application/json", Origin: base, Referer: base + "/" });

async function promos(base, seller, skus) {
  try {
    const r = await fetch(`${base}/_v/search-promotions`, { method: "POST", headers: hdr(base), body: JSON.stringify({ seller, skus: skus.map(String) }) });
    const txt = await r.text();
    if (!r.ok) return { http: r.status, nota: txt.slice(0, 120) };
    const j = JSON.parse(txt), nombres = new Map(); let conPromo = 0;
    for (const [grupo, g] of Object.entries(j.promotions ?? {})) {
      for (const [sku, arr] of Object.entries(g?.promotions ?? {})) {
        conPromo++;
        for (const p of [].concat(arr)) nombres.set(`${grupo}: ${p?.name}`, (nombres.get(`${grupo}: ${p?.name}`) || 0) + 1);
      }
    }
    return { http: r.status, grupos: Object.keys(j.promotions ?? {}), skusConPromo: conPromo, nombres: [...nombres.keys()].slice(0, 8) };
  } catch (e) { return { error: e.message }; }
}

(async () => {
  for (const t of tiendas) {
    const base = BASES[t];
    console.log(`\n===== ${t.toUpperCase()} =====`);
    const cands = new Set(manual);
    // 1) sellers que muestra el catálogo
    let skus = [];
    try {
      const r = await fetch(`${base}/api/catalog_system/pub/products/search?ft=${encodeURIComponent(termino)}&_from=0&_to=19`, { headers: hdr(base) });
      const prods = await r.json();
      skus = prods.map((p) => p.items?.[0]?.itemId).filter(Boolean).slice(0, 20);
      const vistos = new Set();
      for (const p of prods) for (const s of p.items?.[0]?.sellers ?? []) vistos.add(`${s.sellerId} (${s.sellerName})`);
      console.log("catálogo HTTP", r.status, "· skus:", skus.length, "· sellers del catálogo:", [...vistos].join(", ") || "-");
      for (const v of vistos) { const id = v.split(" ")[0]; if (id !== "1") cands.add(id); }
    } catch (e) { console.log("catálogo error:", e.message); }
    // 2) strings parecidos a un seller en el HTML de la home
    try {
      const html = await (await fetch(base + "/", { headers: { "User-Agent": UA, Accept: "text/html" } })).text();
      const hits = new Set([...html.matchAll(/\b(?:jumbo|disco|vea)[a-z]*\d{3,}[a-z0-9]*\b/gi)].map((m) => m[0].toLowerCase()));
      for (const m of html.matchAll(/"seller(?:Id)?"\s*:\s*"([^"]{4,60})"/g)) hits.add(m[1]);
      console.log("candidatos en el HTML:", [...hits].slice(0, 10).join(", ") || "ninguno");
      hits.forEach((h) => cands.add(h));
    } catch (e) { console.log("HTML error:", e.message); }
    if (!skus.length) { console.log("sin SKUs, no se puede probar promos"); continue; }
    // 3) probar cada candidato y comparar con el seller de Jumbo
    console.log("\n[base] seller de Jumbo sobre SKUs de", t, "→", JSON.stringify(await promos(base, JUMBO, skus)));
    for (const c of cands) { if (c !== JUMBO) console.log(`[candidato] ${c} →`, JSON.stringify(await promos(base, c, skus))); }
    if (![...cands].some((c) => c !== JUMBO)) console.log("No apareció ningún candidato. Hace falta DevTools (ver abajo).");
  }
  console.log(`\nSi un candidato da HTTP 200 y sus promos DIFIEREN de la [base] de Jumbo (sin "PR PRIME"), ese es el seller.
Si no hay candidatos: en la web de la tienda → F12 → Network → filtro "search-promotions" → recargar → clic en el pedido → pestaña Payload → copiame SOLO el valor de "seller" (no el cURL).
Pegame toda esta salida.`);
})();
