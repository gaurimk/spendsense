<?php
/**
 * SpendSense - API Dispatcher & Router
 * Dispatches JSON endpoints under /api.
 * Enforces authentication, CSRF checks on mutating requests, and JSON output formatting.
 */

declare(strict_types=1);

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/auth.php';
require_once __DIR__ . '/services/gemini.php';
require_once __DIR__ . '/services/arithmetic.php';
require_once __DIR__ . '/services/duplicate_detection.php';
require_once __DIR__ . '/services/bill_saving.php';
require_once __DIR__ . '/services/upload_validator.php';
require_once __DIR__ . '/services/query_functions.php';
require_once __DIR__ . '/services/chat_ai.php';
require_once __DIR__ . '/services/demo_seeder.php';
require_once __DIR__ . '/services/insights.php';
require_once __DIR__ . '/services/reminders.php';

function handle_api_request(): void {
    $pdo = get_db();
    setup_database($pdo);

    $uri = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

    // Parse JSON request body if present
    $input = [];
    $contentType = $_SERVER['CONTENT_TYPE'] ?? '';
    if (str_contains($contentType, 'application/json')) {
        $raw = file_get_contents('php://input');
        if ($raw !== false && trim($raw) !== '') {
            $input = json_decode($raw, true);
            if (!is_array($input)) {
                json_error('Invalid JSON body provided.', 400, 'INVALID_JSON');
            }
        }
    } else {
        $input = $_POST;
    }

    // ─────────────────────────────────────────────────────────
    // Route matching
    // ─────────────────────────────────────────────────────────

    // 1. Health / Status check
    if ($uri === '/api/health' && $method === 'GET') {
        $keyConfigured = (GEMINI_API_KEY !== '' && GEMINI_API_KEY !== 'your_gemini_api_key_here');
        json_response([
            'status' => 'healthy',
            'app' => 'SpendSense',
            'version' => '1.0.0',
            'php_version' => PHP_VERSION,
            'gemini_configured' => $keyConfigured,
            'gemini_model' => GEMINI_MODEL,
            'timestamp' => gmdate('Y-m-d H:i:s'),
        ]);
    }

    // 2. CSRF Token endpoint
    if ($uri === '/api/csrf' && $method === 'GET') {
        json_response([
            'csrf_token' => get_csrf_token(),
        ]);
    }

    // 3. Auth routes
    if ($uri === '/api/auth/register' && $method === 'POST') {
        $email = (string)($input['email'] ?? '');
        $password = (string)($input['password'] ?? '');
        $fullName = (string)($input['full_name'] ?? '');
        $currency = (string)($input['currency'] ?? 'INR');
        $usageType = (string)($input['usage_type'] ?? 'personal');

        $result = register_user($pdo, $email, $password, $fullName, $currency, $usageType);
        json_response($result, 201);
    }

    if ($uri === '/api/auth/login' && $method === 'POST') {
        $email = (string)($input['email'] ?? '');
        $password = (string)($input['password'] ?? '');

        $result = login_user($pdo, $email, $password);
        json_response($result, 200);
    }

    if ($uri === '/api/auth/logout' && $method === 'POST') {
        require_csrf();
        logout_user();
        json_response(['message' => 'Logged out successfully.']);
    }

    if ($uri === '/api/auth/me' && $method === 'GET') {
        $user = get_current_user_info($pdo);
        if (!$user) {
            json_response(['authenticated' => false, 'csrf_token' => get_csrf_token()]);
        }
        $limitInfo = check_daily_upload_limit($pdo, $user['user']['id']);
        json_response(array_merge(['authenticated' => true], $user, ['upload_limit' => $limitInfo]));
    }

    // 4. Gemini test endpoint
    if ($uri === '/api/gemini/test') {
        try {
            $testResult = test_gemini_connection();
            json_response($testResult);
        } catch (Throwable $e) {
            $statusCode = ($e->getCode() >= 400 && $e->getCode() < 600) ? (int)$e->getCode() : 500;
            json_error($e->getMessage(), $statusCode, 'GEMINI_TEST_FAILED', [
                'model' => GEMINI_MODEL,
                'key_configured' => (GEMINI_API_KEY !== '' && GEMINI_API_KEY !== 'your_gemini_api_key_here'),
            ]);
        }
    }

    // 5. Daily upload limit check
    if ($uri === '/api/user/upload-limit' && $method === 'GET') {
        $userInfo = require_auth($pdo);
        $limitInfo = check_daily_upload_limit($pdo, $userInfo['user']['id']);
        json_response($limitInfo);
    }

    // 6. User categories
    if ($uri === '/api/categories' && $method === 'GET') {
        $userInfo = require_auth($pdo);
        $stmt = $pdo->prepare('SELECT id, name, icon, color, is_system FROM categories WHERE user_id = ? ORDER BY name ASC');
        $stmt->execute([$userInfo['user']['id']]);
        $categories = $stmt->fetchAll();
        json_response(['categories' => $categories]);
    }

    // 7. Chat messages history
    if ($uri === '/api/chat/messages' && $method === 'GET') {
        $userInfo = require_auth($pdo);
        $limit = max(1, min(100, (int)($_GET['limit'] ?? 50)));
        $stmt = $pdo->prepare('
            SELECT id, role, message_text, metadata_json, created_at
            FROM chat_messages
            WHERE user_id = ?
            ORDER BY id ASC
            LIMIT ?
        ');
        $stmt->execute([$userInfo['user']['id'], $limit]);
        $messages = $stmt->fetchAll();
        foreach ($messages as &$msg) {
            if (!empty($msg['metadata_json'])) {
                $msg['metadata'] = json_decode($msg['metadata_json'], true);
            } else {
                $msg['metadata'] = null;
            }
            unset($msg['metadata_json']);
        }
        json_response(['messages' => $messages]);
    }

    // 8. Post new chat message
    if ($uri === '/api/chat/messages' && $method === 'POST') {
        $userInfo = require_auth($pdo);
        require_csrf();

        $role = in_array($input['role'] ?? '', ['user', 'assistant', 'system'], true) ? $input['role'] : 'user';
        $text = trim((string)($input['message_text'] ?? ''));
        $meta = isset($input['metadata']) ? json_encode($input['metadata'], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) : null;

        if ($text === '' && empty($meta)) {
            json_error('Message text or metadata is required.', 400);
        }

        $now = gmdate('Y-m-d H:i:s');
        $stmt = $pdo->prepare('
            INSERT INTO chat_messages (user_id, role, message_text, metadata_json, created_at)
            VALUES (?, ?, ?, ?, ?)
        ');
        $stmt->execute([$userInfo['user']['id'], $role, $text, $meta, $now]);
        $msgId = (int)$pdo->lastInsertId();

        json_response([
            'id' => $msgId,
            'role' => $role,
            'message_text' => $text,
            'metadata' => isset($input['metadata']) ? $input['metadata'] : null,
            'created_at' => $now,
        ], 201);
    }

    // 9. Upload & Parse Bill
    if ($uri === '/api/bills/upload' && $method === 'POST') {
        $userInfo = require_auth($pdo);
        require_csrf();

        $userId = $userInfo['user']['id'];
        $userCurrency = $userInfo['settings']['currency'] ?? 'INR';

        // Check daily upload limit
        $limitCheck = check_daily_upload_limit($pdo, $userId);
        if (!$limitCheck['allowed']) {
            json_error($limitCheck['message'], 429, 'UPLOAD_LIMIT_REACHED', $limitCheck);
        }

        $rawUpload = !empty($_FILES['bill_files']) ? $_FILES['bill_files'] : (!empty($_FILES['bill_file']) ? $_FILES['bill_file'] : null);
        if (empty($rawUpload)) {
            json_error('Please select a bill image (JPG, PNG, WebP) or PDF document to upload.', 400, 'NO_FILE');
        }

        // Validate and save files (supports up to 3 photos for long receipts)
        $savedFiles = handle_uploaded_receipts($rawUpload);
        $primaryFile = $savedFiles[0];

        // Record upload count
        record_upload($pdo, $userId, $primaryFile['file_name'], $primaryFile['file_size']);

        // Call Gemini OCR with all uploaded images
        try {
            $extracted = extract_receipt_with_gemini(
                $savedFiles,
                null,
                $userCurrency
            );
        } catch (Throwable $e) {
            // Delete uploaded files if extraction failed permanently
            foreach ($savedFiles as $sf) {
                @unlink($sf['full_path']);
            }
            $status = ($e->getCode() >= 400 && $e->getCode() < 600) ? (int)$e->getCode() : 500;
            json_error($e->getMessage(), $status, 'GEMINI_EXTRACTION_ERROR');
        }

        // 10. Auto-categorization memory lookup
        $checkMap = $pdo->prepare('
            SELECT category_name FROM item_category_map
            WHERE user_id = ? AND item_name_normalized = ?
            LIMIT 1
        ');
        if (!empty($extracted['line_items']) && is_array($extracted['line_items'])) {
            foreach ($extracted['line_items'] as &$item) {
                $norm = strtolower(trim((string)($item['name'] ?? '')));
                if ($norm !== '') {
                    $checkMap->execute([$userId, $norm]);
                    $learnedCat = $checkMap->fetchColumn();
                    if ($learnedCat) {
                        $item['category'] = $learnedCat;
                        $item['category_confidence'] = 'high';
                        $item['learned'] = true;
                    } elseif (preg_match('/\b(paper|a4|copier|pen|pens|ballpen|ballpoint|gelpen|notebook|notebooks|register|registers|stapler|staplers|staples|pencil|pencils|notepad|notepads|diary|diaries|marker|markers|highlighter|folder|folders|file|files|stationery)\b/i', $norm)) {
                        $item['category'] = 'Stationery & Office';
                        $item['category_confidence'] = 'high';
                    }
                }
            }
            unset($item);
        }

        // 11. Run Arithmetic checks
        $confScores = [
            'merchant_name' => $extracted['merchant_name_confidence'] ?? 'high',
            'bill_number' => $extracted['bill_number_confidence'] ?? 'high',
            'bill_date' => $extracted['bill_date_confidence'] ?? 'high',
            'payment_method' => $extracted['payment_method_confidence'] ?? 'high',
            'grand_total' => $extracted['grand_total_confidence'] ?? 'high',
        ];
        $arithmeticWarnings = validate_bill_arithmetic(
            $extracted['line_items'] ?? [],
            isset($extracted['subtotal']) ? (float)$extracted['subtotal'] : null,
            isset($extracted['tax_amount']) ? (float)$extracted['tax_amount'] : null,
            isset($extracted['discount_amount']) ? (float)$extracted['discount_amount'] : null,
            (float)($extracted['grand_total'] ?? 0.0),
            $confScores
        );

        // 12. Duplicate detection check
        $dupCheck = check_duplicate_bill(
            $pdo,
            $userId,
            (string)($extracted['merchant_name'] ?? ''),
            (string)($extracted['bill_date'] ?? ''),
            (float)($extracted['grand_total'] ?? 0.0),
            isset($extracted['bill_number']) ? (string)$extracted['bill_number'] : null
        );

        $warnings = $arithmeticWarnings;
        if ($dupCheck !== null) {
            array_unshift($warnings, [
                'type' => 'duplicate',
                'code' => 'DUPLICATE_BILL_DETECTED',
                'message' => $dupCheck['message'],
                'field' => 'merchant_name',
                'duplicate' => $dupCheck,
            ]);
        }

        // Response with draft data, warnings, file metadata
        $draftBill = array_merge($extracted, [
            'file_name' => $primaryFile['file_name'],
            'file_path' => $primaryFile['file_path'],
            'file_type' => $primaryFile['mime_type'],
            'all_files' => array_map(fn($f) => [
                'file_name' => $f['file_name'],
                'file_path' => $f['file_path']
            ], $savedFiles),
            'warnings' => $warnings,
            'is_draft' => true,
        ]);

        json_response([
            'success' => true,
            'draft' => $draftBill,
            'remaining_uploads' => max(0, $limitCheck['remaining'] - 1),
        ]);
    }

    // 13. Confirm and Save Bill
    if ($uri === '/api/bills/confirm' && $method === 'POST') {
        $userInfo = require_auth($pdo);
        require_csrf();

        $userId = $userInfo['user']['id'];
        $confirmedData = $input['bill_data'] ?? null;
        $originalGemini = $input['original_gemini'] ?? null;

        if (!is_array($confirmedData)) {
            json_error('Invalid or missing bill data for confirmation.', 400);
        }

        $saveResult = save_confirmed_bill($pdo, $userId, $confirmedData, $originalGemini);

        // Record assistant insight in chat
        $now = gmdate('Y-m-d H:i:s');
        $chatStmt = $pdo->prepare('
            INSERT INTO chat_messages (user_id, role, message_text, metadata_json, created_at)
            VALUES (?, \'assistant\', ?, ?, ?)
        ');
        $metaJson = json_encode([
            'type' => 'bill_confirmed',
            'bill_id' => $saveResult['bill_id'],
            'merchant_name' => $saveResult['merchant_name'],
            'grand_total' => $saveResult['grand_total'],
        ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        $chatStmt->execute([$userId, $saveResult['insight'], $metaJson, $now]);

        json_response([
            'success' => true,
            'bill_id' => $saveResult['bill_id'],
            'insight' => $saveResult['insight'],
            'merchant_name' => $saveResult['merchant_name'],
            'grand_total' => $saveResult['grand_total'],
        ]);
    }

    // 14. Discard Draft Bill
    if ($uri === '/api/bills/discard' && $method === 'POST') {
        $userInfo = require_auth($pdo);
        require_csrf();

        $fileName = basename((string)($input['file_name'] ?? ''));
        if ($fileName !== '') {
            $filePath = UPLOADS_DIR . '/' . $fileName;
            // Only delete if it's an unconfirmed draft
            $checkSaved = $pdo->prepare('SELECT id FROM bills WHERE file_name = ? AND user_id = ?');
            $checkSaved->execute([$fileName, $userInfo['user']['id']]);
            if (!$checkSaved->fetch() && file_exists($filePath)) {
                @unlink($filePath);
            }
        }

        json_response(['success' => true, 'message' => 'Draft discarded.']);
    }

    // 15. Chat with Data (Gemini Function Calling)
    if ($uri === '/api/chat/ask' && $method === 'POST') {
        $userInfo = require_auth($pdo);
        require_csrf();

        $userId = $userInfo['user']['id'];
        $currency = $userInfo['settings']['currency'] ?? 'INR';
        $question = trim((string)($input['question'] ?? ''));

        if ($question === '') {
            json_error('Please enter a question to ask.', 400);
        }

        $now = gmdate('Y-m-d H:i:s');

        // Save user message to chat history
        $userMsgStmt = $pdo->prepare('
            INSERT INTO chat_messages (user_id, role, message_text, metadata_json, created_at)
            VALUES (?, \'user\', ?, NULL, ?)
        ');
        $userMsgStmt->execute([$userId, $question, $now]);

        // Process query with Gemini Function Calling (or fallback)
        $aiResult = answer_user_query_with_gemini($pdo, $userId, $question, $currency);

        // Save assistant response to chat history
        $metaJson = !empty($aiResult['visualization']) 
            ? json_encode(['visualization' => $aiResult['visualization']], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) 
            : null;

        $assistantMsgStmt = $pdo->prepare('
            INSERT INTO chat_messages (user_id, role, message_text, metadata_json, created_at)
            VALUES (?, \'assistant\', ?, ?, ?)
        ');
        $assistantMsgStmt->execute([$userId, $aiResult['text'], $metaJson, $now]);
        $msgId = (int)$pdo->lastInsertId();

        json_response([
            'success' => true,
            'message_id' => $msgId,
            'answer' => $aiResult['text'],
            'visualization' => $aiResult['visualization'] ?? null,
            'function_called' => $aiResult['function_called'] ?? null,
        ]);
    }

    // 16. Seed Demo Data (~40 realistic bills across 3 months)
    if ($uri === '/api/demo/seed' && $method === 'POST') {
        $userInfo = require_auth($pdo);
        require_csrf();

        $userId = $userInfo['user']['id'];
        $seedResult = seed_demo_data($pdo, $userId);
        json_response($seedResult);
    }

    // 17. Insights Dashboard Summary
    if ($uri === '/api/insights/summary' && $method === 'GET') {
        $userInfo = require_auth($pdo);
        $insights = get_insights_dashboard_data($pdo, $userInfo['user']['id']);
        json_response($insights);
    }

    // 18. Searchable & Filterable Bills List
    if ($uri === '/api/bills' && $method === 'GET') {
        $userInfo = require_auth($pdo);
        $userId = $userInfo['user']['id'];

        $search = trim((string)($_GET['search'] ?? ''));
        $category = trim((string)($_GET['category'] ?? ''));
        $startDate = trim((string)($_GET['start_date'] ?? ''));
        $endDate = trim((string)($_GET['end_date'] ?? ''));
        $minAmount = isset($_GET['min_amount']) && $_GET['min_amount'] !== '' ? (float)$_GET['min_amount'] : null;
        $maxAmount = isset($_GET['max_amount']) && $_GET['max_amount'] !== '' ? (float)$_GET['max_amount'] : null;
        $limit = max(1, min(100, (int)($_GET['limit'] ?? 50)));
        $offset = max(0, (int)($_GET['offset'] ?? 0));

        $where = ["b.user_id = ?", "b.status != 'discarded'"];
        $params = [$userId];

        if ($search !== '') {
            $where[] = "(LOWER(b.merchant_name) LIKE ? OR LOWER(b.bill_number) LIKE ?)";
            $params[] = '%' . strtolower($search) . '%';
            $params[] = '%' . strtolower($search) . '%';
        }

        if ($startDate !== '') {
            $where[] = "b.bill_date >= ?";
            $params[] = $startDate;
        }

        if ($endDate !== '') {
            $where[] = "b.bill_date <= ?";
            $params[] = $endDate;
        }

        if ($minAmount !== null) {
            $where[] = "b.grand_total >= ?";
            $params[] = $minAmount;
        }

        if ($maxAmount !== null) {
            $where[] = "b.grand_total <= ?";
            $params[] = $maxAmount;
        }

        $join = "";
        if ($category !== '') {
            $join = "JOIN bill_items bi ON bi.bill_id = b.id";
            $where[] = "LOWER(bi.category_name) = ?";
            $params[] = strtolower($category);
        }

        $whereSql = implode(' AND ', $where);

        // Count total matching
        $countStmt = $pdo->prepare("SELECT COUNT(DISTINCT b.id) FROM bills b {$join} WHERE {$whereSql}");
        $countStmt->execute($params);
        $totalCount = (int)$countStmt->fetchColumn();

        // Fetch bills
        $sql = "
            SELECT DISTINCT
                b.id,
                b.merchant_name,
                b.merchant_type,
                b.bill_number,
                b.bill_date,
                b.bill_time,
                b.payment_method,
                b.file_name,
                b.file_path,
                ROUND(b.subtotal, 2) AS subtotal,
                ROUND(b.tax_amount, 2) AS tax_amount,
                ROUND(b.discount_amount, 2) AS discount_amount,
                ROUND(b.grand_total, 2) AS grand_total,
                (SELECT COUNT(*) FROM bill_items WHERE bill_id = b.id) AS item_count,
                (SELECT GROUP_CONCAT(DISTINCT category_name) FROM bill_items WHERE bill_id = b.id) AS categories_summary
            FROM bills b
            {$join}
            WHERE {$whereSql}
            ORDER BY b.bill_date DESC, b.id DESC
            LIMIT ? OFFSET ?
        ";
        $fetchParams = array_merge($params, [$limit, $offset]);
        $stmt = $pdo->prepare($sql);
        $stmt->execute($fetchParams);
        $bills = $stmt->fetchAll();

        json_response([
            'bills' => $bills,
            'total_count' => $totalCount,
            'limit' => $limit,
            'offset' => $offset,
        ]);
    }

    // 19. Bill Details with Line Items
    if ($uri === '/api/bills/detail' && $method === 'GET') {
        $userInfo = require_auth($pdo);
        $userId = $userInfo['user']['id'];
        $billId = (int)($_GET['id'] ?? 0);

        $stmt = $pdo->prepare("SELECT * FROM bills WHERE id = ? AND user_id = ?");
        $stmt->execute([$billId, $userId]);
        $bill = $stmt->fetch();
        if (!$bill) {
            json_error('Bill not found or access denied.', 404);
        }

        $itemStmt = $pdo->prepare("
            SELECT id, item_name, category_name, quantity, unit, unit_price, tax_percent, line_total, split_type, my_share_amount, confidence
            FROM bill_items
            WHERE bill_id = ? AND user_id = ?
            ORDER BY id ASC
        ");
        $itemStmt->execute([$billId, $userId]);
        $items = $itemStmt->fetchAll();

        json_response([
            'bill' => $bill,
            'items' => $items,
        ]);
    }

    // 20. Delete Bill
    if ($uri === '/api/bills/delete' && $method === 'POST') {
        $userInfo = require_auth($pdo);
        require_csrf();

        $userId = $userInfo['user']['id'];
        $billId = (int)($input['bill_id'] ?? 0);

        // Verify ownership and get file name
        $stmt = $pdo->prepare("SELECT id, file_name, file_path FROM bills WHERE id = ? AND user_id = ?");
        $stmt->execute([$billId, $userId]);
        $bill = $stmt->fetch();
        if (!$bill) {
            json_error('Bill not found or you do not have permission to delete it.', 404);
        }

        // Delete uploaded file if present
        if (!empty($bill['file_name'])) {
            $filePath = UPLOADS_DIR . '/' . basename($bill['file_name']);
            if (file_exists($filePath)) {
                @unlink($filePath);
            }
        }

        // Delete from database (bill_items will be deleted automatically via ON DELETE CASCADE)
        $delStmt = $pdo->prepare("DELETE FROM bills WHERE id = ? AND user_id = ?");
        $delStmt->execute([$billId, $userId]);

        json_response(['success' => true, 'message' => 'Bill deleted successfully.']);
    }

    // 21. Get Budgets Status
    if ($uri === '/api/budgets' && $method === 'GET') {
        $userInfo = require_auth($pdo);
        $month = $_GET['month'] ?? null;
        $status = query_budget_status($pdo, $userInfo['user']['id'], $month);
        
        $catStmt = $pdo->prepare('SELECT id, name, icon, color FROM categories WHERE user_id = ? ORDER BY name ASC');
        $catStmt->execute([$userInfo['user']['id']]);
        $status['all_categories'] = $catStmt->fetchAll();

        json_response($status);
    }

    // 22. Set / Update Category Budget
    if ($uri === '/api/budgets' && $method === 'POST') {
        $userInfo = require_auth($pdo);
        require_csrf();

        $userId = $userInfo['user']['id'];
        $categoryId = (int)($input['category_id'] ?? 0);
        $amount = (float)($input['monthly_amount'] ?? 0);
        $month = trim((string)($input['month'] ?? ''));

        if ($month === '') {
            $month = gmdate('Y-m');
        }

        if ($categoryId <= 0 || $amount < 0) {
            json_error('Valid category and non-negative budget amount are required.', 400);
        }

        $now = gmdate('Y-m-d H:i:s');
        $stmt = $pdo->prepare("
            INSERT INTO budgets (user_id, category_id, monthly_amount, month, created_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(user_id, category_id, month) DO UPDATE SET
                monthly_amount = excluded.monthly_amount
        ");
        $stmt->execute([$userId, $categoryId, $amount, $month, $now]);

        json_response([
            'success' => true,
            'message' => 'Budget saved successfully.',
            'category_id' => $categoryId,
            'monthly_amount' => $amount,
            'month' => $month,
        ]);
    }

    // 23. Price Tracker - Tracked Items List
    if ($uri === '/api/price-tracker/items' && $method === 'GET') {
        $userInfo = require_auth($pdo);
        $userId = $userInfo['user']['id'];
        $stmt = $pdo->prepare("
            SELECT 
                LOWER(bi.item_name) AS norm_name,
                MAX(bi.item_name) AS item_name,
                MAX(bi.category_name) AS category_name,
                COUNT(DISTINCT bi.bill_id) AS purchase_count,
                ROUND(MIN(bi.unit_price), 2) AS min_price,
                ROUND(MAX(bi.unit_price), 2) AS max_price,
                ROUND(AVG(bi.unit_price), 2) AS avg_price,
                MAX(b.bill_date) AS latest_date
            FROM bill_items bi
            JOIN bills b ON bi.bill_id = b.id
            WHERE bi.user_id = ? AND b.status != 'discarded' AND bi.unit_price > 0
            GROUP BY LOWER(bi.item_name)
            ORDER BY purchase_count DESC, item_name ASC
        ");
        $stmt->execute([$userId]);
        $items = $stmt->fetchAll();
        json_response(['items' => $items]);
    }

    // 24. Price Tracker - Single Item History & Comparison
    if ($uri === '/api/price-tracker/history' && $method === 'GET') {
        $userInfo = require_auth($pdo);
        $item = trim((string)($_GET['item'] ?? ''));
        if ($item === '') {
            json_error('Item name query parameter is required.', 400);
        }
        $result = query_price_history($pdo, $userInfo['user']['id'], $item);
        json_response($result);
    }

    // 25. Reminders - List Reminders
    if ($uri === '/api/reminders' && $method === 'GET') {
        $userInfo = require_auth($pdo);
        $filter = $_GET['filter'] ?? null;
        $res = query_list_reminders($pdo, $userInfo['user']['id'], $filter);
        json_response($res);
    }

    // 26. Reminders - Due Soon / Overdue Alerts
    if ($uri === '/api/reminders/due' && $method === 'GET') {
        $userInfo = require_auth($pdo);
        $days = isset($_GET['days']) ? (int)$_GET['days'] : 7;
        $due = get_due_reminders($pdo, $userInfo['user']['id'], $days);
        json_response(['due_reminders' => $due, 'count' => count($due)]);
    }

    // 27. Reminders - Create Reminder
    if ($uri === '/api/reminders' && $method === 'POST') {
        $userInfo = require_auth($pdo);
        require_csrf();
        $remId = add_reminder($pdo, $userInfo['user']['id'], $input);
        json_response(['success' => true, 'id' => $remId, 'message' => 'Reminder created successfully.'], 201);
    }

    // 28. Reminders - Update Reminder
    if (($uri === '/api/reminders/update') && ($method === 'PUT' || $method === 'POST')) {
        $userInfo = require_auth($pdo);
        require_csrf();
        $id = (int)($input['id'] ?? 0);
        update_reminder($pdo, $userInfo['user']['id'], $id, $input);
        json_response(['success' => true, 'message' => 'Reminder updated successfully.']);
    }

    // 29. Reminders - Toggle Status
    if ($uri === '/api/reminders/toggle' && $method === 'POST') {
        $userInfo = require_auth($pdo);
        require_csrf();
        $id = (int)($input['id'] ?? 0);
        $isCompleted = isset($input['is_completed']) ? (bool)$input['is_completed'] : null;
        toggle_reminder($pdo, $userInfo['user']['id'], $id, $isCompleted);
        json_response(['success' => true, 'message' => 'Reminder status toggled.']);
    }

    // 30. Reminders - Delete Reminder
    if (($uri === '/api/reminders/delete') && ($method === 'POST' || $method === 'DELETE')) {
        $userInfo = require_auth($pdo);
        require_csrf();
        $id = (int)($input['id'] ?? ($_GET['id'] ?? 0));
        delete_reminder($pdo, $userInfo['user']['id'], $id);
        json_response(['success' => true, 'message' => 'Reminder deleted successfully.']);
    }

    // 31. Recurring Spend Analytics
    if ($uri === '/api/recurring-spend' && $method === 'GET') {
        $userInfo = require_auth($pdo);
        $res = query_recurring_spend($pdo, $userInfo['user']['id']);
        json_response($res);
    }

    // 32. Split Bill - Update Item Split Shares
    if ($uri === '/api/bills/update-split' && $method === 'POST') {
        $userInfo = require_auth($pdo);
        require_csrf();
        $userId = $userInfo['user']['id'];
        $billId = (int)($input['bill_id'] ?? 0);
        $splits = (array)($input['splits'] ?? []);

        // Verify ownership
        $chk = $pdo->prepare("SELECT id, grand_total FROM bills WHERE id = ? AND user_id = ?");
        $chk->execute([$billId, $userId]);
        $billRow = $chk->fetch();
        if (!$billRow) {
            json_error('Bill not found or access denied.', 404);
        }

        $updItem = $pdo->prepare("
            UPDATE bill_items 
            SET split_type = ?, my_share_amount = ? 
            WHERE id = ? AND bill_id = ? AND user_id = ?
        ");

        $getItem = $pdo->prepare("SELECT line_total FROM bill_items WHERE id = ? AND bill_id = ? AND user_id = ?");

        foreach ($splits as $sp) {
            $itemId = (int)($sp['item_id'] ?? 0);
            $splitType = (string)($sp['split_type'] ?? 'mine');
            $getItem->execute([$itemId, $billId, $userId]);
            $lt = (float)$getItem->fetchColumn();

            if ($splitType === 'someone_else') {
                $share = 0.0;
            } elseif ($splitType === 'shared') {
                $customShare = isset($sp['my_share_amount']) ? (float)$sp['my_share_amount'] : round($lt / 2.0, 2);
                $share = max(0.0, min($lt, $customShare));
            } else {
                $splitType = 'mine';
                $share = $lt;
            }

            $updItem->execute([$splitType, $share, $itemId, $billId, $userId]);
        }

        // Recalculate bill total my_share
        $calc = $pdo->prepare("
            SELECT ROUND(COALESCE(SUM(COALESCE(my_share_amount, line_total)), 0), 2) 
            FROM bill_items 
            WHERE bill_id = ? AND user_id = ?
        ");
        $calc->execute([$billId, $userId]);
        $myTotalShare = (float)$calc->fetchColumn();

        $updBill = $pdo->prepare("UPDATE bills SET my_share_total = ? WHERE id = ? AND user_id = ?");
        $updBill->execute([$myTotalShare, $billId, $userId]);

        json_response([
            'success' => true,
            'message' => 'Bill split updated successfully.',
            'bill_id' => $billId,
            'grand_total' => (float)$billRow['grand_total'],
            'my_share_total' => $myTotalShare,
        ]);
    }

    // 33. Categories List
    if ($uri === '/api/categories' && $method === 'GET') {
        $userInfo = require_auth($pdo);
        $userId = $userInfo['user']['id'];
        $stmt = $pdo->prepare("
            SELECT 
                c.id, c.name, c.icon, c.color, c.is_system,
                COUNT(bi.id) AS item_count,
                ROUND(COALESCE(SUM(bi.line_total), 0), 2) AS total_spent
            FROM categories c
            LEFT JOIN bill_items bi ON bi.category_id = c.id
            WHERE c.user_id = ?
            GROUP BY c.id
            ORDER BY c.name ASC
        ");
        $stmt->execute([$userId]);
        json_response(['categories' => $stmt->fetchAll()]);
    }

    // 34. Add Custom Category
    if ($uri === '/api/categories/add' && $method === 'POST') {
        $userInfo = require_auth($pdo);
        require_csrf();
        $userId = $userInfo['user']['id'];
        $name = trim((string)($input['name'] ?? ''));
        $icon = trim((string)($input['icon'] ?? 'tag'));
        $color = trim((string)($input['color'] ?? '#6366f1'));
        if ($name === '') {
            json_error('Category name cannot be empty.', 400);
        }

        $chk = $pdo->prepare("SELECT id FROM categories WHERE user_id = ? AND LOWER(name) = LOWER(?)");
        $chk->execute([$userId, $name]);
        if ($chk->fetch()) {
            json_error("Category '{$name}' already exists.", 409);
        }

        $now = gmdate('Y-m-d H:i:s');
        $ins = $pdo->prepare("INSERT INTO categories (user_id, name, icon, color, is_system, created_at) VALUES (?, ?, ?, ?, 0, ?)");
        $ins->execute([$userId, $name, $icon, $color, $now]);
        json_response(['success' => true, 'id' => (int)$pdo->lastInsertId(), 'name' => $name], 201);
    }

    // 35. Rename Category
    if ($uri === '/api/categories/rename' && $method === 'POST') {
        $userInfo = require_auth($pdo);
        require_csrf();
        $userId = $userInfo['user']['id'];
        $catId = (int)($input['category_id'] ?? 0);
        $newName = trim((string)($input['new_name'] ?? ''));
        if ($newName === '' || $catId <= 0) {
            json_error('Valid category ID and new name are required.', 400);
        }

        $upd = $pdo->prepare("UPDATE categories SET name = ? WHERE id = ? AND user_id = ?");
        $upd->execute([$newName, $catId, $userId]);

        $updItems = $pdo->prepare("UPDATE bill_items SET category_name = ? WHERE category_id = ? AND user_id = ?");
        $updItems->execute([$newName, $catId, $userId]);

        json_response(['success' => true, 'message' => "Category renamed to '{$newName}'."]);
    }

    // 36. Delete Category
    if ($uri === '/api/categories/delete' && $method === 'POST') {
        $userInfo = require_auth($pdo);
        require_csrf();
        $userId = $userInfo['user']['id'];
        $catId = (int)($input['category_id'] ?? 0);
        $reassignId = !empty($input['reassign_to_id']) ? (int)$input['reassign_to_id'] : null;

        if ($reassignId && $reassignId !== $catId) {
            $findName = $pdo->prepare("SELECT name FROM categories WHERE id = ? AND user_id = ?");
            $findName->execute([$reassignId, $userId]);
            $reassignName = $findName->fetchColumn() ?: 'General & Miscellaneous';

            $reassign = $pdo->prepare("UPDATE bill_items SET category_id = ?, category_name = ? WHERE category_id = ? AND user_id = ?");
            $reassign->execute([$reassignId, $reassignName, $catId, $userId]);
        }

        $del = $pdo->prepare("DELETE FROM categories WHERE id = ? AND user_id = ?");
        $del->execute([$catId, $userId]);
        json_response(['success' => true, 'message' => 'Category deleted.']);
    }

    // 37. Export User Data to CSV
    if ($uri === '/api/export/csv' && $method === 'GET') {
        $userInfo = require_auth($pdo);
        $userId = $userInfo['user']['id'];
        $type = $_GET['type'] ?? 'bills';
        $todayStr = gmdate('Y-m-d');

        if ($type === 'items') {
            header('Content-Type: text/csv; charset=UTF-8');
            header("Content-Disposition: attachment; filename=\"spendsense_items_{$todayStr}.csv\"");
            $out = fopen('php://output', 'w');
            fputcsv($out, ['Item ID', 'Bill ID', 'Bill Date', 'Merchant', 'Item Name', 'Category', 'Quantity', 'Unit', 'Unit Price', 'Tax %', 'Line Total', 'Split Type', 'My Share Amount']);
            $stmt = $pdo->prepare("
                SELECT bi.id, bi.bill_id, b.bill_date, b.merchant_name, bi.item_name, bi.category_name,
                       bi.quantity, bi.unit, bi.unit_price, bi.tax_percent, bi.line_total,
                       COALESCE(bi.split_type, 'mine') AS split_type,
                       COALESCE(bi.my_share_amount, bi.line_total) AS my_share_amount
                FROM bill_items bi
                JOIN bills b ON bi.bill_id = b.id
                WHERE bi.user_id = ? AND b.status != 'discarded'
                ORDER BY b.bill_date DESC, bi.id ASC
            ");
            $stmt->execute([$userId]);
            while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
                fputcsv($out, $row);
            }
            fclose($out);
            exit;
        } else {
            header('Content-Type: text/csv; charset=UTF-8');
            header("Content-Disposition: attachment; filename=\"spendsense_bills_{$todayStr}.csv\"");
            $out = fopen('php://output', 'w');
            fputcsv($out, ['Bill ID', 'Date', 'Merchant', 'Merchant Type', 'Bill Number', 'Payment Method', 'Subtotal', 'Tax Amount', 'Discount', 'Grand Total', 'My Share Total', 'Document Type', 'Notes']);
            $stmt = $pdo->prepare("
                SELECT id, bill_date, merchant_name, merchant_type, bill_number, payment_method,
                       subtotal, tax_amount, discount_amount, grand_total,
                       COALESCE(my_share_total, grand_total) AS my_share_total,
                       document_type, notes
                FROM bills
                WHERE user_id = ? AND status != 'discarded'
                ORDER BY bill_date DESC, id DESC
            ");
            $stmt->execute([$userId]);
            while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
                fputcsv($out, $row);
            }
            fclose($out);
            exit;
        }
    }

    // 38. Delete All My Data (Strict Confirmation)
    if ($uri === '/api/account/delete-all-data' && $method === 'POST') {
        $userInfo = require_auth($pdo);
        require_csrf();
        $userId = $userInfo['user']['id'];
        if (empty($input['confirm']) || $input['confirm'] !== true) {
            json_error('Confirmation flag is required to delete all data.', 400);
        }

        $pdo->beginTransaction();
        try {
            // Delete uploaded files
            $fStmt = $pdo->prepare("SELECT file_name FROM bills WHERE user_id = ?");
            $fStmt->execute([$userId]);
            foreach ($fStmt->fetchAll(PDO::FETCH_COLUMN) as $fn) {
                if (!empty($fn)) {
                    $p = UPLOADS_DIR . '/' . basename($fn);
                    if (file_exists($p)) @unlink($p);
                }
            }

            // Cascade delete user tables
            $pdo->prepare("DELETE FROM bills WHERE user_id = ?")->execute([$userId]);
            $pdo->prepare("DELETE FROM reminders WHERE user_id = ?")->execute([$userId]);
            $pdo->prepare("DELETE FROM budgets WHERE user_id = ?")->execute([$userId]);
            $pdo->prepare("DELETE FROM chat_messages WHERE user_id = ?")->execute([$userId]);
            $pdo->prepare("DELETE FROM accuracy_logs WHERE user_id = ?")->execute([$userId]);
            $pdo->prepare("DELETE FROM upload_log WHERE user_id = ?")->execute([$userId]);
            $pdo->prepare("DELETE FROM item_category_map WHERE user_id = ?")->execute([$userId]);

            // Reset categories to system defaults
            $pdo->prepare("DELETE FROM categories WHERE user_id = ?")->execute([$userId]);
            seed_default_categories($pdo, $userId);

            $pdo->commit();
        } catch (Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }

        json_response([
            'success' => true,
            'message' => 'All spending data, bills, receipts, budgets, and reminders have been permanently deleted.',
        ]);
    }

    // Unmatched API route
    json_error("Endpoint '{$uri}' not found.", 404, 'NOT_FOUND');
}
