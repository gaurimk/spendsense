<?php
/**
 * SpendSense - Authentication & Session Management
 * Secure sessions (HttpOnly, SameSite), CSRF verification,
 * bcrypt password hashing, multi-tenant user isolation.
 */

declare(strict_types=1);

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/db.php';

function start_session_safe(): void {
    if (session_status() === PHP_SESSION_NONE) {
        $isHttps = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
            || (isset($_SERVER['SERVER_PORT']) && $_SERVER['SERVER_PORT'] == 443)
            || (isset($_SERVER['HTTP_X_FORWARDED_PROTO']) && $_SERVER['HTTP_X_FORWARDED_PROTO'] === 'https');

        session_set_cookie_params([
            'lifetime' => 86400 * 7, // 7 days
            'path' => '/',
            'domain' => '',
            'secure' => $isHttps,
            'httponly' => true,
            'samesite' => 'Lax',
        ]);
        ini_set('session.use_only_cookies', '1');
        session_start();
    }
}

/**
 * Generates or retrieves the CSRF token for the active session.
 */
function get_csrf_token(): string {
    start_session_safe();
    if (empty($_SESSION['csrf_token'])) {
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['csrf_token'];
}

/**
 * Validates the CSRF token from header or payload on mutating HTTP methods.
 */
function verify_csrf_token(): bool {
    start_session_safe();
    $expected = $_SESSION['csrf_token'] ?? '';
    if ($expected === '') {
        return false;
    }

    $provided = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? $_POST['csrf_token'] ?? '';
    if ($provided === '') {
        $input = json_decode((string)file_get_contents('php://input'), true);
        if (is_array($input) && isset($input['csrf_token'])) {
            $provided = (string)$input['csrf_token'];
        }
    }

    return hash_equals($expected, (string)$provided);
}

/**
 * Enforces CSRF token check on mutating HTTP methods.
 */
function require_csrf(): void {
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    if (in_array($method, ['POST', 'PUT', 'DELETE', 'PATCH'], true)) {
        if (!verify_csrf_token()) {
            json_error('CSRF token validation failed. Please refresh and try again.', 403, 'CSRF_INVALID');
        }
    }
}

/**
 * Register a new user with minimal onboarding.
 */
function register_user(
    PDO $pdo,
    string $email,
    string $password,
    string $fullName,
    string $currency = 'INR',
    string $usageType = 'personal'
): array {
    $email = strtolower(trim($email));
    $fullName = trim($fullName);
    $usageType = in_array(strtolower($usageType), ['personal', 'family', 'shop'], true) ? strtolower($usageType) : 'personal';

    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        throw new InvalidArgumentException('Please enter a valid email address.');
    }
    if ($fullName === '') {
        throw new InvalidArgumentException('Please enter your full name.');
    }
    if (strlen($password) < 6) {
        throw new InvalidArgumentException('Password must be at least 6 characters.');
    }

    // Check if email already registered
    $checkStmt = $pdo->prepare('SELECT id FROM users WHERE email = ?');
    $checkStmt->execute([$email]);
    if ($checkStmt->fetch()) {
        throw new RuntimeException('An account with this email already exists.');
    }

    $currencySymbols = [
        'INR' => '₹',
        'USD' => '$',
        'EUR' => '€',
        'GBP' => '£',
        'AED' => 'د.إ',
        'SGD' => 'S$',
    ];
    $currency = strtoupper(trim($currency));
    $currencySymbol = $currencySymbols[$currency] ?? '₹';

    $hash = password_hash($password, PASSWORD_BCRYPT);
    $now = gmdate('Y-m-d H:i:s');

    $pdo->beginTransaction();
    try {
        $insertUser = $pdo->prepare('
            INSERT INTO users (email, full_name, password_hash, usage_type, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
        ');
        $insertUser->execute([$email, $fullName, $hash, $usageType, $now, $now]);
        $userId = (int)$pdo->lastInsertId();

        $shopMode = ($usageType === 'shop') ? 1 : 0;
        $insertSettings = $pdo->prepare('
            INSERT INTO settings (user_id, currency, currency_symbol, date_format, daily_upload_limit, shop_mode, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ');
        $insertSettings->execute([$userId, $currency, $currencySymbol, 'DD-MM-YYYY', DAILY_UPLOAD_LIMIT, $shopMode, $now, $now]);

        seed_default_categories($pdo, $userId);

        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        throw $e;
    }

    start_session_safe();
    session_regenerate_id(true);
    $_SESSION['user_id'] = $userId;
    $_SESSION['user_email'] = $email;
    $_SESSION['user_name'] = $fullName;
    $_SESSION['usage_type'] = $usageType;

    $csrfToken = get_csrf_token();

    return [
        'user' => [
            'id' => $userId,
            'email' => $email,
            'full_name' => $fullName,
            'usage_type' => $usageType,
        ],
        'settings' => [
            'currency' => $currency,
            'currency_symbol' => $currencySymbol,
            'date_format' => 'DD-MM-YYYY',
            'daily_upload_limit' => DAILY_UPLOAD_LIMIT,
            'shop_mode' => $usageType === 'shop',
        ],
        'csrf_token' => $csrfToken,
    ];
}

/**
 * Login user with email and password.
 */
function login_user(PDO $pdo, string $email, string $password): array {
    $email = strtolower(trim($email));
    if ($email === '' || $password === '') {
        throw new InvalidArgumentException('Email and password are required.');
    }

    $stmt = $pdo->prepare('SELECT * FROM users WHERE email = ?');
    $stmt->execute([$email]);
    $user = $stmt->fetch();

    if (!$user || !password_verify($password, $user['password_hash'])) {
        throw new RuntimeException('Invalid email or password.');
    }

    start_session_safe();
    session_regenerate_id(true);
    $_SESSION['user_id'] = (int)$user['id'];
    $_SESSION['user_email'] = $user['email'];
    $_SESSION['user_name'] = $user['full_name'];
    $_SESSION['usage_type'] = $user['usage_type'];

    $csrfToken = get_csrf_token();

    // Fetch user settings
    $settStmt = $pdo->prepare('SELECT * FROM settings WHERE user_id = ?');
    $settStmt->execute([$user['id']]);
    $settings = $settStmt->fetch() ?: [];

    return [
        'user' => [
            'id' => (int)$user['id'],
            'email' => $user['email'],
            'full_name' => $user['full_name'],
            'usage_type' => $user['usage_type'],
        ],
        'settings' => [
            'currency' => $settings['currency'] ?? 'INR',
            'currency_symbol' => $settings['currency_symbol'] ?? '₹',
            'date_format' => $settings['date_format'] ?? 'DD-MM-YYYY',
            'daily_upload_limit' => (int)($settings['daily_upload_limit'] ?? 20),
            'shop_mode' => (bool)($settings['shop_mode'] ?? 0),
        ],
        'csrf_token' => $csrfToken,
    ];
}

/**
 * Fetches current authenticated user info.
 */
function get_current_user_info(PDO $pdo): ?array {
    start_session_safe();
    $userId = $_SESSION['user_id'] ?? null;
    if (!$userId) {
        return null;
    }

    $stmt = $pdo->prepare('SELECT id, email, full_name, usage_type, created_at FROM users WHERE id = ?');
    $stmt->execute([$userId]);
    $user = $stmt->fetch();
    if (!$user) {
        return null;
    }

    $settStmt = $pdo->prepare('SELECT * FROM settings WHERE user_id = ?');
    $settStmt->execute([$userId]);
    $settings = $settStmt->fetch() ?: [];

    return [
        'user' => [
            'id' => (int)$user['id'],
            'email' => $user['email'],
            'full_name' => $user['full_name'],
            'usage_type' => $user['usage_type'],
        ],
        'settings' => [
            'currency' => $settings['currency'] ?? 'INR',
            'currency_symbol' => $settings['currency_symbol'] ?? '₹',
            'date_format' => $settings['date_format'] ?? 'DD-MM-YYYY',
            'daily_upload_limit' => (int)($settings['daily_upload_limit'] ?? 20),
            'shop_mode' => (bool)($settings['shop_mode'] ?? 0),
        ],
        'csrf_token' => get_csrf_token(),
    ];
}

/**
 * Enforces authenticated session; returns current user info or throws/terminates.
 */
function require_auth(PDO $pdo): array {
    $info = get_current_user_info($pdo);
    if (!$info) {
        json_error('Please log in to continue.', 401, 'UNAUTHORIZED');
    }
    return $info;
}

/**
 * Logs out user and destroys session.
 */
function logout_user(): void {
    start_session_safe();
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $params = session_get_cookie_params();
        setcookie(session_name(), '', time() - 42000,
            $params['path'], $params['domain'],
            $params['secure'], $params['httponly']
        );
    }
    session_destroy();
}
