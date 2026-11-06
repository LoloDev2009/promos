// Arregla Vea: un carrito que responde 200 sin ítems ya no se toma como "todo agotado". Uso: node aplicar-stock.js
// Tolera finales de línea CRLF, es idempotente y no escribe nada si alguna edición no encaja.
const fs = require("fs");
const EDICIONES = [
 [
  "scrapers/vtex.js",
  "      for (const x of data.items ?? []) if (x.availability === \"available\") disponibles.add(String(x.id));",
  "      // Cencosud (Vea) responde 200 pero sin ningún ítem: eso no es \"todo agotado\", es que la verificación no funciona\n      if (!Array.isArray(data?.items) || data.items.length === 0) throw new Error(\"carrito sin ítems\");\n      for (const x of data.items) if (x.availability === \"available\") disponibles.add(String(x.id));"
 ],
 [
  "test/run.js",
  "  // ---- Agrupar el mismo producto entre tiendas ----",
  "  // Carrito que responde 200 pero SIN ítems (pasa en Vea): no es \"todo agotado\", se usa el stock del catálogo aun con pocos productos\n  const carritoVacio = http.createServer((req, res) => {\n    const send = (o) => { res.setHeader(\"Content-Type\", \"application/json\"); res.end(JSON.stringify(o)); };\n    if (req.url.startsWith(\"/api/catalog_system\")) {\n      if (!/_from=0/.test(req.url)) return send([]);\n      return send(Array.from({ length: 2 }, (_, k) => prod(String(90 + k), `Leche Barista ${k} 1 L`, 3390, 3390)));\n    }\n    send({ items: [] });\n  });\n  const pcv = await listen(carritoVacio);\n  const barista = await vtexMod.buscar(\"vea\", \"leche barista\", { base: `http://localhost:${pcv}` });\n  assert.equal(barista.length, 2, \"carrito sin ítems con pocos productos: no se pierden\");\n  assert.ok(barista.every((i) => i.stockVerificado === false));\n  carritoVacio.close();\n\n  // ---- Agrupar el mismo producto entre tiendas ----"
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
  if (n !== 1) { console.error(`NO ENCAJA en ${f} (apariciones: ${n}). No se modificó nada. Primero aplicá aplicar-vea.js y aplicar-cache.js (y el parche de Disco).\n--- buscaba ---\n${vieja.slice(0, 160)}`); process.exit(1); }
  o.s = o.s.replace(vieja, () => nueva);
  console.log("editado:", f);
}
for (const [f, o] of porArchivo) fs.writeFileSync(f, o.crlf ? o.s.replace(/\n/g, "\r\n") : o.s);
console.log("Listo. Corré npm test.");
