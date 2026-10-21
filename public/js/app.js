/**
 * SpendSense - Main Application Controller (ES Module)
 */

import { checkAuthState, register, login, googleSignIn, closeAuthModal, getCurrentUser, logout } from './auth.js';
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

    // 1.5. Initialize Workspace Mode (Personal vs Business / Shop)
    initAppMode();

    // 2. Setup Navigation (Rail, Tabs & Mobile)
    setupTabNavigation();

    // 3. Setup Project Hub slide-out
    initHub();

    // 4. Setup Share button
    setupShareButton();

    // 5. Setup User Menu Dropdown
    setupUserMenu();

    // 6. Setup Auth Form Listeners
    setupAuthListeners();

    // 7. Setup Demo Data Loaders
    setupDemoDataButtons();

    // 8. Initialize Chat
    initChat();

    // 9. Ensure Chat screen is active
    if (window.switchTab) {
        window.switchTab('screenChat');
    }

    // 10. Check Auth State and load categories & history
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

    // 11. Register PWA Service Worker
    if ('serviceWorker' in navigator && (window.location.protocol === 'https:' || window.location.hostname === 'localhost')) {
        navigator.serviceWorker.register('/sw.js').catch(err => {
            console.warn('Service worker registration note:', err);
        });
    }
});

/* ─────────────────────────────────────────────────────────────
   Theme Management (Dark / Light with safe localStorage & system preference)
───────────────────────────────────────────────────────────── */
function initTheme() {
    let savedTheme = null;
    try {
        savedTheme = localStorage.getItem('spendsense_theme');
    } catch (e) {
        console.warn('localStorage read error:', e);
    }
    const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const initialTheme = savedTheme || (systemPrefersDark ? 'dark' : 'light');

    applyTheme(initialTheme);

    const toggleBtn = document.getElementById('themeToggleBtn');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
            const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
            const nextTheme = currentTheme === 'dark' ? 'light' : 'dark';
            applyTheme(nextTheme);
            try {
                localStorage.setItem('spendsense_theme', nextTheme);
            } catch (e) {
                console.warn('localStorage write error:', e);
            }
            showToast(`Switched to ${nextTheme} theme`, 'info', 2000);
        });
    }

    // Listen to OS preference changes if user hasn't explicitly set preference
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
        let hasSaved = false;
        try {
            hasSaved = !!localStorage.getItem('spendsense_theme');
        } catch {
            hasSaved = false;
        }
        if (!hasSaved) {
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
   App Workspace Mode: Personal vs Business / Shop
───────────────────────────────────────────────────────────── */
function initAppMode() {
    const modePill = document.getElementById('modePill');
    const modeDropdown = document.getElementById('modeDropdown');
    const optPersonal = document.getElementById('modeOptPersonal');
    const optBusiness = document.getElementById('modeOptBusiness');

    let currentMode = 'personal';
    try {
        const saved = localStorage.getItem('spendsense_active_mode');
        if (saved === 'business' || saved === 'shop') {
            currentMode = 'business';
        }
    } catch (e) {
        console.warn('Storage read note:', e);
    }

    window.setAppMode = function(mode, persist = true) {
        currentMode = (mode === 'business' || mode === 'shop') ? 'business' : 'personal';
        try {
            localStorage.setItem('spendsense_active_mode', currentMode);
        } catch (e) {
            console.warn('Storage write note:', e);
        }

        document.documentElement.setAttribute('data-mode', currentMode);

        // Update Pill UI
        const pillText = document.getElementById('modePillText');
        if (pillText) {
            pillText.textContent = currentMode === 'business' ? 'Business' : 'Personal';
        }
        if (modePill) {
            if (currentMode === 'business') {
                modePill.classList.add('mode-business');
                modePill.setAttribute('title', 'Active workspace: Business / Shop (Click to switch)');
            } else {
                modePill.classList.remove('mode-business');
                modePill.setAttribute('title', 'Active workspace: Personal (Click to switch)');
            }
        }

        // Update Dropdown active items
        if (optPersonal) optPersonal.classList.toggle('active', currentMode === 'personal');
        if (optBusiness) optBusiness.classList.toggle('active', currentMode === 'business');

        // Update Chat Module Header
        const chatModuleTitle = document.getElementById('chatModuleTitle');
        const chatModuleDesc = document.getElementById('chatModuleDesc');
        if (chatModuleTitle && chatModuleDesc) {
            if (currentMode === 'business') {
                chatModuleTitle.textContent = 'SpendSense Business';
                chatModuleDesc.textContent = 'Purchase invoices, wholesale suppliers, payables & tax compliance';
            } else {
                chatModuleTitle.textContent = 'SpendSense Assistant';
                chatModuleDesc.textContent = 'Kirana, store receipts and personal expense intelligence';
            }
        }

        // Update Welcome Card
        const welcomePromptSerif = document.getElementById('welcomePromptSerif');
        const welcomeSubtitle = document.getElementById('welcomeSubtitle');
        const welcomeWebLabel = document.getElementById('welcomeWebLabel');
        if (welcomeWebLabel) {
            welcomeWebLabel.textContent = currentMode === 'business' ? '01 — COMMERCIAL ASSISTANT' : '01 — SPEND ASSISTANT';
        }
        if (welcomePromptSerif) {
            welcomePromptSerif.textContent = currentMode === 'business' ? 'What business expense are we recording?' : 'What needs to get tracked?';
        }
        if (welcomeSubtitle) {
            welcomeSubtitle.textContent = currentMode === 'business' 
                ? 'Your commercial expense assistant. Upload wholesale supplier invoices, retail bills, transport slips, or vendor receipts to track payables, inventory, and GST.'
                : 'Your personal expense assistant. Upload a supermarket receipt, restaurant bill, pharmacy slip, or fuel invoice, or tap a suggestion below to explore.';
        }

        // Update Suggestion Chips
        renderModeSuggestionChips(currentMode);

        // Update Chat Input Placeholder
        const chatInputField = document.getElementById('chatInputField');
        if (chatInputField) {
            chatInputField.placeholder = currentMode === 'business'
                ? 'Ask about supplier invoices, GST tax, pending payables, or distributor rates...'
                : 'Ask a spending question, compare store prices, or review bills...';
        }

        // Update Hub Header & Tiles
        renderModeHubTiles(currentMode);

        // Persist to backend if logged in
        if (persist && getCurrentUser()) {
            apiRequest('/api/settings/mode', {
                method: 'POST',
                body: JSON.stringify({ mode: currentMode, shop_mode: currentMode === 'business' })
            }).catch(err => console.warn('Could not sync mode to backend:', err));
        }

        window.dispatchEvent(new CustomEvent('modechanged', { detail: { mode: currentMode } }));
    };

    // Toggle Dropdown when clicking Mode Pill
    if (modePill && modeDropdown) {
        modePill.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = modeDropdown.classList.toggle('open');
            modePill.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        });

        document.addEventListener('click', (e) => {
            if (!modeDropdown.contains(e.target) && e.target !== modePill) {
                modeDropdown.classList.remove('open');
                modePill.setAttribute('aria-expanded', 'false');
            }
        });
    }

    if (optPersonal) {
        optPersonal.addEventListener('click', () => {
            if (currentMode !== 'personal') {
                window.setAppMode('personal', true);
                showToast('Switched to Personal Mode (Household & Daily Expenses)', 'info', 2500);
            }
            if (modeDropdown) modeDropdown.classList.remove('open');
        });
    }

    if (optBusiness) {
        optBusiness.addEventListener('click', () => {
            if (currentMode !== 'business') {
                window.setAppMode('business', true);
                showToast('Switched to Business / Shop Mode (Invoices, Suppliers & GST)', 'info', 2500);
            }
            if (modeDropdown) modeDropdown.classList.remove('open');
        });
    }

    const btnDropdownConfig = document.getElementById('btnDropdownConfigureBusiness');
    if (btnDropdownConfig) {
        btnDropdownConfig.addEventListener('click', () => {
            if (modeDropdown) modeDropdown.classList.remove('open');
            window.switchTab('screenSettings');
            setTimeout(() => {
                const cfgCard = document.getElementById('businessProfileSettingsCard');
                if (cfgCard) {
                    cfgCard.scrollIntoView({ behavior: 'smooth' });
                    cfgCard.classList.add('active-mode');
                    setTimeout(() => cfgCard.classList.remove('active-mode'), 2500);
                }
            }, 150);
        });
    }

    // Apply initial mode
    window.setAppMode(currentMode, false);
}

function renderModeSuggestionChips(mode) {
    const container = document.getElementById('chatSuggestionChips');
    if (!container) return;

    if (mode === 'business') {
        container.innerHTML = `
            <button class="chip-btn" type="button">Show my pending supplier payables</button>
            <button class="chip-btn" type="button">Which supplier gives the best wholesale price?</button>
            <button class="chip-btn" type="button">What is my GST tax breakdown this month?</button>
            <button class="chip-btn" type="button">Show top 5 business expense categories</button>
            <button class="chip-btn" type="button">Compare this month with last month</button>
            <button class="chip-btn" id="btnLoadDemoChip" type="button" style="border-color: var(--color-primary); color: var(--color-primary);">
                ${getIcon('zap', { size: 13 })} Load 40 Demo Bills
            </button>
        `;
    } else {
        container.innerHTML = `
            <button class="chip-btn" type="button">Where did I spend the most this month?</button>
            <button class="chip-btn" type="button">How much did I spend on snacks?</button>
            <button class="chip-btn" type="button">Which store is cheaper for milk?</button>
            <button class="chip-btn" type="button">Compare this month with last month</button>
            <button class="chip-btn" type="button">Show my 5 biggest bills</button>
            <button class="chip-btn" id="btnLoadDemoChip" type="button" style="border-color: var(--color-primary); color: var(--color-primary);">
                ${getIcon('zap', { size: 13 })} Load 40 Demo Bills
            </button>
        `;
    }

    // Reattach listeners to chips
    container.querySelectorAll('.chip-btn').forEach(btn => {
        if (btn.id === 'btnLoadDemoChip') {
            btn.addEventListener('click', async () => {
                const { getCurrentUser } = await import('./auth.js');
                if (!getCurrentUser()) {
                    showToast('Please log in or create an account first.', 'warning');
                    return;
                }
                try {
                    btn.disabled = true;
                    btn.textContent = 'Loading...';
                    showToast('Seeding realistic demo dataset...', 'info', 3000);
                    const res = await apiRequest('/api/demo/seed', { method: 'POST' });
                    await loadChatHistory();
                    appendAssistantMessage(`Demo data loaded! Seeded ${res.bills_seeded || 40} realistic bills across 3 months.`);
                    showToast(`Demo data seeded (${res.bills_seeded || 40} bills)!`, 'success', 4000);
                } catch (err) {
                    showToast('Demo seeding failed: ' + (err.message || 'Error'), 'danger', 5000);
                } finally {
                    btn.disabled = false;
                    btn.innerHTML = `${getIcon('zap', { size: 13 })} Load 40 Demo Bills`;
                }
            });
        } else {
            btn.addEventListener('click', () => {
                const input = document.getElementById('chatInput');
                if (input) {
                    input.value = btn.textContent.trim();
                    input.focus();
                    document.getElementById('chatSendBtn')?.click();
                }
            });
        }
    });
}

function renderModeHubTiles(mode) {
    const hubSubtitleText = document.getElementById('hubSubtitleText');
    const hubCategoryTag = document.getElementById('hubCategoryTag');
    const hubCardTitle = document.getElementById('hubCardTitle');
    const hubCardDesc = document.getElementById('hubCardDesc');
    const tilesContainer = document.getElementById('hubTilesContainer');

    if (mode === 'business') {
        if (hubSubtitleText) hubSubtitleText.textContent = 'Commercial overview & supplier tools';
        if (hubCategoryTag) hubCategoryTag.textContent = 'Business Operations';
        if (hubCardTitle) hubCardTitle.textContent = 'SpendSense Commercial Hub';
        if (hubCardDesc) hubCardDesc.textContent = 'Manage wholesale suppliers, purchase invoices, accounts payable, tax credits, and commercial operating limits.';

        if (tilesContainer) {
            tilesContainer.innerHTML = `
                <button type="button" class="hub-quick-tile" onclick="window.switchTab('screenBills'); window.toggleHub(false);">
                    <span class="tile-icon">${getIcon('receipt', { size: 20 })}</span>
                    <div class="tile-content">
                        <div class="tile-title">Invoices & Purchase Bills</div>
                        <div class="tile-desc">Supplier tax invoices, purchase orders & bills</div>
                    </div>
                    <span class="tile-chevron">${getIcon('chevron-right', { size: 16 })}</span>
                </button>
                <button type="button" class="hub-quick-tile" onclick="window.switchTab('screenInsights'); window.toggleHub(false);">
                    <span class="tile-icon">${getIcon('bar-chart-3', { size: 20 })}</span>
                    <div class="tile-content">
                        <div class="tile-title">Business Insights & P&L</div>
                        <div class="tile-desc">Gross expenses, supplier breakdown, and cash outflow</div>
                    </div>
                    <span class="tile-chevron">${getIcon('chevron-right', { size: 16 })}</span>
                </button>
                <button type="button" class="hub-quick-tile" onclick="window.switchTab('screenPriceTracker'); window.toggleHub(false);">
                    <span class="tile-icon">${getIcon('store', { size: 20 })}</span>
                    <div class="tile-content">
                        <div class="tile-title">Suppliers & Wholesale Directory</div>
                        <div class="tile-desc">Wholesale distributor rates & vendor price comparison</div>
                    </div>
                    <span class="tile-chevron">${getIcon('chevron-right', { size: 16 })}</span>
                </button>
                <button type="button" class="hub-quick-tile" onclick="window.switchTab('screenReminders'); window.toggleHub(false);">
                    <span class="tile-icon">${getIcon('credit-card', { size: 20 })}</span>
                    <div class="tile-content">
                        <div class="tile-title">Accounts Payable & Dues</div>
                        <div class="tile-desc">Supplier credit terms, Net-15/30 payment deadlines</div>
                    </div>
                    <span class="tile-chevron">${getIcon('chevron-right', { size: 16 })}</span>
                </button>
                <button type="button" class="hub-quick-tile" onclick="window.switchTab('screenBudgets'); window.toggleHub(false);">
                    <span class="tile-icon">${getIcon('target', { size: 20 })}</span>
                    <div class="tile-content">
                        <div class="tile-title">Category Budgets & Overheads</div>
                        <div class="tile-desc">Store rent, payroll, logistics & operating limits</div>
                    </div>
                    <span class="tile-chevron">${getIcon('chevron-right', { size: 16 })}</span>
                </button>
                <button type="button" class="hub-quick-tile" onclick="window.switchTab('screenSettings'); window.toggleHub(false);">
                    <span class="tile-icon">${getIcon('file-text', { size: 20 })}</span>
                    <div class="tile-content">
                        <div class="tile-title">GST, Tax & CA Export</div>
                        <div class="tile-desc">Tax summaries, HSN details, and accountant CSV backups</div>
                    </div>
                    <span class="tile-chevron">${getIcon('chevron-right', { size: 16 })}</span>
                </button>
            `;
        }
    } else {
        if (hubSubtitleText) hubSubtitleText.textContent = 'Financial overview & tools';
        if (hubCategoryTag) hubCategoryTag.textContent = 'Spend Intelligence';
        if (hubCardTitle) hubCardTitle.textContent = 'SpendSense Project Hub';
        if (hubCardDesc) hubCardDesc.textContent = 'Access all your spending insights, bills, budgets, price comparisons, and reminder tools without leaving the chat.';

        if (tilesContainer) {
            tilesContainer.innerHTML = `
                <button type="button" class="hub-quick-tile" onclick="window.switchTab('screenBills'); window.toggleHub(false);">
                    <span class="tile-icon">${getIcon('receipt', { size: 20 })}</span>
                    <div class="tile-content">
                        <div class="tile-title">Bills & Receipts</div>
                        <div class="tile-desc">Manage, search, and review all parsed bills</div>
                    </div>
                    <span class="tile-chevron">${getIcon('chevron-right', { size: 16 })}</span>
                </button>
                <button type="button" class="hub-quick-tile" onclick="window.switchTab('screenInsights'); window.toggleHub(false);">
                    <span class="tile-icon">${getIcon('bar-chart-3', { size: 20 })}</span>
                    <div class="tile-content">
                        <div class="tile-title">Insights & Trends</div>
                        <div class="tile-desc">Monthly breakdown, top merchants, and KPIs</div>
                    </div>
                    <span class="tile-chevron">${getIcon('chevron-right', { size: 16 })}</span>
                </button>
                <button type="button" class="hub-quick-tile" onclick="window.switchTab('screenBudgets'); window.toggleHub(false);">
                    <span class="tile-icon">${getIcon('target', { size: 20 })}</span>
                    <div class="tile-content">
                        <div class="tile-title">Category Budgets</div>
                        <div class="tile-desc">Spending targets and 80% threshold warnings</div>
                    </div>
                    <span class="tile-chevron">${getIcon('chevron-right', { size: 16 })}</span>
                </button>
                <button type="button" class="hub-quick-tile" onclick="window.switchTab('screenPriceTracker'); window.toggleHub(false);">
                    <span class="tile-icon">${getIcon('tag', { size: 20 })}</span>
                    <div class="tile-content">
                        <div class="tile-title">Price Tracker</div>
                        <div class="tile-desc">Compare grocery prices across local kiranas</div>
                    </div>
                    <span class="tile-chevron">${getIcon('chevron-right', { size: 16 })}</span>
                </button>
                <button type="button" class="hub-quick-tile" onclick="window.switchTab('screenReminders'); window.toggleHub(false);">
                    <span class="tile-icon">${getIcon('bell', { size: 20 })}</span>
                    <div class="tile-content">
                        <div class="tile-title">Reminders & Warranties</div>
                        <div class="tile-desc">Warranty deadlines and bill payments</div>
                    </div>
                    <span class="tile-chevron">${getIcon('chevron-right', { size: 16 })}</span>
                </button>
                <button type="button" class="hub-quick-tile" onclick="window.switchTab('screenSettings'); window.toggleHub(false);">
                    <span class="tile-icon">${getIcon('settings', { size: 20 })}</span>
                    <div class="tile-content">
                        <div class="tile-title">Settings & Data Controls</div>
                        <div class="tile-desc">Categories, CSV export, and demo datasets</div>
                    </div>
                    <span class="tile-chevron">${getIcon('chevron-right', { size: 16 })}</span>
                </button>
            `;
        }
    }
}

/* ─────────────────────────────────────────────────────────────
   Hub Panel Management (Slide-out split view & edge tab)
───────────────────────────────────────────────────────────── */
function initHub() {
    const hubPanel = document.getElementById('hubPanel');
    const edgeTab = document.getElementById('edgeHubTab');
    const railBtnHub = document.getElementById('railBtnHub');
    const mobileNavHub = document.getElementById('mobileNavHub');
    const btnMinimize = document.getElementById('btnHubMinimize');
    const btnExpand = document.getElementById('btnHubExpand');
    const appWorkspace = document.getElementById('appWorkspace');

    if (!hubPanel) return;

    window.toggleHub = function(forceState) {
        const isCurrentlyOpen = hubPanel.classList.contains('open');
        const shouldOpen = (typeof forceState === 'boolean') ? forceState : !isCurrentlyOpen;

        if (shouldOpen) {
            hubPanel.classList.add('open');
            hubPanel.setAttribute('aria-hidden', 'false');
            if (appWorkspace) appWorkspace.classList.add('hub-open');
            if (edgeTab) {
                edgeTab.classList.add('active');
                edgeTab.setAttribute('aria-expanded', 'true');
            }
            if (railBtnHub) railBtnHub.classList.add('active');
            if (mobileNavHub) mobileNavHub.classList.add('active');

            try {
                localStorage.setItem('spendsense_hub_open', 'true');
            } catch (e) {
                console.warn('Storage blocked:', e);
            }

            if (btnMinimize) btnMinimize.focus();
        } else {
            hubPanel.classList.remove('open');
            hubPanel.classList.remove('expanded');
            hubPanel.setAttribute('aria-hidden', 'true');
            if (appWorkspace) appWorkspace.classList.remove('hub-open');
            if (edgeTab) {
                edgeTab.classList.remove('active');
                edgeTab.setAttribute('aria-expanded', 'false');
            }
            if (railBtnHub) railBtnHub.classList.remove('active');
            if (mobileNavHub) mobileNavHub.classList.remove('active');

            try {
                localStorage.setItem('spendsense_hub_open', 'false');
            } catch (e) {
                console.warn('Storage blocked:', e);
            }

            if (edgeTab) edgeTab.focus();
        }
    };

    if (edgeTab) {
        edgeTab.addEventListener('click', () => window.toggleHub());
    }

    if (railBtnHub) {
        railBtnHub.addEventListener('click', () => window.toggleHub());
    }

    if (mobileNavHub) {
        mobileNavHub.addEventListener('click', () => window.toggleHub());
    }

    if (btnMinimize) {
        btnMinimize.addEventListener('click', () => window.toggleHub(false));
    }

    if (btnExpand) {
        btnExpand.addEventListener('click', () => {
            const isExpanded = hubPanel.classList.toggle('expanded');
            const spanText = btnExpand.querySelector('span');
            if (spanText) {
                spanText.textContent = isExpanded ? 'Collapse' : 'Expand';
            }
        });
    }

    // Keyboard shortcut: Esc closes Hub panel
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && hubPanel.classList.contains('open')) {
            window.toggleHub(false);
        }
    });

    // Check saved state from localStorage (desktop only)
    try {
        const savedState = localStorage.getItem('spendsense_hub_open');
        if (savedState === 'true' && window.innerWidth > 900) {
            window.toggleHub(true);
        }
    } catch (e) {
        console.warn('Storage access note:', e);
    }
}

function setupShareButton() {
    const shareBtn = document.getElementById('shareBtn');
    if (!shareBtn) return;

    shareBtn.addEventListener('click', async () => {
        if (navigator.share) {
            try {
                await navigator.share({
                    title: 'SpendSense',
                    text: 'SpendSense — Financial Intelligence & Expense Assistant',
                    url: window.location.href,
                });
                return;
            } catch {
                // Ignore cancel or fallback
            }
        }

        try {
            await navigator.clipboard.writeText(window.location.href);
            showToast('SpendSense link copied to clipboard', 'success', 2500);
        } catch {
            showToast('SpendSense URL: ' + window.location.href, 'info', 3000);
        }
    });
}

/* ─────────────────────────────────────────────────────────────
   Navigation Management (Desktop Tabs + Mobile Bottom Nav + Sheet)
───────────────────────────────────────────────────────────── */
function setupTabNavigation() {
    const desktopTabs = document.querySelectorAll('.nav-tabs .tab-btn[data-screen]');
    const railItems = document.querySelectorAll('.app-icon-rail .rail-btn[data-screen]');
    const mobileNavItems = document.querySelectorAll('.mobile-nav-bar .mobile-nav-item[data-screen]');
    const sheetItems = document.querySelectorAll('.mobile-more-sheet .sheet-item-btn[data-screen]');
    const screens = document.querySelectorAll('.screen-view');

    const moreBtn = document.getElementById('mobileMoreBtn');
    const moreSheet = document.getElementById('mobileMoreSheet');
    const railAvatarBtn = document.getElementById('railAvatarBtn');
    const userMenuBtn = document.getElementById('userMenuBtn');

    if (railAvatarBtn && userMenuBtn) {
        railAvatarBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            userMenuBtn.click();
        });
    }

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

        // Slim rail update
        railItems.forEach(r => {
            if (r.dataset.screen === targetScreenId) {
                r.classList.add('active');
            } else {
                r.classList.remove('active');
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

    // Rail click handlers
    railItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const target = item.dataset.screen;
            if (target) window.switchTab(target);
        });
    });

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

    // Google Sign-In Listener
    const googleBtn = document.getElementById('googleSignInBtn');
    const googleBtnText = document.getElementById('googleBtnText');
    if (googleBtn) {
        googleBtn.addEventListener('click', async () => {
            if (authError) authError.style.display = 'none';
            googleBtn.disabled = true;
            if (googleBtnText) googleBtnText.textContent = 'Connecting with Google...';

            try {
                await googleSignIn();
                showToast('Signed in with Google successfully!', 'success');
                await loadCategories();
                await loadChatHistory();
                closeAuthModal();
                if (window.switchTab) {
                    window.switchTab('screenChat');
                }
            } catch (err) {
                console.error('Google sign-in error:', err);
                if (authError) {
                    authError.textContent = err.message || 'Google sign-in failed. Please try again.';
                    authError.style.display = 'block';
                }
            } finally {
                googleBtn.disabled = false;
                if (googleBtnText) googleBtnText.textContent = 'Continue with Google';
            }
        });
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
