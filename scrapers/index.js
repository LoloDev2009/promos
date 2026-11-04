// Punto único para todas las tiendas.
const vtex = require("./vtex");
const coto = require("./coto");

const todas = { ...vtex.TIENDAS, coto: { nombre: "Coto", base: "constructor", promos: "catalogo" } };

// TIENDAS_ACTIVAS=carrefour,dia,coto limita qué tiendas se consultan (por defecto, todas)
const activas = process.env.TIENDAS_ACTIVAS ? process.env.TIENDAS_ACTIVAS.split(",").map((s) => s.trim()) : null;
const TIENDAS = Object.fromEntries(Object.entries(todas).filter(([k]) => !activas || activas.includes(k)));

function buscar(tienda, termino, opts) {
  if (tienda === "coto") return coto.buscar(termino, opts);
  return vtex.buscar(tienda, termino, opts);
}

module.exports = { buscar, TIENDAS, TODAS: Object.keys(todas) };
