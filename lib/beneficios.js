// Calendario de beneficios por día / banco / billetera (archivo beneficios.json).
const fs = require("fs");

const DIAS = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];
const norm = (s) => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
const mediodia = (iso) => new Date(iso + "T12:00:00");
const diaSemana = (iso) => DIAS[mediodia(iso).getDay()];
function sumarDias(iso, n) {
  const d = mediodia(iso);
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString("sv");
}

function cargar(archivo) {
  try {
    const j = JSON.parse(fs.readFileSync(archivo, "utf8"));
    return { misMedios: j.misMedios || [], beneficios: j.beneficios || [] };
  } catch {
    return { misMedios: [], beneficios: [] };
  }
}

const vigente = (b, fecha) => !(b.desde && fecha < b.desde) && !(b.hasta && fecha > b.hasta);
const mioMedio = (b, medios) => !medios.length || medios.includes(norm(b.medio));

function aplicaEnDia(b, fecha) {
  if (b.dias === "todos") return true;
  return Array.isArray(b.dias) && b.dias.length > 0 && b.dias.map(norm).includes(diaSemana(fecha));
}

// n días a partir de `hoy`
function calendario({ misMedios, beneficios }, hoy, n = 7) {
  const medios = misMedios.map(norm);
  const dias = [];
  for (let k = 0; k < n; k++) {
    const fecha = sumarDias(hoy, k);
    const lista = beneficios
      .filter((b) => vigente(b, fecha) && mioMedio(b, medios) && aplicaEnDia(b, fecha))
      .sort((a, b) => b.pct - a.pct);
    const mejor = {};
    for (const b of lista) if (!b.adicional && !mejor[b.tienda]) mejor[b.tienda] = b;
    dias.push({ fecha, diaSemana: diaSemana(fecha), beneficios: lista, mejor });
  }

  // Mejor combinación día + tienda entre beneficios con día explícito (no "todos")
  let recomendado = null;
  for (const d of dias) {
    for (const b of d.beneficios) {
      if (b.adicional || b.dias === "todos") continue;
      if (!recomendado || b.pct > recomendado.pct) recomendado = { ...b, fecha: d.fecha, diaSemana: d.diaSemana };
    }
  }

  // Vigentes hoy pero sin día claro: no entran al calendario, se muestran aparte
  const sinDia = beneficios.filter(
    (b) => vigente(b, hoy) && mioMedio(b, medios) && !(b.dias === "todos" || (Array.isArray(b.dias) && b.dias.length))
  );
  const vencenPronto = beneficios.filter(
    (b) => b.hasta && b.hasta >= hoy && b.hasta <= sumarDias(hoy, 3) && mioMedio(b, medios)
  );
  const hayDatosVigentes = beneficios.some((b) => vigente(b, hoy) || (b.desde && b.desde > hoy));
  return { dias, recomendado, sinDia, vencenPronto, hayDatosVigentes };
}

module.exports = { cargar, calendario, diaSemana, sumarDias, norm };
