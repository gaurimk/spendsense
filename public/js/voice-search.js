/**
 * SpendSense - Robust Voice Search & Input Controller
 * Supports Chrome, Safari, Edge with real-time interim results,
 * pre-flight permission checks, clear diagnostic toasts, and seamless lifecycle handling.
 */

import { showToast } from './utils.js';

export function isSpeechRecognitionSupported() {
    return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

/**
 * Attaches voice search capability to an input field and microphone button
 * @param {Object} options
 * @param {HTMLInputElement} options.inputElement
 * @param {HTMLElement} options.micButtonElement
 * @param {Function} [options.onTranscript]
 * @param {Function} [options.onFinalSubmit]
 * @param {string} [options.placeholderListening]
 * @returns {{ stop: Function, start: Function, isRecording: Function }}
 */
export function setupVoiceSearch({
    inputElement,
    micButtonElement,
    onTranscript = null,
    onFinalSubmit = null,
    placeholderListening = '🎙️ Listening... Speak now (tap mic to stop)'
}) {
    if (!micButtonElement || !inputElement) return null;

    let activeRecognition = null;
    let isRecording = false;
    let originalPlaceholder = inputElement.placeholder || '';
    let baseValue = '';

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    const stopRecording = () => {
        if (activeRecognition && isRecording) {
            try {
                activeRecognition.stop();
            } catch (e) {
                console.debug('Recognition stop note:', e);
            }
        }
        isRecording = false;
        micButtonElement.classList.remove('recording');
        micButtonElement.setAttribute('aria-pressed', 'false');
        micButtonElement.setAttribute('title', 'Voice Search');
        inputElement.placeholder = originalPlaceholder;
    };

    const startRecording = async () => {
        // If not supported by browser
        if (!SpeechRecognition) {
            showToast('Voice search is not supported in this browser. Please try Google Chrome, Microsoft Edge, or Safari.', 'warning', 5000);
            return;
        }

        // Pre-flight check / request microphone permissions via getUserMedia for prompt visibility & error feedback
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                // Immediately release tracks
                stream.getTracks().forEach(track => track.stop());
            } catch (permErr) {
                console.warn('Microphone permission check failed:', permErr);
                if (permErr.name === 'NotAllowedError' || permErr.name === 'PermissionDeniedError') {
                    showToast('Microphone access was blocked. Please click the lock or camera/mic icon in your browser address bar to allow microphone access.', 'warning', 7000);
                } else if (permErr.name === 'NotFoundError' || permErr.name === 'DevicesNotFoundError') {
                    showToast('No microphone found. Please connect a microphone and try again.', 'error', 5000);
                } else {
                    showToast('Microphone access note: ' + (permErr.message || permErr.name), 'warning', 5000);
                }
                return;
            }
        }

        // Clean up any stale recognition session
        stopRecording();

        try {
            activeRecognition = new SpeechRecognition();
            activeRecognition.continuous = false;
            activeRecognition.interimResults = true;
            activeRecognition.maxAlternatives = 1;

            // Prefer user's browser language, fallback to en-IN / en-US
            const userLang = navigator.language || 'en-IN';
            activeRecognition.lang = userLang.startsWith('en') ? userLang : 'en-IN';

            baseValue = inputElement.value ? inputElement.value.trim() : '';

            activeRecognition.onstart = () => {
                isRecording = true;
                micButtonElement.classList.add('recording');
                micButtonElement.setAttribute('aria-pressed', 'true');
                micButtonElement.setAttribute('title', 'Listening... Tap to stop');
                inputElement.placeholder = placeholderListening;
                inputElement.focus();
            };

            let finalRecordedTranscript = '';

            activeRecognition.onresult = (event) => {
                let interimTranscript = '';
                let finalTranscript = '';

                for (let i = event.resultIndex; i < event.results.length; ++i) {
                    const res = event.results[i];
                    if (res.isFinal) {
                        finalTranscript += res[0].transcript;
                    } else {
                        interimTranscript += res[0].transcript;
                    }
                }

                const currentSpoken = (finalTranscript || interimTranscript).trim();
                if (currentSpoken) {
                    const combined = baseValue ? `${baseValue} ${currentSpoken}` : currentSpoken;
                    inputElement.value = combined;

                    if (typeof onTranscript === 'function') {
                        onTranscript(combined, !!finalTranscript);
                    }
                }

                if (finalTranscript) {
                    finalRecordedTranscript = (baseValue ? `${baseValue} ${finalTranscript}` : finalTranscript).trim();
                }
            };

            activeRecognition.onerror = (e) => {
                console.warn('Speech recognition error event:', e.error);
                isRecording = false;
                micButtonElement.classList.remove('recording');
                micButtonElement.setAttribute('aria-pressed', 'false');
                micButtonElement.setAttribute('title', 'Voice Search');
                inputElement.placeholder = originalPlaceholder;

                if (e.error === 'not-allowed') {
                    showToast('Microphone access was denied. Please allow microphone permissions in your browser address bar settings.', 'warning', 7000);
                } else if (e.error === 'no-speech') {
                    showToast('No speech was detected. Tap the mic and try speaking again.', 'info', 3500);
                } else if (e.error === 'network') {
                    showToast('Voice recognition network error. Please verify your internet connection or Google speech services.', 'warning', 5000);
                } else if (e.error === 'audio-capture') {
                    showToast('No microphone detected. Please check your sound settings.', 'error', 5000);
                } else if (e.error !== 'aborted') {
                    showToast(`Voice input notice: ${e.error}`, 'info', 3000);
                }
            };

            activeRecognition.onend = () => {
                isRecording = false;
                micButtonElement.classList.remove('recording');
                micButtonElement.setAttribute('aria-pressed', 'false');
                micButtonElement.setAttribute('title', 'Voice Search');
                inputElement.placeholder = originalPlaceholder;

                const recordedVal = finalRecordedTranscript || inputElement.value.trim();
                if (recordedVal && typeof onFinalSubmit === 'function') {
                    onFinalSubmit(recordedVal);
                }
            };

            activeRecognition.start();
        } catch (err) {
            console.error('Failed to start SpeechRecognition:', err);
            isRecording = false;
            micButtonElement.classList.remove('recording');
            showToast('Failed to start voice recognition: ' + (err.message || 'Unknown error'), 'warning', 4500);
        }
    };

    micButtonElement.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (isRecording) {
            stopRecording();
        } else {
            startRecording();
        }
    });

    return {
        stop: stopRecording,
        start: startRecording,
        isRecording: () => isRecording
    };
}
