/**
 * SpendSense - Reminders Screen Controller
 * Manages warranty expirations, return windows, and due dates.
 * Supports add, edit, delete, toggle completion, and bill suggestions.
 */

import { apiRequest } from './api.js';

let activeFilter = 'all';
let cachedReminders = { upcoming: [], overdue: [], completed: [], reminders: [] };

export async function loadRemindersTab() {
    const container = document.getElementById('screenReminders');
    if (!container) return;

    container.innerHTML = `
        <div style="max-width: 950px; margin: 0 auto; width: 100%;">
            <!-- Header -->
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.25rem; flex-wrap: wrap; gap: 0.75rem;">
                <div>
                    <h2 style="font-size: 1.4rem; font-weight: 700;">⏰ Warranty & Return Reminders</h2>
                    <p style="color: var(--text-muted); font-size: 0.88rem; margin-top: 0.25rem;">
                        Track gadget warranties, apparel exchange windows, and upcoming bills.
                    </p>
                </div>
                <button id="remBtnAddReminder" class="btn btn-primary" type="button">
                    ➕ Add Reminder
                </button>
            </div>

            <!-- Due Soon / Overdue Alert Banner -->
            <div id="remDueAlertBanner" style="display: none; background: rgba(239, 68, 68, 0.12); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: var(--radius-md); padding: 1rem; margin-bottom: 1.25rem;">
                <div style="display: flex; align-items: center; gap: 0.5rem; color: #f87171; font-weight: 700; font-size: 0.95rem;">
                    <span>⚠️</span> <span id="remDueAlertText">You have deadlines requiring immediate attention!</span>
                </div>
                <div id="remDueAlertList" style="margin-top: 0.5rem; font-size: 0.85rem; color: #fca5a5;"></div>
            </div>

            <!-- Filter Tabs -->
            <div style="display: flex; gap: 0.5rem; margin-bottom: 1.25rem; flex-wrap: wrap; border-bottom: 1px solid var(--border); padding-bottom: 0.75rem;">
                <button class="chip-btn rem-filter-btn active" data-filter="all" type="button">
                    All (<span id="remCountAll">0</span>)
                </button>
                <button class="chip-btn rem-filter-btn" data-filter="upcoming" type="button">
                    🟢 Upcoming (<span id="remCountUpcoming">0</span>)
                </button>
                <button class="chip-btn rem-filter-btn" data-filter="overdue" type="button" style="color: #f87171;">
                    🔴 Overdue (<span id="remCountOverdue">0</span>)
                </button>
                <button class="chip-btn rem-filter-btn" data-filter="completed" type="button">
                    ✅ Completed (<span id="remCountCompleted">0</span>)
                </button>
            </div>

            <!-- Reminders List -->
            <div id="remindersListContainer" style="display: flex; flex-direction: column; gap: 0.85rem;">
                <div style="text-align: center; color: var(--text-muted); padding: 2rem;">Loading reminders...</div>
            </div>
        </div>

        <!-- Add / Edit Reminder Modal -->
        <div class="modal-overlay" id="remModalOverlay" style="display: none;">
            <div class="modal-dialog" style="max-width: 480px;">
                <div class="modal-header">
                    <h3 id="remModalTitle">Add Reminder</h3>
                    <button class="modal-close-btn" id="remModalCloseBtn" type="button">&times;</button>
                </div>
                <div class="modal-body">
                    <form id="remForm">
                        <input type="hidden" id="remInputId" value="">
                        <input type="hidden" id="remInputBillId" value="">

                        <div class="form-group">
                            <label class="form-label">Reminder Title *</label>
                            <input type="text" id="remInputTitle" class="form-control" placeholder="e.g. 1-Year Warranty: JBL Headphones" required>
                        </div>

                        <div class="form-group">
                            <label class="form-label">Type *</label>
                            <select id="remInputType" class="form-control">
                                <option value="warranty">🛡️ Warranty Coverage</option>
                                <option value="return_deadline">📦 Return / Exchange Window</option>
                                <option value="bill_due">💳 Bill Due / Subscription</option>
                                <option value="other">📝 Other Reminder</option>
                            </select>
                        </div>

                        <div class="form-group">
                            <label class="form-label">Due / Expiry Date *</label>
                            <input type="date" id="remInputDueDate" class="form-control" required>
                        </div>

                        <div class="form-group">
                            <label class="form-label">Notes & Details</label>
                            <textarea id="remInputNotes" class="form-control" rows="2" placeholder="e.g. Purchased at Croma with bill #CR-849"></textarea>
                        </div>

                        <div id="remFormError" style="color: #ef4444; font-size: 0.85rem; margin-bottom: 0.75rem; display: none;"></div>

                        <div style="display: flex; justify-content: flex-end; gap: 0.75rem; margin-top: 1rem;">
                            <button type="button" class="btn btn-secondary" id="remBtnCancel">Cancel</button>
                            <button type="submit" class="btn btn-primary" id="remBtnSave">Save Reminder</button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    `;

    setupRemindersEvents();
    await fetchAndRenderReminders();
}

function setupRemindersEvents() {
    // Filter clicks
    const filterBtns = document.querySelectorAll('.rem-filter-btn');
    filterBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            filterBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            activeFilter = btn.dataset.filter || 'all';
            renderRemindersList();
        });
    });

    // Add reminder button
    document.getElementById('remBtnAddReminder')?.addEventListener('click', () => {
        openReminderModal();
    });

    // Modal close
    document.getElementById('remModalCloseBtn')?.addEventListener('click', closeReminderModal);
    document.getElementById('remBtnCancel')?.addEventListener('click', closeReminderModal);

    // Form submit
    document.getElementById('remForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        await saveReminderForm();
    });
}

async function fetchAndRenderReminders() {
    try {
        const res = await apiRequest('/api/reminders');
        cachedReminders = res || { upcoming: [], overdue: [], completed: [], reminders: [] };

        // Update counts
        const counts = cachedReminders.counts || {};
        const countAll = document.getElementById('remCountAll');
        const countUp = document.getElementById('remCountUpcoming');
        const countOver = document.getElementById('remCountOverdue');
        const countComp = document.getElementById('remCountCompleted');

        if (countAll) countAll.textContent = counts.total || 0;
        if (countUp) countUp.textContent = counts.upcoming || 0;
        if (countOver) countOver.textContent = counts.overdue || 0;
        if (countComp) countComp.textContent = counts.completed || 0;

        // Check due soon alerts
        checkDueAlerts();

        // Render current filter
        renderRemindersList();
    } catch (e) {
        console.error('Error fetching reminders:', e);
        const container = document.getElementById('remindersListContainer');
        if (container) {
            container.innerHTML = `<div style="color: #ef4444; padding: 1.5rem; text-align: center;">Failed to load reminders: ${escapeHtml(e.message || e)}</div>`;
        }
    }
}

async function checkDueAlerts() {
    try {
        const dueRes = await apiRequest('/api/reminders/due?days=7');
        const dueList = dueRes.due_reminders || [];
        const banner = document.getElementById('remDueAlertBanner');
        const listEl = document.getElementById('remDueAlertList');

        if (!banner || !listEl) return;

        if (dueList.length > 0) {
            banner.style.display = 'block';
            listEl.innerHTML = dueList.map(d => {
                const badge = d.days_remaining < 0 
                    ? `<span style="font-weight: 700; color: #ef4444;">OVERDUE (${Math.abs(d.days_remaining)} days ago)</span>` 
                    : (d.days_remaining === 0 ? `<span style="font-weight: 700; color: #fbbf24;">DUE TODAY</span>` : `<span style="font-weight: 600; color: #fcd34d;">Due in ${d.days_remaining} day${d.days_remaining === 1 ? '' : 's'}</span>`);
                return `• <strong>${escapeHtml(d.title)}</strong> &bull; ${badge}`;
            }).join('<br>');
        } else {
            banner.style.display = 'none';
        }
    } catch (e) {
        console.warn('Could not check due alerts:', e);
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
            <div style="background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 2.5rem; text-align: center; color: var(--text-muted);">
                <div style="font-size: 2.5rem; margin-bottom: 0.5rem;">⏰</div>
                <h3 style="font-size: 1.1rem; font-weight: 700; color: #ffffff;">No Reminders in "${activeFilter}"</h3>
                <p style="font-size: 0.88rem; margin-top: 0.25rem;">
                    Click "➕ Add Reminder" or upload an electronics or clothing bill in chat to get automated suggestions.
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
    card.style.background = 'var(--bg-surface)';
    card.style.border = '1px solid var(--border)';
    card.style.borderRadius = 'var(--radius-md)';
    card.style.padding = '1.1rem';
    card.style.display = 'flex';
    card.style.justifyContent = 'space-between';
    card.style.alignItems = 'center';
    card.style.flexWrap = 'wrap';
    card.style.gap = '0.75rem';

    if (rem.is_overdue) {
        card.style.borderLeft = '4px solid #ef4444';
    } else if (rem.is_completed) {
        card.style.opacity = '0.65';
        card.style.borderLeft = '4px solid #10b981';
    } else {
        card.style.borderLeft = '4px solid #6366f1';
    }

    const typeBadges = {
        warranty: `<span style="background: rgba(16, 185, 129, 0.15); color: #34d399; font-size: 0.72rem; font-weight: 700; padding: 0.15rem 0.45rem; border-radius: 4px;">🛡️ WARRANTY</span>`,
        return_deadline: `<span style="background: rgba(245, 158, 11, 0.2); color: #fbbf24; font-size: 0.72rem; font-weight: 700; padding: 0.15rem 0.45rem; border-radius: 4px;">📦 RETURN WINDOW</span>`,
        bill_due: `<span style="background: rgba(99, 102, 241, 0.2); color: #818cf8; font-size: 0.72rem; font-weight: 700; padding: 0.15rem 0.45rem; border-radius: 4px;">💳 BILL DUE</span>`,
        other: `<span style="background: rgba(148, 163, 184, 0.15); color: #94a3b8; font-size: 0.72rem; font-weight: 700; padding: 0.15rem 0.45rem; border-radius: 4px;">📝 REMINDER</span>`,
    };
    const badgeHtml = typeBadges[rem.reminder_type] || typeBadges.other;

    let countdownText = '';
    let countdownColor = '#a5b4fc';
    if (rem.is_completed) {
        countdownText = '✅ Completed';
        countdownColor = '#34d399';
    } else if (rem.is_overdue) {
        countdownText = `Overdue by ${Math.abs(rem.days_remaining)} day${Math.abs(rem.days_remaining) === 1 ? '' : 's'}`;
        countdownColor = '#ef4444';
    } else if (rem.days_remaining === 0) {
        countdownText = '⚠️ Due Today!';
        countdownColor = '#fbbf24';
    } else {
        countdownText = `${rem.days_remaining} day${rem.days_remaining === 1 ? '' : 's'} remaining`;
        countdownColor = rem.days_remaining <= 7 ? '#fbbf24' : '#a5b4fc';
    }

    const notesHtml = rem.notes ? `<div style="font-size: 0.82rem; color: var(--text-muted); margin-top: 0.35rem;">${escapeHtml(rem.notes)}</div>` : '';
    const merchantHtml = rem.merchant_name ? `<span style="color: var(--text-muted); font-size: 0.78rem;"> &bull; ${escapeHtml(rem.merchant_name)}</span>` : '';

    card.innerHTML = `
        <div style="flex: 1; min-width: 250px;">
            <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
                <input type="checkbox" class="rem-toggle-checkbox" data-id="${rem.id}" ${rem.is_completed ? 'checked' : ''} style="cursor: pointer; width: 1.1rem; height: 1.1rem;">
                <strong style="color: #ffffff; font-size: 0.98rem; text-decoration: ${rem.is_completed ? 'line-through' : 'none'};">${escapeHtml(rem.title)}</strong>
                ${badgeHtml}
            </div>
            ${notesHtml}
            <div style="font-size: 0.78rem; color: var(--text-muted); margin-top: 0.25rem;">
                Due Date: <strong style="color: #ffffff;">${formatDate(rem.due_date)}</strong>${merchantHtml}
            </div>
        </div>

        <div style="display: flex; align-items: center; gap: 1rem; text-align: right;">
            <div>
                <div style="font-weight: 700; color: ${countdownColor}; font-size: 0.92rem;">${countdownText}</div>
                <div style="font-size: 0.75rem; color: var(--text-muted);">${rem.is_completed ? 'Finished' : (rem.is_overdue ? 'Action Needed' : 'Active Coverage')}</div>
            </div>

            <div style="display: flex; gap: 0.4rem;">
                <button class="icon-btn rem-btn-edit" data-id="${rem.id}" type="button" title="Edit reminder" style="padding: 0.3rem 0.5rem; font-size: 0.85rem;">
                    ✏️
                </button>
                <button class="icon-btn rem-btn-delete" data-id="${rem.id}" type="button" title="Delete reminder" style="padding: 0.3rem 0.5rem; font-size: 0.85rem; color: #ef4444;">
                    🗑️
                </button>
            </div>
        </div>
    `;

    // Toggle checkbox
    card.querySelector('.rem-toggle-checkbox')?.addEventListener('change', async (e) => {
        try {
            await apiRequest('/api/reminders/toggle', {
                method: 'POST',
                body: { id: rem.id, is_completed: e.target.checked },
            });
            await fetchAndRenderReminders();
        } catch (err) {
            alert('Failed to update reminder: ' + err.message);
            e.target.checked = !e.target.checked;
        }
    });

    // Edit button
    card.querySelector('.rem-btn-edit')?.addEventListener('click', () => {
        openReminderModal(rem);
    });

    // Delete button
    card.querySelector('.rem-btn-delete')?.addEventListener('click', async () => {
        if (confirm(`Delete reminder "${rem.title}"?`)) {
            try {
                await apiRequest('/api/reminders/delete', {
                    method: 'POST',
                    body: { id: rem.id },
                });
                await fetchAndRenderReminders();
            } catch (err) {
                alert('Failed to delete reminder: ' + err.message);
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
        // Default due date: 1 year from now
        const d = new Date();
        d.setFullYear(d.getFullYear() + 1);
        if (dueDateInput) dueDateInput.value = d.toISOString().split('T')[0];
        if (notesInput) notesInput.value = '';
    }

    modal.style.display = 'flex';
}

function closeReminderModal() {
    const modal = document.getElementById('remModalOverlay');
    if (modal) modal.style.display = 'none';
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
        if (id) {
            // Update
            await apiRequest('/api/reminders/update', {
                method: 'POST',
                body: { id: Number(id), title, reminder_type: type, due_date: dueDate, notes },
            });
        } else {
            // Create
            await apiRequest('/api/reminders', {
                method: 'POST',
                body: { title, reminder_type: type, due_date: dueDate, notes, bill_id: billId ? Number(billId) : null },
            });
        }

        closeReminderModal();
        await fetchAndRenderReminders();
    } catch (e) {
        if (errorEl) {
            errorEl.textContent = e.message || 'Failed to save reminder.';
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
            btnEl.textContent = '✅ Reminder Added';
            btnEl.style.background = 'rgba(16, 185, 129, 0.2)';
            btnEl.style.color = '#34d399';
            btnEl.style.borderColor = '#10b981';
        }
    } catch (e) {
        alert('Failed to add reminder: ' + e.message);
        if (btnEl) {
            btnEl.disabled = false;
            btnEl.textContent = '⏰ Add Reminder';
        }
    }
};

function formatDate(dateStr) {
    if (!dateStr) return '';
    const parts = dateStr.split('-');
    if (parts.length === 3) {
        return `${parts[2]}-${parts[1]}-${parts[0]}`;
    }
    return dateStr;
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
