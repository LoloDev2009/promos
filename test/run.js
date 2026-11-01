// Test de punta a punta contra tiendas VTEX simuladas (no toca internet).
const http = require("http");
const os = require("os");
const fs = require("fs");
const path = require("path");
const assert = require("assert");

function fakeVtex(productos, teasers, sinStock = []) {
  return http.createServer((req, res) => {
    const send = (o) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(o)); };
    if (req.url.startsWith("/api/catalog_system/pub/products/search")) return send(/_from=0/.test(req.url) ? productos : []);
    if (req.url.startsWith("/api/checkout/pub/orderForms/simulation")) {
      let b = ""; req.on("data", (c) => (b += c));
      req.on("end", () => {
        const pedidos = JSON.parse(b).items;
        const id = pedidos[0].id;
        send({
          items: pedidos.map((x) => ({ id: x.id, availability: sinStock.includes(x.id) ? "withoutStock" : "available" })),
          ratesAndBenefitsData: { teaser: (teasers[id] || []).map((name) => ({ name })) },
        });
      });
      return;
    }
    res.statusCode = 404; res.end();
  });
}
const prod = (id, nombre, precio, lista, extra = {}) => ({
  productName: nombre, brand: "X", link: "http://x/" + id, clusterHighlights: extra.cluster || {},
  items: [{ itemId: id, ean: "779" + id, images: [{ imageUrl: "http://img/" + id }],
    sellers: [{ sellerId: "1", commertialOffer: { Price: precio, ListPrice: lista, AvailableQuantity: extra.stock ?? 10 } }] }],
});
// Producto real de Coto (forma observada) para probar el parser
const cotoProd = (over = {}) => ({
  value: "Yogur Griego natural sin endulzar Yogurísimo 300g", matched_terms: ["yogur"],
  data: {
    id: "prod00612391", url: "_/R-00612391-00612391-200", sku_id: "sku00612391", sku_plu: 612391,
    price: [
      { id: "pl075_1", store: "075", listPrice: 5170, formatPrice: 17233.33, priceWithoutTax: 4272.73 },
      { id: "pl200_1", store: "200", listPrice: 5170, formatPrice: 17233.33, priceWithoutTax: 4272.73 },
    ],
    discounts: [{ id: "1", comments: "No acumulable con otras promos", takingText: "Llevando 2",
      discountText: "70% 2da", discountPrice: "$3360.50", regularPriceText: "Precio Contado: $5170" }],
    image_url: "http://img/coto1", sale_type: ["2da Unid 70% DTO!! ", "Todas las Ofertas"],
    product_brand: "YOGURISIMO", product_format: "Kilo", product_main_ean: 7791337010017,
    store_availability: ["056", "200"],
    discounts_payment_methods: [{ id: "9", comentarios: "", precioCuota: "$3360.5", cantidadCuotas: "1" }],
    ...over,
  },
});
const fakeConstructor = (results) => http.createServer((req, res) => {
  res.setHeader("Content-Type", "application/json");
  const primera = /[?&]page=1(&|$)/.test(req.url);
  res.end(JSON.stringify({ response: { results: primera ? results : [], total_num_results: results.length } }));
});
const listen = (s) => new Promise((r) => s.listen(0, () => r(s.address().port)));

(async () => {
  const manana = new Date(Date.now() + 86400000), hoyD = new Date();
  const textoVence = `3x2 en lácteos ${hoyD.getDate()}.${hoyD.getMonth() + 1} al ${manana.getDate()}.${manana.getMonth() + 1}`;
  const carre = fakeVtex(
    [prod("1", "Yerba mate Unión 500 g.", 3200, 3200), prod("2", "Yerba Natura 500 g.", 1829, 1829),
     prod("3", "Yerba sin stock 500 g.", 1000, 1000, { stock: 0 }),
     prod("6", "Yerba fantasma 500 g.", 1500, 1500, { stock: 9999 })],
    { 1: ["2do al 70% Tarjeta Carrefour o Cuenta digital Max 8 Combinable 23 al 29.10 UNION"], 2: [textoVence] }, ["6"]);
  const dia = fakeVtex(
    [prod("9", "Yerba Mañanita 500 Gr.", 1990, 3100, { cluster: { 0: "Ahorrames" } }), prod("8", "Yerba Rosamonte 1 Kg", 4490, 4490),
     prod("7", "Yerba Día agotada 500 Gr.", 1200, 1200, { stock: 100 })], {}, ["7"]);
  const cotoSrv = fakeConstructor([
    cotoProd(),
    cotoProd({ id: "p2", sku_plu: 2, sku_display_name: "Leche 1 L", product_format: "Litro", discounts: [],
      price: [{ store: "200", listPrice: 2675, formatPrice: 2675 }], discounts_payment_methods: [
        { precioCuota: "$2000", cantidadCuotas: "3", comentarios: "con Banco X" }], sale_type: [] }),
    cotoProd({ sku_plu: 3, price: [{ store: "999", listPrice: 100 }] }), // otra sucursal: se descarta
    cotoProd({ sku_plu: 4, store_availability: ["056"] }), // sin stock en sucursal 200: se descarta
    cotoProd({ sku_plu: 5, store_availability: [] }), // lista vacía: sin stock en ninguna sucursal
  ]);
  const pc = await listen(carre), pd = await listen(dia), pk = await listen(cotoSrv);

  process.env.CARREFOUR_URL = `http://localhost:${pc}`;
  process.env.DIA_URL = `http://localhost:${pd}`;
  process.env.COTO_URL = `http://localhost:${pk}`;
  process.env.COTO_STORE = "200";
  process.env.BENEFICIOS_FILE = path.join(os.tmpdir(), `bn-${Date.now()}.json`);
  fs.writeFileSync(process.env.BENEFICIOS_FILE, JSON.stringify({ misMedios: [], beneficios: [
    { tienda: "dia", medio: "Cuenta DNI", dias: ["lunes"], pct: 20, hasta: "2026-10-31" },
    { tienda: "coto", medio: "Mercado Pago", dias: ["viernes"], pct: 25, hasta: null },
    { tienda: "carrefour", medio: "Banco X", dias: ["viernes"], pct: 30, hasta: null },
    { tienda: "carrefour", medio: "Banco X", dias: "todos", pct: 5, adicional: true },
    { tienda: "coto", medio: "Cuenta DNI", dias: null, pct: 30 },
  ] }));
  process.env.WATCHLIST_FILE = path.join(os.tmpdir(), `wl-${Date.now()}.json`);
  fs.writeFileSync(process.env.WATCHLIST_FILE, JSON.stringify({ terminos: ["Yerba", "arroz"] }));
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "promos-"));
  const app = require("../server");
  const srv = app.listen(0);
  const base = `http://localhost:${srv.address().port}`;

  let j = await (await fetch(`${base}/api/buscar?q=yerba`)).json();
  assert.equal(j.tiendas.carrefour.ok, true);
  assert.equal(j.tiendas.dia.ok, true);
  assert.equal(j.tiendas.coto.ok, true);
  assert.ok(j.items.every((i) => i.rel && typeof i.rel.pos === "number"), "cada item trae su relevancia");
  assert.equal(j.items.filter((i) => i.tienda !== "coto").length, 4, "sin stock debe filtrarse");
  assert.ok(!j.items.some((i) => /fantasma|agotada/.test(i.nombre)), "stock de catálogo falso: el carrito dice sin stock");
  const union = j.items.find((i) => i.nombre.includes("Unión"));
  assert.equal(union.promos[0].tipo, "2º al 70%");
  assert.equal(union.promos[0].pctEfectivo, 35);
  assert.equal(union.promos[0].requierePago, true);
  assert.equal(union.unidad, "kg");
  const man = j.items.find((i) => i.nombre.includes("Mañanita"));
  assert.equal(man.descuentoPct, 36);
  assert.deepEqual(man.etiquetas, ["Ahorrames"]);
  assert.equal(j.items.find((i) => i.nombre.includes("Rosamonte")).cantidad, 1);

  // Coto: parser con la forma real
  const cotoItems = j.items.filter((i) => i.tienda === "coto");
  assert.equal(cotoItems.length, 2, "descarta otra sucursal y sin stock en la sucursal");
  const yogur = cotoItems.find((i) => i.nombre.includes("Yogur"));
  assert.equal(yogur.precio, 5170);
  assert.equal(yogur.ean, "7791337010017");
  assert.equal(yogur.link, "https://www.cotodigital.com.ar/sitios/cdigi/productos/_/R-00612391-00612391-200");
  assert.equal(yogur.cantidad, 0.3);
  assert.equal(yogur.unidad, "kg");
  assert.equal(yogur.promos.length, 1, "la promo de pago con igual precio no se duplica");
  assert.equal(yogur.promos[0].tipo, "70% 2da");
  assert.equal(yogur.promos[0].minUnidades, 2);
  assert.equal(yogur.promos[0].pctEfectivo, 35);
  assert.equal(yogur.promos[0].requierePago, false);
  assert.deepEqual(yogur.etiquetas, ["2da Unid 70% DTO!!"]);
  const leche = cotoItems.find((i) => i.nombre.includes("Leche"));
  assert.equal(leche.unidad, "l");
  assert.equal(leche.promos[0].requierePago, true);
  assert.equal(leche.promos[0].pctEfectivo, 25.2);

  // segunda búsqueda: debe venir de la caché
  j = await (await fetch(`${base}/api/buscar?q=yerba`)).json();
  assert.equal(j.tiendas.carrefour.cache, true);

  // ---- Seguimiento + señales de historial ----
  const { db } = require("../db");
  const { rastrear } = require("../lib/track");
  const { senales } = require("../lib/historial");

  // unitario puro
  const haceDias = (n) => new Date(Date.now() - n * 86400000).toISOString();
  const s0 = senales([{ capturado_en: haceDias(0), precio: 100, promos_json: "[]" }], "2026-01-01");
  assert.equal(s0.diasDatos, 1);
  assert.equal(s0.esMinimo, false, "con un solo dato no hay mínimo");

  // rastrear guarda para todas las tiendas
  const resumen = await rastrear({ terminos: ["arroz"], pausaMs: 0, log: () => {} });
  assert.equal(resumen.length, 3);
  assert.ok(resumen.every((r) => r.ok), "rastrear debe andar con las 3 tiendas");

  // historial inventado de días anteriores
  const prodId = (tienda, itemId) => db.prepare("SELECT id FROM productos WHERE tienda=? AND item_id=?").get(tienda, String(itemId)).id;
  const ins = db.prepare("INSERT INTO precios (producto_id, capturado_en, precio, precio_lista, descuento_pct, promos_json) VALUES (?,?,?,?,?,?)");
  const promoYogur = JSON.stringify([{ tipo: "70% 2da", minUnidades: 2, pctEfectivo: 35, requierePago: false, hasta: null }]);
  ins.run(prodId("dia", 9), haceDias(2), 2500, 3100, 19, "[]");
  ins.run(prodId("dia", 9), haceDias(1), 2400, 3100, 22, "[]");
  ins.run(prodId("coto", 612391), haceDias(2), 5170, 5170, 0, promoYogur);
  ins.run(prodId("coto", 612391), haceDias(1), 5170, 5170, 0, promoYogur);

  const lista = await (await fetch(`${base}/api/lista`)).json();
  assert.deepEqual(lista.terminos.map((x) => x.termino), ["yerba", "arroz"]);
  const itemsYerba = lista.terminos[0].items;
  const mananita = itemsYerba.find((i) => i.nombre.includes("Mañanita"));
  assert.equal(mananita.senales.esMinimo, true, "1990 es menor que 2500 y 2400");
  assert.ok(mananita.senales.vsPromedioPct <= -15);
  assert.equal(mananita.senales.diasDatos, 3);
  const arroz = lista.terminos[1];
  const yogurArroz = arroz.items.find((i) => i.tienda === "coto" && i.nombre.includes("Yogur"));
  assert.equal(yogurArroz.senales.enPromoDesde, new Date(Date.now() - 2 * 86400000).toLocaleDateString("sv"));
  assert.equal(yogurArroz.senales.diasEnPromo, 2);
  const unionLista = itemsYerba.find((i) => i.nombre.includes("Unión"));
  assert.equal(unionLista.senales.enPromoDesde, null, "la promo de Unión pide tarjeta: no cuenta en las señales");

  // ---- Rendimiento ----
  const { pool } = require("../lib/concurrencia");
  let activos = 0, maxActivos = 0;
  const orden = [];
  await pool([1, 2, 3, 4, 5, 6, 7, 8], 3, async (n) => {
    activos++; maxActivos = Math.max(maxActivos, activos);
    await new Promise((r) => setTimeout(r, 20));
    orden.push(n); activos--; return n;
  });
  assert.equal(maxActivos, 3, "el pool respeta el límite");
  assert.equal(orden.length, 8);
  assert.deepEqual(await pool([3, 1, 2], 2, async (n) => n * 10), [30, 10, 20], "conserva el orden de resultados");

  // Tienda VTEX falsa lenta: 3 productos irrelevantes primero, después 12 relevantes con promo
  let simActivas = 0, simMax = 0;
  const relevantes = Array.from({ length: 12 }, (_, k) => prod(String(21 + k), `Yerba mate Marca${k} 500 g.`, 2000 + k, 2000 + k));
  const irrelevantes = Array.from({ length: 3 }, (_, k) => prod(String(11 + k), `Chocolate con yerba 20 g. N${k}`, 500, 500));
  const lenta = http.createServer((req, res) => {
    const send = (o) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(o)); };
    if (req.url.startsWith("/api/catalog_system")) return send([...irrelevantes, ...relevantes]); // ignora _from: repite en cada página
    let b = ""; req.on("data", (c) => (b += c));
    req.on("end", async () => {
      const pedidos = JSON.parse(b).items;
      const esPromo = pedidos.length === 1 && pedidos[0].quantity === 4;
      if (esPromo) { simActivas++; simMax = Math.max(simMax, simActivas); await new Promise((r) => setTimeout(r, 80)); simActivas--; }
      send({ items: pedidos.map((x) => ({ id: x.id, availability: "available" })),
             ratesAndBenefitsData: { teaser: esPromo ? [{ name: "2do al 50%" }] : [] } });
    });
  });
  const pl = await listen(lenta);
  const { buscar: buscarVtex } = require("../scrapers/vtex");
  const t0 = Date.now();
  const rapido = await buscarVtex("carrefour", "yerba", { base: `http://localhost:${pl}`, maxSimulaciones: 12, concurrencia: 6 });
  const ms = Date.now() - t0;
  assert.equal(rapido.length, 15, "sin duplicados aunque la segunda página repita los productos");
  assert.ok(simMax >= 2 && simMax <= 6, `consultas en paralelo con tope (máx simultáneas: ${simMax})`);
  assert.ok(ms < 700, `12 consultas de 80 ms deben tardar bastante menos que en serie (960 ms); tardó ${ms} ms`);
  const conPromo = rapido.filter((i) => i.promos.length);
  assert.equal(conPromo.length, 12);
  assert.ok(conPromo.every((i) => i.nombre.startsWith("Yerba")), "se simularon primero los productos relevantes");
  lenta.close();

  // Dos búsquedas iguales a la vez hacen una sola consulta a la tienda
  let consultasDia = 0;
  dia.on("request", (req) => { if (/products\/search.*_from=0/.test(req.url)) consultasDia++; });
  const [r1, r2] = await Promise.all([
    fetch(`${base}/api/buscar?q=lentejas&tiendas=dia`).then((r) => r.json()),
    fetch(`${base}/api/buscar?q=lentejas&tiendas=dia`).then((r) => r.json()),
  ]);
  assert.equal(r1.tiendas.dia.ok && r2.tiendas.dia.ok, true);
  assert.equal(consultasDia, 1, "no se repite la misma búsqueda en vuelo");
  assert.ok(typeof r1.tiendas.dia.ms === "number", "informa cuánto tardó cada tienda");

  // ---- Relevancia ----
  const { analizar, filtrarRelevantes } = require("../lib/relevancia");
  const rel = (q, n) => analizar(q, n);
  assert.deepEqual(rel("leche", "Leche Las Tres Niñas Vida Activa 200ml"), { coincide: true, pos: 0 });
  assert.ok(rel("leche", "Alfajor Milka Super Dulce de Leche 70 grs").pos >= 2, "ingrediente al final: no es el producto");
  assert.ok(rel("leche", "Chocolate con Leche Baton 16 Gr.").pos >= 2);
  assert.ok(rel("leche", "Flan dulce de leche Godet").pos >= 2);
  assert.equal(rel("leche", "Lechuga criolla").coincide, false, "leche no es lechuga");
  assert.deepEqual(rel("yogurt", "Yogur Griego natural 300g"), { coincide: true, pos: 0 }, "yogurt ~ yogur");
  assert.equal(rel("fideos", "Fideo Tallarín Matarazzo 500 g").pos, 0, "plural/singular");
  assert.equal(rel("papel higienico", "Papel Higiénico Elite 4 rollos").pos, 0, "acentos");
  assert.equal(rel("dulce de batata", "Dulce de Batata Dulcor 500 g").pos, 0);
  assert.equal(rel("leche descremada", "Yogur Descremado con Leche 190g").pos >= 2, true, "manda la primera palabra");
  assert.equal(rel("leche descremada", "Leche Parcialmente Descremada 1 L").coincide, true);
  assert.equal(rel("leche descremada", "Leche Entera 1 L").coincide, false, "falta una palabra");
  assert.equal(rel("leche descremada", "Leche descremado 1 L").coincide, true, "descremada~descremado");
  const mezcla = ["Leche Entera 1 L", "Leche Descremada 1 L", "Leche en polvo 800 g", "Flan Dulce de Leche", "Chocolate con Leche"]
    .map((n) => ({ nombre: n, rel: rel("leche", n) }));
  assert.equal(filtrarRelevantes(mezcla).length, 3, "deja las leches, saca flan y chocolate");
  const pocos = [{ nombre: "Leche A", rel: rel("leche", "Leche A") }, { nombre: "Flan de leche", rel: rel("leche", "Flan de leche") }];
  assert.equal(filtrarRelevantes(pocos).length, 2, "si hay muy pocos exactos no se esconde todo");

  // ---- Calendario de beneficios ----
  const B = require("../lib/beneficios");
  const datosB = B.cargar(process.env.BENEFICIOS_FILE);
  assert.equal(B.diaSemana("2026-10-30"), "viernes");
  assert.equal(B.sumarDias("2026-10-31", 1), "2026-11-01");
  const cal = B.calendario(datosB, "2026-10-29", 7); // jueves
  assert.equal(cal.dias.length, 7);
  const vie = cal.dias[1];
  assert.equal(vie.diaSemana, "viernes");
  assert.deepEqual(vie.beneficios.map((b) => b.pct), [30, 25, 5], "ordenados por %, el adicional incluido");
  assert.equal(vie.mejor.carrefour.pct, 30);
  assert.equal(vie.mejor.coto.pct, 25);
  assert.ok(!cal.dias[4].beneficios.some((b) => b.tienda === "dia"), "el lunes 2/11 el beneficio de Día ya venció");
  assert.equal(cal.recomendado.pct, 30);
  assert.equal(cal.recomendado.fecha, "2026-10-30");
  assert.equal(cal.sinDia.length, 1, "el beneficio sin día va aparte");
  assert.equal(cal.vencenPronto.length, 1);
  const calMio = B.calendario({ ...datosB, misMedios: ["mercado pago"] }, "2026-10-29", 7);
  assert.deepEqual(calMio.dias[1].beneficios.map((b) => b.tienda), ["coto"], "filtra por mis medios de pago");
  assert.equal(B.calendario({ misMedios: [], beneficios: [] }, "2026-10-29", 3).hayDatosVigentes, false);

  // endpoint: cruza beneficios con vencimientos de promos de góndola de la lista
  const apiCal = await (await fetch(`${base}/api/calendario?dias=7`)).json();
  assert.equal(apiCal.dias.length, 7);
  const diaManana = apiCal.dias[1];
  assert.deepEqual(diaManana.vencen.map((v) => [v.tienda, v.cantidad]), [["carrefour", 1]],
    "una promo de Carrefour sin tarjeta vence mañana; la que pide tarjeta no cuenta");

  // una tienda caída no rompe a la otra
  carre.close();
  j = await (await fetch(`${base}/api/buscar?q=galletitas`)).json();
  assert.equal(j.tiendas.carrefour.ok, false);
  assert.equal(j.tiendas.dia.ok, true);

  // validación
  const r = await fetch(`${base}/api/buscar?q=a`);
  assert.equal(r.status, 400);

  // historial de precios guardado
  const n = db.prepare("SELECT COUNT(*) c FROM precios").get().c;
  assert.ok(n >= 4, "debe guardar historial de precios");

  // la página se sirve
  const html = await (await fetch(`${base}/`)).text();
  assert.ok(html.includes("Promos súper"));

  console.log("OK: todos los tests pasaron (" + n + " precios guardados)");
  process.exit(0);
})().catch((e) => { console.error("FALLÓ:", e.message); process.exit(1); });
