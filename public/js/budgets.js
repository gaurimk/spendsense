/**
 * SpendSense - Category Budgets Module (ES Module)
 * Manages monthly category budgets, progress bars, and alerts at 80% and 100%.
 */

import { apiRequest } from './api.js';
import { formatCurrency, escapeHtml, showToast } from './utils.js';
import { getIcon } from './icons.js';
import { getCurrentFirebaseUser } from './firebase-auth.js';
import { getBudgetsFromFirestore, saveBudgetToFirestore, getBillsFromFirestore } from './firebase-firestore.js';

let currentMonth = new Date().toISOString().slice(0, 7); // 'YYYY-MM'
let cachedCategories = [];

export async function loadBudgetsTab() {
    const container = document.getElementById('screenBudgets');
    if (!container) return;

    renderBudgetsContainer(container);
    await fetchAndRenderBudgets();

    if (!container.dataset.modeListenerAttached) {
        container.dataset.modeListenerAttached = 'true';
        window.addEventListener('modechanged', () => {
            const activeScreen = document.querySelector('.screen-view.active');
            if (activeScreen && activeScreen.id === 'screenBudgets') {
                renderBudgetsContainer(container);
                fetchAndRenderBudgets();
            }
        });
    }
}

function renderBudgetsContainer(container) {
    const activeMode = localStorage.getItem('spendsense_active_mode') || 'personal';
    const isBiz = activeMode === 'business';

    container.innerHTML = `
        <div class="budgets-container" style="padding: 1.25rem; max-width: 1000px; margin: 0 auto; width: 100%;">
            <!-- Header -->
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.25rem; flex-wrap: wrap; gap: 0.75rem;">
                <div>
                    <h2 style="font-size: 1.4rem; font-weight: 700; display: flex; align-items: center; gap: 0.5rem;">
                        <span style="color: var(--color-primary); display: flex;">${getIcon(isBiz ? 'briefcase' : 'target', { size: 22 })}</span>
                        ${isBiz ? 'Commercial Operating Budgets' : 'Category Spending Budgets'}
                    </h2>
                    <p style="color: var(--color-text-muted); font-size: 0.88rem; margin-top: 0.2rem;">
                        ${isBiz ? 'Set monthly spending limits for procurement, shop supplies, and operating expenses' : 'Set monthly limits, monitor spending progress, and prevent budget overruns'}
                    </p>
                </div>
                <div style="display: flex; gap: 0.5rem; align-items: center;">
                    <input type="month" id="budgetMonthPicker" class="form-control" value="${currentMonth}" style="font-size: 0.85rem; padding: 0.35rem 0.6rem; width: auto;">
                    <button class="btn btn-primary" id="btnOpenSetBudgetModal" type="button" style="font-size: 0.82rem; padding: 0.4rem 0.85rem; display: inline-flex; align-items: center; gap: 0.25rem;">
                        ${getIcon('plus', { size: 14 })} ${isBiz ? 'Set Expense Limit' : 'Set Budget'}
                    </button>
                </div>
            </div>

            <!-- Alerts Banner Area -->
            <div id="budgetAlertsContainer" style="margin-bottom: 1.25rem;"></div>

            <!-- Budget Overall Summary Grid -->
            <div id="budgetSummaryCards" class="kpi-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 1rem; margin-bottom: 1.5rem;">
                <!-- Populated dynamically -->
            </div>

            <!-- Category Budgets List -->
            <div style="background: var(--color-surface-card); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 1.25rem;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
                    <h3 style="font-size: 1.05rem; font-weight: 700;">Monthly Category Progress</h3>
                    <span style="font-size: 0.8rem; color: var(--color-text-subtle);">Thresholds: 80% (warning) & 100% (exceeded)</span>
                </div>
                <div id="budgetCategoriesList" style="display: flex; flex-direction: column; gap: 1.25rem;">
                    <p style="text-align: center; padding: 2rem; color: var(--color-text-muted);">Loading budgets...</p>
                </div>
            </div>
        </div>

        <!-- Set / Edit Budget Modal -->
        <div class="modal-backdrop" id="setBudgetModal">
            <div class="modal-window" style="max-width: 480px;">
                <div class="modal-header">
                    <div class="modal-title" id="budgetModalTitle">Set Monthly Budget</div>
                    <button class="close-btn" id="closeBudgetModalBtn" type="button" aria-label="Close dialog">&times;</button>
                </div>
                <div class="modal-body">
                    <form id="setBudgetForm">
                        <div class="form-group" style="margin-bottom: 1rem;">
                            <label class="form-label">Category</label>
                            <select class="form-control" id="budgetCategorySelect" required>
                                <option value="">Select category...</option>
                            </select>
                        </div>
                        <div class="form-group" style="margin-bottom: 1rem;">
                            <label class="form-label">Month</label>
                            <input type="month" class="form-control" id="budgetFormMonth" value="${currentMonth}" required>
                        </div>
                        <div class="form-group" style="margin-bottom: 1.25rem;">
                            <label class="form-label">Monthly Limit (₹)</label>
                            <input type="number" step="100" min="0" class="form-control" id="budgetAmountInput" placeholder="e.g. 15000" style="min-width: 90px; text-align: right;" required>
                        </div>
                        <div id="budgetFormError" style="color: var(--color-danger); font-size: 0.85rem; margin-bottom: 0.75rem; display: none;"></div>
                        <div style="display: flex; justify-content: flex-end; gap: 0.5rem;">
                            <button type="button" class="btn btn-secondary" id="cancelBudgetBtn">Cancel</button>
                            <button type="submit" class="btn btn-primary" id="saveBudgetSubmitBtn">Save Budget</button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    `;

    // Month picker listener
    const picker = document.getElementById('budgetMonthPicker');
    if (picker) {
        picker.onchange = (e) => {
            currentMonth = e.target.value || new Date().toISOString().slice(0, 7);
            fetchAndRenderBudgets();
        };
    }

    // Modal triggers
    const modal = document.getElementById('setBudgetModal');
    const openBtn = document.getElementById('btnOpenSetBudgetModal');
    const closeBtn = document.getElementById('closeBudgetModalBtn');
    const cancelBtn = document.getElementById('cancelBudgetBtn');

    if (openBtn) {
        openBtn.onclick = () => openBudgetModal();
    }
    if (closeBtn) closeBtn.onclick = () => modal.classList.remove('open');
    if (cancelBtn) cancelBtn.onclick = () => modal.classList.remove('open');

    const form = document.getElementById('setBudgetForm');
    if (form) {
        form.onsubmit = handleBudgetSubmit;
    }
}

async function fetchAndRenderBudgets() {
    const listContainer = document.getElementById('budgetCategoriesList');
    const summaryCards = document.getElementById('budgetSummaryCards');
    const alertsContainer = document.getElementById('budgetAlertsContainer');
    if (!listContainer) return;

    if (summaryCards) {
        summaryCards.innerHTML = `
            <div class="skeleton-box" style="height: 90px;"></div>
            <div class="skeleton-box" style="height: 90px;"></div>
            <div class="skeleton-box" style="height: 90px;"></div>
        `;
    }
    listContainer.innerHTML = `
        <div class="skeleton-box" style="height: 60px;"></div>
        <div class="skeleton-box" style="height: 60px;"></div>
        <div class="skeleton-box" style="height: 60px;"></div>
    `;

    try {
        let data = null;
        const fbUser = getCurrentFirebaseUser();
        if (fbUser && fbUser.uid) {
            const [fbBudgets, fbBills] = await Promise.all([
                getBudgetsFromFirestore(fbUser.uid),
                getBillsFromFirestore(fbUser.uid)
            ]);
            
            // Calculate spend per category for currentMonth
            const catSpendMap = {};
            fbBills.forEach(b => {
                if ((b.bill_date || '').startsWith(currentMonth)) {
                    const c = b.category_name || 'General & Miscellaneous';
                    const amt = Number(b.my_share_total !== undefined && b.my_share_total !== null ? b.my_share_total : b.grand_total) || 0;
                    catSpendMap[c] = (catSpendMap[c] || 0) + amt;
                }
            });

            let totalBudgeted = 0;
            let totalSpent = 0;
            const alerts = [];
            const budgetCards = fbBudgets.map(bg => {
                const bAmount = Number(bg.monthly_budget || 0);
                const bSpent = Math.round((catSpendMap[bg.category_name] || 0) * 100) / 100;
                totalBudgeted += bAmount;
                totalSpent += bSpent;
                const pct = bAmount > 0 ? Math.round((bSpent / bAmount) * 100) : 0;
                
                let status = 'normal';
                if (pct >= 100) {
                    status = 'exceeded';
                    alerts.push(`Budget exceeded for ${bg.category_name}: ${pct}% used (${formatCurrency(bSpent)} / ${formatCurrency(bAmount)})`);
                } else if (pct >= 80) {
                    status = 'warning';
                    alerts.push(`Budget warning for ${bg.category_name}: ${pct}% reached (${formatCurrency(bSpent)} / ${formatCurrency(bAmount)})`);
                }

                return {
                    id: bg.id,
                    category_id: bg.category_id,
                    category_name: bg.category_name,
                    monthly_budget: bAmount,
                    spent: bSpent,
                    percentage_used: pct,
                    remaining: Math.max(0, bAmount - bSpent),
                    status: status
                };
            });

            const overallPct = totalBudgeted > 0 ? Math.round((totalSpent / totalBudgeted) * 100) : 0;

            data = {
                month: currentMonth,
                total_budgeted: Math.round(totalBudgeted * 100) / 100,
                total_spent: Math.round(totalSpent * 100) / 100,
                overall_percentage: overallPct,
                alerts: alerts,
                categories: budgetCards,
                all_categories: cachedCategories.length > 0 ? cachedCategories : [
                    { id: 1, name: 'Groceries & Supermarket' },
                    { id: 2, name: 'Food & Dining' },
                    { id: 3, name: 'Pharmacy & Healthcare' },
                    { id: 4, name: 'Electronics & Gadgets' },
                    { id: 5, name: 'Fuel & Transport' },
                    { id: 6, name: 'Shopping & Clothing' },
                    { id: 7, name: 'Utilities & Bills' },
                    { id: 8, name: 'Stationery & Office' },
                    { id: 9, name: 'Home & Maintenance' },
                    { id: 10, name: 'General & Miscellaneous' }
                ]
            };
        } else {
            data = await apiRequest(`/api/budgets?month=${encodeURIComponent(currentMonth)}`);
        }
        cachedCategories = data.all_categories || [];

        // 1. Render Alerts Banner if any
        const alerts = data.alerts || [];
        if (alerts.length > 0) {
            alertsContainer.innerHTML = `
                <div style="background: var(--color-danger-subtle); border: 1px solid var(--color-danger); border-radius: var(--radius-md); padding: 1rem;">
                    <div style="display: flex; align-items: center; gap: 0.5rem; color: var(--color-danger); font-weight: 700; margin-bottom: 0.5rem;">
                        <span aria-hidden="true" style="display: flex;">${getIcon('alert-triangle', { size: 16 })}</span>
                        <span>Budget Threshold Alerts (${alerts.length})</span>
                    </div>
                    <ul style="margin: 0; padding-left: 1.25rem; font-size: 0.88rem; color: var(--color-danger); display: flex; flex-direction: column; gap: 0.25rem;">
                        ${alerts.map(a => `<li>${escapeHtml(a)}</li>`).join('')}
                    </ul>
                </div>
            `;
        } else {
            alertsContainer.innerHTML = '';
        }

        // 2. Render Overall Summary KPIs
        const totalBudgeted = Number(data.total_budgeted || 0);
        const totalSpent = Number(data.total_spent || 0);
        const overallPct = Number(data.overall_percentage || 0);
        const remainingTotal = totalBudgeted - totalSpent;

        let statusColor = 'var(--color-success)';
        if (overallPct >= 100) statusColor = 'var(--color-danger)';
        else if (overallPct >= 80) statusColor = 'var(--color-warning)';

        summaryCards.innerHTML = `
            <div class="kpi-card" style="background: var(--color-surface-card); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 1.1rem;">
                <div style="color: var(--color-text-muted); font-size: 0.78rem; text-transform: uppercase; font-weight: 600; letter-spacing: 0.05em;">Total Budgeted</div>
                <div style="font-size: 1.5rem; font-weight: 800; color: var(--color-text); margin: 0.25rem 0;" class="tabular-nums">${formatCurrency(totalBudgeted)}</div>
                <div style="font-size: 0.8rem; color: var(--color-text-muted);">${(data.categories || []).length} active category budgets</div>
            </div>
            <div class="kpi-card" style="background: var(--color-surface-card); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 1.1rem;">
                <div style="color: var(--color-text-muted); font-size: 0.78rem; text-transform: uppercase; font-weight: 600; letter-spacing: 0.05em;">Actual Spend</div>
                <div style="font-size: 1.5rem; font-weight: 800; color: var(--color-text); margin: 0.25rem 0;" class="tabular-nums">${formatCurrency(totalSpent)}</div>
                <div style="font-size: 0.8rem; color: ${statusColor}; font-weight: 600;" class="tabular-nums">${overallPct}% of total budget used</div>
            </div>
            <div class="kpi-card" style="background: var(--color-surface-card); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 1.1rem;">
                <div style="color: var(--color-text-muted); font-size: 0.78rem; text-transform: uppercase; font-weight: 600; letter-spacing: 0.05em;">Remaining Balance</div>
                <div style="font-size: 1.5rem; font-weight: 800; color: ${remainingTotal < 0 ? 'var(--color-danger)' : 'var(--color-success)'}; margin: 0.25rem 0;" class="tabular-nums">
                    ${remainingTotal < 0 ? '-' : ''}${formatCurrency(Math.abs(remainingTotal))}
                </div>
                <div style="font-size: 0.8rem; color: var(--color-text-muted);">${remainingTotal < 0 ? 'Over budget limit' : 'Under budget limit'}</div>
            </div>
        `;

        // 3. Render Categories Progress List
        const categories = data.categories || [];
        if (categories.length === 0) {
            listContainer.innerHTML = `
                <div style="text-align: center; padding: 2.5rem 1rem; color: var(--color-text-muted);">
                    <div style="color: var(--color-primary); margin-bottom: 0.5rem; display: flex; justify-content: center;">${getIcon('target', { size: 36 })}</div>
                    <h4 style="color: var(--color-text); font-size: 1.1rem; margin-bottom: 0.5rem;">No budgets configured for this month</h4>
                    <p style="font-size: 0.88rem; max-width: 440px; margin: 0 auto 1.25rem auto;">
                        Click <strong>"+ Set Budget"</strong> above or load demo data from Settings to prefill realistic budgets across your categories.
                    </p>
                    <button class="btn btn-primary" onclick="window.openSetBudgetModal()" type="button" style="font-size: 0.85rem; padding: 0.4rem 1rem;">
                        + Set Your First Budget
                    </button>
                </div>
            `;
            return;
        }

        listContainer.innerHTML = categories.map(cat => {
            const pct = Math.min(100, cat.percentage_used);
            let barColor = 'var(--color-success)';
            let badge = '';

            if (cat.percentage_used >= 100) {
                barColor = 'var(--color-danger)';
                badge = `<span style="background: var(--color-danger-subtle); color: var(--color-danger); border: 1px solid var(--color-danger); font-size: 0.72rem; font-weight: 700; padding: 0.15rem 0.5rem; border-radius: 999px; display: inline-flex; align-items: center; gap: 0.25rem;">${getIcon('alert-circle', { size: 12 })} 100% EXCEEDED</span>`;
            } else if (cat.percentage_used >= 80) {
                barColor = 'var(--color-warning)';
                badge = `<span style="background: var(--color-warning-subtle); color: var(--color-warning); border: 1px solid var(--color-warning); font-size: 0.72rem; font-weight: 700; padding: 0.15rem 0.5rem; border-radius: 999px; display: inline-flex; align-items: center; gap: 0.25rem;">${getIcon('alert-triangle', { size: 12 })} 80% ALERT</span>`;
            } else {
                badge = `<span style="background: var(--color-success-subtle); color: var(--color-success); border: 1px solid var(--color-success); font-size: 0.72rem; font-weight: 600; padding: 0.15rem 0.5rem; border-radius: 999px;">ON TRACK</span>`;
            }

            return `
                <div style="background: var(--color-surface-bg); border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 1rem;">
                    <!-- Top Line: Name, Badge, Edit button -->
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; flex-wrap: wrap; gap: 0.5rem;">
                        <div style="display: flex; align-items: center; gap: 0.6rem;">
                            <strong style="font-size: 0.95rem; color: var(--color-text);">${escapeHtml(cat.category_name)}</strong>
                            ${badge}
                        </div>
                        <div style="display: flex; align-items: center; gap: 0.75rem;">
                            <span style="font-size: 0.88rem; font-weight: 700; color: var(--color-text);" class="tabular-nums">
                                ${formatCurrency(Number(cat.spent))} 
                                <span style="font-weight: 400; color: var(--color-text-muted); font-size: 0.8rem;">/ ${formatCurrency(Number(cat.budgeted))}</span>
                            </span>
                            <button class="btn btn-secondary edit-budget-btn" data-cat-id="${cat.category_id || ''}" data-cat-name="${escapeHtml(cat.category_name)}" data-amount="${cat.budgeted}" type="button" style="font-size: 0.75rem; padding: 0.2rem 0.5rem;">
                                Edit
                            </button>
                        </div>
                    </div>

                    <!-- Progress Bar Track -->
                    <div style="background: var(--color-border); height: 8px; border-radius: 4px; overflow: hidden; margin-bottom: 0.4rem;">
                        <div style="background: ${barColor}; height: 100%; width: ${pct}%; transition: width 0.3s ease-in-out; border-radius: 4px;"></div>
                    </div>

                    <!-- Bottom Details -->
                    <div style="display: flex; justify-content: space-between; font-size: 0.78rem; color: var(--color-text-muted);" class="tabular-nums">
                        <span>${cat.percentage_used}% used</span>
                        <span>${cat.remaining < 0 ? `Over by ${formatCurrency(Math.abs(cat.remaining))}` : `${formatCurrency(cat.remaining)} remaining`}</span>
                    </div>
                </div>
            `;
        }).join('');

        // Wire edit buttons
        listContainer.querySelectorAll('.edit-budget-btn').forEach(btn => {
            btn.onclick = () => {
                const catId = btn.dataset.catId;
                const catName = btn.dataset.catName;
                const amt = btn.dataset.amount;
                openBudgetModal(catId, catName, amt);
            };
        });

    } catch (e) {
        listContainer.innerHTML = `<p style="color:var(--color-danger);text-align:center;padding:1.5rem;">Failed to load budgets: ${e.message}</p>`;
    }
}

function openBudgetModal(catId = null, catName = null, amount = '') {
    const modal = document.getElementById('setBudgetModal');
    const title = document.getElementById('budgetModalTitle');
    const select = document.getElementById('budgetCategorySelect');
    const monthInput = document.getElementById('budgetFormMonth');
    const amountInput = document.getElementById('budgetAmountInput');
    const errorDiv = document.getElementById('budgetFormError');

    if (!modal) return;
    errorDiv.style.display = 'none';
    errorDiv.textContent = '';

    title.textContent = catName ? `Edit Budget: ${catName}` : 'Set Monthly Budget';
    monthInput.value = currentMonth;
    amountInput.value = amount || '';

    // Populate category select dropdown
    select.innerHTML = '<option value="">Select category...</option>' + 
        cachedCategories.map(c => `
            <option value="${c.id}" ${catId && Number(catId) === Number(c.id) ? 'selected' : (catName && catName.toLowerCase() === c.name.toLowerCase() ? 'selected' : '')}>
                ${escapeHtml(c.name)}
            </option>
        `).join('');

    modal.classList.add('open');
}
window.openSetBudgetModal = () => openBudgetModal();

async function handleBudgetSubmit(e) {
    e.preventDefault();
    const select = document.getElementById('budgetCategorySelect');
    const monthInput = document.getElementById('budgetFormMonth');
    const amountInput = document.getElementById('budgetAmountInput');
    const errorDiv = document.getElementById('budgetFormError');
    const modal = document.getElementById('setBudgetModal');

    const catId = parseInt(select.value, 10);
    const month = monthInput.value.trim();
    const amount = parseFloat(amountInput.value);

    if (isNaN(catId) || catId <= 0) {
        errorDiv.textContent = 'Please choose a category.';
        errorDiv.style.display = 'block';
        return;
    }

    if (isNaN(amount) || amount < 0) {
        errorDiv.textContent = 'Please enter a valid non-negative amount.';
        errorDiv.style.display = 'block';
        return;
    }

    try {
        const fbUser = getCurrentFirebaseUser();
        if (fbUser && fbUser.uid) {
            const catName = select.options[select.selectedIndex]?.text || 'Category';
            await saveBudgetToFirestore(fbUser.uid, {
                category_id: String(catId),
                category_name: catName,
                monthly_budget: amount
            });
        }
        try {
            await apiRequest('/api/budgets', {
                method: 'POST',
                body: JSON.stringify({
                    category_id: catId,
                    month: month,
                    monthly_amount: amount,
                }),
            });
        } catch (_) {}

        modal.classList.remove('open');
        showToast('Budget saved successfully', 'success');
        await fetchAndRenderBudgets();
    } catch (err) {
        errorDiv.textContent = err.message || 'Failed to save budget.';
        errorDiv.style.display = 'block';
    }
}
