// Lógica de precios compartida (el frontend tiene una copia equivalente).
const hoyLocal = (d = new Date()) => d.toLocaleDateString("sv"); // YYYY-MM-DD en hora local

// Mejor promo vigente en `fecha`; las que requieren tarjeta/billetera solo cuentan si conTarjeta.
function mejorPromo(promos, fecha, conTarjeta) {
  let best = null;
  for (const p of promos || []) {
    if (p.hasta && p.hasta < fecha) continue;
    if (p.requierePago && !conTarjeta) continue;
    if (!best || p.pctEfectivo > best.pctEfectivo) best = p;
  }
  return best;
}

function calcular(item, fecha, conTarjeta) {
  const promo = mejorPromo(item.promos, fecha, conTarjeta);
  const final = item.precio * (1 - (promo?.pctEfectivo || 0) / 100);
  return { promo, final, porUnidad: item.cantidad ? final / item.cantidad : null };
}

module.exports = { hoyLocal, mejorPromo, calcular };
