/**
 * SpendSense - Main Application Controller (ES Module)
 */

import { checkAuthState, register, login, closeAuthModal, getCurrentUser, logout } from './auth.js';
import { initChat, loadChatHistory, appendAssistantMessage } from './chat.js';
import { loadCategories } from './bill-modal.js';
import { loadInsightsDashboard } from './insights.js';
import { loadBillsTab } from './bills.js';
import { loadBudgetsTab } from './budgets.js';
import { loadPriceTrackerTab } from './price-tracker.js';
import { loadRemindersTab } from './reminders.js';
import { loadSettingsTab } from './settings.js';
import { apiRequest } from './api.js';
import { showToast, showConfirmModal } from './utils.js';
import { getIcon } from './icons.js';

// Global hooks
window.loadInsights = loadInsightsDashboard;
window.loadBills = loadBillsTab;
window.loadBudgets = loadBudgetsTab;
window.loadPriceTracker = loadPriceTrackerTab;
window.loadReminders = loadRemindersTab;
window.loadSettings = loadSettingsTab;

document.addEventListener('DOMContentLoaded', async () => {
    // 1. Initialize Theme (Light / Dark)
    initTheme();

    // 2. Setup Tab and Mobile Navigation
    setupTabNavigation();

    // 3. Setup User Menu Dropdown
    setupUserMenu();

    // 4. Setup Auth Form Listeners
    setupAuthListeners();

    // 5. Setup Demo Data Loaders
    setupDemoDataButtons();

    // 6. Initialize Chat
    initChat();

    // 7. Ensure Chat screen is active
    if (window.switchTab) {
        window.switchTab('screenChat');
    }

    // 8. Check Auth State and load categories & history
    try {
        const isAuthed = await checkAuthState();
        if (isAuthed) {
            await loadCategories();
            await loadChatHistory();
        }
    } catch (e) {
        console.error('Initialization error:', e);
        if (window.showGlobalError) {
            window.showGlobalError('Error initializing app: ' + (e.message || e));
        }
    }

    // 9. Register PWA Service Worker
    if ('serviceWorker' in navigator && (window.location.protocol === 'https:' || window.location.hostname === 'localhost')) {
        navigator.serviceWorker.register('/sw.js').catch(err => {
            console.warn('Service worker registration note:', err);
        });
    }
});

/* ─────────────────────────────────────────────────────────────
   Theme Management (Dark / Light with localStorage & system preference)
───────────────────────────────────────────────────────────── */
function initTheme() {
    const savedTheme = localStorage.getItem('spendsense_theme');
    const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const initialTheme = savedTheme || (systemPrefersDark ? 'dark' : 'light');

    applyTheme(initialTheme);

    const toggleBtn = document.getElementById('themeToggleBtn');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
            const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
            const nextTheme = currentTheme === 'dark' ? 'light' : 'dark';
            applyTheme(nextTheme);
            localStorage.setItem('spendsense_theme', nextTheme);
            showToast(`Switched to ${nextTheme} theme`, 'info', 2000);
        });
    }

    // Listen to OS preference changes if user hasn't explicitly set preference
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
        if (!localStorage.getItem('spendsense_theme')) {
            applyTheme(e.matches ? 'dark' : 'light');
        }
    });
}

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const iconContainer = document.getElementById('themeToggleIcon');
    if (iconContainer) {
        // When theme is dark, show sun to toggle to light. When light, show moon.
        iconContainer.innerHTML = theme === 'dark' ? getIcon('sun', { size: 18 }) : getIcon('moon', { size: 18 });
    }
    const metaThemeColor = document.getElementById('metaThemeColor');
    if (metaThemeColor) {
        metaThemeColor.setAttribute('content', theme === 'dark' ? '#0b0f17' : '#f8fafc');
    }
    window.dispatchEvent(new CustomEvent('themechanged', { detail: { theme } }));
}

/* ─────────────────────────────────────────────────────────────
   Navigation Management (Desktop Tabs + Mobile Bottom Nav + Sheet)
───────────────────────────────────────────────────────────── */
function setupTabNavigation() {
    const desktopTabs = document.querySelectorAll('.nav-tabs .tab-btn[data-screen]');
    const mobileNavItems = document.querySelectorAll('.mobile-nav-bar .mobile-nav-item[data-screen]');
    const sheetItems = document.querySelectorAll('.mobile-more-sheet .sheet-item-btn[data-screen]');
    const screens = document.querySelectorAll('.screen-view');

    const moreBtn = document.getElementById('mobileMoreBtn');
    const moreSheet = document.getElementById('mobileMoreSheet');

    window.switchTab = function(targetScreenId) {
        if (!targetScreenId) return;

        // Desktop tabs update
        desktopTabs.forEach(t => {
            if (t.dataset.screen === targetScreenId) {
                t.classList.add('active');
            } else {
                t.classList.remove('active');
            }
        });

        // Mobile bottom nav update
        let isPrimaryMobileScreen = false;
        mobileNavItems.forEach(m => {
            if (m.dataset.screen === targetScreenId) {
                m.classList.add('active');
                isPrimaryMobileScreen = true;
            } else {
                m.classList.remove('active');
            }
        });

        if (moreBtn) {
            if (!isPrimaryMobileScreen && ['screenPriceTracker', 'screenReminders', 'screenSettings'].includes(targetScreenId)) {
                moreBtn.classList.add('active');
            } else {
                moreBtn.classList.remove('active');
            }
        }

        // Close more bottom sheet if open
        if (moreSheet) {
            moreSheet.classList.remove('open');
        }

        // Screens activation
        screens.forEach(s => {
            if (s.id === targetScreenId) {
                s.classList.add('active');
            } else {
                s.classList.remove('active');
            }
        });

        // Trigger screen data loading
        if (targetScreenId === 'screenInsights') {
            loadInsightsDashboard();
        } else if (targetScreenId === 'screenBills') {
            loadBillsTab();
        } else if (targetScreenId === 'screenBudgets') {
            loadBudgetsTab();
        } else if (targetScreenId === 'screenPriceTracker') {
            loadPriceTrackerTab();
        } else if (targetScreenId === 'screenReminders') {
            loadRemindersTab();
        } else if (targetScreenId === 'screenSettings') {
            loadSettingsTab();
        }
    };

    // Desktop click handlers
    desktopTabs.forEach(tab => {
        tab.addEventListener('click', (e) => {
            e.preventDefault();
            const target = tab.dataset.screen;
            if (target) window.switchTab(target);
        });
    });

    // Mobile bar click handlers
    mobileNavItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const target = item.dataset.screen;
            if (target) window.switchTab(target);
        });
    });

    // Mobile More button toggle
    if (moreBtn && moreSheet) {
        moreBtn.addEventListener('click', (e) => {
            e.preventDefault();
            moreSheet.classList.toggle('open');
        });

        moreSheet.addEventListener('click', (e) => {
            if (e.target === moreSheet) {
                moreSheet.classList.remove('open');
            }
        });
    }

    // Sheet items click handlers
    sheetItems.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const target = btn.dataset.screen;
            if (target) window.switchTab(target);
        });
    });
}

/* ─────────────────────────────────────────────────────────────
   User Dropdown Menu
───────────────────────────────────────────────────────────── */
function setupUserMenu() {
    const userMenuBtn = document.getElementById('userMenuBtn');
    const userDropdownMenu = document.getElementById('userDropdownMenu');
    const userDropdownSettings = document.getElementById('userDropdownSettings');
    const userDropdownLogout = document.getElementById('userDropdownLogout');

    if (userMenuBtn && userDropdownMenu) {
        userMenuBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = userDropdownMenu.classList.contains('open');
            if (isOpen) {
                userDropdownMenu.classList.remove('open');
                userMenuBtn.setAttribute('aria-expanded', 'false');
            } else {
                userDropdownMenu.classList.add('open');
                userMenuBtn.setAttribute('aria-expanded', 'true');
            }
        });

        document.addEventListener('click', (e) => {
            if (!userDropdownMenu.contains(e.target) && e.target !== userMenuBtn) {
                userDropdownMenu.classList.remove('open');
                userMenuBtn.setAttribute('aria-expanded', 'false');
            }
        });
    }

    if (userDropdownSettings) {
        userDropdownSettings.addEventListener('click', () => {
            if (userDropdownMenu) userDropdownMenu.classList.remove('open');
            if (window.switchTab) window.switchTab('screenSettings');
        });
    }

    if (userDropdownLogout) {
        userDropdownLogout.addEventListener('click', async () => {
            if (userDropdownMenu) userDropdownMenu.classList.remove('open');
            await logout();
        });
    }
}

/* ─────────────────────────────────────────────────────────────
   Auth Form Listeners
───────────────────────────────────────────────────────────── */
function setupAuthListeners() {
    const authForm = document.getElementById('authForm');
    const authModeTabs = document.querySelectorAll('.auth-tab-btn');
    const authSubmitBtn = document.getElementById('authSubmitBtn');
    const onboardingSection = document.getElementById('onboardingSection');
    const authError = document.getElementById('authError');
    const emailInput = document.getElementById('authEmail');
    const passwordInput = document.getElementById('authPassword');
    const nameInput = document.getElementById('authName');
    const emailError = document.getElementById('emailError');
    const passwordError = document.getElementById('passwordError');
    const nameError = document.getElementById('nameError');
    const passwordToggleBtn = document.getElementById('passwordToggleBtn');

    let isRegisterMode = false;

    // Password Show / Hide toggle
    if (passwordToggleBtn && passwordInput) {
        passwordToggleBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const isPassword = passwordInput.getAttribute('type') === 'password';
            passwordInput.setAttribute('type', isPassword ? 'text' : 'password');
            const eyeIcon = passwordToggleBtn.querySelector('.eye-icon');
            const eyeOffIcon = passwordToggleBtn.querySelector('.eye-off-icon');
            if (eyeIcon && eyeOffIcon) {
                eyeIcon.style.display = isPassword ? 'none' : 'block';
                eyeOffIcon.style.display = isPassword ? 'block' : 'none';
            }
            passwordToggleBtn.setAttribute('aria-label', isPassword ? 'Hide password' : 'Show password');
            passwordToggleBtn.setAttribute('title', isPassword ? 'Hide password' : 'Show password');
        });
    }

    // Real-time inline validation helpers
    function validateEmail() {
        if (!emailInput) return true;
        const val = emailInput.value.trim();
        const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val);
        if (!val) {
            emailInput.classList.remove('is-valid');
            emailInput.classList.add('is-invalid');
            if (emailError) { emailError.textContent = 'Email is required'; emailError.style.display = 'block'; }
            return false;
        } else if (!valid) {
            emailInput.classList.remove('is-valid');
            emailInput.classList.add('is-invalid');
            if (emailError) { emailError.textContent = 'Please enter a valid email address'; emailError.style.display = 'block'; }
            return false;
        } else {
            emailInput.classList.remove('is-invalid');
            emailInput.classList.add('is-valid');
            if (emailError) emailError.style.display = 'none';
            return true;
        }
    }

    function validatePassword() {
        if (!passwordInput) return true;
        const val = passwordInput.value;
        if (val.length < 6) {
            passwordInput.classList.remove('is-valid');
            passwordInput.classList.add('is-invalid');
            if (passwordError) { passwordError.textContent = 'Password must be at least 6 characters'; passwordError.style.display = 'block'; }
            return false;
        } else {
            passwordInput.classList.remove('is-invalid');
            passwordInput.classList.add('is-valid');
            if (passwordError) passwordError.style.display = 'none';
            return true;
        }
    }

    function validateName() {
        if (!isRegisterMode || !nameInput) return true;
        const val = nameInput.value.trim();
        if (!val) {
            nameInput.classList.remove('is-valid');
            nameInput.classList.add('is-invalid');
            if (nameError) { nameError.textContent = 'Full name is required'; nameError.style.display = 'block'; }
            return false;
        } else {
            nameInput.classList.remove('is-invalid');
            nameInput.classList.add('is-valid');
            if (nameError) nameError.style.display = 'none';
            return true;
        }
    }

    if (emailInput) {
        emailInput.addEventListener('input', () => { if (emailInput.classList.contains('is-invalid')) validateEmail(); });
        emailInput.addEventListener('blur', validateEmail);
    }
    if (passwordInput) {
        passwordInput.addEventListener('input', () => { if (passwordInput.classList.contains('is-invalid')) validatePassword(); });
        passwordInput.addEventListener('blur', validatePassword);
    }
    if (nameInput) {
        nameInput.addEventListener('input', () => { if (nameInput.classList.contains('is-invalid')) validateName(); });
        nameInput.addEventListener('blur', validateName);
    }

    authModeTabs.forEach(tab => {
        tab.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            authModeTabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            isRegisterMode = tab.dataset.mode === 'register';

            const heading = document.getElementById('authModalHeading');
            if (isRegisterMode) {
                if (heading) heading.textContent = 'Create account';
                authSubmitBtn.textContent = 'Create Account';
                onboardingSection.style.display = 'flex';
                document.getElementById('nameGroup').style.display = 'flex';
            } else {
                if (heading) heading.textContent = 'Welcome back';
                authSubmitBtn.textContent = 'Log In';
                onboardingSection.style.display = 'none';
                document.getElementById('nameGroup').style.display = 'none';
            }
            if (authError) authError.style.display = 'none';
            // Clear validation errors on mode switch
            [emailInput, passwordInput, nameInput].forEach(inp => {
                if (inp) inp.classList.remove('is-invalid', 'is-valid');
            });
            [emailError, passwordError, nameError].forEach(err => {
                if (err) err.style.display = 'none';
            });
        });
    });

    if (authForm) {
        authForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (authError) authError.style.display = 'none';

            const emailValid = validateEmail();
            const passwordValid = validatePassword();
            const nameValid = validateName();

            if (!emailValid || !passwordValid || !nameValid) {
                return;
            }

            const email = emailInput.value.trim();
            const password = passwordInput.value;
            const fullName = nameInput ? nameInput.value.trim() : '';
            const currency = document.getElementById('authCurrency').value;
            const usageType = document.querySelector('input[name="usage_type"]:checked')?.value || 'personal';

            authSubmitBtn.disabled = true;
            authSubmitBtn.textContent = 'Processing...';

            try {
                if (isRegisterMode) {
                    await register(fullName, email, password, currency, usageType);
                    showToast('Account created successfully!', 'success');
                } else {
                    await login(email, password);
                    showToast('Signed in successfully', 'success');
                }
                await loadCategories();
                await loadChatHistory();
                closeAuthModal();

                if (window.switchTab) {
                    window.switchTab('screenChat');
                }
            } catch (err) {
                if (authError) {
                    authError.textContent = err.message || 'Authentication failed. Please try again.';
                    authError.style.display = 'block';
                }
            } finally {
                authSubmitBtn.disabled = false;
                authSubmitBtn.textContent = isRegisterMode ? 'Create Account' : 'Log In';
            }
        });
    }

    const closeAuthBtn = document.getElementById('closeAuthModalBtn');
    if (closeAuthBtn) {
        closeAuthBtn.addEventListener('click', closeAuthModal);
    }
}

/* ─────────────────────────────────────────────────────────────
   Demo Data Loader (Welcome card chip + Settings)
───────────────────────────────────────────────────────────── */
function setupDemoDataButtons() {
    const chipBtn = document.getElementById('btnLoadDemoChip');

    const handleLoadDemo = async () => {
        const user = getCurrentUser();
        if (!user) {
            showToast('Please log in or create an account first.', 'warning');
            return;
        }

        const confirmed = await showConfirmModal(
            'Load ~40 realistic bills across groceries, restaurants, pharmacy, electronics, and fuel to explore insights and budgets?',
            'Load Demo Dataset'
        );

        if (!confirmed) return;

        try {
            if (chipBtn) chipBtn.disabled = true;
            showToast('Seeding realistic demo dataset...', 'info', 3000);
            const res = await apiRequest('/api/demo/seed', { method: 'POST' });
            await loadChatHistory();
            appendAssistantMessage(`Demo data loaded! Seeded ${res.bills_seeded || 40} realistic bills across 3 months. You can now explore the Insights dashboard, review the Bills list, check Budgets, or ask questions in chat!`);
            showToast(`Demo data seeded (${res.bills_seeded || 40} bills)!`, 'success', 4000);
        } catch (err) {
            showToast('Demo seeding failed: ' + (err.message || 'Error'), 'danger', 5000);
        } finally {
            if (chipBtn) chipBtn.disabled = false;
        }
    };

    if (chipBtn) chipBtn.addEventListener('click', handleLoadDemo);
}
