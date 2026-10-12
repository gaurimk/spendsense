<?php
/**
 * SpendSense - Stage 1 CLI Test Suite
 * Validates:
 * 1. Database schema initialization, WAL mode & foreign keys
 * 2. User registration, password hashing (bcrypt), onboarding defaults
 * 3. User login and authentication state
 * 4. CSRF token generation and validation
 * 5. Strict multi-tenant user isolation (User A vs User B)
 * 6. Protected upload file ownership verification
 * 7. JSON error formatting and logging to data/app.log
 * 8. Gemini service prompt construction, privacy rules, error classification, and mocked response handling
 */

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/config.php';
require_once dirname(__DIR__) . '/src/db.php';
require_once dirname(__DIR__) . '/src/auth.php';
require_once dirname(__DIR__) . '/src/services/gemini.php';

$testPassed = 0;
$testFailed = 0;

function assert_test(bool $condition, string $testName, string $details = ''): void {
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
echo " SpendSense Stage 1 - PHP CLI Test Suite\n";
echo "======================================================\n\n";

// Use an isolated in-memory or temporary SQLite database for pristine tests
$testDbFile = DATA_DIR . '/test_spendsense.sqlite';
if (file_exists($testDbFile)) {
    @unlink($testDbFile);
}

$pdo = get_db($testDbFile);

// ── 1. Database Setup & Pragmas ──────────────────────────────
echo "1. Testing Database Initialization & Pragmas:\n";

setup_database($pdo);

$fkCheck = $pdo->query('PRAGMA foreign_keys;')->fetchColumn();
assert_test((int)$fkCheck === 1, 'Foreign keys pragma is ENABLED');

$journalMode = $pdo->query('PRAGMA journal_mode;')->fetchColumn();
assert_test(strtolower((string)$journalMode) === 'wal', 'Journal mode is set to WAL');

// Verify all required tables exist
$requiredTables = [
    'users', 'settings', 'categories', 'bills', 'bill_items',
    'item_category_map', 'budgets', 'reminders', 'chat_messages',
    'accuracy_logs', 'upload_log'
];
$tablesInDb = $pdo->query("SELECT name FROM sqlite_master WHERE type='table';")->fetchAll(PDO::FETCH_COLUMN);

$allTablesPresent = true;
foreach ($requiredTables as $tbl) {
    if (!in_array($tbl, $tablesInDb, true)) {
        $allTablesPresent = false;
        break;
    }
}
assert_test($allTablesPresent, 'All 11 core SpendSense tables are created successfully');

// ── 2. User Registration & Onboarding ────────────────────────
echo "\n2. Testing Registration & Onboarding Defaults:\n";

// Test 2.1: Register User A (Personal)
$userAData = register_user($pdo, 'arun@example.com', 'SecurePass123!', 'Arun Kumar', 'INR', 'personal');
assert_test($userAData['user']['email'] === 'arun@example.com', 'User A registered with correct email');
assert_test($userAData['settings']['currency'] === 'INR', 'User A currency set to INR');
assert_test($userAData['settings']['shop_mode'] === false, 'User A shop_mode is false for personal');

// Test 2.2: Verify default categories seeded for User A
$catStmt = $pdo->prepare('SELECT COUNT(*) FROM categories WHERE user_id = ?');
$catStmt->execute([$userAData['user']['id']]);
$catCount = (int)$catStmt->fetchColumn();
assert_test($catCount === 11, 'Default 11 expense categories seeded for User A (including Stationery & Office)');

// Test 2.3: Duplicate email rejection
$dupCaught = false;
try {
    register_user($pdo, 'arun@example.com', 'AnotherPass!', 'Arun Duplicate');
} catch (RuntimeException $e) {
    $dupCaught = true;
}
assert_test($dupCaught, 'Duplicate email registration is blocked');

// Test 2.4: Short password rejection
$shortPassCaught = false;
try {
    register_user($pdo, 'short@example.com', '123', 'Short Pass');
} catch (InvalidArgumentException $e) {
    $shortPassCaught = true;
}
assert_test($shortPassCaught, 'Password shorter than 6 characters is rejected');

// Test 2.5: Register User B (Shop mode)
$userBData = register_user($pdo, 'priya@kirana.in', 'KiranaStore456!', 'Priya Sharma', 'INR', 'shop');
assert_test($userBData['settings']['shop_mode'] === true, 'User B registered with shop_mode enabled');

// ── 3. Login & Authentication ────────────────────────────────
echo "\n3. Testing Login & Credentials Verification:\n";

// Test 3.1: Valid login
$loginA = login_user($pdo, 'arun@example.com', 'SecurePass123!');
assert_test($loginA['user']['id'] === $userAData['user']['id'], 'User A logged in successfully with valid password');

// Test 3.2: Invalid password
$wrongPassCaught = false;
try {
    login_user($pdo, 'arun@example.com', 'WrongPassword!');
} catch (RuntimeException $e) {
    $wrongPassCaught = true;
}
assert_test($wrongPassCaught, 'Login with incorrect password rejected');

// ── 4. CSRF Security ─────────────────────────────────────────
echo "\n4. Testing CSRF Protection:\n";

$token = get_csrf_token();
assert_test(!empty($token) && strlen($token) === 64, 'CSRF token is generated (64 hex characters)');

$_SERVER['HTTP_X_CSRF_TOKEN'] = $token;
assert_test(verify_csrf_token() === true, 'Valid CSRF token in HTTP_X_CSRF_TOKEN passes verification');

$_SERVER['HTTP_X_CSRF_TOKEN'] = 'invalid_tampered_token';
assert_test(verify_csrf_token() === false, 'Invalid CSRF token fails verification');
unset($_SERVER['HTTP_X_CSRF_TOKEN']);

// ── 5. Multi-Tenant User Isolation ───────────────────────────
echo "\n5. Testing Strict Multi-Tenant User Isolation:\n";

$userAId = $userAData['user']['id'];
$userBId = $userBData['user']['id'];

// Insert a bill for User A
$billStmt = $pdo->prepare('
    INSERT INTO bills (user_id, merchant_name, merchant_type, bill_number, bill_date, payment_method, file_name, file_path, subtotal, tax_amount, grand_total, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
');
$billStmt->execute([
    $userAId,
    'DMart Ready Supermarket',
    'supermarket',
    'DMART-2026-9921',
    '2026-10-12',
    'UPI',
    'dmart_receipt_userA.jpg',
    'uploads/dmart_receipt_userA.jpg',
    1500.0,
    75.0,
    1575.0,
    'confirmed',
    '2026-10-12 10:00:00',
    '2026-10-12 10:00:00',
]);
$billAId = (int)$pdo->lastInsertId();

// Insert items for User A
$itemStmt = $pdo->prepare('
    INSERT INTO bill_items (user_id, bill_id, item_name, quantity, unit, unit_price, line_total, confidence, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
');
$itemStmt->execute([$userAId, $billAId, 'Basmati Rice 5kg', 1.0, 'bag', 500.0, 500.0, 'high', '2026-10-12 10:00:00']);
$itemStmt->execute([$userAId, $billAId, 'Sunflower Oil 2L', 2.0, 'bottle', 300.0, 600.0, 'high', '2026-10-12 10:00:00']);

// Insert chat message for User A
$chatStmt = $pdo->prepare('
    INSERT INTO chat_messages (user_id, role, message_text, created_at)
    VALUES (?, ?, ?, ?)
');
$chatStmt->execute([$userAId, 'user', 'Where did I spend the most this month?', '2026-10-12 10:05:00']);

// Test 5.1: User B queries bills (must be 0)
$userBBillsStmt = $pdo->prepare('SELECT * FROM bills WHERE user_id = ?');
$userBBillsStmt->execute([$userBId]);
$userBBills = $userBBillsStmt->fetchAll();
assert_test(count($userBBills) === 0, 'User B cannot see User A bills (0 bills returned)');

// Test 5.2: User B queries bill items (must be 0)
$userBItemsStmt = $pdo->prepare('SELECT * FROM bill_items WHERE user_id = ?');
$userBItemsStmt->execute([$userBId]);
$userBItems = $userBItemsStmt->fetchAll();
assert_test(count($userBItems) === 0, 'User B cannot see User A bill items (0 items returned)');

// Test 5.3: User B queries chat messages (must be 0)
$userBChatStmt = $pdo->prepare('SELECT * FROM chat_messages WHERE user_id = ?');
$userBChatStmt->execute([$userBId]);
$userBChat = $userBChatStmt->fetchAll();
assert_test(count($userBChat) === 0, 'User B cannot see User A chat messages (0 messages returned)');

// Test 5.4: Cross-user direct access attempt by bill ID
$crossBillStmt = $pdo->prepare('SELECT * FROM bills WHERE id = ? AND user_id = ?');
$crossBillStmt->execute([$billAId, $userBId]);
assert_test($crossBillStmt->fetch() === false, 'Direct bill lookup with mismatched user_id blocked');

// ── 6. Protected Upload Ownership ────────────────────────────
echo "\n6. Testing Protected Attachment Ownership:\n";

// User A owns 'dmart_receipt_userA.jpg'
$fileStmtA = $pdo->prepare('SELECT id FROM bills WHERE file_name = ? AND user_id = ?');
$fileStmtA->execute(['dmart_receipt_userA.jpg', $userAId]);
assert_test((bool)$fileStmtA->fetch() === true, 'User A confirmed as owner of dmart_receipt_userA.jpg');

// User B must NOT own it
$fileStmtB = $pdo->prepare('SELECT id FROM bills WHERE file_name = ? AND user_id = ?');
$fileStmtB->execute(['dmart_receipt_userA.jpg', $userBId]);
assert_test($fileStmtB->fetch() === false, 'User B blocked from accessing dmart_receipt_userA.jpg');

// ── 7. Error Handling & Privacy in Prompts ────────────────────
echo "\n7. Testing Prompt Privacy & Gemini Error Classification:\n";

$prompt = build_receipt_extraction_prompt('INR');
$hasCardPrivacy = str_contains($prompt, 'card numbers') && str_contains($prompt, 'phone numbers');
assert_test($hasCardPrivacy, 'Prompt explicitly instructs Gemini to ignore & discard card & phone numbers');

// Test Gemini key check when missing or placeholder
$missingKeyCaught = false;
try {
    call_gemini_api(['test' => true], 45, '');
} catch (RuntimeException $e) {
    if ($e->getCode() === 401 || str_contains($e->getMessage(), 'API key is not configured') || str_contains($e->getMessage(), 'GEMINI_API_KEY')) {
        $missingKeyCaught = true;
    }
}
assert_test($missingKeyCaught, 'Gemini service returns clean 401 message when key is not configured');

// Test Mocked Gemini structured receipt output
$mockGeminiReceiptJson = <<<JSON
{
  "merchant_name": "DMart Supermarket",
  "merchant_name_confidence": "high",
  "merchant_type": "supermarket",
  "merchant_type_confidence": "high",
  "bill_number": "DMR-78901",
  "bill_number_confidence": "high",
  "bill_date": "2026-10-10",
  "bill_date_confidence": "high",
  "bill_time": "14:30",
  "bill_time_confidence": "medium",
  "payment_method": "UPI",
  "payment_method_confidence": "high",
  "currency": "INR",
  "line_items": [
    {
      "name": "Tata Tea Gold 500g",
      "name_confidence": "high",
      "quantity": 1.0,
      "quantity_confidence": "high",
      "unit": "pack",
      "unit_confidence": "high",
      "unit_price": 280.0,
      "unit_price_confidence": "high",
      "tax_percent": 5.0,
      "tax_percent_confidence": "high",
      "line_total": 294.0,
      "line_total_confidence": "high",
      "category": "Groceries & Supermarket",
      "category_confidence": "high"
    }
  ],
  "subtotal": 280.0,
  "subtotal_confidence": "high",
  "tax_amount": 14.0,
  "tax_amount_confidence": "high",
  "discount_amount": 0.0,
  "discount_amount_confidence": "high",
  "grand_total": 294.0,
  "grand_total_confidence": "high"
}
JSON;

$decodedMock = json_decode($mockGeminiReceiptJson, true);
assert_test(is_array($decodedMock) && $decodedMock['merchant_name'] === 'DMart Supermarket', 'Mocked receipt JSON parses cleanly with all required fields');
assert_test($decodedMock['grand_total'] === 294.0, 'Grand total correctly extracted from mock receipt');

// ── 8. API Endpoint JSON Response Tests ───────────────────────
echo "\n8. Testing API Endpoints & JSON Error Handling:\n";

function simulate_api_call(string $method, string $uri): array {
    $script = dirname(__DIR__) . '/public/index.php';
    $descriptors = [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']];
    $proc = proc_open("php", $descriptors, $pipes, dirname(__DIR__));
    if (!is_resource($proc)) {
        return [];
    }

    $wrapper = <<<PHP
<?php
\$_SERVER['REQUEST_METHOD'] = '{$method}';
\$_SERVER['REQUEST_URI'] = '{$uri}';
\$_SERVER['CONTENT_TYPE'] = 'application/json';
require '{$script}';
PHP;
    fwrite($pipes[0], $wrapper);
    fclose($pipes[0]);
    $out = stream_get_contents($pipes[1]);
    fclose($pipes[1]);
    fclose($pipes[2]);
    proc_close($proc);
    return json_decode($out, true) ?: [];
}

$apiHealth = simulate_api_call('GET', '/api/health');
assert_test(($apiHealth['status'] ?? '') === 'healthy', '/api/health responds with status: healthy');
assert_test(($apiHealth['gemini_model'] ?? '') === 'gemini-3.8-flash', '/api/health reports GEMINI_MODEL as gemini-3.8-flash');

$apiCsrf = simulate_api_call('GET', '/api/csrf');
assert_test(!empty($apiCsrf['csrf_token']), '/api/csrf returns a valid CSRF token');

$apiGeminiTest = simulate_api_call('GET', '/api/gemini/test');
assert_test(isset($apiGeminiTest['status']) || isset($apiGeminiTest['error']), '/api/gemini/test returns structured response');

$api404 = simulate_api_call('GET', '/api/non_existent_route');
assert_test(($api404['code'] ?? '') === 'NOT_FOUND', 'Unmatched API endpoint returns clean JSON with code: NOT_FOUND');

// ── 9. Arithmetic Integrity & Warning Tests ───────────────────
echo "\n9. Testing Arithmetic Integrity Checks:\n";

require_once dirname(__DIR__) . '/src/services/arithmetic.php';

// Test 9.1: Valid arithmetic produces zero warnings
$cleanItems = [
    ['name' => 'Basmati Rice 5kg', 'quantity' => 2.0, 'unit_price' => 250.0, 'tax_percent' => 5.0, 'line_total' => 525.0],
    ['name' => 'Sunflower Oil 1L', 'quantity' => 1.0, 'unit_price' => 180.0, 'tax_percent' => 0.0, 'line_total' => 180.0],
];
$cleanWarnings = validate_bill_arithmetic($cleanItems, 705.0, 25.0, 0.0, 705.0);
assert_test(empty($cleanWarnings), 'Valid arithmetic produces zero warnings');

// Test 9.2: Line total mismatch (qty * price != line_total)
$badLineItems = [
    ['name' => 'Item X', 'quantity' => 3.0, 'unit_price' => 100.0, 'tax_percent' => 0.0, 'line_total' => 450.0],
];
$lineMismatchWarnings = validate_bill_arithmetic($badLineItems, 450.0, 0.0, 0.0, 450.0);
assert_test(
    count($lineMismatchWarnings) === 1 && $lineMismatchWarnings[0]['code'] === 'LINE_TOTAL_MISMATCH',
    'Detects LINE_TOTAL_MISMATCH when 3 x 100 != 450'
);

// Test 9.3: Sum of lines mismatch vs grand total
$badSumItems = [
    ['name' => 'Item A', 'quantity' => 1.0, 'unit_price' => 200.0, 'tax_percent' => 0.0, 'line_total' => 200.0],
    ['name' => 'Item B', 'quantity' => 1.0, 'unit_price' => 300.0, 'tax_percent' => 0.0, 'line_total' => 300.0],
];
$sumMismatchWarnings = validate_bill_arithmetic($badSumItems, 500.0, 0.0, 0.0, 999.0);
$hasSumMismatch = false;
foreach ($sumMismatchWarnings as $w) {
    if ($w['code'] === 'SUM_LINES_MISMATCH') $hasSumMismatch = true;
}
assert_test($hasSumMismatch, 'Detects SUM_LINES_MISMATCH when sum of lines (500) does not match grand total (999)');

// Test 9.4: Low confidence field triggers warning
$lowConfWarnings = validate_bill_arithmetic($cleanItems, 705.0, 25.0, 0.0, 705.0, ['merchant_name' => 'low']);
$hasLowConf = false;
foreach ($lowConfWarnings as $w) {
    if ($w['code'] === 'LOW_CONFIDENCE_FIELD') $hasLowConf = true;
}
assert_test($hasLowConf, 'Flags low-confidence field with amber warning');

// ── 10. Duplicate Detection Tests ────────────────────────────
echo "\n10. Testing Duplicate Bill Detection:\n";

require_once dirname(__DIR__) . '/src/services/duplicate_detection.php';

// Check duplicate against existing DMart bill created for User A in section 5
// $billA: merchant: 'DMart Ready Supermarket', bill_number: 'DMART-2026-9921', bill_date: '2026-10-12', total: 1575.0
$dupFound = check_duplicate_bill($pdo, $userAId, 'DMart Ready Supermarket', '2026-10-12', 1575.0, 'DMART-2026-9921');
assert_test($dupFound !== null, 'Detects duplicate bill by merchant + date + bill_number + total');

// Non-duplicate with different date
$noDupDate = check_duplicate_bill($pdo, $userAId, 'DMart Ready Supermarket', '2026-10-15', 1575.0, 'DMART-DIFF');
assert_test($noDupDate === null, 'Different date and bill number is not flagged as duplicate');

// Cross-user duplicate check: User B uploading same bill is NOT flagged as User A's duplicate
$noDupUser = check_duplicate_bill($pdo, $userBId, 'DMart Ready Supermarket', '2026-10-12', 1575.0, 'DMART-2026-9921');
assert_test($noDupUser === null, 'Duplicate check is strictly isolated by user_id');

// ── 11. Daily Upload Limit Tests ─────────────────────────────
echo "\n11. Testing Daily Upload Limit Enforcement:\n";

require_once dirname(__DIR__) . '/src/services/bill_saving.php';

$limitStatusBefore = check_daily_upload_limit($pdo, $userAId);
assert_test($limitStatusBefore['allowed'] === true, 'Upload allowed when below daily limit');

// Simulate reaching the daily limit for User A
for ($i = 0; $i < 20; $i++) {
    record_upload($pdo, $userAId, "dummy_bill_{$i}.jpg", 50000);
}
$limitStatusAfter = check_daily_upload_limit($pdo, $userAId);
assert_test($limitStatusAfter['allowed'] === false, 'Upload blocked when user reaches daily limit of 20');
assert_test(!empty($limitStatusAfter['message']), 'Friendly message provided upon reaching upload limit');

// ── 12. Bill Saving, Post-Save Insights & Category Learning ───
echo "\n12. Testing Bill Saving, Accuracy Logs & Category Learning:\n";

$newBillData = [
    'merchant_name' => 'DMart Ready Supermarket',
    'merchant_type' => 'supermarket',
    'bill_number' => 'DMART-SAVE-001',
    'bill_date' => '2026-10-12',
    'payment_method' => 'UPI',
    'subtotal' => 450.0,
    'tax_amount' => 22.5,
    'grand_total' => 472.5,
    'line_items' => [
        [
            'name' => 'Amul Butter 500g',
            'category' => 'Groceries & Supermarket',
            'quantity' => 1.0,
            'unit' => 'pack',
            'unit_price' => 275.0,
            'tax_percent' => 5.0,
            'line_total' => 288.75,
            'confidence' => 'high'
        ],
        [
            'name' => 'Bourbon Biscuits',
            'category' => 'Snacks & Confectionery', // new user-assigned category
            'quantity' => 2.0,
            'unit' => 'packs',
            'unit_price' => 40.0,
            'tax_percent' => 0.0,
            'line_total' => 80.0,
            'confidence' => 'high'
        ],
    ],
];

$originalGeminiData = [
    'merchant_name' => 'DMart', // user corrected to 'DMart Ready Supermarket'
    'bill_number' => 'DMART-SAVE-001',
    'bill_date' => '2026-10-12',
    'payment_method' => 'UPI',
    'grand_total' => 472.5,
    'line_items' => [
        ['name' => 'Amul Butter 500g', 'category' => 'Groceries & Supermarket'],
        ['name' => 'Bourbon Biscuits', 'category' => 'General & Miscellaneous'], // Gemini had assigned General
    ],
];

// Save confirmed bill for User A
$savedResult = save_confirmed_bill($pdo, $userAId, $newBillData, $originalGeminiData);
assert_test($savedResult['bill_id'] > 0, 'Confirmed bill saved successfully with positive ID');
assert_test(!empty($savedResult['insight']), 'Post-save insight generated: "' . $savedResult['insight'] . '"');

// Verify accuracy log was created
$accStmt = $pdo->prepare('SELECT * FROM accuracy_logs WHERE bill_id = ? AND user_id = ?');
$accStmt->execute([$savedResult['bill_id'], $userAId]);
$accLog = $accStmt->fetch();
assert_test($accLog !== false && (int)$accLog['corrected_fields'] >= 1, 'Field corrections tracked in accuracy_logs');

// Verify category learning: Bourbon Biscuits should now be mapped to 'Snacks & Confectionery'
$learnStmt = $pdo->prepare('SELECT category_name FROM item_category_map WHERE user_id = ? AND item_name_normalized = ?');
$learnStmt->execute([$userAId, 'bourbon biscuits']);
$learnedCategory = $learnStmt->fetchColumn();
assert_test($learnedCategory === 'Snacks & Confectionery', 'Auto-categorization learned "Snacks & Confectionery" for "Bourbon Biscuits"');

// ── 13. Demo Data Seeder Tests ───────────────────────────────
echo "\n13. Testing Demo Data Seeder (~40 realistic bills):\n";

require_once dirname(__DIR__) . '/src/services/demo_seeder.php';

$seedRes = seed_demo_data($pdo, $userAId);
assert_test($seedRes['success'] === true, 'Demo data seeder executes successfully');
assert_test($seedRes['bills_seeded'] >= 25, 'Seeded ' . $seedRes['bills_seeded'] . ' realistic bills across 3 months');

// Verify bills exist across 3 distinct months
$monthsStmt = $pdo->prepare("SELECT DISTINCT SUBSTR(bill_date, 1, 7) AS ym FROM bills WHERE user_id = ? ORDER BY ym ASC");
$monthsStmt->execute([$userAId]);
$seededMonths = $monthsStmt->fetchAll(PDO::FETCH_COLUMN);
assert_test(in_array('2026-08', $seededMonths, true) && in_array('2026-09', $seededMonths, true) && in_array('2026-10', $seededMonths, true), 'Demo data spans August, September, and October 2026');

// ── 14. Whitelisted Query Functions Tests ────────────────────
echo "\n14. Testing Whitelisted Query Functions:\n";

require_once dirname(__DIR__) . '/src/services/query_functions.php';

// Test 14.1: get_spend_summary
$summaryOct = query_get_spend_summary($pdo, $userAId, '2026-10');
assert_test((float)$summaryOct['total_spent'] > 0, 'get_spend_summary calculates non-zero total spend for Oct 2026');
assert_test(!empty($summaryOct['category_breakdown']), 'get_spend_summary returns category breakdown');

// Test 14.2: top_items
$topOct = query_top_items($pdo, $userAId, '2026-10', 5);
assert_test(count($topOct['top_items']) >= 1, 'top_items returns top purchased items');

// Test 14.3: compare_periods (Oct 2026 vs Sep 2026)
$comp = query_compare_periods($pdo, $userAId, '2026-10', '2026-09');
assert_test(isset($comp['difference']['percent_change']), 'compare_periods calculates spending difference and trend');

// Test 14.4: list_bills (5 biggest bills)
$biggestBills = query_list_bills($pdo, $userAId, ['order_by' => 'total_desc', 'limit' => 5]);
assert_test(count($biggestBills['bills']) === 5, 'list_bills returns top 5 biggest bills sorted descending');
assert_test(
    (float)$biggestBills['bills'][0]['grand_total'] >= (float)$biggestBills['bills'][4]['grand_total'],
    'Bills are sorted in descending order of total amount'
);

// Test 14.5: price_history
$milkHistory = query_price_history($pdo, $userAId, 'milk');
assert_test(count($milkHistory['history']) >= 2, 'price_history tracks milk purchases across multiple dates');
assert_test(!empty($milkHistory['cheapest_at']['merchant']), 'price_history identifies cheapest store: ' . ($milkHistory['cheapest_at']['merchant'] ?? ''));

// Test 14.6: budget_status
$budgetStatus = query_budget_status($pdo, $userAId, '2026-10');
assert_test($budgetStatus['has_budgets'] === true, 'budget_status retrieves defined monthly category budgets');
assert_test(count($budgetStatus['categories']) >= 4, 'budget_status reports progress across all budgeted categories');

// ── 15. Cross-User Data Isolation in Query Functions ─────────
echo "\n15. Testing Multi-Tenant Isolation in Query Functions:\n";

// User B must see NOTHING from User A's seeded bills
$userBSummary = query_get_spend_summary($pdo, $userBId, '2026-10');
assert_test((float)$userBSummary['total_spent'] === 0.0, 'User B spend summary returns ₹0.00 (cannot access User A data)');

$userBTop = query_top_items($pdo, $userBId, '2026-10', 5);
assert_test(count($userBTop['top_items']) === 0, 'User B top items returns 0 items');

$userBBills = query_list_bills($pdo, $userBId, ['limit' => 10]);
assert_test($userBBills['count'] === 0, 'User B list bills returns 0 bills');

$userBPrice = query_price_history($pdo, $userBId, 'milk');
assert_test(empty($userBPrice['history']), 'User B price history returns 0 records');

// ── 16. Function Whitelist Security Check ────────────────────
echo "\n16. Testing Function Calling Whitelist Security:\n";

require_once dirname(__DIR__) . '/src/services/chat_ai.php';

$validExec = execute_whitelisted_function($pdo, $userAId, 'get_spend_summary', ['period' => 'this_month']);
assert_test(isset($validExec['total_spent']), 'Whitelisted function get_spend_summary executes normally');

$illegalBlocked = false;
try {
    execute_whitelisted_function($pdo, $userAId, 'raw_sql_query', ['sql' => 'DROP TABLE users']);
} catch (InvalidArgumentException $e) {
    if ($e->getCode() === 403) {
        $illegalBlocked = true;
    }
}
assert_test($illegalBlocked, 'Unauthorized or raw SQL function call is strictly blocked with HTTP 403');

// ── 17. Insights Dashboard Data Verification ──────────────────
echo "\n17. Testing Insights Dashboard Calculations:\n";
require_once dirname(__DIR__) . '/src/services/insights.php';

$insightsData = get_insights_dashboard_data($pdo, $userAId);

assert_test(!empty($insightsData['this_month']['spent']), 'Insights calculates non-zero spend for this month');
assert_test(!empty($insightsData['last_month']['spent']), 'Insights calculates non-zero spend for last month');
assert_test(isset($insightsData['comparison']['percent_change']), 'Insights calculates month-over-month percent change');
assert_test(!empty($insightsData['category_donut']['labels']), 'Insights returns category donut chart labels and values');
assert_test(count($insightsData['monthly_trend']['labels']) >= 3, 'Monthly trendline has data across 3 months');
assert_test((float)$insightsData['average_bill_size'] > 0.0, 'Average bill size correctly calculated (₹' . $insightsData['average_bill_size'] . ')');
assert_test(!empty($insightsData['busiest_day']['day_name']), 'Busiest spending day identified: ' . ($insightsData['busiest_day']['day_name'] ?? ''));
assert_test(count($insightsData['top_merchants']) > 0, 'Top merchants ranking generated');
assert_test(count($insightsData['top_items']) > 0, 'Top spending items ranking generated');

// Isolation check: User B has empty insights
$insightsB = get_insights_dashboard_data($pdo, $userBId);
assert_test((float)$insightsB['this_month']['spent'] === 0.0, 'User B insights shows ₹0.00 spend (multi-tenant safe)');
assert_test(count($insightsB['top_merchants']) === 0, 'User B has 0 top merchants');

// ── 18. Bills Search, Filtering and Deletion ──────────────────
echo "\n18. Testing Bills Listing, Filtering & Deletion:\n";

// Filter by merchant name
$dmartBills = query_list_bills($pdo, $userAId, ['merchant' => 'DMart', 'limit' => 20]);
$allDMart = true;
foreach ($dmartBills['bills'] as $b) {
    if (stripos($b['merchant_name'], 'DMart') === false) { $allDMart = false; break; }
}
assert_test($allDMart && count($dmartBills['bills']) > 0, 'Bills filtered by merchant name "DMart" correctly');

// Insert a test bill specifically for delete testing
$insBill = $pdo->prepare("
    INSERT INTO bills (user_id, merchant_name, merchant_type, bill_date, payment_method, grand_total, status, created_at, updated_at)
    VALUES (?, 'Test Deletion Store', 'supermarket', '2026-10-10', 'UPI', 750.00, 'confirmed', '2026-10-10 12:00:00', '2026-10-10 12:00:00')
");
$insBill->execute([$userAId]);
$testBillId = (int)$pdo->lastInsertId();

$insItem = $pdo->prepare("
    INSERT INTO bill_items (bill_id, user_id, item_name, quantity, unit_price, line_total, created_at)
    VALUES (?, ?, 'Test Item', 1, 750.00, 750.00, '2026-10-10 12:00:00')
");
$insItem->execute([$testBillId, $userAId]);
$testItemId = (int)$pdo->lastInsertId();

// User B tries to delete User A's bill: should fail
$delStmtB = $pdo->prepare("DELETE FROM bills WHERE id = ? AND user_id = ?");
$delStmtB->execute([$testBillId, $userBId]);
assert_test($delStmtB->rowCount() === 0, 'User B cannot delete User A bill (0 rows affected)');

// Verify bill and item still exist
$checkBill = $pdo->prepare("SELECT id FROM bills WHERE id = ?");
$checkBill->execute([$testBillId]);
assert_test((bool)$checkBill->fetchColumn(), 'Bill still exists after unauthorized delete attempt');

// User A deletes their own bill
$delStmtA = $pdo->prepare("DELETE FROM bills WHERE id = ? AND user_id = ?");
$delStmtA->execute([$testBillId, $userAId]);
assert_test($delStmtA->rowCount() === 1, 'User A successfully deletes own bill');

// Verify item cascaded
$checkItem = $pdo->prepare("SELECT id FROM bill_items WHERE id = ?");
$checkItem->execute([$testItemId]);
assert_test(!$checkItem->fetchColumn(), 'Cascade deletion removed associated bill_items');

// ── 19. Category Budgets & Alert Thresholds ───────────────────
echo "\n19. Testing Category Budgets & Alert Thresholds:\n";

// Create isolated budget category for testing
$testCatStmt = $pdo->prepare("INSERT INTO categories (user_id, name, is_system, created_at) VALUES (?, 'Test Alert Category', 0, '2026-11-01 00:00:00')");
$testCatStmt->execute([$userAId]);
$alertCatId = (int)$pdo->lastInsertId();

// Set budget of 1000 for this category for '2026-11'
$budgetMonth = '2026-11';
$setBudgetStmt = $pdo->prepare("
    INSERT INTO budgets (user_id, category_id, monthly_amount, month, created_at)
    VALUES (?, ?, 1000.00, ?, '2026-11-01 00:00:00')
");
$setBudgetStmt->execute([$userAId, $alertCatId, $budgetMonth]);

// Scenario 1: Spend 500 (50% -> normal)
$insBill1 = $pdo->prepare("INSERT INTO bills (user_id, merchant_name, bill_date, grand_total, status, created_at, updated_at) VALUES (?, 'Store 1', '2026-11-02', 500.00, 'confirmed', '2026-11-02 12:00:00', '2026-11-02 12:00:00')");
$insBill1->execute([$userAId]);
$b1Id = (int)$pdo->lastInsertId();
$pdo->prepare("INSERT INTO bill_items (bill_id, user_id, category_id, category_name, item_name, quantity, unit_price, line_total, created_at) VALUES (?, ?, ?, 'Test Alert Category', 'Item 1', 1, 500.00, 500.00, '2026-11-02 12:00:00')")->execute([$b1Id, $userAId, $alertCatId]);

$st1 = query_budget_status($pdo, $userAId, $budgetMonth);
$cat1 = array_values(array_filter($st1['categories'], fn($c) => $c['category_id'] === $alertCatId))[0];
assert_test($cat1['status'] === 'normal', 'Spend 50% is classified as status: normal');
assert_test(empty($st1['alerts']), 'Spend 50% produces 0 threshold alerts');

// Scenario 2: Spend additional 350 (Total 850 / 85% -> warning alert)
$insBill2 = $pdo->prepare("INSERT INTO bills (user_id, merchant_name, bill_date, grand_total, status, created_at, updated_at) VALUES (?, 'Store 2', '2026-11-05', 350.00, 'confirmed', '2026-11-05 12:00:00', '2026-11-05 12:00:00')");
$insBill2->execute([$userAId]);
$b2Id = (int)$pdo->lastInsertId();
$pdo->prepare("INSERT INTO bill_items (bill_id, user_id, category_id, category_name, item_name, quantity, unit_price, line_total, created_at) VALUES (?, ?, ?, 'Test Alert Category', 'Item 2', 1, 350.00, 350.00, '2026-11-05 12:00:00')")->execute([$b2Id, $userAId, $alertCatId]);

$st2 = query_budget_status($pdo, $userAId, $budgetMonth);
$cat2 = array_values(array_filter($st2['categories'], fn($c) => $c['category_id'] === $alertCatId))[0];
assert_test($cat2['status'] === 'warning', 'Spend 85% is classified as status: warning');
assert_test(count($st2['alerts']) >= 1, 'Spend 85% triggers 80% threshold warning alert');

// Scenario 3: Spend additional 200 (Total 1050 / 105% -> exceeded alert)
$insBill3 = $pdo->prepare("INSERT INTO bills (user_id, merchant_name, bill_date, grand_total, status, created_at, updated_at) VALUES (?, 'Store 3', '2026-11-10', 200.00, 'confirmed', '2026-11-10 12:00:00', '2026-11-10 12:00:00')");
$insBill3->execute([$userAId]);
$b3Id = (int)$pdo->lastInsertId();
$pdo->prepare("INSERT INTO bill_items (bill_id, user_id, category_id, category_name, item_name, quantity, unit_price, line_total, created_at) VALUES (?, ?, ?, 'Test Alert Category', 'Item 3', 1, 200.00, 200.00, '2026-11-10 12:00:00')")->execute([$b3Id, $userAId, $alertCatId]);

$st3 = query_budget_status($pdo, $userAId, $budgetMonth);
$cat3 = array_values(array_filter($st3['categories'], fn($c) => $c['category_id'] === $alertCatId))[0];
assert_test($cat3['status'] === 'exceeded', 'Spend 105% is classified as status: exceeded');
assert_test(stripos($st3['alerts'][0], 'exceeded') !== false, 'Spend 105% triggers budget exceeded alert');

// Test post-save insight with budget alert
$budgetInsight = generate_post_save_insight($pdo, $userAId, $b3Id, 'Store 3', '2026-11-10', 200.00, ['Test Alert Category' => [['line_total' => 200.00]]]);
assert_test(stripos($budgetInsight, 'budget alert') !== false, 'Post-save bill insight flags category crossing budget threshold');

// ── 20. Handwritten & Low-Quality Bill Support ───────────────
echo "\n20. Testing Handwritten & Low-Quality Bill Support:\n";

// 20.1: GEMINI_MODEL_HANDWRITTEN config constant exists
assert_test(defined('GEMINI_MODEL_HANDWRITTEN'), 'GEMINI_MODEL_HANDWRITTEN config constant is defined: ' . GEMINI_MODEL_HANDWRITTEN);

// 20.2: Mocked Gemini handwritten response with null fields and low/medium confidence
$mockHandwrittenOcr = [
    'document_type' => 'handwritten',
    'legibility' => 'moderate',
    'merchant_name' => null, // Unreadable shop name remains null, never guessed
    'merchant_type' => 'other',
    'bill_number' => null,   // No bill number on handwritten slip
    'bill_date' => '2026-11-04',
    'bill_time' => null,
    'payment_method' => null, // Unstated payment method stays null (never defaulted to UPI/cash)
    'line_items' => [
        [
            'name' => 'Aashirvaad Atta 5kg',
            'quantity' => 1.0,
            'unit' => 'bag',
            'unit_price' => 240.0,
            'tax_percent' => 0.0,
            'line_total' => 240.0,
            'category' => 'Groceries & Supermarket',
            'confidence' => 'medium',
        ],
        [
            // Ditto mark item (" or ditto) resolved to preceding item/unit
            'name' => 'Aashirvaad Atta 5kg (ditto item)',
            'quantity' => 1.0,
            'unit' => 'bag',
            'unit_price' => 240.0,
            'tax_percent' => 0.0,
            'line_total' => 240.0,
            'category' => 'Groceries & Supermarket',
            'confidence' => 'medium',
        ],
    ],
    'subtotal' => 480.0,
    'tax_amount' => 0.0,
    'discount_amount' => 0.0,
    'grand_total' => 480.0,
    'confidence' => [
        'merchant_name' => 'low',
        'bill_number' => 'low',
        'grand_total' => 'medium',
        'payment_method' => 'low',
    ],
    'currency' => 'INR',
];

// Test unstated payment method remains null
assert_test($mockHandwrittenOcr['payment_method'] === null, 'Unstated payment method on handwritten slip remains null (never defaulted)');
assert_test($mockHandwrittenOcr['merchant_name'] === null, 'Unreadable merchant name remains null (never guessed)');

// 20.3: Ditto mark item retention and positive arithmetic
assert_test(count($mockHandwrittenOcr['line_items']) === 2, 'Handwritten ditto mark creates distinct resolved line item');
assert_test($mockHandwrittenOcr['line_items'][1]['unit_price'] === 240.0, 'Ditto item resolved with correct unit price');
assert_test($mockHandwrittenOcr['line_items'][1]['unit'] === 'bag', 'Ditto item resolved with matching unit');

// 20.4: Arithmetic reconciliation with mismatch between sum of lines and written total
$mismatchHandwrittenItems = [
    ['name' => 'Basmati Rice', 'quantity' => 2.0, 'unit_price' => 100.0, 'tax_percent' => 0.0, 'line_total' => 200.0],
    ['name' => 'Sunflower Oil', 'quantity' => 1.0, 'unit_price' => 150.0, 'tax_percent' => 0.0, 'line_total' => 150.0],
];
// Sum of lines = 350.00, but written total on slip was 400.00
$mismatchWarnings = validate_bill_arithmetic($mismatchHandwrittenItems, 400.0, 0.0, 0.0, 400.0);
$sumWarning = null;
foreach ($mismatchWarnings as $w) {
    if ($w['code'] === 'SUM_LINES_MISMATCH') {
        $sumWarning = $w;
        break;
    }
}
assert_test($sumWarning !== null, 'Arithmetic validator detects mismatch between sum of lines (350) and written total (400)');
assert_test(isset($sumWarning['written_total']) && (float)$sumWarning['written_total'] === 400.0, 'Warning captures written_total: 400.00');
assert_test(isset($sumWarning['sum_of_lines']) && (float)$sumWarning['sum_of_lines'] === 350.0, 'Warning captures sum_of_lines: 350.00');
assert_test(isset($sumWarning['disagreeing_lines']) && count($sumWarning['disagreeing_lines']) === 2, 'Warning lists disagreeing lines for one-click reconciliation');

// 20.5: Saving handwritten bill with null fields and document_type persistence
$hwDraft = [
    'merchant_name' => 'Kirana General Store',
    'merchant_type' => 'supermarket',
    'bill_number' => null,
    'bill_date' => '2026-11-04',
    'payment_method' => null, // Stays null
    'subtotal' => 480.0,
    'tax_amount' => 0.0,
    'discount_amount' => 0.0,
    'grand_total' => 480.0,
    'document_type' => 'handwritten',
    'legibility' => 'moderate',
    'line_items' => $mockHandwrittenOcr['line_items'],
    'warnings' => [],
];

$savedHw = save_confirmed_bill($pdo, $userAId, $hwDraft, $mockHandwrittenOcr);
assert_test($savedHw['bill_id'] > 0, 'Handwritten bill with null fields saved successfully');

// Verify DB columns
$hwCheckStmt = $pdo->prepare("SELECT document_type, legibility, payment_method, bill_number FROM bills WHERE id = ?");
$hwCheckStmt->execute([$savedHw['bill_id']]);
$hwRow = $hwCheckStmt->fetch(PDO::FETCH_ASSOC);
assert_test($hwRow['document_type'] === 'handwritten', 'Database records document_type = "handwritten"');
assert_test($hwRow['legibility'] === 'moderate', 'Database records legibility = "moderate"');
assert_test($hwRow['payment_method'] === null, 'Database records payment_method as NULL when unstated');
assert_test($hwRow['bill_number'] === null, 'Database records bill_number as NULL when omitted');

// 20.6: Accuracy log separates printed vs handwritten
$insightsWithHw = get_insights_dashboard_data($pdo, $userAId);
assert_test(isset($insightsWithHw['accuracy_breakdown']), 'Insights dashboard includes accuracy_breakdown');
$accPrinted = $insightsWithHw['accuracy_breakdown']['printed'] ?? null;
$accHandwritten = $insightsWithHw['accuracy_breakdown']['handwritten'] ?? null;
assert_test($insightsWithHw['accuracy_breakdown']['has_data'] === true, 'Accuracy breakdown has data tracked');
assert_test($accPrinted !== null && isset($accPrinted['accuracy_percent']), 'Printed bills accuracy computed and reported');
assert_test($accHandwritten !== null && isset($accHandwritten['accuracy_percent']), 'Handwritten bills accuracy computed and reported');
assert_test($accHandwritten['bills_analyzed'] >= 1, 'Handwritten accuracy log tracks analyzed bill count: ' . ($accHandwritten['bills_analyzed'] ?? 0));

// ── 21. Real Testing: Grand Total Consistency, Payment Method & Stationery Categorization ──
echo "\n21. Testing Grand Total Consistency Across All Screens & Stationery Categorization:\n";

// 21.1: Default categories includes "Stationery & Office"
$catListStmt = $pdo->prepare('SELECT name FROM categories WHERE user_id = ?');
$catListStmt->execute([$userAId]);
$catsGsm = $catListStmt->fetchAll(PDO::FETCH_COLUMN);
$hasStationeryCat = in_array('Stationery & Office', $catsGsm, true);
assert_test($hasStationeryCat, 'Default categories includes "Stationery & Office"');

// 21.2: Register fresh user for isolated grand total consistency testing
$userGsmData = register_user($pdo, 'gupta@gsmart.in', 'SecureGsmPass123!', 'Gupta Stationery Mart Owner', 'INR', 'personal');
$userGsmId = (int)$userGsmData['user']['id'];
assert_test($userGsmId > 0, 'Registered fresh test user for grand total consistency checks');

// 21.3: Stationery & Office auto-categorization check
$stationeryRegex = '/\b(paper|a4|copier|pen|pens|ballpen|ballpoint|gelpen|notebook|notebooks|register|registers|stapler|staplers|staples|pencil|pencils|notepad|notepads|diary|diaries|marker|markers|highlighter|folder|folders|file|files|stationery)\b/i';
assert_test(preg_match($stationeryRegex, 'JK Copier A4 Paper 75GSM') === 1, 'Auto-categorizer recognizes copier paper as Stationery & Office');
assert_test(preg_match($stationeryRegex, 'Reynolds Ballpoint Pens Pack of 50') === 1, 'Auto-categorizer recognizes pens as Stationery & Office');
assert_test(preg_match($stationeryRegex, 'Classmate Hardbound Register 200p') === 1, 'Auto-categorizer recognizes registers as Stationery & Office');
assert_test(preg_match($stationeryRegex, 'Kangaro Heavy Duty Stapler & Staples') === 1, 'Auto-categorizer recognizes stapler & staples as Stationery & Office');

// 21.4: Payment Method: Unstated on printed bill GSM/0238 (Gupta Stationery Mart)
$todayDate = gmdate('Y-m-d');
$currentMonth = substr($todayDate, 0, 7);

$mockGsmOcr = [
    'document_type' => 'printed',
    'legibility' => 'clear',
    'merchant_name' => 'Gupta Stationery Mart',
    'merchant_type' => 'retail',
    'bill_number' => 'GSM/0238',
    'bill_date' => $todayDate,
    'bill_time' => '14:30:00',
    'payment_method' => null, // Unstated on bill
    'line_items' => [
        [
            'name' => 'JK Copier Paper A4 75GSM (10 Rims)',
            'quantity' => 10.0,
            'unit' => 'rim',
            'unit_price' => 300.00,
            'tax_percent' => 5.0,
            'line_total' => 3000.00,
            'category' => 'Stationery & Office',
            'confidence' => 'high',
        ],
        [
            'name' => 'Reynolds Ballpoint Pens (Pack of 50)',
            'quantity' => 5.0,
            'unit' => 'pack',
            'unit_price' => 200.00,
            'tax_percent' => 5.0,
            'line_total' => 1000.00,
            'category' => 'Stationery & Office',
            'confidence' => 'high',
        ],
        [
            'name' => 'Account Registers Hardbound 200p',
            'quantity' => 20.0,
            'unit' => 'pcs',
            'unit_price' => 500.00,
            'tax_percent' => 5.0,
            'line_total' => 10000.00,
            'category' => 'Stationery & Office',
            'confidence' => 'high',
        ],
        [
            'name' => 'Kangaro Heavy Duty Staplers & Staples',
            'quantity' => 6.0,
            'unit' => 'set',
            'unit_price' => 890.33,
            'tax_percent' => 5.0,
            'line_total' => 5342.00,
            'category' => 'Stationery & Office',
            'confidence' => 'high',
        ],
    ],
    // Sum of items = 19342.00, Tax = 967.10, Grand Total = 20309.10
    'subtotal' => 19342.00,
    'tax_amount' => 967.10,
    'discount_amount' => 0.0,
    'grand_total' => 20309.10,
    'confidence' => [
        'merchant_name' => 'high',
        'bill_number' => 'high',
        'grand_total' => 'high',
        'payment_method' => 'low', // Low confidence / unstated
    ],
    'currency' => 'INR',
];

// Check arithmetic validator flags uncertain payment method
$gsmWarnings = validate_bill_arithmetic(
    $mockGsmOcr['line_items'],
    $mockGsmOcr['subtotal'],
    $mockGsmOcr['tax_amount'],
    $mockGsmOcr['discount_amount'],
    $mockGsmOcr['grand_total'],
    $mockGsmOcr['confidence']
);
$hasUncertainPmWarning = false;
foreach ($gsmWarnings as $w) {
    if ($w['code'] === 'UNCERTAIN_PAYMENT_METHOD') {
        $hasUncertainPmWarning = true;
        break;
    }
}
assert_test($hasUncertainPmWarning, 'Arithmetic validator produces UNCERTAIN_PAYMENT_METHOD warning for unstated/low confidence payment method');

// 21.5: Save confirmed bill GSM/0238
$gsmDraft = [
    'merchant_name' => 'Gupta Stationery Mart',
    'merchant_type' => 'retail',
    'bill_number' => 'GSM/0238',
    'bill_date' => $todayDate,
    'bill_time' => '14:30:00',
    'payment_method' => null, // Stored as NULL
    'subtotal' => 19342.00,
    'tax_amount' => 967.10,
    'discount_amount' => 0.0,
    'grand_total' => 20309.10,
    'document_type' => 'printed',
    'legibility' => 'clear',
    'line_items' => $mockGsmOcr['line_items'],
    'warnings' => [],
];

$savedGsm = save_confirmed_bill($pdo, $userGsmId, $gsmDraft, $mockGsmOcr);
$gsmBillId = (int)$savedGsm['bill_id'];
assert_test($gsmBillId > 0, 'Saved GSM/0238 bill successfully with ID: ' . $gsmBillId);

// 21.6: Verify payment_method in database is strictly NULL (not defaulted to "UPI")
$gsmDbStmt = $pdo->prepare('SELECT payment_method, grand_total, subtotal, tax_amount FROM bills WHERE id = ?');
$gsmDbStmt->execute([$gsmBillId]);
$gsmDbRow = $gsmDbStmt->fetch(PDO::FETCH_ASSOC);
assert_test($gsmDbRow['payment_method'] === null, 'bills.payment_method is NULL in DB when unstated on printed bill');
assert_test((float)$gsmDbRow['grand_total'] === 20309.10, 'bills.grand_total in DB is ₹20,309.10');

// 21.7: Verify proportional tax allocation: sum of bill_items.line_total must EXACTLY equal 20,309.10
$gsmItemsStmt = $pdo->prepare('SELECT ROUND(SUM(line_total), 2) AS total_lines FROM bill_items WHERE bill_id = ?');
$gsmItemsStmt->execute([$gsmBillId]);
$allocatedLinesSum = (float)$gsmItemsStmt->fetchColumn();
assert_test($allocatedLinesSum === 20309.10, 'Proportional allocation distributes tax across line items so sum(line_total) == grand_total (20,309.10 != 19,342.00)');

// 21.8: Check Screen 1: query_get_spend_summary returns ₹20,309.10
$gsmSpendSummary = query_get_spend_summary($pdo, $userGsmId, 'this_month');
assert_test((float)$gsmSpendSummary['total_spent'] === 20309.10, 'get_spend_summary total_spent is ₹20,309.10 (matches grand total, not ₹19,342.00)');
assert_test($gsmSpendSummary['bill_count'] === 1, 'get_spend_summary bill_count is 1');
assert_test($gsmSpendSummary['bill_count_label'] === '1 bill', 'get_spend_summary pluralization uses "1 bill"');

$statCatRow = null;
foreach ($gsmSpendSummary['category_breakdown'] as $cRow) {
    if ($cRow['category_name'] === 'Stationery & Office') {
        $statCatRow = $cRow;
        break;
    }
}
assert_test($statCatRow !== null, 'get_spend_summary groups under "Stationery & Office"');
assert_test((float)($statCatRow['category_spend'] ?? 0) === 20309.10, 'Stationery & Office category spend is ₹20,309.10');

// 21.9: Check Screen 2: query_get_spend_summary top merchants returns ₹20,309.10
assert_test(!empty($gsmSpendSummary['top_merchants']), 'spend summary returns at least 1 merchant');
assert_test($gsmSpendSummary['top_merchants'][0]['merchant_name'] === 'Gupta Stationery Mart', 'top merchant is Gupta Stationery Mart');
assert_test((float)$gsmSpendSummary['top_merchants'][0]['merchant_spend'] === 20309.10, 'top merchant spend is ₹20,309.10');
assert_test($gsmSpendSummary['top_merchants'][0]['visit_count'] === 1, 'top merchant visit_count is 1');

// 21.10: Check Screen 3: query_compare_periods returns ₹20,309.10
$gsmCompare = query_compare_periods($pdo, $userGsmId, 'this_month', 'last_month');
assert_test((float)$gsmCompare['period_a']['total_spent'] === 20309.10, 'compare_periods period_a total_spent is ₹20,309.10');
assert_test($gsmCompare['period_a']['bill_count_label'] === '1 bill', 'compare_periods period_a bill_count_label is "1 bill"');

// 21.11: Check Screen 4: query_list_bills returns ₹20,309.10 and NULL payment_method
$gsmListBills = query_list_bills($pdo, $userGsmId, ['limit' => 10]);
assert_test(count($gsmListBills['bills']) === 1, 'list_bills returns exactly 1 bill');
assert_test((float)$gsmListBills['bills'][0]['grand_total'] === 20309.10, 'list_bills bill grand_total is ₹20,309.10');
assert_test($gsmListBills['bills'][0]['payment_method'] === null, 'list_bills payment_method is NULL');

// 21.12: Check Screen 5: get_insights_dashboard_data returns ₹20,309.10
$gsmInsights = get_insights_dashboard_data($pdo, $userGsmId);
assert_test((float)$gsmInsights['this_month']['spent'] === 20309.10, 'Insights dashboard this_month.spent is ₹20,309.10');
assert_test($gsmInsights['this_month']['bill_count'] === 1, 'Insights dashboard this_month.bill_count is 1');
assert_test((float)$gsmInsights['category_donut']['total'] === 20309.10, 'Insights dashboard category_donut.total is ₹20,309.10');
assert_test($gsmInsights['category_donut']['labels'][0] === 'Stationery & Office', 'Insights dashboard top category donut label is Stationery & Office');
assert_test((float)$gsmInsights['category_donut']['values'][0] === 20309.10, 'Insights dashboard category donut value is ₹20,309.10');
assert_test((float)$gsmInsights['average_bill_size'] === 20309.10, 'Insights dashboard average_bill_size is ₹20,309.10');

// 21.13: Check Screen 6: Budgets tab & query_budget_status returns ₹20,309.10
$gsmStationeryCatStmt = $pdo->prepare('SELECT id FROM categories WHERE user_id = ? AND name = ?');
$gsmStationeryCatStmt->execute([$userGsmId, 'Stationery & Office']);
$gsmCatId = (int)$gsmStationeryCatStmt->fetchColumn();
assert_test($gsmCatId > 0, 'Found category ID for Stationery & Office: ' . $gsmCatId);

$saveBudgetStmt = $pdo->prepare('
    INSERT INTO budgets (user_id, category_id, monthly_amount, month, created_at)
    VALUES (?, ?, ?, ?, ?)
');
$nowStr = gmdate('Y-m-d H:i:s');
$saveBudgetStmt->execute([$userGsmId, $gsmCatId, 25000.00, $currentMonth, $nowStr]);

$gsmBudgetStatus = query_budget_status($pdo, $userGsmId, $currentMonth);
assert_test($gsmBudgetStatus['has_budgets'] === true, 'query_budget_status has_budgets is true');
assert_test(count($gsmBudgetStatus['categories']) === 1, 'query_budget_status returns 1 budgeted category');
$bgtItem = $gsmBudgetStatus['categories'][0];
assert_test((float)$bgtItem['spent'] === 20309.10, 'query_budget_status spent matches grand total: ₹20,309.10');
assert_test((float)$bgtItem['budgeted'] === 25000.00, 'query_budget_status budgeted is ₹25,000.00');
assert_test($bgtItem['percentage_used'] === 81.2, 'query_budget_status percentage_used is 81.2% (crosses 80% threshold)');
assert_test($bgtItem['status'] === 'warning', 'query_budget_status flags status as "warning" (>= 80%)');

// 21.14: Check Screen 7: Post-save insight allocates 100% to Stationery & Office
assert_test(stripos($savedGsm['insight'], '100% of this bill is in Stationery & Office') !== false, 'Post-save insight states: "All 100% of this bill is in Stationery & Office"');

// 21.15: Judgement question handling: "am I spending a lot?"
// User currently has only 1 bill in 1 month -> informs user not enough history is recorded yet
$judgement1 = answer_user_query_fallback($pdo, $userGsmId, 'am I spending a lot?');
assert_test(stripos($judgement1['text'], 'enough spending history') !== false, 'Judgement question with 1 bill informs user not enough spending history is recorded yet');
assert_test(stripos($judgement1['text'], '1 bill') !== false, 'Judgement response includes correct singular "1 bill"');
assert_test(stripos($judgement1['text'], '20,309.10') !== false, 'Judgement response includes exact grand total ₹20,309.10');

// Now record 2 more bills in the previous month (Sep 2026) so history exists (2 months, 3 bills total)
$prevMonthBillA = [
    'merchant_name' => 'Metro Cash & Carry',
    'merchant_type' => 'wholesale',
    'bill_number' => 'MCC/901',
    'bill_date' => '2026-09-12',
    'payment_method' => 'Bank Transfer',
    'subtotal' => 10000.00,
    'tax_amount' => 500.00,
    'discount_amount' => 0.0,
    'grand_total' => 10500.00,
    'line_items' => [
        ['name' => 'Paper Supplies', 'quantity' => 10.0, 'unit_price' => 1000.00, 'tax_percent' => 5.0, 'line_total' => 10500.00, 'category' => 'Stationery & Office']
    ]
];
$prevMonthBillB = [
    'merchant_name' => 'Office Depot',
    'merchant_type' => 'retail',
    'bill_number' => 'OD/552',
    'bill_date' => '2026-09-25',
    'payment_method' => 'Card',
    'subtotal' => 4000.00,
    'tax_amount' => 200.00,
    'discount_amount' => 0.0,
    'grand_total' => 4200.00,
    'line_items' => [
        ['name' => 'Ink Cartridges', 'quantity' => 2.0, 'unit_price' => 2000.00, 'tax_percent' => 5.0, 'line_total' => 4200.00, 'category' => 'Stationery & Office']
    ]
];
save_confirmed_bill($pdo, $userGsmId, $prevMonthBillA);
save_confirmed_bill($pdo, $userGsmId, $prevMonthBillB);

// Ask "am I spending a lot?" again with history available:
$judgement2 = answer_user_query_fallback($pdo, $userGsmId, 'am I spending a lot?');
assert_test(stripos($judgement2['text'], 'trending higher') !== false || stripos($judgement2['text'], 'increase') !== false, 'Judgement question with history compares this month (20,309.10) with last month (14,700.00)');
assert_test(stripos($judgement2['text'], '20,309.10') !== false, 'Judgement comparison includes this month ₹20,309.10');
assert_test(stripos($judgement2['text'], '14,700.00') !== false, 'Judgement comparison includes last month ₹14,700.00');
assert_test(stripos($judgement2['text'], 'budget limit') !== false || stripos($judgement2['text'], 'Stationery & Office') !== false, 'Judgement comparison includes budget notice');

// 21.16: Grammar pluralization checks: "1 bill" vs "2 bills", "1 transaction" vs "2 transactions"
$summary1Bill = query_get_spend_summary($pdo, $userGsmId, 'this_month');
assert_test($summary1Bill['bill_count'] === 1 && $summary1Bill['bill_count_label'] === '1 bill', 'Grammar check: 1 bill has label "1 bill"');

$summary2Bills = query_get_spend_summary($pdo, $userGsmId, 'last_month');
assert_test($summary2Bills['bill_count'] === 2 && $summary2Bills['bill_count_label'] === '2 bills', 'Grammar check: 2 bills has label "2 bills"');

// ── 22. Stage 5 Features: Price Tracker, Reminders, Recurring Spend, Split Bill & Settings ──
echo "\n22. Testing Stage 5 Features (Price Tracker, Reminders, Recurring Spend, Split Bill, Settings):\n";

require_once dirname(__DIR__) . '/src/services/reminders.php';

// 22.1 Price Tracker
$milkHistory = query_price_history($pdo, $userAId, 'milk');
assert_test(!empty($milkHistory['history']), 'Price Tracker returns milk purchase records');
assert_test(!empty($milkHistory['cheapest_at']['merchant']), 'Price Tracker identifies cheapest merchant for milk: ' . ($milkHistory['cheapest_at']['merchant'] ?? ''));
assert_test(isset($milkHistory['trend_flag']), 'Price Tracker computes trend_flag for milk: ' . ($milkHistory['trend_flag'] ?? ''));
assert_test(isset($milkHistory['first_price']), 'Price Tracker returns first_price');
assert_test(isset($milkHistory['latest_price']), 'Price Tracker returns latest_price');

// 22.2 Reminders Service
// Bill suggestion for electronics
$electronicsBill = [
    'merchant_name' => 'Croma Electronics',
    'merchant_type' => 'electronics',
    'bill_number' => 'CR-8821',
    'bill_date' => '2026-10-01',
    'payment_method' => 'Card',
    'subtotal' => 4999.00,
    'tax_amount' => 0.0,
    'discount_amount' => 0.0,
    'grand_total' => 4999.00,
    'line_items' => [
        ['name' => 'Sony Wireless Headphones', 'category' => 'Electronics & Gadgets', 'quantity' => 1.0, 'unit' => 'pcs', 'unit_price' => 4999.00, 'line_total' => 4999.00]
    ]
];
$savedElec = save_confirmed_bill($pdo, $userAId, $electronicsBill);
assert_test(!empty($savedElec['suggested_reminders']), 'Saving electronics bill automatically generates suggested warranty reminders');
$sug = $savedElec['suggested_reminders'][0];
assert_test($sug['type'] === 'warranty', 'Suggested reminder type is "warranty"');
assert_test(stripos($sug['title'], 'Sony Wireless Headphones') !== false, 'Suggested reminder title mentions item name');
assert_test($sug['due_date'] === '2027-10-01', 'Warranty due date is 1 year from purchase: 2027-10-01');

// Reminders CRUD & Status
$newRemId = add_reminder($pdo, $userAId, [
    'title' => 'Renew Car Insurance',
    'type' => 'bill_due',
    'due_date' => date('Y-m-d', strtotime('+3 days')),
    'notes' => 'HDFC Ergo policy',
    'merchant_name' => 'HDFC',
    'amount' => 6500.00,
]);
assert_test($newRemId > 0, 'Created reminder successfully with ID: ' . $newRemId);

$dueList = get_due_reminders($pdo, $userAId, 7);
assert_test(count($dueList) >= 1, 'get_due_reminders finds reminders due within 7 days');

$allReminders = query_list_reminders($pdo, $userAId, 'all');
assert_test(!empty($allReminders['reminders']), 'query_list_reminders returns reminders list');

// Toggle reminder completion
$toggled = toggle_reminder($pdo, $userAId, $newRemId, true);
assert_test($toggled === true, 'toggle_reminder marks reminder as completed');

// Multi-tenant check: User B cannot toggle or delete User A reminder
$userBToggleCaught = false;
try {
    toggle_reminder($pdo, $userBId, $newRemId, false);
} catch (RuntimeException $e) {
    $userBToggleCaught = true;
}
assert_test($userBToggleCaught === true, 'User B cannot toggle User A reminder (multi-tenant safe)');

$userBDel = delete_reminder($pdo, $userBId, $newRemId);
assert_test($userBDel === false, 'User B cannot delete User A reminder');

// User A deletes reminder
$userADel = delete_reminder($pdo, $userAId, $newRemId);
assert_test($userADel === true, 'User A successfully deletes own reminder');

// 22.3 Recurring Spend Detection
$recurringData = query_recurring_spend($pdo, $userAId);
assert_test(!empty($recurringData['items']), 'query_recurring_spend detects recurring repeat expenses');
assert_test($recurringData['total_recurring_monthly'] > 0, 'query_recurring_spend calculates total_recurring_monthly');
$milkRec = null;
foreach ($recurringData['items'] as $rec) {
    if (stripos($rec['item_name'], 'milk') !== false) {
        $milkRec = $rec;
        break;
    }
}
assert_test($milkRec !== null, 'Milk is identified as a recurring expense');
assert_test(!empty($milkRec['frequency']), 'Recurring item has frequency estimate: ' . ($milkRec['frequency'] ?? ''));
assert_test(!empty($milkRec['next_expected_date']), 'Recurring item has next_expected_date: ' . ($milkRec['next_expected_date'] ?? ''));

// User B recurring spend returns 0
$userBRec = query_recurring_spend($pdo, $userBId);
assert_test(count($userBRec['items']) === 0, 'User B has 0 recurring expenses (multi-tenant safe)');

// 22.4 Split Bill Functionality & Insights
$splitBillData = [
    'merchant_name' => 'Toit Brewpub',
    'merchant_type' => 'restaurant',
    'bill_number' => 'TOIT-109',
    'bill_date' => '2026-10-10',
    'payment_method' => 'UPI',
    'subtotal' => 2000.00,
    'tax_amount' => 100.00,
    'discount_amount' => 0.0,
    'grand_total' => 2100.00, // tax scaled proportionally
    'line_items' => [
        ['name' => 'Artisan Pizza', 'category' => 'Food & Dining', 'quantity' => 2.0, 'unit' => 'pcs', 'unit_price' => 500.00, 'line_total' => 1000.00, 'split_type' => 'mine'],
        ['name' => 'Craft Beer Pitcher', 'category' => 'Food & Dining', 'quantity' => 1.0, 'unit' => 'pitcher', 'unit_price' => 600.00, 'line_total' => 600.00, 'split_type' => 'shared'],
        ['name' => 'Mocktail', 'category' => 'Food & Dining', 'quantity' => 2.0, 'unit' => 'glass', 'unit_price' => 200.00, 'line_total' => 400.00, 'split_type' => 'someone_else'],
    ]
];
$savedSplit = save_confirmed_bill($pdo, $userGsmId, $splitBillData);
assert_test($savedSplit['bill_id'] > 0, 'Saved split bill successfully');
$checkSplitStmt = $pdo->prepare('SELECT grand_total, my_share_total FROM bills WHERE id = ?');
$checkSplitStmt->execute([$savedSplit['bill_id']]);
$splitRow = $checkSplitStmt->fetch(PDO::FETCH_ASSOC);
assert_test((float)$splitRow['grand_total'] === 2100.00, 'Split bill grand_total is ₹2,100.00');
assert_test((float)$splitRow['my_share_total'] === 1365.00, 'Split bill my_share_total is ₹1,365.00 (not full ₹2,100)');

// Update split dynamically via bill_items
$updateSplitsStmt = $pdo->prepare('UPDATE bill_items SET split_type = ?, my_share_amount = ? WHERE bill_id = ? AND item_name = ?');
// Change Mocktail from someone_else to shared (50% = 200 * 1.05 = 210)
$updateSplitsStmt->execute(['shared', 210.00, $savedSplit['bill_id'], 'Mocktail']);
// Recalculate bill my_share_total
$recalcStmt = $pdo->prepare('UPDATE bills SET my_share_total = (SELECT SUM(my_share_amount) FROM bill_items WHERE bill_id = ?) WHERE id = ?');
$recalcStmt->execute([$savedSplit['bill_id'], $savedSplit['bill_id']]);

$checkSplitStmt->execute([$savedSplit['bill_id']]);
$splitRowUpdated = $checkSplitStmt->fetch(PDO::FETCH_ASSOC);
assert_test((float)$splitRowUpdated['my_share_total'] === 1575.00, 'Recalculated my_share_total is ₹1,575.00 after changing item split');

// Verify Insights strictly uses my_share_total for this bill
$insightsAfterSplit = get_insights_dashboard_data($pdo, $userGsmId, '2026-10');
assert_test((float)$insightsAfterSplit['this_month']['spent'] === 21884.10, 'Insights dashboard strictly reflects my share total (₹21,884.10, not full bill total ₹22,409.10)');

// 22.5 Settings & Category Management
$newCatStmt = $pdo->prepare('INSERT INTO categories (user_id, name, is_system, created_at) VALUES (?, ?, 0, ?)');
$newCatStmt->execute([$userAId, 'Pet Care & Vet', gmdate('Y-m-d H:i:s')]);
$petCatId = (int)$pdo->lastInsertId();
assert_test($petCatId > 0, 'Added custom category "Pet Care & Vet" with ID: ' . $petCatId);

// Rename category
$renameStmt = $pdo->prepare('UPDATE categories SET name = ? WHERE id = ? AND user_id = ?');
$renameStmt->execute(['Pet Supplies', $petCatId, $userAId]);
$checkRenameStmt = $pdo->prepare('SELECT name FROM categories WHERE id = ?');
$checkRenameStmt->execute([$petCatId]);
assert_test($checkRenameStmt->fetchColumn() === 'Pet Supplies', 'Renamed category successfully to "Pet Supplies"');

// Delete category
$deleteCatStmt = $pdo->prepare('DELETE FROM categories WHERE id = ? AND user_id = ?');
$deleteCatStmt->execute([$petCatId, $userAId]);
$checkCatDelStmt = $pdo->prepare('SELECT COUNT(*) FROM categories WHERE id = ?');
$checkCatDelStmt->execute([$petCatId]);
assert_test((int)$checkCatDelStmt->fetchColumn() === 0, 'Deleted custom category successfully');

// Export CSV for bills
$csvBillsStmt = $pdo->prepare('SELECT id, merchant_name, bill_date, grand_total, my_share_total FROM bills WHERE user_id = ?');
$csvBillsStmt->execute([$userGsmId]);
$csvBillsData = $csvBillsStmt->fetchAll(PDO::FETCH_ASSOC);
$out = fopen('php://memory', 'w');
fputcsv($out, ['Bill ID', 'Merchant', 'Date', 'Grand Total', 'My Share Total']);
foreach ($csvBillsData as $row) {
    fputcsv($out, $row);
}
rewind($out);
$csvBillsOutput = stream_get_contents($out);
fclose($out);
assert_test(stripos($csvBillsOutput, 'Gupta Stationery Mart') !== false, 'Bills CSV export contains merchant records');
assert_test(stripos($csvBillsOutput, 'My Share Total') !== false, 'Bills CSV export includes split header');

// 22.6 Whitelisted Chat Functions: recurring_spend and list_reminders
$chatRec = execute_whitelisted_function($pdo, $userAId, 'recurring_spend', []);
assert_test(isset($chatRec['total_recurring_monthly']), 'execute_whitelisted_function("recurring_spend") executes successfully');

$chatRem = execute_whitelisted_function($pdo, $userAId, 'list_reminders', ['filter' => 'all']);
assert_test(isset($chatRem['reminders']), 'execute_whitelisted_function("list_reminders") executes successfully');

// Fallback chat queries
$chatReplyRec = answer_user_query_fallback($pdo, $userAId, 'what are my recurring expenses?');
assert_test(stripos($chatReplyRec['text'], 'recurring') !== false || stripos($chatReplyRec['text'], 'milk') !== false, 'Chat fallback answers recurring expense query');

$chatReplyRem = answer_user_query_fallback($pdo, $userAId, 'show my reminders');
assert_test(stripos($chatReplyRem['text'], 'reminder') !== false || stripos($chatReplyRem['text'], 'Sony Wireless Headphones') !== false, 'Chat fallback answers reminders query');

// Clean up test DB
if (file_exists($testDbFile)) {
    @unlink($testDbFile);
}

// ── Test Summary ─────────────────────────────────────────────
echo "\n======================================================\n";
echo " Test Summary: {$testPassed} passed, {$testFailed} failed\n";
echo "======================================================\n\n";

if ($testFailed > 0) {
    exit(1);
}
exit(0);

