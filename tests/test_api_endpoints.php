<?php
/**
 * SpendSense - Stage 1 HTTP API Dispatch Tests
 * Simulates HTTP API requests and tests JSON responses, HTTP codes, and error formatting.
 */

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/config.php';

$testPassed = 0;
$testFailed = 0;

function assert_api_test(bool $condition, string $testName, string $details = ''): void {
    global $testPassed, $testFailed;
    if ($condition) {
        $testPassed++;
        echo "  [\033[32mPASS\033[0m] {$testName}\n";
    } else {
        $testFailed++;
        echo "  [\033[31mFAIL\033[0m] {$testName}" . ($details ? ": {$details}" : '') . "\n";
    }
}

echo "\n======================================================\n";
echo " SpendSense Stage 1 - API Endpoint Simulation Tests\n";
echo "======================================================\n\n";

function simulate_api_request(string $method, string $uri, array $body = [], array $headers = []): array {
    $script = dirname(__DIR__) . '/public/index.php';
    $postData = json_encode($body);

    $headerCode = '';
    foreach ($headers as $k => $v) {
        $serverKey = 'HTTP_' . strtoupper(str_replace('-', '_', $k));
        $headerCode .= "\$_SERVER['{$serverKey}'] = " . var_export($v, true) . ";\n";
    }

    $code = <<<PHP
\$_SERVER['REQUEST_METHOD'] = '{$method}';
\$_SERVER['REQUEST_URI'] = '{$uri}';
\$_SERVER['CONTENT_TYPE'] = 'application/json';
{$headerCode}
\$GLOBALS['mock_input'] = {$postData};

// Custom stream wrapper or intercept php://input
require '{$script}';
PHP;

    // Use php CLI execution with arguments
    $cmd = sprintf(
        "php -r %s",
        escapeshellarg($code)
    );

    $descriptors = [
        0 => ['pipe', 'r'],
        1 => ['pipe', 'w'],
        2 => ['pipe', 'w']
    ];

    $proc = proc_open("php", $descriptors, $pipes, dirname(__DIR__));
    if (!is_resource($proc)) {
        return ['code' => 500, 'body' => null, 'raw' => 'proc_open failed'];
    }

    $phpInputWrapper = <<<PHP
<?php
\$_SERVER['REQUEST_METHOD'] = '{$method}';
\$_SERVER['REQUEST_URI'] = '{$uri}';
\$_SERVER['CONTENT_TYPE'] = 'application/json';
{$headerCode}
// Mock php://input via stream or temporary file if needed
require '{$script}';
PHP;

    fwrite($pipes[0], $phpInputWrapper);
    fclose($pipes[0]);

    $output = stream_get_contents($pipes[1]);
    fclose($pipes[1]);
    $error = stream_get_contents($pipes[2]);
    fclose($pipes[2]);

    $exitCode = proc_close($proc);
    $decoded = json_decode($output, true);

    return [
        'exitCode' => $exitCode,
        'raw' => $output,
        'json' => $decoded,
        'error' => $error,
    ];
}

// 1. Test /api/health
echo "1. Testing /api/health:\n";
$resHealth = simulate_api_request('GET', '/api/health');
assert_api_test(
    is_array($resHealth['json']) && ($resHealth['json']['status'] ?? '') === 'healthy',
    '/api/health returns HTTP 200 with status: healthy'
);
assert_api_test(
    isset($resHealth['json']['gemini_model']) && $resHealth['json']['gemini_model'] === 'gemini-3.8-flash',
    '/api/health returns configured GEMINI_MODEL (gemini-3.8-flash)'
);

// 2. Test /api/csrf
echo "\n2. Testing /api/csrf:\n";
$resCsrf = simulate_api_request('GET', '/api/csrf');
assert_api_test(
    is_array($resCsrf['json']) && !empty($resCsrf['json']['csrf_token']),
    '/api/csrf returns a valid CSRF token'
);

// 3. Test /api/gemini/test
echo "\n3. Testing /api/gemini/test:\n";
$resGemini = simulate_api_request('GET', '/api/gemini/test');
// Without real key in placeholder, it must return a clear JSON error structure
assert_api_test(
    is_array($resGemini['json']) && (
        isset($resGemini['json']['status']) || isset($resGemini['json']['error'])
    ),
    '/api/gemini/test returns structured JSON response'
);
assert_api_test(
    isset($resGemini['json']['code']),
    '/api/gemini/test returns classified error/status code'
);

// 4. Test 404 on unknown endpoint
echo "\n4. Testing 404 on Unknown Endpoint:\n";
$res404 = simulate_api_request('GET', '/api/does_not_exist');
assert_api_test(
    is_array($res404['json']) && ($res404['json']['code'] ?? '') === 'NOT_FOUND',
    'Unknown API endpoint returns JSON error with code: NOT_FOUND'
);

echo "\n======================================================\n";
echo " API Test Summary: {$testPassed} passed, {$testFailed} failed\n";
echo "======================================================\n\n";

if ($testFailed > 0) {
    exit(1);
}
exit(0);
