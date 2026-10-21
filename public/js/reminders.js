/**
 * SpendSense - Reminders Screen Controller
 * Manages warranty expirations, return windows, and due dates.
 * Supports add, edit, delete, toggle completion, and bill suggestions.
 */

import { apiRequest } from './api.js';
import { formatDate, escapeHtml, showToast, showConfirmModal } from './utils.js';
import { getIcon } from './icons.js';
import { getCurrentFirebaseUser } from './firebase-auth.js';
import { getRemindersFromFirestore, saveReminderToFirestore, updateReminderInFirestore, toggleReminderInFirestore, deleteReminderFromFirestore } from './firebase-firestore.js';

let activeFilter = 'all';
let cachedReminders = { upcoming: [], overdue: [], completed: [], reminders: [] };

export async function loadRemindersTab() {
    const container = document.getElementById('screenReminders');
    if (!container) return;

    const activeMode = localStorage.getItem('spendsense_active_mode') || 'personal';
    const isBiz = activeMode === 'business';

    container.innerHTML = `
        <div style="max-width: 950px; margin: 0 auto; width: 100%; padding: 1.25rem;">
            <!-- Header -->
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.25rem; flex-wrap: wrap; gap: 0.75rem;">
                <div>
                    <h2 style="font-size: 1.4rem; font-weight: 700; display: flex; align-items: center; gap: 0.5rem;">
                        <span style="color: var(--color-warning); display: flex;">${getIcon('bell', { size: 22 })}</span>
                        ${isBiz ? 'Commercial Payables & Compliance Deadlines' : 'Warranty & Return Reminders'}
                    </h2>
                    <p style="color: var(--color-text-muted); font-size: 0.88rem; margin-top: 0.2rem;">
                        ${isBiz ? 'Track Net-30 supplier invoice payment deadlines, warranties, and GST tax return due dates' : 'Track gadget warranties, apparel exchange windows, and upcoming bills.'}
                    </p>
                </div>
                <button id="remBtnAddReminder" class="btn btn-primary" type="button" style="display: inline-flex; align-items: center; gap: 0.35rem;">
                    ${getIcon('plus', { size: 14 })} ${isBiz ? 'Add Payable / Reminder' : 'Add Reminder'}
                </button>
            </div>

            <!-- Due Soon / Overdue Alert Banner -->
            <div id="remDueAlertBanner" style="display: none; background: var(--color-danger-subtle); border: 1px solid var(--color-danger); border-radius: var(--radius-md); padding: 1rem; margin-bottom: 1.25rem;">
                <div style="display: flex; align-items: center; gap: 0.5rem; color: var(--color-danger); font-weight: 700; font-size: 0.95rem;">
                    <span aria-hidden="true" style="display: flex;">${getIcon('alert-triangle', { size: 16 })}</span>
                    <span id="remDueAlertText">You have deadlines requiring immediate attention!</span>
                </div>
                <div id="remDueAlertList" style="margin-top: 0.5rem; font-size: 0.85rem; color: var(--color-danger);"></div>
            </div>

            <!-- Filter Tabs as Segmented Control -->
            <div style="margin-bottom: 1.25rem;">
                <div class="segmented-control" id="remFilterSegmentedControl">
                    <button class="segmented-item rem-filter-btn active" data-filter="all" type="button">
                        All (<span id="remCountAll">0</span>)
                    </button>
                    <button class="segmented-item rem-filter-btn" data-filter="upcoming" type="button">
                        <span style="color: var(--color-success); display: flex;">${getIcon('clock', { size: 13 })}</span>
                        Upcoming (<span id="remCountUpcoming">0</span>)
                    </button>
                    <button class="segmented-item rem-filter-btn" data-filter="overdue" type="button" style="color: var(--color-danger);">
                        <span style="color: var(--color-danger); display: flex;">${getIcon('alert-circle', { size: 13 })}</span>
                        Overdue (<span id="remCountOverdue">0</span>)
                    </button>
                    <button class="segmented-item rem-filter-btn" data-filter="completed" type="button">
                        <span style="color: var(--color-success); display: flex;">${getIcon('check-circle', { size: 13 })}</span>
                        Completed (<span id="remCountCompleted">0</span>)
                    </button>
                </div>
            </div>

            <!-- Reminders List -->
            <div id="remindersListContainer" style="display: flex; flex-direction: column; gap: 0.85rem;">
                <div style="text-align: center; color: var(--color-text-muted); padding: 2rem;">Loading reminders...</div>
            </div>
        </div>

        <!-- Add / Edit Reminder Modal -->
        <div class="modal-backdrop" id="remModalOverlay">
            <div class="modal-window" style="max-width: 480px;">
                <div class="modal-header">
                    <div class="modal-title" id="remModalTitle">Add Reminder</div>
                    <button class="close-btn" id="remModalCloseBtn" type="button" aria-label="Close dialog">&times;</button>
                </div>
                <div class="modal-body">
                    <form id="remForm">
                        <input type="hidden" id="remInputId" value="">
                        <input type="hidden" id="remInputBillId" value="">

                        <div class="form-group" style="margin-bottom: 0.85rem;">
                            <label class="form-label">Reminder Title *</label>
                            <input type="text" id="remInputTitle" class="form-control" placeholder="e.g. 1-Year Warranty: JBL Headphones" required>
                        </div>

                        <div class="form-group" style="margin-bottom: 0.85rem;">
                            <label class="form-label">Type *</label>
                            <select id="remInputType" class="form-control">
                                <option value="bill_due">Supplier Invoice Due / Net-30 Payable</option>
                                <option value="gst_filing">GST Tax Filing Deadline (GSTR-3B / 1)</option>
                                <option value="warranty">Warranty Coverage</option>
                                <option value="return_deadline">Return / Exchange Window</option>
                                <option value="other">Other Reminder</option>
                            </select>
                        </div>

                        <div class="form-group" style="margin-bottom: 0.85rem;">
                            <label class="form-label">Due / Expiry Date *</label>
                            <input type="date" id="remInputDueDate" class="form-control" required>
                        </div>

                        <div class="form-group" style="margin-bottom: 0.85rem;">
                            <label class="form-label">Notes & Details</label>
                            <textarea id="remInputNotes" class="form-control" rows="2" placeholder="e.g. Purchased at Croma with bill #CR-849"></textarea>
                        </div>

                        <div id="remFormError" style="color: var(--color-danger); font-size: 0.85rem; margin-bottom: 0.75rem; display: none;"></div>

                        <div style="display: flex; justify-content: flex-end; gap: 0.75rem; margin-top: 1rem;">
                            <button type="button" class="btn btn-secondary" id="remModalCancelBtn">Cancel</button>
                            <button type="submit" class="btn btn-primary" id="remModalSaveBtn">Save Reminder</button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    `;

    // Filter clicks
    document.querySelectorAll('.rem-filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.rem-filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            activeFilter = btn.dataset.filter;
            renderRemindersList();
        });
    });

    // Add button
    document.getElementById('remBtnAddReminder')?.addEventListener('click', () => {
        openReminderModal();
    });

    // Modal buttons
    document.getElementById('remModalCloseBtn')?.addEventListener('click', closeReminderModal);
    document.getElementById('remModalCancelBtn')?.addEventListener('click', closeReminderModal);
    document.getElementById('remForm')?.addEventListener('submit', (e) => {
        e.preventDefault();
        saveReminderForm();
    });

    await fetchAndRenderReminders();

    if (!container.dataset.modeListenerAttached) {
        container.dataset.modeListenerAttached = 'true';
        window.addEventListener('modechanged', () => {
            const activeScreen = document.querySelector('.screen-view.active');
            if (activeScreen && activeScreen.id === 'screenReminders') {
                loadRemindersTab();
            }
        });
    }
}

async function fetchAndRenderReminders() {
    const container = document.getElementById('remindersListContainer');
    if (container) {
        container.innerHTML = `
            <div class="skeleton-box" style="height: 72px;"></div>
            <div class="skeleton-box" style="height: 72px;"></div>
            <div class="skeleton-box" style="height: 72px;"></div>
        `;
    }

    try {
        let data = null;
        const fbUser = getCurrentFirebaseUser();
        if (fbUser && fbUser.uid) {
            const list = await getRemindersFromFirestore(fbUser.uid);
            const todayStr = new Date().toISOString().split('T')[0];
            const upcoming = [];
            const overdue = [];
            const completed = [];
            const dueSoon = [];

            list.forEach(r => {
                const dueDate = r.due_date || todayStr;
                const daysDiff = Math.ceil((new Date(dueDate) - new Date(todayStr)) / (1000 * 60 * 60 * 24));
                r.days_remaining = daysDiff;

                if (r.is_completed) {
                    completed.push(r);
                } else if (daysDiff < 0) {
                    overdue.push(r);
                    dueSoon.push(r);
                } else {
                    upcoming.push(r);
                    if (daysDiff <= 7) dueSoon.push(r);
                }
            });

            data = {
                reminders: list,
                upcoming: upcoming,
                overdue: overdue,
                completed: completed,
                due_soon: dueSoon
            };
        } else {
            data = await apiRequest('/api/reminders');
        }
        cachedReminders = data;

        // Update counts
        const allCount = (data.reminders || []).length;
        const upCount = (data.upcoming || []).length;
        const ovCount = (data.overdue || []).length;
        const compCount = (data.completed || []).length;

        const countAllEl = document.getElementById('remCountAll');
        const countUpEl = document.getElementById('remCountUpcoming');
        const countOvEl = document.getElementById('remCountOverdue');
        const countCompEl = document.getElementById('remCountCompleted');

        if (countAllEl) countAllEl.textContent = allCount;
        if (countUpEl) countUpEl.textContent = upCount;
        if (countOvEl) countOvEl.textContent = ovCount;
        if (countCompEl) countCompEl.textContent = compCount;

        // Check due soon (within 7 days) and overdue
        const dueSoon = data.due_soon || [];
        const alertBanner = document.getElementById('remDueAlertBanner');
        const alertList = document.getElementById('remDueAlertList');

        if (dueSoon.length > 0 && alertBanner && alertList) {
            alertBanner.style.display = 'block';
            alertList.innerHTML = dueSoon.map(d => `
                <div style="margin-top: 0.25rem;">
                    <strong>${escapeHtml(d.title)}</strong> &bull; Due: ${formatDate(d.due_date)} 
                    <span style="font-weight: 700;">(${d.days_remaining < 0 ? `${Math.abs(d.days_remaining)} days overdue` : (d.days_remaining === 0 ? 'Due Today!' : `In ${d.days_remaining} days`)})</span>
                </div>
            `).join('');
        } else if (alertBanner) {
            alertBanner.style.display = 'none';
        }

        renderRemindersList();
    } catch (e) {
        console.error('Error fetching reminders:', e);
        if (container) {
            container.innerHTML = `
                <div style="padding: 2.5rem 1rem; text-align: center; color: var(--color-danger);">
                    <p style="font-size: 0.9rem; margin-bottom: 0.75rem;">Failed to load reminders: ${escapeHtml(e.message || e)}</p>
                    <button class="btn btn-secondary" onclick="window.loadReminders()" type="button" style="display: inline-flex; align-items: center; gap: 0.35rem; margin: 0 auto;">
                        ${getIcon('refresh-cw', { size: 14 })} Retry
                    </button>
                </div>
            `;
        }
    }
}

function renderRemindersList() {
    const container = document.getElementById('remindersListContainer');
    if (!container) return;

    let items = [];
    if (activeFilter === 'upcoming') {
        items = cachedReminders.upcoming || [];
    } else if (activeFilter === 'overdue') {
        items = cachedReminders.overdue || [];
    } else if (activeFilter === 'completed') {
        items = cachedReminders.completed || [];
    } else {
        items = cachedReminders.reminders || [];
    }

    if (items.length === 0) {
        container.innerHTML = `
            <div style="background: var(--color-surface-card); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 2.5rem; text-align: center; color: var(--color-text-muted);">
                <div style="color: var(--color-primary); margin-bottom: 0.5rem; display: flex; justify-content: center;">${getIcon('bell', { size: 36 })}</div>
                <h3 style="font-size: 1.1rem; font-weight: 700; color: var(--color-text);">No Reminders in "${activeFilter}"</h3>
                <p style="font-size: 0.88rem; margin-top: 0.25rem;">
                    Click "+ Add Reminder" or upload an electronics or clothing bill in chat to get automated suggestions.
                </p>
            </div>
        `;
        return;
    }

    container.innerHTML = '';
    items.forEach(rem => {
        const card = createReminderCard(rem);
        container.appendChild(card);
    });
}

function createReminderCard(rem) {
    const card = document.createElement('div');
    card.style.background = 'var(--color-surface-card)';
    card.style.border = '1px solid var(--color-border)';
    card.style.borderRadius = 'var(--radius-lg)';
    card.style.padding = '1.1rem';
    card.style.display = 'flex';
    card.style.justifyContent = 'space-between';
    card.style.alignItems = 'center';
    card.style.flexWrap = 'wrap';
    card.style.gap = '0.75rem';

    if (rem.is_overdue) {
        card.style.borderLeft = '4px solid var(--color-danger)';
    } else if (rem.is_completed) {
        card.style.opacity = '0.7';
        card.style.borderLeft = '4px solid var(--color-success)';
    } else {
        card.style.borderLeft = '4px solid var(--color-primary)';
    }

    const typeBadges = {
        warranty: `<span style="background: var(--color-success-subtle); color: var(--color-success); font-size: 0.72rem; font-weight: 700; padding: 0.15rem 0.45rem; border-radius: 4px; display: inline-flex; align-items: center; gap: 0.25rem;">${getIcon('shield', { size: 12 })} WARRANTY</span>`,
        return_deadline: `<span style="background: var(--color-warning-subtle); color: var(--color-warning); font-size: 0.72rem; font-weight: 700; padding: 0.15rem 0.45rem; border-radius: 4px; display: inline-flex; align-items: center; gap: 0.25rem;">${getIcon('package', { size: 12 })} RETURN WINDOW</span>`,
        bill_due: `<span style="background: var(--color-primary-subtle); color: var(--color-primary); font-size: 0.72rem; font-weight: 700; padding: 0.15rem 0.45rem; border-radius: 4px; display: inline-flex; align-items: center; gap: 0.25rem;">${getIcon('credit-card', { size: 12 })} BILL DUE</span>`,
        other: `<span style="background: var(--color-surface-raised); color: var(--color-text-muted); font-size: 0.72rem; font-weight: 700; padding: 0.15rem 0.45rem; border-radius: 4px; display: inline-flex; align-items: center; gap: 0.25rem;">${getIcon('file-text', { size: 12 })} REMINDER</span>`,
    };
    const badgeHtml = typeBadges[rem.reminder_type] || typeBadges.other;

    let countdownText = '';
    let countdownColor = 'var(--color-primary)';
    if (rem.is_completed) {
        countdownText = 'Completed';
        countdownColor = 'var(--color-success)';
    } else if (rem.is_overdue) {
        countdownText = `Overdue by ${Math.abs(rem.days_remaining)} day${Math.abs(rem.days_remaining) === 1 ? '' : 's'}`;
        countdownColor = 'var(--color-danger)';
    } else if (rem.days_remaining === 0) {
        countdownText = 'Due Today!';
        countdownColor = 'var(--color-warning)';
    } else {
        countdownText = `${rem.days_remaining} day${rem.days_remaining === 1 ? '' : 's'} remaining`;
        countdownColor = rem.days_remaining <= 7 ? 'var(--color-warning)' : 'var(--color-primary)';
    }

    const notesHtml = rem.notes ? `<div style="font-size: 0.82rem; color: var(--color-text-muted); margin-top: 0.35rem;">${escapeHtml(rem.notes)}</div>` : '';
    const merchantHtml = rem.merchant_name ? `<span style="color: var(--color-text-muted); font-size: 0.78rem;"> • ${escapeHtml(rem.merchant_name)}</span>` : '';

    card.innerHTML = `
        <div style="flex: 1; min-width: 250px;">
            <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
                <input type="checkbox" class="rem-toggle-checkbox" data-id="${rem.id}" ${rem.is_completed ? 'checked' : ''} style="cursor: pointer; width: 1.1rem; height: 1.1rem;" aria-label="Mark reminder completed">
                <strong style="color: var(--color-text); font-size: 0.98rem; text-decoration: ${rem.is_completed ? 'line-through' : 'none'};">${escapeHtml(rem.title)}</strong>
                ${badgeHtml}
            </div>
            ${notesHtml}
            <div style="font-size: 0.78rem; color: var(--color-text-muted); margin-top: 0.25rem;">
                Due Date: <strong style="color: var(--color-text);">${formatDate(rem.due_date)}</strong>${merchantHtml}
            </div>
        </div>

        <div style="display: flex; align-items: center; gap: 1rem; text-align: right;">
            <div>
                <div style="font-weight: 700; color: ${countdownColor}; font-size: 0.92rem;">${countdownText}</div>
                <div style="font-size: 0.75rem; color: var(--color-text-muted);">${rem.is_completed ? 'Finished' : (rem.is_overdue ? 'Action Needed' : 'Active Coverage')}</div>
            </div>

            <div style="display: flex; gap: 0.4rem;">
                <button class="icon-btn rem-btn-edit" data-id="${rem.id}" type="button" aria-label="Edit reminder" title="Edit reminder">
                    ${getIcon('edit-2', { size: 14 })}
                </button>
                <button class="icon-btn rem-btn-delete" data-id="${rem.id}" type="button" aria-label="Delete reminder" title="Delete reminder" style="color: var(--color-danger);">
                    ${getIcon('trash-2', { size: 14 })}
                </button>
            </div>
        </div>
    `;

    // Toggle checkbox
    card.querySelector('.rem-toggle-checkbox')?.addEventListener('change', async (e) => {
        try {
            const fbUser = getCurrentFirebaseUser();
            if (fbUser && fbUser.uid) {
                await toggleReminderInFirestore(fbUser.uid, rem.id, e.target.checked);
            }
            try {
                await apiRequest('/api/reminders/toggle', {
                    method: 'POST',
                    body: { id: rem.id, is_completed: e.target.checked },
                });
            } catch (_) {}
            showToast('Reminder status updated', 'info', 1500);
            await fetchAndRenderReminders();
        } catch (err) {
            showToast('Failed to update reminder: ' + err.message, 'danger');
            e.target.checked = !e.target.checked;
        }
    });

    // Edit button
    card.querySelector('.rem-btn-edit')?.addEventListener('click', () => {
        openReminderModal(rem);
    });

    // Delete button
    card.querySelector('.rem-btn-delete')?.addEventListener('click', async () => {
        const confirmed = await showConfirmModal(`Delete reminder "${rem.title}"?`, 'Delete Reminder');
        if (confirmed) {
            try {
                const fbUser = getCurrentFirebaseUser();
                if (fbUser && fbUser.uid) {
                    await deleteReminderFromFirestore(fbUser.uid, rem.id);
                }
                try {
                    await apiRequest('/api/reminders/delete', {
                        method: 'POST',
                        body: { id: rem.id },
                    });
                } catch (_) {}
                showToast('Reminder deleted', 'success');
                await fetchAndRenderReminders();
            } catch (err) {
                showToast('Failed to delete reminder: ' + err.message, 'danger');
            }
        }
    });

    return card;
}

function openReminderModal(existing = null) {
    const modal = document.getElementById('remModalOverlay');
    const titleEl = document.getElementById('remModalTitle');
    const idInput = document.getElementById('remInputId');
    const billIdInput = document.getElementById('remInputBillId');
    const titleInput = document.getElementById('remInputTitle');
    const typeInput = document.getElementById('remInputType');
    const dueDateInput = document.getElementById('remInputDueDate');
    const notesInput = document.getElementById('remInputNotes');
    const errorEl = document.getElementById('remFormError');

    if (!modal) return;
    if (errorEl) errorEl.style.display = 'none';

    if (existing) {
        if (titleEl) titleEl.textContent = 'Edit Reminder';
        if (idInput) idInput.value = existing.id;
        if (billIdInput) billIdInput.value = existing.bill_id || '';
        if (titleInput) titleInput.value = existing.title || '';
        if (typeInput) typeInput.value = existing.reminder_type || 'warranty';
        if (dueDateInput) dueDateInput.value = existing.due_date || '';
        if (notesInput) notesInput.value = existing.notes || '';
    } else {
        if (titleEl) titleEl.textContent = 'Add Reminder';
        if (idInput) idInput.value = '';
        if (billIdInput) billIdInput.value = '';
        if (titleInput) titleInput.value = '';
        if (typeInput) typeInput.value = 'warranty';
        const d = new Date();
        d.setFullYear(d.getFullYear() + 1);
        if (dueDateInput) dueDateInput.value = d.toISOString().split('T')[0];
        if (notesInput) notesInput.value = '';
    }

    modal.classList.add('open');
}

function closeReminderModal() {
    const modal = document.getElementById('remModalOverlay');
    if (modal) modal.classList.remove('open');
}

async function saveReminderForm() {
    const id = document.getElementById('remInputId')?.value;
    const billId = document.getElementById('remInputBillId')?.value;
    const title = document.getElementById('remInputTitle')?.value.trim();
    const type = document.getElementById('remInputType')?.value;
    const dueDate = document.getElementById('remInputDueDate')?.value;
    const notes = document.getElementById('remInputNotes')?.value.trim();
    const errorEl = document.getElementById('remFormError');

    if (!title || !dueDate) {
        if (errorEl) {
            errorEl.textContent = 'Title and Due Date are required.';
            errorEl.style.display = 'block';
        }
        return;
    }

    try {
        const fbUser = getCurrentFirebaseUser();
        if (fbUser && fbUser.uid) {
            if (id) {
                await updateReminderInFirestore(fbUser.uid, id, {
                    title,
                    reminder_type: type,
                    due_date: dueDate,
                    notes,
                    bill_id: billId || null
                });
            } else {
                await saveReminderToFirestore(fbUser.uid, {
                    title,
                    reminder_type: type,
                    due_date: dueDate,
                    notes,
                    bill_id: billId || null,
                    is_completed: false
                });
            }
        }
        try {
            if (id) {
                await apiRequest('/api/reminders/update', {
                    method: 'POST',
                    body: { id: Number(id), title, reminder_type: type, due_date: dueDate, notes },
                });
            } else {
                await apiRequest('/api/reminders', {
                    method: 'POST',
                    body: { title, reminder_type: type, due_date: dueDate, notes, bill_id: billId ? Number(billId) : null },
                });
            }
        } catch (_) {}
        showToast(id ? 'Reminder updated' : 'Reminder created', 'success');
        closeReminderModal();
        await fetchAndRenderReminders();
    } catch (err) {
        if (errorEl) {
            errorEl.textContent = err.message || 'Failed to save reminder.';
            errorEl.style.display = 'block';
        }
    }
}

/**
 * Global helper: Add a suggested reminder with 1 click from chat bill card
 */
window.addSuggestedReminder = async function(btnEl, reminderData) {
    if (!reminderData || !reminderData.title) return;
    try {
        if (btnEl) {
            btnEl.disabled = true;
            btnEl.textContent = 'Saving...';
        }
        await apiRequest('/api/reminders', {
            method: 'POST',
            body: reminderData,
        });
        if (btnEl) {
            btnEl.innerHTML = `${getIcon('check', { size: 13 })} Added`;
            btnEl.style.background = 'var(--color-success-subtle)';
            btnEl.style.color = 'var(--color-success)';
            btnEl.style.borderColor = 'var(--color-success)';
        }
        showToast('Reminder added', 'success');
    } catch (e) {
        showToast('Failed to add reminder: ' + e.message, 'danger');
        if (btnEl) {
            btnEl.disabled = false;
            btnEl.innerHTML = `${getIcon('bell', { size: 13 })} Add Reminder`;
        }
    }
};
