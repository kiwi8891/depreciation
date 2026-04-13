# Changelog

## [1.1.0] — 2026-04-13

### Mejoras

- **Escala temporal en el gráfico** — botones 1A / 3A / 5A / 10A / Todo para cambiar la vista sin recargar; por defecto 5 años desde la compra
- **Panel de metodología** — sección colapsable "¿Cómo se calcula este valor?" con tablas de tasas de depreciación, factores SOH/km y explicación del anclaje al mercado
- **Referencias de mercado múltiples** — el formulario de precio de mercado permite añadir varios anuncios (precio, año, km, color, fuente); la mediana se calcula automáticamente con botón "Usar este valor"
- **Histórico de referencias** — la tabla de precios de mercado muestra las referencias consultadas en detalle colapsable por entrada
- **Nueva fuente: eBay Kleinanzeigen** — añadida al selector de fuentes (relevante para ebikes)

## [1.0.0] — 2026-04-11

### Lanzamiento inicial

- Motor de depreciación acelerada + anclaje a precio de mercado
- Factores de ajuste: SOH de batería y kilómetros reales
- Dashboard con valor total de cartera y depreciación mensual
- Caja MoneyWiz con valor actual, depreciación este mes y mes anterior
- Gráfica de evolución: histórico + proyección + valor residual + precios de mercado
- Alertas de actualización de precio de mercado (cada 6 meses)
- Export / Import JSON para uso multi-dispositivo (Filen, iCloud, Dropbox)
- Historial de actualizaciones y precios de mercado por activo
- Valores residuales sugeridos por algoritmo según tipo de activo
- Diseño responsive con Inter, números tabulares y micro-interacciones
- Hosting en GitHub Pages
