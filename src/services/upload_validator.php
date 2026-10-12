<?php
/**
 * SpendSense - Upload Validator & File Storage
 * Validates uploaded bill files: JPG, PNG, WEBP, PDF up to 10MB.
 * Generates cryptographic random filenames and ensures safe storage.
 */

declare(strict_types=1);

require_once __DIR__ . '/../config.php';

/**
 * Validates and saves an uploaded file.
 * Returns array with file metadata: ['file_name', 'file_path', 'mime_type', 'file_size']
 */
function handle_uploaded_receipt(array $file): array {
    if (!isset($file['error']) || is_array($file['error'])) {
        throw new InvalidArgumentException('Invalid file upload parameters.', 400);
    }

    switch ($file['error']) {
        case UPLOAD_ERR_OK:
            break;
        case UPLOAD_ERR_INI_SIZE:
        case UPLOAD_ERR_FORM_SIZE:
            throw new InvalidArgumentException('Uploaded file exceeds maximum allowed file size (10MB).', 400);
        case UPLOAD_ERR_NO_FILE:
            throw new InvalidArgumentException('No file was uploaded.', 400);
        default:
            throw new RuntimeException('File upload error code: ' . $file['error'], 500);
    }

    if ($file['size'] > MAX_UPLOAD_BYTES) {
        throw new InvalidArgumentException('Uploaded file exceeds maximum limit of 10MB.', 400);
    }

    // Inspect real MIME type via finfo
    $tmpPath = $file['tmp_name'];
    $finfo = finfo_open(FILEINFO_MIME_TYPE);
    $realMime = finfo_file($finfo, $tmpPath);
    finfo_close($finfo);

    $allowedMimes = [
        'image/jpeg' => 'jpg',
        'image/jpg'  => 'jpg',
        'image/png'  => 'png',
        'image/webp' => 'webp',
        'application/pdf' => 'pdf',
    ];

    if (!isset($allowedMimes[$realMime])) {
        throw new InvalidArgumentException(
            "Unsupported file format ({$realMime}). Please upload a JPEG, PNG, WebP image or PDF document.",
            400
        );
    }

    $extension = $allowedMimes[$realMime];
    // Generate secure unguessable random filename
    $randomName = bin2hex(random_bytes(16)) . '.' . $extension;
    $destination = UPLOADS_DIR . '/' . $randomName;

    if (!move_uploaded_file($tmpPath, $destination)) {
        throw new RuntimeException('Failed to save uploaded file to disk.', 500);
    }

    return [
        'file_name' => $randomName,
        'file_path' => 'uploads/' . $randomName,
        'full_path' => $destination,
        'mime_type' => $realMime,
        'file_size' => (int)$file['size'],
    ];
}

/**
 * Handles single or multiple uploaded files (up to 3 images for long receipts).
 * Returns array of validated file info objects.
 */
function handle_uploaded_receipts(array $files): array {
    // If single file structure
    if (isset($files['name']) && !is_array($files['name'])) {
        return [handle_uploaded_receipt($files)];
    }

    $results = [];
    $names = (array)($files['name'] ?? []);
    $count = count($names);
    $limit = min(3, $count);

    for ($i = 0; $i < $limit; $i++) {
        if (($files['error'][$i] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_NO_FILE) {
            continue;
        }
        $singleFile = [
            'name' => $files['name'][$i] ?? '',
            'type' => $files['type'][$i] ?? '',
            'tmp_name' => $files['tmp_name'][$i] ?? '',
            'error' => $files['error'][$i] ?? UPLOAD_ERR_NO_FILE,
            'size' => $files['size'][$i] ?? 0,
        ];
        $results[] = handle_uploaded_receipt($singleFile);
    }

    if (empty($results)) {
        throw new InvalidArgumentException('Please select a bill image (JPG, PNG, WebP) or PDF document to upload.', 400);
    }

    return $results;
}
