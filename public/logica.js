// Lógica pura compartida entre la página y los tests.
(function (root) {
  // filas: [{ i: item, c: { final, porUnidad, promo } }]  ->  grupos de un mismo producto en varias tiendas
  function agruparFilas(filas) {
    const porClave = new Map();
    for (const f of filas) {
      const k = f.i.clave || `solo:${f.i.tienda}:${f.i.itemId}`;
      if (!porClave.has(k)) porClave.set(k, []);
      porClave.get(k).push(f);
    }
    return [...porClave.values()].map((miembros) => {
      // una fila por tienda: la más barata (si la tienda tiene el mismo producto dos veces)
      const porTienda = new Map();
      for (const f of miembros) {
        const prev = porTienda.get(f.i.tienda);
        if (!prev || f.c.final < prev.c.final) porTienda.set(f.i.tienda, f);
      }
      const tiendas = [...porTienda.values()].sort(
        (a, b) => a.c.final - b.c.final || (a.c.porUnidad ?? Infinity) - (b.c.porUnidad ?? Infinity)
      );
      const caro = tiendas[tiendas.length - 1].c.final, barato = tiendas[0].c.final;
      return {
        filas: tiendas,
        mejor: tiendas[0],
        ahorro: tiendas.length > 1 ? caro - barato : 0,
        ahorroPct: tiendas.length > 1 && caro > 0 ? Math.round(((caro - barato) / caro) * 100) : 0,
        porUnidad: Math.min(...tiendas.map((f) => f.c.porUnidad ?? Infinity)),
        final: barato,
        descuento: Math.max(...tiendas.map((f) => Math.max(f.i.descuentoPct || 0, f.c.promo?.pctEfectivo || 0))),
      };
    });
  }
  // Costo de comprar n unidades de un item aplicando su mejor promo (no acumulables entre sí).
  // promo.minUnidades: cuántas unidades pide; pctEfectivo: % de descuento sobre esas unidades; tope: máx. unidades con promo.
  function costoEn(item, n, fecha, conTarjeta) {
    let mejor = { total: item.precio * n, promo: null, unidadesConPromo: 0 };
    for (const p of item.promos || []) {
      if (p.hasta && p.hasta < fecha) continue;
      if (p.requierePago && !conTarjeta) continue;
      if (!(p.pctEfectivo > 0)) continue;
      const m = Math.max(1, p.minUnidades || 1);
      const elegibles = p.tope ? Math.min(n, p.tope) : n;
      const conPromo = Math.floor(elegibles / m) * m;
      const total = conPromo * item.precio * (1 - p.pctEfectivo / 100) + (n - conPromo) * item.precio;
      if (total < mejor.total - 1e-9) mejor = { total, promo: p, unidadesConPromo: conPromo };
    }
    return mejor;
  }

  const subconjuntos = (xs) => {
    const out = [];
    for (let mask = 1; mask < 1 << xs.length; mask++) out.push(xs.filter((_, i) => mask & (1 << i)));
    return out;
  };

  // entradas: [{ id, nombre, cantidad, miembros: [item con tienda, precio, promos...] }]
  function planCompra(entradas, { fecha, conTarjeta = true, tiendas, umbralPct = 3 }) {
    const filas = entradas.map((e) => {
      const porTienda = {};
      for (const t of tiendas) {
        let mejor = null;
        for (const m of e.miembros) {
          if (m.tienda !== t || m.sinStock) continue;
          const c = costoEn(m, e.cantidad, fecha, conTarjeta);
          if (!mejor || c.total < mejor.total) mejor = { ...c, item: m };
        }
        if (mejor) porTienda[t] = mejor;
      }
      return { id: e.id, nombre: e.nombre, cantidad: e.cantidad, porTienda };
    });

    const combos = subconjuntos(tiendas).map((sub) => {
      let total = 0, cubiertos = 0;
      const compras = {}, faltan = [];
      for (const f of filas) {
        let mejor = null, enTienda = null;
        for (const t of sub) {
          const c = f.porTienda[t];
          if (c && (!mejor || c.total < mejor.total)) { mejor = c; enTienda = t; }
        }
        if (mejor) {
          total += mejor.total; cubiertos++;
          (compras[enTienda] ||= []).push({ entradaId: f.id, nombre: f.nombre, cantidad: f.cantidad, ...mejor });
        } else faltan.push(f.nombre);
      }
      const subtotales = {};
      for (const [t, lineas] of Object.entries(compras)) subtotales[t] = lineas.reduce((a, l) => a + l.total, 0);
      return { tiendas: sub, total, cubiertos, faltan, compras, subtotales };
    });

    const mejorQue = (a, b) => a.cubiertos > b.cubiertos || (a.cubiertos === b.cubiertos && a.total < b.total - 0.5);
    const porTamano = {};
    for (const c of combos) {
      const k = c.tiendas.length;
      if (!porTamano[k] || mejorQue(c, porTamano[k])) porTamano[k] = c;
    }
    const alternativas = Object.keys(porTamano).map(Number).sort((a, b) => a - b).map((k) => porTamano[k]);
    const unaTienda = combos.filter((c) => c.tiendas.length === 1).sort((a, b) => b.cubiertos - a.cubiertos || a.total - b.total);

    // Recomendado: máxima cobertura y mínimo total, pero sin pedirte ir a otra tienda por un ahorro menor al umbral
    let recomendado = null;
    if (alternativas.length) {
      const maxCub = Math.max(...alternativas.map((c) => c.cubiertos));
      const cands = alternativas.filter((c) => c.cubiertos === maxCub);
      const minTotal = Math.min(...cands.map((c) => c.total));
      recomendado = cands.find((c) => c.total <= minTotal * (1 + umbralPct / 100) + 1e-9) || cands[0];
    }
    const mejorUna = unaTienda[0] || null;
    const ahorroVsUna = recomendado && mejorUna && recomendado.cubiertos === mejorUna.cubiertos
      ? Math.max(0, mejorUna.total - recomendado.total) : 0;
    return { filas, alternativas, unaTienda, recomendado, mejorUna, ahorroVsUna };
  }

  const api = { agruparFilas, costoEn, planCompra };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Logica = api;
})(typeof window !== "undefined" ? window : globalThis);
