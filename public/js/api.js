/**
 * SpendSense - API Client Module (ES Module)
 * Handles fetch calls, CSRF tokens, session state, and structured error extraction.
 */

let csrfToken = '';

export function setCsrfToken(token) {
    if (token) {
        csrfToken = token;
    }
}

export function getCsrfToken() {
    return csrfToken;
}

export async function fetchCsrfToken() {
    try {
        const res = await fetch('/api/csrf');
        const data = await res.json();
        if (data.csrf_token) {
            setCsrfToken(data.csrf_token);
        }
        return csrfToken;
    } catch (e) {
        console.error('Failed to fetch CSRF token:', e);
        return '';
    }
}

export async function apiRequest(endpoint, options = {}) {
    const method = options.method || 'GET';
    const headers = options.headers || {};

    if (!headers['Content-Type'] && !(options.body instanceof FormData)) {
        headers['Content-Type'] = 'application/json';
    }

    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method.toUpperCase())) {
        if (!csrfToken) {
            await fetchCsrfToken();
        }
        headers['X-CSRF-Token'] = csrfToken;
    }

    options.headers = headers;
    options.credentials = 'same-origin';

    const response = await fetch(endpoint, options);
    const contentType = response.headers.get('Content-Type') || '';
    
    let result = null;
    if (contentType.includes('application/json')) {
        result = await response.json();
    } else {
        const text = await response.text();
        result = { error: text, message: text };
    }

    if (!response.ok) {
        const errMessage = result?.error || result?.message || `HTTP Error ${response.status}`;
        const errCode = result?.code || response.status;
        const errorObj = new Error(errMessage);
        errorObj.code = errCode;
        errorObj.data = result;
        errorObj.status = response.status;
        throw errorObj;
    }

    // Refresh CSRF token if returned in response
    if (result && result.csrf_token) {
        setCsrfToken(result.csrf_token);
    }

    return result;
}
