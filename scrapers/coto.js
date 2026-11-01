// Scraper de Coto Digital vía Constructor.io (el buscador que usa su sitio).
const crypto = require("crypto");
const { parsePromo } = require("../lib/promos");
const { parseCantidad } = require("../lib/unidades");

const KEY = process.env.COTO_KEY || "key_r6xzz4IAoTWcipni"; // clave pública del frontend
const BASE = process.env.COTO_URL || "https://ac.cnstrc.com";
const STORE = String(process.env.COTO_STORE || "200"); // sucursal para precios y stock
const WEB = "https://www.cotodigital.com.ar/sitios/cdigi/productos/";
const CLIENT_ID = crypto.randomUUID();
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept: "application/json",
  Origin: "https://www.cotodigital.com.ar",
  Referer: "https://www.cotodigital.com.ar/",
};

// "$3360.50" -> 3360.5 ; "$1.234,50" -> 1234.5
function parsePrecio(txt) {
  if (txt == null) return null;
  let s = String(txt).replace(/[^\d.,]/g, "");
  if (!s) return null;
  if (s.includes(",") && s.includes(".")) s = s.replace(/\./g, "").replace(",", ".");
  else if (s.includes(",")) s = s.replace(",", ".");
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

const pct = (final, regular) =>
  regular > 0 && final > 0 && final < regular ? Math.round((1 - final / regular) * 1000) / 10 : 0;

function normalizar(r) {
  const d = r.data ?? {};
  const entrada = (d.price ?? []).find((p) => String(p.store) === STORE);
  if (!entrada) return null; // no se vende en la sucursal elegida
  const lista = entrada.listPrice ?? d.product_list_price ?? 0;
  if (!(lista > 0)) return null;

  const nombre = d.sku_display_name || r.value || "";
  // Solo disponible si la sucursal figura en la lista de stock (lista vacía = sin stock en ninguna)
  const enSucursal = Array.isArray(d.store_availability) && d.store_availability.map(String).includes(STORE);

  // Cantidad: Coto da el precio por kg/litro (formatPrice) => cantidad = lista / formatPrice
  let cantidad = null, unidad = null;
  const fmt = String(d.product_format || "").toLowerCase();
  if (entrada.formatPrice > 0 && (fmt === "kilo" || fmt === "litro")) {
    cantidad = Math.round((lista / entrada.formatPrice) * 1000) / 1000;
    unidad = fmt === "kilo" ? "kg" : "l";
  } else {
    ({ cantidad, unidad } = parseCantidad(nombre));
  }

  const promos = [];
  // Promos de producto (2da al 70%, 25% off, etc.)
  for (const x of d.discounts ?? []) {
    const texto = [x.discountText, x.takingText, x.comments].filter(Boolean).join(" · ");
    const base = parsePromo(texto);
    const minU = parseInt(String(x.takingText || "").match(/\d+/)?.[0] ?? "", 10) || base.minUnidades || 1;
    const precioUnidad = parsePrecio(x.discountPrice);
    const efectivo = precioUnidad ? pct(precioUnidad, lista) : base.pctEfectivo;
    if (!(efectivo > 0)) continue;
    promos.push({ ...base, texto, tipo: x.discountText?.trim() || base.tipo, minUnidades: minU,
      pctEfectivo: efectivo, requierePago: false });
  }
  // Promos que dependen del medio de pago (solo si mejoran lo anterior)
  for (const x of d.discounts_payment_methods ?? []) {
    const precio = parsePrecio(x.precioCuota);
    const efectivo = precio ? pct(precio, lista) : 0;
    if (!(efectivo > 0)) continue;
    if (promos.some((p) => Math.abs(p.pctEfectivo - efectivo) < 0.5)) continue; // es la misma promo
    const cuotas = x.cantidadCuotas ? ` en ${x.cantidadCuotas} cuota/s` : "";
    promos.push({ texto: `Pagando con tarjeta${cuotas} ${x.comentarios || ""}`.trim(), tipo: "Pago con tarjeta",
      minUnidades: 1, pctEfectivo: efectivo, desde: null, hasta: null, tope: null, requierePago: true });
  }

  return {
    tienda: "coto",
    itemId: String(d.sku_plu ?? d.sku_id ?? d.id),
    sellerId: null,
    nombre,
    marca: d.product_brand ?? null,
    ean: d.product_main_ean ? String(d.product_main_ean) : null,
    link: d.url ? WEB + d.url : null,
    imagen: d.image_url || d.product_large_image_url || null,
    precio: lista,
    precioLista: lista,
    descuentoPct: 0, // el descuento se expresa en `promos`
    etiquetas: (d.sale_type ?? []).map((s) => s.trim()).filter((s) => s && !/^todas las ofertas$/i.test(s)),
    disponible: enSucursal,
    cantidad,
    unidad,
    promos,
  };
}

async function pedirPagina(q, page, porPagina) {
  const params = new URLSearchParams({
    key: KEY, i: CLIENT_ID, s: "1", num_results_per_page: String(porPagina), page: String(page),
  });
  const res = await fetch(`${BASE}/search/${encodeURIComponent(q)}?${params}`, {
    headers: HEADERS, signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  return (j.response ?? j).results ?? [];
}

async function buscar(termino, { paginas = 2, porPagina = 48 } = {}) {
  const q = termino.replace(/['"]/g, " ").trim();
  // Las páginas se piden a la vez. Si falla la primera es un error; las otras son opcionales.
  const pedidas = await Promise.allSettled(
    Array.from({ length: paginas }, (_, k) => pedirPagina(q, k + 1, porPagina))
  );
  if (pedidas[0].status === "rejected") throw pedidas[0].reason;
  const results = pedidas.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  const items = results.map(normalizar).filter(Boolean).filter((i) => i.disponible);
  return [...new Map(items.map((i) => [i.itemId, i])).values()]; // sin duplicados entre páginas
}

module.exports = { buscar, normalizar, parsePrecio, STORE };

// Uso directo: node scrapers/coto.js yogurt
if (require.main === module) {
  buscar(process.argv[2] || "yogurt").then((items) => {
    console.log(`Sucursal ${STORE}: ${items.length} productos\n`);
    for (const i of items.slice(0, 15)) {
      const p = i.promos.map((x) => `${x.tipo}${x.minUnidades > 1 ? " llevando " + x.minUnidades : ""} (-${x.pctEfectivo}%)${x.requierePago ? " [TARJETA]" : ""}`).join("; ");
      console.log(`$${i.precio} ${i.nombre}${i.cantidad ? ` [${i.cantidad}${i.unidad}]` : ""}${p ? " | " + p : ""}`);
    }
  }).catch((e) => console.error("Error:", e.message));
}
