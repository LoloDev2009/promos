const express = require("express");
const path = require("path");
const { buscar, TIENDAS } = require("./scrapers");
const fs = require("fs");
const { guardar, leerCache, historial, compraAgregar, compraListar, compraCantidad, compraQuitar, compraTerminos, compraMarcarSinStock } = require("./db");
const { calcular, hoyLocal } = require("./lib/precios");
const { senales } = require("./lib/historial");
const beneficios = require("./lib/beneficios");
const { analizar, filtrarRelevantes } = require("./lib/relevancia");
const { claveProducto } = require("./lib/agrupar");

const app = express();
const PORT = process.env.PORT || 3000;
const TTL_MS = (+process.env.CACHE_HORAS || 6) * 3600 * 1000;

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json({ limit: "512kb" }));

app.get("/api/tiendas", (req, res) =>
  res.json({ tiendas: Object.entries(TIENDAS).map(([id, c]) => ({ id, nombre: c.nombre || id, promos: c.promos || "completas", etiquetas: !!c.etiquetas })) }));

// Evita repetir la misma búsqueda si llegan dos pedidos iguales a la vez (doble clic, dos pestañas)
const enVuelo = new Map();
function rastrearTienda(tienda, q) {
  const k = `${tienda}:${q}`;
  if (!enVuelo.has(k)) {
    const p = (async () => {
      const items = await buscar(tienda, q);
      guardar(tienda, q, items);
      return { items, capturadoEn: new Date().toISOString() };
    })().finally(() => enVuelo.delete(k));
    enVuelo.set(k, p);
  }
  return enVuelo.get(k);
}

app.get("/api/buscar", async (req, res) => {
  const q = String(req.query.q || "").trim().toLowerCase();
  if (q.length < 2) return res.status(400).json({ error: "Escribí al menos 2 letras" });
  const pedidas = String(req.query.tiendas || Object.keys(TIENDAS).join(","))
    .split(",").filter((t) => TIENDAS[t]);
  const fresh = req.query.fresh === "1";

  const resultados = await Promise.allSettled(
    pedidas.map(async (tienda) => {
      const t0 = Date.now();
      if (!fresh) {
        const c = leerCache(tienda, q, TTL_MS);
        if (c) return { tienda, items: c.items, capturadoEn: c.capturadoEn, cache: true, ms: Date.now() - t0 };
      }
      const r = await rastrearTienda(tienda, q);
      return { tienda, ...r, cache: false, ms: Date.now() - t0 };
    })
  );

  const tiendas = {};
  let items = [];
  resultados.forEach((r, i) => {
    const t = pedidas[i];
    if (r.status === "fulfilled") {
      tiendas[t] = { ok: true, cache: r.value.cache, capturadoEn: r.value.capturadoEn, cantidad: r.value.items.length, ms: r.value.ms };
      items = items.concat(r.value.items);
    } else {
      tiendas[t] = { ok: false, error: r.reason?.message || "error" };
    }
  });
  items = items.map((i) => ({ ...i, rel: analizar(q, i.nombre), clave: claveProducto(i) }));
  res.json({ q, tiendas, items });
});

const WATCHLIST = process.env.WATCHLIST_FILE || path.join(__dirname, "watchlist.json");
function leerWatchlist() {
  try {
    return (JSON.parse(fs.readFileSync(WATCHLIST, "utf8")).terminos || [])
      .map((t) => String(t).trim().toLowerCase()).filter(Boolean);
  } catch {
    return [];
  }
}

// "Mi lista": lo último que guardó el seguimiento diario + señales del historial
app.get("/api/lista", (req, res) => {
  const hoy = hoyLocal();
  const tiendas = Object.keys(TIENDAS);
  const terminos = leerWatchlist().map((q) => {
    let items = [], actualizado = null;
    for (const t of tiendas) {
      const c = leerCache(t, q, Infinity); // acá no importa la antigüedad: es lo último rastreado
      if (!c) continue;
      items = items.concat(c.items);
      if (!actualizado || c.capturadoEn > actualizado) actualizado = c.capturadoEn;
    }
    items = filtrarRelevantes(items.map((i) => ({ ...i, rel: analizar(q, i.nombre), clave: claveProducto(i) })));
    // candidatos: los mejores por precio por kg/litro, contando y sin contar promos con tarjeta
    const clave = (i, tarjeta) => {
      const c = calcular(i, hoy, tarjeta);
      return c.porUnidad ?? Infinity;
    };
    const top = (tarjeta) => [...items].sort((a, b) => clave(a, tarjeta) - clave(b, tarjeta)).slice(0, 15);
    let elegidos = [...new Set([...top(true), ...top(false)])];
    // si un elegido también está en otra tienda, se incluye esa versión para poder comparar precios
    const claves = new Set(elegidos.map((i) => i.clave).filter((k) => k && !k.startsWith("solo:")));
    elegidos = [...new Set([...elegidos, ...items.filter((i) => claves.has(i.clave))])];
    return {
      termino: q,
      actualizado,
      items: elegidos.map((i) => ({ ...i, senales: senales(historial(i.tienda, i.itemId), hoy) })),
    };
  });
  res.json({ hoy, terminos });
});

// "Cuándo comprar": beneficios por día/banco + promos de góndola de tu lista que vencen pronto
const BENEFICIOS = process.env.BENEFICIOS_FILE || path.join(__dirname, "beneficios.json");
app.get("/api/calendario", (req, res) => {
  const hoy = hoyLocal();
  const n = Math.min(14, Math.max(1, +req.query.dias || 7));
  const datos = beneficios.cargar(BENEFICIOS);
  const cal = beneficios.calendario(datos, hoy, n);

  // promos de góndola con fecha de vencimiento dentro de la ventana (solo Carrefour trae fechas)
  const fin = cal.dias[cal.dias.length - 1].fecha;
  const vistos = new Set();
  const venc = {}; // fecha -> tienda -> {cantidad, ejemplo}
  for (const q of leerWatchlist()) {
    for (const t of Object.keys(TIENDAS)) {
      const c = leerCache(t, q, Infinity);
      for (const it of c?.items ?? []) {
        const k = t + ":" + it.itemId;
        if (vistos.has(k)) continue;
        for (const p of it.promos || []) {
          if (!p.hasta || p.hasta < hoy || p.hasta > fin || p.requierePago) continue;
          vistos.add(k);
          const slot = ((venc[p.hasta] ??= {})[t] ??= { cantidad: 0, ejemplo: it.nombre });
          slot.cantidad++;
          break;
        }
      }
    }
  }
  for (const d of cal.dias) {
    d.vencen = Object.entries(venc[d.fecha] || {}).map(([tienda, v]) => ({ tienda, ...v }));
  }
  res.json({ hoy, misMedios: datos.misMedios, ...cal });
});

// ---------- Mi compra (lista de compras con cantidades) ----------
app.get("/api/compras", (req, res) => res.json({ lista: compraListar() }));

app.post("/api/compras", (req, res) => {
  const { clave, nombre, q, items } = req.body || {};
  if (typeof clave !== "string" || !clave || typeof nombre !== "string" || !nombre) {
    return res.status(400).json({ error: "Faltan clave y nombre" });
  }
  if (!Array.isArray(items) || !items.length || items.length > 12) {
    return res.status(400).json({ error: "items debe traer entre 1 y 12 productos" });
  }
  if (!items.every((i) => i && TIENDAS[i.tienda] && i.itemId != null && Number.isFinite(+i.precio))) {
    return res.status(400).json({ error: "Cada item necesita tienda conocida, itemId y precio" });
  }
  const id = compraAgregar({ clave, nombre: nombre.slice(0, 200), q, items });
  res.json({ id, lista: compraListar() });
});

app.patch("/api/compras/:id", (req, res) => {
  if (!compraCantidad(+req.params.id, req.body?.cantidad)) return res.status(404).json({ error: "No existe" });
  res.json({ lista: compraListar() });
});

app.delete("/api/compras/:id", (req, res) => {
  if (!compraQuitar(+req.params.id)) return res.status(404).json({ error: "No existe" });
  res.json({ lista: compraListar() });
});

// Vuelve a consultar precios y stock de todo lo que está en la lista
app.post("/api/compras/actualizar", async (req, res) => {
  const lista = compraListar();
  const tiendas = [...new Set(lista.flatMap((e) => e.miembros.map((m) => m.tienda)))].filter((t) => TIENDAS[t]);
  const terminos = compraTerminos();
  const visto = new Set(), tiendasOk = new Set(), fallas = [];
  await Promise.all(tiendas.map(async (t) => {
    let todoOk = true;
    for (const q of terminos) {
      try {
        const r = await rastrearTienda(t, q); // guardar() refresca de paso los precios de la lista
        r.items.forEach((i) => visto.add(`${t}:${i.itemId}`));
      } catch (e) {
        todoOk = false;
        fallas.push(`${t} (${q}): ${e.message}`);
      }
    }
    if (todoOk) tiendasOk.add(t); // solo se marca "sin stock" si la tienda respondió bien en todo
  }));
  compraMarcarSinStock(visto, tiendasOk);
  res.json({ lista: compraListar(), fallas });
});

if (require.main === module) {
  // Solo accesible desde esta compu. Para abrirlo a la red (celular en tu wifi): HOST=0.0.0.0 npm start
  const HOST = process.env.HOST || "127.0.0.1";
  app.listen(PORT, HOST, () => console.log(`Promos en http://localhost:${PORT}${HOST === "127.0.0.1" ? "" : `  (abierto en ${HOST})`}`));
}
module.exports = app;
