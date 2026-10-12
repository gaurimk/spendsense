<?php
/**
 * SpendSense - Reminders Service
 * Manages warranty deadlines, return windows, and bill payment reminders.
 * Provides automated suggestions based on purchased items and categories.
 */

declare(strict_types=1);

require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../db.php';

/**
 * Lists all reminders for a user, partitioned into upcoming, overdue, and completed.
 */
function query_list_reminders(PDO $pdo, int $userId, ?string $filter = null): array {
    $today = gmdate('Y-m-d');

    $whereClauses = ["r.user_id = ?"];
    $params = [$userId];

    if ($filter === 'upcoming') {
        $whereClauses[] = "r.due_date >= ? AND r.is_completed = 0";
        $params[] = $today;
    } elseif ($filter === 'overdue') {
        $whereClauses[] = "r.due_date < ? AND r.is_completed = 0";
        $params[] = $today;
    } elseif ($filter === 'completed') {
        $whereClauses[] = "r.is_completed = 1";
    }

    $whereSql = implode(' AND ', $whereClauses);

    $stmt = $pdo->prepare("
        SELECT 
            r.id,
            r.user_id,
            r.bill_id,
            r.title,
            r.reminder_type,
            r.due_date,
            r.is_completed,
            r.notes,
            r.created_at,
            b.merchant_name,
            b.bill_number,
            b.bill_date
        FROM reminders r
        LEFT JOIN bills b ON r.bill_id = b.id
        WHERE {$whereSql}
        ORDER BY 
            r.is_completed ASC,
            r.due_date ASC,
            r.id DESC
    ");
    $stmt->execute($params);
    $allReminders = $stmt->fetchAll();

    $upcoming = [];
    $overdue = [];
    $completed = [];

    foreach ($allReminders as $rem) {
        $rem['is_completed'] = (int)$rem['is_completed'] === 1;
        $isOverdue = (!$rem['is_completed'] && $rem['due_date'] < $today);
        $rem['is_overdue'] = $isOverdue;

        // Days remaining / overdue
        $dueDateDt = new DateTimeImmutable($rem['due_date']);
        $todayDt = new DateTimeImmutable($today);
        $diff = $todayDt->diff($dueDateDt);
        $daysDiff = (int)$diff->format('%r%a');
        $rem['days_remaining'] = $daysDiff;

        if ($rem['is_completed']) {
            $completed[] = $rem;
        } elseif ($isOverdue) {
            $overdue[] = $rem;
        } else {
            $upcoming[] = $rem;
        }
    }

    return [
        'counts' => [
            'total' => count($allReminders),
            'upcoming' => count($upcoming),
            'overdue' => count($overdue),
            'completed' => count($completed),
        ],
        'upcoming' => $upcoming,
        'overdue' => $overdue,
        'completed' => $completed,
        'reminders' => $allReminders,
    ];
}

/**
 * Returns reminders due within the specified number of days or overdue.
 */
function get_due_reminders(PDO $pdo, int $userId, int $daysAhead = 7): array {
    $today = gmdate('Y-m-d');
    $ahead = (new DateTimeImmutable($today))->modify("+{$daysAhead} days")->format('Y-m-d');

    $stmt = $pdo->prepare("
        SELECT 
            r.id,
            r.title,
            r.reminder_type,
            r.due_date,
            r.notes,
            b.merchant_name
        FROM reminders r
        LEFT JOIN bills b ON r.bill_id = b.id
        WHERE r.user_id = ? 
          AND r.is_completed = 0
          AND r.due_date <= ?
        ORDER BY r.due_date ASC
    ");
    $stmt->execute([$userId, $ahead]);
    $items = $stmt->fetchAll();

    foreach ($items as &$it) {
        $dueDateDt = new DateTimeImmutable($it['due_date']);
        $todayDt = new DateTimeImmutable($today);
        $diff = $todayDt->diff($dueDateDt);
        $days = (int)$diff->format('%r%a');
        $it['days_remaining'] = $days;
        $it['status'] = ($days < 0) ? 'overdue' : (($days === 0) ? 'due_today' : 'due_soon');
    }
    unset($it);

    return $items;
}

/**
 * Creates a new reminder.
 */
function add_reminder(PDO $pdo, int $userId, array $data): int {
    $title = trim((string)($data['title'] ?? ''));
    if ($title === '') {
        throw new InvalidArgumentException('Reminder title cannot be empty.');
    }

    $type = (string)($data['reminder_type'] ?? $data['type'] ?? 'warranty');
    if (!in_array($type, ['warranty', 'return_deadline', 'bill_due', 'other'], true)) {
        $type = 'warranty';
    }

    $dueDate = trim((string)($data['due_date'] ?? ''));
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $dueDate)) {
        throw new InvalidArgumentException('Due date must be in YYYY-MM-DD format.');
    }

    $billId = !empty($data['bill_id']) ? (int)$data['bill_id'] : null;
    $notes = !empty($data['notes']) ? trim((string)$data['notes']) : null;
    $now = gmdate('Y-m-d H:i:s');

    $stmt = $pdo->prepare("
        INSERT INTO reminders (user_id, bill_id, title, reminder_type, due_date, is_completed, notes, created_at)
        VALUES (?, ?, ?, ?, ?, 0, ?, ?)
    ");
    $stmt->execute([$userId, $billId, $title, $type, $dueDate, $notes, $now]);

    return (int)$pdo->lastInsertId();
}

/**
 * Updates an existing reminder.
 */
function update_reminder(PDO $pdo, int $userId, int $id, array $data): bool {
    $stmt = $pdo->prepare("SELECT id FROM reminders WHERE id = ? AND user_id = ?");
    $stmt->execute([$id, $userId]);
    if (!$stmt->fetch()) {
        throw new RuntimeException('Reminder not found or access denied.', 404);
    }

    $title = trim((string)($data['title'] ?? ''));
    $type = (string)($data['reminder_type'] ?? 'warranty');
    $dueDate = trim((string)($data['due_date'] ?? ''));
    $notes = isset($data['notes']) ? trim((string)$data['notes']) : null;
    $isCompleted = isset($data['is_completed']) ? ((int)$data['is_completed'] ? 1 : 0) : 0;

    if ($title === '' || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $dueDate)) {
        throw new InvalidArgumentException('Invalid title or due date format.');
    }

    $upd = $pdo->prepare("
        UPDATE reminders
        SET title = ?, reminder_type = ?, due_date = ?, is_completed = ?, notes = ?
        WHERE id = ? AND user_id = ?
    ");
    return $upd->execute([$title, $type, $dueDate, $isCompleted, $notes, $id, $userId]);
}

/**
 * Toggles a reminder's completion state.
 */
function toggle_reminder(PDO $pdo, int $userId, int $id, ?bool $isCompleted = null): bool {
    $stmt = $pdo->prepare("SELECT is_completed FROM reminders WHERE id = ? AND user_id = ?");
    $stmt->execute([$id, $userId]);
    $current = $stmt->fetchColumn();
    if ($current === false) {
        throw new RuntimeException('Reminder not found or access denied.', 404);
    }

    $newVal = ($isCompleted !== null) ? ($isCompleted ? 1 : 0) : (((int)$current === 1) ? 0 : 1);

    $upd = $pdo->prepare("UPDATE reminders SET is_completed = ? WHERE id = ? AND user_id = ?");
    return $upd->execute([$newVal, $id, $userId]);
}

/**
 * Deletes a reminder.
 */
function delete_reminder(PDO $pdo, int $userId, int $id): bool {
    $stmt = $pdo->prepare("DELETE FROM reminders WHERE id = ? AND user_id = ?");
    $stmt->execute([$id, $userId]);
    return $stmt->rowCount() > 0;
}

/**
 * Generates automated reminder suggestions from parsed bill items and merchant.
 */
function generate_suggested_reminders(array $lineItems, string $billDate, string $merchantName, ?int $billId = null): array {
    $suggestions = [];
    $seenTitles = [];

    $baseDate = preg_match('/^\d{4}-\d{2}-\d{2}$/', $billDate) ? $billDate : gmdate('Y-m-d');
    $dt = new DateTimeImmutable($baseDate);

    foreach ($lineItems as $item) {
        $name = trim((string)($item['name'] ?? ''));
        $cat = (string)($item['category'] ?? '');
        $nl = strtolower($name);
        $cl = strtolower($cat);

        // 1. Electronics & Gadgets -> 1-Year Warranty (or 2-Year for large appliances)
        $isElectronics = str_contains($cl, 'electronic') || str_contains($cl, 'gadget')
            || preg_match('/\b(headphone|earphone|laptop|phone|smartphone|mobile|tv|television|speaker|monitor|tablet|camera|printer|charger|powerbank)\b/i', $nl);
        
        $isAppliance = str_contains($cl, 'home') || str_contains($cl, 'maintenance')
            || preg_match('/\b(refrigerator|fridge|washing machine|microwave|ac|air conditioner|oven|geyser|cooler|purifier|extension board)\b/i', $nl);

        if ($isElectronics || $isAppliance) {
            $years = $isAppliance ? 2 : 1;
            $dueDate = $dt->modify("+{$years} year")->format('Y-m-d');
            $warrantyLabel = "{$years}-Year Warranty";
            $title = "{$warrantyLabel}: {$name}";

            if (!isset($seenTitles[$title])) {
                $seenTitles[$title] = true;
                $suggestions[] = [
                    'title' => $title,
                    'type' => 'warranty',
                    'reminder_type' => 'warranty',
                    'due_date' => $dueDate,
                    'notes' => "Purchased at {$merchantName} on {$billDate}. Standard {$years}-year manufacturer coverage.",
                    'bill_id' => $billId,
                    'item_name' => $name,
                    'duration_label' => "{$years} Year",
                ];
            }
            continue;
        }

        // 2. Apparel, Fashion & Retail -> 14-Day Return Window
        $isApparel = str_contains($cl, 'clothing') || str_contains($cl, 'shopping') || str_contains($cl, 'footwear')
            || preg_match('/\b(shirt|t-shirt|pant|jeans|trousers|dress|shoes|sneakers|jacket|blazer|kurta|saree|suit)\b/i', $nl);

        if ($isApparel) {
            $dueDate = $dt->modify('+14 days')->format('Y-m-d');
            $title = "Return Window: {$name}";

            if (!isset($seenTitles[$title])) {
                $seenTitles[$title] = true;
                $suggestions[] = [
                    'title' => $title,
                    'type' => 'return_deadline',
                    'reminder_type' => 'return_deadline',
                    'due_date' => $dueDate,
                    'notes' => "Purchased at {$merchantName} on {$billDate}. Standard 14-day exchange/return window.",
                    'bill_id' => $billId,
                    'item_name' => $name,
                    'duration_label' => '14 Days',
                ];
            }
        }
    }

    return $suggestions;
}
