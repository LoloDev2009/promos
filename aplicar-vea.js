// Activa Vea con su seller propio. Uso (desde la raíz del repo): node aplicar-vea.js
// Tolera finales de línea CRLF, es idempotente y no escribe nada si alguna edición no encaja.
const fs = require("fs");
const EDICIONES = [
 [
  "scrapers/vtex.js",
  "const SELLER_JUMBO = \"jumboargentinaj5202martinez\";\n",
  "const SELLER_JUMBO = \"jumboargentinaj5202martinez\";\nconst SELLER_VEA = \"jumboargentinav700cordoba700\"; // seller propio de Vea (el de Jumbo mostraba una promo que Vea no tiene)\n"
 ],
 [
  "scrapers/vtex.js",
  "         promos: process.env.VEA_PROMO_SELLER ? \"cencosud\" : \"pendiente\", promoSeller: process.env.VEA_PROMO_SELLER || null },",
  "         // Verificado a mano contra su web: 10 productos (leche), promos y precios coinciden. El nombre del seller sugiere una sucursal de Córdoba.\n         promos: \"cencosud\", promoSeller: process.env.VEA_PROMO_SELLER || SELLER_VEA, gruposIgnorados: [\"jumbo_prime\", \"sgc\"] },"
 ],
 [
  "test/run.js",
  "  assert.equal(vtexMod.TIENDAS.vea.promos, \"pendiente\", \"Vea: falta el seller de promos\");",
  "  assert.equal(vtexMod.TIENDAS.vea.promos, \"cencosud\", \"Vea lee promos con su seller propio\");\n  assert.equal(vtexMod.TIENDAS.vea.promoSeller, \"jumboargentinav700cordoba700\");\n  assert.notEqual(vtexMod.TIENDAS.vea.promoSeller, vtexMod.TIENDAS.jumbo.promoSeller, \"Vea no usa el seller de Jumbo\");"
 ],
 [
  "test/run.js",
  "  assert.ok(dd.every((i) => i.promosLeidas === true));",
  "  assert.ok(dd.every((i) => i.promosLeidas === true));\n  // Vea: usa su seller propio y también descarta jumbo_prime y sgc\n  const antesV = cuerposPromo.length;\n  const vv = await vtexMod.buscar(\"vea\", \"yerba\", { base: `http://localhost:${pjp}`, paginas: 1 });\n  assert.ok(cuerposPromo.length > antesV, \"Vea pide promos\");\n  assert.ok(cuerposPromo.slice(antesV).every((c) => c.seller === \"jumboargentinav700cordoba700\"), \"Vea usa su seller\");\n  assert.equal(vv.find((i) => i.itemId === \"411520\").promos.length, 0, \"Vea: la promo Prime se descarta\");\n  assert.equal(vv.find((i) => i.itemId === \"1005\").promos.length, 0, \"Vea: el grupo sgc se descarta\");\n  assert.equal(vv.find((i) => i.itemId === \"32755\").promos[0].pctEfectivo, 35);\n  assert.ok(vv.every((i) => i.promosLeidas === true));"
 ],
 [
  ".env.example",
  "# Promos de Vea: apagadas. NO uses el seller de Jumbo: mostraba una promo que Vea no tenía.\n# Poné acá el seller propio de Vea (DevTools > Network > search-promotions > Payload) para activarlas.\n#VEA_PROMO_SELLER=",
  "# Promos de Vea: ya vienen activas con su seller propio (jumboargentinav700cordoba700, verificado contra su web).\n# NO uses el seller de Jumbo para Vea: mostraba una promo que Vea no tenía.\n#VEA_PROMO_SELLER="
 ],
 [
  "README.md",
  "- **Vea**: apagada (\"promos sin leer\"). Con el seller de Jumbo mostró una promo que Vea no tiene (4 de 5 coincidieron). Para activarla hace falta su seller propio: copiá `.env.example` a `.env` y completá `VEA_PROMO_SELLER`.",
  "- **Vea**: lee sus promos con su seller propio (`jumboargentinav700cordoba700`). Con el seller de Jumbo mostraba una promo que Vea no tiene (4 de 5 coincidieron); con el propio coincidieron 10 de 10 promos y precios (búsquedas \"leche\" y \"leche la serenisima barista\"). Se descartan `jumbo_prime` y `sgc`. Limitaciones: muestra chica y de una sola categoría, y el nombre del seller sugiere una sucursal de Córdoba, así que las promos podrían variar por zona. Se cambia con `VEA_PROMO_SELLER`."
 ]
];
const porArchivo = new Map();
for (const [f, vieja, nueva] of EDICIONES) {
  if (!porArchivo.has(f)) {
    const crudo = fs.readFileSync(f, "utf8");
    porArchivo.set(f, { crlf: crudo.includes("\r\n"), s: crudo.replace(/\r\n/g, "\n") });
  }
  const o = porArchivo.get(f);
  if (o.s.includes(nueva)) { console.log("ya aplicado:", f); continue; }
  const n = o.s.split(vieja).length - 1;
  if (n !== 1) { console.error(`NO ENCAJA en ${f} (apariciones: ${n}). No se modificó nada. Primero aplicá el parche de Disco.\n--- buscaba ---\n${vieja.slice(0, 160)}`); process.exit(1); }
  o.s = o.s.replace(vieja, () => nueva);
  console.log("editado:", f);
}
for (const [f, o] of porArchivo) fs.writeFileSync(f, o.crlf ? o.s.replace(/\n/g, "\r\n") : o.s);
console.log("Listo. Corré npm test.");