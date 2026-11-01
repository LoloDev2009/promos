# Promos súper

Buscador de promos de Carrefour, Día y Coto.

    npm install
    npm start          # http://localhost:3000
    npm test           # test contra tiendas simuladas

- Primera búsqueda de un término: tarda unos segundos (scrapea). Después sale de la caché (6 h, `CACHE_HORAS=2` para cambiarlo).
- `CP=5000 npm start` cambia el código postal usado para simular el carrito de Carrefour (default 1425).
- Cada búsqueda guarda el historial de precios en `data/promos.db`.
- Coto: precios y stock dependen de la sucursal. `COTO_STORE=200` (default) la cambia. Prueba suelta: `node scrapers/coto.js yogurt`.

## Seguimiento diario ("Mi lista")
- Los productos a seguir están en `watchlist.json` (editalo cuando quieras, no hace falta reiniciar).
- `npm run track` (o `node track.js`) busca cada producto en las 3 tiendas y guarda precios y promos. `node track.js yerba` rastrea solo ese término.
- La pestaña **Mi lista** muestra lo mejor de cada producto y señales sacadas del historial (en promo hace N días, mínimo registrado, % bajo su promedio). Las señales mejoran a medida que pasan los días.
- Para que corra solo todos los días a las 9:00 (Linux con systemd):

      mkdir -p ~/.config/systemd/user
      cp systemd/promos-track.* ~/.config/systemd/user/
      systemctl --user daemon-reload
      systemctl --user enable --now promos-track.timer
      systemctl --user list-timers        # verificar
      journalctl --user -u promos-track   # ver el resultado

  Si `node` viene de nvm/fnm, cambiá `/usr/bin/env node` en el `.service` por la ruta de `which node`.
  El timer usa `Persistent=true`: si la PC estaba apagada a las 9:00, corre apenas se prende.

## Cuándo comprar (beneficios por día / banco / billetera)
- Los beneficios están en `beneficios.json`. Editalo cada mes: los bancos y las tiendas cambian las promos con frecuencia.
- `misMedios`: poné ahí solo los medios de pago que usás (ej. `["Cuenta DNI", "MODO"]`). Vacío = muestra todos.
- `dias`: `["lunes","viernes"]`, `"todos"` o `null` (si el día no está claro, aparece aparte como "Día a confirmar").
- `adicional: true` = se suma a otro beneficio; no compite en el ranking de "mejor día".
- `verificar: true` = confirmalo en la web del banco o la tienda antes de contar con él.
- Cada beneficio con `hasta` deja de mostrarse solo cuando vence.

## Disponibilidad
- Carrefour y Día: el stock se confirma simulando un carrito (1 unidad por producto). El stock que informa el catálogo no es confiable.
- Coto: solo se muestran productos con stock en la sucursal elegida (`COTO_STORE`).
- Todo depende de la zona: usá tu código postal (`CP=XXXX npm start`) y tu sucursal de Coto, así coincide con lo que ves en la web.
- Los resultados se guardan 6 horas (y "Mi lista" muestra lo último rastreado): el stock puede cambiar entre el rastreo y tu visita.

## Velocidad
- Cada tienda se consulta por separado y en paralelo; la página muestra cada una apenas termina (y cuánto tardó).
- Dentro de cada tienda, las páginas de resultados, los lotes de stock y las consultas de promos van en paralelo (máx. 6 a la vez).
- Las promos se consultan primero para los productos relevantes (los que muestra el filtro "Solo lo que busqué").
- Dos búsquedas idénticas simultáneas comparten una sola consulta. La segunda vez que buscás lo mismo sale de la caché (6 h).

## Mismo producto en varias tiendas
- Si un producto está en 2 o más tiendas se muestra en una sola tarjeta, con un renglón por tienda (el más barato primero) y cuánto se ahorra.
- Se identifican por código de barras (EAN). Sin EAN, solo se juntan si el nombre normalizado (sin importar orden ni acentos) y el tamaño son idénticos. Dos EAN distintos nunca se juntan.
- El precio de cada tienda ya incluye su mejor promo vigente (por unidad, llevando las unidades que pida la promo).

## Mi compra (lista de compras con total por tienda)
- Tocá el **+** de cualquier tarjeta para agregarlo a Mi compra (si ya estaba, suma una unidad).
- En la pestaña **Mi compra** ajustás las cantidades. La app calcula cuánto sale todo en cada tienda y la mejor combinación entre tiendas, contando las promos que piden llevar 2 o 3 unidades (2º al 70%, 3x2…) con su tope y vigencia. Las promos con tarjeta/billetera cuentan solo si el casillero está marcado.
- Una tienda extra solo se recomienda si ahorra más del 3% del total.
- Debajo de cada tienda sugiere el mejor beneficio por día/banco de los próximos 7 días (de `beneficios.json`).
- Los precios se mantienen al día solos: cada búsqueda que los vuelve a ver los refresca, y `node track.js` incluye las búsquedas de donde salieron tus productos. El botón **Actualizar precios** fuerza la consulta y marca "sin stock" lo que ya no aparece.
- `npm test` corre los tests del servidor, la lógica y la página.

## Más tiendas: Jumbo, Disco y Vea (grupo Cencosud)
- Ya se consultan precios y stock. Son VTEX como Carrefour y Día, con tres diferencias que el código respeta:
  no se manda `sc=1` (da error 400), el precio de lista viene roto (se ignora si es absurdo) y **sus promociones no están en el lugar estándar**: todavía no se leen.
  Mientras tanto la página avisa "promos sin leer" en esas tiendas, porque el precio real en la web puede ser menor.
- `cencosud-probe.js` sirve para descubrir el endpoint de promos (ver instrucciones en el archivo).
- `TIENDAS_ACTIVAS=carrefour,dia,coto npm start` limita las tiendas que se consultan (más rápido). Las tiendas de la página se cargan solas desde el servidor.
