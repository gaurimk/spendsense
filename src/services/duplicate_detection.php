<?php
/**
 * SpendSense - Duplicate Bill Detection Service
 * Identifies potential duplicate bills by comparing merchant, date, total, and bill number.
 */

declare(strict_types=1);

/**
 * Checks if a matching bill already exists for the given user.
 * Returns null if no duplicate found, or an array with duplicate details.
 */
function check_duplicate_bill(
    PDO $pdo,
    int $userId,
    string $merchantName,
    string $billDate,
    float $grandTotal,
    ?string $billNumber = null
): ?array {
    $merchantClean = strtolower(trim($merchantName));
    $dateClean = trim($billDate);
    $billNumClean = $billNumber !== null ? trim($billNumber) : '';

    if ($merchantClean === '' || $dateClean === '') {
        return null;
    }

    // 1. Check exact match with bill number if bill number is present
    if ($billNumClean !== '') {
        $stmt = $pdo->prepare('
            SELECT id, merchant_name, bill_number, bill_date, grand_total, created_at
            FROM bills
            WHERE user_id = ?
              AND LOWER(merchant_name) = ?
              AND bill_number = ?
              AND bill_date = ?
              AND status != \'discarded\'
            LIMIT 1
        ');
        $stmt->execute([$userId, $merchantClean, $billNumClean, $dateClean]);
        $match = $stmt->fetch();
        if ($match) {
            return [
                'type' => 'exact_bill_number',
                'bill_id' => (int)$match['id'],
                'merchant' => $match['merchant_name'],
                'date' => $match['bill_date'],
                'bill_number' => $match['bill_number'],
                'total' => (float)$match['grand_total'],
                'message' => "Potential duplicate: An identical bill (#{$match['bill_number']} from {$match['merchant_name']} on {$match['bill_date']} for " . number_format((float)$match['grand_total'], 2) . ") is already recorded.",
            ];
        }
    }

    // 2. Check match by merchant + date + grand_total (within ₹0.50)
    $stmt = $pdo->prepare('
        SELECT id, merchant_name, bill_number, bill_date, grand_total, created_at
        FROM bills
        WHERE user_id = ?
          AND LOWER(merchant_name) = ?
          AND bill_date = ?
          AND ABS(grand_total - ?) < 0.50
          AND status != \'discarded\'
        LIMIT 1
    ');
    $stmt->execute([$userId, $merchantClean, $dateClean, $grandTotal]);
    $match = $stmt->fetch();
    if ($match) {
        $billLabel = !empty($match['bill_number']) ? "#{$match['bill_number']}" : "on {$match['bill_date']}";
        return [
            'type' => 'merchant_date_total',
            'bill_id' => (int)$match['id'],
            'merchant' => $match['merchant_name'],
            'date' => $match['bill_date'],
            'bill_number' => $match['bill_number'],
            'total' => (float)$match['grand_total'],
            'message' => "Possible duplicate: A bill from {$match['merchant_name']} for " . number_format((float)$match['grand_total'], 2) . " {$billLabel} already exists.",
        ];
    }

    return null;
}
