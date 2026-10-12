/**
 * SpendSense - Chat Controller Module (ES Module)
 * Manages chat message streams, file attachments, drag-and-drop, camera capture,
 * typing indicators, error alerts, and bill card injection.
 */

import { apiRequest } from './api.js';
import { renderBillCard } from './bill-card.js';
import { setUploadLimit } from './auth.js';
import { prepareBillFiles } from './image-prep.js';
import { getIcon } from './icons.js';
import { escapeHtml, renderSafeMarkdown } from './utils.js';

let messagesContainer = null;
let chatInput = null;
let typingIndicatorElement = null;

export function initChat() {
    messagesContainer = document.getElementById('chatMessages');
    chatInput = document.getElementById('chatInputField');
    const sendBtn = document.getElementById('btnSendMessage');
    const attachBtn = document.getElementById('btnAttachFile');
    const cameraBtn = document.getElementById('btnCameraCapture');
    const fileInput = document.getElementById('fileUploadInput');
    const cameraInput = document.getElementById('cameraUploadInput');

    // Welcome chips click handlers (skip demo button)
    document.querySelectorAll('.chip-btn').forEach(btn => {
        if (btn.id === 'btnLoadDemoChip') return;
        btn.addEventListener('click', () => {
            if (chatInput) {
                chatInput.value = btn.textContent.trim();
                handleSendUserMessage();
            }
        });
    });

    // Send text message
    if (sendBtn && chatInput) {
        sendBtn.addEventListener('click', handleSendUserMessage);
        chatInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSendUserMessage();
            }
        });
    }

    // Attach file button (supports up to 3 photos for long receipts)
    if (attachBtn && fileInput) {
        attachBtn.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', () => {
            if (fileInput.files.length > 0) {
                uploadBillFile(fileInput.files);
                fileInput.value = '';
            }
        });
    }

    // Camera capture button (supports both laptop webcam and mobile camera)
    if (cameraBtn && cameraInput) {
        cameraBtn.addEventListener('click', () => openLiveCameraModal(cameraInput));
        cameraInput.addEventListener('change', () => {
            if (cameraInput.files.length > 0) {
                uploadBillFile(cameraInput.files);
                cameraInput.value = '';
            }
        });
    }

    // Drag-and-drop setup
    setupDragAndDrop();

    // Load initial chat history from backend
    loadChatHistory();
}

async function openLiveCameraModal(cameraInput) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        cameraInput.click();
        return;
    }

    let modal = document.getElementById('liveCameraModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'liveCameraModal';
        modal.className = 'modal-backdrop';
        modal.innerHTML = `
            <div class="modal-window" style="max-width: 560px; width: 95vw;">
                <div class="modal-header">
                    <div class="modal-title" style="display: flex; align-items: center; gap: 0.45rem;">
                        ${getIcon('camera', { size: 18 })} Capture Bill with Camera
                    </div>
                    <button type="button" class="close-btn" id="btnCloseLiveCamera" aria-label="Close camera">&times;</button>
                </div>
                <div class="modal-body" style="display: flex; flex-direction: column; gap: 0.85rem; align-items: center;">
                    <div style="width: 100%; background: #090d16; border-radius: var(--radius-md); overflow: hidden; border: 1px solid var(--color-border); position: relative; min-height: 280px; display: flex; align-items: center; justify-content: center;">
                        <video id="liveCameraVideo" autoplay playsinline muted style="width: 100%; max-height: 60vh; object-fit: contain; display: block;"></video>
                    </div>
                    <div style="font-size: 0.8rem; color: var(--color-text-muted); text-align: center;">
                        Position the receipt clearly inside the frame and tap Capture Photo.
                    </div>
                </div>
                <div class="modal-footer" style="justify-content: space-between; flex-wrap: wrap; gap: 0.5rem;">
                    <button type="button" class="btn btn-secondary" id="btnFallbackFileCamera">
                        Choose File / Device Camera
                    </button>
                    <div style="display: flex; gap: 0.5rem;">
                        <button type="button" class="btn btn-secondary" id="btnCancelLiveCamera">Cancel</button>
                        <button type="button" class="btn btn-primary" id="btnTakeCameraSnapshot">
                            ${getIcon('camera', { size: 16 })} Capture Photo
                        </button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }

    const videoEl = modal.querySelector('#liveCameraVideo');
    let stream = null;

    const stopCameraAndClose = () => {
        if (stream) {
            stream.getTracks().forEach(t => t.stop());
            stream = null;
        }
        if (videoEl) {
            videoEl.srcObject = null;
        }
        modal.classList.remove('open');
        document.body.classList.remove('modal-open');
    };

    modal.querySelector('#btnCloseLiveCamera').onclick = stopCameraAndClose;
    modal.querySelector('#btnCancelLiveCamera').onclick = stopCameraAndClose;
    modal.querySelector('#btnFallbackFileCamera').onclick = () => {
        stopCameraAndClose();
        cameraInput.click();
    };

    modal.querySelector('#btnTakeCameraSnapshot').onclick = () => {
        if (!videoEl || !videoEl.videoWidth) return;
        const canvas = document.createElement('canvas');
        canvas.width = videoEl.videoWidth;
        canvas.height = videoEl.videoHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => {
            stopCameraAndClose();
            if (blob) {
                const file = new File([blob], `camera_bill_${Date.now()}.jpg`, { type: 'image/jpeg' });
                uploadBillFile([file]);
            }
        }, 'image/jpeg', 0.92);
    };

    try {
        try {
            stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
                audio: false
            });
        } catch {
            stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        }
        videoEl.srcObject = stream;
        modal.classList.add('open');
        document.body.classList.add('modal-open');
    } catch (err) {
        stopCameraAndClose();
        cameraInput.click();
    }
}

export function appendUserMessage(text) {
    const row = document.createElement('div');
    row.className = 'message-row user';
    row.innerHTML = `
        <div class="avatar user-avatar">${getIcon('user', { size: 16 })}</div>
        <div class="message-bubble">${escapeHtml(text)}</div>
    `;
    messagesContainer.appendChild(row);
    scrollToBottom();
}

export function appendAssistantMessage(text) {
    const row = document.createElement('div');
    row.className = 'message-row assistant';
    row.innerHTML = `
        <div class="avatar assistant-avatar">${getIcon('sparkles', { size: 16 })}</div>
        <div class="message-bubble"><div class="bubble-text">${renderSafeMarkdown(text)}</div></div>
    `;
    messagesContainer.appendChild(row);
    scrollToBottom();
}

export function appendInsightMessage(insightText) {
    const row = document.createElement('div');
    row.className = 'message-row assistant';
    row.innerHTML = `
        <div class="avatar assistant-avatar insight-avatar">${getIcon('lightbulb', { size: 16 })}</div>
        <div class="message-bubble" style="border-left: 3px solid var(--color-success); background: var(--color-success-subtle);">
            <div class="bubble-text"><strong>SpendSense Insight:</strong> ${renderSafeMarkdown(insightText)}</div>
        </div>
    `;
    messagesContainer.appendChild(row);
    scrollToBottom();
}

export function appendErrorMessage(errorTitle, errorDetails) {
    const row = document.createElement('div');
    row.className = 'message-row assistant';
    row.innerHTML = `
        <div class="avatar assistant-avatar error-avatar">${getIcon('alert-triangle', { size: 16 })}</div>
        <div class="message-bubble" style="background: var(--color-danger-subtle); border-color: var(--color-danger); color: #fca5a5;">
            <div style="font-weight: 700; color: #ffffff; margin-bottom: 0.25rem;">${escapeHtml(errorTitle)}</div>
            <div>${escapeHtml(errorDetails)}</div>
        </div>
    `;
    messagesContainer.appendChild(row);
    scrollToBottom();
}

export function showTypingIndicator(message = 'Reading your bill...', progressPercent = null) {
    hideTypingIndicator();
    const row = document.createElement('div');
    row.className = 'message-row assistant';
    row.id = 'activeTypingRow';

    let progressBarHtml = '';
    if (progressPercent !== null) {
        progressBarHtml = `
            <div class="upload-progress-bar" style="width: 100%; height: 4px; background: var(--color-surface-raised); border-radius: 999px; overflow: hidden; margin-top: 0.5rem;">
                <div class="upload-progress-fill" style="width: ${progressPercent}%; height: 100%; background: var(--color-primary); transition: width 0.3s ease; border-radius: 999px;"></div>
            </div>
        `;
    }

    row.innerHTML = `
        <div class="avatar assistant-avatar">${getIcon('sparkles', { size: 16 })}</div>
        <div class="typing-indicator" style="display: flex; flex-direction: column; min-width: 220px;">
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.75rem;">
                <span>${escapeHtml(message)}</span>
                <div class="dots-loader">
                    <span></span><span></span><span></span>
                </div>
            </div>
            ${progressBarHtml}
        </div>
    `;
    messagesContainer.appendChild(row);
    scrollToBottom();
    typingIndicatorElement = row;
}

export function hideTypingIndicator() {
    if (typingIndicatorElement) {
        typingIndicatorElement.remove();
        typingIndicatorElement = null;
    }
}

async function handleSendUserMessage() {
    const text = chatInput.value.trim();
    if (!text) return;

    chatInput.value = '';
    appendUserMessage(text);

    showTypingIndicator('Analyzing your spending data...');

    try {
        const response = await apiRequest('/api/chat/ask', {
            method: 'POST',
            body: JSON.stringify({ question: text }),
        });

        hideTypingIndicator();

        if (response && response.answer) {
            appendAssistantMessageWithVis(response.answer, response.visualization);
        } else {
            appendAssistantMessage("I couldn't find an answer for that query. Try asking \"Where did I spend the most this month?\" or \"Show my 5 biggest bills\".");
        }
    } catch (err) {
        hideTypingIndicator();
        console.error('Chat ask error:', err);
        appendErrorMessage('Unable to Answer', err.message || 'Error communicating with assistant.');
    }
}

export function appendAssistantMessageWithVis(text, visualization = null) {
    const row = document.createElement('div');
    row.className = 'message-row assistant';
    
    const formattedText = renderSafeMarkdown(text);
    row.innerHTML = `
        <div class="avatar assistant-avatar">${getIcon('sparkles', { size: 16 })}</div>
        <div class="message-bubble" style="max-width: 580px; width: 100%;">
            <div class="bubble-text" style="line-height: 1.6;">${formattedText}</div>
            <div class="vis-container" style="margin-top: 0.75rem;"></div>
        </div>
    `;

    const visContainer = row.querySelector('.vis-container');
    if (visualization && visContainer) {
        renderVisualization(visualization, visContainer);
    } else if (visContainer) {
        visContainer.remove();
    }

    messagesContainer.appendChild(row);
    scrollToBottom();
}

function renderVisualization(vis, container) {
    if (!vis || !container) return;

    if (vis.type === 'donut_chart' && Array.isArray(vis.labels) && Array.isArray(vis.values)) {
        const wrapper = document.createElement('div');
        wrapper.style.maxWidth = '340px';
        wrapper.style.margin = '0 auto';
        wrapper.style.padding = '0.5rem';
        wrapper.style.background = 'rgba(15, 23, 42, 0.4)';
        wrapper.style.borderRadius = '8px';

        const canvas = document.createElement('canvas');
        wrapper.appendChild(canvas);
        container.appendChild(wrapper);

        try {
            new Chart(canvas, {
                type: 'doughnut',
                data: {
                    labels: vis.labels,
                    datasets: [{
                        data: vis.values,
                        backgroundColor: ['#10b981', '#f59e0b', '#3b82f6', '#8b5cf6', '#ec4899', '#ef4444', '#6366f1'],
                        borderWidth: 1,
                        borderColor: '#1e293b'
                    }]
                },
                options: {
                    responsive: true,
                    plugins: {
                        legend: { position: 'bottom', labels: { color: '#94a3b8', font: { size: 10 }, boxWidth: 12 } }
                    }
                }
            });
        } catch (e) {
            console.warn('Chart render error:', e);
        }
    } else if (vis.type === 'bar_chart' && Array.isArray(vis.labels) && Array.isArray(vis.values)) {
        const wrapper = document.createElement('div');
        wrapper.style.maxWidth = '360px';
        wrapper.style.margin = '0 auto';
        wrapper.style.padding = '0.5rem';
        wrapper.style.background = 'rgba(15, 23, 42, 0.4)';
        wrapper.style.borderRadius = '8px';

        const canvas = document.createElement('canvas');
        wrapper.appendChild(canvas);
        container.appendChild(wrapper);

        try {
            new Chart(canvas, {
                type: 'bar',
                data: {
                    labels: vis.labels,
                    datasets: [{
                        label: 'Spend (₹)',
                        data: vis.values,
                        backgroundColor: ['#6366f1', '#10b981'],
                        borderRadius: 6
                    }]
                },
                options: {
                    responsive: true,
                    plugins: { legend: { display: false } },
                    scales: {
                        x: { ticks: { color: '#94a3b8' } },
                        y: { ticks: { color: '#94a3b8' } }
                    }
                }
            });
        } catch (e) {
            console.warn('Bar chart error:', e);
        }
    } else if (vis.type === 'budget_bars' && Array.isArray(vis.labels)) {
        const box = document.createElement('div');
        box.style.display = 'flex';
        box.style.flexDirection = 'column';
        box.style.gap = '0.5rem';
        box.style.background = 'rgba(15, 23, 42, 0.4)';
        box.style.padding = '0.75rem';
        box.style.borderRadius = '8px';

        vis.labels.forEach((label, i) => {
            const spent = vis.spent[i] || 0;
            const limit = vis.limits[i] || 1;
            const pct = Math.min(100, Math.round((spent / limit) * 100));
            const barColor = pct >= 100 ? '#ef4444' : (pct >= 80 ? '#f59e0b' : '#10b981');

            box.innerHTML += `
                <div style="font-size: 0.8rem;">
                    <div style="display: flex; justify-content: space-between; margin-bottom: 0.2rem;">
                        <span>${escapeHtml(label)}</span>
                        <strong>₹${Math.round(spent)} / ₹${Math.round(limit)} (${pct}%)</strong>
                    </div>
                    <div style="height: 6px; background: #334155; border-radius: 9999px; overflow: hidden;">
                        <div style="width: ${pct}%; height: 100%; background: ${barColor};"></div>
                    </div>
                </div>
            `;
        });
        container.appendChild(box);
    } else if (vis.type === 'table' && Array.isArray(vis.rows)) {
        const table = document.createElement('table');
        table.style.width = '100%';
        table.style.borderCollapse = 'collapse';
        table.style.fontSize = '0.82rem';
        table.style.background = 'rgba(15, 23, 42, 0.4)';
        table.style.borderRadius = '6px';
        table.style.overflow = 'hidden';

        if (Array.isArray(vis.headers)) {
            let thead = '<thead><tr style="background: rgba(51, 65, 85, 0.5); text-align: left;">';
            vis.headers.forEach(h => thead += `<th style="padding: 0.4rem 0.6rem;">${escapeHtml(h)}</th>`);
            thead += '</tr></thead>';
            table.innerHTML = thead;
        }

        let tbody = '<tbody>';
        vis.rows.forEach(r => {
            tbody += '<tr style="border-bottom: 1px solid rgba(51, 65, 85, 0.3);">';
            r.forEach(c => tbody += `<td style="padding: 0.4rem 0.6rem;">${escapeHtml(c)}</td>`);
            tbody += '</tr>';
        });
        tbody += '</tbody>';
        table.innerHTML += tbody;
        container.appendChild(table);
    }
}

export async function uploadBillFile(fileInput) {
    if (!fileInput) return;

    const fileList = (fileInput instanceof FileList || Array.isArray(fileInput)) 
        ? Array.from(fileInput) 
        : [fileInput];

    if (fileList.length === 0) return;

    // Check mime types and sizes
    const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    for (const file of fileList) {
        if (!allowedMimes.includes(file.type)) {
            appendErrorMessage(
                'Unsupported File Format',
                `Selected file "${file.name}" has type "${file.type}". Please upload a JPG, PNG, WebP image or PDF document.`
            );
            return;
        }
        if (file.size > 12 * 1024 * 1024) {
            appendErrorMessage(
                'File Too Large',
                `"${file.name}" is ${(file.size / (1024 * 1024)).toFixed(1)}MB. The maximum allowed upload size is 10MB.`
            );
            return;
        }
    }

    // Client-side image preparation: canvas resize to 2000px, EXIF rotation, JPEG compression, darkness/blur check
    showTypingIndicator('Optimizing image & preparing upload...', 35);
    let prep;
    try {
        prep = await prepareBillFiles(fileList);
    } catch (err) {
        console.warn('Image prep fallback:', err);
        prep = {
            files: fileList.map(f => ({ blob: f, name: f.name })),
            hasDarkOrBlurry: false,
            tipMessage: null,
        };
    }

    const firstFileName = prep.files[0]?.name || 'bill.jpg';
    const totalCount = prep.files.length;
    const uploadLabel = totalCount > 1 
        ? `Uploaded receipt: ${firstFileName} (+ ${totalCount - 1} more parts for long bill)`
        : `Uploaded receipt: ${firstFileName}`;

    appendUserMessage(uploadLabel);

    // If image was dark or blurry, show helpful camera guidance tip
    if (prep.tipMessage) {
        appendInsightMessage(`Tip: ${prep.tipMessage}`);
    }

    // Show Gemini reading indicator with progress
    showTypingIndicator('Reading your bill with Gemini AI...', 75);

    const formData = new FormData();
    prep.files.forEach((f, idx) => {
        formData.append('bill_files[]', f.blob, f.name);
        if (idx === 0) {
            formData.append('bill_file', f.blob, f.name);
        }
    });

    try {
        const response = await apiRequest('/api/bills/upload', {
            method: 'POST',
            body: formData,
        });

        hideTypingIndicator();

        if (response.success && response.draft) {
            // Render structured bill summary card in chat
            const cardRow = document.createElement('div');
            cardRow.className = 'message-row assistant';
            cardRow.innerHTML = `<div class="avatar assistant-avatar">${getIcon('sparkles', { size: 16 })}</div>`;
            renderBillCard(response.draft, cardRow);
            messagesContainer.appendChild(cardRow);
            scrollToBottom();

            // Update remaining uploads if provided
            if (response.remaining_uploads !== undefined) {
                const limitRes = await apiRequest('/api/user/upload-limit');
                setUploadLimit(limitRes);
            }
        }
    } catch (err) {
        hideTypingIndicator();
        console.error('Bill upload/parse failed:', err);

        let errorTitle = 'Bill Reading Failed';
        let errorDetails = err.message || 'An unexpected error occurred while processing the bill.';

        if (err.status === 401 || err.code === 'KEY_MISSING' || err.message.includes('API key')) {
            errorTitle = 'Gemini API Key Missing or Invalid';
            errorDetails = 'Please configure a valid GEMINI_API_KEY in spendsense/.env. Gemini 3.8 Flash requires a valid Google AI Studio key.';
        } else if (err.status === 429 || err.code === 'UPLOAD_LIMIT_REACHED') {
            errorTitle = 'Daily Upload Limit Reached';
            errorDetails = err.message;
        } else if (err.status === 504 || err.message.includes('timed out')) {
            errorTitle = 'Gemini Timeout';
            errorDetails = 'Processing took longer than 45 seconds. The document might be high-resolution or the connection was slow. Please try again.';
        }

        appendErrorMessage(errorTitle, errorDetails);
    }
}

function setupDragAndDrop() {
    const chatContainer = document.querySelector('.chat-container');
    const dropOverlay = document.getElementById('dropOverlay');
    if (!chatContainer || !dropOverlay) return;

    let dragCounter = 0;

    window.addEventListener('dragenter', (e) => {
        e.preventDefault();
        dragCounter++;
        dropOverlay.classList.add('active');
    });

    window.addEventListener('dragleave', (e) => {
        e.preventDefault();
        dragCounter--;
        if (dragCounter <= 0) {
            dragCounter = 0;
            dropOverlay.classList.remove('active');
        }
    });

    window.addEventListener('dragover', (e) => {
        e.preventDefault();
    });

    window.addEventListener('drop', (e) => {
        e.preventDefault();
        dragCounter = 0;
        dropOverlay.classList.remove('active');

        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            uploadBillFile(e.dataTransfer.files);
        }
    });
}

export async function loadChatHistory() {
    try {
        const res = await apiRequest('/api/chat/messages');
        if (res.messages && res.messages.length > 0 && messagesContainer) {
            // Remove previous dynamically appended messages to prevent duplicate stacking
            const dynamicMessages = messagesContainer.querySelectorAll('.message-row');
            dynamicMessages.forEach(el => el.remove());

            res.messages.forEach(msg => {
                if (msg.role === 'user') {
                    appendUserMessage(msg.message_text);
                } else if (msg.role === 'assistant') {
                    if (msg.metadata && msg.metadata.type === 'bill_confirmed') {
                        appendInsightMessage(msg.message_text);
                    } else {
                        appendAssistantMessage(msg.message_text);
                    }
                }
            });
        }
    } catch (e) {
        // Not authenticated yet or no history
    }
}

function scrollToBottom() {
    if (messagesContainer) {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
}
