/**
 * SpendSense - Settings Screen Controller
 * Category management (Add, Rename, Delete),
 * CSV Data Export (Bills and Items), and "Delete All My Data" safeguard.
 */

import { apiRequest } from './api.js';

export async function loadSettingsTab() {
    const container = document.getElementById('screenSettings');
    if (!container) return;

    container.innerHTML = `
        <div style="max-width: 950px; margin: 0 auto; width: 100%;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.25rem; flex-wrap: wrap; gap: 0.5rem;">
                <div>
                    <h2 style="font-size: 1.4rem; font-weight: 700;">⚙️ Settings & Data Controls</h2>
                    <p style="color: var(--text-muted); font-size: 0.88rem; margin-top: 0.25rem;">
                        Manage expense categories, download CSV backups, and manage privacy controls.
                    </p>
                </div>
            </div>

            <!-- 1. CATEGORY MANAGEMENT CARD -->
            <div style="background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 1.25rem; margin-bottom: 1.25rem;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; flex-wrap: wrap; gap: 0.5rem;">
                    <div>
                        <h3 style="font-size: 1.05rem; font-weight: 700;">🏷️ Expense Categories</h3>
                        <p style="font-size: 0.8rem; color: var(--text-muted);">Organize your purchases into custom categories</p>
                    </div>
                    <button id="setBtnAddCategory" class="btn btn-primary" type="button" style="font-size: 0.85rem; padding: 0.4rem 0.85rem;">
                        ➕ Add Category
                    </button>
                </div>

                <div id="setCategoriesList" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 0.75rem;">
                    <div style="color: var(--text-muted); font-size: 0.85rem;">Loading categories...</div>
                </div>
            </div>

            <!-- 2. DATA EXPORT CARD -->
            <div style="background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 1.25rem; margin-bottom: 1.25rem;">
                <h3 style="font-size: 1.05rem; font-weight: 700; margin-bottom: 0.35rem;">📥 Export Your Data (CSV)</h3>
                <p style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 1rem;">
                    Download an offline spreadsheet of all your recorded transactions and items for tax filing, Excel accounting, or personal archiving.
                </p>

                <div style="display: flex; gap: 0.75rem; flex-wrap: wrap;">
                    <button id="btnExportBillsCsv" class="btn btn-secondary" type="button">
                        📄 Export Bills CSV (Totals & Dates)
                    </button>
                    <button id="btnExportItemsCsv" class="btn btn-secondary" type="button">
                        🧾 Export Line Items CSV (All Products & Rates)
                    </button>
                </div>
            </div>

            <!-- 3. PRIVACY & DANGER ZONE CARD -->
            <div style="background: var(--bg-surface); border: 1px solid rgba(239, 68, 68, 0.4); border-radius: var(--radius-lg); padding: 1.25rem; margin-bottom: 1.25rem; border-left: 4px solid #ef4444;">
                <h3 style="font-size: 1.05rem; font-weight: 700; color: #f87171; margin-bottom: 0.35rem;">🗑️ Danger Zone & Data Deletion</h3>
                <p style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 1rem;">
                    Permanently delete all your uploaded bills, parsed line items, category budgets, accuracy logs, and reminders. This action cannot be undone.
                </p>

                <button id="btnDeleteAllData" class="btn btn-danger-outline" type="button">
                    ⚠️ Delete All My Data
                </button>
            </div>
        </div>

        <!-- Add Category Modal -->
        <div class="modal-overlay" id="setCategoryModal" style="display: none;">
            <div class="modal-dialog" style="max-width: 420px;">
                <div class="modal-header">
                    <h3 id="setCatModalTitle">Add Expense Category</h3>
                    <button class="modal-close-btn" id="setCatModalCloseBtn" type="button">&times;</button>
                </div>
                <div class="modal-body">
                    <form id="setCatForm">
                        <input type="hidden" id="setCatId" value="">

                        <div class="form-group">
                            <label class="form-label">Category Name *</label>
                            <input type="text" id="setCatName" class="form-control" placeholder="e.g. Pet Care, Fitness & Gym" required>
                        </div>

                        <div class="form-group">
                            <label class="form-label">Badge Color</label>
                            <div style="display: flex; gap: 0.5rem; align-items: center;">
                                <input type="color" id="setCatColor" value="#6366f1" style="width: 45px; height: 38px; border: 1px solid var(--border); border-radius: 6px; background: transparent; cursor: pointer;">
                                <span style="font-size: 0.82rem; color: var(--text-muted);">Choose a distinct color for chart badges</span>
                            </div>
                        </div>

                        <div id="setCatError" style="color: #ef4444; font-size: 0.85rem; margin-bottom: 0.75rem; display: none;"></div>

                        <div style="display: flex; justify-content: flex-end; gap: 0.75rem; margin-top: 1rem;">
                            <button type="button" class="btn btn-secondary" id="setCatBtnCancel">Cancel</button>
                            <button type="submit" class="btn btn-primary" id="setCatBtnSave">Save Category</button>
                        </div>
                    </form>
                </div>
            </div>
        </div>

        <!-- Delete All Data Confirmation Modal -->
        <div class="modal-overlay" id="setDeleteConfirmModal" style="display: none;">
            <div class="modal-dialog" style="max-width: 460px; border-color: #ef4444;">
                <div class="modal-header">
                    <h3 style="color: #ef4444;">⚠️ Confirm Complete Data Deletion</h3>
                    <button class="modal-close-btn" id="setDeleteModalCloseBtn" type="button">&times;</button>
                </div>
                <div class="modal-body">
                    <p style="font-size: 0.9rem; color: #ffffff; margin-bottom: 0.75rem;">
                        This will permanently erase:
                    </p>
                    <ul style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 1rem; padding-left: 1.25rem; line-height: 1.6;">
                        <li>All uploaded bill images and receipts</li>
                        <li>All extracted items and expense records</li>
                        <li>All monthly category budgets and progress</li>
                        <li>All warranties and return-deadline reminders</li>
                        <li>Chat conversation history</li>
                    </ul>
                    <p style="font-size: 0.85rem; color: #f87171; font-weight: 600; margin-bottom: 1rem;">
                        Please type <strong>DELETE</strong> below to confirm:
                    </p>
                    <input type="text" id="setDeleteConfirmInput" class="form-control" placeholder="Type DELETE to confirm" style="border-color: #ef4444;">

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

    // CSV Exports
    document.getElementById('btnExportBillsCsv')?.addEventListener('click', () => {
        window.open('/api/export/csv?type=bills', '_blank');
    });

    document.getElementById('btnExportItemsCsv')?.addEventListener('click', () => {
        window.open('/api/export/csv?type=items', '_blank');
    });

    // Delete All Data Modal
    const deleteModal = document.getElementById('setDeleteConfirmModal');
    const deleteInput = document.getElementById('setDeleteConfirmInput');
    const deleteExecuteBtn = document.getElementById('setDeleteBtnExecute');

    document.getElementById('btnDeleteAllData')?.addEventListener('click', () => {
        if (deleteModal) {
            deleteModal.style.display = 'flex';
            if (deleteInput) deleteInput.value = '';
            if (deleteExecuteBtn) deleteExecuteBtn.disabled = true;
        }
    });

    document.getElementById('setDeleteModalCloseBtn')?.addEventListener('click', () => {
        if (deleteModal) deleteModal.style.display = 'none';
    });
    document.getElementById('setDeleteBtnCancel')?.addEventListener('click', () => {
        if (deleteModal) deleteModal.style.display = 'none';
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
            await apiRequest('/api/account/delete-all-data', {
                method: 'POST',
                body: { confirm: true },
            });
            alert('All your data has been completely erased.');
            if (deleteModal) deleteModal.style.display = 'none';
            // Reload page to start with fresh clean state
            window.location.reload();
        } catch (err) {
            alert('Failed to erase data: ' + err.message);
            deleteExecuteBtn.disabled = false;
            deleteExecuteBtn.textContent = 'Permanently Erase All Data';
        }
    });
}

async function loadCategoriesList() {
    const listEl = document.getElementById('setCategoriesList');
    if (!listEl) return;

    try {
        const res = await apiRequest('/api/categories');
        const categories = res.categories || [];

        if (categories.length === 0) {
            listEl.innerHTML = `<span style="color: var(--text-muted);">No categories found.</span>`;
            return;
        }

        listEl.innerHTML = '';
        categories.forEach(cat => {
            const card = document.createElement('div');
            card.style.background = 'var(--bg-main)';
            card.style.border = '1px solid var(--border)';
            card.style.borderRadius = 'var(--radius-md)';
            card.style.padding = '0.75rem 1rem';
            card.style.display = 'flex';
            card.style.justifyContent = 'space-between';
            card.style.alignItems = 'center';
            card.style.gap = '0.5rem';

            const colorDot = `<span style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: ${cat.color || '#6366f1'}; margin-right: 0.4rem;"></span>`;
            const itemCount = Number(cat.item_count || 0);

            card.innerHTML = `
                <div style="flex: 1; min-width: 0;">
                    <div style="display: flex; align-items: center; font-weight: 600; color: #ffffff; font-size: 0.92rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                        ${colorDot} ${escapeHtml(cat.name)}
                    </div>
                    <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.2rem;">
                        ${itemCount} item${itemCount === 1 ? '' : 's'} recorded &bull; ₹${Number(cat.total_spent || 0).toFixed(0)} spent
                    </div>
                </div>

                <div style="display: flex; gap: 0.35rem;">
                    <button class="icon-btn set-btn-rename" data-id="${cat.id}" data-name="${escapeHtml(cat.name)}" type="button" title="Rename category" style="padding: 0.25rem 0.45rem; font-size: 0.82rem;">
                        ✏️
                    </button>
                    ${!cat.is_system ? `
                    <button class="icon-btn set-btn-delete" data-id="${cat.id}" data-name="${escapeHtml(cat.name)}" type="button" title="Delete category" style="padding: 0.25rem 0.45rem; font-size: 0.82rem; color: #ef4444;">
                        🗑️
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
        listEl.innerHTML = `<span style="color: #ef4444;">Failed to load categories.</span>`;
    }
}

function openCategoryModal() {
    const modal = document.getElementById('setCategoryModal');
    const nameInput = document.getElementById('setCatName');
    const colorInput = document.getElementById('setCatColor');
    const errorEl = document.getElementById('setCatError');

    if (!modal) return;
    if (nameInput) nameInput.value = '';
    if (colorInput) colorInput.value = '#6366f1';
    if (errorEl) errorEl.style.display = 'none';

    modal.style.display = 'flex';
}

function closeCategoryModal() {
    const modal = document.getElementById('setCategoryModal');
    if (modal) modal.style.display = 'none';
}

async function saveCategory() {
    const name = document.getElementById('setCatName')?.value.trim();
    const color = document.getElementById('setCatColor')?.value || '#6366f1';
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
        await loadCategoriesList();
    } catch (e) {
        alert('Failed to rename category: ' + e.message);
    }
}

async function confirmDeleteCategory(catId, catName) {
    if (confirm(`Are you sure you want to delete the category "${catName}"? Existing items will be preserved.`)) {
        try {
            await apiRequest('/api/categories/delete', {
                method: 'POST',
                body: { category_id: Number(catId) },
            });
            await loadCategoriesList();
        } catch (e) {
            alert('Failed to delete category: ' + e.message);
        }
    }
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
