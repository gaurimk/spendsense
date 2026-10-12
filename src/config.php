<?php
/**
 * SpendSense - Configuration & Error Handling
 * Loads environment variables, sets core constants, configures JSON response helpers,
 * and attaches global exception, error, and shutdown handlers.
 */

declare(strict_types=1);

define('APP_ROOT', dirname(__DIR__));
define('DATA_DIR', getenv('DATA_DIR') ?: (APP_ROOT . '/data'));
define('UPLOADS_DIR', getenv('UPLOADS_DIR') ?: (APP_ROOT . '/uploads'));
define('DB_FILE', DATA_DIR . '/spendsense.sqlite');
define('LOG_FILE', DATA_DIR . '/app.log');

// Ensure data & uploads directories exist
if (!is_dir(DATA_DIR)) {
    @mkdir(DATA_DIR, 0755, true);
}
if (!is_dir(UPLOADS_DIR)) {
    @mkdir(UPLOADS_DIR, 0755, true);
}

/**
 * Loads .env file without external dependencies
 */
function load_env_file(string $filePath): array {
    if (!file_exists($filePath)) {
        return [];
    }
    $lines = file($filePath, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    $env = [];
    foreach ($lines as $line) {
        $line = trim($line);
        if ($line === '' || str_starts_with($line, '#')) {
            continue;
        }
        $parts = explode('=', $line, 2);
        if (count($parts) === 2) {
            $key = trim($parts[0]);
            $val = trim($parts[1]);
            // Strip surrounding quotes
            if ((str_starts_with($val, '"') && str_ends_with($val, '"')) ||
                (str_starts_with($val, "'") && str_ends_with($val, "'"))) {
                $val = substr($val, 1, -1);
            }
            $env[$key] = $val;
        }
    }
    return $env;
}

// Read .env fallback
$fileEnv = load_env_file(APP_ROOT . '/.env');

// Helper to prioritize system environment variables, then .env fallback
function get_config_var(string $key, string $default = '', array $fileEnv = []): string {
    $sysVal = getenv($key);
    if ($sysVal !== false && trim((string)$sysVal) !== '') {
        return trim((string)$sysVal);
    }
    if (isset($_ENV[$key]) && trim((string)$_ENV[$key]) !== '') {
        return trim((string)$_ENV[$key]);
    }
    if (isset($fileEnv[$key]) && trim((string)$fileEnv[$key]) !== '') {
        return trim((string)$fileEnv[$key]);
    }
    return $default;
}

// Core constants
define('GEMINI_API_KEY', get_config_var('GEMINI_API_KEY', '', $fileEnv));
define('GEMINI_MODEL', get_config_var('GEMINI_MODEL', 'gemini-3.8-flash', $fileEnv));
define('GEMINI_MODEL_HANDWRITTEN', get_config_var('GEMINI_MODEL_HANDWRITTEN', GEMINI_MODEL, $fileEnv));
define('APP_ENV', get_config_var('APP_ENV', 'development', $fileEnv));
define('DAILY_UPLOAD_LIMIT', (int)get_config_var('DAILY_UPLOAD_LIMIT', '20', $fileEnv));
define('MAX_UPLOAD_BYTES', 10 * 1024 * 1024); // 10MB
define('DEFAULT_CURRENCY', 'INR');
define('DEFAULT_CURRENCY_SYMBOL', '₹');

/**
 * Log message securely to /data/app.log.
 * NEVER logs API keys.
 */
function app_log(string $level, string $message, array $context = []): void {
    $timestamp = gmdate('Y-m-d H:i:s');
    $contextJson = '';
    if (!empty($context)) {
        // Redact any potential secrets from context
        array_walk_recursive($context, function (&$val, $key) {
            if (is_string($key) && preg_match('/key|token|secret|password|auth/i', $key)) {
                $val = '***REDACTED***';
            }
        });
        $contextJson = ' ' . json_encode($context, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    }
    $line = "[{$timestamp} UTC] [{$level}] {$message}{$contextJson}" . PHP_EOL;
    @file_put_contents(LOG_FILE, $line, FILE_APPEND | LOCK_EX);
}

/**
 * Global JSON response helper
 */
function json_response(mixed $data, int $status = 200): void {
    if (!headers_sent()) {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
    }
    echo json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

/**
 * Error JSON response helper
 */
function json_error(string $message, int $status = 400, string|int $code = 'BAD_REQUEST', array $extra = []): void {
    $payload = array_merge([
        'error' => $message,
        'code' => $code,
    ], $extra);
    json_response($payload, $status);
}

/**
 * HTML escape helper
 */
function e(string $string): string {
    return htmlspecialchars($string, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

/**
 * Check if the current request is an API request
 */
function is_api_request(): bool {
    $uri = parse_url($_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH) ?? '';
    return str_starts_with($uri, '/api');
}

/**
 * Setup global error, exception, and shutdown handlers
 */
function setup_error_handlers(): void {
    // 1. Convert PHP warnings/notices/errors to exceptions or log them
    set_error_handler(function (int $errno, string $errstr, string $errfile, int $errline): bool {
        if (!(error_reporting() & $errno)) {
            return false;
        }
        app_log('PHP_ERROR', "{$errstr} in {$errfile}:{$errline} (errno: {$errno})");
        if (in_array($errno, [E_USER_ERROR, E_RECOVERABLE_ERROR], true)) {
            throw new ErrorException($errstr, 0, $errno, $errfile, $errline);
        }
        return true;
    });

    // 2. Uncaught exception handler
    set_exception_handler(function (Throwable $e): void {
        app_log('EXCEPTION', $e->getMessage(), [
            'file' => $e->getFile(),
            'line' => $e->getLine(),
            'trace' => substr($e->getTraceAsString(), 0, 1000)
        ]);

        if (php_sapi_name() === 'cli' && !isset($_SERVER['REQUEST_URI'])) {
            fwrite(STDERR, "[FATAL] " . $e->getMessage() . PHP_EOL);
            exit(1);
        }

        $statusCode = ($e->getCode() >= 400 && $e->getCode() < 600) ? (int)$e->getCode() : 500;
        json_error($e->getMessage(), $statusCode, $e->getCode() ?: 'INTERNAL_ERROR');
    });

    // 3. Fatal shutdown handler
    register_shutdown_function(function (): void {
        $error = error_get_last();
        if ($error !== null && in_array($error['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR], true)) {
            app_log('FATAL', $error['message'], [
                'file' => $error['file'],
                'line' => $error['line'],
                'type' => $error['type']
            ]);
            if (!headers_sent() && is_api_request()) {
                http_response_code(500);
                header('Content-Type: application/json; charset=utf-8');
                echo json_encode([
                    'error' => 'A fatal server error occurred.',
                    'code' => 'FATAL_ERROR'
                ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
            }
        }
    });
}

// Register handlers immediately
setup_error_handlers();
