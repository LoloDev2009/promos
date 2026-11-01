<<<<<<< HEAD
# promos
=======
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
>>>>>>> b2fc25e (Initial Commit)
