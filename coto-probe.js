// Sondeo de la búsqueda de Coto (Constructor.io). Solo lee y muestra la forma de los datos.
// Uso: node coto-probe.js yogurt
const crypto = require("crypto");
const fs = require("fs");

const KEY = "key_r6xzz4IAoTWcipni"; // clave pública del frontend de Coto
const q = process.argv[2] || "yogurt";

const params = new URLSearchParams({
  key: KEY,
  i: crypto.randomUUID(),
  s: "1",
  num_results_per_page: "5",
  page: "1",
});
const url = `https://ac.cnstrc.com/search/${encodeURIComponent(q)}?${params}`;

(async () => {
  console.log("GET", url, "\n");
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      Accept: "application/json",
      Origin: "https://www.cotodigital.com.ar",
      Referer: "https://www.cotodigital.com.ar/",
    },
  });
  console.log("HTTP", res.status);
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    console.log("No es JSON:\n", text.slice(0, 500));
    return;
  }
  fs.writeFileSync("coto-sample.json", JSON.stringify(data, null, 2));

  const resp = data.response ?? data;
  console.log("Claves de nivel superior:", Object.keys(data));
  console.log("Claves de response:", Object.keys(resp));
  console.log("Total de resultados:", resp.total_num_results);
  console.log("Cantidad en esta página:", resp.results?.length);

  const first = resp.results?.[0];
  if (!first) return console.log("Sin resultados.");
  console.log("\n=== PRIMER PRODUCTO (recortado a 6000 caracteres) ===");
  console.log(JSON.stringify(first, null, 2).slice(0, 6000));
  console.log("\n(La respuesta completa quedó en coto-sample.json)");
})().catch((e) => console.error("Error:", e.message));
