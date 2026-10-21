/**
 * SpendSense - Price Tracker Screen Controller
 * Tracks item price changes across merchants, draws trendlines,
 * flags inflation/deflation, and highlights cheapest stores.
 */

import { apiRequest } from './api.js';
import { formatCurrency, formatDate, escapeHtml } from './utils.js';
import { getIcon } from './icons.js';
import { setupVoiceSearch } from './voice-search.js';
import { getCurrentFirebaseUser } from './firebase-auth.js';
import { getBillsFromFirestore, searchItemPriceHistoryInBills } from './firebase-firestore.js';

let priceChartInstance = null;
let currentTrackedItem = 'milk';
let lastTrackedData = null;

// Listen for theme change to update chart dynamically
window.addEventListener('themechanged', () => {
    if (lastTrackedData) {
        renderPriceChart(lastTrackedData.history, lastTrackedData.itemName);
    }
});

export async function loadPriceTrackerTab() {
    const container = document.getElementById('screenPriceTracker');
    if (!container) return;

    container.innerHTML = `
        <div style="max-width: 950px; margin: 0 auto; width: 100%; padding: 1.25rem;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.25rem; flex-wrap: wrap; gap: 0.5rem;">
                <div>
                    <h2 style="font-size: 1.4rem; font-weight: 700; display: flex; align-items: center; gap: 0.5rem;">
                        <span style="color: var(--color-primary); display: flex;">${getIcon('tag', { size: 22 })}</span>
                        Item Price Tracker
                    </h2>
                    <p style="color: var(--color-text-muted); font-size: 0.88rem; margin-top: 0.2rem;">
                        Compare rates across grocery stores, supermarkets, and local shops over time.
                    </p>
                </div>
            </div>

            <!-- Search and Quick-Pick Bar -->
            <div style="background: var(--color-surface-card); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 1.25rem; margin-bottom: 1.25rem;">
                <div style="display: flex; gap: 0.75rem; flex-wrap: wrap; margin-bottom: 1rem;">
                    <div style="flex: 1; min-width: 220px; position: relative;">
                        <input type="text" id="ptItemSearchInput" class="form-control" placeholder="Search item (e.g. Milk, Rice, Oil, Biscuits)..." autocomplete="off" style="font-size: 0.95rem; padding-left: 2.2rem; padding-right: 2.2rem;">
                        <span style="position: absolute; left: 0.75rem; top: 50%; transform: translateY(-50%); color: var(--color-text-muted); display: flex;">
                            ${getIcon('search', { size: 16 })}
                        </span>
                        <button type="button" id="btnPtVoiceSearch" class="btn-input-voice" title="Voice search item to track" aria-label="Voice search item to track">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                                <line x1="12" x2="12" y1="19" y2="22" />
                            </svg>
                        </button>
                    </div>
                    <button id="ptBtnSearch" class="btn btn-primary" type="button" style="white-space: nowrap; display: inline-flex; align-items: center; gap: 0.35rem;">
                        ${getIcon('tag', { size: 14 })} Track Price
                    </button>
                </div>

                <!-- Popular Tracked Items Chips -->
                <div>
                    <div style="font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--color-text-muted); font-weight: 700; margin-bottom: 0.5rem;">
                        Top Tracked Items in Your Bills:
                    </div>
                    <div id="ptItemChipsContainer" style="display: flex; flex-wrap: wrap; gap: 0.4rem;">
                        <span style="color: var(--color-text-muted); font-size: 0.85rem;">Loading items...</span>
                    </div>
                </div>
            </div>

            <!-- Price Summary & Trend Cards -->
            <div id="ptSummaryGrid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 1rem; margin-bottom: 1.25rem; display: none;">
                <!-- Latest Price Card -->
                <div style="background: var(--color-surface-card); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 1.1rem;">
                    <div style="font-size: 0.78rem; font-weight: 700; color: var(--color-text-muted); text-transform: uppercase; letter-spacing: 0.05em;">Latest Recorded Rate</div>
                    <div id="ptLatestPrice" style="font-size: 1.5rem; font-weight: 800; color: var(--color-text); margin: 0.25rem 0;" class="tabular-nums">₹0.00</div>
                    <div id="ptLatestStore" style="font-size: 0.8rem; color: var(--color-text-muted);">-</div>
                </div>

                <!-- Cheapest At Card -->
                <div style="background: var(--color-surface-card); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 1.1rem; border-left: 3px solid var(--color-success);">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span style="font-size: 0.78rem; font-weight: 700; color: var(--color-success); text-transform: uppercase; letter-spacing: 0.05em;">Cheapest At</span>
                        <span style="font-size: 0.7rem; background: var(--color-success-subtle); color: var(--color-success); font-weight: 700; padding: 0.1rem 0.4rem; border-radius: 4px;">BEST DEAL</span>
                    </div>
                    <div id="ptCheapestPrice" style="font-size: 1.5rem; font-weight: 800; color: var(--color-success); margin: 0.25rem 0;" class="tabular-nums">₹0.00</div>
                    <div id="ptCheapestStore" style="font-size: 0.8rem; color: var(--color-text-muted);">-</div>
                </div>

                <!-- Price Change / Inflation Card -->
                <div style="background: var(--color-surface-card); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 1.1rem;" id="ptTrendCard">
                    <div style="font-size: 0.78rem; font-weight: 700; color: var(--color-text-muted); text-transform: uppercase; letter-spacing: 0.05em;">Price Movement</div>
                    <div id="ptTrendFlag" style="font-size: 1.15rem; font-weight: 700; color: var(--color-text); margin: 0.35rem 0;">-</div>
                    <div id="ptTrendDetail" style="font-size: 0.8rem; color: var(--color-text-muted);">-</div>
                </div>
            </div>

            <!-- Chart Card -->
            <div id="ptChartCard" style="background: var(--color-surface-card); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 1.25rem; margin-bottom: 1.25rem; display: none;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; flex-wrap: wrap; gap: 0.5rem;">
                    <div>
                        <h3 id="ptChartTitle" style="font-size: 1.05rem; font-weight: 700;">Price History Across Merchants</h3>
                        <p style="font-size: 0.8rem; color: var(--color-text-muted);">Points show the store where the item was purchased</p>
                    </div>
                </div>
                <div style="position: relative; height: 280px; width: 100%;">
                    <canvas id="ptPriceChartCanvas"></canvas>
                </div>
            </div>

            <!-- Purchase History Table -->
            <div id="ptTableCard" style="background: var(--color-surface-card); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 1.25rem; display: none;">
                <h3 style="font-size: 1.05rem; font-weight: 700; margin-bottom: 0.75rem;">Recorded Purchase Timeline</h3>
                <div style="overflow-x: auto;">
                    <table style="width: 100%; border-collapse: collapse; font-size: 0.88rem;">
                        <thead>
                            <tr style="border-bottom: 1px solid var(--color-border); text-align: left; color: var(--color-text-muted); font-size: 0.78rem; text-transform: uppercase;">
                                <th style="padding: 0.5rem 0.75rem;">Date</th>
                                <th style="padding: 0.5rem 0.75rem;">Merchant</th>
                                <th style="padding: 0.5rem 0.75rem;">Item Details</th>
                                <th style="padding: 0.5rem 0.75rem; text-align: right;">Unit Rate</th>
                                <th style="padding: 0.5rem 0.75rem; text-align: right;">Qty</th>
                                <th style="padding: 0.5rem 0.75rem; text-align: right;">Total</th>
                            </tr>
                        </thead>
                        <tbody id="ptHistoryTableBody">
                        </tbody>
                    </table>
                </div>
            </div>

            <!-- Empty / Prompt State -->
            <div id="ptEmptyState" style="background: var(--color-surface-card); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 3rem 1.5rem; text-align: center; color: var(--color-text-muted);">
                <div style="color: var(--color-primary); margin-bottom: 0.5rem; display: flex; justify-content: center;">${getIcon('trending-up', { size: 36 })}</div>
                <h3 style="font-size: 1.15rem; font-weight: 700; color: var(--color-text);">Pick or Search an Item to Track</h3>
                <p style="font-size: 0.88rem; margin-top: 0.35rem; max-width: 500px; margin-left: auto; margin-right: auto;">
                    Select an item from the chips above or type a name to see price history, store-by-store comparisons, and price trendlines.
                </p>
            </div>
        </div>
    `;

    // Bind event listeners
    const searchInput = document.getElementById('ptItemSearchInput');
    const searchBtn = document.getElementById('ptBtnSearch');

    searchBtn?.addEventListener('click', () => {
        const query = searchInput?.value.trim();
        if (query) {
            trackItem(query);
        }
    });

    searchInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const query = searchInput?.value.trim();
            if (query) trackItem(query);
        }
    });

    // Voice search for price tracker
    const ptVoiceBtn = document.getElementById('btnPtVoiceSearch');
    if (searchInput && ptVoiceBtn) {
        setupVoiceSearch({
            inputElement: searchInput,
            micButtonElement: ptVoiceBtn,
            placeholderListening: '🎙️ Speak grocery or item name...',
            onFinalSubmit: (query) => {
                if (query.trim()) trackItem(query.trim());
            }
        });
    }

    // Load available items
    await loadTrackedItemsList();

    // Auto-track default item if available
    if (currentTrackedItem) {
        trackItem(currentTrackedItem);
    }
}

async function loadTrackedItemsList() {
    const chipsContainer = document.getElementById('ptItemChipsContainer');
    if (!chipsContainer) return;

    try {
        let items = [];
        const fbUser = getCurrentFirebaseUser();
        if (fbUser && fbUser.uid) {
            const fbBills = await getBillsFromFirestore(fbUser.uid);
            const itemCounts = {};
            fbBills.forEach(b => {
                if (Array.isArray(b.line_items)) {
                    b.line_items.forEach(it => {
                        const name = (it.item_name || '').trim();
                        if (name) {
                            if (!itemCounts[name]) itemCounts[name] = { item_name: name, avg_price: Number(it.unit_price || it.total_price || 0), count: 0 };
                            itemCounts[name].count++;
                        }
                    });
                }
            });
            items = Object.values(itemCounts).sort((a, b) => b.count - a.count);
        } else {
            const res = await apiRequest('/api/price-tracker/items');
            items = res.items || [];
        }

        if (items.length === 0) {
            chipsContainer.innerHTML = `
                <span style="color: var(--color-text-muted); font-size: 0.85rem;">
                    No bills recorded yet. Upload a receipt or load demo data to start tracking prices!
                </span>
            `;
            return;
        }

        chipsContainer.innerHTML = '';
        items.slice(0, 10).forEach(it => {
            const btn = document.createElement('button');
            btn.className = 'chip-btn';
            btn.type = 'button';
            btn.style.fontSize = '0.82rem';
            btn.innerHTML = `${escapeHtml(it.item_name)} <span style="opacity: 0.7; font-size: 0.75rem;" class="tabular-nums">(${formatCurrency(Number(it.avg_price))})</span>`;
            btn.addEventListener('click', () => {
                const searchInput = document.getElementById('ptItemSearchInput');
                if (searchInput) searchInput.value = it.item_name;
                trackItem(it.item_name);
            });
            chipsContainer.appendChild(btn);
        });

        // Set default item if none active
        if (!currentTrackedItem && items.length > 0) {
            currentTrackedItem = items[0].item_name;
        }
    } catch (e) {
        console.error('Error loading items for price tracker:', e);
        chipsContainer.innerHTML = `<span style="color: var(--color-danger); font-size: 0.85rem;">Failed to load items.</span>`;
    }
}

async function trackItem(itemName) {
    currentTrackedItem = itemName;
    const summaryGrid = document.getElementById('ptSummaryGrid');
    const chartCard = document.getElementById('ptChartCard');
    const tableCard = document.getElementById('ptTableCard');
    const emptyState = document.getElementById('ptEmptyState');

    try {
        let data = null;
        const fbUser = getCurrentFirebaseUser();
        if (fbUser && fbUser.uid) {
            const fbBills = await getBillsFromFirestore(fbUser.uid);
            data = searchItemPriceHistoryInBills(fbBills, itemName);
        } else {
            data = await apiRequest(`/api/price-tracker/history?item=${encodeURIComponent(itemName)}`);
        }

        if (!data || !data.history || data.history.length === 0) {
            if (emptyState) {
                emptyState.style.display = 'block';
                emptyState.innerHTML = `
                    <div style="color: var(--color-text-muted); margin-bottom: 0.5rem; display: flex; justify-content: center;">${getIcon('search', { size: 36 })}</div>
                    <h3 style="font-size: 1.15rem; font-weight: 700; color: var(--color-text);">No Purchase History Found</h3>
                    <p style="font-size: 0.88rem; margin-top: 0.35rem;">
                        No bills matching "<strong>${escapeHtml(itemName)}</strong>" were found in your records.
                    </p>
                `;
            }
            if (summaryGrid) summaryGrid.style.display = 'none';
            if (chartCard) chartCard.style.display = 'none';
            if (tableCard) tableCard.style.display = 'none';
            return;
        }

        if (emptyState) emptyState.style.display = 'none';
        if (summaryGrid) summaryGrid.style.display = 'grid';
        if (chartCard) chartCard.style.display = 'block';
        if (tableCard) tableCard.style.display = 'block';

        // 1. Populate Summary Cards
        const latestPriceEl = document.getElementById('ptLatestPrice');
        const latestStoreEl = document.getElementById('ptLatestStore');
        const cheapestPriceEl = document.getElementById('ptCheapestPrice');
        const cheapestStoreEl = document.getElementById('ptCheapestStore');
        const trendFlagEl = document.getElementById('ptTrendFlag');
        const trendDetailEl = document.getElementById('ptTrendDetail');
        const trendCard = document.getElementById('ptTrendCard');

        const latestRecord = data.history[data.history.length - 1];
        if (latestPriceEl) latestPriceEl.textContent = formatCurrency(Number(data.latest_price));
        if (latestStoreEl) latestStoreEl.textContent = `${latestRecord.merchant_name} on ${formatDate(latestRecord.bill_date)}`;

        if (cheapestPriceEl && data.cheapest_at) {
            cheapestPriceEl.textContent = formatCurrency(Number(data.cheapest_at.price));
            if (cheapestStoreEl) cheapestStoreEl.textContent = `${data.cheapest_at.merchant} on ${formatDate(data.cheapest_at.date)}`;
        }

        const pct = Number(data.price_trend_percent || 0);
        if (trendFlagEl && data.trend_flag) {
            trendFlagEl.textContent = data.trend_flag;
            if (pct > 0) {
                trendFlagEl.style.color = 'var(--color-danger)';
                if (trendCard) trendCard.style.borderLeft = '3px solid var(--color-danger)';
            } else if (pct < 0) {
                trendFlagEl.style.color = 'var(--color-success)';
                if (trendCard) trendCard.style.borderLeft = '3px solid var(--color-success)';
            } else {
                trendFlagEl.style.color = 'var(--color-primary)';
                if (trendCard) trendCard.style.borderLeft = '3px solid var(--color-primary)';
            }
        }
        if (trendDetailEl) {
            trendDetailEl.textContent = `Tracked across ${data.match_count} purchase${data.match_count === 1 ? '' : 's'}`;
        }

        // 2. Render Chart.js Line Chart
        lastTrackedData = { history: data.history, itemName };
        renderPriceChart(data.history, itemName);

        // 3. Render History Table
        renderHistoryTable(data.history);

    } catch (e) {
        console.error('Error tracking item:', e);
        if (emptyState) {
            emptyState.style.display = 'block';
            emptyState.innerHTML = `
                <div style="padding: 2rem 1rem; text-align: center;">
                    <p style="color: var(--color-danger); font-size: 0.9rem; margin-bottom: 0.75rem;">Failed to load price history: ${escapeHtml(e.message || e)}</p>
                    <button class="btn btn-secondary" onclick="window.loadPriceTracker()" type="button" style="display: inline-flex; align-items: center; gap: 0.35rem; margin: 0 auto;">
                        ${getIcon('refresh-cw', { size: 14 })} Retry
                    </button>
                </div>
            `;
        }
    }
}

function renderPriceChart(history, itemName) {
    const canvas = document.getElementById('ptPriceChartCanvas');
    if (!canvas || typeof Chart === 'undefined') return;

    if (priceChartInstance) {
        priceChartInstance.destroy();
        priceChartInstance = null;
    }

    const labels = history.map(h => formatDate(h.bill_date));
    const dataPoints = history.map(h => Number(h.unit_price));
    const merchantNames = history.map(h => h.merchant_name);

    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const textColor = isDark ? '#94a3b8' : '#64748b';
    const gridColor = isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.06)';

    priceChartInstance = new Chart(canvas, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: `Price of ${itemName}`,
                data: dataPoints,
                borderColor: '#4f46e5',
                backgroundColor: isDark ? 'rgba(79, 70, 229, 0.15)' : 'rgba(79, 70, 229, 0.08)',
                borderWidth: 2.5,
                pointBackgroundColor: '#4f46e5',
                pointBorderColor: isDark ? '#0f172a' : '#ffffff',
                pointBorderWidth: 2,
                pointRadius: 5,
                pointHoverRadius: 7,
                fill: true,
                tension: 0.25,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        title: function(items) {
                            const idx = items[0].dataIndex;
                            return `${merchantNames[idx]} • ${labels[idx]}`;
                        },
                        label: function(item) {
                            return ` Rate: ${formatCurrency(Number(item.raw))}`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { color: gridColor },
                    ticks: { color: textColor, font: { size: 11 } }
                },
                y: {
                    grid: { color: gridColor },
                    ticks: {
                        color: textColor,
                        callback: function(v) { return formatCurrency(Number(v)); },
                        font: { size: 11 }
                    }
                }
            }
        }
    });
}

function renderHistoryTable(history) {
    const tbody = document.getElementById('ptHistoryTableBody');
    if (!tbody) return;

    tbody.innerHTML = '';
    const reversed = [...history].reverse();

    reversed.forEach(h => {
        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid var(--color-border-subtle)';
        tr.innerHTML = `
            <td style="padding: 0.6rem 0.75rem; color: var(--color-text);">${formatDate(h.bill_date)}</td>
            <td style="padding: 0.6rem 0.75rem; font-weight: 600; color: var(--color-primary);">${escapeHtml(h.merchant_name)}</td>
            <td style="padding: 0.6rem 0.75rem; color: var(--color-text-muted); font-size: 0.82rem;">${escapeHtml(h.item_name)}</td>
            <td style="padding: 0.6rem 0.75rem; text-align: right; font-weight: 700; color: var(--color-text);" class="tabular-nums">${formatCurrency(Number(h.unit_price))}</td>
            <td style="padding: 0.6rem 0.75rem; text-align: right; color: var(--color-text-muted);" class="tabular-nums">${Number(h.quantity || 1).toFixed(1)} ${escapeHtml(h.unit || '')}</td>
            <td style="padding: 0.6rem 0.75rem; text-align: right; font-weight: 700; color: var(--color-success);" class="tabular-nums">${formatCurrency(Number(h.line_total || h.unit_price))}</td>
        `;
        tbody.appendChild(tr);
    });
}
