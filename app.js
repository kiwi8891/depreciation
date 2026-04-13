'use strict';

// ==============================
// 1. CONFIGURATION & CONSTANTS
// ==============================

const CONFIG = {
    // Annual depreciation rates per year of life (index 0 = first year)
    depreciationRates: {
        car:   [0.25, 0.18, 0.13, 0.10, 0.08, 0.07, 0.06, 0.05, 0.05, 0.05],
        ebike: [0.20, 0.15, 0.11, 0.09, 0.07, 0.06, 0.05, 0.05, 0.05, 0.05]
    },
    suggestedResidualPct: {
        car:   12,
        ebike: 18
    },
    defaultAnnualKm: {
        car:   15000,
        ebike: 3500
    },
    // How many months forward to project in chart
    projectionMonths: 120
};

const TYPE_LABELS = { car: 'Coche eléctrico', ebike: 'Bici eléctrica' };
const TYPE_ICONS  = { car: '🚗', ebike: '🚲' };

// ==============================
// 2. STATE
// ==============================

const state = {
    view: 'dashboard',       // 'dashboard' | 'detail' | 'add-asset' | 'edit-asset' | 'add-update' | 'add-anchor'
    selectedAssetId: null,
    data: null,
    chartInstance: null,
    chartScale: '5Y'         // '1Y' | '3Y' | '5Y' | '10Y' | 'ALL'
};

// ==============================
// 3. DATA MANAGEMENT
// ==============================

function initData() {
    return { version: '1.0', assets: [], lastSaved: null };
}

function loadData() {
    try {
        const raw = localStorage.getItem('depreciation_data');
        if (raw) {
            state.data = JSON.parse(raw);
        } else {
            state.data = initData();
        }
    } catch (e) {
        state.data = initData();
    }
}

function saveData() {
    try {
        state.data.lastSaved = new Date().toISOString();
        localStorage.setItem('depreciation_data', JSON.stringify(state.data));
    } catch (e) {
        showToast('Error al guardar datos', 'error');
    }
}

function exportJSON() {
    const blob = new Blob([JSON.stringify(state.data, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    const date = new Date().toISOString().split('T')[0];
    a.href     = url;
    a.download = `activos_${date}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Exportado correctamente. Guárdalo en Filen.', 'success');
}

function importJSON(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const parsed = JSON.parse(e.target.result);
            if (!parsed.assets || !Array.isArray(parsed.assets)) {
                throw new Error('Formato inválido');
            }
            state.data = parsed;
            saveData();
            navigate('dashboard');
            showToast('Datos importados correctamente.', 'success');
        } catch (err) {
            showToast('Error al importar: fichero no válido.', 'error');
        }
    };
    reader.readAsText(file);
}

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function getAssetById(id) {
    return state.data.assets.find(a => a.id === id) || null;
}

// ==============================
// 4. DEPRECIATION ENGINE
// ==============================

function getEffectivePrice(asset) {
    return asset.purchasePrice - (asset.subsidies || 0);
}

function getResidualValue(asset) {
    return getEffectivePrice(asset) * (asset.residualValuePct / 100);
}

/**
 * Calculate base model value at a given date using accelerated declining balance.
 */
function getBaseValue(asset, targetDate) {
    const purchaseDate  = new Date(asset.purchaseDate);
    const effectivePrice = getEffectivePrice(asset);
    const residualValue  = getResidualValue(asset);
    const rates          = CONFIG.depreciationRates[asset.type] || CONFIG.depreciationRates.car;

    if (targetDate <= purchaseDate) return effectivePrice;

    // Months elapsed (fractional)
    const msPerMonth    = 1000 * 60 * 60 * 24 * 30.4375;
    const monthsElapsed = (targetDate - purchaseDate) / msPerMonth;

    let value           = effectivePrice;
    let processedMonths = 0;

    for (let year = 0; year < rates.length; year++) {
        if (processedMonths >= monthsElapsed) break;

        const annualRate   = rates[year];
        const monthlyRate  = 1 - Math.pow(1 - annualRate, 1 / 12);
        const monthsLeft   = monthsElapsed - processedMonths;
        const monthsThisYr = Math.min(12, monthsLeft);

        value = value * Math.pow(1 - monthlyRate, monthsThisYr);
        value = Math.max(value, residualValue);
        processedMonths += 12;
    }

    return Math.max(residualValue, value);
}

/**
 * Battery State of Health adjustment factor.
 * SOH = 100% → no penalty; degrades below 90%.
 */
function getBatteryFactor(soh) {
    if (soh === null || soh === undefined) return 1.0;
    const s = Number(soh);
    if (s >= 90) return 1.00;
    if (s >= 80) return 0.95;
    if (s >= 70) return 0.88;
    if (s >= 60) return 0.78;
    return 0.65;
}

/**
 * Km usage factor vs expected annual km.
 */
function getKmFactor(asset, update) {
    if (!update || update.km === null || update.km === undefined) return 1.0;

    const purchaseDate  = new Date(asset.purchaseDate);
    const updateDate    = new Date(update.date);
    const yearsElapsed  = Math.max((updateDate - purchaseDate) / (1000 * 60 * 60 * 24 * 365.25), 0.1);
    const actualAnnual  = update.km / yearsElapsed;
    const expectedAnnual = asset.expectedAnnualKm || CONFIG.defaultAnnualKm[asset.type];
    const ratio          = actualAnnual / expectedAnnual;

    if (ratio > 2.0) return 0.88;
    if (ratio > 1.5) return 0.93;
    if (ratio > 1.2) return 0.97;
    if (ratio < 0.5) return 1.04;
    if (ratio < 0.7) return 1.02;
    return 1.0;
}

/**
 * Get the most recent update at or before targetDate.
 */
function getLatestUpdate(asset, targetDate) {
    if (!asset.updates || asset.updates.length === 0) return null;
    const valid = asset.updates
        .filter(u => new Date(u.date) <= targetDate)
        .sort((a, b) => new Date(b.date) - new Date(a.date));
    return valid[0] || null;
}

/**
 * Get the most recent market anchor within the last 6 months.
 */
function getRecentAnchor(asset, targetDate) {
    if (!asset.marketAnchors || asset.marketAnchors.length === 0) return null;
    const sixMonthsAgo = new Date(targetDate);
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const valid = asset.marketAnchors
        .filter(a => {
            const d = new Date(a.date);
            return d <= targetDate && d >= sixMonthsAgo;
        })
        .sort((a, b) => new Date(b.date) - new Date(a.date));
    return valid[0] || null;
}

/**
 * Main value calculation combining model + factors + market anchor.
 */
function calculateValue(asset, targetDate = new Date()) {
    const residualValue = getResidualValue(asset);

    // 1. Base model
    let value = getBaseValue(asset, targetDate);

    // 2. Adjustments from latest update
    const update = getLatestUpdate(asset, targetDate);
    if (update) {
        value *= getBatteryFactor(update.batterySoh);
        value *= getKmFactor(asset, update);
    }

    // 3. Floor
    value = Math.max(residualValue, value);

    // 4. Market anchor blending (anchor weight fades linearly from 0.70 to 0.30 over 6 months)
    const anchor = getRecentAnchor(asset, targetDate);
    if (anchor) {
        const daysSince   = (targetDate - new Date(anchor.date)) / (1000 * 60 * 60 * 24);
        const anchorWeight = Math.max(0.30, 0.70 - (daysSince / 180) * 0.40);
        value = anchorWeight * anchor.price + (1 - anchorWeight) * value;
        value = Math.max(residualValue, value);
    }

    return Math.round(value);
}

/**
 * Returns {start, end, depreciation} for a given month/year.
 */
function getMonthlyDepreciation(asset, year, month) {
    const startDate = new Date(year, month - 1, 1);
    const endDate   = new Date(year, month, 1);
    const start     = calculateValue(asset, startDate);
    const end       = calculateValue(asset, endDate);
    return { start, end, depreciation: start - end };
}

/**
 * Generate monthly value points from purchase through projectionMonths ahead.
 */
function getProjectedValues(asset) {
    const purchaseDate = new Date(asset.purchaseDate);
    const endDate      = new Date();
    endDate.setMonth(endDate.getMonth() + CONFIG.projectionMonths);

    const points = [];
    const cursor = new Date(purchaseDate.getFullYear(), purchaseDate.getMonth(), 1);

    while (cursor <= endDate) {
        points.push({
            date:  new Date(cursor),
            value: calculateValue(asset, new Date(cursor))
        });
        cursor.setMonth(cursor.getMonth() + 1);
    }

    return points;
}

function getTotalPortfolioValue() {
    const now = new Date();
    return state.data.assets.reduce((sum, a) => sum + calculateValue(a, now), 0);
}

function getTotalPortfolioCost() {
    return state.data.assets.reduce((sum, a) => sum + getEffectivePrice(a), 0);
}

// ==============================
// 5. FORMATTING HELPERS
// ==============================

function formatEur(value, decimals = 0) {
    return new Intl.NumberFormat('es-ES', {
        style: 'currency', currency: 'EUR',
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
    }).format(value);
}

function formatPct(value, decimals = 1) {
    return (value >= 0 ? '+' : '') + value.toFixed(decimals) + '%';
}

function formatDate(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
}

function formatDateShort(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function monthsAgo(dateStr) {
    if (!dateStr) return null;
    const d     = new Date(dateStr);
    const now   = new Date();
    const diff  = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
    if (diff === 0) return 'este mes';
    if (diff === 1) return 'hace 1 mes';
    return `hace ${diff} meses`;
}

function depreciationClass(pct) {
    if (pct < 15) return 'low';
    if (pct < 35) return 'medium';
    return 'high';
}

// ==============================
// 6. NAVIGATION
// ==============================

function navigate(view, assetId = null) {
    state.view = view;
    state.selectedAssetId = assetId;

    // Destroy existing chart
    if (state.chartInstance) {
        state.chartInstance.destroy();
        state.chartInstance = null;
    }

    render();
}

// ==============================
// 7. RENDERING
// ==============================

function render() {
    const app = document.getElementById('app');

    switch (state.view) {
        case 'dashboard':  app.innerHTML = renderDashboard(); break;
        case 'detail':     app.innerHTML = renderDetail(state.selectedAssetId); break;
        case 'add-asset':  app.innerHTML = renderAssetForm(null); break;
        case 'edit-asset': app.innerHTML = renderAssetForm(state.selectedAssetId); break;
        case 'add-update': app.innerHTML = renderUpdateForm(state.selectedAssetId); break;
        case 'add-anchor': app.innerHTML = renderAnchorForm(state.selectedAssetId); break;
        default:           app.innerHTML = renderDashboard();
    }

    attachEventListeners();

    // Render chart after DOM is ready
    if (state.view === 'detail') {
        renderChart(state.selectedAssetId);
    }
}

// ---- Dashboard ----

function renderDashboard() {
    const assets = state.data.assets;

    if (assets.length === 0) {
        return `
        <div class="empty-state">
            <div class="empty-icon">◈</div>
            <div class="empty-title">Sin activos todavía</div>
            <div class="empty-desc">Añade tu primer activo para empezar a controlar su depreciación mensual.</div>
            <button class="btn btn-primary btn-lg" data-action="new-asset">+ Añadir primer activo</button>
        </div>`;
    }

    const now           = new Date();
    const totalValue    = getTotalPortfolioValue();
    const totalCost     = getTotalPortfolioCost();
    const totalDeprAmt  = totalCost - totalValue;
    const totalDeprPct  = totalCost > 0 ? (totalDeprAmt / totalCost) * 100 : 0;

    // Monthly depreciation of portfolio
    const firstOfMonth  = new Date(now.getFullYear(), now.getMonth(), 1);
    const prevMonth     = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const totalThisMonth = assets.reduce((sum, a) => {
        return sum + (calculateValue(a, firstOfMonth) - calculateValue(a, now));
    }, 0);

    const assetCards = assets.map(renderAssetCard).join('');

    return `
    <div class="dashboard-header">
        <div class="dashboard-title">Tu cartera de activos</div>
        <div class="dashboard-sub">Valoración en tiempo real con depreciación acelerada + mercado</div>
    </div>

    <div class="portfolio-summary">
        <div>
            <div class="portfolio-label">Valor total de la cartera</div>
            <div class="portfolio-value">${formatEur(totalValue)}</div>
            <div class="portfolio-meta">Coste original: ${formatEur(totalCost)}</div>
        </div>
        <div class="portfolio-stats">
            <div class="portfolio-stat">
                <div class="portfolio-stat-value">${formatEur(totalDeprAmt)}</div>
                <div class="portfolio-stat-label">Depreciado total</div>
            </div>
            <div class="portfolio-stat">
                <div class="portfolio-stat-value">${totalDeprPct.toFixed(1)}%</div>
                <div class="portfolio-stat-label">% depreciado</div>
            </div>
            <div class="portfolio-stat">
                <div class="portfolio-stat-value">${formatEur(Math.abs(totalThisMonth))}</div>
                <div class="portfolio-stat-label">Este mes</div>
            </div>
        </div>
    </div>

    <div class="assets-grid">
        ${assetCards}
    </div>`;
}

function renderAssetCard(asset) {
    const now         = new Date();
    const currentVal  = calculateValue(asset, now);
    const effectiveP  = getEffectivePrice(asset);
    const deprAmt     = effectiveP - currentVal;
    const deprPct     = effectiveP > 0 ? (deprAmt / effectiveP) * 100 : 0;

    const prevMonth   = new Date(now.getFullYear(), now.getMonth(), 1);
    const prevVal     = calculateValue(asset, prevMonth);
    const monthlyDepr = prevVal - currentVal;

    const update      = getLatestUpdate(asset, now);
    const cls         = depreciationClass(deprPct);

    return `
    <div class="asset-card" data-action="view-asset" data-id="${asset.id}">
        <div class="asset-card-header">
            <div class="asset-type-icon">${TYPE_ICONS[asset.type] || '◈'}</div>
            <div>
                <div class="asset-name">${escHtml(asset.name)}</div>
                <div class="asset-desc">${escHtml(asset.description || TYPE_LABELS[asset.type])}</div>
            </div>
        </div>
        <div class="asset-card-divider"></div>
        <div class="asset-card-body">
            <div class="asset-value-label">Valor actual</div>
            <div class="asset-value">${formatEur(currentVal)}</div>

            <div class="asset-metrics">
                <div class="asset-metric">
                    <div class="asset-metric-label">Depreciado</div>
                    <div class="asset-metric-value ${cls === 'high' ? 'danger' : cls === 'medium' ? 'warning' : 'success'}">
                        -${formatEur(deprAmt)} (${deprPct.toFixed(1)}%)
                    </div>
                </div>
                <div class="asset-metric">
                    <div class="asset-metric-label">Este mes</div>
                    <div class="asset-metric-value ${monthlyDepr > 0 ? 'danger' : 'success'}">
                        -${formatEur(monthlyDepr)}
                    </div>
                </div>
                ${update && update.km !== null && update.km !== undefined ? `
                <div class="asset-metric">
                    <div class="asset-metric-label">Kilómetros</div>
                    <div class="asset-metric-value">${Number(update.km).toLocaleString('es-ES')} km</div>
                </div>` : '<div class="asset-metric"><div class="asset-metric-label">Kilómetros</div><div class="asset-metric-value muted">—</div></div>'}
                ${update && update.batterySoh !== null && update.batterySoh !== undefined ? `
                <div class="asset-metric">
                    <div class="asset-metric-label">SOH Batería</div>
                    <div class="asset-metric-value ${update.batterySoh < 80 ? 'danger' : update.batterySoh < 90 ? 'warning' : 'success'}">${update.batterySoh}%</div>
                </div>` : '<div class="asset-metric"><div class="asset-metric-label">SOH Batería</div><div class="asset-metric-value muted">—</div></div>'}
            </div>
        </div>
        <div class="asset-card-footer">
            <div class="asset-last-update">
                ${update ? 'Actualizado ' + monthsAgo(update.date) : 'Sin actualizaciones'}
            </div>
            <div class="depr-pill ${cls}">
                ${cls === 'low' ? '▼ Bajo' : cls === 'medium' ? '▼ Medio' : '▼ Alto'}
            </div>
        </div>
    </div>`;
}

// ---- Asset Detail ----

function renderDetail(id) {
    const asset = getAssetById(id);
    if (!asset) return '<p>Activo no encontrado.</p>';

    const now         = new Date();
    const currentVal  = calculateValue(asset, now);
    const effectiveP  = getEffectivePrice(asset);
    const deprAmt     = effectiveP - currentVal;
    const deprPct     = effectiveP > 0 ? (deprAmt / effectiveP) * 100 : 0;

    // This month depreciation
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonth    = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const startOfMonth = calculateValue(asset, firstOfMonth);
    const endEstimate  = currentVal;
    const monthlyDepr  = startOfMonth - endEstimate;

    // Prev month
    const prevMonthStart = calculateValue(asset, lastMonth);
    const prevMonthEnd   = calculateValue(asset, firstOfMonth);
    const prevMonthDepr  = prevMonthStart - prevMonthEnd;

    const residualVal    = getResidualValue(asset);
    const update         = getLatestUpdate(asset, now);
    const anchor         = getRecentAnchor(asset, now);

    // Check if market anchor is due (> 5 months since last anchor)
    const lastAnchorDate = asset.marketAnchors && asset.marketAnchors.length > 0
        ? new Date(Math.max(...asset.marketAnchors.map(a => new Date(a.date))))
        : null;
    const anchorDueSoon  = !lastAnchorDate ||
        (now - lastAnchorDate) > (150 * 24 * 60 * 60 * 1000); // 5 months

    const updatesHtml    = renderUpdatesTable(asset);
    const anchorsHtml    = renderAnchorsTable(asset);

    return `
    <div class="detail-back" data-action="back">
        ← Volver a la cartera
    </div>

    <div class="detail-header">
        <div class="detail-title-group">
            <div class="detail-type-icon">${TYPE_ICONS[asset.type] || '◈'}</div>
            <div>
                <div class="detail-name">${escHtml(asset.name)}</div>
                <div class="detail-desc">${escHtml(asset.description || TYPE_LABELS[asset.type])} · Desde ${formatDate(asset.purchaseDate)}</div>
            </div>
        </div>
        <div class="detail-actions">
            <button class="btn btn-outline btn-sm" data-action="add-update" data-id="${asset.id}">↺ Actualizar valores</button>
            <button class="btn btn-outline btn-sm" data-action="add-anchor" data-id="${asset.id}">📊 Precio mercado</button>
            <button class="btn btn-outline btn-sm" data-action="edit-asset" data-id="${asset.id}">✎ Editar</button>
            <button class="btn btn-danger btn-sm" data-action="delete-asset" data-id="${asset.id}">✕</button>
        </div>
    </div>

    ${anchorDueSoon ? `
    <div class="anchor-alert">
        ⚠ Recuerda actualizar el precio de mercado cada 6 meses para mayor precisión.
        <button class="btn btn-sm btn-warning" style="margin-left:auto" data-action="add-anchor" data-id="${asset.id}">Actualizar ahora</button>
    </div>` : ''}

    <!-- MoneyWiz Box -->
    <div class="moneywiz-box">
        <div>
            <div class="moneywiz-label">Para MoneyWiz</div>
            <div class="moneywiz-title">Valor actual del activo</div>
            <div class="moneywiz-value">${formatEur(currentVal)}</div>
        </div>
        <div class="moneywiz-stats">
            <div class="moneywiz-stat">
                <div class="moneywiz-stat-value negative">-${formatEur(monthlyDepr)}</div>
                <div class="moneywiz-stat-label">Este mes</div>
            </div>
            <div class="moneywiz-stat">
                <div class="moneywiz-stat-value negative">-${formatEur(prevMonthDepr)}</div>
                <div class="moneywiz-stat-label">Mes anterior</div>
            </div>
            <div class="moneywiz-stat">
                <div class="moneywiz-stat-value negative">-${formatEur(deprAmt)}</div>
                <div class="moneywiz-stat-label">Total depreciado</div>
            </div>
        </div>
    </div>

    <!-- Chart + Metrics -->
    <div class="detail-grid">
        <div class="card">
            <div class="card-header">
                <div class="card-title">Evolución del valor</div>
                <div class="chart-scale-group">
                    <button class="chart-scale-btn${state.chartScale === '1Y'  ? ' active' : ''}" data-action="chart-scale" data-scale="1Y">1A</button>
                    <button class="chart-scale-btn${state.chartScale === '3Y'  ? ' active' : ''}" data-action="chart-scale" data-scale="3Y">3A</button>
                    <button class="chart-scale-btn${state.chartScale === '5Y'  ? ' active' : ''}" data-action="chart-scale" data-scale="5Y">5A</button>
                    <button class="chart-scale-btn${state.chartScale === '10Y' ? ' active' : ''}" data-action="chart-scale" data-scale="10Y">10A</button>
                    <button class="chart-scale-btn${state.chartScale === 'ALL' ? ' active' : ''}" data-action="chart-scale" data-scale="ALL">Todo</button>
                </div>
            </div>
            <div class="card-body">
                <div class="chart-container">
                    <canvas id="asset-chart"></canvas>
                </div>
            </div>
        </div>

        <div class="card">
            <div class="card-header">
                <div class="card-title">Métricas</div>
            </div>
            <div class="card-body" style="padding-top:8px;padding-bottom:8px">
                <div class="metrics-list">
                    <div class="metric-row">
                        <div class="metric-row-label">Precio de compra</div>
                        <div class="metric-row-value">${formatEur(asset.purchasePrice)}</div>
                    </div>
                    ${asset.subsidies > 0 ? `
                    <div class="metric-row">
                        <div class="metric-row-label">Subvenciones</div>
                        <div class="metric-row-value" style="color:var(--success)">-${formatEur(asset.subsidies)}</div>
                    </div>
                    <div class="metric-row">
                        <div class="metric-row-label">Precio efectivo</div>
                        <div class="metric-row-value">${formatEur(effectiveP)}</div>
                    </div>` : ''}
                    <div class="metric-row">
                        <div class="metric-row-label">Valor actual</div>
                        <div class="metric-row-value">${formatEur(currentVal)}</div>
                    </div>
                    <div class="metric-row">
                        <div class="metric-row-label">Depreciación</div>
                        <div class="metric-row-value" style="color:var(--danger)">-${deprPct.toFixed(1)}%</div>
                    </div>
                    <div class="metric-row">
                        <div class="metric-row-label">Valor residual</div>
                        <div class="metric-row-value">${formatEur(residualVal)} (${asset.residualValuePct}%)</div>
                    </div>
                    <div class="metric-row">
                        <div class="metric-row-label">Km actuales</div>
                        <div class="metric-row-value">${update && update.km !== null ? Number(update.km).toLocaleString('es-ES') + ' km' : '—'}</div>
                    </div>
                    <div class="metric-row">
                        <div class="metric-row-label">SOH Batería</div>
                        <div class="metric-row-value ${update && update.batterySoh < 80 ? 'danger' : ''}">${update && update.batterySoh !== null ? update.batterySoh + '%' : '—'}</div>
                    </div>
                    <div class="metric-row">
                        <div class="metric-row-label">Precio mercado</div>
                        <div class="metric-row-value">${anchor ? formatEur(anchor.price) + ' (' + formatDateShort(anchor.date) + ')' : '—'}</div>
                    </div>
                    <div class="metric-row">
                        <div class="metric-row-label">Km/año esperados</div>
                        <div class="metric-row-value muted">${Number(asset.expectedAnnualKm).toLocaleString('es-ES')} km</div>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <!-- Methodology Panel -->
    <details class="methodology-panel">
        <summary class="methodology-summary">
            <span class="methodology-icon">◈</span>
            <span>¿Cómo se calcula este valor?</span>
            <span class="methodology-chevron">›</span>
        </summary>
        <div class="methodology-body">
            <div class="methodology-grid">
                <div class="methodology-block">
                    <div class="methodology-block-title">1 · Curva de depreciación acelerada</div>
                    <div class="methodology-block-text">El precio efectivo (compra menos subvenciones) se deprecia año a año con tasas decrecientes: más rápido al principio, más lento con la edad.</div>
                    <table class="meth-table">
                        <thead><tr><th>Año</th><th>Coche EV</th><th>Ebike</th></tr></thead>
                        <tbody>
                            ${CONFIG.depreciationRates.car.map((r, i) => `<tr><td>${i + 1}</td><td>−${(r * 100).toFixed(0)}%</td><td>−${(CONFIG.depreciationRates.ebike[i] * 100).toFixed(0)}%</td></tr>`).join('')}
                        </tbody>
                    </table>
                </div>
                <div class="methodology-block">
                    <div class="methodology-block-title">2 · Factores de ajuste</div>
                    <div class="methodology-sub-title">SOH de batería</div>
                    <table class="meth-table">
                        <thead><tr><th>SOH</th><th>Factor</th></tr></thead>
                        <tbody>
                            <tr><td>≥ 90%</td><td>×1,00</td></tr>
                            <tr><td>80–89%</td><td>×0,95</td></tr>
                            <tr><td>70–79%</td><td>×0,88</td></tr>
                            <tr><td>60–69%</td><td>×0,78</td></tr>
                            <tr><td>&lt; 60%</td><td>×0,65</td></tr>
                        </tbody>
                    </table>
                    <div class="methodology-sub-title" style="margin-top:12px">Km reales vs. esperados</div>
                    <table class="meth-table">
                        <thead><tr><th>Ratio anual</th><th>Factor</th></tr></thead>
                        <tbody>
                            <tr><td>&gt; 2,0×</td><td>×0,88</td></tr>
                            <tr><td>1,5–2,0×</td><td>×0,93</td></tr>
                            <tr><td>1,2–1,5×</td><td>×0,97</td></tr>
                            <tr><td>0,7–1,2×</td><td>×1,00</td></tr>
                            <tr><td>0,5–0,7×</td><td>×1,02</td></tr>
                            <tr><td>&lt; 0,5×</td><td>×1,04</td></tr>
                        </tbody>
                    </table>
                </div>
                <div class="methodology-block">
                    <div class="methodology-block-title">3 · Anclaje al precio de mercado</div>
                    <div class="methodology-block-text">Cuando introduces un precio de mercado, se mezcla con el modelo teórico. El peso del mercado va del <strong>70%</strong> (el día que lo introduces) al <strong>30%</strong> (6 meses después), cuando el dato ya está "caducando".</div>
                    <div class="methodology-block-text" style="margin-top:8px"><strong>Metodología para buscar precios:</strong> busca 3–5 anuncios de activos similares (mismo tipo, año, km similares). Descarta los extremos. Usa la mediana. Fuentes: Wallapop, Coches.net, eBay Kleinanzeigen (ebikes).</div>
                    <div class="methodology-block-text" style="margin-top:8px">Actualiza cada <strong>6 meses</strong>. La app te avisará cuando sea el momento.</div>
                </div>
            </div>
        </div>
    </details>

    <!-- Updates history -->
    <div class="card" style="margin-bottom:20px">
        <div class="card-header">
            <div class="card-title">Historial de actualizaciones</div>
            <button class="btn btn-outline btn-sm" data-action="add-update" data-id="${asset.id}">+ Añadir</button>
        </div>
        <div class="card-body" style="padding:0">
            ${updatesHtml}
        </div>
    </div>

    <!-- Market anchors history -->
    <div class="card">
        <div class="card-header">
            <div class="card-title">Precios de mercado</div>
            <button class="btn btn-outline btn-sm" data-action="add-anchor" data-id="${asset.id}">+ Añadir</button>
        </div>
        <div class="card-body" style="padding:0">
            ${anchorsHtml}
        </div>
    </div>`;
}

function renderUpdatesTable(asset) {
    if (!asset.updates || asset.updates.length === 0) {
        return '<div class="history-empty">Sin actualizaciones registradas.</div>';
    }
    const sorted = [...asset.updates].sort((a, b) => new Date(b.date) - new Date(a.date));
    const rows = sorted.map(u => `
        <tr>
            <td>${formatDateShort(u.date)}</td>
            <td>${u.km !== null && u.km !== undefined ? Number(u.km).toLocaleString('es-ES') + ' km' : '—'}</td>
            <td>${u.batterySoh !== null && u.batterySoh !== undefined ? u.batterySoh + '%' : '—'}</td>
            <td>${escHtml(u.incidents || '—')}</td>
            <td>${escHtml(u.notes || '—')}</td>
        </tr>`).join('');
    return `
        <table class="history-table">
            <thead>
                <tr>
                    <th>Fecha</th>
                    <th>Km</th>
                    <th>SOH</th>
                    <th>Incidencias</th>
                    <th>Notas</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>`;
}

function renderAnchorsTable(asset) {
    if (!asset.marketAnchors || asset.marketAnchors.length === 0) {
        return '<div class="history-empty">Sin precios de mercado registrados.</div>';
    }
    const sorted = [...asset.marketAnchors].sort((a, b) => new Date(b.date) - new Date(a.date));
    const rows = sorted.map(a => {
        const refsHtml = a.refs && a.refs.length > 0 ? `
            <details class="refs-detail">
                <summary>${a.refs.length} referencia${a.refs.length > 1 ? 's' : ''} consultada${a.refs.length > 1 ? 's' : ''}</summary>
                <table class="refs-inner-table">
                    <thead><tr><th>Precio</th><th>Año</th><th>Km</th><th>Color</th><th>Fuente</th></tr></thead>
                    <tbody>
                        ${a.refs.map(r => `<tr>
                            <td><strong>${formatEur(r.price)}</strong></td>
                            <td>${r.year || '—'}</td>
                            <td>${r.km !== null && r.km !== undefined ? Number(r.km).toLocaleString('es-ES') + ' km' : '—'}</td>
                            <td>${escHtml(r.color || '—')}</td>
                            <td>${escHtml(r.source || '—')}</td>
                        </tr>`).join('')}
                    </tbody>
                </table>
            </details>` : '';
        return `
        <tr>
            <td>${formatDateShort(a.date)}</td>
            <td><strong>${formatEur(a.price)}</strong></td>
            <td>${escHtml(a.source || '—')}</td>
            <td>${escHtml(a.notes || '—')}${refsHtml}</td>
        </tr>`;
    }).join('');
    return `
        <table class="history-table">
            <thead>
                <tr>
                    <th>Fecha</th>
                    <th>Precio</th>
                    <th>Fuente</th>
                    <th>Notas / Referencias</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>`;
}

// ---- Asset Form (add/edit) ----

function renderAssetForm(id) {
    const asset   = id ? getAssetById(id) : null;
    const isEdit  = !!asset;
    const type    = asset ? asset.type : 'car';
    const sugPct  = CONFIG.suggestedResidualPct[type];
    const sugKm   = CONFIG.defaultAnnualKm[type];

    return `
    <div class="form-view">
        <div class="detail-back" data-action="back">← Volver</div>
        <div class="form-title">${isEdit ? 'Editar activo' : 'Nuevo activo'}</div>
        <div class="form-subtitle">${isEdit ? 'Modifica los parámetros del activo.' : 'Añade un nuevo activo a tu cartera.'}</div>

        <form id="asset-form">
            <input type="hidden" name="id" value="${asset ? asset.id : ''}">

            <div class="form-card">
                <div class="form-section-title">Identificación</div>

                <div class="form-group">
                    <label class="form-label">Tipo de activo</label>
                    <select class="form-select" name="type" id="asset-type-select">
                        <option value="car" ${type === 'car' ? 'selected' : ''}>🚗 Coche eléctrico</option>
                        <option value="ebike" ${type === 'ebike' ? 'selected' : ''}>🚲 Bici eléctrica</option>
                    </select>
                </div>

                <div class="form-group">
                    <label class="form-label">Nombre</label>
                    <input class="form-input" name="name" type="text" placeholder="Ej: BYD Dolphin Surf" value="${asset ? escHtml(asset.name) : ''}" required>
                </div>

                <div class="form-group">
                    <label class="form-label">Descripción <span style="font-weight:400;color:var(--text-muted)">(opcional)</span></label>
                    <input class="form-input" name="description" type="text" placeholder="Ej: Boost · Azul Cielo" value="${asset ? escHtml(asset.description || '') : ''}">
                </div>
            </div>

            <div class="form-card">
                <div class="form-section-title">Adquisición</div>

                <div class="form-row">
                    <div class="form-group">
                        <label class="form-label">Fecha de compra</label>
                        <input class="form-input" name="purchaseDate" type="date" value="${asset ? asset.purchaseDate : ''}" required>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Precio de compra (€)</label>
                        <input class="form-input" name="purchasePrice" type="number" min="0" step="1" placeholder="23690" value="${asset ? asset.purchasePrice : ''}" required>
                    </div>
                </div>

                <div class="form-group">
                    <label class="form-label">Subvenciones recibidas (€) <span style="font-weight:400;color:var(--text-muted)">— reduce el precio efectivo</span></label>
                    <input class="form-input" name="subsidies" type="number" min="0" step="1" placeholder="0" value="${asset ? (asset.subsidies || 0) : 0}">
                    <div class="form-hint">Si aún no has recibido las ayudas, déjalo en 0 y actualiza cuando lleguen.</div>
                </div>
            </div>

            <div class="form-card">
                <div class="form-section-title">Parámetros de depreciación</div>

                <div class="form-group">
                    <label class="form-label">
                        Valor residual (% del precio efectivo)
                        <span class="suggested-badge" id="suggest-residual">Sugerido: ${sugPct}%</span>
                    </label>
                    <input class="form-input" name="residualValuePct" id="residual-input" type="number" min="1" max="50" step="1"
                        value="${asset ? asset.residualValuePct : sugPct}" required>
                    <div class="form-hint">Valor mínimo estimado al final de la vida útil. El algoritmo sugiere <strong>${sugPct}%</strong> para este tipo de activo.</div>
                </div>

                <div class="form-group">
                    <label class="form-label">
                        Kilómetros anuales esperados
                        <span class="suggested-badge" id="suggest-km">Sugerido: ${sugKm.toLocaleString('es-ES')}</span>
                    </label>
                    <input class="form-input" name="expectedAnnualKm" id="km-input" type="number" min="100" step="100"
                        value="${asset ? asset.expectedAnnualKm : sugKm}" required>
                    <div class="form-hint">Sirve para ajustar la depreciación según el uso real. Más km = más depreciación.</div>
                </div>
            </div>

            <div class="form-card">
                <div class="form-section-title">Estado inicial</div>

                <div class="form-row">
                    <div class="form-group">
                        <label class="form-label">Kilómetros actuales</label>
                        <input class="form-input" name="initKm" type="number" min="0" step="1" placeholder="0"
                            value="${asset && asset.updates && asset.updates.length > 0 ? asset.updates[0].km : ''}">
                    </div>
                    <div class="form-group">
                        <label class="form-label">SOH Batería (%)</label>
                        <input class="form-input" name="initSoh" type="number" min="0" max="100" step="1" placeholder="100"
                            value="${asset && asset.updates && asset.updates.length > 0 ? asset.updates[0].batterySoh : 100}">
                        <div class="form-hint">100% si el activo es nuevo.</div>
                    </div>
                </div>

                <div class="form-group">
                    <label class="form-label">Notas <span style="font-weight:400;color:var(--text-muted)">(opcional)</span></label>
                    <input class="form-input" name="notes" type="text" placeholder="Cualquier observación relevante" value="${asset ? escHtml(asset.notes || '') : ''}">
                </div>
            </div>

            <div class="form-actions">
                <button type="button" class="btn btn-outline" data-action="back">Cancelar</button>
                <button type="submit" class="btn btn-primary">${isEdit ? 'Guardar cambios' : 'Añadir activo'}</button>
            </div>
        </form>
    </div>`;
}

// ---- Update Form ----

function renderUpdateForm(id) {
    const asset = getAssetById(id);
    if (!asset) return '<p>Activo no encontrado.</p>';
    const today = new Date().toISOString().split('T')[0];

    return `
    <div class="form-view">
        <div class="detail-back" data-action="back">← Volver</div>
        <div class="form-title">Actualizar valores</div>
        <div class="form-subtitle">${escHtml(asset.name)} · ${formatDate(today)}</div>

        <form id="update-form">
            <input type="hidden" name="assetId" value="${asset.id}">
            <div class="form-card">
                <div class="form-group">
                    <label class="form-label">Fecha de la actualización</label>
                    <input class="form-input" name="date" type="date" value="${today}" required>
                </div>

                <div class="form-row">
                    <div class="form-group">
                        <label class="form-label">Kilómetros actuales</label>
                        <input class="form-input" name="km" type="number" min="0" step="1" placeholder="0" required>
                    </div>
                    <div class="form-group">
                        <label class="form-label">SOH Batería (%)</label>
                        <input class="form-input" name="batterySoh" type="number" min="0" max="100" step="1" placeholder="100" required>
                        <div class="form-hint">Consulta el indicador en la app del fabricante (BYD / Bosch eBike Connect).</div>
                    </div>
                </div>

                <div class="form-group">
                    <label class="form-label">Incidencias / reparaciones <span style="font-weight:400;color:var(--text-muted)">(opcional)</span></label>
                    <input class="form-input" name="incidents" type="text" placeholder="Ej: Cambio de neumáticos, golpe lateral...">
                </div>

                <div class="form-group">
                    <label class="form-label">Notas <span style="font-weight:400;color:var(--text-muted)">(opcional)</span></label>
                    <input class="form-input" name="notes" type="text" placeholder="Cualquier observación">
                </div>
            </div>

            <div class="form-actions">
                <button type="button" class="btn btn-outline" data-action="back">Cancelar</button>
                <button type="submit" class="btn btn-primary">Guardar actualización</button>
            </div>
        </form>
    </div>`;
}

// ---- Anchor Form ----

function renderAnchorForm(id) {
    const asset = getAssetById(id);
    if (!asset) return '<p>Activo no encontrado.</p>';
    const today = new Date().toISOString().split('T')[0];

    return `
    <div class="form-view">
        <div class="detail-back" data-action="back">← Volver</div>
        <div class="form-title">Precio de mercado</div>
        <div class="form-subtitle">${escHtml(asset.name)} · Actualiza el valor real cada 6 meses</div>

        <form id="anchor-form">
            <input type="hidden" name="assetId" value="${asset.id}">

            <div class="form-card">
                <div class="form-section-title">Referencias encontradas</div>
                <div class="form-hint" style="margin-bottom:12px">
                    Añade los anuncios que hayas consultado (3–5 idealmente). Descarta los extremos y usa la mediana como precio final.
                    Busca activos similares: mismo tipo, año parecido, km similares, mismo color si es posible.
                    <strong>Anuncios de profesionales suelen estar 5–10% por encima del precio real de mercado privado.</strong>
                </div>

                <div id="refs-container" class="refs-container"></div>

                <button type="button" id="add-ref-btn" class="btn btn-outline btn-sm" style="margin-bottom:16px">
                    + Añadir referencia
                </button>

                <div id="ref-summary" class="ref-summary" style="display:none">
                    <div class="ref-summary-row">
                        <span class="ref-summary-label">Mediana calculada</span>
                        <span class="ref-summary-value" id="ref-median-val">—</span>
                        <button type="button" id="use-median-btn" class="btn btn-sm btn-outline">Usar este valor ↓</button>
                    </div>
                </div>
            </div>

            <div class="form-card">
                <div class="form-section-title">Precio confirmado</div>

                <div class="form-group">
                    <label class="form-label">Fecha de consulta</label>
                    <input class="form-input" name="date" type="date" value="${today}" required>
                </div>

                <div class="form-group">
                    <label class="form-label">Precio de mercado (€) <span style="font-weight:400;color:var(--text-muted)">— mediana ajustada</span></label>
                    <input class="form-input" name="price" id="anchor-price-input" type="number" min="0" step="100" placeholder="Ej: 21400" required>
                    <div class="form-hint">Precio al que se venden activos similares al tuyo. Ajusta si tu activo tiene características que justifiquen diferencia (color, km, versión).</div>
                </div>

                <div class="form-group">
                    <label class="form-label">Fuente principal</label>
                    <select class="form-select" name="source">
                        <option value="Wallapop">Wallapop</option>
                        <option value="Coches.net">Coches.net</option>
                        <option value="eBay Kleinanzeigen">eBay Kleinanzeigen</option>
                        <option value="Milanuncios">Milanuncios</option>
                        <option value="Concesionario">Concesionario / Profesional</option>
                        <option value="Motor.es">Motor.es</option>
                        <option value="Otra">Otra</option>
                    </select>
                </div>

                <div class="form-group">
                    <label class="form-label">Notas <span style="font-weight:400;color:var(--text-muted)">(opcional)</span></label>
                    <input class="form-input" name="notes" type="text" placeholder="Ej: 2 anuncios de profesionales, color similar, km comparables">
                </div>
            </div>

            <div class="form-actions">
                <button type="button" class="btn btn-outline" data-action="back">Cancelar</button>
                <button type="submit" class="btn btn-primary">Guardar precio de mercado</button>
            </div>
        </form>
    </div>`;
}

// ---- Anchor Ref Helpers ----

function addAnchorRefRow(defaults = {}) {
    const container = document.getElementById('refs-container');
    if (!container) return;

    const row = document.createElement('div');
    row.className = 'ref-row';
    row.innerHTML = `
        <input class="form-input ref-price" type="number" min="0" step="100" placeholder="Precio €" value="${defaults.price || ''}" style="width:110px">
        <input class="form-input ref-year"  type="number" min="2000" max="2035" placeholder="Año" value="${defaults.year || ''}" style="width:74px">
        <input class="form-input ref-km"    type="number" min="0" step="1" placeholder="Km" value="${defaults.km || ''}" style="width:90px">
        <input class="form-input ref-color" type="text" placeholder="Color" value="${defaults.color || ''}" style="width:110px">
        <input class="form-input ref-src"   type="text" placeholder="Fuente" value="${defaults.source || ''}" style="width:130px">
        <button type="button" class="btn btn-sm btn-danger remove-ref" title="Eliminar">✕</button>
    `;
    container.appendChild(row);
    updateAnchorMedian();
}

function updateAnchorMedian() {
    const prices = [];
    document.querySelectorAll('.ref-row .ref-price').forEach(inp => {
        const v = Number(inp.value);
        if (v > 0) prices.push(v);
    });

    const summaryEl = document.getElementById('ref-summary');
    const medianEl  = document.getElementById('ref-median-val');
    if (!summaryEl || !medianEl) return;

    if (prices.length === 0) {
        summaryEl.style.display = 'none';
        return;
    }

    prices.sort((a, b) => a - b);
    const mid    = Math.floor(prices.length / 2);
    const median = prices.length % 2 !== 0
        ? prices[mid]
        : Math.round((prices[mid - 1] + prices[mid]) / 2);

    medianEl.textContent   = formatEur(median);
    medianEl.dataset.raw   = median;
    summaryEl.style.display = 'flex';
}

// ---- Chart ----

function renderChart(id) {
    const asset  = getAssetById(id);
    if (!asset) return;

    const canvas = document.getElementById('asset-chart');
    if (!canvas) return;

    const allPoints    = getProjectedValues(asset);
    const purchaseDate = new Date(asset.purchaseDate);
    const scale        = state.chartScale;

    // Filter points to selected scale (always starting from purchase date)
    let points = allPoints;
    if (scale !== 'ALL') {
        const years   = scale === '1Y' ? 1 : scale === '3Y' ? 3 : scale === '5Y' ? 5 : 10;
        const endDate = new Date(purchaseDate);
        endDate.setFullYear(endDate.getFullYear() + years);
        points = allPoints.filter(p => p.date <= endDate);
        if (points.length === 0) points = allPoints; // fallback
    }

    const now      = new Date();
    const today    = new Date(now.getFullYear(), now.getMonth(), 1);

    const labels   = points.map(p => {
        const d = p.date;
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    });

    const pastValues   = points.map(p => p.date <= today ? p.value : null);
    const futureValues = points.map(p => p.date >= today ? p.value : null);

    // Market anchors
    const anchorPoints = (asset.marketAnchors || []).map(a => {
        const d   = new Date(a.date);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const idx = labels.indexOf(key);
        return { x: idx, y: a.price, label: a.source };
    }).filter(p => p.x >= 0);

    const residualVal  = getResidualValue(asset);
    const residualLine = points.map(() => residualVal);

    if (state.chartInstance) state.chartInstance.destroy();

    state.chartInstance = new Chart(canvas, {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: 'Valor histórico',
                    data: pastValues,
                    borderColor: '#4F46E5',
                    backgroundColor: 'rgba(79,70,229,0.08)',
                    borderWidth: 2.5,
                    fill: true,
                    tension: 0.3,
                    pointRadius: 0,
                    pointHoverRadius: 4
                },
                {
                    label: 'Proyección futura',
                    data: futureValues,
                    borderColor: '#4F46E5',
                    borderWidth: 2,
                    borderDash: [6, 4],
                    fill: false,
                    tension: 0.3,
                    pointRadius: 0,
                    pointHoverRadius: 4
                },
                {
                    label: 'Valor residual',
                    data: residualLine,
                    borderColor: '#94A3B8',
                    borderWidth: 1.5,
                    borderDash: [3, 3],
                    fill: false,
                    pointRadius: 0,
                    tension: 0
                },
                ...(anchorPoints.length > 0 ? [{
                    label: 'Precio de mercado',
                    data: labels.map((_, i) => {
                        const a = anchorPoints.find(p => p.x === i);
                        return a ? a.y : null;
                    }),
                    borderColor: '#D97706',
                    backgroundColor: '#D97706',
                    borderWidth: 0,
                    pointRadius: 6,
                    pointHoverRadius: 8,
                    showLine: false
                }] : [])
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: {
                    display: true,
                    position: 'bottom',
                    labels: {
                        font: { size: 12 },
                        color: '#64748B',
                        boxWidth: 16,
                        padding: 12
                    }
                },
                tooltip: {
                    callbacks: {
                        label: ctx => {
                            if (ctx.raw === null) return null;
                            return ` ${ctx.dataset.label}: ${formatEur(ctx.raw)}`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    ticks: {
                        maxTicksLimit: 8,
                        font: { size: 11 },
                        color: '#94A3B8',
                        maxRotation: 0
                    },
                    grid: { color: '#F1F5F9' }
                },
                y: {
                    ticks: {
                        font: { size: 11 },
                        color: '#94A3B8',
                        callback: v => formatEur(v)
                    },
                    grid: { color: '#F1F5F9' }
                }
            }
        }
    });
}

// ==============================
// 8. EVENT LISTENERS
// ==============================

function attachEventListeners() {
    // Delegated click handler
    document.getElementById('app').addEventListener('click', handleAppClick);

    // Forms
    const assetForm  = document.getElementById('asset-form');
    const updateForm = document.getElementById('update-form');
    const anchorForm = document.getElementById('anchor-form');

    if (assetForm)  assetForm.addEventListener('submit', handleSaveAsset);
    if (updateForm) updateForm.addEventListener('submit', handleSaveUpdate);
    if (anchorForm) anchorForm.addEventListener('submit', handleSaveAnchor);

    // Anchor refs: dynamic rows
    const addRefBtn = document.getElementById('add-ref-btn');
    if (addRefBtn) {
        addRefBtn.addEventListener('click', () => addAnchorRefRow());
    }
    const refsContainer = document.getElementById('refs-container');
    if (refsContainer) {
        refsContainer.addEventListener('click', e => {
            if (e.target.classList.contains('remove-ref')) {
                e.target.closest('.ref-row').remove();
                updateAnchorMedian();
            }
        });
        refsContainer.addEventListener('input', e => {
            if (e.target.classList.contains('ref-price')) updateAnchorMedian();
        });
    }
    const useMedianBtn = document.getElementById('use-median-btn');
    if (useMedianBtn) {
        useMedianBtn.addEventListener('click', () => {
            const medianEl = document.getElementById('ref-median-val');
            const priceInput = document.getElementById('anchor-price-input');
            if (medianEl && priceInput) {
                const val = medianEl.dataset.raw;
                if (val) priceInput.value = val;
            }
        });
    }

    // Type select → update suggestions
    const typeSelect = document.getElementById('asset-type-select');
    if (typeSelect) {
        typeSelect.addEventListener('change', () => {
            const t    = typeSelect.value;
            const sugR = document.getElementById('suggest-residual');
            const sugK = document.getElementById('suggest-km');
            if (sugR) sugR.textContent = `Sugerido: ${CONFIG.suggestedResidualPct[t]}%`;
            if (sugK) sugK.textContent = `Sugerido: ${CONFIG.defaultAnnualKm[t].toLocaleString('es-ES')}`;
        });
    }

    // Suggested badges → fill input
    const suggestResidual = document.getElementById('suggest-residual');
    const suggestKm       = document.getElementById('suggest-km');
    const residualInput   = document.getElementById('residual-input');
    const kmInput         = document.getElementById('km-input');

    if (suggestResidual && residualInput) {
        suggestResidual.addEventListener('click', () => {
            const t = document.getElementById('asset-type-select').value;
            residualInput.value = CONFIG.suggestedResidualPct[t];
        });
    }
    if (suggestKm && kmInput) {
        suggestKm.addEventListener('click', () => {
            const t = document.getElementById('asset-type-select').value;
            kmInput.value = CONFIG.defaultAnnualKm[t];
        });
    }
}

function handleAppClick(e) {
    const el = e.target.closest('[data-action]');
    if (!el) return;

    const action = el.dataset.action;
    const id     = el.dataset.id;

    switch (action) {
        case 'new-asset':   navigate('add-asset'); break;
        case 'view-asset':  navigate('detail', id); break;
        case 'edit-asset':  navigate('edit-asset', id); break;
        case 'add-update':  navigate('add-update', id); break;
        case 'add-anchor':  navigate('add-anchor', id); break;
        case 'delete-asset': handleDeleteAsset(id); break;
        case 'back':        handleBack(); break;
        case 'chart-scale':
            state.chartScale = el.dataset.scale;
            document.querySelectorAll('.chart-scale-btn').forEach(b => {
                b.classList.toggle('active', b.dataset.scale === state.chartScale);
            });
            renderChart(state.selectedAssetId);
            break;
    }
}

function handleBack() {
    if (state.view === 'detail' || state.view === 'add-asset') {
        navigate('dashboard');
    } else if (state.view === 'edit-asset' || state.view === 'add-update' || state.view === 'add-anchor') {
        navigate('detail', state.selectedAssetId);
    } else {
        navigate('dashboard');
    }
}

function handleSaveAsset(e) {
    e.preventDefault();
    const fd = new FormData(e.target);

    const id = fd.get('id');
    const isEdit = !!id;

    const type = fd.get('type');
    const initKm  = fd.get('initKm')  !== '' ? Number(fd.get('initKm'))  : null;
    const initSoh = fd.get('initSoh') !== '' ? Number(fd.get('initSoh')) : 100;

    const assetData = {
        id:               isEdit ? id : generateId(),
        name:             fd.get('name').trim(),
        description:      fd.get('description').trim(),
        type,
        purchaseDate:     fd.get('purchaseDate'),
        purchasePrice:    Number(fd.get('purchasePrice')),
        subsidies:        Number(fd.get('subsidies')) || 0,
        residualValuePct: Number(fd.get('residualValuePct')),
        expectedAnnualKm: Number(fd.get('expectedAnnualKm')),
        notes:            fd.get('notes').trim(),
        updates:          [],
        marketAnchors:    []
    };

    if (isEdit) {
        const existing = getAssetById(id);
        assetData.updates      = existing.updates      || [];
        assetData.marketAnchors = existing.marketAnchors || [];
    } else {
        // Add initial update with km and SOH at purchase date
        assetData.updates.push({
            date:       assetData.purchaseDate,
            km:         initKm !== null ? initKm : 0,
            batterySoh: initSoh,
            incidents:  '',
            notes:      'Registro inicial'
        });
    }

    if (isEdit) {
        const idx = state.data.assets.findIndex(a => a.id === id);
        if (idx >= 0) state.data.assets[idx] = assetData;
    } else {
        state.data.assets.push(assetData);
    }

    saveData();
    showToast(isEdit ? 'Activo actualizado.' : 'Activo añadido correctamente.', 'success');
    navigate('detail', assetData.id);
}

function handleSaveUpdate(e) {
    e.preventDefault();
    const fd      = new FormData(e.target);
    const assetId = fd.get('assetId');
    const asset   = getAssetById(assetId);
    if (!asset) return;

    const update = {
        date:       fd.get('date'),
        km:         fd.get('km') !== '' ? Number(fd.get('km')) : null,
        batterySoh: fd.get('batterySoh') !== '' ? Number(fd.get('batterySoh')) : null,
        incidents:  fd.get('incidents').trim(),
        notes:      fd.get('notes').trim()
    };

    asset.updates.push(update);
    saveData();
    showToast('Valores actualizados.', 'success');
    navigate('detail', assetId);
}

function handleSaveAnchor(e) {
    e.preventDefault();
    const fd      = new FormData(e.target);
    const assetId = fd.get('assetId');
    const asset   = getAssetById(assetId);
    if (!asset) return;

    // Collect refs from DOM
    const refs = [];
    document.querySelectorAll('.ref-row').forEach(row => {
        const price = Number(row.querySelector('.ref-price').value);
        const km    = row.querySelector('.ref-km').value;
        const color = row.querySelector('.ref-color').value.trim();
        const year  = row.querySelector('.ref-year').value;
        const src   = row.querySelector('.ref-src').value.trim();
        if (price > 0) {
            refs.push({ price, km: km ? Number(km) : null, color: color || null, year: year ? Number(year) : null, source: src || null });
        }
    });

    const anchor = {
        date:   fd.get('date'),
        price:  Number(fd.get('price')),
        source: fd.get('source'),
        notes:  fd.get('notes').trim(),
        refs:   refs.length > 0 ? refs : undefined
    };

    asset.marketAnchors.push(anchor);
    saveData();
    showToast('Precio de mercado guardado.', 'success');
    navigate('detail', assetId);
}

function handleDeleteAsset(id) {
    const asset = getAssetById(id);
    if (!asset) return;
    if (!confirm(`¿Eliminar "${asset.name}" y todos sus datos? Esta acción no se puede deshacer.`)) return;
    state.data.assets = state.data.assets.filter(a => a.id !== id);
    saveData();
    showToast('Activo eliminado.', 'success');
    navigate('dashboard');
}

// ==============================
// 9. TOAST
// ==============================

let toastTimer = null;

function showToast(msg, type = '') {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = msg;
    toast.className = `toast show ${type}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        toast.className = 'toast';
    }, 3500);
}

// ==============================
// 10. SECURITY HELPER
// ==============================

function escHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// ==============================
// 11. INITIALIZATION
// ==============================

function init() {
    loadData();

    // Header buttons
    document.getElementById('btn-new-asset').addEventListener('click', () => navigate('add-asset'));
    document.getElementById('btn-export').addEventListener('click', exportJSON);
    document.getElementById('btn-import').addEventListener('click', () => {
        document.getElementById('file-input').click();
    });
    document.getElementById('file-input').addEventListener('change', (e) => {
        if (e.target.files[0]) importJSON(e.target.files[0]);
        e.target.value = '';
    });

    // Initial render
    render();

    // If data exists, show import reminder if it came from localStorage (not fresh import)
    if (state.data.assets.length > 0 && !state.data._justImported) {
        // Silently fine — data loaded from localStorage
    }
}

document.addEventListener('DOMContentLoaded', init);
