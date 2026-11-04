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

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const fechaValida = (s) => FECHA.test(s) && !Number.isNaN(Date.parse(s)) && new Date(s + "T12:00:00").toLocaleDateString("sv") === s;
const numero = (v) => (v === "" || v == null ? null : Number(String(v).replace(",", ".")));
const bool = (v, defecto) => (v === undefined || v === null ? defecto : v === true || v === "true");

// Limpia y valida un beneficio venido de la página o pegado desde el chat. -> { valor, errores }
function normalizarBeneficio(b, tiendasOk) {
  const errores = [];
  if (!b || typeof b !== "object") return { valor: null, errores: ["no es un objeto"] };
  const tienda = norm(b.tienda);
  if (!tiendasOk.includes(tienda)) errores.push(`tienda desconocida "${b.tienda}" (válidas: ${tiendasOk.join(", ")})`);
  const medio = String(b.medio ?? "").trim();
  if (!medio || medio.length > 60) errores.push("falta el medio de pago (máx. 60 letras)");
  const pct = numero(b.pct);
  if (!(pct > 0 && pct <= 100)) errores.push("el porcentaje debe estar entre 1 y 100");

  let dias = null;
  if (b.dias === "todos") dias = "todos";
  else if (Array.isArray(b.dias) || typeof b.dias === "string") {
    const lista = [...new Set((Array.isArray(b.dias) ? b.dias : [b.dias]).map(norm).filter(Boolean))];
    const malos = lista.filter((d) => !DIAS.includes(d));
    if (malos.length) errores.push(`día no válido: ${malos.join(", ")}`);
    dias = lista.includes("todos") ? "todos" : lista.length ? lista : null;
  }
  const tope = numero(b.tope), compraMinima = numero(b.compraMinima);
  if (tope !== null && !(tope > 0)) errores.push("el tope debe ser mayor a 0 (o vacío)");
  if (compraMinima !== null && !(compraMinima > 0)) errores.push("la compra mínima debe ser mayor a 0 (o vacía)");
  const desde = b.desde || null, hasta = b.hasta || null;
  for (const [k, v] of [["desde", desde], ["hasta", hasta]]) if (v && !fechaValida(v)) errores.push(`${k}: fecha inválida (usar AAAA-MM-DD)`);
  if (desde && hasta && desde > hasta) errores.push("'desde' es posterior a 'hasta'");

  const valor = {
    tienda, medio, dias, pct,
    tope: tope, topePeriodo: tope ? (String(b.topePeriodo || "").trim().slice(0, 20) || null) : null,
    topeAConfirmar: tope ? false : bool(b.topeAConfirmar, false),
    ...(compraMinima ? { compraMinima } : {}),
    detalle: String(b.detalle ?? "").trim().slice(0, 300),
    desde, hasta,
    adicional: bool(b.adicional, false),
    verificar: bool(b.verificar, true), // lo que viene de afuera se da por "a verificar" salvo que se diga lo contrario
    fuente: String(b.fuente ?? "").trim().slice(0, 120) || "carga manual",
  };
  return { valor, errores };
}

// { misMedios, beneficios } -> { valor, errores } (errores con el número de fila)
function validarArchivo(datos, tiendasOk) {
  const errores = [];
  const lista = Array.isArray(datos?.beneficios) ? datos.beneficios : null;
  if (!lista) return { valor: null, errores: ["falta la lista 'beneficios'"] };
  if (lista.length > 300) return { valor: null, errores: ["demasiados beneficios (máx. 300)"] };
  const beneficios = [];
  lista.forEach((x, i) => {
    const r = normalizarBeneficio(x, tiendasOk);
    if (r.errores.length) errores.push(...r.errores.map((e) => `#${i + 1} ${x?.tienda ?? "?"}/${x?.medio ?? "?"}: ${e}`));
    else beneficios.push(r.valor);
  });
  const misMedios = (Array.isArray(datos.misMedios) ? datos.misMedios : []).map((m) => String(m).trim()).filter(Boolean).slice(0, 30);
  return { valor: { misMedios, beneficios }, errores };
}

// Escritura atómica: se escribe un temporal y se renombra, así nunca queda un archivo a medias
function guardarArchivo(archivo, valor) {
  let leeme = "Beneficios por día / banco / billetera. Se edita desde la página (Cuándo comprar → Editar beneficios) o a mano.";
  try { leeme = JSON.parse(fs.readFileSync(archivo, "utf8"))._leeme || leeme; } catch { /* archivo nuevo */ }
  const tmp = `${archivo}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify({ _leeme: leeme, ...valor }, null, 2) + "\n");
  fs.renameSync(tmp, archivo);
}

module.exports = { cargar, calendario, diaSemana, sumarDias, norm, normalizarBeneficio, validarArchivo, guardarArchivo };
