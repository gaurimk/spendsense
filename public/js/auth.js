/**
 * SpendSense - Authentication & User State Module (ES Module)
 * Powered by Firebase Authentication (Email/Password & Google Sign-In)
 * with Cloud Firestore user document synchronization.
 */

import { apiRequest, setCsrfToken } from './api.js';
import {
    loginWithEmail as firebaseLoginWithEmail,
    registerWithEmail as firebaseRegisterWithEmail,
    loginWithGoogle as firebaseLoginWithGoogle,
    logoutFirebase,
    initAuthListener,
    getCurrentFirebaseUser,
    getCurrentAppUser
} from './firebase-auth.js';

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
    // 1. Check existing backend session first
    try {
        const data = await apiRequest('/api/auth/me');
        if (data.authenticated) {
            currentUser = data.user;
            currentSettings = data.settings;
            uploadLimitInfo = data.upload_limit;
            if (data.csrf_token) setCsrfToken(data.csrf_token);
            updateUserUI();
            return true;
        }
    } catch (e) {
        console.warn('Backend session check:', e.message);
    }

    // 2. Listen to Firebase Auth state
    return new Promise((resolve) => {
        initAuthListener((firebaseData) => {
            if (firebaseData && (firebaseData.authenticated || firebaseData.user)) {
                currentUser = firebaseData.user;
                currentSettings = firebaseData.settings;
                uploadLimitInfo = firebaseData.upload_limit || { count: 0, limit: 20 };
                if (firebaseData.csrf_token) setCsrfToken(firebaseData.csrf_token);
                updateUserUI();
                resolve(true);
            } else {
                currentUser = null;
                updateUserUI();
                resolve(false);
            }
        });
    });
}

/**
 * Register with Firebase Email & Password
 */
export async function register(fullName, email, password, currency, usageType) {
    try {
        const data = await firebaseRegisterWithEmail(fullName, email, password, currency, usageType);
        currentUser = data.user;
        currentSettings = data.settings;
        if (data.csrf_token) setCsrfToken(data.csrf_token);
        updateUserUI();
        return data;
    } catch (firebaseErr) {
        // Humanize Firebase error codes
        throw mapFirebaseError(firebaseErr);
    }
}

/**
 * Log In with Firebase Email & Password
 */
export async function login(email, password) {
    try {
        const data = await firebaseLoginWithEmail(email, password);
        currentUser = data.user;
        currentSettings = data.settings;
        if (data.csrf_token) setCsrfToken(data.csrf_token);
        updateUserUI();
        return data;
    } catch (firebaseErr) {
        throw mapFirebaseError(firebaseErr);
    }
}

/**
 * Sign In with Google Popup
 */
export async function googleSignIn() {
    try {
        const data = await firebaseLoginWithGoogle();
        currentUser = data.user;
        currentSettings = data.settings;
        if (data.csrf_token) setCsrfToken(data.csrf_token);
        updateUserUI();
        return data;
    } catch (firebaseErr) {
        throw mapFirebaseError(firebaseErr);
    }
}

/**
 * Log out user from Firebase and local session
 */
export async function logout() {
    await logoutFirebase();
}

function mapFirebaseError(err) {
    const code = err.code || '';
    let msg = err.message || 'Authentication error';
    if (code === 'auth/email-already-in-use') {
        msg = 'An account with this email address already exists. Please log in.';
    } else if (code === 'auth/invalid-email') {
        msg = 'Please enter a valid email address.';
    } else if (code === 'auth/weak-password') {
        msg = 'Password should be at least 6 characters.';
    } else if (code === 'auth/user-not-found' || code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
        msg = 'Incorrect email or password. Please try again.';
    } else if (code === 'auth/popup-closed-by-user') {
        msg = 'Google Sign-in was cancelled before completion.';
    } else if (code === 'auth/unauthorized-domain') {
        msg = 'This domain is not authorized for Google Sign-in in Firebase Console. Please add localhost to Authorized Domains.';
    }
    const e = new Error(msg);
    e.code = code;
    return e;
}

function getInitials(name) {
    if (!name) return 'U';
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
        return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return parts[0].slice(0, 2).toUpperCase();
}

export function updateUserUI() {
    const userMenuContainer = document.getElementById('userMenuContainer');
    const userAvatarInitials = document.getElementById('userAvatarInitials');
    const railAvatarInitials = document.getElementById('railAvatarInitials');
    const modePillText = document.getElementById('modePillText');
    const userMenuName = document.getElementById('userMenuName');
    const dropdownUserName = document.getElementById('dropdownUserName');
    const dropdownUserEmail = document.getElementById('dropdownUserEmail');
    const authBtn = document.getElementById('authNavBtn');
    const uploadPill = document.getElementById('uploadPill');

    // Update Mode Pill from user settings if available
    if (currentSettings && (currentSettings.usage_type === 'shop' || currentSettings.shop_mode)) {
        if (typeof window.setAppMode === 'function') {
            window.setAppMode('business', false);
        }
    }

    if (currentUser) {
        const initials = getInitials(currentUser.full_name);
        if (userAvatarInitials) userAvatarInitials.textContent = initials;
        if (railAvatarInitials) railAvatarInitials.textContent = initials;
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
        if (railAvatarInitials) railAvatarInitials.textContent = 'U';
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
