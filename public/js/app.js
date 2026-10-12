/**
 * SpendSense - Main Application Controller (ES Module)
 */

import { checkAuthState, register, login, closeAuthModal, getCurrentUser } from './auth.js';
import { initChat, loadChatHistory, appendAssistantMessage } from './chat.js';
import { loadCategories } from './bill-modal.js';
import { loadInsightsDashboard } from './insights.js';
import { loadBillsTab } from './bills.js';
import { loadBudgetsTab } from './budgets.js';
import { loadPriceTrackerTab } from './price-tracker.js';
import { loadRemindersTab } from './reminders.js';
import { loadSettingsTab } from './settings.js';
import { apiRequest } from './api.js';

// Global hooks
window.loadInsights = loadInsightsDashboard;
window.loadBills = loadBillsTab;
window.loadBudgets = loadBudgetsTab;
window.loadPriceTracker = loadPriceTrackerTab;
window.loadReminders = loadRemindersTab;
window.loadSettings = loadSettingsTab;

document.addEventListener('DOMContentLoaded', async () => {
    // 1. Setup Tab Navigation first
    setupTabNavigation();

    // 2. Setup Auth Form Listeners
    setupAuthListeners();

    // 3. Setup Demo Data Loaders
    setupDemoDataButtons();

    // 4. Initialize Chat
    initChat();

    // 5. Ensure Chat screen is active
    if (window.switchTab) {
        window.switchTab('screenChat');
    }

    // 6. Check Auth State and load categories & history
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
});

function setupTabNavigation() {
    const tabs = document.querySelectorAll('.nav-tabs .tab-btn[data-screen]');
    const screens = document.querySelectorAll('.screen-view');

    window.switchTab = function(targetScreenId) {
        if (!targetScreenId) return;

        tabs.forEach(t => {
            if (t.dataset.screen === targetScreenId) {
                t.classList.add('active');
            } else {
                t.classList.remove('active');
            }
        });

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

    tabs.forEach(tab => {
        tab.addEventListener('click', (e) => {
            e.preventDefault();
            const targetScreenId = tab.dataset.screen;
            if (targetScreenId) {
                window.switchTab(targetScreenId);
            }
        });
    });
}

function setupAuthListeners() {
    const authForm = document.getElementById('authForm');
    const authModeTabs = document.querySelectorAll('.auth-tab-btn');
    const authSubmitBtn = document.getElementById('authSubmitBtn');
    const onboardingSection = document.getElementById('onboardingSection');
    const authError = document.getElementById('authError');

    let isRegisterMode = false;

    authModeTabs.forEach(tab => {
        tab.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            authModeTabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            isRegisterMode = tab.dataset.mode === 'register';

            if (isRegisterMode) {
                authSubmitBtn.textContent = 'Create Account';
                onboardingSection.style.display = 'flex';
                document.getElementById('nameGroup').style.display = 'flex';
            } else {
                authSubmitBtn.textContent = 'Log In';
                onboardingSection.style.display = 'none';
                document.getElementById('nameGroup').style.display = 'none';
            }
            if (authError) authError.style.display = 'none';
        });
    });

    if (authForm) {
        authForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (authError) authError.style.display = 'none';

            const email = document.getElementById('authEmail').value.trim();
            const password = document.getElementById('authPassword').value;
            const fullName = document.getElementById('authName').value.trim();
            const currency = document.getElementById('authCurrency').value;
            const usageType = document.querySelector('input[name="usage_type"]:checked')?.value || 'personal';

            authSubmitBtn.disabled = true;
            authSubmitBtn.textContent = 'Processing...';

            try {
                if (isRegisterMode) {
                    await register(fullName, email, password, currency, usageType);
                } else {
                    await login(email, password);
                }
                await loadCategories();
                await loadChatHistory();
                closeAuthModal();

                // Explicitly ensure Chat tab is selected and rendered
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

function setupDemoDataButtons() {
    const headerBtn = document.getElementById('btnLoadDemoDataHeader');
    const chipBtn = document.getElementById('btnLoadDemoChip');

    const handleLoadDemo = async () => {
        const user = getCurrentUser();
        if (!user) {
            alert('Please log in or create an account first to load demo data.');
            return;
        }

        if (!confirm('Load ~40 realistic bills across DMart groceries, restaurants, pharmacy, electronics, and fuel?')) {
            return;
        }

        try {
            if (headerBtn) {
                headerBtn.disabled = true;
                headerBtn.textContent = 'Seeding...';
            }
            const res = await apiRequest('/api/demo/seed', { method: 'POST' });
            await loadChatHistory();
            appendAssistantMessage(`🎉 Demo data loaded! Seeded ${res.bills_seeded || 40} realistic bills across 3 months. You can now ask questions like "Where did I spend the most this month?", "How much did I spend on snacks?", or view your bills list!`);
            alert(`Demo data successfully seeded (${res.bills_seeded || 40} bills)!`);
        } catch (err) {
            alert('Demo seeding notice: ' + (err.message || 'Error'));
        } finally {
            if (headerBtn) {
                headerBtn.disabled = false;
                headerBtn.textContent = '⚡ Load Demo Data';
            }
        }
    };

    if (headerBtn) headerBtn.addEventListener('click', handleLoadDemo);
    if (chipBtn) chipBtn.addEventListener('click', handleLoadDemo);
}
