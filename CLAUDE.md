# CLAUDE.md — Activos / Depreciación

## Stack & deploy
HTML+CSS+JS vanilla · Chart.js CDN · Inter (Google Fonts) · GitHub Pages (kiwi8891.github.io/depreciation) · datos en JSON exportado a Filen

## Arquitectura de datos
localStorage como caché de sesión. Persistencia real = JSON export/import. NUNCA subir .json a git (.gitignore lo excluye). Estructura: `{version, assets[], lastSaved}`. Cada asset: `{id, name, type, purchaseDate, purchasePrice, subsidies, residualValuePct, expectedAnnualKm, updates[], marketAnchors[]}`.

## Motor de depreciación (v1.2, 2026-10-26)
valor = curva base × factor SOH × factor km × corrección de mercado, acotado entre el residual y el precio efectivo (nunca vale más de lo pagado).
- Curva base: declining balance. Car [25,18,13,10,8,7,6,5,5,5]%, ebike [20,15,11,9,7,6,5,5,5,5]%. Residual sugerido car 12%, ebike 18%.
- SOH: interpolación lineal 90→1,00 · 80→0,95 · 70→0,88 · 60→0,78 · 50→0,65 (sin escalones).
- Km: km hechos desde el **primer registro** frente a esperados en la fecha del update. ±3% por cada 10.000 km (ebike: 2.000), tope ±10%.
- Mercado: factor = precio_mercado / modelo(fecha_ancla), aplicado desde esa fecha y **sin caducidad** (un ancla nueva sustituye a la anterior).
- Antes (v1.1): mezcla 70→30% que caducaba a 6 meses → valores que subían y saltos al caducar; km con escalones que contaban los km iniciales; premio ×1,04 por poco uso (el Tesla valía más que lo pagado). Corregido.
- Cambiar el motor recalcula todo el histórico → un mes de ajuste puntual en MoneyWiz.

## Output clave → MoneyWiz
El usuario anota el **valor actual** del activo en MoneyWiz; MoneyWiz calcula la pérdida. La caja morada (moneywiz-box) muestra: valor hoy / depreciación este mes / depreciación mes anterior.

## Precio de mercado
Actualizar cada 6 meses. Fuentes: Wallapop, Coches.net, eBay Kleinanzeigen (ebikes). Metodología: 3-5 anuncios similares → descartar extremos → mediana.
- Claude SÍ puede buscar: WebFetch a `coches.net/<marca>/<modelo>/segunda-mano/?MinYear=2025&MaxKms=20000` funciona (listado truncado a ~8 anuncios). AutoUncle da 403. WebSearch extended completa.
- Casi todo son anuncios de **concesionario** (incluyen margen y garantía, +10-15 % sobre el precio de venta real). Decidir si el ancla es mediana×0,90 (venta realista) o el precio de los anuncios tal cual.

## Activos actuales (JSON vigente: activos_2026-10-26.json)
- **BYD Dolphin Surf Boost · Azul Cielo**: compra 12/02/2026 · 23.690€ · **0 km en la compra** · 10.243 km a 26/10/2026 · 10.000 km/año. Ancla: 21.900€ (13/04/2026, Coches.net).
- **Tesla Model 3 Standard RWD · Blanco**: compra 24/10/2026 · 33.365€ · 0 km · nuevo · 10.000 km/año. Sin ancla aún. Ayudas pendientes: Plan Auto+ y deducción IRPF.
- **Riese & Müller Charger4 Touring**: compra 12/04/2026 · 2.649€. Ancla de 1.900€ con referencias de 2023 y 4.000 km (no comparables): rehacerla con bicis similares a la suya.

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

## Búsqueda de mercado 2026-10-26 (pendiente de meter en la app)
- **BYD Boost 2026** (coches.net, Concesur, km77): 20.500 € (9.500 km, Valladolid) · 19.900 € (3.790 km) · 19.900 € (3.100 km) · 21.900 € (1.500 km) · 21.900 € (4-5.000 km) → **mediana 20.500 €**. La app hoy da 18.657 €.
- **Tesla Model 3**: anuncios 2025-26 entre 32.000 y 39.990 €, casi todos por encima de lo pagado (33.365 €), y "Standard" no siempre es la misma versión. Decisión: **sin ancla para el Tesla** hasta dentro de 4-6 meses (si no, el tope lo deja clavado en 33.365 €).
- **Pendiente de Ger: opción A o B** para el BYD. A (recomendada) = 20.500 × 0,90 = **18.450 €** (venta realista, el valor queda casi igual). B = 20.500 € tal cual (+1.800 €).

## Siguiente sesión empieza por
Preguntar A/B del ancla del BYD → añadir el ancla (fecha 2026-10-26, fuente coches.net, refs) al JSON `activos_2026-10-26.json` → Ger lo importa y anota en MoneyWiz los valores de hoy (BYD según ancla, Tesla 33.299 €, R&M 1.685 €; la R&M probablemente sobredepreciada por su ancla no comparable).

## Próximos pasos pendientes
- Rehacer el ancla de la R&M con referencias comparables
- Ancla de mercado del Tesla y del BYD (la del BYD es de abril)
- `subsidies` del Tesla (Auto+ e IRPF) y del BYD (MOVES) cuando lleguen
