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

module.exports = { db, guardar, leerCache, historial };
