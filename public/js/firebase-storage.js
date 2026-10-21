/**
 * SpendSense - Firebase Cloud Storage Service Module
 * Handles uploading receipt images & multi-page PDFs to Cloud Storage
 * with per-user path isolation: /users/{userId}/receipts/{fileName}
 */

import {
    ref,
    uploadBytes,
    getDownloadURL,
    deleteObject
} from "https://www.gstatic.com/firebasejs/11.4.0/firebase-storage.js";
import { storage } from "./firebase-config.js";

/**
 * Upload a receipt file (Image / PDF) to Firebase Cloud Storage.
 *
 * @param {string} userId - Authenticated user's UID
 * @param {Blob|File} fileBlob - Receipt image or PDF blob
 * @param {string} [originalName] - Original file name
 * @returns {Promise<{ downloadUrl: string, storagePath: string, fileName: string }>}
 */
export async function uploadReceiptToStorage(userId, fileBlob, originalName = 'bill.jpg') {
    if (!userId) {
        throw new Error('User ID required to upload file to Cloud Storage.');
    }

    const cleanName = (originalName || 'receipt.jpg')
        .replace(/[^a-zA-Z0-9._-]/g, '_')
        .toLowerCase();
    const timestamp = Date.now();
    const storagePath = `users/${userId}/receipts/${timestamp}_${cleanName}`;

    const storageRef = ref(storage, storagePath);
    const contentType = fileBlob.type || (cleanName.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg');

    const metadata = {
        contentType: contentType,
        customMetadata: {
            uploadedBy: userId,
            originalName: cleanName,
            uploadedAt: new Date().toISOString()
        }
    };

    // Upload bytes to Cloud Storage
    const snapshot = await uploadBytes(storageRef, fileBlob, metadata);

    // Get public/authenticated download URL
    const downloadUrl = await getDownloadURL(snapshot.ref);

    return {
        downloadUrl,
        storagePath,
        fileName: `${timestamp}_${cleanName}`
    };
}

/**
 * Delete a receipt file from Cloud Storage.
 *
 * @param {string} storagePath - Storage path (e.g., users/{userId}/receipts/{file})
 * @returns {Promise<void>}
 */
export async function deleteReceiptFromStorage(storagePath) {
    if (!storagePath) return;
    try {
        const fileRef = ref(storage, storagePath);
        await deleteObject(fileRef);
    } catch (err) {
        console.warn('Firebase storage delete note:', err.message);
    }
}

/**
 * Fetch a download URL for a storage path.
 *
 * @param {string} storagePath
 * @returns {Promise<string>}
 */
export async function getReceiptUrl(storagePath) {
    if (!storagePath) return '';
    const fileRef = ref(storage, storagePath);
    return await getDownloadURL(fileRef);
}
