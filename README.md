# Activos — Control de Depreciación

Herramienta personal para valorar activos (coches eléctricos, ebikes, etc.) y registrar su depreciación mensual. Diseñada para integrarse con **MoneyWiz** o cualquier app de contabilidad personal.

## Demo

**[kiwi8891.github.io/depreciation](https://kiwi8891.github.io/depreciation)**

## ¿Para qué sirve?

En contabilidad personal, los activos de valor (coche, bici eléctrica...) no son un gasto: son activos que se deprecian. Esta herramienta calcula su valor real mes a mes para que puedas anotarlo en tu app de finanzas.

**Flujo con MoneyWiz:**
1. Abres la app → ves el valor actual del activo
2. Lo introduces en MoneyWiz como nuevo valor del activo
3. MoneyWiz calcula automáticamente la pérdida o ganancia

## Características

- **Motor de depreciación combinado**: acelerada (25% año 1, decreciente) + anclaje a precio de mercado real
- **Factores de ajuste**: SOH de batería (State of Health) y kilómetros reales vs. esperados
- **Caja MoneyWiz**: valor actual, depreciación este mes y mes anterior, siempre a la vista
- **Gráfica de evolución**: histórico + proyección futura + valor residual + precios de mercado
- **Alertas**: recuerda actualizar el precio de mercado cada 6 meses
- **Multi-dispositivo**: exporta/importa JSON y guárdalo en Filen, iCloud o Dropbox
- **100% local**: sin servidor, sin base de datos, sin suscripciones

## Uso en múltiples dispositivos

Los datos se guardan en el navegador (localStorage) para sesión local. Para usarlo en varios dispositivos:

1. **Exportar**: botón `↓ Exportar` → guarda el `.json` en Filen/iCloud
2. **Importar**: en otro dispositivo, botón `↑ Importar` → selecciona el fichero

## Añadir un activo

1. Pulsa **+ Nuevo activo**
2. Rellena: tipo, nombre, fecha de compra, precio, valor residual, km esperados/año
3. El algoritmo sugiere automáticamente el valor residual según el tipo de activo
4. Cada 6 meses: añade un **precio de mercado** (Wallapop, Coches.net...) para mayor precisión
5. Periódicamente: actualiza km y SOH de batería

## Cómo obtener el SOH de batería

| Activo | Cómo consultarlo |
|--------|-----------------|
| BYD Dolphin Surf | App BYD / menú del vehículo → Estado de batería |
| Riese & Müller (Bosch) | App **Bosch eBike Connect** → Estado de la batería |

## Algoritmo de depreciación

```
Valor = Precio_efectivo × Curva_acelerada × Factor_SOH × Factor_km
```

Combinado con anclaje de mercado (peso 70% → 30% según antigüedad del dato):

| Año | Coche eléctrico | Ebike |
|-----|----------------|-------|
| 1   | −25%           | −20%  |
| 2   | −18%           | −15%  |
| 3   | −13%           | −11%  |
| 4   | −10%           | −9%   |
| 5+  | −7–8%          | −5–7% |

**Valor residual sugerido:** 12% del precio efectivo (coches) / 18% (ebikes)

## Tecnología

- HTML + CSS + JavaScript vanilla
- [Chart.js](https://www.chartjs.org/) para gráficas
- [Inter](https://fonts.google.com/specimen/Inter) (Google Fonts)
- GitHub Pages para hosting

## Despliegue propio

```bash
git clone https://github.com/kiwi8891/depreciation.git
cd depreciation
# Abre index.html en el navegador — no necesita servidor
open index.html
```

Para publicar en GitHub Pages: **Settings → Pages → Branch: main / root → Save**
