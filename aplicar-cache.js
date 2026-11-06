// Arregla la caché vieja: la firma de configuración pasa a usar los sellers efectivos. Uso: node aplicar-cache.js
// Tolera finales de línea CRLF, es idempotente y no escribe nada si alguna edición no encaja.
const fs = require("fs");
const EDICIONES = [
 [
  "db.js",
  "const firmaConfig = JSON.stringify(\n  [\"COTO_STORE\", \"COTO_KEY\", \"CP\", \"JUMBO_PROMO_SELLER\", \"DISCO_PROMO_SELLER\", \"VEA_PROMO_SELLER\"].map((k) => [k, process.env[k] || \"\"]));\n",
  "// Se firma la configuración EFECTIVA (no solo el .env): si cambia el seller por defecto o se activa una tienda\n// desde el código, la caché vieja tampoco vale.\nconst { TIENDAS: TIENDAS_CFG } = require(\"./scrapers/vtex\");\nconst firmaConfig = JSON.stringify([\n  ...[\"COTO_STORE\", \"COTO_KEY\", \"CP\"].map((k) => [k, process.env[k] || \"\"]),\n  ...[\"jumbo\", \"disco\", \"vea\"].map((t) => [t, TIENDAS_CFG[t].promos, TIENDAS_CFG[t].promoSeller || \"\", (TIENDAS_CFG[t].gruposIgnorados || []).join(\"+\")]),\n]);\n"
 ],
 [
  "test/run.js",
  "  // Carrefour: si la primera búsqueda vuelve sin precios",
  "  // Caché: se descarta cuando cambia la configuración efectiva de promos (seller de Vea)\n  {\n    const { execFileSync } = require(\"child_process\");\n    const dirC = fs.mkdtempSync(path.join(require(\"os\").tmpdir(), \"promos-cache-\"));\n    const prueba = (env, accion) => execFileSync(process.execPath, [\"--no-warnings\", \"-e\",\n      `const d=require(${JSON.stringify(path.join(__dirname, \"..\", \"db.js\"))});` + accion],\n      { env: { ...process.env, DATA_DIR: dirC, ...env }, encoding: \"utf8\" }).trim();\n    const guarda = `d.guardar(\"vea\",\"leche\",[{tienda:\"vea\",itemId:\"1\",ean:null,nombre:\"Leche\",marca:null,link:\"http://v/1\",imagen:null,precio:100,precioLista:100,descuentoPct:0,promos:[],etiquetas:[]}]);console.log(\"ok\")`;\n    const lee = `console.log(d.leerCache(\"vea\",\"leche\",36e5)?\"hit\":\"miss\")`;\n    prueba({}, guarda);\n    assert.equal(prueba({}, lee), \"hit\", \"misma configuración: la caché sirve\");\n    assert.equal(prueba({ VEA_PROMO_SELLER: \"otro-seller\" }, lee), \"miss\", \"cambió el seller de Vea: se descarta la caché\");\n    fs.rmSync(dirC, { recursive: true, force: true });\n  }\n\n  // Carrefour: si la primera búsqueda vuelve sin precios"
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
  if (n !== 1) { console.error(`NO ENCAJA en ${f} (apariciones: ${n}). No se modificó nada. Primero aplicá aplicar-vea.js (y el parche de Disco).\n--- buscaba ---\n${vieja.slice(0, 160)}`); process.exit(1); }
  o.s = o.s.replace(vieja, () => nueva);
  console.log("editado:", f);
}
for (const [f, o] of porArchivo) fs.writeFileSync(f, o.crlf ? o.s.replace(/\n/g, "\r\n") : o.s);
console.log("Listo. Corré npm test.");