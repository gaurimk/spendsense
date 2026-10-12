/**
 * SpendSense - Authentication & User State Module (ES Module)
 */

import { apiRequest, setCsrfToken } from './api.js';

let currentUser = null;
let currentSettings = null;
let uploadLimitInfo = null;

export function getCurrentUser() {
    return currentUser;
}

export function getCurrentSettings() {
    return currentSettings;
}

export function getUploadLimit() {
    return uploadLimitInfo;
}

export function setUploadLimit(info) {
    uploadLimitInfo = info;
    updateUploadPill();
}

export function updateUploadPill() {
    const pill = document.getElementById('uploadPill');
    if (!pill) return;
    if (uploadLimitInfo) {
        const count = uploadLimitInfo.count ?? 0;
        const limit = uploadLimitInfo.limit ?? 20;
        pill.innerHTML = `<span>⚡</span> <span><strong>${count}</strong> / ${limit} uploads today</span>`;
        if (count >= limit) {
            pill.style.borderColor = '#ef4444';
            pill.style.color = '#fca5a5';
        } else {
            pill.style.borderColor = 'var(--border)';
            pill.style.color = 'var(--text-muted)';
        }
    }
}

export async function checkAuthState() {
    try {
        const data = await apiRequest('/api/auth/me');
        if (data.authenticated) {
            currentUser = data.user;
            currentSettings = data.settings;
            uploadLimitInfo = data.upload_limit;
            if (data.csrf_token) setCsrfToken(data.csrf_token);
            updateUserUI();
            return true;
        } else {
            currentUser = null;
            if (data.csrf_token) setCsrfToken(data.csrf_token);
            updateUserUI();
            return false;
        }
    } catch (e) {
        console.error('Auth state check error:', e);
        currentUser = null;
        updateUserUI();
        return false;
    }
}

export async function register(fullName, email, password, currency, usageType) {
    const data = await apiRequest('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
            full_name: fullName,
            email: email,
            password: password,
            currency: currency || 'INR',
            usage_type: usageType || 'personal',
        }),
    });
    currentUser = data.user;
    currentSettings = data.settings;
    if (data.csrf_token) setCsrfToken(data.csrf_token);
    updateUserUI();
    return data;
}

export async function login(email, password) {
    const data = await apiRequest('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
    });
    currentUser = data.user;
    currentSettings = data.settings;
    if (data.csrf_token) setCsrfToken(data.csrf_token);
    updateUserUI();
    return data;
}

export async function logout() {
    await apiRequest('/api/auth/logout', { method: 'POST' });
    currentUser = null;
    currentSettings = null;
    updateUserUI();
    window.location.reload();
}

function updateUserUI() {
    const userBadge = document.getElementById('userBadge');
    const authBtn = document.getElementById('authNavBtn');
    const uploadPill = document.getElementById('uploadPill');

    if (currentUser) {
        if (userBadge) {
            userBadge.textContent = `${currentUser.full_name} (${currentSettings?.currency_symbol || '₹'})`;
            userBadge.style.display = 'inline-block';
        }
        if (authBtn) {
            authBtn.textContent = 'Logout';
            authBtn.onclick = logout;
        }
        if (uploadPill) {
            uploadPill.style.display = 'flex';
            updateUploadPill();
        }
        closeAuthModal();
    } else {
        if (userBadge) userBadge.style.display = 'none';
        if (uploadPill) uploadPill.style.display = 'none';
        if (authBtn) {
            authBtn.textContent = 'Login / Sign Up';
            authBtn.onclick = openAuthModal;
        }
        openAuthModal();
    }
}

export function openAuthModal() {
    const modal = document.getElementById('authModal');
    if (modal) modal.classList.add('open');
}

export function closeAuthModal() {
    const modal = document.getElementById('authModal');
    if (modal) modal.classList.remove('open');
}
