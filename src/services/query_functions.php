<?php
/**
 * SpendSense - Whitelisted Query Functions Service
 * Provides a fixed whitelist of analytical functions for Gemini Function Calling.
 * Every query strictly enforces the authenticated $userId.
 * GEMINI NEVER WRITES OR EXECUTES RAW SQL.
 */

declare(strict_types=1);

require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../db.php';

/**
 * Parses user-friendly period strings into start and end dates.
 */
function parse_period_dates(?string $period): array {
    $today = new DateTimeImmutable('now');
    $period = strtolower(trim((string)$period));

    if ($period === '' || $period === 'this_month' || $period === 'current_month') {
        $start = $today->modify('first day of this month')->format('Y-m-d');
        $end = $today->format('Y-m-d');
        $label = 'This Month (' . $today->format('M Y') . ')';
    } elseif ($period === 'last_month' || $period === 'previous_month') {
        $lastMonth = $today->modify('first day of last month');
        $start = $lastMonth->format('Y-m-d');
        $end = $lastMonth->modify('last day of this month')->format('Y-m-d');
        $label = 'Last Month (' . $lastMonth->format('M Y') . ')';
    } elseif ($period === 'last_30_days') {
        $start = $today->modify('-30 days')->format('Y-m-d');
        $end = $today->format('Y-m-d');
        $label = 'Last 30 Days';
    } elseif ($period === 'last_90_days' || $period === '3_months') {
        $start = $today->modify('-90 days')->format('Y-m-d');
        $end = $today->format('Y-m-d');
        $label = 'Last 90 Days';
    } elseif ($period === 'this_year' || $period === 'current_year') {
        $start = $today->format('Y') . '-01-01';
        $end = $today->format('Y-m-d');
        $label = 'This Year (' . $today->format('Y') . ')';
    } elseif (preg_match('/^\d{4}-\d{2}$/', $period)) {
        // e.g. '2026-09'
        $dt = DateTimeImmutable::createFromFormat('Y-m-d', $period . '-01');
        $start = $dt->format('Y-m-d');
        $end = $dt->modify('last day of this month')->format('Y-m-d');
        $label = $dt->format('F Y');
    } elseif (str_contains($period, '..')) {
        // e.g. '2026-08-01..2026-08-31'
        $parts = explode('..', $period, 2);
        $start = trim($parts[0]);
        $end = trim($parts[1]);
        $label = "From {$start} to {$end}";
    } else {
        // Default to last 90 days to capture recent context
        $start = $today->modify('-90 days')->format('Y-m-d');
        $end = $today->format('Y-m-d');
        $label = 'Recent Period';
    }

    return [$start, $end, $label];
}

/**
 * 1. get_spend_summary
 * Aggregates total spend, bill count, category breakdown, and merchant breakdown.
 */
function query_get_spend_summary(
    PDO $pdo,
    int $userId,
    ?string $period = 'this_month',
    ?string $category = null,
    ?string $merchant = null
): array {
    [$startDate, $endDate, $periodLabel] = parse_period_dates($period);

    $params = [$userId, $startDate, $endDate];
    $whereCat = '';
    $whereMerch = '';

    if (!empty($merchant)) {
        $whereMerch = ' AND LOWER(b.merchant_name) LIKE ?';
        $params[] = '%' . strtolower(trim($merchant)) . '%';
    }

    if (!empty($category)) {
        $whereCat = ' AND LOWER(bi.category_name) LIKE ?';
        $params[] = '%' . strtolower(trim($category)) . '%';
    }

    // Category breakdown
    $catSql = "
        SELECT 
            bi.category_name, 
            ROUND(SUM(bi.line_total), 2) AS category_spend,
            COUNT(DISTINCT bi.bill_id) AS bill_count,
            COUNT(bi.id) AS item_count
        FROM bill_items bi
        JOIN bills b ON bi.bill_id = b.id
        WHERE bi.user_id = ?
          AND b.bill_date BETWEEN ? AND ?
          AND b.status != 'discarded'
          {$whereMerch} {$whereCat}
        GROUP BY bi.category_name
        ORDER BY category_spend DESC
    ";
    $catStmt = $pdo->prepare($catSql);
    $catStmt->execute($params);
    $categoryBreakdown = $catStmt->fetchAll();

    // Merchant breakdown
    $merchParams = [$userId, $startDate, $endDate];
    if (!empty($merchant)) {
        $merchParams[] = '%' . strtolower(trim($merchant)) . '%';
    }
    $merchSql = "
        SELECT 
            b.merchant_name,
            ROUND(SUM(b.grand_total), 2) AS merchant_spend,
            COUNT(b.id) AS visit_count
        FROM bills b
        WHERE b.user_id = ?
          AND b.bill_date BETWEEN ? AND ?
          AND b.status != 'discarded'
          {$whereMerch}
        GROUP BY b.merchant_name
        ORDER BY merchant_spend DESC
    ";
    $merchStmt = $pdo->prepare($merchSql);
    $merchStmt->execute($merchParams);
    $merchantBreakdown = $merchStmt->fetchAll();

    // Totals - Always based on final bill grand totals (including taxes & discounts)
    if (empty($category)) {
        $billTotStmt = $pdo->prepare("
            SELECT COUNT(id) AS bill_count, ROUND(COALESCE(SUM(grand_total), 0), 2) AS total_bills_spend
            FROM bills
            WHERE user_id = ? AND bill_date BETWEEN ? AND ? AND status != 'discarded' {$whereMerch}
        ");
        $billTotStmt->execute($merchParams);
        $billTot = $billTotStmt->fetch();
        $billCount = (int)($billTot['bill_count'] ?? 0);
        $totalSpend = (float)($billTot['total_bills_spend'] ?? 0.0);

        // Ensure category breakdown totals align with final bill totals
        $rawCatSum = 0.0;
        foreach ($categoryBreakdown as $row) {
            $rawCatSum += (float)$row['category_spend'];
        }
        if ($rawCatSum > 0 && $totalSpend > 0 && abs($rawCatSum - $totalSpend) > 0.05) {
            $catRunning = 0.0;
            $numCats = count($categoryBreakdown);
            foreach ($categoryBreakdown as $cIdx => &$cRow) {
                if ($cIdx === $numCats - 1) {
                    $cRow['category_spend'] = round($totalSpend - $catRunning, 2);
                } else {
                    $cAlloc = round((float)$cRow['category_spend'] * ($totalSpend / $rawCatSum), 2);
                    $cRow['category_spend'] = $cAlloc;
                    $catRunning += $cAlloc;
                }
            }
            unset($cRow);
        }
    } else {
        $totalSpend = 0.0;
        foreach ($categoryBreakdown as $row) {
            $totalSpend += (float)$row['category_spend'];
        }
        $catBillStmt = $pdo->prepare("
            SELECT COUNT(DISTINCT bi.bill_id) 
            FROM bill_items bi 
            JOIN bills b ON bi.bill_id = b.id 
            WHERE bi.user_id = ? AND b.bill_date BETWEEN ? AND ? AND b.status != 'discarded' {$whereMerch} {$whereCat}
        ");
        $catBillStmt->execute($params);
        $billCount = (int)$catBillStmt->fetchColumn();
    }

    $billLabel = ($billCount === 1) ? '1 bill' : "{$billCount} bills";

    return [
        'period' => $periodLabel,
        'start_date' => $startDate,
        'end_date' => $endDate,
        'total_spent' => round($totalSpend, 2),
        'bill_count' => $billCount,
        'bill_count_label' => $billLabel,
        'category_breakdown' => $categoryBreakdown,
        'top_merchants' => array_slice($merchantBreakdown, 0, 5),
    ];
}

/**
 * 2. top_items
 * Returns items with the highest expenditure or highest quantity in a given period.
 */
function query_top_items(
    PDO $pdo,
    int $userId,
    ?string $period = 'this_month',
    int $limit = 5
): array {
    [$startDate, $endDate, $periodLabel] = parse_period_dates($period);
    $limit = max(1, min(20, $limit));

    $stmt = $pdo->prepare("
        SELECT 
            bi.item_name,
            bi.category_name,
            ROUND(SUM(bi.line_total), 2) AS total_spent,
            ROUND(SUM(bi.quantity), 1) AS total_quantity,
            bi.unit,
            COUNT(DISTINCT bi.bill_id) AS purchase_count,
            ROUND(AVG(bi.unit_price), 2) AS avg_unit_price
        FROM bill_items bi
        JOIN bills b ON bi.bill_id = b.id
        WHERE bi.user_id = ?
          AND b.bill_date BETWEEN ? AND ?
          AND b.status != 'discarded'
        GROUP BY LOWER(bi.item_name)
        ORDER BY total_spent DESC
        LIMIT ?
    ");
    $stmt->execute([$userId, $startDate, $endDate, $limit]);
    $items = $stmt->fetchAll();

    return [
        'period' => $periodLabel,
        'start_date' => $startDate,
        'end_date' => $endDate,
        'top_items' => $items,
    ];
}

/**
 * 3. compare_periods
 * Compares spending between period A and period B (e.g. this_month vs last_month).
 */
function query_compare_periods(
    PDO $pdo,
    int $userId,
    string $periodA = 'this_month',
    string $periodB = 'last_month'
): array {
    $summaryA = query_get_spend_summary($pdo, $userId, $periodA);
    $summaryB = query_get_spend_summary($pdo, $userId, $periodB);

    $spentA = (float)$summaryA['total_spent'];
    $spentB = (float)$summaryB['total_spent'];
    $diffAmount = round($spentA - $spentB, 2);

    $pctChange = ($spentB > 0)
        ? round((($spentA - $spentB) / $spentB) * 100.0, 1)
        : ($spentA > 0 ? 100.0 : 0.0);

    return [
        'period_a' => [
            'label' => $summaryA['period'],
            'total_spent' => $spentA,
            'bill_count' => $summaryA['bill_count'],
            'bill_count_label' => $summaryA['bill_count_label'] ?? (($summaryA['bill_count'] === 1) ? '1 bill' : "{$summaryA['bill_count']} bills"),
            'top_categories' => array_slice($summaryA['category_breakdown'], 0, 5),
        ],
        'period_b' => [
            'label' => $summaryB['period'],
            'total_spent' => $spentB,
            'bill_count' => $summaryB['bill_count'],
            'bill_count_label' => $summaryB['bill_count_label'] ?? (($summaryB['bill_count'] === 1) ? '1 bill' : "{$summaryB['bill_count']} bills"),
            'top_categories' => array_slice($summaryB['category_breakdown'], 0, 5),
        ],
        'difference' => [
            'amount' => $diffAmount,
            'percent_change' => $pctChange,
            'trend' => $diffAmount > 0 ? 'increased' : ($diffAmount < 0 ? 'decreased' : 'same'),
        ],
    ];
}

/**
 * 4. list_bills
 * Retrieves filtered list of bills (e.g. 5 biggest bills, recent restaurant bills).
 */
function query_list_bills(
    PDO $pdo,
    int $userId,
    array $filters = []
): array {
    $period = $filters['period'] ?? null;
    $category = $filters['category'] ?? null;
    $merchant = $filters['merchant'] ?? null;
    $limit = max(1, min(25, (int)($filters['limit'] ?? 5)));
    $orderBy = ($filters['order_by'] ?? 'date_desc') === 'total_desc' 
        ? 'b.grand_total DESC' 
        : 'b.bill_date DESC, b.id DESC';

    $whereClauses = ["b.user_id = ?", "b.status != 'discarded'"];
    $params = [$userId];

    if (!empty($period)) {
        [$startDate, $endDate] = parse_period_dates($period);
        $whereClauses[] = "b.bill_date BETWEEN ? AND ?";
        $params[] = $startDate;
        $params[] = $endDate;
    }

    if (!empty($merchant)) {
        $whereClauses[] = "LOWER(b.merchant_name) LIKE ?";
        $params[] = '%' . strtolower(trim($merchant)) . '%';
    }

    $joinClause = '';
    if (!empty($category)) {
        $joinClause = "JOIN bill_items bi ON bi.bill_id = b.id";
        $whereClauses[] = "LOWER(bi.category_name) LIKE ?";
        $params[] = '%' . strtolower(trim($category)) . '%';
    }

    $whereSql = implode(' AND ', $whereClauses);
    $params[] = $limit;

    $sql = "
        SELECT DISTINCT
            b.id,
            b.merchant_name,
            b.merchant_type,
            b.bill_number,
            b.bill_date,
            b.payment_method,
            ROUND(b.grand_total, 2) AS grand_total,
            (SELECT COUNT(*) FROM bill_items WHERE bill_id = b.id) AS item_count
        FROM bills b
        {$joinClause}
        WHERE {$whereSql}
        ORDER BY {$orderBy}
        LIMIT ?
    ";

    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $bills = $stmt->fetchAll();

    return [
        'count' => count($bills),
        'bills' => $bills,
    ];
}

/**
 * 5. price_history
 * Tracks price changes for a specific item across stores over time.
 */
function query_price_history(
    PDO $pdo,
    int $userId,
    string $item
): array {
    $itemClean = trim($item);
    if ($itemClean === '') {
        return ['error' => 'Item name is required for price history.'];
    }

    $stmt = $pdo->prepare("
        SELECT 
            b.bill_date,
            b.merchant_name,
            bi.item_name,
            ROUND(bi.unit_price, 2) AS unit_price,
            bi.unit,
            ROUND(bi.line_total, 2) AS line_total,
            b.id AS bill_id
        FROM bill_items bi
        JOIN bills b ON bi.bill_id = b.id
        WHERE bi.user_id = ?
          AND LOWER(bi.item_name) LIKE ?
          AND bi.unit_price > 0
          AND b.status != 'discarded'
        ORDER BY b.bill_date ASC, b.id ASC
    ");
    $stmt->execute([$userId, '%' . strtolower($itemClean) . '%']);
    $history = $stmt->fetchAll();

    if (empty($history)) {
        return [
            'item' => $itemClean,
            'message' => "No purchase history found for \"{$itemClean}\".",
            'history' => [],
        ];
    }

    // Determine cheapest and highest stores
    $cheapest = $history[0];
    $highest = $history[0];
    foreach ($history as $h) {
        if ($h['unit_price'] < $cheapest['unit_price']) $cheapest = $h;
        if ($h['unit_price'] > $highest['unit_price']) $highest = $h;
    }

    $firstPrice = (float)$history[0]['unit_price'];
    $earliestDate = $history[0]['bill_date'];
    $latestPrice = (float)end($history)['unit_price'];
    $priceChangePct = ($firstPrice > 0)
        ? round((($latestPrice - $firstPrice) / $firstPrice) * 100.0, 1)
        : 0.0;

    if ($priceChangePct > 0) {
        $trendFlag = "Price went up {$priceChangePct}% since {$earliestDate}";
    } elseif ($priceChangePct < 0) {
        $absPct = abs($priceChangePct);
        $trendFlag = "Price dropped {$absPct}% since {$earliestDate}";
    } else {
        $trendFlag = "Price unchanged since {$earliestDate}";
    }

    return [
        'item' => $itemClean,
        'match_count' => count($history),
        'latest_price' => $latestPrice,
        'first_price' => $firstPrice,
        'first_date' => $earliestDate,
        'cheapest_at' => [
            'merchant' => $cheapest['merchant_name'],
            'price' => (float)$cheapest['unit_price'],
            'date' => $cheapest['bill_date'],
        ],
        'highest_at' => [
            'merchant' => $highest['merchant_name'],
            'price' => (float)$highest['unit_price'],
            'date' => $highest['bill_date'],
        ],
        'price_trend_percent' => $priceChangePct,
        'trend_flag' => $trendFlag,
        'history' => $history,
    ];
}

/**
 * 6. budget_status
 * Checks monthly budget progress and alerts for each category.
 */
function query_budget_status(
    PDO $pdo,
    int $userId,
    ?string $month = null
): array {
    $today = new DateTimeImmutable('now');
    $monthClean = (!empty($month) && preg_match('/^\d{4}-\d{2}$/', trim($month)))
        ? trim($month)
        : $today->format('Y-m');

    $startDate = $monthClean . '-01';
    $dt = DateTimeImmutable::createFromFormat('Y-m-d', $startDate);
    $endDate = $dt->modify('last day of this month')->format('Y-m-d');

    // Get user's budgets for this month (or 'default' if month-specific is missing)
    $stmt = $pdo->prepare("
        SELECT 
            b.id AS budget_id,
            c.id AS category_id,
            c.name AS category_name,
            c.color,
            ROUND(b.monthly_amount, 2) AS budgeted_amount
        FROM budgets b
        JOIN categories c ON b.category_id = c.id
        WHERE b.user_id = ?
          AND (b.month = ? OR b.month = 'default')
        ORDER BY c.name ASC
    ");
    $stmt->execute([$userId, $monthClean]);
    $budgets = $stmt->fetchAll();

    if (empty($budgets)) {
        // Return spent by categories without budget threshold
        $spentStmt = $pdo->prepare("
            SELECT 
                bi.category_name, 
                ROUND(SUM(bi.line_total), 2) AS spent_amount
            FROM bill_items bi
            JOIN bills b ON bi.bill_id = b.id
            WHERE bi.user_id = ?
              AND b.bill_date BETWEEN ? AND ?
              AND b.status != 'discarded'
            GROUP BY bi.category_name
        ");
        $spentStmt->execute([$userId, $startDate, $endDate]);
        $spends = $spentStmt->fetchAll();

        return [
            'month' => $monthClean,
            'has_budgets' => false,
            'message' => 'No budgets defined for this month yet. You can set category budgets in the Budgets tab.',
            'category_spends' => $spends,
        ];
    }

    // Calculate actual spend per category in this month
    $spentStmt = $pdo->prepare("
        SELECT 
            bi.category_id,
            ROUND(SUM(bi.line_total), 2) AS actual_spent
        FROM bill_items bi
        JOIN bills b ON bi.bill_id = b.id
        WHERE bi.user_id = ?
          AND b.bill_date BETWEEN ? AND ?
          AND b.status != 'discarded'
        GROUP BY bi.category_id
    ");
    $spentStmt->execute([$userId, $startDate, $endDate]);
    $spentMap = [];
    foreach ($spentStmt->fetchAll() as $row) {
        $spentMap[(int)$row['category_id']] = (float)$row['actual_spent'];
    }

    $results = [];
    $totalBudgeted = 0.0;
    $totalSpent = 0.0;
    $alerts = [];

    foreach ($budgets as $b) {
        $catId = (int)$b['category_id'];
        $budgeted = (float)$b['budgeted_amount'];
        $actual = $spentMap[$catId] ?? 0.0;
        $remaining = round($budgeted - $actual, 2);
        $pct = ($budgeted > 0) ? round(($actual / $budgeted) * 100.0, 1) : 0.0;

        $totalBudgeted += $budgeted;
        $totalSpent += $actual;

        $status = 'normal'; // <80%
        if ($pct >= 100.0) {
            $status = 'exceeded';
            $alerts[] = "Budget exceeded for {$b['category_name']} ({$pct}% used: spent ₹{$actual} vs limit ₹{$budgeted})!";
        } elseif ($pct >= 80.0) {
            $status = 'warning';
            $alerts[] = "Budget warning: {$b['category_name']} has reached {$pct}% of its limit (₹{$actual} of ₹{$budgeted}).";
        }

        $results[] = [
            'category_id' => $catId,
            'category_name' => $b['category_name'],
            'budgeted' => $budgeted,
            'spent' => $actual,
            'remaining' => $remaining,
            'percentage_used' => $pct,
            'status' => $status,
        ];
    }

    return [
        'month' => $monthClean,
        'has_budgets' => true,
        'total_budgeted' => round($totalBudgeted, 2),
        'total_spent' => round($totalSpent, 2),
        'overall_percentage' => ($totalBudgeted > 0) ? round(($totalSpent / $totalBudgeted) * 100.0, 1) : 0.0,
        'categories' => $results,
        'alerts' => $alerts,
    ];
}

/**
 * 7. recurring_spend
 * Detects items or merchants that repeat (milk, subscriptions, rent, fuel, etc.)
 * Lists them with average monthly cost and next expected date.
 */
function query_recurring_spend(PDO $pdo, int $userId): array {
    $today = new DateTimeImmutable('now');

    // Repeating items (>= 2 purchases on different dates or bills)
    $itemStmt = $pdo->prepare("
        SELECT 
            bi.item_name,
            bi.category_name,
            COUNT(DISTINCT b.id) AS purchase_count,
            ROUND(SUM(COALESCE(bi.my_share_amount, bi.line_total)), 2) AS total_spent,
            ROUND(AVG(COALESCE(bi.my_share_amount, bi.line_total)), 2) AS avg_per_purchase,
            MIN(b.bill_date) AS first_date,
            MAX(b.bill_date) AS last_date,
            COUNT(DISTINCT SUBSTR(b.bill_date, 1, 7)) AS distinct_months
        FROM bill_items bi
        JOIN bills b ON bi.bill_id = b.id
        WHERE bi.user_id = ? AND b.status != 'discarded'
        GROUP BY LOWER(bi.item_name)
        HAVING purchase_count >= 2
        ORDER BY total_spent DESC
    ");
    $itemStmt->execute([$userId]);
    $itemRows = $itemStmt->fetchAll();

    // Also check single bills matching recurring keywords
    $keywordStmt = $pdo->prepare("
        SELECT 
            bi.item_name,
            bi.category_name,
            COUNT(DISTINCT b.id) AS purchase_count,
            ROUND(SUM(COALESCE(bi.my_share_amount, bi.line_total)), 2) AS total_spent,
            ROUND(AVG(COALESCE(bi.my_share_amount, bi.line_total)), 2) AS avg_per_purchase,
            MIN(b.bill_date) AS first_date,
            MAX(b.bill_date) AS last_date,
            COUNT(DISTINCT SUBSTR(b.bill_date, 1, 7)) AS distinct_months
        FROM bill_items bi
        JOIN bills b ON bi.bill_id = b.id
        WHERE bi.user_id = ? AND b.status != 'discarded'
          AND (
            LOWER(bi.item_name) LIKE '%rent%' OR
            LOWER(bi.item_name) LIKE '%milk%' OR
            LOWER(bi.item_name) LIKE '%broadband%' OR
            LOWER(bi.item_name) LIKE '%wifi%' OR
            LOWER(bi.item_name) LIKE '%internet%' OR
            LOWER(bi.item_name) LIKE '%newspaper%' OR
            LOWER(bi.item_name) LIKE '%subscription%' OR
            LOWER(bi.item_name) LIKE '%netflix%' OR
            LOWER(bi.item_name) LIKE '%spotify%' OR
            LOWER(bi.item_name) LIKE '%gym%' OR
            LOWER(bi.item_name) LIKE '%electricity%' OR
            LOWER(bi.item_name) LIKE '%gas%' OR
            LOWER(bi.item_name) LIKE '%cylinder%' OR
            LOWER(bi.item_name) LIKE '%petrol%' OR
            LOWER(bi.item_name) LIKE '%diesel%' OR
            LOWER(bi.item_name) LIKE '%fuel%'
          )
        GROUP BY LOWER(bi.item_name)
        HAVING purchase_count = 1
    ");
    $keywordStmt->execute([$userId]);
    $keywordRows = $keywordStmt->fetchAll();

    $combined = array_merge($itemRows, $keywordRows);
    $recurringItems = [];
    $totalMonthlySpend = 0.0;

    foreach ($combined as $row) {
        $name = $row['item_name'];
        $cat = $row['category_name'];
        $pCount = (int)$row['purchase_count'];
        $tot = (float)$row['total_spent'];
        $avgPer = (float)$row['avg_per_purchase'];
        $firstDate = $row['first_date'];
        $lastDate = $row['last_date'];
        $monthsActive = max(1, (int)$row['distinct_months']);

        $firstDt = new DateTimeImmutable($firstDate);
        $lastDt = new DateTimeImmutable($lastDate);
        $daysSpan = max(1, (int)$firstDt->diff($lastDt)->format('%a'));

        $isDaily = (str_contains(strtolower($name), 'milk') || str_contains(strtolower($name), 'newspaper') || ($pCount >= 3 && ($daysSpan / $pCount) <= 4));
        $isWeekly = (!$isDaily && ($pCount >= 2 && ($daysSpan / $pCount) <= 10));

        if ($isDaily) {
            $freq = 'Daily';
            $avgMonthly = round($avgPer * 30, 2);
            $nextDt = $lastDt->modify('+1 day');
        } elseif ($isWeekly) {
            $freq = 'Weekly';
            $avgMonthly = round($avgPer * 4, 2);
            $nextDt = $lastDt->modify('+7 days');
        } else {
            $freq = 'Monthly';
            $avgMonthly = round($tot / $monthsActive, 2);
            $nextDt = $lastDt->modify('+1 month');
        }

        while ($nextDt < $today) {
            $nextDt = ($freq === 'Daily') ? $nextDt->modify('+1 day') : (($freq === 'Weekly') ? $nextDt->modify('+7 days') : $nextDt->modify('+1 month'));
        }

        $recurringItems[] = [
            'item_name' => $name,
            'category_name' => $cat,
            'frequency' => $freq,
            'purchase_count' => $pCount,
            'total_spent' => $tot,
            'avg_monthly_cost' => $avgMonthly,
            'estimated_monthly_cost' => $avgMonthly,
            'last_date' => $lastDate,
            'next_expected_date' => $nextDt->format('Y-m-d'),
        ];
        $totalMonthlySpend += $avgMonthly;
    }

    usort($recurringItems, fn($a, $b) => $b['avg_monthly_cost'] <=> $a['avg_monthly_cost']);

    return [
        'count' => count($recurringItems),
        'recurring_items' => $recurringItems,
        'items' => $recurringItems,
        'total_estimated_monthly' => round($totalMonthlySpend, 2),
        'total_recurring_monthly' => round($totalMonthlySpend, 2),
    ];
}

/**
 * 8. list_reminders
 * Retrieves user reminders, upcoming deadlines, warranties, and return windows.
 */
function query_list_reminders_for_chat(PDO $pdo, int $userId): array {
    require_once __DIR__ . '/reminders.php';
    return query_list_reminders($pdo, $userId);
}
