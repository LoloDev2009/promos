// Punto único para todas las tiendas.
const vtex = require("./vtex");
const coto = require("./coto");

const TIENDAS = { ...vtex.TIENDAS, coto: { base: "constructor" } };

function buscar(tienda, termino, opts) {
  if (tienda === "coto") return coto.buscar(termino, opts);
  return vtex.buscar(tienda, termino, opts);
}

module.exports = { buscar, TIENDAS };
