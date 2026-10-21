/**
 * SpendSense - Bill Edit Modal Module (ES Module)
 * Allows users to edit merchant, date, totals, and line items (add/remove/edit)
 * with live arithmetic calculation and number inputs conforming to style rules.
 */

import { apiRequest } from './api.js';

let availableCategories = [
    'Groceries & Supermarket',
    'Food & Dining',
    'Pharmacy & Healthcare',
    'Electronics & Gadgets',
    'Fuel & Transport',
    'Shopping & Clothing',
    'Utilities & Bills',
    'Home & Maintenance',
    'Entertainment',
    'Stationery & Office',
    'General & Miscellaneous',
];

export async function loadCategories() {
    try {
        const res = await apiRequest('/api/categories');
        if (res.categories && res.categories.length > 0) {
            availableCategories = res.categories.map(c => c.name);
        }
    } catch (e) {
        // Fallback to default categories
    }
}

let currentZoom = 1.0;
let currentRotation = 0;

function updateImageViewerTransform() {
    const img = document.getElementById('editReviewImg');
    const label = document.getElementById('zoomLevelLabel');
    if (img) {
        img.style.transform = `scale(${currentZoom}) rotate(${currentRotation}deg)`;
    }
    if (label) {
        label.textContent = `${Math.round(currentZoom * 100)}%`;
    }
}

function initImageViewerControls() {
    const btnZoomIn = document.getElementById('btnZoomIn');
    const btnZoomOut = document.getElementById('btnZoomOut');
    const btnZoomReset = document.getElementById('btnZoomReset');
    const btnRotate = document.getElementById('btnRotateImg');
    const viewport = document.getElementById('editImgViewport');

    if (btnZoomIn) {
        btnZoomIn.onclick = () => {
            currentZoom = Math.min(3.5, currentZoom + 0.25);
            updateImageViewerTransform();
        };
    }
    if (btnZoomOut) {
        btnZoomOut.onclick = () => {
            currentZoom = Math.max(0.5, currentZoom - 0.25);
            updateImageViewerTransform();
        };
    }
    if (btnZoomReset) {
        btnZoomReset.onclick = () => {
            currentZoom = 1.0;
            currentRotation = 0;
            updateImageViewerTransform();
        };
    }
    if (btnRotate) {
        btnRotate.onclick = () => {
            currentRotation = (currentRotation + 90) % 360;
            updateImageViewerTransform();
        };
    }
    if (viewport) {
        viewport.onwheel = (e) => {
            if (e.ctrlKey || e.metaKey || viewport.matches(':hover')) {
                e.preventDefault();
                const delta = e.deltaY < 0 ? 0.15 : -0.15;
                currentZoom = Math.min(3.5, Math.max(0.5, currentZoom + delta));
                updateImageViewerTransform();
            }
        };
    }
}

export function openEditModal(draftData, onSaveCallback) {
    const modal = document.getElementById('editBillModal');
    if (!modal) return;

    // Reset zoom and rotation
    currentZoom = 1.0;
    currentRotation = 0;
    updateImageViewerTransform();
    initImageViewerControls();

    // Setup review image pane
    const reviewImg = document.getElementById('editReviewImg');
    const noImgMsg = document.getElementById('editReviewNoImg');
    const photoTabs = document.getElementById('editMultiPhotoTabs');

    // Gather images (check all_files, preview_urls, file_path, file_name)
    const images = [];
    if (draftData.storage_url) {
        images.push(draftData.storage_url);
    } else if (Array.isArray(draftData.preview_urls) && draftData.preview_urls.length > 0) {
        draftData.preview_urls.forEach(u => images.push(u));
    } else if (Array.isArray(draftData.all_files) && draftData.all_files.length > 0) {
        draftData.all_files.forEach(f => {
            const path = typeof f === 'string' ? f : (f.path || f.file_name);
            if (path) {
                images.push(path.startsWith('http') || path.startsWith('data:') ? path : `/api/bills/file?name=${encodeURIComponent(path.split('/').pop())}`);
            }
        });
    } else if (draftData.file_path || draftData.file_name) {
        const p = draftData.file_path || draftData.file_name;
        images.push(p.startsWith('http') || p.startsWith('data:') ? p : `/api/bills/file?name=${encodeURIComponent(p.split('/').pop())}`);
    }

    if (images.length > 0 && reviewImg) {
        reviewImg.style.display = 'block';
        if (noImgMsg) noImgMsg.style.display = 'none';
        reviewImg.src = images[0];

        // Multi-photo tabs if > 1
        if (photoTabs) {
            if (images.length > 1) {
                photoTabs.style.display = 'flex';
                photoTabs.innerHTML = images.map((imgSrc, i) => `
                    <button type="button" class="btn ${i === 0 ? 'btn-primary' : 'btn-secondary'} btn-photo-tab" data-idx="${i}" style="font-size: 0.72rem; padding: 0.2rem 0.5rem;">
                        Page ${i + 1}
                    </button>
                `).join('');

                photoTabs.querySelectorAll('.btn-photo-tab').forEach(tabBtn => {
                    tabBtn.onclick = () => {
                        const idx = parseInt(tabBtn.dataset.idx, 10);
                        reviewImg.src = images[idx];
                        photoTabs.querySelectorAll('.btn-photo-tab').forEach((b, bi) => {
                            b.className = `btn ${bi === idx ? 'btn-primary' : 'btn-secondary'} btn-photo-tab`;
                        });
                    };
                });
            } else {
                photoTabs.style.display = 'none';
                photoTabs.innerHTML = '';
            }
        }
    } else if (reviewImg) {
        reviewImg.style.display = 'none';
        if (noImgMsg) noImgMsg.style.display = 'block';
        if (photoTabs) photoTabs.style.display = 'none';
    }

    // Load form fields
    document.getElementById('editMerchant').value = draftData.merchant_name || '';
    document.getElementById('editType').value = draftData.merchant_type || 'supermarket';
    document.getElementById('editBillNumber').value = draftData.bill_number || '';
    document.getElementById('editDate').value = draftData.bill_date || new Date().toISOString().split('T')[0];
    document.getElementById('editPayment').value = draftData.payment_method || '';
    document.getElementById('editTaxAmount').value = Number(draftData.tax_amount || 0).toFixed(2);
    document.getElementById('editDiscountAmount').value = Number(draftData.discount_amount || 0).toFixed(2);
    document.getElementById('editGrandTotal').value = Number(draftData.grand_total || 0).toFixed(2);

    const defaultScope = draftData.scope 
        || (draftData.id ? localStorage.getItem('spendsense_bill_scope_' + draftData.id) : null) 
        || (localStorage.getItem('spendsense_active_mode') === 'business' ? 'business' : 'personal');
    const editScopeEl = document.getElementById('editScope');
    if (editScopeEl) {
        editScopeEl.value = defaultScope;
    }

    // Populate line items table
    const tableBody = document.getElementById('editItemsBody');
    tableBody.innerHTML = '';

    const items = JSON.parse(JSON.stringify(draftData.line_items || []));
    items.forEach((item, idx) => {
        addItemRow(tableBody, item, idx);
    });

    // Add item button listener
    const addBtn = document.getElementById('btnAddLineItem');
    addBtn.onclick = () => {
        addItemRow(tableBody, {
            name: '',
            category: 'Groceries & Supermarket',
            quantity: 1,
            unit: 'pcs',
            unit_price: 0,
            tax_percent: 0,
            line_total: 0
        }, tableBody.children.length);
        recalculateTotals();
    };

    // Close button listener
    const closeBtn = document.getElementById('closeEditModalBtn');
    const cancelBtn = document.getElementById('cancelEditBtn');
    const closeModal = () => modal.classList.remove('open');
    closeBtn.onclick = closeModal;
    cancelBtn.onclick = closeModal;

    // Recalculate on tax/discount change
    document.getElementById('editTaxAmount').oninput = recalculateTotals;
    document.getElementById('editDiscountAmount').oninput = recalculateTotals;

    // Save changes button listener
    const saveBtn = document.getElementById('saveEditBtn');
    saveBtn.onclick = () => {
        const updatedItems = [];
        const rows = tableBody.querySelectorAll('tr');
        rows.forEach(row => {
            const name = row.querySelector('.item-name-input').value.trim();
            const cat = row.querySelector('.item-cat-select').value;
            const qty = parseFloat(row.querySelector('.item-qty-input').value) || 1;
            const unit = row.querySelector('.item-unit-input').value.trim() || 'pcs';
            const price = parseFloat(row.querySelector('.item-price-input').value) || 0;
            const tax = parseFloat(row.querySelector('.item-tax-input').value) || 0;
            const total = parseFloat(row.querySelector('.item-total-input').value) || (qty * price);

            if (name !== '') {
                updatedItems.push({
                    name,
                    category: cat,
                    quantity: qty,
                    unit,
                    unit_price: price,
                    tax_percent: tax,
                    line_total: total,
                    confidence: 'high'
                });
            }
        });

        const chosenScope = document.getElementById('editScope')?.value || 'personal';
        if (draftData.id) {
            try {
                localStorage.setItem('spendsense_bill_scope_' + draftData.id, chosenScope);
            } catch (e) {
                console.warn('Scope save note:', e);
            }
        }

        const updatedData = {
            ...draftData,
            scope: chosenScope,
            merchant_name: document.getElementById('editMerchant').value.trim() || 'Unknown Merchant',
            merchant_type: document.getElementById('editType').value,
            bill_number: document.getElementById('editBillNumber').value.trim() || null,
            bill_date: document.getElementById('editDate').value,
            payment_method: document.getElementById('editPayment').value || null,
            tax_amount: parseFloat(document.getElementById('editTaxAmount').value) || 0,
            discount_amount: parseFloat(document.getElementById('editDiscountAmount').value) || 0,
            grand_total: parseFloat(document.getElementById('editGrandTotal').value) || 0,
            line_items: updatedItems,
            warnings: [], // user verified
        };

        modal.classList.remove('open');
        if (typeof onSaveCallback === 'function') {
            onSaveCallback(updatedData);
        }
    };

    modal.classList.add('open');
}

function addItemRow(tbody, item, idx) {
    const tr = document.createElement('tr');

    const catOptions = availableCategories.map(cat => 
        `<option value="${escapeAttr(cat)}" ${cat === item.category ? 'selected' : ''}>${escapeAttr(cat)}</option>`
    ).join('');

    tr.innerHTML = `
        <td>
            <input type="text" class="item-name-input" value="${escapeAttr(item.name || '')}" placeholder="Item name" required>
        </td>
        <td>
            <select class="item-cat-select">
                ${catOptions}
            </select>
        </td>
        <td style="width: 100px;">
            <input type="number" step="any" min="0.01" class="item-qty-input" value="${item.quantity || 1}">
        </td>
        <td style="width: 80px;">
            <input type="text" class="item-unit-input" value="${escapeAttr(item.unit || 'pcs')}" style="text-align: center;">
        </td>
        <td style="width: 110px;">
            <input type="number" step="0.01" min="0" class="item-price-input" value="${Number(item.unit_price || 0).toFixed(2)}">
        </td>
        <td style="width: 90px;">
            <input type="number" step="0.5" min="0" max="100" class="item-tax-input" value="${item.tax_percent || 0}">
        </td>
        <td style="width: 110px;">
            <input type="number" step="0.01" min="0" class="item-total-input" value="${Number(item.line_total || 0).toFixed(2)}">
        </td>
        <td style="width: 40px; text-align: center;">
            <button type="button" class="delete-item-btn" title="Remove item">🗑️</button>
        </td>
    `;

    // Row input event listeners for live recalculation
    const qtyInput = tr.querySelector('.item-qty-input');
    const priceInput = tr.querySelector('.item-price-input');
    const taxInput = tr.querySelector('.item-tax-input');
    const totalInput = tr.querySelector('.item-total-input');
    const deleteBtn = tr.querySelector('.delete-item-btn');

    const updateLine = () => {
        const q = parseFloat(qtyInput.value) || 0;
        const p = parseFloat(priceInput.value) || 0;
        const t = parseFloat(taxInput.value) || 0;
        const sub = q * p;
        const tot = sub + (sub * (t / 100));
        totalInput.value = tot.toFixed(2);
        recalculateTotals();
    };

    qtyInput.oninput = updateLine;
    priceInput.oninput = updateLine;
    taxInput.oninput = updateLine;
    totalInput.oninput = recalculateTotals;

    deleteBtn.onclick = () => {
        tr.remove();
        recalculateTotals();
    };

    tbody.appendChild(tr);
}

function recalculateTotals() {
    const tableBody = document.getElementById('editItemsBody');
    if (!tableBody) return;

    let itemsSum = 0;
    const totals = tableBody.querySelectorAll('.item-total-input');
    totals.forEach(inp => {
        itemsSum += parseFloat(inp.value) || 0;
    });

    const taxAmount = parseFloat(document.getElementById('editTaxAmount').value) || 0;
    const discAmount = parseFloat(document.getElementById('editDiscountAmount').value) || 0;

    let computedGrand = itemsSum;
    // If line totals are already post-tax, grand total is itemsSum - discAmount
    if (discAmount > 0) {
        computedGrand -= discAmount;
    }

    document.getElementById('editGrandTotal').value = Math.max(0, computedGrand).toFixed(2);
}

function escapeAttr(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}
