// Corre fn sobre items con como máximo `limite` tareas a la vez; conserva el orden de resultados.
async function pool(items, limite, fn) {
  const resultados = new Array(items.length);
  let i = 0;
  const trabajadores = Array.from({ length: Math.min(limite, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      resultados[k] = await fn(items[k], k);
    }
  });
  await Promise.all(trabajadores);
  return resultados;
}

module.exports = { pool };
