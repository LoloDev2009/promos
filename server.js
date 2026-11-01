const express = require("express");
const path = require("path");
const { buscar, TIENDAS } = require("./scrapers");
const fs = require("fs");
const { guardar, leerCache, historial } = require("./db");
const { calcular, hoyLocal } = require("./lib/precios");
const { senales } = require("./lib/historial");
const beneficios = require("./lib/beneficios");
const { analizar, filtrarRelevantes } = require("./lib/relevancia");

const app = express();
const PORT = process.env.PORT || 3000;
const TTL_MS = (+process.env.CACHE_HORAS || 6) * 3600 * 1000;

app.use(express.static(path.join(__dirname, "public")));

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
  items = items.map((i) => ({ ...i, rel: analizar(q, i.nombre) }));
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
    items = filtrarRelevantes(items.map((i) => ({ ...i, rel: analizar(q, i.nombre) })));
    // candidatos: los mejores por precio por kg/litro, contando y sin contar promos con tarjeta
    const clave = (i, tarjeta) => {
      const c = calcular(i, hoy, tarjeta);
      return c.porUnidad ?? Infinity;
    };
    const top = (tarjeta) => [...items].sort((a, b) => clave(a, tarjeta) - clave(b, tarjeta)).slice(0, 15);
    const elegidos = [...new Set([...top(true), ...top(false)])];
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

if (require.main === module) {
  app.listen(PORT, () => console.log(`Promos en http://localhost:${PORT}`));
}
module.exports = app;
