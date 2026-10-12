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
    const countEl = document.getElementById('uploadPillCount');
    const limitEl = document.getElementById('uploadPillLimit');
    if (!pill) return;

    if (uploadLimitInfo) {
        const count = uploadLimitInfo.count ?? 0;
        const limit = uploadLimitInfo.limit ?? 20;
        if (countEl) countEl.textContent = count;
        if (limitEl) limitEl.textContent = limit;

        if (count >= limit) {
            pill.style.borderColor = 'var(--color-danger)';
            pill.style.color = 'var(--color-danger)';
        } else {
            pill.style.borderColor = 'var(--color-border)';
            pill.style.color = 'var(--color-text-muted)';
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

function getInitials(name) {
    if (!name) return 'U';
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
        return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return parts[0].slice(0, 2).toUpperCase();
}

function updateUserUI() {
    const userMenuContainer = document.getElementById('userMenuContainer');
    const userAvatarInitials = document.getElementById('userAvatarInitials');
    const userMenuName = document.getElementById('userMenuName');
    const dropdownUserName = document.getElementById('dropdownUserName');
    const dropdownUserEmail = document.getElementById('dropdownUserEmail');
    const authBtn = document.getElementById('authNavBtn');
    const uploadPill = document.getElementById('uploadPill');

    if (currentUser) {
        const initials = getInitials(currentUser.full_name);
        if (userAvatarInitials) userAvatarInitials.textContent = initials;
        if (userMenuName) userMenuName.textContent = currentUser.full_name;
        if (dropdownUserName) dropdownUserName.textContent = currentUser.full_name;
        if (dropdownUserEmail) dropdownUserEmail.textContent = currentUser.email;

        if (userMenuContainer) userMenuContainer.style.display = 'block';
        if (authBtn) authBtn.style.display = 'none';
        if (uploadPill) {
            uploadPill.style.display = 'inline-flex';
            updateUploadPill();
        }
        closeAuthModal();
    } else {
        if (userMenuContainer) userMenuContainer.style.display = 'none';
        if (uploadPill) uploadPill.style.display = 'none';
        if (authBtn) {
            authBtn.style.display = 'inline-block';
            authBtn.textContent = 'Log In / Sign Up';
            authBtn.onclick = openAuthModal;
        }
        openAuthModal();
    }
}

export function openAuthModal() {
    const modal = document.getElementById('authModal');
    if (modal) {
        modal.classList.add('open');
        document.body.classList.add('modal-open');
    }
}

export function closeAuthModal() {
    const modal = document.getElementById('authModal');
    if (modal) {
        modal.classList.remove('open');
        document.body.classList.remove('modal-open');
    }
}
