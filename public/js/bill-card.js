/**
 * SpendSense - Bill Summary Card Module (ES Module)
 * Renders structured bill summaries in chat with grouped items, category breakdown,
 * arithmetic and duplicate warnings, low-confidence highlights, and action buttons.
 */

import { apiRequest } from './api.js';
import { openEditModal } from './bill-modal.js';
import { appendAssistantMessage, appendInsightMessage } from './chat.js';
import { setUploadLimit } from './auth.js';
import { getIcon } from './icons.js';

export function renderBillCard(draftData, containerElement) {
    const card = document.createElement('div');
    card.className = 'bill-card';
    card.dataset.billDraft = JSON.stringify(draftData);

    const currency = draftData.currency || 'INR';
    const currencySymbol = currency === 'INR' ? '₹' : (draftData.currency_symbol || '₹');
    const grandTotal = Number(draftData.grand_total || 0).toFixed(2);
    const merchantName = draftData.merchant_name || 'Unrecognized Merchant';
    const billDate = draftData.bill_date || 'Date unknown';
    const paymentMethod = (draftData.payment_method && String(draftData.payment_method).toLowerCase() !== 'null' && String(draftData.payment_method).trim() !== '') 
        ? draftData.payment_method 
        : null;

    // Group items by category and compute split amounts
    const items = draftData.line_items || [];
    const groupedItems = {};
    let totalItemsCost = 0;
    let myShareItemsCost = 0;
    let hasAnySplit = false;

    items.forEach((item, idx) => {
        const cat = item.category || 'General & Miscellaneous';
        if (!groupedItems[cat]) groupedItems[cat] = [];
        
        // Ensure split_type defaults to 'mine'
        if (!item.split_type) item.split_type = 'mine';
        if (item.split_type !== 'mine') hasAnySplit = true;

        const lineTot = Number(item.line_total || 0);
        let factor = 1.0;
        if (item.split_type === 'shared') factor = 0.5;
        else if (item.split_type === 'someone_else') factor = 0.0;
        item.my_share_amount = lineTot * factor;

        myShareItemsCost += item.my_share_amount;
        totalItemsCost += lineTot;
        groupedItems[cat].push({ ...item, originalIndex: idx });
    });

    const finalBillTotal = Number(draftData.grand_total || 0);
    const taxScaleRatio = totalItemsCost > 0 ? (finalBillTotal / totalItemsCost) : 1;
    const myShareGrandTotal = myShareItemsCost * taxScaleRatio;

    // 1. Header & Document Type Badges
    const isHandwritten = draftData.document_type === 'handwritten' || draftData.document_type === 'mixed';
    const isLowLegibility = draftData.legibility === 'poor';
    const isScreenPhoto = draftData.document_type === 'photo_of_screen';

    let docTypeBadge = '';
    if (isHandwritten) {
        docTypeBadge = `<span class="doc-badge handwritten" style="background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.35); font-size: 0.72rem; font-weight: 700; padding: 0.15rem 0.5rem; border-radius: 999px; margin-left: 0.4rem; display: inline-flex; align-items: center; gap: 0.25rem;">${getIcon('pencil', { size: 12 })} Handwritten — please double-check</span>`;
    } else if (isLowLegibility) {
        docTypeBadge = `<span class="doc-badge poor-legibility" style="background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.35); font-size: 0.72rem; font-weight: 700; padding: 0.15rem 0.5rem; border-radius: 999px; margin-left: 0.4rem; display: inline-flex; align-items: center; gap: 0.25rem;">${getIcon('alert-triangle', { size: 12 })} Low Legibility</span>`;
    } else if (isScreenPhoto) {
        docTypeBadge = `<span class="doc-badge screen-photo" style="background: var(--color-primary-subtle); color: var(--color-primary); border: 1px solid var(--color-border); font-size: 0.72rem; font-weight: 700; padding: 0.15rem 0.5rem; border-radius: 999px; margin-left: 0.4rem; display: inline-flex; align-items: center; gap: 0.25rem;">${getIcon('camera', { size: 12 })} Photo of Screen</span>`;
    }

    const confClass = (conf) => conf === 'low' ? 'confidence-low' : (conf === 'medium' ? 'confidence-medium' : '');

    let headerHtml = `
        <div class="bill-card-header">
            <div>
                <div class="bill-merchant ${confClass(draftData.merchant_name_confidence)}" style="display: flex; align-items: center; flex-wrap: wrap; gap: 0.35rem;">
                    <span style="display: inline-flex; color: var(--color-primary);">${getIcon('receipt', { size: 16 })}</span> <span>${escapeHtml(merchantName)}</span>
                    ${docTypeBadge}
                </div>
                <div class="bill-meta" style="margin-top: 0.25rem; display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap;">
                    <span class="${confClass(draftData.bill_date_confidence)}" style="display: inline-flex; align-items: center; gap: 0.25rem;">${getIcon('calendar', { size: 12 })} ${escapeHtml(billDate)}</span>
                    ${draftData.bill_number ? `<span class="${confClass(draftData.bill_number_confidence)}" style="display: inline-flex; align-items: center; gap: 0.25rem;">${getIcon('tag', { size: 12 })} ${escapeHtml(draftData.bill_number)}</span>` : ''}
                    <span class="${confClass(draftData.payment_method_confidence)}" style="display: inline-flex; align-items: center; gap: 0.25rem;">${getIcon('credit-card', { size: 12 })} ${escapeHtml(paymentMethod || 'Not stated')}</span>
                </div>
            </div>
            <div class="bill-total-badge">
                <div class="bill-total-label">Total Amount</div>
                <div class="bill-total-amount ${confClass(draftData.grand_total_confidence)}">
                    ${currencySymbol}${grandTotal}
                </div>
                ${hasAnySplit ? `
                    <div style="font-size: 0.75rem; font-weight: 700; color: var(--color-primary); margin-top: 0.25rem; background: var(--color-primary-subtle); border: 1px solid var(--color-border); padding: 0.15rem 0.4rem; border-radius: var(--radius-xs); text-align: center;">
                        My Share: ${currencySymbol}${myShareGrandTotal.toFixed(2)}
                    </div>
                ` : ''}
            </div>
        </div>
    `;

    // 2. Warnings Section (Arithmetic, Duplicate, Confidence, Reconciliation)
    const warnings = draftData.warnings || [];
    let warningsHtml = '';
    if (warnings.length > 0) {
        warningsHtml = `<div class="bill-warnings">`;
        warnings.forEach((w, wIdx) => {
            const iconName = w.type === 'duplicate' ? 'alert-triangle' : (w.type === 'arithmetic' ? 'alert-circle' : 'info');
            const isMismatch = w.code === 'SUM_LINES_MISMATCH';

            warningsHtml += `
                <div class="warning-item" style="display: flex; flex-direction: column; align-items: flex-start;">
                    <div style="display: flex; align-items: center; gap: 0.4rem;">
                        <span class="warning-icon" style="display: inline-flex; align-items: center;">${getIcon(iconName, { size: 14 })}</span>
                        <span>${escapeHtml(w.message)}</span>
                    </div>
                    ${isMismatch ? `
                        <div style="margin-top: 0.4rem; display: flex; gap: 0.5rem; flex-wrap: wrap;">
                            <button type="button" class="btn btn-secondary btn-reconcile-written" data-widx="${wIdx}" style="font-size: 0.75rem; padding: 0.2rem 0.5rem;">
                                Use the written total (${currencySymbol}${Number(w.written_total || draftData.grand_total).toFixed(2)})
                            </button>
                            <button type="button" class="btn btn-secondary btn-reconcile-sum" data-widx="${wIdx}" style="font-size: 0.75rem; padding: 0.2rem 0.5rem;">
                                Use the sum of lines (${currencySymbol}${Number(w.sum_of_lines || totalItemsCost).toFixed(2)})
                            </button>
                        </div>
                        ${w.disagreeing_lines && w.disagreeing_lines.length > 0 ? `
                            <div style="font-size: 0.74rem; color: #fca5a5; margin-top: 0.25rem;">
                                Discrepancies: ${w.disagreeing_lines.map(d => escapeHtml(d)).join('; ')}
                            </div>
                        ` : ''}
                    ` : ''}
                </div>
            `;
        });
        warningsHtml += `</div>`;
    }

    // 3. Mini Category Breakdown (Based on Final Bill Total with Tax Allocation)
    let breakdownHtml = '<div class="category-breakdown">';
    const totalForPct = finalBillTotal > 0 ? finalBillTotal : (totalItemsCost > 0 ? totalItemsCost : 1);
    const hasTaxDiff = totalItemsCost > 0 && finalBillTotal > 0 && Math.abs(finalBillTotal - totalItemsCost) > 0.05;

    Object.keys(groupedItems).forEach(cat => {
        const catRawTotal = groupedItems[cat].reduce((sum, it) => sum + Number(it.line_total || 0), 0);
        const catAllocated = hasTaxDiff ? (catRawTotal / totalItemsCost) * finalBillTotal : catRawTotal;
        const pct = Math.round((catAllocated / totalForPct) * 100);
        const subNote = hasTaxDiff ? ` <span style="font-size:0.7rem; color:var(--text-subtle);">(${currencySymbol}${catRawTotal.toFixed(0)} before tax)</span>` : '';
        breakdownHtml += `
            <div class="category-pill" title="Category allocated total including GST/tax">
                <span>${escapeHtml(cat)}</span>
                <span class="pct">${currencySymbol}${catAllocated.toFixed(2)} (${pct}% of total)${subNote}</span>
            </div>
        `;
    });
    breakdownHtml += '</div>';

    // 4. Line Items Grouped List
    let itemsHtml = '<div class="bill-items-list">';
    Object.keys(groupedItems).forEach(cat => {
        itemsHtml += `<div class="category-group-header">${escapeHtml(cat)}</div>`;
        groupedItems[cat].forEach(it => {
            const qty = it.quantity || 1;
            const unit = it.unit || 'pcs';
            const price = Number(it.unit_price || 0).toFixed(2);
            const lineTotal = Number(it.line_total || 0).toFixed(2);
            const isLowConf = it.confidence === 'low' || it.name_confidence === 'low' || it.line_total_confidence === 'low';
            const isMedConf = it.confidence === 'medium' || it.name_confidence === 'medium';
            const itemConfClass = isLowConf ? 'confidence-low' : (isMedConf ? 'confidence-medium' : '');

            const curSplit = it.split_type || 'mine';
            itemsHtml += `
                <div class="bill-item-row ${itemConfClass}" style="display: flex; flex-direction: column; gap: 0.35rem;">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; width: 100%;">
                        <div class="item-left">
                            <span class="item-name">${escapeHtml(it.name || 'Item')}</span>
                            <span class="item-qty-price">${qty} ${escapeHtml(unit)} × ${currencySymbol}${price}</span>
                        </div>
                        <div class="item-right" style="text-align: right;">
                            <div style="font-weight: 600;">${currencySymbol}${lineTotal}</div>
                            ${curSplit !== 'mine' ? `
                                <div style="font-size: 0.72rem; color: var(--color-primary); font-weight: 600;">
                                    My share: ${currencySymbol}${Number(it.my_share_amount || 0).toFixed(2)}
                                </div>
                            ` : ''}
                        </div>
                    </div>
                    <!-- Split Controls -->
                    <div class="split-controls" style="display: flex; gap: 0.3rem; align-items: center; padding-top: 0.2rem; border-top: 1px dashed var(--color-border);">
                        <span style="font-size: 0.72rem; color: var(--text-muted); margin-right: 0.2rem;">Split:</span>
                        <button type="button" class="btn-split-toggle ${curSplit === 'mine' ? 'active' : ''}" data-idx="${it.originalIndex}" data-split="mine" style="font-size: 0.7rem; padding: 0.15rem 0.45rem; border-radius: var(--radius-xs); border: 1px solid ${curSplit === 'mine' ? 'var(--color-primary)' : 'var(--color-border)'}; background: ${curSplit === 'mine' ? 'var(--color-primary-subtle)' : 'transparent'}; color: ${curSplit === 'mine' ? 'var(--color-primary)' : 'var(--text-muted)'}; cursor: pointer; font-weight: 500;">
                            Mine (100%)
                        </button>
                        <button type="button" class="btn-split-toggle ${curSplit === 'shared' ? 'active' : ''}" data-idx="${it.originalIndex}" data-split="shared" style="font-size: 0.7rem; padding: 0.15rem 0.45rem; border-radius: var(--radius-xs); border: 1px solid ${curSplit === 'shared' ? 'var(--color-primary)' : 'var(--color-border)'}; background: ${curSplit === 'shared' ? 'var(--color-primary-subtle)' : 'transparent'}; color: ${curSplit === 'shared' ? 'var(--color-primary)' : 'var(--text-muted)'}; cursor: pointer; font-weight: 500;">
                            Shared (50%)
                        </button>
                        <button type="button" class="btn-split-toggle ${curSplit === 'someone_else' ? 'active' : ''}" data-idx="${it.originalIndex}" data-split="someone_else" style="font-size: 0.7rem; padding: 0.15rem 0.45rem; border-radius: var(--radius-xs); border: 1px solid ${curSplit === 'someone_else' ? 'var(--color-danger)' : 'var(--color-border)'}; background: ${curSplit === 'someone_else' ? 'var(--color-danger-subtle)' : 'transparent'}; color: ${curSplit === 'someone_else' ? 'var(--color-danger)' : 'var(--text-muted)'}; cursor: pointer; font-weight: 500;">
                            Someone else's (0%)
                        </button>
                    </div>
                </div>
            `;
        });
    });
    itemsHtml += '</div>';

    // 5. Actions Footer
    const actionsHtml = `
        <div class="bill-card-actions">
            <button class="btn btn-primary btn-save-bill" type="button" style="display: inline-flex; align-items: center; gap: 0.35rem;">
                ${getIcon('check', { size: 14 })} Looks right, save it
            </button>
            <button class="btn btn-secondary btn-edit-bill" type="button" style="display: inline-flex; align-items: center; gap: 0.35rem;">
                ${getIcon('pencil', { size: 14 })} Edit details
            </button>
            <button class="btn btn-danger-outline btn-discard-bill" type="button" style="display: inline-flex; align-items: center; gap: 0.35rem;">
                ${getIcon('x', { size: 14 })} Discard
            </button>
        </div>
    `;

    card.innerHTML = headerHtml + warningsHtml + breakdownHtml + itemsHtml + actionsHtml;

    // Attach Split Toggle Listeners
    card.querySelectorAll('.btn-split-toggle').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const idx = parseInt(btn.dataset.idx, 10);
            const newSplit = btn.dataset.split;
            if (draftData.line_items && draftData.line_items[idx]) {
                draftData.line_items[idx].split_type = newSplit;
                const updatedCard = renderBillCard(draftData, null);
                card.replaceWith(updatedCard);
            }
        });
    });

    // Attach Reconciliation Action Listeners
    card.querySelectorAll('.btn-reconcile-written').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const wIdx = parseInt(btn.dataset.widx, 10);
            const targetAmount = draftData.warnings[wIdx]?.written_total ?? draftData.grand_total;
            draftData.grand_total = targetAmount;
            draftData.warnings.splice(wIdx, 1);
            const updatedCard = renderBillCard(draftData, null);
            card.replaceWith(updatedCard);
        });
    });

    card.querySelectorAll('.btn-reconcile-sum').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const wIdx = parseInt(btn.dataset.widx, 10);
            const targetAmount = draftData.warnings[wIdx]?.sum_of_lines ?? totalItemsCost;
            draftData.grand_total = targetAmount;
            draftData.warnings.splice(wIdx, 1);
            const updatedCard = renderBillCard(draftData, null);
            card.replaceWith(updatedCard);
        });
    });

    // Attach Action Listeners
    const saveBtn = card.querySelector('.btn-save-bill');
    const editBtn = card.querySelector('.btn-edit-bill');
    const discardBtn = card.querySelector('.btn-discard-bill');

    saveBtn.addEventListener('click', async () => {
        await handleSaveBill(draftData, card);
    });

    editBtn.addEventListener('click', () => {
        openEditModal(draftData, (updatedData) => {
            // Replace draft data and re-render card
            draftData = updatedData;
            const newCard = renderBillCard(draftData, null);
            card.replaceWith(newCard);
        });
    });

    discardBtn.addEventListener('click', async () => {
        await handleDiscardBill(draftData, card);
    });

    if (containerElement) {
        containerElement.appendChild(card);
    }

    return card;
}

async function handleSaveBill(billData, cardElement) {
    const saveBtn = cardElement.querySelector('.btn-save-bill');
    saveBtn.disabled = true;
    saveBtn.innerHTML = 'Saving...';

    try {
        const response = await apiRequest('/api/bills/confirm', {
            method: 'POST',
            body: JSON.stringify({
                bill_data: billData,
                original_gemini: billData, // for accuracy log comparison
            }),
        });

        // Update actions bar to show confirmed status and suggested reminders
        const actionsBar = cardElement.querySelector('.bill-card-actions');
        if (actionsBar) {
            let remListHtml = '';
            if (response.suggested_reminders && response.suggested_reminders.length > 0) {
                remListHtml = `
                    <div style="margin-top: 0.6rem; display: flex; flex-direction: column; gap: 0.4rem; width: 100%;">
                        <div style="font-size: 0.78rem; font-weight: 700; color: var(--color-primary); text-transform: uppercase; display: flex; align-items: center; gap: 0.35rem;">
                            ${getIcon('bell', { size: 13 })} Suggested Reminders:
                        </div>
                        ${response.suggested_reminders.map((rem, rIdx) => `
                            <div style="background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-sm); padding: 0.5rem 0.75rem; display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
                                <div>
                                    <div style="font-size: 0.85rem; font-weight: 600; color: var(--color-text);">${escapeHtml(rem.title)}</div>
                                    <div style="font-size: 0.75rem; color: var(--text-muted);">${escapeHtml(rem.notes || '')} • Due: ${escapeHtml(rem.due_date)}</div>
                                </div>
                                <button type="button" class="btn btn-primary btn-add-sug-rem" data-rem-idx="${rIdx}" style="font-size: 0.75rem; padding: 0.25rem 0.6rem; white-space: nowrap; display: inline-flex; align-items: center; gap: 0.25rem;">
                                    ${getIcon('plus', { size: 12 })} Add Reminder
                                </button>
                            </div>
                        `).join('')}
                    </div>
                `;
            }

            actionsBar.innerHTML = `
                <div style="display: flex; flex-direction: column; width: 100%;">
                    <div style="color: var(--color-primary); font-weight: 600; font-size: 0.9rem; display: flex; align-items: center; gap: 0.4rem;">
                        ${getIcon('check-circle', { size: 16 })} Bill saved successfully to your records.
                    </div>
                    ${remListHtml}
                </div>
            `;

            // Attach listeners to "Add Reminder" buttons
            if (response.suggested_reminders && response.suggested_reminders.length > 0) {
                actionsBar.querySelectorAll('.btn-add-sug-rem').forEach(remBtn => {
                    remBtn.addEventListener('click', async (e) => {
                        e.stopPropagation();
                        const rIdx = parseInt(remBtn.dataset.remIdx, 10);
                        const remData = response.suggested_reminders[rIdx];
                        remBtn.disabled = true;
                        remBtn.textContent = 'Adding...';
                        try {
                            await apiRequest('/api/reminders', {
                                method: 'POST',
                                body: JSON.stringify(remData),
                            });
                            remBtn.innerHTML = `${getIcon('check', { size: 12 })} Added`;
                            remBtn.style.background = 'var(--color-primary-subtle)';
                            remBtn.style.color = 'var(--color-primary)';
                            remBtn.style.borderColor = 'var(--color-primary)';
                        } catch (re) {
                            remBtn.disabled = false;
                            remBtn.textContent = 'Failed';
                            alert('Could not add reminder: ' + re.message);
                        }
                    });
                });
            }
        }

        // Show assistant insight message in chat
        if (response.insight) {
            appendInsightMessage(response.insight);
        }

        // Refresh upload limit pill
        const limitRes = await apiRequest('/api/user/upload-limit');
        setUploadLimit(limitRes);

    } catch (err) {
        console.error('Error saving bill:', err);
        saveBtn.disabled = false;
        saveBtn.innerHTML = `${getIcon('check', { size: 14 })} Looks right, save it`;
        alert('Failed to save bill: ' + (err.message || 'Unknown error'));
    }
}

async function handleDiscardBill(billData, cardElement) {
    if (!confirm('Are you sure you want to discard this bill?')) {
        return;
    }

    try {
        await apiRequest('/api/bills/discard', {
            method: 'POST',
            body: JSON.stringify({ file_name: billData.file_name }),
        });
    } catch (e) {
        console.warn('Discard request error:', e);
    }

    const actionsBar = cardElement.querySelector('.bill-card-actions');
    if (actionsBar) {
        actionsBar.innerHTML = `
            <div style="color: var(--text-muted); font-size: 0.85rem; font-style: italic; display: flex; align-items: center; gap: 0.35rem;">
                ${getIcon('x', { size: 14 })} Bill discarded.
            </div>
        `;
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
