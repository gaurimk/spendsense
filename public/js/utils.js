/**
 * SpendSense - Core Utilities & UI Feedback Helpers
 * Currency & Date formatting, In-app Toasts, Confirmation Dialogs.
 */

import { getIcon } from './icons.js';

const currencyFormatter = new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
});

/**
 * Format currency with Indian rupee styling: ₹20,309.10
 */
export function formatCurrency(amount, currency = 'INR') {
    const num = Number(amount) || 0;
    if (currency === 'INR') {
        return currencyFormatter.format(num);
    }
    try {
        return new Intl.NumberFormat('en-IN', {
            style: 'currency',
            currency: currency,
            minimumFractionDigits: 2
        }).format(num);
    } catch {
        return `₹${num.toFixed(2)}`;
    }
}

/**
 * Friendly date format: "10 Oct 2026"
 */
export function formatDate(dateStr) {
    if (!dateStr) return '—';
    try {
        const parts = String(dateStr).split('-');
        if (parts.length === 3) {
            const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
            return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
        }
        const d = new Date(dateStr);
        return isNaN(d.getTime()) ? dateStr : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    } catch {
        return dateStr;
    }
}

/**
 * Short date format: "10 Oct"
 */
export function formatDateShort(dateStr) {
    if (!dateStr) return '';
    try {
        const parts = String(dateStr).split('-');
        if (parts.length === 3) {
            const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
            return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
        }
        const d = new Date(dateStr);
        return isNaN(d.getTime()) ? dateStr : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    } catch {
        return dateStr;
    }
}

/**
 * Escape HTML safe strings
 */
export function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * Clean nested parentheses in generated period labels, e.g.:
 * "this month (This Month (Oct 2026))" -> "this month (Oct 2026)"
 * "(This Month (Oct 2026))" -> "This Month (Oct 2026)"
 * "Spending by Category (This Month (Oct 2026))" -> "Spending by Category — This Month (Oct 2026)"
 */
export function cleanNestedParentheses(str) {
    if (!str) return '';
    let out = String(str);
    // Case 1: "this month (This Month (Oct 2026))" -> "this month (Oct 2026)"
    out = out.replace(/\b(this month|last month|this year)\s*\(\s*\1\s*\(([^()]+)\)\s*\)/gi, '$1 ($2)');
    // Case 2: "(This Month (Oct 2026))" -> "This Month (Oct 2026)"
    out = out.replace(/\(\s*((?:This|Last)\s+(?:Month|Year|Week|\d+\s+Months?)\s*\([^()]+\))\s*\)/gi, '$1');
    // Case 3: Any remaining outer parens wrapping inner parens: "(Foo (Bar))" -> "(Foo — Bar)"
    out = out.replace(/\(([^()]+?)\s*\(([^()]+?)\)\)/g, '($1 — $2)');
    return out;
}

/**
 * Render a safe subset of Markdown (bold, italics, line breaks, simple lists)
 * Escapes all HTML first so user/merchant content cannot inject markup.
 */
export function renderSafeMarkdown(text) {
    if (text === null || text === undefined || text === '') return '';
    const cleaned = cleanNestedParentheses(String(text));
    const escaped = escapeHtml(cleaned);

    // Apply inline bold and italics on escaped string
    const formatInline = (line) => {
        return line
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
    };

    const lines = escaped.split(/\r?\n/);
    const htmlParts = [];
    let inUl = false;
    let inOl = false;

    const closeLists = () => {
        if (inUl) {
            htmlParts.push('</ul>');
            inUl = false;
        }
        if (inOl) {
            htmlParts.push('</ol>');
            inOl = false;
        }
    };

    for (let i = 0; i < lines.length; i++) {
        const rawLine = lines[i];
        const trimmed = rawLine.trim();

        const ulMatch = trimmed.match(/^(?:•|-|\*)\s+(.+)$/);
        const olMatch = trimmed.match(/^(\d+)\.\s+(.+)$/);

        if (ulMatch) {
            if (inOl) {
                htmlParts.push('</ol>');
                inOl = false;
            }
            if (!inUl) {
                htmlParts.push('<ul class="chat-md-list">');
                inUl = true;
            }
            htmlParts.push(`<li>${formatInline(ulMatch[1])}</li>`);
        } else if (olMatch) {
            if (inUl) {
                htmlParts.push('</ul>');
                inUl = false;
            }
            if (!inOl) {
                htmlParts.push('<ol class="chat-md-list">');
                inOl = true;
            }
            htmlParts.push(`<li>${formatInline(olMatch[2])}</li>`);
        } else if (trimmed === '') {
            closeLists();
            if (htmlParts.length > 0 && htmlParts[htmlParts.length - 1] !== '<div class="chat-md-spacer"></div>') {
                htmlParts.push('<div class="chat-md-spacer"></div>');
            }
        } else {
            closeLists();
            const prevWasText = htmlParts.length > 0 && !htmlParts[htmlParts.length - 1].endsWith('</ul>') && !htmlParts[htmlParts.length - 1].endsWith('</ol>') && htmlParts[htmlParts.length - 1] !== '<div class="chat-md-spacer"></div>';
            if (prevWasText) {
                htmlParts.push('<br>');
            }
            htmlParts.push(formatInline(rawLine));
        }
    }
    closeLists();

    return htmlParts.join('');
}

/**
 * Show a sleek in-app toast notification
 * @param {string} message
 * @param {'success'|'error'|'warning'|'info'} type
 * @param {number} duration
 */
export function showToast(message, type = 'info', duration = 3500) {
    const normalizedType = type === 'danger' ? 'error' : type;
    let container = document.getElementById('toastContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toastContainer';
        container.className = 'toast-container';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${normalizedType}`;

    let iconName = 'info';
    if (normalizedType === 'success') iconName = 'check-circle';
    else if (normalizedType === 'error') iconName = 'alert-circle';
    else if (normalizedType === 'warning') iconName = 'alert-triangle';

    toast.innerHTML = `
        <div class="toast-icon">${getIcon(iconName, '', { size: 18 })}</div>
        <div class="toast-message">${escapeHtml(message)}</div>
        <button type="button" class="toast-close" aria-label="Dismiss notification">${getIcon('x', '', { size: 14 })}</button>
    `;

    const closeBtn = toast.querySelector('.toast-close');
    const dismiss = () => {
        toast.classList.add('toast-hiding');
        setTimeout(() => toast.remove(), 200);
    };

    closeBtn.addEventListener('click', dismiss);
    container.appendChild(toast);

    if (duration > 0) {
        setTimeout(dismiss, duration);
    }
}

/**
 * Show an in-app confirmation modal (replaces native window.confirm)
 * Supports both showConfirmModal(message, title) and showConfirmModal({ title, message, ... })
 */
export function showConfirmModal(messageOrOpts = {}, titleArg = 'Confirm Action') {
    let title = 'Confirm Action';
    let message = 'Are you sure you want to proceed?';
    let confirmText = 'Confirm';
    let cancelText = 'Cancel';
    let isDanger = false;

    if (typeof messageOrOpts === 'string') {
        message = messageOrOpts;
        title = titleArg || 'Confirm Action';
        isDanger = /delete|discard|erase/i.test(title) || /delete|discard|erase/i.test(message);
    } else if (messageOrOpts && typeof messageOrOpts === 'object') {
        title = messageOrOpts.title || 'Confirm Action';
        message = messageOrOpts.message || 'Are you sure you want to proceed?';
        confirmText = messageOrOpts.confirmText || 'Confirm';
        cancelText = messageOrOpts.cancelText !== undefined ? messageOrOpts.cancelText : 'Cancel';
        isDanger = Boolean(messageOrOpts.isDanger);
    }

    return new Promise((resolve) => {
        let modal = document.getElementById('globalConfirmModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'globalConfirmModal';
            modal.className = 'modal-backdrop';
            modal.innerHTML = `
                <div class="modal-window modal-confirm" style="max-width: 420px;">
                    <div class="modal-header">
                        <div class="modal-title" id="confirmModalTitle"></div>
                    </div>
                    <div class="modal-body" style="padding: 1.25rem;">
                        <p id="confirmModalMessage" style="margin: 0; color: var(--color-text-muted); font-size: 0.95rem; line-height: 1.5;"></p>
                    </div>
                    <div class="modal-footer" style="display: flex; justify-content: flex-end; gap: 0.75rem;">
                        <button type="button" class="btn btn-secondary" id="confirmModalCancelBtn">Cancel</button>
                        <button type="button" class="btn btn-primary" id="confirmModalOkBtn">Confirm</button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
        }

        const titleEl = modal.querySelector('#confirmModalTitle');
        const msgEl = modal.querySelector('#confirmModalMessage');
        const okBtn = modal.querySelector('#confirmModalOkBtn');
        const cancelBtn = modal.querySelector('#confirmModalCancelBtn');
        const closeBtn = modal.querySelector('#confirmModalCloseBtn');

        titleEl.textContent = title;
        msgEl.textContent = message;
        okBtn.textContent = confirmText;
        if (cancelBtn) {
            cancelBtn.textContent = cancelText;
            cancelBtn.style.display = cancelText ? '' : 'none';
        }

        if (isDanger) {
            okBtn.className = 'btn btn-danger';
        } else {
            okBtn.className = 'btn btn-primary';
        }

        const cleanup = (result) => {
            modal.classList.remove('open');
            okBtn.onclick = null;
            if (cancelBtn) cancelBtn.onclick = null;
            if (closeBtn) closeBtn.onclick = null;
            resolve(result);
        };

        okBtn.onclick = () => cleanup(true);
        if (cancelBtn) cancelBtn.onclick = () => cleanup(false);
        if (closeBtn) closeBtn.onclick = () => cleanup(false);

        modal.classList.add('open');
    });
}

/**
 * In-app alert modal (replaces native window.alert)
 */
export function showAlertModal(message, title = 'Notice') {
    return showConfirmModal({
        title,
        message,
        confirmText: 'OK',
        cancelText: '',
    }).then(() => {});
}

// Global hooks
if (typeof window !== 'undefined') {
    window.formatCurrency = formatCurrency;
    window.formatDate = formatDate;
    window.formatDateShort = formatDateShort;
    window.escapeHtml = escapeHtml;
    window.cleanNestedParentheses = cleanNestedParentheses;
    window.renderSafeMarkdown = renderSafeMarkdown;
    window.showToast = showToast;
    window.showConfirmModal = showConfirmModal;
    window.showAlertModal = showAlertModal;
}
