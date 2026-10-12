/**
 * SpendSense - Bills List & Detail Modal Module (ES Module)
 * Searchable & filterable bills list (date range, merchant, category, amount),
 * click-to-view line items & original uploaded receipt with "Delete this bill" action.
 */

import { apiRequest } from './api.js';
import { formatCurrency, formatDate, escapeHtml, showToast, showConfirmModal } from './utils.js';
import { getIcon } from './icons.js';

let currentFilter = {
    search: '',
    category: '',
    start_date: '',
    end_date: '',
    min_amount: '',
    max_amount: '',
};

export async function loadBillsTab() {
    const container = document.getElementById('screenBills');
    if (!container) return;

    renderBillsContainer(container);
    await fetchAndRenderBills();
}

function renderBillsContainer(container) {
    container.innerHTML = `
        <div class="bills-view-container" style="padding: 1.25rem; max-width: 1100px; margin: 0 auto; width: 100%; height: 100%; display: flex; flex-direction: column;">
            <!-- Header -->
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; flex-wrap: wrap; gap: 0.5rem;">
                <div>
                    <h2 style="font-size: 1.4rem; font-weight: 700; display: flex; align-items: center; gap: 0.5rem;">
                        <span style="color: var(--color-primary); display: flex;">${getIcon('receipt', { size: 22 })}</span>
                        Saved Bills
                    </h2>
                    <p style="color: var(--color-text-muted); font-size: 0.88rem; margin-top: 0.2rem;">Search, inspect line items, view attachments, and manage records</p>
                </div>
                <div id="billsCountBadge" style="font-size: 0.82rem; background: var(--color-surface-raised); padding: 0.35rem 0.75rem; border-radius: var(--radius-full); border: 1px solid var(--color-border); color: var(--color-text-muted); font-weight: 500;">
                    Loading...
                </div>
            </div>

            <!-- Filters Bar -->
            <div class="bills-filters" style="background: var(--color-surface-card); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 1rem; margin-bottom: 1.25rem;">
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 0.75rem; margin-bottom: 0.75rem;">
                    <!-- Search -->
                    <div class="form-group">
                        <label class="form-label" style="font-size: 0.78rem;">Search Merchant / Bill #</label>
                        <input type="text" class="form-control" id="filterSearch" placeholder="e.g. DMart, Pharmacy..." style="font-size: 0.85rem;">
                    </div>

                    <!-- Category -->
                    <div class="form-group">
                        <label class="form-label" style="font-size: 0.78rem;">Category</label>
                        <select class="form-control" id="filterCategory" style="font-size: 0.85rem;">
                            <option value="">All Categories</option>
                            <option value="Groceries & Supermarket">Groceries & Supermarket</option>
                            <option value="Food & Dining">Food & Dining</option>
                            <option value="Pharmacy & Healthcare">Pharmacy & Healthcare</option>
                            <option value="Electronics & Gadgets">Electronics & Gadgets</option>
                            <option value="Fuel & Transport">Fuel & Transport</option>
                            <option value="Shopping & Clothing">Shopping & Clothing</option>
                            <option value="Utilities & Bills">Utilities & Bills</option>
                            <option value="Stationery & Office">Stationery & Office</option>
                            <option value="Home & Maintenance">Home & Maintenance</option>
                        </select>
                    </div>

                    <!-- Start Date -->
                    <div class="form-group">
                        <label class="form-label" style="font-size: 0.78rem;">From Date</label>
                        <input type="date" class="form-control" id="filterStartDate" style="font-size: 0.85rem;">
                    </div>

                    <!-- End Date -->
                    <div class="form-group">
                        <label class="form-label" style="font-size: 0.78rem;">To Date</label>
                        <input type="date" class="form-control" id="filterEndDate" style="font-size: 0.85rem;">
                    </div>

                    <!-- Min Amount -->
                    <div class="form-group">
                        <label class="form-label" style="font-size: 0.78rem;">Min Amount (₹)</label>
                        <input type="number" step="0.01" min="0" class="form-control" id="filterMinAmount" placeholder="0" style="font-size: 0.85rem;">
                    </div>

                    <!-- Max Amount -->
                    <div class="form-group">
                        <label class="form-label" style="font-size: 0.78rem;">Max Amount (₹)</label>
                        <input type="number" step="0.01" min="0" class="form-control" id="filterMaxAmount" placeholder="Any" style="font-size: 0.85rem;">
                    </div>
                </div>

                <div style="display: flex; gap: 0.5rem; justify-content: flex-end;">
                    <button class="btn btn-secondary" id="btnResetFilters" type="button" style="font-size: 0.8rem; padding: 0.35rem 0.75rem;">Reset</button>
                    <button class="btn btn-primary" id="btnApplyFilters" type="button" style="font-size: 0.8rem; padding: 0.35rem 0.85rem;">Apply Filters</button>
                </div>
            </div>

            <!-- Bills List Desktop Table & Mobile Cards -->
            <div class="desktop-bills-table" style="flex: 1; overflow-y: auto; background: var(--color-surface-card); border: 1px solid var(--color-border); border-radius: var(--radius-lg);">
                <table class="items-table" style="width: 100%; border-collapse: collapse;">
                    <thead>
                        <tr>
                            <th style="padding: 0.75rem 1rem;">Date</th>
                            <th style="padding: 0.75rem 1rem;">Merchant</th>
                            <th style="padding: 0.75rem 1rem;">Bill #</th>
                            <th style="padding: 0.75rem 1rem;">Payment</th>
                            <th style="padding: 0.75rem 1rem; text-align: center;">Items</th>
                            <th style="padding: 0.75rem 1rem; text-align: right;">Total Amount</th>
                            <th style="padding: 0.75rem 1rem; text-align: center;">Action</th>
                        </tr>
                    </thead>
                    <tbody id="billsTableBody">
                        <tr><td colspan="7" style="text-align: center; padding: 2rem; color: var(--color-text-muted);">Loading bills...</td></tr>
                    </tbody>
                </table>
            </div>

            <!-- Stacked Cards Container for Mobile -->
            <div class="mobile-bills-cards" id="billsMobileCards" style="flex-direction: column; gap: 0.75rem; padding-bottom: 2rem;">
                <div class="skeleton-box" style="height: 110px;"></div>
                <div class="skeleton-box" style="height: 110px;"></div>
                <div class="skeleton-box" style="height: 110px;"></div>
            </div>
        </div>

        <!-- Bill Details Modal -->
        <div class="modal-backdrop" id="billDetailModal">
            <div class="modal-window" style="max-width: 780px;">
                <div class="sheet-handle"></div>
                <div class="modal-header">
                    <div class="modal-title" id="billDetailTitle">Bill Details</div>
                    <button class="close-btn" id="closeDetailModalBtn" type="button" aria-label="Close dialog">&times;</button>
                </div>
                <div class="modal-body" id="billDetailBody">
                    <!-- Populated dynamically -->
                </div>
                <div class="modal-footer" style="justify-content: space-between;">
                    <button type="button" class="btn btn-danger-outline" id="btnDeleteBillModal" style="display: inline-flex; align-items: center; gap: 0.35rem;">
                        ${getIcon('trash-2', { size: 15 })} Delete this bill
                    </button>
                    <button type="button" class="btn btn-secondary" id="btnCloseDetailBtn">
                        Close
                    </button>
                </div>
            </div>
        </div>
    `;

    // Filter listeners
    document.getElementById('btnApplyFilters').onclick = () => {
        currentFilter.search = document.getElementById('filterSearch').value.trim();
        currentFilter.category = document.getElementById('filterCategory').value;
        currentFilter.start_date = document.getElementById('filterStartDate').value;
        currentFilter.end_date = document.getElementById('filterEndDate').value;
        currentFilter.min_amount = document.getElementById('filterMinAmount').value;
        currentFilter.max_amount = document.getElementById('filterMaxAmount').value;
        fetchAndRenderBills();
    };

    document.getElementById('btnResetFilters').onclick = () => {
        document.getElementById('filterSearch').value = '';
        document.getElementById('filterCategory').value = '';
        document.getElementById('filterStartDate').value = '';
        document.getElementById('filterEndDate').value = '';
        document.getElementById('filterMinAmount').value = '';
        document.getElementById('filterMaxAmount').value = '';
        currentFilter = { search: '', category: '', start_date: '', end_date: '', min_amount: '', max_amount: '' };
        fetchAndRenderBills();
    };

    // Close detail modal buttons
    const closeBtn = document.getElementById('closeDetailModalBtn');
    const closeFooterBtn = document.getElementById('btnCloseDetailBtn');
    const modal = document.getElementById('billDetailModal');
    const hideModal = () => {
        modal.classList.remove('open');
        document.body.classList.remove('modal-open');
    };
    if (closeBtn) closeBtn.onclick = hideModal;
    if (closeFooterBtn) closeFooterBtn.onclick = hideModal;
}

async function fetchAndRenderBills() {
    const tbody = document.getElementById('billsTableBody');
    const mobileCards = document.getElementById('billsMobileCards');
    const countBadge = document.getElementById('billsCountBadge');
    if (!tbody) return;

    // Loading Skeletons
    tbody.innerHTML = `
        <tr><td colspan="7" style="padding: 1.5rem;"><div class="skeleton-box" style="height: 32px; width: 100%;"></div></td></tr>
        <tr><td colspan="7" style="padding: 1.5rem;"><div class="skeleton-box" style="height: 32px; width: 100%;"></div></td></tr>
        <tr><td colspan="7" style="padding: 1.5rem;"><div class="skeleton-box" style="height: 32px; width: 100%;"></div></td></tr>
    `;
    if (mobileCards) {
        mobileCards.innerHTML = `
            <div class="skeleton-box" style="height: 110px;"></div>
            <div class="skeleton-box" style="height: 110px;"></div>
            <div class="skeleton-box" style="height: 110px;"></div>
        `;
    }

    const queryParams = new URLSearchParams();
    if (currentFilter.search) queryParams.set('search', currentFilter.search);
    if (currentFilter.category) queryParams.set('category', currentFilter.category);
    if (currentFilter.start_date) queryParams.set('start_date', currentFilter.start_date);
    if (currentFilter.end_date) queryParams.set('end_date', currentFilter.end_date);
    if (currentFilter.min_amount) queryParams.set('min_amount', currentFilter.min_amount);
    if (currentFilter.max_amount) queryParams.set('max_amount', currentFilter.max_amount);

    try {
        const data = await apiRequest('/api/bills?' + queryParams.toString());
        const bills = data.bills || [];

        if (countBadge) {
            const countNum = data.total_count || bills.length;
            countBadge.textContent = `${countNum} ${countNum === 1 ? 'bill' : 'bills'} found`;
        }

        if (bills.length === 0) {
            const emptyHtml = `
                <div style="padding: 3rem 1rem; text-align: center; color: var(--color-text-muted);">
                    <div style="margin-bottom: 0.75rem; color: var(--color-primary); display: flex; justify-content: center;">
                        ${getIcon('receipt', { size: 36 })}
                    </div>
                    <div style="font-weight: 600; font-size: 1.1rem; color: var(--color-text);">No bills found</div>
                    <p style="margin: 0.35rem 0 1.25rem; font-size: 0.85rem;">Upload a receipt in chat or load demo data from Settings.</p>
                    <button class="btn btn-primary" onclick="window.switchTab('screenChat')" type="button" style="display: inline-flex; align-items: center; gap: 0.35rem; margin: 0 auto;">
                        ${getIcon('message-square', { size: 14 })} Go to Chat
                    </button>
                </div>
            `;
            tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; border: none;">${emptyHtml}</td></tr>`;
            if (mobileCards) mobileCards.innerHTML = emptyHtml;
            return;
        }

        // Render Desktop Rows
        tbody.innerHTML = bills.map(b => `
            <tr style="cursor: pointer; transition: background-color 0.1s;" class="bill-row" data-id="${b.id}">
                <td style="padding: 0.75rem 1rem; color: var(--color-text-muted); font-size: 0.85rem;">${formatDate(b.bill_date)}</td>
                <td style="padding: 0.75rem 1rem; font-weight: 600; color: var(--color-text);">
                    ${escapeHtml(b.merchant_name)}
                    ${b.categories_summary ? `<div style="font-size:0.75rem; color:var(--color-text-subtle);">${escapeHtml(b.categories_summary)}</div>` : ''}
                </td>
                <td style="padding: 0.75rem 1rem; font-size: 0.85rem; color: var(--color-text-muted);">${escapeHtml(b.bill_number || '—')}</td>
                <td style="padding: 0.75rem 1rem; font-size: 0.85rem;"><span style="background:var(--color-surface-raised); padding:0.2rem 0.5rem; border-radius:4px; border:1px solid var(--color-border);">${escapeHtml(b.payment_method || 'Not stated')}</span></td>
                <td style="padding: 0.75rem 1rem; text-align: center; font-size: 0.85rem;" class="tabular-nums">${b.item_count || 1}</td>
                <td style="padding: 0.75rem 1rem; text-align: right; font-weight: 700; color: var(--color-accent); font-size: 0.95rem;" class="tabular-nums">
                    ${formatCurrency(Number(b.grand_total))}
                </td>
                <td style="padding: 0.75rem 1rem; text-align: center;">
                    <button class="btn btn-secondary view-bill-btn" data-id="${b.id}" style="font-size: 0.75rem; padding: 0.25rem 0.5rem;" type="button">
                        View Details
                    </button>
                </td>
            </tr>
        `).join('');

        // Render Mobile Cards
        if (mobileCards) {
            mobileCards.innerHTML = bills.map(b => `
                <div class="bill-mobile-card bill-row" data-id="${b.id}" style="background: var(--color-surface-card); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 1rem; cursor: pointer; display: flex; flex-direction: column; gap: 0.6rem; box-shadow: var(--shadow-sm);">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem;">
                        <div>
                            <div style="font-weight: 700; font-size: 1rem; color: var(--color-text);">${escapeHtml(b.merchant_name)}</div>
                            <div style="font-size: 0.78rem; color: var(--color-text-muted); margin-top: 0.15rem;">${formatDate(b.bill_date)} ${b.bill_number ? `• #${escapeHtml(b.bill_number)}` : ''}</div>
                        </div>
                        <div style="text-align: right;">
                            <div style="font-weight: 800; font-size: 1.1rem; color: var(--color-accent);" class="tabular-nums">${formatCurrency(Number(b.grand_total))}</div>
                            <span style="font-size: 0.72rem; background: var(--color-surface-raised); padding: 0.15rem 0.4rem; border-radius: 4px; border: 1px solid var(--color-border); color: var(--color-text-muted);">
                                ${escapeHtml(b.payment_method || 'Not stated')}
                            </span>
                        </div>
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px dashed var(--color-border-subtle); padding-top: 0.5rem;">
                        <span style="font-size: 0.78rem; color: var(--color-text-muted);">
                            ${b.item_count || 1} ${(b.item_count === 1) ? 'item' : 'items'} ${b.categories_summary ? `• ${escapeHtml(b.categories_summary)}` : ''}
                        </span>
                        <button class="btn btn-secondary view-bill-btn" data-id="${b.id}" type="button" style="font-size: 0.75rem; padding: 0.25rem 0.6rem;">
                            View Details
                        </button>
                    </div>
                </div>
            `).join('');
        }

        // Attach click listeners to rows & view buttons on both desktop and mobile
        document.querySelectorAll('.bill-row').forEach(row => {
            row.addEventListener('click', () => {
                const billId = row.dataset.id;
                openBillDetailModal(billId);
            });
        });

    } catch (err) {
        const errorHtml = `
            <div style="padding: 2.5rem 1rem; text-align: center; color: var(--color-danger);">
                <p style="font-size: 0.9rem; margin-bottom: 0.75rem;">Failed to load bills: ${escapeHtml(err.message || 'Network error')}</p>
                <button class="btn btn-secondary" onclick="window.loadBills()" type="button" style="display: inline-flex; align-items: center; gap: 0.35rem; margin: 0 auto;">
                    ${getIcon('refresh-cw', { size: 14 })} Retry
                </button>
            </div>
        `;
        tbody.innerHTML = `<tr><td colspan="7" style="border: none;">${errorHtml}</td></tr>`;
        if (mobileCards) mobileCards.innerHTML = errorHtml;
    }
}

export async function openBillDetailModal(billId) {
    const modal = document.getElementById('billDetailModal');
    const body = document.getElementById('billDetailBody');
    const title = document.getElementById('billDetailTitle');
    const deleteBtn = document.getElementById('btnDeleteBillModal');

    if (!modal || !body) return;
    body.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--color-text-muted);">Loading bill details...</div>';
    modal.classList.add('open');
    document.body.classList.add('modal-open');

    try {
        const data = await apiRequest(`/api/bills/detail?id=${billId}`);
        const bill = data.bill;
        const items = data.items || [];

        title.textContent = `${bill.merchant_name} (${formatDate(bill.bill_date)})`;

        let attachmentHtml = '';
        if (bill.file_name) {
            const fileUrl = `/uploads/${encodeURIComponent(bill.file_name)}`;
            const isImage = /\.(jpg|jpeg|png|webp)$/i.test(bill.file_name);
            attachmentHtml = `
                <div style="background: var(--color-surface-bg); border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 0.85rem; margin-bottom: 1rem;">
                    <div style="font-weight: 600; font-size: 0.85rem; color: var(--color-text-muted); margin-bottom: 0.5rem; display: flex; align-items: center; justify-content: space-between;">
                        <span style="display: flex; align-items: center; gap: 0.35rem;">
                            ${getIcon('paperclip', { size: 14 })} Original Attachment
                        </span>
                        <a href="${fileUrl}" target="_blank" class="btn btn-secondary" style="font-size: 0.75rem; padding: 0.2rem 0.5rem;">Open Fullscreen</a>
                    </div>
                    ${isImage 
                        ? `<div style="max-height: 220px; overflow: hidden; border-radius: 6px; text-align: center;"><img src="${fileUrl}" alt="Receipt" style="max-height: 220px; max-width: 100%; object-fit: contain; border-radius: 4px;"></div>`
                        : `<p style="font-size: 0.85rem; color: var(--color-text-muted);">Document attached: <a href="${fileUrl}" target="_blank" style="color: var(--color-primary);">View Document</a></p>`
                    }
                </div>
            `;
        }

        const myShareTotalVal = bill.my_share_total !== null ? Number(bill.my_share_total) : Number(bill.grand_total);
        const hasCustomSplit = bill.my_share_total !== null && Math.abs(Number(bill.my_share_total) - Number(bill.grand_total)) > 0.01;

        let itemsHtml = `
            <div style="margin-bottom: 1rem;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; flex-wrap: wrap; gap: 0.5rem;">
                    <h4 style="font-size: 0.9rem; font-weight: 700; margin: 0;">Line Items (${items.length})</h4>
                    <button type="button" class="btn btn-secondary" id="btnSaveDetailSplits" style="font-size: 0.75rem; padding: 0.25rem 0.6rem; display: inline-flex; align-items: center; gap: 0.3rem;">
                        ${getIcon('check', { size: 13 })} Save Item Splits
                    </button>
                </div>
                <div style="border: 1px solid var(--color-border); border-radius: 6px; overflow-x: auto;">
                    <table style="width: 100%; border-collapse: collapse; font-size: 0.85rem;">
                        <thead>
                            <tr style="background: var(--color-surface-raised); text-align: left;">
                                <th style="padding: 0.4rem 0.6rem;">Item</th>
                                <th style="padding: 0.4rem 0.6rem;">Category</th>
                                <th style="padding: 0.4rem 0.6rem; text-align: right;">Qty</th>
                                <th style="padding: 0.4rem 0.6rem; text-align: right;">Price</th>
                                <th style="padding: 0.4rem 0.6rem; text-align: right;">Total</th>
                                <th style="padding: 0.4rem 0.6rem; text-align: center;">My Split</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${items.map(it => `
                                <tr style="border-bottom: 1px solid var(--color-border-subtle);" data-item-id="${it.id}">
                                    <td style="padding: 0.4rem 0.6rem; font-weight: 500;">${escapeHtml(it.item_name)}</td>
                                    <td style="padding: 0.4rem 0.6rem; color: var(--color-text-muted); font-size: 0.8rem;">${escapeHtml(it.category_name || 'General')}</td>
                                    <td style="padding: 0.4rem 0.6rem; text-align: right;" class="tabular-nums">${it.quantity} ${escapeHtml(it.unit || '')}</td>
                                    <td style="padding: 0.4rem 0.6rem; text-align: right;" class="tabular-nums">${formatCurrency(Number(it.unit_price))}</td>
                                    <td style="padding: 0.4rem 0.6rem; text-align: right; font-weight: 600;" class="tabular-nums">${formatCurrency(Number(it.line_total))}</td>
                                    <td style="padding: 0.4rem 0.6rem; text-align: center;">
                                        <select class="detail-split-select" data-item-id="${it.id}" style="background: var(--color-surface-card); color: var(--color-text); border: 1px solid var(--color-border); border-radius: 4px; padding: 0.2rem 0.35rem; font-size: 0.78rem;">
                                            <option value="mine" ${(it.split_type || 'mine') === 'mine' ? 'selected' : ''}>Mine (100%)</option>
                                            <option value="shared" ${it.split_type === 'shared' ? 'selected' : ''}>Shared (50%)</option>
                                            <option value="someone_else" ${it.split_type === 'someone_else' ? 'selected' : ''}>Someone else's (0%)</option>
                                        </select>
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
                <div id="splitStatusNotice" style="font-size: 0.78rem; color: var(--color-text-muted); margin-top: 0.4rem;">
                    Mark items as shared or someone else's to only count your share in Insights and budgets.
                </div>
            </div>
        `;

        body.innerHTML = `
            ${attachmentHtml}
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 0.75rem; background: var(--color-surface-bg); padding: 0.75rem; border-radius: var(--radius-md); border: 1px solid var(--color-border); margin-bottom: 1rem; font-size: 0.85rem;">
                <div><span style="color:var(--color-text-muted);">Invoice #:</span> <strong>${escapeHtml(bill.bill_number || 'N/A')}</strong></div>
                <div><span style="color:var(--color-text-muted);">Date:</span> <strong>${formatDate(bill.bill_date)}</strong></div>
                <div><span style="color:var(--color-text-muted);">Payment:</span> <strong>${escapeHtml(bill.payment_method || 'Not stated')}</strong></div>
                <div><span style="color:var(--color-text-muted);">Grand Total:</span> <strong style="color:var(--color-accent); font-size:1.05rem;" class="tabular-nums">${formatCurrency(Number(bill.grand_total))}</strong></div>
                <div id="modalMyShareBlock"><span style="color:var(--color-text-muted);">My Share:</span> <strong id="modalMyShareVal" style="color:var(--color-success); font-size:1.05rem;" class="tabular-nums">${formatCurrency(myShareTotalVal)}</strong>${hasCustomSplit ? ' <span style="font-size:0.7rem; color:var(--color-primary);">(Split)</span>' : ''}</div>
            </div>
            ${itemsHtml}
        `;

        // Save Splits Listener
        const btnSaveSplits = document.getElementById('btnSaveDetailSplits');
        if (btnSaveSplits) {
            btnSaveSplits.onclick = async () => {
                const selects = body.querySelectorAll('.detail-split-select');
                const splits = [];
                selects.forEach(sel => {
                    splits.push({
                        id: parseInt(sel.dataset.itemId, 10),
                        split_type: sel.value,
                    });
                });

                btnSaveSplits.disabled = true;
                btnSaveSplits.textContent = 'Saving...';

                try {
                    const splitRes = await apiRequest('/api/bills/update-split', {
                        method: 'POST',
                        body: JSON.stringify({
                            bill_id: bill.id,
                            splits: splits,
                        }),
                    });

                    btnSaveSplits.disabled = false;
                    btnSaveSplits.innerHTML = `${getIcon('check', { size: 13 })} Saved!`;
                    const updatedShare = Number(splitRes.my_share_total ?? bill.grand_total);
                    const myShareValEl = document.getElementById('modalMyShareVal');
                    if (myShareValEl) {
                        myShareValEl.textContent = formatCurrency(updatedShare);
                    }
                    const noticeEl = document.getElementById('splitStatusNotice');
                    if (noticeEl) {
                        noticeEl.innerHTML = `<span style="color:var(--color-success); font-weight:600;">Item splits saved. Your share is ${formatCurrency(updatedShare)}. Insights updated.</span>`;
                    }
                    showToast('Item splits updated successfully', 'success');
                    setTimeout(() => {
                        btnSaveSplits.innerHTML = `${getIcon('check', { size: 13 })} Save Item Splits`;
                    }, 2500);
                    // Refresh parent bills table
                    fetchAndRenderBills();
                } catch (spErr) {
                    btnSaveSplits.disabled = false;
                    btnSaveSplits.innerHTML = `${getIcon('check', { size: 13 })} Save Item Splits`;
                    showToast('Failed to update splits: ' + spErr.message, 'danger');
                }
            };
        }

        deleteBtn.onclick = async () => {
            const confirmed = await showConfirmModal(
                `Are you sure you want to delete this bill from ${bill.merchant_name} (${formatCurrency(Number(bill.grand_total))})? This action cannot be undone.`,
                'Delete Bill'
            );
            if (!confirmed) return;

            try {
                await apiRequest('/api/bills/delete', {
                    method: 'POST',
                    body: JSON.stringify({ bill_id: bill.id }),
                });
                modal.classList.remove('open');
                showToast('Bill deleted successfully.', 'success');
                fetchAndRenderBills();
            } catch (delErr) {
                showToast('Failed to delete bill: ' + delErr.message, 'danger');
            }
        };

    } catch (e) {
        body.innerHTML = `<div style="color:var(--color-danger);text-align:center;padding:2rem;">Error: ${e.message}</div>`;
    }
}
