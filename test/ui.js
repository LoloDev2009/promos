// Ejecuta el script de la página con un DOM simulado: tarjetas agrupadas, botón "+" y plan de Mi compra.
const fs = require("fs");
const assert = require("assert");

const html = fs.readFileSync(require.resolve("../public/index.html"), "utf8");
const script = html.match(/<script>([\s\S]*)<\/script>/)[1];
const Logica = require("../public/logica.js");

const els = {};
const el = (id) => (els[id] ??= { id, checked: true, value: "unidad", innerHTML: "", textContent: "", disabled: false,
  classList: { toggle() {}, add() {}, remove() {} }, addEventListener() {} });
const document = { getElementById: el, addEventListener: (t, fn) => { if (t === "click") document.__click = fn; } };

const llamadas = [];
const iso = new Date().toISOString();
const fetchStub = async (url, opts = {}) => {
  llamadas.push({ url, opts });
  if (opts.method === "POST" && url === "/api/compras") {
    const b = JSON.parse(opts.body);
    return { ok: true, json: async () => ({ id: 1, lista: [{ id: 1, clave: b.clave, nombre: b.nombre, cantidad: 2, terminos: [b.q],
      miembros: b.items.map((i) => ({ ...i, actualizadoEn: iso })) }] }) };
  }
  return { ok: true, json: async () => ({ lista: [] }) };
};

const item = (o) => ({ itemId: "1", descuentoPct: 0, precioLista: o.precio, etiquetas: [], promos: [], cantidad: 0.3, unidad: "kg",
  link: "http://x/" + o.tienda, imagen: null, rel: { coincide: true, pos: 0 }, ...o });

const extra = `
datos = [
  item({ tienda: "carrefour", itemId: "10", clave: "ean:7791337010017", nombre: "Yogur Griego 300g", precio: 5400, marca: "Y", ean: "7791337010017" }),
  item({ tienda: "coto", itemId: "20", clave: "ean:7791337010017", nombre: "Yogur Griego natural Yogurísimo 300g", precio: 5170,
         promos: [{ tipo: "70% 2da", minUnidades: 2, pctEfectivo: 35, requierePago: false, hasta: null }] }),
  item({ tienda: "dia", itemId: "30", clave: "ean:999", nombre: "Yogur solo en Día 125g", precio: 1000, cantidad: 0.125 }),
];
ultimoQ = "yogur"; pendientes = 0;
renderBuscar();
const buscarHtml = document.getElementById("resultados").innerHTML;
const gid = +buscarHtml.match(/class="wrap grupo">[\\s\\S]*?data-gid="(\\d+)"/)[1];
document.__click({ target: { closest: (s) => (s === ".btn-add" ? { dataset: { gid: String(gid) } } : null) } });
await new Promise((r) => setTimeout(r, 20));
renderCompra();
return { buscarHtml, planHtml: document.getElementById("compraPlan").innerHTML, listaHtml: document.getElementById("compraLista").innerHTML,
         cuenta: document.getElementById("cuenta").textContent };
`;

(async () => {
  const out = await new Function("Logica", "document", "fetch", "item", "return (async () => {" + script + extra + "})()")(Logica, document, fetchStub, item);

  // Tarjetas
  assert.ok(/class="wrap grupo"/.test(out.buscarHtml), "el producto en 2 tiendas va en tarjeta agrupada");
  assert.ok(out.buscarHtml.includes("más barato"));
  assert.equal((out.buscarHtml.match(/class="btn-add"/g) || []).length, 2, "un botón + por tarjeta (1 grupo + 1 individual)");

  // El "+" envía el grupo completo
  const post = llamadas.find((c) => c.opts.method === "POST" && c.url === "/api/compras");
  assert.ok(post, "se envió la compra");
  const body = JSON.parse(post.opts.body);
  assert.equal(body.clave, "ean:7791337010017");
  assert.equal(body.q, "yogur");
  assert.deepEqual(body.items.map((i) => i.tienda).sort(), ["carrefour", "coto"]);
  assert.ok(body.items.every((i) => !("rel" in i)), "solo los campos necesarios");

  // Mi compra: lista y plan (cantidad 2: la promo 2º al 70% de Coto aplica)
  assert.equal(out.cuenta, "(1)");
  assert.ok(out.listaHtml.includes("Yogur Griego"));
  assert.ok(out.planHtml.includes("Mejor opción"));
  assert.ok(out.planHtml.includes("todo en coto"), "Coto con la promo por 2 unidades es lo más barato");
  assert.ok(out.planHtml.includes("$6.721") || out.planHtml.includes("$6,721") || /6\.?721/.test(out.planHtml), "2 × 5170 con 2º al 70% = 6721");
  assert.ok(out.planHtml.includes("Alternativas"));
  assert.ok(!out.planHtml.includes("$0"), "no se listan tiendas sin ningún producto de la lista");
  assert.ok(!/Mejor con \d tiendas/.test(out.planHtml), "no se repite una combinación que no mejora nada");
  if (process.env.VER) console.log(out.planHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
  console.log("OK: la página dibuja tarjetas agrupadas, agrega con + y arma el plan de compra");
})().catch((e) => { console.error("FALLÓ UI:", e.message); process.exit(1); });
