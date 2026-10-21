<?php
/**
 * SpendSense - Insights Dashboard Service
 * Computes analytics: monthly comparisons, category distributions, monthly trendlines,
 * average bill sizes, busiest spending days, and top merchants/items.
 */

declare(strict_types=1);

require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../db.php';

function get_insights_dashboard_data(PDO $pdo, int $userId): array {
    $today = new DateTimeImmutable('now');
    $currentMonthStr = $today->format('Y-m');
    $lastMonthStr = $today->modify('first day of last month')->format('Y-m');

    $curStart = $currentMonthStr . '-01';
    $curEnd = $today->format('Y-m-d');
    $lastStart = $lastMonthStr . '-01';
    $lastEnd = $today->modify('first day of last month')->modify('last day of this month')->format('Y-m-d');

    // 1. Current Month & Last Month Total Spend & Bill Count
    $spendStmt = $pdo->prepare("
        SELECT 
            ROUND(COALESCE(SUM(COALESCE(my_share_total, grand_total)), 0), 2) AS total_spend,
            COUNT(id) AS bill_count,
            ROUND(COALESCE(AVG(COALESCE(my_share_total, grand_total)), 0), 2) AS avg_bill
        FROM bills
        WHERE user_id = ? AND bill_date BETWEEN ? AND ? AND status != 'discarded'
    ");

    $spendStmt->execute([$userId, $curStart, $curEnd]);
    $curData = $spendStmt->fetch();
    $curSpent = (float)($curData['total_spend'] ?? 0.0);
    $curBills = (int)($curData['bill_count'] ?? 0);
    $avgBill = (float)($curData['avg_bill'] ?? 0.0);

    $spendStmt->execute([$userId, $lastStart, $lastEnd]);
    $lastData = $spendStmt->fetch();
    $lastSpent = (float)($lastData['total_spend'] ?? 0.0);
    $lastBills = (int)($lastData['bill_count'] ?? 0);

    // If current month has few or no bills, calculate overall avg bill size across all time
    if ($avgBill <= 0.0) {
        $allAvgStmt = $pdo->prepare("SELECT ROUND(COALESCE(AVG(COALESCE(my_share_total, grand_total)), 0), 2) FROM bills WHERE user_id = ? AND status != 'discarded'");
        $allAvgStmt->execute([$userId]);
        $avgBill = (float)($allAvgStmt->fetchColumn() ?: 0.0);
    }

    $diffAmount = round($curSpent - $lastSpent, 2);
    $pctChange = ($lastSpent > 0)
        ? round((($curSpent - $lastSpent) / $lastSpent) * 100.0, 1)
        : ($curSpent > 0 ? 100.0 : 0.0);

    // 2. Busiest Spending Days of the Week
    // SQLite strftime('%w', bill_date): 0 = Sunday, 1 = Monday, ... 6 = Saturday
    $daysMap = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    $dayStmt = $pdo->prepare("
        SELECT 
            CAST(strftime('%w', bill_date) AS INTEGER) AS day_num,
            ROUND(SUM(COALESCE(my_share_total, grand_total)), 2) AS day_spend,
            COUNT(id) AS day_count
        FROM bills
        WHERE user_id = ? AND status != 'discarded'
        GROUP BY day_num
        ORDER BY day_spend DESC
    ");
    $dayStmt->execute([$userId]);
    $dayRows = $dayStmt->fetchAll();

    $busiestDay = 'None yet';
    $busiestDaySpend = 0.0;
    $busiestDayCount = 0;
    if (!empty($dayRows)) {
        $topDayNum = (int)$dayRows[0]['day_num'];
        $busiestDay = $daysMap[$topDayNum] ?? 'Saturday';
        $busiestDaySpend = (float)$dayRows[0]['day_spend'];
        $busiestDayCount = (int)$dayRows[0]['day_count'];
    }

    // 3. Category Donut Chart
    // Base category breakdown on current month if available, else last 90 days
    $catQueryStart = $curSpent > 0 ? $curStart : $today->modify('-90 days')->format('Y-m-d');
    $catStmt = $pdo->prepare("
        SELECT 
            bi.category_name,
            ROUND(SUM(COALESCE(bi.my_share_amount, bi.line_total)), 2) AS category_spend,
            COUNT(DISTINCT bi.bill_id) AS bill_count
        FROM bill_items bi
        JOIN bills b ON bi.bill_id = b.id
        WHERE bi.user_id = ? 
          AND b.bill_date BETWEEN ? AND ?
          AND b.status != 'discarded'
        GROUP BY bi.category_name
        ORDER BY category_spend DESC
    ");
    $catStmt->execute([$userId, $catQueryStart, $today->format('Y-m-d')]);
    $catRows = $catStmt->fetchAll();

    $catTotalSum = 0.0;
    foreach ($catRows as $r) {
        $catTotalSum += (float)$r['category_spend'];
    }

    $donutLabels = [];
    $donutValues = [];
    $donutPercentages = [];
    $colorPalette = ['#10b981', '#f59e0b', '#3b82f6', '#8b5cf6', '#ec4899', '#ef4444', '#14b8a6', '#6366f1', '#64748b'];
    $donutColors = [];

    foreach ($catRows as $idx => $r) {
        $cName = $r['category_name'];
        $cSpend = (float)$r['category_spend'];
        $pct = ($catTotalSum > 0) ? round(($cSpend / $catTotalSum) * 100, 1) : 0;

        $donutLabels[] = $cName;
        $donutValues[] = $cSpend;
        $donutPercentages[] = $pct;
        $donutColors[] = $colorPalette[$idx % count($colorPalette)];
    }

    // 4. Monthly Trend Line Chart (Last 6 months)
    $trendStmt = $pdo->prepare("
        SELECT 
            SUBSTR(bill_date, 1, 7) AS month_str,
            ROUND(SUM(COALESCE(my_share_total, grand_total)), 2) AS month_spend,
            COUNT(id) AS bill_count
        FROM bills
        WHERE user_id = ? AND status != 'discarded'
        GROUP BY month_str
        ORDER BY month_str ASC
        LIMIT 6
    ");
    $trendStmt->execute([$userId]);
    $trendRows = $trendStmt->fetchAll();

    $trendLabels = [];
    $trendValues = [];
    $trendCounts = [];
    foreach ($trendRows as $row) {
        $dt = DateTimeImmutable::createFromFormat('Y-m-d', $row['month_str'] . '-01');
        $trendLabels[] = $dt ? $dt->format('M Y') : $row['month_str'];
        $trendValues[] = (float)$row['month_spend'];
        $trendCounts[] = (int)$row['bill_count'];
    }

    // 5. Top 5 Merchants
    $merchStmt = $pdo->prepare("
        SELECT 
            merchant_name,
            ROUND(SUM(COALESCE(my_share_total, grand_total)), 2) AS total_spend,
            COUNT(id) AS visits,
            MAX(bill_date) AS last_visited
        FROM bills
        WHERE user_id = ? AND status != 'discarded'
        GROUP BY LOWER(merchant_name)
        ORDER BY total_spend DESC
        LIMIT 5
    ");
    $merchStmt->execute([$userId]);
    $topMerchants = $merchStmt->fetchAll();

    // 6. Top 5 Items
    $itemStmt = $pdo->prepare("
        SELECT 
            bi.item_name,
            bi.category_name,
            ROUND(SUM(COALESCE(bi.my_share_amount, bi.line_total)), 2) AS total_spend,
            ROUND(SUM(bi.quantity), 1) AS total_quantity,
            bi.unit,
            COUNT(DISTINCT bi.bill_id) AS purchases
        FROM bill_items bi
        JOIN bills b ON bi.bill_id = b.id
        WHERE bi.user_id = ? AND b.status != 'discarded'
        GROUP BY LOWER(bi.item_name)
        ORDER BY total_spend DESC
        LIMIT 5
    ");
    $itemStmt->execute([$userId]);
    $topItems = $itemStmt->fetchAll();

    // 7. Accuracy Breakdown by Document Type (printed vs handwritten)
    $accStmt = $pdo->prepare("
        SELECT 
            COALESCE(document_type, 'printed') AS doc_type,
            COUNT(id) AS log_count,
            SUM(total_fields) AS total_fields,
            SUM(corrected_fields) AS corrected_fields,
            ROUND(AVG(accuracy_percent), 1) AS avg_accuracy
        FROM accuracy_logs
        WHERE user_id = ?
        GROUP BY COALESCE(document_type, 'printed')
    ");
    $accStmt->execute([$userId]);
    $accRows = $accStmt->fetchAll();

    $accuracyBreakdown = [
        'printed' => ['accuracy_percent' => 100.0, 'bills_analyzed' => 0, 'fields_checked' => 0],
        'handwritten' => ['accuracy_percent' => 100.0, 'bills_analyzed' => 0, 'fields_checked' => 0],
        'has_data' => false,
    ];

    foreach ($accRows as $row) {
        $type = strtolower((string)$row['doc_type']);
        $totalF = (int)($row['total_fields'] ?? 0);
        $corrF = (int)($row['corrected_fields'] ?? 0);
        $accPct = $totalF > 0 ? round((($totalF - $corrF) / $totalF) * 100.0, 1) : 100.0;

        if (str_contains($type, 'handwritten')) {
            $accuracyBreakdown['handwritten'] = [
                'accuracy_percent' => $accPct,
                'bills_analyzed' => (int)$row['log_count'],
                'fields_checked' => $totalF,
            ];
            $accuracyBreakdown['has_data'] = true;
        } else {
            $accuracyBreakdown['printed'] = [
                'accuracy_percent' => $accPct,
                'bills_analyzed' => (int)$row['log_count'],
                'fields_checked' => $totalF,
            ];
            $accuracyBreakdown['has_data'] = true;
        }
    }

    // Commercial / GST Breakdown for current month
    $taxStmt = $pdo->prepare("
        SELECT 
            ROUND(COALESCE(SUM(subtotal), 0), 2) AS taxable_value,
            ROUND(COALESCE(SUM(tax_amount), 0), 2) AS total_tax,
            ROUND(COALESCE(SUM(grand_total), 0), 2) AS gross_total
        FROM bills
        WHERE user_id = ? AND bill_date BETWEEN ? AND ? AND status != 'discarded'
    ");
    $taxStmt->execute([$userId, $curStart, $curEnd]);
    $taxRow = $taxStmt->fetch();

    return [
        'this_month' => [
            'label' => $today->format('F Y'),
            'spent' => $curSpent,
            'bill_count' => $curBills,
        ],
        'last_month' => [
            'label' => $today->modify('first day of last month')->format('F Y'),
            'spent' => $lastSpent,
            'bill_count' => $lastBills,
        ],
        'comparison' => [
            'difference' => $diffAmount,
            'percent_change' => $pctChange,
            'trend' => $diffAmount > 0 ? 'increase' : ($diffAmount < 0 ? 'decrease' : 'steady'),
        ],
        'average_bill_size' => $avgBill,
        'busiest_day' => [
            'day_name' => $busiestDay,
            'total_spend' => $busiestDaySpend,
            'bill_count' => $busiestDayCount,
        ],
        'category_donut' => [
            'labels' => $donutLabels,
            'values' => $donutValues,
            'percentages' => $donutPercentages,
            'colors' => $donutColors,
            'total' => round($catTotalSum, 2),
            'basis_note' => 'Percentages calculated from final item line totals (after discounts & taxes).',
        ],
        'monthly_trend' => [
            'labels' => $trendLabels,
            'values' => $trendValues,
            'counts' => $trendCounts,
        ],
        'top_merchants' => $topMerchants,
        'top_items' => $topItems,
        'accuracy_breakdown' => $accuracyBreakdown,
        'commercial_summary' => [
            'taxable_value' => (float)($taxRow['taxable_value'] ?? 0.0),
            'total_tax' => (float)($taxRow['total_tax'] ?? 0.0),
            'gross_total' => (float)($taxRow['gross_total'] ?? 0.0),
        ],
    ];
}
