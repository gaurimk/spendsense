/**
 * SpendSense - Firebase Authentication Integration
 * Supports Email/Password registration & login and Google Sign-in popup.
 */

import {
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    signInWithPopup,
    signOut,
    onAuthStateChanged,
    updateProfile
} from "https://www.gstatic.com/firebasejs/11.4.0/firebase-auth.js";
import { doc, setDoc, getDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js";
import { auth, db, googleProvider } from "./firebase-config.js";
import { apiRequest, setCsrfToken } from "./api.js";

let currentFirebaseUser = null;
let currentAppUser = null;

export function getCurrentFirebaseUser() {
    return currentFirebaseUser;
}

export function getCurrentAppUser() {
    return currentAppUser;
}

/**
 * Syncs the Firebase authenticated user with the backend session and ensures
 * the Firestore user document exists.
 */
async function syncUserWithBackendAndFirestore(firebaseUser, extraProfile = {}) {
    const uid = firebaseUser.uid;
    const email = firebaseUser.email || '';
    const fullName = extraProfile.full_name || firebaseUser.displayName || email.split('@')[0] || 'SpendSense User';
    const currency = extraProfile.currency || 'INR';
    const usageType = extraProfile.usage_type || 'personal';

    // 1. Ensure Firestore user document exists via atomic setDoc merge
    try {
        const userDocRef = doc(db, 'users', uid);
        await setDoc(userDocRef, {
            email: email,
            full_name: fullName,
            currency: currency,
            usage_type: usageType,
            created_at: serverTimestamp(),
            updated_at: serverTimestamp()
        }, { merge: true });
        console.log('Firestore user document synced successfully for UID:', uid);
    } catch (firestoreErr) {
        console.error('Firestore user profile sync error:', firestoreErr);
    }

    // 2. Synchronize with backend session API
    try {
        const syncResponse = await apiRequest('/api/auth/firebase-sync', {
            method: 'POST',
            body: {
                uid: uid,
                email: email,
                full_name: fullName,
                currency: currency,
                usage_type: usageType
            }
        });

        if (syncResponse && syncResponse.csrf_token) {
            setCsrfToken(syncResponse.csrf_token);
        }
        currentAppUser = syncResponse;
        return syncResponse;
    } catch (apiErr) {
        console.warn('Backend session sync warning:', apiErr);
        currentAppUser = {
            user: { id: uid, email: email, full_name: fullName, usage_type: usageType },
            settings: { currency: currency, currency_symbol: currency === 'USD' ? '$' : '₹', daily_upload_limit: 20 },
            authenticated: true
        };
        return currentAppUser;
    }
}

/**
 * Sign In with Email & Password
 */
export async function loginWithEmail(email, password) {
    const userCredential = await signInWithEmailAndPassword(auth, email.trim(), password);
    currentFirebaseUser = userCredential.user;
    return await syncUserWithBackendAndFirestore(currentFirebaseUser);
}

/**
 * Register / Sign Up with Email & Password
 */
export async function registerWithEmail(fullName, email, password, currency = 'INR', usageType = 'personal') {
    const userCredential = await createUserWithEmailAndPassword(auth, email.trim(), password);
    currentFirebaseUser = userCredential.user;

    // Update display name in Firebase Auth
    if (fullName) {
        try {
            await updateProfile(currentFirebaseUser, { displayName: fullName.trim() });
        } catch (e) {
            console.warn('Could not update Firebase displayName:', e);
        }
    }

    return await syncUserWithBackendAndFirestore(currentFirebaseUser, {
        full_name: fullName,
        currency: currency,
        usage_type: usageType
    });
}

/**
 * Sign In / Sign Up with Google (Popup)
 */
export async function loginWithGoogle() {
    const result = await signInWithPopup(auth, googleProvider);
    currentFirebaseUser = result.user;
    return await syncUserWithBackendAndFirestore(currentFirebaseUser, {
        full_name: currentFirebaseUser.displayName,
        currency: 'INR',
        usage_type: 'personal'
    });
}

/**
 * Sign Out from Firebase and clear local session
 */
export async function logoutFirebase() {
    try {
        await signOut(auth);
    } catch (e) {
        console.warn('Firebase sign out error:', e);
    }
    try {
        await apiRequest('/api/auth/logout', { method: 'POST' });
    } catch (e) {
        // Ignore logout network error
    }
    currentFirebaseUser = null;
    currentAppUser = null;
    window.location.reload();
}

/**
 * Listen for Firebase Auth state changes
 */
export function initAuthListener(onUserChanged) {
    return onAuthStateChanged(auth, async (firebaseUser) => {
        currentFirebaseUser = firebaseUser;
        if (firebaseUser) {
            try {
                // If user was just signed in or registered with explicit profile, avoid overwriting with defaults
                if (currentAppUser && currentAppUser.user && (currentAppUser.user.id === firebaseUser.uid || currentAppUser.user.firebase_uid === firebaseUser.uid)) {
                    if (typeof onUserChanged === 'function') {
                        onUserChanged(currentAppUser);
                    }
                    return;
                }
                const appData = await syncUserWithBackendAndFirestore(firebaseUser);
                if (typeof onUserChanged === 'function') {
                    onUserChanged(appData);
                }
            } catch (err) {
                console.error('Error handling auth state change:', err);
                if (typeof onUserChanged === 'function') {
                    onUserChanged(null);
                }
            }
        } else {
            currentAppUser = null;
            if (typeof onUserChanged === 'function') {
                onUserChanged(null);
            }
        }
    });
}
