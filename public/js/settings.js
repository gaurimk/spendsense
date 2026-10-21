/**
 * SpendSense - Settings Screen Controller
 * Category management (Add, Rename, Delete),
 * CSV Data Export (Bills and Items), Demo Data seeding, and "Delete All My Data" safeguard.
 */

import { apiRequest } from './api.js';
import { formatCurrency, escapeHtml, showToast, showConfirmModal } from './utils.js';
import { getIcon } from './icons.js';
import { loadChatHistory, appendAssistantMessage } from './chat.js';
import { getCurrentFirebaseUser } from './firebase-auth.js';
import { clearAllUserDataFromFirestore } from './firebase-firestore.js';

export async function loadSettingsTab() {
    const container = document.getElementById('screenSettings');
    if (!container) return;

    container.innerHTML = `
        <div style="max-width: 950px; margin: 0 auto; width: 100%; padding: 1.25rem;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.25rem; flex-wrap: wrap; gap: 0.5rem;">
                <div>
                    <h2 style="font-size: 1.4rem; font-weight: 700; display: flex; align-items: center; gap: 0.5rem;">
                        <span style="color: var(--color-primary); display: flex;">${getIcon('settings', { size: 22 })}</span>
                        Settings & Data Controls
                    </h2>
                    <p style="color: var(--color-text-muted); font-size: 0.88rem; margin-top: 0.2rem;">
                        Manage expense categories, download CSV backups, demo datasets, and privacy controls.
                    </p>
                </div>
            </div>

            <!-- 0. WORKSPACE & BUSINESS PROFILE CARD -->
            <div id="businessProfileSettingsCard" class="business-profile-card" style="background: var(--color-surface-card); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 1.25rem; margin-bottom: 1.25rem;">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1rem; flex-wrap: wrap; gap: 0.5rem;">
                    <div>
                        <h3 style="font-size: 1.05rem; font-weight: 700; display: flex; align-items: center; gap: 0.4rem;">
                            <span style="color: var(--color-primary); display: flex;">${getIcon('briefcase', { size: 18 })}</span>
                            Business / Commercial Workspace Profile
                        </h3>
                        <p style="font-size: 0.8rem; color: var(--color-text-muted); margin-top: 0.15rem;">
                            Configure your registered shop/business identity, GSTIN, default payment terms, and active workspace mode.
                        </p>
                    </div>
                    <div class="workspace-segmented-control" style="align-self: flex-start;">
                        <button type="button" class="workspace-seg-btn" id="btnSettingsModePersonal">
                            👤 Personal
                        </button>
                        <button type="button" class="workspace-seg-btn" id="btnSettingsModeBusiness">
                            🏢 Business
                        </button>
                    </div>
                </div>

                <form id="formBusinessProfile" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 0.85rem; margin-bottom: 1rem;">
                    <div class="form-group">
                        <label class="form-label" style="font-size: 0.8rem;">Business / Store Name</label>
                        <input type="text" id="bizProfileName" class="form-control" placeholder="e.g. Kutakole General Store & Trading" style="font-size: 0.85rem;">
                    </div>
                    <div class="form-group">
                        <label class="form-label" style="font-size: 0.8rem;">GSTIN / Tax Identification No.</label>
                        <input type="text" id="bizProfileGstin" class="form-control" maxlength="15" placeholder="e.g. 27AAAAA0000A1Z5" style="text-transform: uppercase; font-family: monospace; font-size: 0.85rem;">
                    </div>
                    <div class="form-group">
                        <label class="form-label" style="font-size: 0.8rem;">Trade / Business Category</label>
                        <select id="bizProfileType" class="form-control" style="font-size: 0.85rem;">
                            <option value="retail">Retail Kirana / Supermarket</option>
                            <option value="wholesale">Wholesale Distribution / Trader</option>
                            <option value="pharmacy">Pharmacy / Healthcare Supplies</option>
                            <option value="restaurant">Restaurant / Cafe / Food Vendor</option>
                            <option value="services">Professional / Consulting / IT Services</option>
                            <option value="manufacturing">Small Manufacturing / Workshop</option>
                            <option value="other">Other Commercial Business</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label class="form-label" style="font-size: 0.8rem;">Default Supplier Credit Terms</label>
                        <select id="bizProfileTerms" class="form-control" style="font-size: 0.85rem;">
                            <option value="net_0">Immediate / Cash on Delivery (Net 0)</option>
                            <option value="net_15">Net 15 Days</option>
                            <option value="net_30" selected>Net 30 Days (Standard B2B)</option>
                            <option value="net_45">Net 45 Days (MSME Mandate)</option>
                            <option value="net_60">Net 60 Days</option>
                        </select>
                    </div>
                    <div class="form-group" style="grid-column: 1 / -1;">
                        <label class="form-label" style="font-size: 0.8rem;">GST Scheme & Input Tax Credit (ITC)</label>
                        <select id="bizProfileGstScheme" class="form-control" style="font-size: 0.85rem;">
                            <option value="regular">Regular Taxpayer Scheme (Eligible to claim GST Input Tax Credit / ITC)</option>
                            <option value="composition">Composition Scheme (Flat rate turnover tax, No ITC claim)</option>
                            <option value="unregistered">Unregistered / Exempt Turnover</option>
                        </select>
                    </div>
                </form>

                <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem; border-top: 1px solid var(--color-border); padding-top: 0.85rem;">
                    <div id="bizProfileSaveNotice" style="font-size: 0.8rem; color: var(--color-text-muted);">
                        Mode preference is synced across device sessions and export registers.
                    </div>
                    <button id="btnSaveBusinessProfile" class="btn btn-primary" type="button" style="font-size: 0.85rem; padding: 0.45rem 1rem; display: inline-flex; align-items: center; gap: 0.35rem;">
                        ${getIcon('check', { size: 14 })} Save Business Profile
                    </button>
                </div>
            </div>

            <!-- 1. CATEGORY MANAGEMENT CARD -->
            <div style="background: var(--color-surface-card); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 1.25rem; margin-bottom: 1.25rem;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; flex-wrap: wrap; gap: 0.5rem;">
                    <div>
                        <h3 style="font-size: 1.05rem; font-weight: 700; display: flex; align-items: center; gap: 0.4rem;">
                            <span style="color: var(--color-primary); display: flex;">${getIcon('tag', { size: 18 })}</span>
                            Expense Categories
                        </h3>
                        <p style="font-size: 0.8rem; color: var(--color-text-muted);">Organize your purchases into custom categories</p>
                    </div>
                    <button id="setBtnAddCategory" class="btn btn-primary" type="button" style="font-size: 0.85rem; padding: 0.4rem 0.85rem; display: inline-flex; align-items: center; gap: 0.25rem;">
                        ${getIcon('plus', { size: 14 })} Add Category
                    </button>
                </div>

                <div id="setCategoriesList" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 0.75rem;">
                    <div style="color: var(--color-text-muted); font-size: 0.85rem;">Loading categories...</div>
                </div>
            </div>

            <!-- 2. DEMO DATA SET SEEDING CARD -->
            <div style="background: var(--color-surface-card); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 1.25rem; margin-bottom: 1.25rem;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; flex-wrap: wrap; gap: 0.5rem;">
                    <div>
                        <h3 style="font-size: 1.05rem; font-weight: 700; display: flex; align-items: center; gap: 0.4rem;">
                            <span style="color: var(--color-primary); display: flex;">${getIcon('file-text', { size: 18 })}</span>
                            Demo Data
                        </h3>
                        <p style="font-size: 0.85rem; color: var(--color-text-muted); margin-top: 0.2rem;">
                            Populate your account with ~40 realistic supermarket, restaurant, pharmacy, electronics, and fuel bills across 3 months.
                        </p>
                    </div>
                    <button id="btnSettingsLoadDemo" class="btn btn-secondary" type="button" style="display: inline-flex; align-items: center; gap: 0.35rem;">
                        ${getIcon('check-circle', { size: 14 })} Load Demo Bills
                    </button>
                </div>
            </div>

            <!-- 3. DATA EXPORT CARD -->
            <div style="background: var(--color-surface-card); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 1.25rem; margin-bottom: 1.25rem;">
                <h3 style="font-size: 1.05rem; font-weight: 700; margin-bottom: 0.35rem; display: flex; align-items: center; gap: 0.4rem;">
                    <span style="color: var(--color-primary); display: flex;">${getIcon('download', { size: 18 })}</span>
                    Export Your Data (CSV)
                </h3>
                <p style="font-size: 0.85rem; color: var(--color-text-muted); margin-bottom: 1rem;">
                    Download an offline spreadsheet of all your recorded transactions and items for tax filing, Excel accounting, or personal archiving.
                </p>

                <div style="display: flex; gap: 0.75rem; flex-wrap: wrap;">
                    <button id="btnExportBillsCsv" class="btn btn-secondary" type="button" style="display: inline-flex; align-items: center; gap: 0.35rem;">
                        ${getIcon('download', { size: 14 })} Export Bills CSV (Totals & Dates)
                    </button>
                    <button id="btnExportItemsCsv" class="btn btn-secondary" type="button" style="display: inline-flex; align-items: center; gap: 0.35rem;">
                        ${getIcon('download', { size: 14 })} Export Line Items CSV (All Products & Rates)
                    </button>
                    <button id="btnExportGstCsv" class="btn btn-secondary" type="button" style="display: inline-flex; align-items: center; gap: 0.35rem; border-color: rgba(1, 142, 239, 0.4); color: var(--color-primary);">
                        ${getIcon('file-text', { size: 14 })} Export GST ITC Register (GSTR-2B CSV)
                    </button>
                </div>
            </div>

            <!-- 4. PRIVACY & DANGER ZONE CARD -->
            <div class="danger-zone-card" style="background: var(--color-surface-card); border: 1px solid var(--color-danger); border-radius: var(--radius-lg); padding: 1.25rem; margin-bottom: 1.25rem; border-left: 4px solid var(--color-danger);">
                <h3 style="font-size: 1.05rem; font-weight: 700; color: var(--color-danger); margin-bottom: 0.35rem; display: flex; align-items: center; gap: 0.4rem;">
                    <span style="color: var(--color-danger); display: flex;">${getIcon('trash-2', { size: 18 })}</span>
                    Danger Zone & Data Deletion
                </h3>
                <p style="font-size: 0.85rem; color: var(--color-text-muted); margin-bottom: 1rem;">
                    Permanently delete all your uploaded bills, parsed line items, category budgets, accuracy logs, and reminders. This action cannot be undone.
                </p>

                <button id="btnDeleteAllData" class="btn btn-danger-outline" type="button" style="display: inline-flex; align-items: center; gap: 0.35rem;">
                    ${getIcon('alert-triangle', { size: 14 })} Delete All My Data
                </button>
            </div>
        </div>

        <!-- Add Category Modal -->
        <div class="modal-backdrop" id="setCategoryModal">
            <div class="modal-window" style="max-width: 420px;">
                <div class="modal-header">
                    <div class="modal-title" id="setCatModalTitle">Add Expense Category</div>
                    <button class="close-btn" id="setCatModalCloseBtn" type="button" aria-label="Close dialog">&times;</button>
                </div>
                <div class="modal-body">
                    <form id="setCatForm">
                        <input type="hidden" id="setCatId" value="">

                        <div class="form-group" style="margin-bottom: 1rem;">
                            <label class="form-label">Category Name *</label>
                            <input type="text" id="setCatName" class="form-control" placeholder="e.g. Pet Care, Fitness & Gym" required>
                        </div>

                        <div class="form-group" style="margin-bottom: 1rem;">
                            <label class="form-label">Badge Color</label>
                            <div style="display: flex; gap: 0.5rem; align-items: center;">
                                <input type="color" id="setCatColor" value="#4f46e5" style="width: 45px; height: 38px; border: 1px solid var(--color-border); border-radius: 6px; background: transparent; cursor: pointer;">
                                <span style="font-size: 0.82rem; color: var(--color-text-muted);">Distinct accent for chart breakdown</span>
                            </div>
                        </div>

                        <div id="setCatError" style="color: var(--color-danger); font-size: 0.85rem; margin-bottom: 0.75rem; display: none;"></div>

                        <div style="display: flex; justify-content: flex-end; gap: 0.75rem; margin-top: 1rem;">
                            <button type="button" class="btn btn-secondary" id="setCatBtnCancel">Cancel</button>
                            <button type="submit" class="btn btn-primary" id="setCatBtnSave">Save Category</button>
                        </div>
                    </form>
                </div>
            </div>
        </div>

        <!-- Delete All Data Confirmation Modal -->
        <div class="modal-backdrop" id="setDeleteConfirmModal">
            <div class="modal-window" style="max-width: 460px; border-color: var(--color-danger);">
                <div class="modal-header">
                    <div class="modal-title" style="color: var(--color-danger); display: flex; align-items: center; gap: 0.4rem;">
                        ${getIcon('alert-triangle', { size: 18 })} Confirm Complete Data Deletion
                    </div>
                    <button class="close-btn" id="setDeleteModalCloseBtn" type="button" aria-label="Close dialog">&times;</button>
                </div>
                <div class="modal-body">
                    <p style="font-size: 0.9rem; color: var(--color-text); margin-bottom: 0.75rem;">
                        This will permanently erase:
                    </p>
                    <ul style="font-size: 0.85rem; color: var(--color-text-muted); margin-bottom: 1rem; padding-left: 1.25rem; line-height: 1.6;">
                        <li>All uploaded bill images and receipts</li>
                        <li>All extracted items and expense records</li>
                        <li>All monthly category budgets and progress</li>
                        <li>All warranties and return-deadline reminders</li>
                        <li>Chat conversation history</li>
                    </ul>
                    <p style="font-size: 0.85rem; color: var(--color-danger); font-weight: 600; margin-bottom: 0.75rem;">
                        Please type <strong>DELETE</strong> below to confirm:
                    </p>
                    <input type="text" id="setDeleteConfirmInput" class="form-control" placeholder="Type DELETE to confirm" style="border-color: var(--color-danger);">

                    <div style="display: flex; justify-content: flex-end; gap: 0.75rem; margin-top: 1.25rem;">
                        <button type="button" class="btn btn-secondary" id="setDeleteBtnCancel">Cancel</button>
                        <button type="button" class="btn btn-danger" id="setDeleteBtnExecute" disabled>Permanently Erase All Data</button>
                    </div>
                </div>
            </div>
        </div>
    `;

    setupSettingsEvents();
    await loadCategoriesList();
}

function setupSettingsEvents() {
    // Workspace Mode & Business Profile setup
    const modeBtnPersonal = document.getElementById('btnSettingsModePersonal');
    const modeBtnBusiness = document.getElementById('btnSettingsModeBusiness');
    const profileCard = document.getElementById('businessProfileSettingsCard');
    const nameInput = document.getElementById('bizProfileName');
    const gstinInput = document.getElementById('bizProfileGstin');
    const typeSelect = document.getElementById('bizProfileType');
    const termsSelect = document.getElementById('bizProfileTerms');
    const gstSelect = document.getElementById('bizProfileGstScheme');
    const saveBizBtn = document.getElementById('btnSaveBusinessProfile');

    let currentMode = localStorage.getItem('spendsense_active_mode') || 'personal';

    const updateModeButtons = (mode) => {
        if (modeBtnPersonal && modeBtnBusiness) {
            modeBtnPersonal.classList.toggle('active', mode === 'personal');
            modeBtnBusiness.classList.toggle('active', mode === 'business');
        }
        if (profileCard) {
            profileCard.classList.toggle('active-mode', mode === 'business');
        }
    };
    updateModeButtons(currentMode);

    modeBtnPersonal?.addEventListener('click', () => {
        currentMode = 'personal';
        updateModeButtons('personal');
        if (typeof window.setAppMode === 'function') {
            window.setAppMode('personal');
        }
        showToast('Switched to Personal Mode', 'info', 2000);
    });

    modeBtnBusiness?.addEventListener('click', () => {
        currentMode = 'business';
        updateModeButtons('business');
        if (typeof window.setAppMode === 'function') {
            window.setAppMode('business');
        }
        showToast('Switched to Business Mode', 'info', 2000);
    });

    // Load saved business profile
    try {
        const savedProfileStr = localStorage.getItem('spendsense_biz_profile');
        if (savedProfileStr) {
            const p = JSON.parse(savedProfileStr);
            if (nameInput && p.name) nameInput.value = p.name;
            if (gstinInput && p.gstin) gstinInput.value = p.gstin;
            if (typeSelect && p.type) typeSelect.value = p.type;
            if (termsSelect && p.terms) termsSelect.value = p.terms;
            if (gstSelect && p.gst_scheme) gstSelect.value = p.gst_scheme;
        }
    } catch (e) {
        console.warn('Profile read note:', e);
    }

    // Auto-uppercase GSTIN input
    gstinInput?.addEventListener('input', () => {
        gstinInput.value = gstinInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    });

    saveBizBtn?.addEventListener('click', () => {
        const profile = {
            name: nameInput?.value.trim() || '',
            gstin: gstinInput?.value.trim() || '',
            type: typeSelect?.value || 'retail',
            terms: termsSelect?.value || 'net_30',
            gst_scheme: gstSelect?.value || 'regular',
            updated_at: new Date().toISOString()
        };
        try {
            localStorage.setItem('spendsense_biz_profile', JSON.stringify(profile));
            showToast('Business Profile saved successfully!', 'success');
            if (currentMode === 'business' && typeof window.setAppMode === 'function') {
                window.setAppMode('business');
            }
        } catch (e) {
            showToast('Failed to save profile: ' + e.message, 'danger');
        }
    });

    // Add Category button
    document.getElementById('setBtnAddCategory')?.addEventListener('click', () => {
        openCategoryModal();
    });

    document.getElementById('setCatModalCloseBtn')?.addEventListener('click', closeCategoryModal);
    document.getElementById('setCatBtnCancel')?.addEventListener('click', closeCategoryModal);

    // Save Category Form
    document.getElementById('setCatForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        await saveCategory();
    });

    // Demo Data Seeding under Settings
    document.getElementById('btnSettingsLoadDemo')?.addEventListener('click', async () => {
        const confirmed = await showConfirmModal(
            'Load ~40 realistic bills across groceries, restaurants, pharmacy, electronics, and fuel into your account?',
            'Load Demo Dataset'
        );
        if (!confirmed) return;

        const btn = document.getElementById('btnSettingsLoadDemo');
        try {
            if (btn) {
                btn.disabled = true;
                btn.textContent = 'Seeding...';
            }
            showToast('Seeding demo bills...', 'info', 3000);
            const res = await apiRequest('/api/demo/seed', { method: 'POST' });
            await loadChatHistory();
            appendAssistantMessage(`Demo data loaded! Seeded ${res.bills_seeded || 40} realistic bills across 3 months.`);
            showToast(`Seeded ${res.bills_seeded || 40} bills successfully!`, 'success');
            await loadCategoriesList();
        } catch (e) {
            showToast('Demo seeding failed: ' + (e.message || e), 'danger');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = `${getIcon('check-circle', { size: 14 })} Load Demo Bills`;
            }
        }
    });

    // CSV Exports
    document.getElementById('btnExportBillsCsv')?.addEventListener('click', () => {
        showToast('Generating Bills CSV...', 'info', 2000);
        window.open('/api/export/csv?type=bills', '_blank');
    });

    document.getElementById('btnExportItemsCsv')?.addEventListener('click', () => {
        showToast('Generating Line Items CSV...', 'info', 2000);
        window.open('/api/export/csv?type=items', '_blank');
    });

    document.getElementById('btnExportGstCsv')?.addEventListener('click', () => {
        showToast('Generating GST Input Tax Credit CSV Register...', 'info', 2000);
        window.open('/api/export/csv?type=gst', '_blank');
    });

    // Delete All Data Modal
    const deleteModal = document.getElementById('setDeleteConfirmModal');
    const deleteInput = document.getElementById('setDeleteConfirmInput');
    const deleteExecuteBtn = document.getElementById('setDeleteBtnExecute');

    document.getElementById('btnDeleteAllData')?.addEventListener('click', () => {
        if (deleteModal) {
            deleteModal.classList.add('open');
            if (deleteInput) deleteInput.value = '';
            if (deleteExecuteBtn) deleteExecuteBtn.disabled = true;
        }
    });

    document.getElementById('setDeleteModalCloseBtn')?.addEventListener('click', () => {
        if (deleteModal) deleteModal.classList.remove('open');
    });
    document.getElementById('setDeleteBtnCancel')?.addEventListener('click', () => {
        if (deleteModal) deleteModal.classList.remove('open');
    });

    deleteInput?.addEventListener('input', () => {
        if (deleteExecuteBtn) {
            deleteExecuteBtn.disabled = (deleteInput.value.trim() !== 'DELETE');
        }
    });

    deleteExecuteBtn?.addEventListener('click', async () => {
        try {
            deleteExecuteBtn.disabled = true;
            deleteExecuteBtn.textContent = 'Erasing...';
            const fbUser = getCurrentFirebaseUser();
            if (fbUser && fbUser.uid) {
                try {
                    await clearAllUserDataFromFirestore(fbUser.uid);
                } catch (fErr) {
                    console.warn('Firestore erase note:', fErr);
                }
            }
            await apiRequest('/api/account/delete-all-data', {
                method: 'POST',
                body: { confirm: true },
            });
            showToast('All your data has been completely erased.', 'success');
            if (deleteModal) deleteModal.classList.remove('open');
            setTimeout(() => {
                window.location.reload();
            }, 1000);
        } catch (err) {
            showToast('Failed to erase data: ' + err.message, 'danger');
            deleteExecuteBtn.disabled = false;
            deleteExecuteBtn.textContent = 'Permanently Erase All Data';
        }
    });
}

async function loadCategoriesList() {
    const listEl = document.getElementById('setCategoriesList');
    if (!listEl) return;

    listEl.innerHTML = `
        <div class="skeleton-box" style="height: 52px;"></div>
        <div class="skeleton-box" style="height: 52px;"></div>
        <div class="skeleton-box" style="height: 52px;"></div>
    `;

    try {
        const res = await apiRequest('/api/categories');
        const categories = res.categories || [];

        if (categories.length === 0) {
            listEl.innerHTML = `<span style="color: var(--color-text-muted);">No categories found.</span>`;
            return;
        }

        listEl.innerHTML = '';
        categories.forEach(cat => {
            const card = document.createElement('div');
            card.style.background = 'var(--color-surface-bg)';
            card.style.border = '1px solid var(--color-border)';
            card.style.borderRadius = 'var(--radius-md)';
            card.style.padding = '0.75rem 1rem';
            card.style.display = 'flex';
            card.style.justifyContent = 'space-between';
            card.style.alignItems = 'center';
            card.style.gap = '0.5rem';

            const tagBadge = `<span style="display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: var(--radius-xs, 6px); background: var(--color-primary-subtle); color: var(--color-primary); margin-right: 0.5rem; flex-shrink: 0;">${getIcon('tag', { size: 12 })}</span>`;
            const itemCount = Number(cat.item_count || 0);

            card.innerHTML = `
                <div style="flex: 1; min-width: 0;">
                    <div style="display: flex; align-items: center; font-weight: 600; color: var(--color-text); font-size: 0.92rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                        ${tagBadge} <span>${escapeHtml(cat.name)}</span>
                    </div>
                    <div style="font-size: 0.75rem; color: var(--color-text-muted); margin-top: 0.2rem;" class="tabular-nums">
                        ${itemCount} item${itemCount === 1 ? '' : 's'} recorded • ${formatCurrency(Number(cat.total_spent || 0))} spent
                    </div>
                </div>

                <div style="display: flex; gap: 0.35rem;">
                    <button class="icon-btn set-btn-rename" data-id="${cat.id}" data-name="${escapeHtml(cat.name)}" type="button" aria-label="Rename category" title="Rename category" style="padding: 0.25rem 0.45rem;">
                        ${getIcon('edit-2', { size: 14 })}
                    </button>
                    ${!cat.is_system ? `
                    <button class="icon-btn set-btn-delete" data-id="${cat.id}" data-name="${escapeHtml(cat.name)}" type="button" aria-label="Delete category" title="Delete category" style="padding: 0.25rem 0.45rem; color: var(--color-danger);">
                        ${getIcon('trash-2', { size: 14 })}
                    </button>` : ''}
                </div>
            `;

            // Rename listener
            card.querySelector('.set-btn-rename')?.addEventListener('click', () => {
                promptRenameCategory(cat.id, cat.name);
            });

            // Delete listener
            card.querySelector('.set-btn-delete')?.addEventListener('click', () => {
                confirmDeleteCategory(cat.id, cat.name);
            });

            listEl.appendChild(card);
        });
    } catch (e) {
        console.error('Error loading categories:', e);
        listEl.innerHTML = `
            <div style="grid-column: 1 / -1; padding: 1.5rem; text-align: center;">
                <p style="color: var(--color-danger); font-size: 0.88rem; margin-bottom: 0.5rem;">Failed to load categories: ${escapeHtml(e.message || e)}</p>
                <button class="btn btn-secondary" onclick="window.loadSettings()" type="button" style="display: inline-flex; align-items: center; gap: 0.35rem; margin: 0 auto;">
                    ${getIcon('refresh-cw', { size: 13 })} Retry
                </button>
            </div>
        `;
    }
}

function openCategoryModal() {
    const modal = document.getElementById('setCategoryModal');
    const nameInput = document.getElementById('setCatName');
    const colorInput = document.getElementById('setCatColor');
    const errorEl = document.getElementById('setCatError');

    if (!modal) return;
    if (nameInput) nameInput.value = '';
    if (colorInput) colorInput.value = '#4f46e5';
    if (errorEl) errorEl.style.display = 'none';

    modal.classList.add('open');
}

function closeCategoryModal() {
    const modal = document.getElementById('setCategoryModal');
    if (modal) modal.classList.remove('open');
}

async function saveCategory() {
    const name = document.getElementById('setCatName')?.value.trim();
    const color = document.getElementById('setCatColor')?.value || '#4f46e5';
    const errorEl = document.getElementById('setCatError');

    if (!name) {
        if (errorEl) {
            errorEl.textContent = 'Category name cannot be empty.';
            errorEl.style.display = 'block';
        }
        return;
    }

    try {
        await apiRequest('/api/categories/add', {
            method: 'POST',
            body: { name, color, icon: 'tag' },
        });
        showToast('Category created', 'success');
        closeCategoryModal();
        await loadCategoriesList();
    } catch (e) {
        if (errorEl) {
            errorEl.textContent = e.message || 'Failed to add category.';
            errorEl.style.display = 'block';
        }
    }
}

async function promptRenameCategory(catId, currentName) {
    const newName = prompt(`Enter new name for "${currentName}":`, currentName);
    if (!newName || newName.trim() === '' || newName.trim() === currentName) {
        return;
    }

    try {
        await apiRequest('/api/categories/rename', {
            method: 'POST',
            body: { category_id: Number(catId), new_name: newName.trim() },
        });
        showToast('Category renamed', 'success');
        await loadCategoriesList();
    } catch (e) {
        showToast('Failed to rename category: ' + e.message, 'danger');
    }
}

async function confirmDeleteCategory(catId, catName) {
    const confirmed = await showConfirmModal(
        `Are you sure you want to delete the category "${catName}"? Existing items will be preserved.`,
        'Delete Category'
    );
    if (confirmed) {
        try {
            await apiRequest('/api/categories/delete', {
                method: 'POST',
                body: { category_id: Number(catId) },
            });
            showToast('Category deleted', 'success');
            await loadCategoriesList();
        } catch (e) {
            showToast('Failed to delete category: ' + e.message, 'danger');
        }
    }
}
