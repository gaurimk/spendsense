/**
 * SpendSense - Bills List & Detail Modal Module (ES Module)
 * Searchable & filterable bills list (date range, merchant, category, amount),
 * click-to-view line items & original uploaded receipt with "Delete this bill" action.
 */

import { apiRequest } from './api.js';

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
                    <h2 style="font-size: 1.4rem; font-weight: 700;">🧾 Saved Bills</h2>
                    <p style="color: var(--text-muted); font-size: 0.88rem;">Search, inspect line items, view attachments, and manage records</p>
                </div>
                <div id="billsCountBadge" style="font-size: 0.85rem; background: var(--bg-surface); padding: 0.35rem 0.75rem; border-radius: var(--radius-full); border: 1px solid var(--border); color: var(--text-muted);">
                    Loading...
                </div>
            </div>

            <!-- Filters Bar -->
            <div class="bills-filters" style="background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 1rem; margin-bottom: 1.25rem;">
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 0.75rem; margin-bottom: 0.75rem;">
                    <!-- Search -->
                    <div class="form-group">
                        <label class="form-label" style="font-size: 0.78rem;">Search Merchant / Bill #</label>
                        <input type="text" class="form-control" id="filterSearch" placeholder="e.g. DMart, Social..." style="font-size: 0.85rem;">
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

            <!-- Bills List Table Area -->
            <div style="flex: 1; overflow-y: auto; background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--radius-md);">
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
                        <tr><td colspan="7" style="text-align: center; padding: 2rem; color: var(--text-muted);">Loading bills...</td></tr>
                    </tbody>
                </table>
            </div>
        </div>

        <!-- Bill Details Modal -->
        <div class="modal-backdrop" id="billDetailModal">
            <div class="modal-window" style="max-width: 780px;">
                <div class="modal-header">
                    <div class="modal-title" id="billDetailTitle">Bill Details</div>
                    <button class="close-btn" id="closeDetailModalBtn" type="button">&times;</button>
                </div>
                <div class="modal-body" id="billDetailBody">
                    <!-- Populated dynamically -->
                </div>
                <div class="modal-footer" style="justify-content: space-between;">
                    <button type="button" class="btn btn-danger-outline" id="btnDeleteBillModal">
                        🗑️ Delete this bill
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
    const hideModal = () => modal.classList.remove('open');
    if (closeBtn) closeBtn.onclick = hideModal;
    if (closeFooterBtn) closeFooterBtn.onclick = hideModal;
}

async function fetchAndRenderBills() {
    const tbody = document.getElementById('billsTableBody');
    const countBadge = document.getElementById('billsCountBadge');
    if (!tbody) return;

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
            tbody.innerHTML = `
                <tr>
                    <td colspan="7" style="text-align: center; padding: 2.5rem; color: var(--text-muted);">
                        No bills match your filters. Upload a receipt or click <strong>⚡ Load Demo Data</strong>.
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = bills.map(b => `
            <tr style="cursor: pointer; transition: background-color 0.1s;" class="bill-row" data-id="${b.id}">
                <td style="padding: 0.75rem 1rem; color: var(--text-muted); font-size: 0.85rem;">${escapeHtml(b.bill_date)}</td>
                <td style="padding: 0.75rem 1rem; font-weight: 600; color: #ffffff;">
                    ${escapeHtml(b.merchant_name)}
                    ${b.categories_summary ? `<div style="font-size:0.75rem; color:var(--text-subtle);">${escapeHtml(b.categories_summary)}</div>` : ''}
                </td>
                <td style="padding: 0.75rem 1rem; font-size: 0.85rem; color: var(--text-muted);">${escapeHtml(b.bill_number || '—')}</td>
                <td style="padding: 0.75rem 1rem; font-size: 0.85rem;"><span style="background:var(--bg-main); padding:0.2rem 0.5rem; border-radius:4px; border:1px solid var(--border);">${escapeHtml(b.payment_method || 'Not stated')}</span></td>
                <td style="padding: 0.75rem 1rem; text-align: center; font-size: 0.85rem;">${b.item_count || 1}</td>
                <td style="padding: 0.75rem 1rem; text-align: right; font-weight: 700; color: var(--accent-green); font-size: 0.95rem;">
                    ₹${Number(b.grand_total).toLocaleString('en-IN', {minimumFractionDigits: 2})}
                </td>
                <td style="padding: 0.75rem 1rem; text-align: center;">
                    <button class="btn btn-secondary view-bill-btn" data-id="${b.id}" style="font-size: 0.75rem; padding: 0.25rem 0.5rem;" type="button">
                        View Details
                    </button>
                </td>
            </tr>
        `).join('');

        // Attach click listeners to rows & view buttons
        tbody.querySelectorAll('.bill-row').forEach(row => {
            row.addEventListener('click', (e) => {
                const billId = row.dataset.id;
                openBillDetailModal(billId);
            });
        });

    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="7" style="color:#ef4444;text-align:center;padding:1.5rem;">Error loading bills: ${err.message}</td></tr>`;
    }
}

export async function openBillDetailModal(billId) {
    const modal = document.getElementById('billDetailModal');
    const body = document.getElementById('billDetailBody');
    const title = document.getElementById('billDetailTitle');
    const deleteBtn = document.getElementById('btnDeleteBillModal');

    if (!modal || !body) return;
    body.innerHTML = '<div style="text-align:center;padding:2rem;">Loading bill details...</div>';
    modal.classList.add('open');

    try {
        const data = await apiRequest(`/api/bills/detail?id=${billId}`);
        const bill = data.bill;
        const items = data.items || [];

        title.textContent = `${bill.merchant_name} (${bill.bill_date})`;

        let attachmentHtml = '';
        if (bill.file_name) {
            const fileUrl = `/uploads/${encodeURIComponent(bill.file_name)}`;
            const isImage = /\.(jpg|jpeg|png|webp)$/i.test(bill.file_name);
            attachmentHtml = `
                <div style="background: var(--bg-main); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 0.85rem; margin-bottom: 1rem;">
                    <div style="font-weight: 600; font-size: 0.85rem; color: var(--text-muted); margin-bottom: 0.5rem; display: flex; align-items: center; justify-content: space-between;">
                        <span>📎 Original Attachment</span>
                        <a href="${fileUrl}" target="_blank" class="btn btn-secondary" style="font-size: 0.75rem; padding: 0.2rem 0.5rem;">Open Fullscreen ↗</a>
                    </div>
                    ${isImage 
                        ? `<div style="max-height: 220px; overflow: hidden; border-radius: 6px; text-align: center;"><img src="${fileUrl}" alt="Receipt" style="max-height: 220px; max-width: 100%; object-fit: contain; border-radius: 4px;"></div>`
                        : `<p style="font-size: 0.85rem; color: var(--text-muted);">PDF Document attached: <a href="${fileUrl}" target="_blank" style="color: var(--primary-light);">View Document</a></p>`
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
                    <button type="button" class="btn btn-secondary" id="btnSaveDetailSplits" style="font-size: 0.75rem; padding: 0.25rem 0.6rem;">
                        💾 Save Item Splits
                    </button>
                </div>
                <div style="border: 1px solid var(--border); border-radius: 6px; overflow-x: auto;">
                    <table style="width: 100%; border-collapse: collapse; font-size: 0.85rem;">
                        <thead>
                            <tr style="background: var(--bg-surface-elevated); text-align: left;">
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
                                <tr style="border-bottom: 1px solid rgba(51,65,85,0.4);" data-item-id="${it.id}">
                                    <td style="padding: 0.4rem 0.6rem; font-weight: 500;">${escapeHtml(it.item_name)}</td>
                                    <td style="padding: 0.4rem 0.6rem; color: var(--text-muted); font-size: 0.8rem;">${escapeHtml(it.category_name || 'General')}</td>
                                    <td style="padding: 0.4rem 0.6rem; text-align: right;">${it.quantity} ${escapeHtml(it.unit || '')}</td>
                                    <td style="padding: 0.4rem 0.6rem; text-align: right;">₹${Number(it.unit_price).toFixed(2)}</td>
                                    <td style="padding: 0.4rem 0.6rem; text-align: right; font-weight: 600;">₹${Number(it.line_total).toFixed(2)}</td>
                                    <td style="padding: 0.4rem 0.6rem; text-align: center;">
                                        <select class="detail-split-select" data-item-id="${it.id}" style="background: var(--bg-surface); color: var(--text-main); border: 1px solid var(--border); border-radius: 4px; padding: 0.2rem 0.35rem; font-size: 0.78rem;">
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
                <div id="splitStatusNotice" style="font-size: 0.78rem; color: var(--text-muted); margin-top: 0.4rem;">
                    Mark items as shared or someone else's to only count your share in Insights and budgets.
                </div>
            </div>
        `;

        body.innerHTML = `
            ${attachmentHtml}
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 0.75rem; background: var(--bg-main); padding: 0.75rem; border-radius: var(--radius-md); border: 1px solid var(--border); margin-bottom: 1rem; font-size: 0.85rem;">
                <div><span style="color:var(--text-muted);">Invoice #:</span> <strong>${escapeHtml(bill.bill_number || 'N/A')}</strong></div>
                <div><span style="color:var(--text-muted);">Date:</span> <strong>${escapeHtml(bill.bill_date)}</strong></div>
                <div><span style="color:var(--text-muted);">Payment:</span> <strong>${escapeHtml(bill.payment_method || 'Not stated')}</strong></div>
                <div><span style="color:var(--text-muted);">Grand Total:</span> <strong style="color:var(--accent-green); font-size:1.05rem;">₹${Number(bill.grand_total).toFixed(2)}</strong></div>
                <div id="modalMyShareBlock"><span style="color:var(--text-muted);">My Share:</span> <strong id="modalMyShareVal" style="color:#34d399; font-size:1.05rem;">₹${myShareTotalVal.toFixed(2)}</strong>${hasCustomSplit ? ' <span style="font-size:0.7rem; color:#a5b4fc;">(Split)</span>' : ''}</div>
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
                    btnSaveSplits.textContent = '✓ Saved!';
                    const updatedShare = Number(splitRes.my_share_total ?? bill.grand_total);
                    const myShareValEl = document.getElementById('modalMyShareVal');
                    if (myShareValEl) {
                        myShareValEl.textContent = `₹${updatedShare.toFixed(2)}`;
                    }
                    const noticeEl = document.getElementById('splitStatusNotice');
                    if (noticeEl) {
                        noticeEl.innerHTML = `<span style="color:#34d399; font-weight:600;">✓ Item splits saved. Your share is ₹${updatedShare.toFixed(2)}. Insights updated.</span>`;
                    }
                    setTimeout(() => {
                        btnSaveSplits.textContent = '💾 Save Item Splits';
                    }, 2500);
                    // Refresh parent bills table
                    fetchAndRenderBills();
                } catch (spErr) {
                    btnSaveSplits.disabled = false;
                    btnSaveSplits.textContent = '💾 Save Item Splits';
                    alert('Failed to update splits: ' + spErr.message);
                }
            };
        }

        deleteBtn.onclick = async () => {
            if (!confirm(`Are you sure you want to delete this bill from ${bill.merchant_name} (₹${bill.grand_total})? This action cannot be undone.`)) {
                return;
            }
            try {
                await apiRequest('/api/bills/delete', {
                    method: 'POST',
                    body: JSON.stringify({ bill_id: bill.id }),
                });
                modal.classList.remove('open');
                alert('Bill deleted successfully.');
                fetchAndRenderBills();
            } catch (delErr) {
                alert('Failed to delete bill: ' + delErr.message);
            }
        };

    } catch (e) {
        body.innerHTML = `<div style="color:#ef4444;text-align:center;padding:2rem;">Error: ${e.message}</div>`;
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
