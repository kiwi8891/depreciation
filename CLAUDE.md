# CLAUDE.md — Activos / Depreciación

## Stack & deploy
HTML+CSS+JS vanilla · Chart.js CDN · Inter (Google Fonts) · GitHub Pages (kiwi8891.github.io/depreciation) · datos en JSON exportado a Filen

## Arquitectura de datos
localStorage como caché de sesión. Persistencia real = JSON export/import. NUNCA subir .json a git (.gitignore lo excluye). Estructura: `{version, assets[], lastSaved}`. Cada asset: `{id, name, type, purchaseDate, purchasePrice, subsidies, residualValuePct, expectedAnnualKm, updates[], marketAnchors[]}`.

## Motor de depreciación
Declining balance acelerado × factor SOH × factor km → anclado a precio de mercado (peso 70%→30% según antigüedad). Tasas anuales car: [25,18,13,10,8,7,6,5,5,5]%. Ebike: [20,15,11,9,7,6,5,5,5,5]%. Residual sugerido: car 12%, ebike 18%. SOH <90%→×0.95, <80%→×0.88, <70%→×0.78. Km ratio >1.5→×0.93, >2→×0.88.

## Output clave → MoneyWiz
El usuario anota el **valor actual** del activo en MoneyWiz; MoneyWiz calcula la pérdida. La caja morada (moneywiz-box) muestra: valor hoy / depreciación este mes / depreciación mes anterior.

## Precio de mercado
Actualizar cada 6 meses. Fuentes: Wallapop, Coches.net, eBay Kleinanzeigen (ebikes). Metodología: 3-5 anuncios similares → descartar extremos → mediana. Claude NO puede buscar precios — el usuario debe hacerlo y anotarlo en la app.

## Activos actuales
- **BYD Dolphin Surf Boost · Azul Cielo** — compra 12/02/2026 · 23.690€ · 2.996km · SOH 100% (no visible aún en app BYD). Precio de mercado: pendiente de consultar por el usuario.
- **Riese & Müller** — pendiente de compra. SOH vía Bosch eBike Connect.

## Subvenciones
Campo `subsidies` reduce el precio efectivo. A 11/04/2026 sin subvenciones recibidas aún. Actualizar cuando lleguen (MOVES u otras).

## Decisiones de diseño tomadas
- Depreciación acelerada+mercado elegida sobre lineal por ser más realista para EVs
- JSON+Filen sobre localStorage puro por uso multi-dispositivo
- GitHub Pages sobre app local por accesibilidad desde cualquier dispositivo
- Una sola herramienta multi-activo (coche+ebike comparten misma lógica)
- Inter + tabular-nums para importes financieros
- Números tabulares en todos los valores monetarios (font-variant-numeric)

## Git
Repo: git@github.com:kiwi8891/depreciation.git · rama main · SSH configurado (id_ed25519). No hay gh CLI — usar git directo con SSH.

## Próximos pasos pendientes
- Introducir primer precio de mercado del BYD cuando el usuario consulte Wallapop/Coches.net
- Añadir Riese & Müller cuando se compre
- Actualizar `subsidies` del BYD cuando lleguen las ayudas MOVES
