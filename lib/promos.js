// Interpreta el texto de una promo: tipo, vigencia, tope, condición de pago y % efectivo.
function iso(y, m, d) {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function parsePromo(texto, hoy = new Date()) {
  const t = texto || "";
  const anio = hoy.getFullYear();
  let tipo = null, minUnidades = 1, pctEfectivo = 0, m;

  if ((m = t.match(/(\d)\s*x\s*(\d)/i)) && +m[1] > +m[2]) {
    tipo = `${m[1]}x${m[2]}`;
    minUnidades = +m[1];
    pctEfectivo = ((+m[1] - +m[2]) / +m[1]) * 100;
  } else if ((m = t.match(/(\d+)\s*(?:do|da|er|º|°)?\s*al\s*(\d+)\s*%/i))) {
    tipo = `${m[1]}º al ${m[2]}%`;
    minUnidades = +m[1];
    pctEfectivo = +m[2] / +m[1]; // "2º al 70%" comprando 2 => 35% sobre el total
  } else if ((m = t.match(/(\d+)\s*%[^.]*segunda unidad/i))) {
    tipo = `2º al ${m[1]}%`;
    minUnidades = 2;
    pctEfectivo = +m[1] / 2;
  } else if ((m = t.match(/(\d+)\s*%/))) {
    tipo = `${m[1]}% off`;
    pctEfectivo = +m[1];
  }

  // vigencia "23 al 29.10" o "29.10 al 03.11"
  let desde = null, hasta = null;
  const v = t.match(/(\d{1,2})(?:\.(\d{1,2}))?\s*al\s*(\d{1,2})\.(\d{1,2})/);
  if (v) {
    const mesHasta = +v[4];
    const mesDesde = v[2] ? +v[2] : mesHasta;
    desde = iso(anio, mesDesde, +v[1]);
    hasta = iso(mesHasta < mesDesde ? anio + 1 : anio, mesHasta, +v[3]);
  }

  const tope = (t.match(/m[aá]x\.?\s*(\d+)/i) || [])[1];
  const requierePago = /tarjeta|cuenta digital|banco|mercado pago|modo\b|billetera/i.test(t);
  return {
    texto: t, tipo, minUnidades,
    pctEfectivo: Math.round(pctEfectivo * 10) / 10,
    desde, hasta, tope: tope ? +tope : null, requierePago,
  };
}

module.exports = { parsePromo };
