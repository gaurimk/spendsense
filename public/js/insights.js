/**
 * SpendSense - Insights Dashboard Module (ES Module)
 * Fetches analytics, renders KPI metric cards, Chart.js category donut chart,
 * monthly trendline chart, and top merchants/items rankings.
 */

import { apiRequest } from './api.js';

let categoryChartInstance = null;
let trendChartInstance = null;

export async function loadInsightsDashboard() {
    const container = document.getElementById('screenInsights');
    if (!container) return;

    try {
        const data = await apiRequest('/api/insights/summary');
        renderInsightsDashboard(data);
    } catch (err) {
        console.error('Failed to load insights:', err);
        container.innerHTML = `
            <div style="padding: 2rem; text-align: center; color: var(--text-muted);">
                <h3>Unable to load insights</h3>
                <p style="margin-top: 0.5rem; color: #fca5a5;">${err.message || 'Error fetching data'}</p>
                <button class="btn btn-secondary" onclick="window.loadInsights()" style="margin-top: 1rem;">Retry</button>
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

    const trendColor = comp.difference > 0 ? '#ef4444' : (comp.difference < 0 ? '#10b981' : '#94a3b8');
    const trendIcon = comp.difference > 0 ? '▲' : (comp.difference < 0 ? '▼' : '▬');
    const trendSign = comp.difference > 0 ? '+' : '';

    container.innerHTML = `
        <div class="insights-container" style="padding: 1.25rem; overflow-y: auto; max-width: 1100px; margin: 0 auto; width: 100%;">
            <!-- Header -->
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.25rem; flex-wrap: wrap; gap: 0.5rem;">
                <div>
                    <h2 style="font-size: 1.4rem; font-weight: 700;">📊 Spending Insights</h2>
                    <p style="color: var(--text-muted); font-size: 0.88rem;">Overview for ${escapeHtml(thisMonth.label || 'Current Month')}</p>
                </div>
                <button class="btn btn-secondary" id="btnRefreshInsights" type="button" style="font-size: 0.8rem; padding: 0.4rem 0.8rem;">
                    🔄 Refresh
                </button>
            </div>

            <!-- KPI Cards Row -->
            <div class="kpi-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 1rem; margin-bottom: 1.5rem;">
                <!-- Total This Month -->
                <div class="kpi-card" style="background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 1.1rem;">
                    <div style="color: var(--text-muted); font-size: 0.8rem; text-transform: uppercase; font-weight: 600;">Total Spend (This Month)</div>
                    <div style="font-size: 1.6rem; font-weight: 800; color: #ffffff; margin: 0.3rem 0;">₹${Number(thisMonth.spent || 0).toLocaleString('en-IN', {minimumFractionDigits: 2})}</div>
                    <div style="font-size: 0.82rem; color: ${trendColor}; font-weight: 600;">
                        ${trendIcon} ${trendSign}${comp.percent_change}% vs last month
                    </div>
                </div>

                <!-- Last Month Total -->
                <div class="kpi-card" style="background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 1.1rem;">
                    <div style="color: var(--text-muted); font-size: 0.8rem; text-transform: uppercase; font-weight: 600;">Total Spend (Last Month)</div>
                    <div style="font-size: 1.6rem; font-weight: 800; color: #ffffff; margin: 0.3rem 0;">₹${Number(lastMonth.spent || 0).toLocaleString('en-IN', {minimumFractionDigits: 2})}</div>
                    <div style="font-size: 0.82rem; color: var(--text-muted);">
                        ${lastMonth.bill_count === 1 ? 'Across 1 recorded bill' : `Across ${lastMonth.bill_count || 0} recorded bills`}
                    </div>
                </div>

                <!-- Average Bill Size -->
                <div class="kpi-card" style="background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 1.1rem;">
                    <div style="color: var(--text-muted); font-size: 0.8rem; text-transform: uppercase; font-weight: 600;">Average Bill Size</div>
                    <div style="font-size: 1.6rem; font-weight: 800; color: #ffffff; margin: 0.3rem 0;">₹${Number(data.average_bill_size || 0).toLocaleString('en-IN', {minimumFractionDigits: 2})}</div>
                    <div style="font-size: 0.82rem; color: var(--text-muted);">
                        Average per transaction
                    </div>
                </div>

                <!-- Busiest Spending Days -->
                <div class="kpi-card" style="background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 1.1rem;">
                    <div style="color: var(--text-muted); font-size: 0.8rem; text-transform: uppercase; font-weight: 600;">Busiest Day</div>
                    <div style="font-size: 1.4rem; font-weight: 800; color: var(--accent-amber); margin: 0.3rem 0;">${escapeHtml(busiest.day_name || 'Saturday')}</div>
                    <div style="font-size: 0.82rem; color: var(--text-muted);">
                        ₹${Number(busiest.total_spend || 0).toLocaleString('en-IN')} across ${busiest.bill_count || 0} ${(busiest.bill_count === 1) ? 'visit' : 'visits'}
                    </div>
                </div>
            </div>

            <!-- Charts Section (Grid) -->
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 1.25rem; margin-bottom: 1.5rem;">
                <!-- Category Donut Chart -->
                <div style="background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 1.25rem;">
                    <h3 style="font-size: 1.05rem; font-weight: 700; margin-bottom: 0.2rem;">Spending by Category</h3>
                    <p style="color: var(--text-subtle); font-size: 0.75rem; margin-bottom: 1rem;">Based on final bill total (₹${Number(donut.total || 0).toLocaleString('en-IN')})</p>
                    <div style="max-width: 320px; margin: 0 auto; min-height: 250px;">
                        <canvas id="categoryDonutChart"></canvas>
                    </div>
                </div>

                <!-- Monthly Trendline Chart -->
                <div style="background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 1.25rem;">
                    <h3 style="font-size: 1.05rem; font-weight: 700; margin-bottom: 0.2rem;">Monthly Spend Trend</h3>
                    <p style="color: var(--text-subtle); font-size: 0.75rem; margin-bottom: 1rem;">Spending trajectory across recorded months</p>
                    <div style="width: 100%; min-height: 250px;">
                        <canvas id="monthlyTrendChart"></canvas>
                    </div>
                </div>
            </div>

            <!-- Rankings Section (Top Merchants & Top Items) -->
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 1.25rem; margin-bottom: 1.5rem;">
                <!-- Top Merchants -->
                <div style="background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 1.25rem;">
                    <h3 style="font-size: 1.05rem; font-weight: 700; margin-bottom: 0.75rem;">🏪 Top Merchants</h3>
                    <div style="display: flex; flex-direction: column; gap: 0.6rem;">
                        ${topMerchants.length === 0 ? '<p style="color:var(--text-muted);font-size:0.85rem;">No bills recorded yet.</p>' : ''}
                        ${topMerchants.map((m, i) => `
                            <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.5rem 0.75rem; background: var(--bg-main); border-radius: var(--radius-md); border: 1px solid var(--border); font-size: 0.88rem;">
                                <div>
                                    <strong>${i + 1}. ${escapeHtml(m.merchant_name)}</strong>
                                    <div style="font-size: 0.75rem; color: var(--text-muted);">${m.visits} visits</div>
                                </div>
                                <div style="font-weight: 700; color: var(--accent-green);">
                                    ₹${Number(m.total_spend).toLocaleString('en-IN', {minimumFractionDigits: 2})}
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>

                <!-- Top Items -->
                <div style="background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 1.25rem;">
                    <h3 style="font-size: 1.05rem; font-weight: 700; margin-bottom: 0.75rem;">🛒 Top Spending Items</h3>
                    <div style="display: flex; flex-direction: column; gap: 0.6rem;">
                        ${topItems.length === 0 ? '<p style="color:var(--text-muted);font-size:0.85rem;">No items recorded yet.</p>' : ''}
                        ${topItems.map((it, i) => `
                            <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.5rem 0.75rem; background: var(--bg-main); border-radius: var(--radius-md); border: 1px solid var(--border); font-size: 0.88rem;">
                                <div>
                                    <strong>${i + 1}. ${escapeHtml(it.item_name)}</strong>
                                    <div style="font-size: 0.75rem; color: var(--text-muted);">${escapeHtml(it.category_name)} (${it.total_quantity} ${escapeHtml(it.unit || '')})</div>
                                </div>
                                <div style="font-weight: 700; color: #a5b4fc;">
                                    ₹${Number(it.total_spend).toLocaleString('en-IN', {minimumFractionDigits: 2})}
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>

            <!-- AI OCR Accuracy Breakdown (Printed vs Handwritten) -->
            <div style="background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 1.25rem; margin-bottom: 1.5rem;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem; flex-wrap: wrap; gap: 0.5rem;">
                    <div>
                        <h3 style="font-size: 1.05rem; font-weight: 700;">🎯 AI Reading Accuracy Log</h3>
                        <p style="color: var(--text-subtle); font-size: 0.78rem;">Field accuracy tracked across user review corrections</p>
                    </div>
                    <span style="font-size: 0.75rem; color: var(--text-muted); background: var(--bg-main); padding: 0.2rem 0.6rem; border-radius: 999px; border: 1px solid var(--border);">
                        ${(data.accuracy_breakdown && data.accuracy_breakdown.has_data) ? 'Active Log' : 'Initial Baseline'}
                    </span>
                </div>

                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 1rem;">
                    <!-- Printed Receipts Accuracy -->
                    <div style="background: var(--bg-main); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 1rem;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.4rem;">
                            <span style="font-size: 0.82rem; font-weight: 700; color: #ffffff;">🧾 Printed Receipts</span>
                            <span style="font-size: 0.75rem; color: var(--text-muted);">
                                ${data.accuracy_breakdown?.printed?.bills_analyzed || 0} bills analyzed
                            </span>
                        </div>
                        <div style="font-size: 1.6rem; font-weight: 800; color: var(--accent-green); margin-bottom: 0.2rem;">
                            ${data.accuracy_breakdown?.printed?.accuracy_percent ?? 98.0}%
                        </div>
                        <div style="font-size: 0.75rem; color: var(--text-muted);">
                            ${data.accuracy_breakdown?.printed?.fields_checked || 0} fields verified
                        </div>
                    </div>

                    <!-- Handwritten Receipts Accuracy -->
                    <div style="background: var(--bg-main); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 1rem;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.4rem;">
                            <span style="font-size: 0.82rem; font-weight: 700; color: #ffffff;">✍️ Handwritten & Kirana Chits</span>
                            <span style="font-size: 0.75rem; color: var(--text-muted);">
                                ${data.accuracy_breakdown?.handwritten?.bills_analyzed || 0} bills analyzed
                            </span>
                        </div>
                        <div style="font-size: 1.6rem; font-weight: 800; color: var(--accent-amber); margin-bottom: 0.2rem;">
                            ${data.accuracy_breakdown?.handwritten?.accuracy_percent ?? 92.0}%
                        </div>
                        <div style="font-size: 0.75rem; color: var(--text-muted);">
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
        refreshBtn.onclick = () => loadInsightsDashboard();
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

    try {
        categoryChartInstance = new Chart(canvas, {
            type: 'doughnut',
            data: {
                labels: donut.labels,
                datasets: [{
                    data: donut.values,
                    backgroundColor: donut.colors || ['#10b981', '#f59e0b', '#3b82f6', '#8b5cf6', '#ec4899', '#ef4444'],
                    borderWidth: 2,
                    borderColor: '#1e293b'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: { color: '#94a3b8', font: { size: 11 }, padding: 12, boxWidth: 12 }
                    },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => ` ${ctx.label}: ₹${Number(ctx.raw).toLocaleString('en-IN')} (${donut.percentages[ctx.dataIndex]}%)`
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

    try {
        trendChartInstance = new Chart(canvas, {
            type: 'line',
            data: {
                labels: trend.labels,
                datasets: [{
                    label: 'Monthly Spending (₹)',
                    data: trend.values,
                    borderColor: '#6366f1',
                    backgroundColor: 'rgba(99, 102, 241, 0.15)',
                    fill: true,
                    tension: 0.3,
                    pointBackgroundColor: '#818cf8',
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
                                return ` ₹${Number(ctx.raw).toLocaleString('en-IN', {minimumFractionDigits: 2})} (${lbl})`;
                            }
                        }
                    }
                },
                scales: {
                    x: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(51, 65, 85, 0.3)' } },
                    y: {
                        ticks: {
                            color: '#94a3b8',
                            callback: (v) => '₹' + Number(v).toLocaleString('en-IN')
                        },
                        grid: { color: 'rgba(51, 65, 85, 0.3)' }
                    }
                }
            }
        });
    } catch (e) {
        console.warn('Failed to render trend chart:', e);
    }
}

function escapeHtml(text) {
    if (!text) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
