<?php
/**
 * SpendSense - Front Controller & Router
 * Serves SPA frontend, protects uploaded files with ownership verification,
 * and routes /api calls to api_handler.
 */

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/config.php';
require_once dirname(__DIR__) . '/src/db.php';
require_once dirname(__DIR__) . '/src/auth.php';
require_once dirname(__DIR__) . '/src/api_handler.php';

$uri = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);

// 1. Static file check for built-in PHP web server (cli-server)
if (php_sapi_name() === 'cli-server') {
    $staticFile = __DIR__ . $uri;
    if ($uri !== '/' && is_file($staticFile) && !str_ends_with($staticFile, '.php')) {
        return false;
    }
}

// 2. Protected upload file delivery (images / PDFs)
if (str_starts_with($uri, '/uploads/')) {
    $fileName = basename($uri);
    $filePath = UPLOADS_DIR . '/' . $fileName;

    if (!file_exists($filePath) || is_dir($filePath)) {
        http_response_code(404);
        header('Content-Type: application/json');
        echo json_encode(['error' => 'File not found.', 'code' => 404]);
        exit;
    }

    // Strict user ownership check
    $pdo = get_db();
    $user = get_current_user_info($pdo);
    if (!$user) {
        http_response_code(401);
        header('Content-Type: application/json');
        echo json_encode(['error' => 'Authentication required to view bill attachments.', 'code' => 401]);
        exit;
    }

    $userId = $user['user']['id'];
    $checkStmt = $pdo->prepare('
        SELECT id FROM bills WHERE file_name = ? AND user_id = ?
        UNION
        SELECT id FROM upload_log WHERE file_name = ? AND user_id = ?
    ');
    $checkStmt->execute([$fileName, $userId, $fileName, $userId]);
    if (!$checkStmt->fetch()) {
        http_response_code(403);
        header('Content-Type: application/json');
        echo json_encode(['error' => 'Access denied: you do not own this attachment.', 'code' => 403]);
        exit;
    }

    $finfo = finfo_open(FILEINFO_MIME_TYPE);
    $mimeType = finfo_file($finfo, $filePath);
    finfo_close($finfo);

    header('Content-Type: ' . ($mimeType ?: 'application/octet-stream'));
    header('Content-Length: ' . (string)filesize($filePath));
    header('Cache-Control: private, max-age=3600');
    header('X-Content-Type-Options: nosniff');
    readfile($filePath);
    exit;
}

// 3. API endpoints
if (str_starts_with($uri, '/api')) {
    handle_api_request();
    exit;
}

// 4. Single-Page Application HTML wrapper
header('Content-Type: text/html; charset=utf-8');
if (file_exists(__DIR__ . '/index.html')) {
    require __DIR__ . '/index.html';
} else {
    echo '<!DOCTYPE html><html><head><title>SpendSense</title></head><body><h1>SpendSense API running</h1><p>Frontend will be loaded in Stage 2.</p></body></html>';
}
