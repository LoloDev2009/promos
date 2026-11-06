// Caché: no guarda búsquedas vacías, descarta lo guardado una vez y agrega el casillero "sin guardado". Uso: node aplicar-guardado.js
// Tolera finales de línea CRLF, es idempotente y no escribe nada si alguna edición no encaja.
const fs = require("fs");
const EDICIONES = [
 [
  "db.js",
  "    putCache.run(tienda, q, ahora, JSON.stringify(items));",
  "    if (items.length) putCache.run(tienda, q, ahora, JSON.stringify(items)); // una búsqueda vacía no se guarda: se reintenta"
 ],
 [
  "db.js",
  "const firmaConfig = JSON.stringify([\n",
  "const firmaConfig = JSON.stringify([\n  [\"cacheV\", 2], // subir este número descarta todo lo guardado (2: ya no se guardan búsquedas vacías)\n"
 ],
 [
  "public/index.html",
  "      <button>Buscar</button>\n    </form>",
  "      <button>Buscar</button>\n      <label class=\"nota\" style=\"white-space:nowrap\"><input type=\"checkbox\" id=\"fresco\"> sin guardado</label>\n    </form>"
 ],
 [
  "public/index.html",
  "const r = await fetch(`/api/buscar?q=${encodeURIComponent(q)}&tiendas=${t}`);",
  "const r = await fetch(`/api/buscar?q=${encodeURIComponent(q)}&tiendas=${t}${$(\"fresco\").checked ? \"&fresh=1\" : \"\"}`);"
 ],
 [
  "test/run.js",
  "    fs.rmSync(dirC, { recursive: true, force: true });",
  "    assert.equal(prueba({}, `d.guardar(\"vea\",\"vacio\",[]);` + `console.log(d.leerCache(\"vea\",\"vacio\",36e5)?\"hit\":\"miss\")`), \"miss\", \"una búsqueda vacía no se guarda en caché\");\n    fs.rmSync(dirC, { recursive: true, force: true });"
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
  if (n !== 1) { console.error(`NO ENCAJA en ${f} (apariciones: ${n}). No se modificó nada. Primero aplicá aplicar-vea.js, aplicar-cache.js y aplicar-stock.js (y el parche de Disco).\n--- buscaba ---\n${vieja.slice(0, 160)}`); process.exit(1); }
  o.s = o.s.replace(vieja, () => nueva);
  console.log("editado:", f);
}
for (const [f, o] of porArchivo) fs.writeFileSync(f, o.crlf ? o.s.replace(/\n/g, "\r\n") : o.s);
console.log("Listo. Corré npm test.");