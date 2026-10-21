/**
 * SpendSense - Firebase Configuration & Services Initialization
 * Project: spendsense-1cc5e
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-app.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-storage.js";

export const firebaseConfig = {
  apiKey: "AIzaSyCOLoF5dUOEKNYEhO_F4e1sngqrLwq8SsY",
  authDomain: "spendsense-1cc5e.firebaseapp.com",
  projectId: "spendsense-1cc5e",
  storageBucket: "spendsense-1cc5e.firebasestorage.app",
  messagingSenderId: "441761896591",
  appId: "1:441761896591:web:60387c2ef2235ea231b8fa",
  measurementId: "G-VN0FC8NCWQ"
};

// Initialize Firebase App
export const app = initializeApp(firebaseConfig);

// Initialize Firebase Authentication
export const auth = getAuth(app);

// Initialize Cloud Firestore
export const db = getFirestore(app);

// Initialize Cloud Storage
export const storage = getStorage(app);

// Configure Google Auth Provider
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({
  prompt: 'select_account'
});
