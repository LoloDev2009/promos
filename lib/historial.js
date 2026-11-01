// Señales a partir del historial de precios de un producto.
const { mejorPromo } = require("./precios");

const aFecha = (iso) => new Date(iso).toLocaleDateString("sv");
const diffDias = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

// rows: [{capturado_en, precio, promos_json}] ordenadas de más vieja a más nueva
function senales(rows, hoy) {
  const porDia = new Map(); // una observación por día (la última)
  for (const r of rows) {
    let promos = [];
    try { promos = JSON.parse(r.promos_json || "[]"); } catch { /* sin promos */ }
    porDia.set(aFecha(r.capturado_en), { precio: r.precio, promos });
  }
  const dias = [...porDia.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([fecha, d]) => {
    const p = mejorPromo(d.promos, fecha, false); // sin contar promos que piden tarjeta
    const pct = p?.pctEfectivo || 0;
    return { fecha, final: d.precio * (1 - pct / 100), enPromo: pct > 0 };
  });
  if (!dias.length) return null;

  const ult = dias[dias.length - 1];
  let desde = null;
  for (let i = dias.length - 1; i >= 0 && dias[i].enPromo; i--) desde = dias[i].fecha;

  const previos = dias.slice(0, -1).map((d) => d.final);
  let esMinimo = false, vsPromedioPct = null;
  if (previos.length >= 2) {
    const min = Math.min(...previos), max = Math.max(...previos);
    esMinimo = ult.final <= min && min < max;
    const prom = previos.reduce((a, b) => a + b, 0) / previos.length;
    vsPromedioPct = Math.round((ult.final / prom - 1) * 100);
  }
  return {
    diasDatos: dias.length,
    primerDato: dias[0].fecha,
    enPromoDesde: ult.enPromo ? desde : null,
    diasEnPromo: ult.enPromo && desde ? diffDias(desde, hoy) : 0,
    esMinimo,
    vsPromedioPct,
  };
}

module.exports = { senales };
