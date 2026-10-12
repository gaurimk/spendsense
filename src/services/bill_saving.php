<?php
/**
 * SpendSense - Bill Saving, Post-Save Insights & Accuracy Logging
 * Handles saving confirmed bills, tracking user corrections, learning categories,
 * and computing real-data insights.
 */

declare(strict_types=1);

require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/reminders.php';

/**
 * Checks if the user has reached their daily bill upload limit.
 */
function check_daily_upload_limit(PDO $pdo, int $userId): array {
    $today = gmdate('Y-m-d');
    
    // Get user's custom limit or system default
    $settStmt = $pdo->prepare('SELECT daily_upload_limit FROM settings WHERE user_id = ?');
    $settStmt->execute([$userId]);
    $userLimit = (int)($settStmt->fetchColumn() ?: DAILY_UPLOAD_LIMIT);

    $countStmt = $pdo->prepare('SELECT COUNT(*) FROM upload_log WHERE user_id = ? AND upload_date = ?');
    $countStmt->execute([$userId, $today]);
    $currentCount = (int)$countStmt->fetchColumn();

    $allowed = $currentCount < $userLimit;
    $remaining = max(0, $userLimit - $currentCount);

    return [
        'allowed' => $allowed,
        'count' => $currentCount,
        'limit' => $userLimit,
        'remaining' => $remaining,
        'message' => $allowed 
            ? null 
            : "You have reached your daily limit of {$userLimit} bill uploads. You can still chat with your data, enter expenses manually, or upload more bills tomorrow.",
    ];
}

/**
 * Records an upload event in the upload_log.
 */
function record_upload(PDO $pdo, int $userId, string $fileName, int $fileSize): void {
    $today = gmdate('Y-m-d');
    $now = gmdate('Y-m-d H:i:s');
    $stmt = $pdo->prepare('
        INSERT INTO upload_log (user_id, file_name, file_size, upload_date, created_at)
        VALUES (?, ?, ?, ?, ?)
    ');
    $stmt->execute([$userId, $fileName, $fileSize, $today, $now]);
}

/**
 * Helper to compute ordinal numbers (1st, 2nd, 3rd, 4th, etc.)
 */
function get_ordinal_suffix(int $number): string {
    $ends = ['th','st','nd','rd','th','th','th','th','th','th'];
    if ((($number % 100) >= 11) && (($number % 100) <= 13)) {
        return $number . 'th';
    }
    return $number . $ends[$number % 10];
}

/**
 * Generates an insight based on the newly saved bill.
 */
function generate_post_save_insight(
    PDO $pdo,
    int $userId,
    int $billId,
    string $merchantName,
    string $billDate,
    float $grandTotal,
    array $itemsByCategory
): string {
    // 1. Calculate count of trips to this merchant in this month
    $monthPrefix = substr($billDate, 0, 7); // 'YYYY-MM'
    $tripStmt = $pdo->prepare('
        SELECT COUNT(*) FROM bills
        WHERE user_id = ? 
          AND LOWER(merchant_name) = LOWER(?)
          AND bill_date LIKE ?
          AND status = \'confirmed\'
    ');
    $tripStmt->execute([$userId, trim($merchantName), "{$monthPrefix}%"]);
    $tripCount = (int)$tripStmt->fetchColumn();
    $tripPhrase = get_ordinal_suffix(max(1, $tripCount));

    // 2. Calculate category share
    $topCategory = '';
    $topCatTotal = 0.0;
    foreach ($itemsByCategory as $catName => $catItems) {
        $catSum = 0.0;
        foreach ($catItems as $it) {
            $catSum += (float)($it['line_total'] ?? 0.0);
        }
        if ($catSum > $topCatTotal) {
            $topCatTotal = $catSum;
            $topCategory = $catName;
        }
    }

    $insightParts = [];
    $merchantDisplay = htmlspecialchars($merchantName, ENT_QUOTES);

    if ($tripCount > 1) {
        $insightParts[] = "This is your {$tripPhrase} trip to {$merchantDisplay} this month.";
    } else {
        $insightParts[] = "Saved bill from {$merchantDisplay}.";
    }

    if ($grandTotal > 0 && $topCatTotal > 0 && $topCategory !== '') {
        $pct = round(($topCatTotal / $grandTotal) * 100);
        if ($pct >= 99) {
            $insightParts[] = "All 100% of this bill is in {$topCategory}.";
        } else {
            $insightParts[] = "{$topCategory} makes up {$pct}% of this bill.";
        }
    }

    // 3. Check if any category on this bill crossed budget thresholds (80% or 100%)
    $monthClean = substr($billDate, 0, 7);
    $bgtStmt = $pdo->prepare('
        SELECT b.monthly_amount, c.name AS category_name, c.id AS category_id
        FROM budgets b
        JOIN categories c ON b.category_id = c.id
        WHERE b.user_id = ? AND (b.month = ? OR b.month = \'default\')
    ');
    $bgtStmt->execute([$userId, $monthClean]);
    $userBudgets = $bgtStmt->fetchAll();

    if (!empty($userBudgets)) {
        $startDate = $monthClean . '-01';
        $endDate = $monthClean . '-31';
        $spentStmt = $pdo->prepare('
            SELECT bi.category_id, ROUND(SUM(bi.line_total), 2) AS cat_spent
            FROM bill_items bi
            JOIN bills b ON bi.bill_id = b.id
            WHERE bi.user_id = ? AND b.bill_date BETWEEN ? AND ? AND b.status != \'discarded\'
            GROUP BY bi.category_id
        ');
        $spentStmt->execute([$userId, $startDate, $endDate]);
        $catSpentMap = [];
        foreach ($spentStmt->fetchAll() as $row) {
            $catSpentMap[(int)$row['category_id']] = (float)$row['cat_spent'];
        }

        foreach ($userBudgets as $bgt) {
            $catId = (int)$bgt['category_id'];
            if (isset($catSpentMap[$catId])) {
                $spent = $catSpentMap[$catId];
                $limit = (float)$bgt['monthly_amount'];
                if ($limit > 0) {
                    $bgtPct = round(($spent / $limit) * 100);
                    if ($bgtPct >= 100) {
                        $insightParts[] = "⚠️ Budget Alert: {$bgt['category_name']} has exceeded your monthly budget ({$bgtPct}% used: ₹{$spent} vs limit ₹{$limit})!";
                        break;
                    } elseif ($bgtPct >= 80) {
                        $insightParts[] = "⚠️ Budget Notice: {$bgt['category_name']} has reached {$bgtPct}% of your monthly limit (₹{$spent} of ₹{$limit}).";
                        break;
                    }
                }
            }
        }
    }

    return implode(' ', $insightParts);
}

/**
 * Saves a confirmed bill and its items into the database.
 * Computes accuracy log vs original Gemini extraction,
 * learns item categories into item_category_map,
 * and returns the bill ID and post-save insight.
 */
function save_confirmed_bill(
    PDO $pdo,
    int $userId,
    array $confirmedData,
    ?array $originalGeminiData = null
): array {
    $now = gmdate('Y-m-d H:i:s');

    $merchantName = trim((string)($confirmedData['merchant_name'] ?? 'Unknown Merchant'));
    $merchantType = (string)($confirmedData['merchant_type'] ?? 'other');
    $billNumber = !empty($confirmedData['bill_number']) ? trim((string)$confirmedData['bill_number']) : null;
    $billDate = trim((string)($confirmedData['bill_date'] ?? gmdate('Y-m-d')));
    $billTime = !empty($confirmedData['bill_time']) ? trim((string)$confirmedData['bill_time']) : null;
    $rawPayment = $confirmedData['payment_method'] ?? null;
    $paymentMethod = (!empty($rawPayment) && trim((string)$rawPayment) !== '') ? trim((string)$rawPayment) : null;
    $filePath = (string)($confirmedData['file_path'] ?? '');
    $fileName = (string)($confirmedData['file_name'] ?? '');
    $fileType = (string)($confirmedData['file_type'] ?? '');
    $subtotal = (float)($confirmedData['subtotal'] ?? 0.0);
    $taxAmount = (float)($confirmedData['tax_amount'] ?? 0.0);
    $discountAmount = (float)($confirmedData['discount_amount'] ?? 0.0);
    $grandTotal = (float)($confirmedData['grand_total'] ?? 0.0);
    $notes = (string)($confirmedData['notes'] ?? '');
    $documentType = (string)($confirmedData['document_type'] ?? ($originalGeminiData['document_type'] ?? 'printed'));
    $legibility = (string)($confirmedData['legibility'] ?? ($originalGeminiData['legibility'] ?? 'clear'));
    $lineItems = (array)($confirmedData['line_items'] ?? []);

    $pdo->beginTransaction();
    try {
        // 1. Insert into bills
        $rawGeminiJson = $originalGeminiData ? json_encode($originalGeminiData, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) : null;
        $insertBill = $pdo->prepare('
            INSERT INTO bills (
                user_id, merchant_name, merchant_type, bill_number, bill_date, bill_time,
                payment_method, file_path, file_name, file_type, subtotal, tax_amount,
                discount_amount, grand_total, status, raw_gemini_json, notes,
                document_type, legibility, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, \'confirmed\', ?, ?, ?, ?, ?, ?)
        ');
        $insertBill->execute([
            $userId, $merchantName, $merchantType, $billNumber, $billDate, $billTime,
            $paymentMethod, $filePath, $fileName, $fileType, $subtotal, $taxAmount,
            $discountAmount, $grandTotal, $rawGeminiJson, $notes,
            $documentType, $legibility, $now, $now
        ]);
        $billId = (int)$pdo->lastInsertId();

        // 2. Insert line items & group by category for insight
        $itemsByCategory = [];
        $insertItem = $pdo->prepare('
            INSERT INTO bill_items (
                user_id, bill_id, category_id, category_name, item_name, quantity,
                unit, unit_price, tax_percent, line_total, split_type, my_share_amount, confidence, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ');

        // Prepare item_category_map upsert
        $upsertCatMap = $pdo->prepare('
            INSERT INTO item_category_map (user_id, item_name_normalized, category_id, category_name, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(user_id, item_name_normalized) DO UPDATE SET
                category_id = excluded.category_id,
                category_name = excluded.category_name,
                updated_at = excluded.updated_at
        ');

        // Prepare category lookup / insert
        $findCat = $pdo->prepare('SELECT id, name FROM categories WHERE user_id = ? AND LOWER(name) = LOWER(?) LIMIT 1');
        $createCat = $pdo->prepare('INSERT INTO categories (user_id, name, created_at) VALUES (?, ?, ?)');

        // Calculate sum of raw line totals to check if proportional tax/discount allocation is needed
        $rawLinesSum = 0.0;
        foreach ($lineItems as $it) {
            $q = (float)($it['quantity'] ?? 1.0);
            $p = (float)($it['unit_price'] ?? 0.0);
            $rawLinesSum += (float)($it['line_total'] ?? ($q * $p));
        }

        $needsAllocation = ($rawLinesSum > 0 && $grandTotal > 0 && abs($rawLinesSum - $grandTotal) > 0.01);
        $runningAllocated = 0.0;
        $numItems = count($lineItems);
        $myShareTotalBill = 0.0;

        foreach ($lineItems as $idx => $item) {
            $itemName = trim((string)($item['name'] ?? 'Item'));
            $catName = trim((string)($item['category'] ?? 'General & Miscellaneous'));
            $qty = (float)($item['quantity'] ?? 1.0);
            $unit = trim((string)($item['unit'] ?? 'pcs'));
            $price = (float)($item['unit_price'] ?? 0.0);
            $taxPct = (float)($item['tax_percent'] ?? 0.0);
            $rawTotal = (float)($item['line_total'] ?? ($qty * $price));
            $conf = (string)($item['confidence'] ?? 'high');

            // Allocate tax and discounts proportionally so sum of line_total equals grand_total
            if ($needsAllocation) {
                if ($idx === $numItems - 1) {
                    $total = round($grandTotal - $runningAllocated, 2);
                } else {
                    $total = round($rawTotal * ($grandTotal / $rawLinesSum), 2);
                    $runningAllocated += $total;
                }
            } else {
                $total = $rawTotal;
            }

            // Split calculation: 'mine' (100%), 'shared' (50%), 'someone_else' (0%)
            $splitType = (string)($item['split_type'] ?? 'mine');
            if ($splitType === 'someone_else') {
                $myShareAmount = 0.0;
            } elseif ($splitType === 'shared') {
                $myShareAmount = round($total / 2.0, 2);
            } else {
                $splitType = 'mine';
                $myShareAmount = $total;
            }
            $myShareTotalBill += $myShareAmount;

            // Find or create category
            $findCat->execute([$userId, $catName]);
            $catRow = $findCat->fetch();
            if ($catRow) {
                $catId = (int)$catRow['id'];
                $catName = $catRow['name'];
            } else {
                $createCat->execute([$userId, $catName, $now]);
                $catId = (int)$pdo->lastInsertId();
            }

            $insertItem->execute([
                $userId, $billId, $catId, $catName, $itemName, $qty,
                $unit, $price, $taxPct, $total, $splitType, $myShareAmount, $conf, $now
            ]);

            // Auto-categorization learning: update per-user item-to-category map
            $normName = strtolower(trim($itemName));
            if ($normName !== '') {
                $upsertCatMap->execute([$userId, $normName, $catId, $catName, $now]);
            }

            if (!isset($itemsByCategory[$catName])) {
                $itemsByCategory[$catName] = [];
            }
            $itemsByCategory[$catName][] = [
                'name' => $itemName,
                'line_total' => $total,
                'split_type' => $splitType,
                'my_share_amount' => $myShareAmount,
            ];
        }

        // Update bill's my_share_total
        $updateBillShare = $pdo->prepare('UPDATE bills SET my_share_total = ? WHERE id = ?');
        $updateBillShare->execute([round($myShareTotalBill, 2), $billId]);

        // 3. Log accuracy if original Gemini extraction was provided
        if ($originalGeminiData !== null) {
            record_accuracy_log($pdo, $userId, $billId, $originalGeminiData, $confirmedData);
        }

        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        throw $e;
    }

    // 4. Generate post-save insight
    $insight = generate_post_save_insight($pdo, $userId, $billId, $merchantName, $billDate, $grandTotal, $itemsByCategory);

    // 5. Generate automated reminder suggestions (e.g. 1-year electronics warranty, 14-day apparel return)
    $suggestedReminders = function_exists('generate_suggested_reminders')
        ? generate_suggested_reminders($lineItems, $billDate, $merchantName, $billId)
        : [];

    return [
        'bill_id' => $billId,
        'merchant_name' => $merchantName,
        'grand_total' => $grandTotal,
        'insight' => $insight,
        'suggested_reminders' => $suggestedReminders,
    ];
}

/**
 * Compares Gemini extraction with user-confirmed bill to track accuracy.
 */
function record_accuracy_log(
    PDO $pdo,
    int $userId,
    int $billId,
    array $geminiData,
    array $confirmedData
): void {
    $now = gmdate('Y-m-d H:i:s');
    $totalFields = 0;
    $correctedFields = 0;
    $corrections = [];

    // Fields to compare
    $scalarFields = ['merchant_name', 'bill_number', 'bill_date', 'payment_method', 'grand_total'];
    foreach ($scalarFields as $field) {
        $totalFields++;
        $gVal = $geminiData[$field] ?? null;
        $cVal = $confirmedData[$field] ?? null;

        if ($field === 'grand_total') {
            $diff = abs((float)$gVal - (float)$cVal);
            if ($diff > 0.05) {
                $correctedFields++;
                $corrections[$field] = ['gemini' => $gVal, 'user' => $cVal];
            }
        } else {
            if (trim((string)$gVal) !== trim((string)$cVal)) {
                $correctedFields++;
                $corrections[$field] = ['gemini' => $gVal, 'user' => $cVal];
            }
        }
    }

    // Compare line items count
    $gItems = (array)($geminiData['line_items'] ?? []);
    $cItems = (array)($confirmedData['line_items'] ?? []);
    $totalFields += count($cItems);

    if (count($gItems) !== count($cItems)) {
        $correctedFields++;
        $corrections['line_items_count'] = ['gemini' => count($gItems), 'user' => count($cItems)];
    }

    $docType = (string)($confirmedData['document_type'] ?? ($geminiData['document_type'] ?? 'printed'));
    $accuracyPercent = $totalFields > 0 ? round((($totalFields - $correctedFields) / $totalFields) * 100, 1) : 100.0;

    $stmt = $pdo->prepare('
        INSERT INTO accuracy_logs (
            user_id, bill_id, document_type, total_fields, corrected_fields, accuracy_percent,
            corrections_detail, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ');
    $stmt->execute([
        $userId, $billId, $docType, $totalFields, $correctedFields, $accuracyPercent,
        !empty($corrections) ? json_encode($corrections, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) : null,
        $now
    ]);
}
