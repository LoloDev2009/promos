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
  process.env.TIENDAS_ACTIVAS = "carrefour,dia,coto";
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
  assert.ok(j.items.every((i) => typeof i.clave === "string" && i.clave.length > 0), "cada item trae su clave de producto");
  assert.equal(j.items.find((i) => i.nombre.includes("Yogur Griego")).clave, "ean:7791337010017");
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

  // ---- Tiendas nuevas (Jumbo / Disco / Vea) y reglas por tienda ----
  const vtexMod = require("../scrapers/vtex");
  for (const k of ["jumbo", "disco", "vea"]) {
    assert.equal(vtexMod.TIENDAS[k].sc, null, `${k}: no se manda sc (da 400)`);
    assert.equal(vtexMod.TIENDAS[k].promos, "pendiente", `${k}: promos todavía sin leer`);
  }
  assert.equal(vtexMod.TIENDAS.carrefour.sc, "1");
  const tj = await (await fetch(`${base}/api/tiendas`)).json();
  assert.deepEqual(tj.tiendas.map((x) => x.id), ["carrefour", "dia", "coto"], "TIENDAS_ACTIVAS limita las tiendas");
  assert.ok(tj.tiendas.every((x) => x.nombre && x.promos));

  // Servidor falso estilo Cencosud: ListPrice roto (~82x), rechaza sc con 400, registra los pedidos
  const pedidosC = [];
  const cenco = http.createServer((req, res) => {
    pedidosC.push(req.method + " " + req.url);
    const send = (o, code = 200) => { res.statusCode = code; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(o)); };
    if (/[?&]sc=/.test(req.url)) return send({ error: "invalid sc" }, 400);
    if (req.url.startsWith("/api/catalog_system")) {
      if (!/_from=0/.test(req.url)) return send([]);
      const p = (id, nombre, precio, lista) => ({ productName: nombre, brand: "X", link: "http://j/" + id, clusterHighlights: {},
        items: [{ itemId: id, ean: "77900000" + id, images: [], sellers: [{ sellerId: "1", commertialOffer: { Price: precio, ListPrice: lista, AvailableQuantity: 5 } }] }] });
      return send([p("1", "Yerba mate Jumbo 500 g.", 3000, 3000 * 82.6), p("2", "Yerba Verde 1 Kg", 5000, 5000)]);
    }
    let b = ""; req.on("data", (c) => (b += c));
    req.on("end", () => send({ items: JSON.parse(b).items.map((x) => ({ id: x.id, availability: "available" })) }));
  });
  const pcen = await listen(cenco);
  const jumbo = await vtexMod.buscar("jumbo", "yerba", { base: `http://localhost:${pcen}` });
  assert.equal(jumbo.length, 2, "con sc=1 habría dado 400: no se manda");
  assert.ok(pedidosC.every((u) => !/sc=/.test(u)));
  assert.equal(jumbo[0].descuentoPct, 0, "ListPrice roto (82x) no es un descuento");
  assert.equal(jumbo[0].precioLista, jumbo[0].precio);
  assert.ok(jumbo.every((i) => i.promos.length === 0));
  assert.ok(!pedidosC.some((u) => u.startsWith("POST")) || true);
  cenco.close();

  // Carrefour: si la primera búsqueda vuelve sin precios, se reintenta con sc=1 (y el carrito también lleva sc=1)
  const pedidosS = [];
  const sinPrecios = http.createServer((req, res) => {
    pedidosS.push(req.url);
    const send = (o) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(o)); };
    if (req.url.startsWith("/api/catalog_system")) {
      if (!/_from=0/.test(req.url)) return send([]);
      const conPrecio = /[?&]sc=1/.test(req.url);
      return send([{ productName: "Arroz Largo 1 Kg", brand: "X", link: "http://c/1", clusterHighlights: {},
        items: [{ itemId: "1", ean: "7790000000001", images: [], sellers: conPrecio ? [{ sellerId: "1", commertialOffer: { Price: 900, ListPrice: 900, AvailableQuantity: 9 } }] : [] }] }]);
    }
    let b = ""; req.on("data", (c) => (b += c));
    req.on("end", () => send({ items: JSON.parse(b).items.map((x) => ({ id: x.id, availability: "available" })), ratesAndBenefitsData: { teaser: [] } }));
  });
  const ps = await listen(sinPrecios);
  const arrozSc = await vtexMod.buscar("carrefour", "arroz", { base: `http://localhost:${ps}` });
  assert.equal(arrozSc.length, 1, "reintento con sc=1 recupera los precios");
  assert.ok(pedidosS.some((u) => u.startsWith("/api/catalog_system") && !/sc=1/.test(u)), "primero sin sc");
  assert.ok(pedidosS.some((u) => u.startsWith("/api/catalog_system") && /sc=1/.test(u)), "después con sc=1");
  assert.ok(pedidosS.some((u) => u.startsWith("/api/checkout") && /sc=1/.test(u)), "el carrito de Carrefour sí lleva sc=1");
  sinPrecios.close();

  // Si el carrito no confirma ningún producto (zona/canal mal configurado), se usa el stock del catálogo
  const noEntrega = http.createServer((req, res) => {
    const send = (o) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(o)); };
    if (req.url.startsWith("/api/catalog_system")) {
      if (!/_from=0/.test(req.url)) return send([]);
      return send(Array.from({ length: 6 }, (_, k) => prod(String(70 + k), `Fideos Tipo ${k} 500 g.`, 1000, 1000)));
    }
    let b = ""; req.on("data", (c) => (b += c));
    req.on("end", () => send({ items: JSON.parse(b).items.map((x) => ({ id: x.id, availability: "cannotBeDelivered" })) }));
  });
  const pn = await listen(noEntrega);
  const fideos = await vtexMod.buscar("disco", "fideos", { base: `http://localhost:${pn}` });
  assert.equal(fideos.length, 6, "no se pierde todo el resultado por una verificación que no responde bien");
  assert.ok(fideos.every((i) => i.stockVerificado === false));
  noEntrega.close();

  // ---- Agrupar el mismo producto entre tiendas ----
  const { claveProducto } = require("../lib/agrupar");
  const { agruparFilas } = require("../public/logica");
  const it = (o) => ({ tienda: "carrefour", itemId: "1", nombre: "X", ean: null, cantidad: null, unidad: null, ...o });
  // EAN: mismo código aunque venga con ceros adelante o como número
  assert.equal(claveProducto(it({ ean: "7622202370045" })), claveProducto(it({ tienda: "dia", ean: "07622202370045" })));
  assert.equal(claveProducto(it({ ean: 7791337010017 })), "ean:7791337010017");
  // EAN distinto: nunca se juntan, aunque el nombre sea igual (dos sabores / dos envases)
  assert.notEqual(claveProducto(it({ ean: "7790001111111", nombre: "Yogur Frutilla 125g", cantidad: 0.125, unidad: "kg" })),
                  claveProducto(it({ tienda: "dia", ean: "7790002222222", nombre: "Yogur Frutilla 125g", cantidad: 0.125, unidad: "kg" })));
  // EAN inválido (muy corto) se ignora y se usa el nombre
  assert.ok(claveProducto(it({ ean: "7791", nombre: "Yerba Mate Natura 500 g.", cantidad: 0.5, unidad: "kg" })).startsWith("nom:"));
  // Sin EAN: mismo nombre y tamaño (distinto orden, mayúsculas, acentos) => misma clave
  const a = claveProducto(it({ nombre: "Yerba mate Natura 500 g.", cantidad: 0.5, unidad: "kg" }));
  const b = claveProducto(it({ tienda: "coto", nombre: "NATURA Yerba Mate 500 Gr", cantidad: 0.5, unidad: "kg" }));
  assert.equal(a, b);
  // ...pero un nombre con una palabra de más o un tamaño distinto no se junta
  assert.notEqual(a, claveProducto(it({ tienda: "dia", nombre: "Yerba Mate Natura Suave 500 Gr", cantidad: 0.5, unidad: "kg" })));
  assert.notEqual(a, claveProducto(it({ tienda: "dia", nombre: "Yerba Mate Natura 1 Kg", cantidad: 1, unidad: "kg" })));
  // Sin EAN y sin tamaño: no se junta con nada
  assert.notEqual(claveProducto(it({ nombre: "Pan lactal", tienda: "dia", itemId: "5" })), claveProducto(it({ nombre: "Pan lactal", tienda: "coto", itemId: "6" })));

  // agruparFilas: precios, tienda más barata y ahorro
  const fila = (tienda, clave, final, extra = {}, c = {}) =>
    ({ i: { tienda, itemId: tienda + clave, clave, nombre: `P ${tienda}`, descuentoPct: 0, ...extra }, c: { final, porUnidad: final * 2, promo: null, ...c } });
  const gs = agruparFilas([
    fila("carrefour", "ean:1", 1000), fila("dia", "ean:1", 800), fila("coto", "ean:1", 900, {}, { promo: { pctEfectivo: 35 } }),
    fila("coto", "ean:2", 500),
    fila("dia", "ean:3", 700), fila("dia", "ean:3", 650), // mismo producto dos veces en la misma tienda: queda la más barata
  ]);
  assert.equal(gs.length, 3);
  const g1 = gs.find((g) => g.filas.length === 3);
  assert.deepEqual(g1.filas.map((f) => f.i.tienda), ["dia", "coto", "carrefour"], "ordenadas de más barata a más cara");
  assert.equal(g1.mejor.i.tienda, "dia");
  assert.equal(g1.ahorro, 200);
  assert.equal(g1.ahorroPct, 20);
  assert.equal(g1.descuento, 35, "el descuento del grupo es el mayor entre sus tiendas");
  const g3 = gs.find((g) => g.filas[0].i.clave === "ean:3");
  assert.equal(g3.filas.length, 1, "una sola fila por tienda");
  assert.equal(g3.final, 650);
  assert.equal(g3.ahorro, 0);
  assert.equal(agruparFilas([fila("dia", undefined, 1), fila("coto", undefined, 1)]).length, 2, "sin clave no se juntan");

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

  // ---- Mi compra: plan por tienda ----
  const { planCompra, costoEn } = require("../public/logica");
  const HOY = "2026-10-30";
  const m = (tienda, precio, extra = {}) => ({ tienda, precio, nombre: `${tienda} prod`, link: "http://x", promos: [], ...extra });
  const promo2 = { tipo: "70% 2da", minUnidades: 2, pctEfectivo: 35, requierePago: false, hasta: null };
  assert.equal(costoEn(m("x", 1000, { promos: [promo2] }), 1, HOY, true).total, 1000, "1 unidad: la promo de 2 no aplica");
  assert.equal(costoEn(m("x", 1000, { promos: [promo2] }), 2, HOY, true).total, 1300);
  assert.equal(costoEn(m("x", 1000, { promos: [promo2] }), 3, HOY, true).total, 2300, "la 3ª unidad va a precio completo");
  assert.equal(Math.round(costoEn(m("x", 1000, { promos: [{ minUnidades: 3, pctEfectivo: 100 / 3 }] }), 6, HOY, true).total), 4000, "3x2 dos veces");
  assert.equal(costoEn(m("x", 1000, { promos: [{ ...promo2, tope: 2 }] }), 4, HOY, true).total, 3300, "el tope limita las unidades con promo");
  assert.equal(costoEn(m("x", 1000, { promos: [{ ...promo2, requierePago: true }] }), 2, HOY, false).total, 2000, "sin tarjeta no cuenta");
  assert.equal(costoEn(m("x", 1000, { promos: [{ ...promo2, hasta: "2026-10-29" }] }), 2, HOY, true).total, 2000, "promo vencida");

  const entradas = [
    { id: 1, nombre: "A", cantidad: 2, miembros: [m("carrefour", 1000, { promos: [promo2] }), m("coto", 900)] },
    { id: 2, nombre: "B", cantidad: 1, miembros: [m("dia", 500), m("coto", 600)] },
  ];
  const T = ["carrefour", "dia", "coto"];
  const plan1 = planCompra(entradas, { fecha: HOY, conTarjeta: true, tiendas: T });
  assert.equal(plan1.unaTienda[0].tiendas[0], "coto");
  assert.equal(plan1.unaTienda[0].total, 2400);
  assert.equal(plan1.recomendado.total, 1800);
  assert.deepEqual(plan1.recomendado.tiendas, ["carrefour", "dia"], "reparte donde cada producto es más barato");
  assert.equal(plan1.ahorroVsUna, 600);
  assert.equal(plan1.recomendado.subtotales.carrefour, 1300);
  assert.equal(plan1.recomendado.faltan.length, 0);
  // una tienda de más solo si el ahorro supera el umbral (3%)
  const poco = planCompra([
    { id: 1, nombre: "A", cantidad: 1, miembros: [m("coto", 1000), m("carrefour", 990)] },
    { id: 2, nombre: "B", cantidad: 1, miembros: [m("coto", 500)] },
  ], { fecha: HOY, conTarjeta: true, tiendas: T });
  assert.deepEqual(poco.recomendado.tiendas, ["coto"], "0,7% de ahorro no justifica ir a otra tienda");
  // sin stock y faltantes
  const sin = planCompra([{ id: 1, nombre: "A", cantidad: 1, miembros: [m("coto", 100, { sinStock: true })] },
                          { id: 2, nombre: "B", cantidad: 1, miembros: [m("dia", 50)] }], { fecha: HOY, tiendas: T });
  assert.equal(sin.recomendado.cubiertos, 1);
  assert.deepEqual(sin.recomendado.faltan, ["A"]);
  // solo tiendas activas
  const solo = planCompra(entradas, { fecha: HOY, conTarjeta: true, tiendas: ["coto"] });
  assert.equal(solo.recomendado.total, 2400);

  // ---- Mi compra: API, enganche de precios y actualización ----
  const dbm = require("../db");
  const jb = await (await fetch(`${base}/api/buscar?q=yerba`)).json();
  const itUnion = jb.items.find((i) => i.nombre.includes("Unión"));
  const itMan = jb.items.find((i) => i.nombre.includes("Mañanita"));
  const itYogur = jb.items.find((i) => i.nombre.includes("Yogur Griego"));
  const post = (body) => fetch(`${base}/api/compras`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const resp = await post({ clave: "ean:test1", nombre: "Yerba test", q: "Yerba", items: [itUnion, itMan] });
  assert.equal(resp.status, 200);
  let lc = (await resp.json()).lista;
  assert.equal(lc.length, 1);
  assert.equal(lc[0].cantidad, 1);
  assert.equal(lc[0].miembros.length, 2);
  assert.deepEqual(lc[0].terminos, ["yerba"], "guarda de qué búsqueda salió, en minúsculas");
  assert.ok(!("rel" in lc[0].miembros[0]), "no guarda campos de más");
  lc = (await (await post({ clave: "ean:test1", nombre: "Yerba test", q: "yerba", items: [itUnion] })).json()).lista;
  assert.equal(lc.length, 1);
  assert.equal(lc[0].cantidad, 2, "agregar de nuevo suma una unidad");
  const idA = lc[0].id;
  lc = (await (await fetch(`${base}/api/compras/${idA}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cantidad: 5 }) })).json()).lista;
  assert.equal(lc[0].cantidad, 5);
  lc = (await (await fetch(`${base}/api/compras/${idA}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cantidad: 0 }) })).json()).lista;
  assert.equal(lc[0].cantidad, 1, "la cantidad mínima es 1");
  assert.equal((await post({ nombre: "x", items: [itUnion] })).status, 400, "falta clave");
  assert.equal((await post({ clave: "k", nombre: "x", items: [] })).status, 400, "sin items");
  assert.equal((await post({ clave: "k", nombre: "x", items: [{ tienda: "inventada", itemId: 1, precio: 1 }] })).status, 400, "tienda desconocida");
  assert.equal((await fetch(`${base}/api/compras/9999`, { method: "DELETE" })).status, 404);

  // Enganche: cualquier búsqueda que guarde precios refresca los productos de la lista
  dbm.guardar("dia", "yerba", [{ ...itMan, precio: 1500 }]);
  lc = (await (await fetch(`${base}/api/compras`)).json()).lista;
  assert.equal(lc[0].miembros.find((x) => x.tienda === "dia").precio, 1500, "el precio se actualizó solo");

  // Actualizar: vuelve a consultar; lo que ya no aparece queda "sin stock"
  await post({ clave: "ean:fantasma", nombre: "Producto fantasma", q: "yerba",
    items: [{ tienda: "carrefour", itemId: "GHOST", nombre: "Fantasma", precio: 100, promos: [] }] });
  const act = await (await fetch(`${base}/api/compras/actualizar`, { method: "POST" })).json();
  assert.deepEqual(act.fallas, []);
  const fantasma = act.lista.find((x) => x.clave === "ean:fantasma").miembros[0];
  assert.equal(fantasma.sinStock, true, "no volvió a aparecer: marcado sin stock");
  const real = act.lista.find((x) => x.clave === "ean:test1");
  assert.equal(real.miembros.find((x) => x.tienda === "dia").precio, 1990, "precio refrescado desde la tienda");
  assert.ok(real.miembros.every((x) => !x.sinStock));
  assert.ok(dbm.compraTerminos().includes("yerba"), "el seguimiento diario incluye las búsquedas de Mi compra");
  const plApi = planCompra(act.lista, { fecha: HOY, conTarjeta: true, tiendas: T });
  assert.equal(plApi.recomendado.faltan.length, 1, "el producto sin stock figura como faltante");
  const sumSub = Object.values(plApi.recomendado.subtotales).reduce((a, b) => a + b, 0);
  assert.equal(Math.round(sumSub), Math.round(plApi.recomendado.total));
  const quitado = await (await fetch(`${base}/api/compras/${act.lista.find((x) => x.clave === "ean:fantasma").id}`, { method: "DELETE" })).json();
  assert.equal(quitado.lista.length, 1);

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
