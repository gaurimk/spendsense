/**
 * SpendSense - Insights Dashboard Module (ES Module)
 * Fetches analytics, renders KPI metric cards, Chart.js category donut chart,
 * monthly trendline chart, and top merchants/items rankings.
 */

import { apiRequest } from './api.js';
import { formatCurrency, escapeHtml, showToast } from './utils.js';
import { getIcon } from './icons.js';
import { getCurrentFirebaseUser } from './firebase-auth.js';
import { getBillsFromFirestore, computeInsightsFromBills } from './firebase-firestore.js';

let categoryChartInstance = null;
let trendChartInstance = null;
let lastInsightsData = null;

// Listen for theme change to update charts dynamically
window.addEventListener('themechanged', () => {
    if (lastInsightsData) {
        initDonutChart(lastInsightsData.category_donut || {});
        initTrendChart(lastInsightsData.monthly_trend || {});
    }
});

// Listen for workspace mode change to adapt insights metrics dynamically
window.addEventListener('modechanged', () => {
    const screenInsights = document.getElementById('screenInsights');
    if (screenInsights && screenInsights.classList.contains('active') && lastInsightsData) {
        renderInsightsDashboard(lastInsightsData);
    }
});

export async function loadInsightsDashboard() {
    const container = document.getElementById('screenInsights');
    if (!container) return;

    // Loading Skeleton UI
    container.innerHTML = `
        <div class="insights-container" style="padding: 1.25rem; max-width: 1100px; margin: 0 auto; width: 100%;">
            <div class="skeleton-box" style="height: 36px; width: 240px; margin-bottom: 1.5rem;"></div>
            <div class="kpi-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 1rem; margin-bottom: 1.5rem;">
                <div class="skeleton-box" style="height: 110px;"></div>
                <div class="skeleton-box" style="height: 110px;"></div>
                <div class="skeleton-box" style="height: 110px;"></div>
                <div class="skeleton-box" style="height: 110px;"></div>
            </div>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 1.25rem; margin-bottom: 1.5rem;">
                <div class="skeleton-box" style="height: 300px;"></div>
                <div class="skeleton-box" style="height: 300px;"></div>
            </div>
        </div>
    `;

    try {
        let data = null;
        const fbUser = getCurrentFirebaseUser();
        if (fbUser && fbUser.uid) {
            const fbBills = await getBillsFromFirestore(fbUser.uid);
            data = computeInsightsFromBills(fbBills);
        } else {
            data = await apiRequest('/api/insights/summary');
        }
        lastInsightsData = data;
        renderInsightsDashboard(data);
    } catch (err) {
        console.error('Failed to load insights:', err);
        container.innerHTML = `
            <div style="padding: 3rem 1rem; text-align: center; color: var(--color-text-muted);">
                <div style="color: var(--color-danger); margin-bottom: 0.75rem; display: flex; justify-content: center;">
                    ${getIcon('alert-triangle', { size: 36 })}
                </div>
                <h3 style="color: var(--color-text); font-size: 1.15rem; font-weight: 700;">Unable to load insights</h3>
                <p style="margin: 0.35rem 0 1.25rem; color: var(--color-danger); font-size: 0.88rem;">${escapeHtml(err.message || 'Error fetching data')}</p>
                <button class="btn btn-secondary" onclick="window.loadInsights()" type="button" style="display: inline-flex; align-items: center; gap: 0.35rem; margin: 0 auto;">
                    ${getIcon('refresh-cw', { size: 14 })} Retry
                </button>
            </div>
        `;
    }
}

function renderInsightsDashboard(data) {
    const container = document.getElementById('screenInsights');
    if (!container) return;

    const thisMonth = data.this_month || {};
    const lastMonth = data.last_month || {};
    const comp = data.comparison || {};
    const donut = data.category_donut || {};
    const trend = data.monthly_trend || {};
    const busiest = data.busiest_day || {};
    const topMerchants = data.top_merchants || [];
    const topItems = data.top_items || [];
    const comm = data.commercial_summary || {};

    const activeMode = localStorage.getItem('spendsense_active_mode') || 'personal';
    const isBusiness = activeMode === 'business' || activeMode === 'shop';

    // Empty state if no data recorded at all
    if (!thisMonth.spent && !lastMonth.spent && topMerchants.length === 0) {
        container.innerHTML = `
            <div style="padding: 3.5rem 1rem; text-align: center; max-width: 500px; margin: 0 auto;">
                <div style="color: var(--color-primary); margin-bottom: 0.75rem; display: flex; justify-content: center;">
                    ${getIcon('bar-chart-3', { size: 44 })}
                </div>
                <h3 style="color: var(--color-text); font-size: 1.2rem; font-weight: 700;">No spending records yet</h3>
                <p style="color: var(--color-text-muted); font-size: 0.88rem; margin: 0.4rem 0 1.5rem; line-height: 1.5;">
                    Upload your first receipt in Chat or load the 3-month demo dataset from Settings to view automated category breakdown and charts.
                </p>
                <div style="display: flex; gap: 0.75rem; justify-content: center;">
                    <button class="btn btn-primary" onclick="window.switchTab('screenChat')" type="button" style="display: inline-flex; align-items: center; gap: 0.35rem;">
                        ${getIcon('message-square', { size: 14 })} Go to Chat
                    </button>
                    <button class="btn btn-secondary" onclick="window.switchTab('screenSettings')" type="button" style="display: inline-flex; align-items: center; gap: 0.35rem;">
                        ${getIcon('settings', { size: 14 })} Settings
                    </button>
                </div>
            </div>
        `;
        return;
    }

    const isTrendUp = comp.difference > 0;
    const isTrendDown = comp.difference < 0;
    const trendClass = isTrendUp ? 'up' : (isTrendDown ? 'down' : '');
    const trendIconSvg = isTrendUp 
        ? getIcon('arrow-up', { size: 13 }) 
        : (isTrendDown ? getIcon('arrow-down', { size: 13 }) : '');
    const trendSign = isTrendUp ? '+' : '';

    const taxableVal = comm.taxable_value || (Number(thisMonth.spent || 0) * 0.9);
    const gstPaid = comm.total_tax || (Number(thisMonth.spent || 0) * 0.1);
    const grossVal = comm.gross_total || Number(thisMonth.spent || 0);

    const gstSummaryCardHtml = isBusiness ? `
        <!-- Commercial GST & Input Tax Credit (ITC) Summary Box -->
        <div class="gst-summary-card">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 0.5rem;">
                <div>
                    <div style="display: flex; align-items: center; gap: 0.4rem; font-weight: 700; font-size: 1.05rem; color: var(--color-text);">
                        <span style="color: var(--color-primary); display: flex;">${getIcon('receipt', { size: 18 })}</span>
                        GST & Input Tax Credit (ITC) Summary
                    </div>
                    <p style="font-size: 0.8rem; color: var(--color-text-muted); margin-top: 0.2rem;">
                        Input tax breakdown from recorded supplier invoices eligible for monthly return filing (GSTR-2B / GSTR-3B)
                    </p>
                </div>
                <button class="btn btn-secondary" onclick="window.open('/api/export/csv?type=gst', '_blank')" type="button" style="font-size: 0.75rem; padding: 0.3rem 0.65rem; display: inline-flex; align-items: center; gap: 0.25rem;">
                    ${getIcon('download', { size: 12 })} Export GST ITC Register
                </button>
            </div>
            <div class="gst-metrics-row">
                <div class="gst-metric-item">
                    <span class="gst-metric-label">Taxable Purchases</span>
                    <span class="gst-metric-val tabular-nums">${formatCurrency(Number(taxableVal))}</span>
                </div>
                <div class="gst-metric-item">
                    <span class="gst-metric-label">GST Tax Paid (Eligible ITC)</span>
                    <span class="gst-metric-val tabular-nums" style="color: #059669;">${formatCurrency(Number(gstPaid))}</span>
                </div>
                <div class="gst-metric-item">
                    <span class="gst-metric-label">Gross Purchases Outflow</span>
                    <span class="gst-metric-val tabular-nums">${formatCurrency(Number(grossVal))}</span>
                </div>
            </div>
        </div>
    ` : '';

    container.innerHTML = `
        <div class="insights-container" style="padding: 1.25rem; overflow-y: auto; max-width: 1100px; margin: 0 auto; width: 100%;">
            <!-- Header -->
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.25rem; flex-wrap: wrap; gap: 0.5rem;">
                <div>
                    <h2 style="font-size: 1.4rem; font-weight: 700; display: flex; align-items: center; gap: 0.5rem;">
                        <span style="color: var(--color-primary); display: flex;">${getIcon('bar-chart-3', { size: 22 })}</span>
                        ${isBusiness ? 'Commercial Insights & Outflow' : 'Spending Insights'}
                    </h2>
                    <p style="color: var(--color-text-muted); font-size: 0.88rem; margin-top: 0.2rem;">
                        ${isBusiness ? `Commercial Purchases & ITC for ${escapeHtml(thisMonth.label || 'Current Month')}` : `Overview for ${escapeHtml(thisMonth.label || 'Current Month')}`}
                    </p>
                </div>
                <button class="btn btn-secondary" id="btnRefreshInsights" type="button" style="font-size: 0.8rem; padding: 0.35rem 0.75rem; display: inline-flex; align-items: center; gap: 0.35rem;">
                    ${getIcon('refresh-cw', { size: 13 })} Refresh
                </button>
            </div>

            ${gstSummaryCardHtml}

            <!-- KPI Cards Row -->
            <div class="kpi-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 1rem; margin-bottom: 1.5rem;">
                <!-- Total This Month -->
                <div class="kpi-card" style="background: var(--color-surface-card); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 1.1rem; display: flex; flex-direction: column; justify-content: space-between;">
                    <div>
                        <div style="color: var(--color-text-muted); font-size: 0.78rem; text-transform: uppercase; font-weight: 600; letter-spacing: 0.05em;">
                            ${isBusiness ? 'Commercial Outflow (This Month)' : 'Total Spend (This Month)'}
                        </div>
                        <div style="font-size: 1.6rem; font-weight: 800; color: var(--color-text); margin: 0.3rem 0;" class="tabular-nums">${formatCurrency(Number(thisMonth.spent || 0))}</div>
                    </div>
                    <div class="trend-chip ${trendClass}" style="align-self: flex-start;">
                        <span aria-hidden="true" style="display: flex;">${trendIconSvg}</span>
                        <span>${trendSign}${comp.percent_change}% vs last month</span>
                    </div>
                </div>

                <!-- Last Month Total -->
                <div class="kpi-card" style="background: var(--color-surface-card); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 1.1rem;">
                    <div style="color: var(--color-text-muted); font-size: 0.78rem; text-transform: uppercase; font-weight: 600; letter-spacing: 0.05em;">
                        ${isBusiness ? 'Commercial Outflow (Last Month)' : 'Total Spend (Last Month)'}
                    </div>
                    <div style="font-size: 1.6rem; font-weight: 800; color: var(--color-text); margin: 0.3rem 0;" class="tabular-nums">${formatCurrency(Number(lastMonth.spent || 0))}</div>
                    <div style="font-size: 0.82rem; color: var(--color-text-muted);">
                        ${lastMonth.bill_count === 1 ? 'Across 1 recorded invoice' : `Across ${lastMonth.bill_count || 0} recorded invoices`}
                    </div>
                </div>

                <!-- Average Bill Size -->
                <div class="kpi-card" style="background: var(--color-surface-card); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 1.1rem;">
                    <div style="color: var(--color-text-muted); font-size: 0.78rem; text-transform: uppercase; font-weight: 600; letter-spacing: 0.05em;">
                        ${isBusiness ? 'Average Invoice / Order' : 'Average Bill Size'}
                    </div>
                    <div style="font-size: 1.6rem; font-weight: 800; color: var(--color-text); margin: 0.3rem 0;" class="tabular-nums">${formatCurrency(Number(data.average_bill_size || 0))}</div>
                    <div style="font-size: 0.82rem; color: var(--color-text-muted);">
                        ${isBusiness ? 'Average per wholesale order' : 'Average per transaction'}
                    </div>
                </div>

                <!-- Busiest Spending Days -->
                <div class="kpi-card" style="background: var(--color-surface-card); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 1.1rem;">
                    <div style="color: var(--color-text-muted); font-size: 0.78rem; text-transform: uppercase; font-weight: 600; letter-spacing: 0.05em;">
                        ${isBusiness ? 'Busiest Procurement Day' : 'Busiest Day'}
                    </div>
                    <div style="font-size: 1.4rem; font-weight: 800; color: var(--color-warning); margin: 0.3rem 0;">${escapeHtml(busiest.day_name || 'Saturday')}</div>
                    <div style="font-size: 0.82rem; color: var(--color-text-muted);" class="tabular-nums">
                        ${formatCurrency(Number(busiest.total_spend || 0))} across ${busiest.bill_count || 0} ${(busiest.bill_count === 1) ? 'invoice' : 'invoices'}
                    </div>
                </div>
            </div>

            <!-- Charts Section (Grid) -->
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 1.25rem; margin-bottom: 1.5rem;">
                <!-- Category Donut Chart -->
                <div style="background: var(--color-surface-card); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 1.25rem;">
                    <h3 style="font-size: 1.05rem; font-weight: 700; margin-bottom: 0.2rem;">Spending by Category</h3>
                    <p style="color: var(--color-text-subtle); font-size: 0.75rem; margin-bottom: 1rem;" class="tabular-nums">Based on final bill total (${formatCurrency(Number(donut.total || 0))})</p>
                    <div style="max-width: 320px; margin: 0 auto; height: 260px; position: relative;">
                        <canvas id="categoryDonutChart"></canvas>
                    </div>
                </div>

                <!-- Monthly Trendline Chart -->
                <div style="background: var(--color-surface-card); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 1.25rem;">
                    <h3 style="font-size: 1.05rem; font-weight: 700; margin-bottom: 0.2rem;">Monthly Spend Trend</h3>
                    <p style="color: var(--color-text-subtle); font-size: 0.75rem; margin-bottom: 1rem;">Spending trajectory across recorded months</p>
                    <div style="width: 100%; height: 260px; position: relative;">
                        <canvas id="monthlyTrendChart"></canvas>
                    </div>
                </div>
            </div>

            <!-- Rankings Section (Top Merchants & Top Items) -->
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 1.25rem; margin-bottom: 1.5rem;">
                <!-- Top Merchants -->
                <div style="background: var(--color-surface-card); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 1.25rem;">
                    <h3 style="font-size: 1.05rem; font-weight: 700; margin-bottom: 0.75rem; display: flex; align-items: center; gap: 0.4rem;">
                        <span style="color: var(--color-primary); display: flex;">${getIcon('store', { size: 18 })}</span>
                        Top Merchants
                    </h3>
                    <div style="display: flex; flex-direction: column; gap: 0.6rem;">
                        ${topMerchants.length === 0 ? '<p style="color:var(--color-text-muted);font-size:0.85rem;">No bills recorded yet.</p>' : ''}
                        ${topMerchants.map((m, i) => `
                            <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.5rem 0.75rem; background: var(--color-surface-bg); border-radius: var(--radius-md); border: 1px solid var(--color-border); font-size: 0.88rem;">
                                <div>
                                    <strong>${i + 1}. ${escapeHtml(m.merchant_name)}</strong>
                                    <div style="font-size: 0.75rem; color: var(--color-text-muted);">${m.visits} visits</div>
                                </div>
                                <div style="font-weight: 700; color: var(--color-accent);" class="tabular-nums">
                                    ${formatCurrency(Number(m.total_spend))}
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>

                <!-- Top Items -->
                <div style="background: var(--color-surface-card); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 1.25rem;">
                    <h3 style="font-size: 1.05rem; font-weight: 700; margin-bottom: 0.75rem; display: flex; align-items: center; gap: 0.4rem;">
                        <span style="color: var(--color-primary); display: flex;">${getIcon('shopping-cart', { size: 18 })}</span>
                        Top Spending Items
                    </h3>
                    <div style="display: flex; flex-direction: column; gap: 0.6rem;">
                        ${topItems.length === 0 ? '<p style="color:var(--color-text-muted);font-size:0.85rem;">No items recorded yet.</p>' : ''}
                        ${topItems.map((it, i) => `
                            <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.5rem 0.75rem; background: var(--color-surface-bg); border-radius: var(--radius-md); border: 1px solid var(--color-border); font-size: 0.88rem;">
                                <div>
                                    <strong>${i + 1}. ${escapeHtml(it.item_name)}</strong>
                                    <div style="font-size: 0.75rem; color: var(--color-text-muted);">${escapeHtml(it.category_name)} (${it.total_quantity} ${escapeHtml(it.unit || '')})</div>
                                </div>
                                <div style="font-weight: 700; color: var(--color-primary);" class="tabular-nums">
                                    ${formatCurrency(Number(it.total_spend))}
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>

            <!-- AI Reading Accuracy Log -->
            <div style="background: var(--color-surface-card); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 1.25rem; margin-bottom: 1.5rem;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem; flex-wrap: wrap; gap: 0.5rem;">
                    <div>
                        <h3 style="font-size: 1.05rem; font-weight: 700; display: flex; align-items: center; gap: 0.4rem;">
                            <span style="color: var(--color-primary); display: flex;">${getIcon('target', { size: 18 })}</span>
                            AI Reading Accuracy Log
                        </h3>
                        <p style="color: var(--color-text-subtle); font-size: 0.78rem;">Field accuracy tracked across user review corrections</p>
                    </div>
                    <span style="font-size: 0.75rem; color: var(--color-text-muted); background: var(--color-surface-bg); padding: 0.2rem 0.6rem; border-radius: 999px; border: 1px solid var(--color-border);">
                        ${(data.accuracy_breakdown && data.accuracy_breakdown.has_data) ? 'Active Log' : 'Initial Baseline'}
                    </span>
                </div>

                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 1rem;">
                    <!-- Printed Receipts Accuracy -->
                    <div style="background: var(--color-surface-bg); border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 1rem;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.4rem;">
                            <span style="font-size: 0.82rem; font-weight: 700; color: var(--color-text); display: flex; align-items: center; gap: 0.35rem;">
                                ${getIcon('receipt', { size: 15 })} Printed Receipts
                            </span>
                            <span style="font-size: 0.75rem; color: var(--color-text-muted);">
                                ${data.accuracy_breakdown?.printed?.bills_analyzed || 0} bills analyzed
                            </span>
                        </div>
                        <div style="font-size: 1.6rem; font-weight: 800; color: var(--color-success); margin-bottom: 0.2rem;" class="tabular-nums">
                            ${data.accuracy_breakdown?.printed?.accuracy_percent ?? 98.0}%
                        </div>
                        <div style="font-size: 0.75rem; color: var(--color-text-muted);">
                            ${data.accuracy_breakdown?.printed?.fields_checked || 0} fields verified
                        </div>
                    </div>

                    <!-- Handwritten Receipts Accuracy -->
                    <div style="background: var(--color-surface-bg); border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 1rem;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.4rem;">
                            <span style="font-size: 0.82rem; font-weight: 700; color: var(--color-text); display: flex; align-items: center; gap: 0.35rem;">
                                ${getIcon('edit-2', { size: 15 })} Handwritten & Kirana Chits
                            </span>
                            <span style="font-size: 0.75rem; color: var(--color-text-muted);">
                                ${data.accuracy_breakdown?.handwritten?.bills_analyzed || 0} bills analyzed
                            </span>
                        </div>
                        <div style="font-size: 1.6rem; font-weight: 800; color: var(--color-warning); margin-bottom: 0.2rem;" class="tabular-nums">
                            ${data.accuracy_breakdown?.handwritten?.accuracy_percent ?? 92.0}%
                        </div>
                        <div style="font-size: 0.75rem; color: var(--color-text-muted);">
                            ${data.accuracy_breakdown?.handwritten?.fields_checked || 0} fields verified
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;

    // Initialize Refresh button
    const refreshBtn = document.getElementById('btnRefreshInsights');
    if (refreshBtn) {
        refreshBtn.onclick = () => {
            showToast('Refreshing insights...', 'info', 1500);
            loadInsightsDashboard();
        };
    }

    // Render Chart.js charts
    initDonutChart(donut);
    initTrendChart(trend);
}

function initDonutChart(donut) {
    const canvas = document.getElementById('categoryDonutChart');
    if (!canvas || !donut.labels || donut.labels.length === 0) return;

    if (categoryChartInstance) {
        categoryChartInstance.destroy();
    }

    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const textColor = isDark ? '#94a3b8' : '#64748b';
    const cardBorder = isDark ? '#0f172a' : '#ffffff';

    try {
        categoryChartInstance = new Chart(canvas, {
            type: 'doughnut',
            data: {
                labels: donut.labels,
                datasets: [{
                    data: donut.values,
                    backgroundColor: donut.colors || ['#4f46e5', '#059669', '#d97706', '#0284c7', '#8b5cf6', '#dc2626'],
                    borderWidth: 2,
                    borderColor: cardBorder
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: { color: textColor, font: { size: 11 }, padding: 12, boxWidth: 12 }
                    },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => ` ${ctx.label}: ${formatCurrency(Number(ctx.raw))} (${donut.percentages[ctx.dataIndex]}%)`
                        }
                    }
                }
            }
        });
    } catch (e) {
        console.warn('Failed to render donut chart:', e);
    }
}

function initTrendChart(trend) {
    const canvas = document.getElementById('monthlyTrendChart');
    if (!canvas || !trend.labels || trend.labels.length === 0) return;

    if (trendChartInstance) {
        trendChartInstance.destroy();
    }

    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const textColor = isDark ? '#94a3b8' : '#64748b';
    const gridColor = isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.06)';

    try {
        trendChartInstance = new Chart(canvas, {
            type: 'line',
            data: {
                labels: trend.labels,
                datasets: [{
                    label: 'Monthly Spending',
                    data: trend.values,
                    borderColor: '#4f46e5',
                    backgroundColor: isDark ? 'rgba(79, 70, 229, 0.15)' : 'rgba(79, 70, 229, 0.08)',
                    fill: true,
                    tension: 0.3,
                    pointBackgroundColor: '#4f46e5',
                    pointRadius: 5,
                    borderWidth: 2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => {
                                const c = trend.counts[ctx.dataIndex] || 0;
                                const lbl = c === 1 ? '1 bill' : `${c} bills`;
                                return ` ${formatCurrency(Number(ctx.raw))} (${lbl})`;
                            }
                        }
                    }
                },
                scales: {
                    x: { ticks: { color: textColor }, grid: { color: gridColor } },
                    y: {
                        ticks: {
                            color: textColor,
                            callback: (v) => formatCurrency(Number(v))
                        },
                        grid: { color: gridColor }
                    }
                }
            }
        });
    } catch (e) {
        console.warn('Failed to render trend chart:', e);
    }
}
