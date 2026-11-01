// SQLite integrado en Node (node:sqlite, Node 22.5+): catálogo, historial de precios y caché.
const { DatabaseSync } = require("node:sqlite");
const fs = require("fs");
const path = require("path");

const dir = process.env.DATA_DIR || path.join(__dirname, "data");
fs.mkdirSync(dir, { recursive: true });
const db = new DatabaseSync(path.join(dir, "promos.db"));
db.exec("PRAGMA journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS productos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tienda TEXT NOT NULL, item_id TEXT NOT NULL, ean TEXT,
  nombre TEXT, marca TEXT, link TEXT, imagen TEXT,
  UNIQUE (tienda, item_id)
);
CREATE TABLE IF NOT EXISTS precios (
  producto_id INTEGER NOT NULL REFERENCES productos(id),
  capturado_en TEXT NOT NULL,
  precio REAL, precio_lista REAL, descuento_pct INTEGER, promos_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_precios_prod ON precios(producto_id, capturado_en);
CREATE TABLE IF NOT EXISTS compra_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  clave TEXT NOT NULL UNIQUE,
  nombre TEXT NOT NULL,
  cantidad INTEGER NOT NULL DEFAULT 1,
  terminos_json TEXT NOT NULL DEFAULT '[]',
  creado_en TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS compra_miembros (
  compra_id INTEGER NOT NULL,
  tienda TEXT NOT NULL, item_id TEXT NOT NULL,
  snapshot_json TEXT NOT NULL, actualizado_en TEXT NOT NULL,
  PRIMARY KEY (compra_id, tienda, item_id)
);
CREATE INDEX IF NOT EXISTS idx_cm_item ON compra_miembros(tienda, item_id);
CREATE TABLE IF NOT EXISTS cache (
  tienda TEXT NOT NULL, q TEXT NOT NULL, capturado_en TEXT NOT NULL, json TEXT NOT NULL,
  PRIMARY KEY (tienda, q)
);
`);

const upsertProd = db.prepare(`
  INSERT INTO productos (tienda, item_id, ean, nombre, marca, link, imagen)
  VALUES (@tienda, @itemId, @ean, @nombre, @marca, @link, @imagen)
  ON CONFLICT (tienda, item_id) DO UPDATE SET
    ean=excluded.ean, nombre=excluded.nombre, marca=excluded.marca, link=excluded.link, imagen=excluded.imagen
  RETURNING id`);
const insPrecio = db.prepare(`
  INSERT INTO precios (producto_id, capturado_en, precio, precio_lista, descuento_pct, promos_json)
  VALUES (?, ?, ?, ?, ?, ?)`);
const putCache = db.prepare(`
  INSERT INTO cache (tienda, q, capturado_en, json) VALUES (?, ?, ?, ?)
  ON CONFLICT (tienda, q) DO UPDATE SET capturado_en=excluded.capturado_en, json=excluded.json`);
const getCache = db.prepare(`SELECT capturado_en, json FROM cache WHERE tienda = ? AND q = ?`);

// Solo se guarda lo necesario para calcular totales
const CAMPOS = ["tienda", "itemId", "sellerId", "nombre", "marca", "ean", "link", "imagen", "precio",
  "precioLista", "descuentoPct", "promos", "etiquetas", "cantidad", "unidad", "clave"];
const recorte = (it) => Object.fromEntries(CAMPOS.filter((k) => it[k] !== undefined).map((k) => [k, it[k]]));

const refrescarMiembro = db.prepare(
  `UPDATE compra_miembros SET snapshot_json = ?, actualizado_en = ? WHERE tienda = ? AND item_id = ?`);

function guardar(tienda, q, items) {
  const ahora = new Date().toISOString();
  db.exec("BEGIN");
  try {
    for (const it of items) {
      if (!it.itemId) continue;
      // node:sqlite rechaza claves que no estén en la consulta, así que paso solo las necesarias
      const { id } = upsertProd.get({
        tienda: it.tienda, itemId: String(it.itemId), ean: it.ean ?? null,
        nombre: it.nombre ?? null, marca: it.marca ?? null, link: it.link ?? null, imagen: it.imagen ?? null,
      });
      insPrecio.run(id, ahora, it.precio, it.precioLista, it.descuentoPct, JSON.stringify(it.promos));
    }
    putCache.run(tienda, q, ahora, JSON.stringify(items));
    for (const it of items) {
      if (it.itemId) refrescarMiembro.run(JSON.stringify(recorte(it)), ahora, it.tienda, String(it.itemId));
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

const histStmt = db.prepare(`
  SELECT p.capturado_en, p.precio, p.promos_json
  FROM precios p JOIN productos pr ON pr.id = p.producto_id
  WHERE pr.tienda = ? AND pr.item_id = ? AND p.capturado_en >= ?
  ORDER BY p.capturado_en`);

function historial(tienda, itemId, dias = 90) {
  const desde = new Date(Date.now() - dias * 86400000).toISOString();
  return histStmt.all(tienda, String(itemId), desde);
}

function leerCache(tienda, q, ttlMs) {
  const row = getCache.get(tienda, q);
  if (!row) return null;
  if (Date.now() - new Date(row.capturado_en).getTime() > ttlMs) return null;
  return { capturadoEn: row.capturado_en, items: JSON.parse(row.json) };
}

// ---------- Lista de compras ----------
const compraPorClave = db.prepare(`SELECT id, cantidad, terminos_json FROM compra_items WHERE clave = ?`);
const compraInsert = db.prepare(
  `INSERT INTO compra_items (clave, nombre, cantidad, terminos_json, creado_en) VALUES (?, ?, 1, ?, ?) RETURNING id`);
const compraUpdate = db.prepare(`UPDATE compra_items SET cantidad = ?, terminos_json = ? WHERE id = ?`);
const miembroUpsert = db.prepare(`
  INSERT INTO compra_miembros (compra_id, tienda, item_id, snapshot_json, actualizado_en) VALUES (?, ?, ?, ?, ?)
  ON CONFLICT (compra_id, tienda, item_id) DO UPDATE SET snapshot_json=excluded.snapshot_json, actualizado_en=excluded.actualizado_en`);

function compraAgregar({ clave, nombre, q, items }) {
  const ahora = new Date().toISOString();
  db.exec("BEGIN");
  try {
    const fila = compraPorClave.get(clave);
    let id;
    if (fila) {
      id = fila.id;
      const terminos = new Set(JSON.parse(fila.terminos_json));
      if (q) terminos.add(String(q).toLowerCase());
      compraUpdate.run(Math.min(99, fila.cantidad + 1), JSON.stringify([...terminos]), id);
    } else {
      ({ id } = compraInsert.get(clave, nombre, JSON.stringify(q ? [String(q).toLowerCase()] : []), ahora));
    }
    for (const it of items) {
      if (it.itemId == null) continue;
      miembroUpsert.run(id, it.tienda, String(it.itemId), JSON.stringify(recorte(it)), ahora);
    }
    db.exec("COMMIT");
    return id;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

function compraListar() {
  const items = db.prepare(`SELECT id, clave, nombre, cantidad, terminos_json FROM compra_items ORDER BY id`).all();
  const miembros = db.prepare(`SELECT compra_id, snapshot_json, actualizado_en FROM compra_miembros`).all();
  return items.map((e) => ({
    id: e.id, clave: e.clave, nombre: e.nombre, cantidad: e.cantidad,
    terminos: JSON.parse(e.terminos_json),
    miembros: miembros.filter((m) => m.compra_id === e.id)
      .map((m) => ({ ...JSON.parse(m.snapshot_json), actualizadoEn: m.actualizado_en })),
  }));
}

function compraCantidad(id, n) {
  const c = Math.max(1, Math.min(99, Math.round(+n) || 1));
  const fila = db.prepare(`SELECT id, terminos_json FROM compra_items WHERE id = ?`).get(id);
  if (!fila) return false;
  compraUpdate.run(c, fila.terminos_json, id);
  return true;
}

function compraQuitar(id) {
  db.prepare(`DELETE FROM compra_miembros WHERE compra_id = ?`).run(id);
  return db.prepare(`DELETE FROM compra_items WHERE id = ?`).run(id).changes > 0;
}

function compraTerminos() {
  return [...new Set(db.prepare(`SELECT terminos_json FROM compra_items`).all().flatMap((r) => JSON.parse(r.terminos_json)))];
}

// Tras refrescar: lo que no volvió a aparecer en las tiendas consultadas queda marcado sin stock
function compraMarcarSinStock(visto, tiendasOk) {
  const ahora = new Date().toISOString();
  const filas = db.prepare(`SELECT compra_id, tienda, item_id, snapshot_json FROM compra_miembros`).all();
  const upd = db.prepare(`UPDATE compra_miembros SET snapshot_json = ?, actualizado_en = ? WHERE compra_id = ? AND tienda = ? AND item_id = ?`);
  for (const f of filas) {
    if (!tiendasOk.has(f.tienda) || visto.has(`${f.tienda}:${f.item_id}`)) continue;
    const snap = JSON.parse(f.snapshot_json);
    if (snap.sinStock) continue;
    upd.run(JSON.stringify({ ...snap, sinStock: true }), ahora, f.compra_id, f.tienda, f.item_id);
  }
}

module.exports = { db, guardar, leerCache, historial, compraAgregar, compraListar, compraCantidad, compraQuitar, compraTerminos, compraMarcarSinStock };
