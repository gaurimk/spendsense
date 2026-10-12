/**
 * SpendSense - Image Preparation Module (ES Module)
 * Client-side preprocessing for bill images before upload:
 * 1. Resizes large phone photos (max long side ~2000px)
 * 2. Auto-rotates using EXIF orientation
 * 3. Compresses to high-quality JPEG
 * 4. Detects dark or blurry captures and alerts user with light/camera tips
 * 5. Supports multi-photo batches (up to 3 images for long receipts)
 */

const MAX_LONG_SIDE = 2000;
const JPEG_QUALITY = 0.86;

export async function prepareBillFiles(fileList) {
    const files = Array.from(fileList || []).slice(0, 3);
    const results = [];
    let hasDarkOrBlurry = false;

    for (const file of files) {
        if (file.type === 'application/pdf') {
            results.push({
                blob: file,
                name: file.name,
                type: 'application/pdf',
                previewUrl: null,
                isDarkOrBlurry: false,
            });
            continue;
        }

        try {
            const processed = await processSingleImage(file);
            if (processed.isDarkOrBlurry) {
                hasDarkOrBlurry = true;
            }
            results.push(processed);
        } catch (err) {
            console.warn('Canvas optimization fallback to original file:', err);
            results.push({
                blob: file,
                name: file.name,
                type: file.type || 'image/jpeg',
                previewUrl: URL.createObjectURL(file),
                isDarkOrBlurry: false,
            });
        }
    }

    return {
        files: results,
        hasDarkOrBlurry,
        tipMessage: hasDarkOrBlurry ? 'Try better light and hold the camera straight above the bill.' : null,
    };
}

async function processSingleImage(file) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const objectUrl = URL.createObjectURL(file);

        img.onload = () => {
            try {
                let { width, height } = img;
                const naturalLong = Math.max(width, height);

                // Resize down if larger than MAX_LONG_SIDE
                if (naturalLong > MAX_LONG_SIDE) {
                    if (width >= height) {
                        height = Math.round((height * MAX_LONG_SIDE) / width);
                        width = MAX_LONG_SIDE;
                    } else {
                        width = Math.round((width * MAX_LONG_SIDE) / height);
                        height = MAX_LONG_SIDE;
                    }
                }

                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;

                const ctx = canvas.getContext('2d', { willReadFrequently: true });
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';
                ctx.drawImage(img, 0, 0, width, height);

                // Analyze lighting & contrast for blur/darkness detection
                const qualityCheck = checkLightingAndBlur(ctx, width, height);

                // Compress to JPEG
                canvas.toBlob((blob) => {
                    URL.revokeObjectURL(objectUrl);
                    if (!blob) {
                        resolve({
                            blob: file,
                            name: file.name,
                            type: file.type,
                            previewUrl: URL.createObjectURL(file),
                            isDarkOrBlurry: qualityCheck.isDarkOrBlurry,
                        });
                        return;
                    }

                    const newName = file.name.replace(/\.[^/.]+$/, "") + ".jpg";
                    const previewUrl = URL.createObjectURL(blob);

                    resolve({
                        blob,
                        name: newName,
                        type: 'image/jpeg',
                        previewUrl,
                        isDarkOrBlurry: qualityCheck.isDarkOrBlurry,
                        qualityReason: qualityCheck.reason,
                    });
                }, 'image/jpeg', JPEG_QUALITY);

            } catch (canvasErr) {
                URL.revokeObjectURL(objectUrl);
                reject(canvasErr);
            }
        };

        img.onerror = (e) => {
            URL.revokeObjectURL(objectUrl);
            reject(new Error('Failed to load image into canvas: ' + e));
        };

        img.src = objectUrl;
    });
}

/**
 * Fast pixel analysis on a downsampled grid to detect dark or blurry images.
 */
function checkLightingAndBlur(ctx, width, height) {
    const sampleSize = 64;
    const sampleCanvas = document.createElement('canvas');
    sampleCanvas.width = sampleSize;
    sampleCanvas.height = sampleSize;
    const sCtx = sampleCanvas.getContext('2d', { willReadFrequently: true });

    sCtx.drawImage(ctx.canvas, 0, 0, width, height, 0, 0, sampleSize, sampleSize);
    const imgData = sCtx.getImageData(0, 0, sampleSize, sampleSize).data;

    let totalLuminance = 0;
    const luminances = [];

    for (let i = 0; i < imgData.length; i += 4) {
        const r = imgData[i];
        const g = imgData[i + 1];
        const b = imgData[i + 2];
        // Standard perceived luminance
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        totalLuminance += lum;
        luminances.push(lum);
    }

    const avgLuminance = totalLuminance / luminances.length;

    // Calculate variance/contrast
    let varianceSum = 0;
    for (let l of luminances) {
        varianceSum += Math.pow(l - avgLuminance, 2);
    }
    const stdDev = Math.sqrt(varianceSum / luminances.length);

    let isDarkOrBlurry = false;
    let reason = null;

    if (avgLuminance < 48) {
        isDarkOrBlurry = true;
        reason = 'dark';
    } else if (stdDev < 18) {
        isDarkOrBlurry = true;
        reason = 'low_contrast_or_blurry';
    }

    return { isDarkOrBlurry, avgLuminance, stdDev, reason };
}
