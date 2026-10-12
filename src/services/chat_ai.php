<?php
/**
 * SpendSense - Chat with Data AI Service (Gemini Function Calling)
 * Integrates Gemini Function Calling with a fixed whitelist of PHP query functions.
 * Enforces logged-in $userId on all queries. Never executes raw SQL.
 */

declare(strict_types=1);

require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/gemini.php';
require_once __DIR__ . '/query_functions.php';

/**
 * Returns Gemini function declarations schema for function calling.
 */
function get_gemini_tools_declaration(): array {
    return [
        [
            'function_declarations' => [
                [
                    'name' => 'get_spend_summary',
                    'description' => 'Aggregates spending, bill count, category breakdown, and top merchants for a period (e.g. this_month, last_month, last_30_days, last_90_days, this_year, YYYY-MM).',
                    'parameters' => [
                        'type' => 'OBJECT',
                        'properties' => [
                            'period' => [
                                'type' => 'STRING',
                                'description' => 'Time period such as this_month, last_month, last_30_days, last_90_days, this_year, or YYYY-MM',
                            ],
                            'category' => [
                                'type' => 'STRING',
                                'description' => 'Optional category filter like Groceries & Supermarket, Food & Dining, Pharmacy, Fuel, Snacks',
                            ],
                            'merchant' => [
                                'type' => 'STRING',
                                'description' => 'Optional merchant name filter like DMart, Starbucks, Apollo',
                            ],
                        ],
                    ],
                ],
                [
                    'name' => 'top_items',
                    'description' => 'Finds the highest spending items or most frequently bought products in a given period.',
                    'parameters' => [
                        'type' => 'OBJECT',
                        'properties' => [
                            'period' => [
                                'type' => 'STRING',
                                'description' => 'Time period like this_month, last_month, last_90_days, this_year',
                            ],
                            'limit' => [
                                'type' => 'INTEGER',
                                'description' => 'Number of top items to return (default 5, max 20)',
                            ],
                        ],
                    ],
                ],
                [
                    'name' => 'compare_periods',
                    'description' => 'Compares total expenditure, percentage change, and category breakdown between two periods (e.g. this_month vs last_month).',
                    'parameters' => [
                        'type' => 'OBJECT',
                        'properties' => [
                            'period_a' => [
                                'type' => 'STRING',
                                'description' => 'First period e.g. this_month',
                            ],
                            'period_b' => [
                                'type' => 'STRING',
                                'description' => 'Second period to compare against e.g. last_month',
                            ],
                        ],
                        'required' => ['period_a', 'period_b'],
                    ],
                ],
                [
                    'name' => 'list_bills',
                    'description' => 'Retrieves a list of individual bills matching criteria (e.g. 5 biggest bills, recent visits, filtered by merchant or category).',
                    'parameters' => [
                        'type' => 'OBJECT',
                        'properties' => [
                            'period' => [
                                'type' => 'STRING',
                                'description' => 'Optional period like this_month, last_month, last_90_days',
                            ],
                            'category' => [
                                'type' => 'STRING',
                                'description' => 'Optional category filter',
                            ],
                            'merchant' => [
                                'type' => 'STRING',
                                'description' => 'Optional merchant name filter',
                            ],
                            'limit' => [
                                'type' => 'INTEGER',
                                'description' => 'Number of bills to return (default 5, max 20)',
                            ],
                            'order_by' => [
                                'type' => 'STRING',
                                'description' => 'total_desc for biggest bills, or date_desc for most recent',
                            ],
                        ],
                    ],
                ],
                [
                    'name' => 'price_history',
                    'description' => 'Looks up price history and compares price across stores for a specific item (e.g. milk, butter, oil, coffee) over time.',
                    'parameters' => [
                        'type' => 'OBJECT',
                        'properties' => [
                            'item' => [
                                'type' => 'STRING',
                                'description' => 'Item name or keyword to check price history for (e.g. milk, sunflower oil)',
                            ],
                        ],
                        'required' => ['item'],
                    ],
                ],
                [
                    'name' => 'budget_status',
                    'description' => 'Checks current monthly category budgets, progress, spent vs limit, percentages, and alerts for over-budget categories.',
                    'parameters' => [
                        'type' => 'OBJECT',
                        'properties' => [
                            'month' => [
                                'type' => 'STRING',
                                'description' => 'Optional month in YYYY-MM format, defaults to current month',
                            ],
                        ],
                    ],
                ],
                [
                    'name' => 'recurring_spend',
                    'description' => 'Detects repeating and recurring expenses (milk, newspaper, subscriptions, rent, fuel, wifi) and reports average monthly costs and next expected payment dates.',
                    'parameters' => [
                        'type' => 'OBJECT',
                        'properties' => new stdClass(),
                    ],
                ],
                [
                    'name' => 'list_reminders',
                    'description' => 'Lists upcoming and overdue warranty deadlines, return windows, and bill payment reminders.',
                    'parameters' => [
                        'type' => 'OBJECT',
                        'properties' => new stdClass(),
                    ],
                ],
            ],
        ],
    ];
}

/**
 * Executes a whitelisted query function safely.
 * STRICT WHITELIST ENFORCEMENT: Only allowed function names execute.
 */
function execute_whitelisted_function(
    PDO $pdo,
    int $userId,
    string $functionName,
    array $args
): array {
    $allowed = [
        'get_spend_summary',
        'top_items',
        'compare_periods',
        'list_bills',
        'price_history',
        'budget_status',
        'recurring_spend',
        'list_reminders',
    ];

    if (!in_array($functionName, $allowed, true)) {
        throw new InvalidArgumentException("Unauthorized function call: '{$functionName}'. Only whitelisted analytics functions are permitted.", 403);
    }

    switch ($functionName) {
        case 'get_spend_summary':
            return query_get_spend_summary(
                $pdo,
                $userId,
                $args['period'] ?? 'this_month',
                $args['category'] ?? null,
                $args['merchant'] ?? null
            );

        case 'top_items':
            return query_top_items(
                $pdo,
                $userId,
                $args['period'] ?? 'this_month',
                (int)($args['limit'] ?? 5)
            );

        case 'compare_periods':
            return query_compare_periods(
                $pdo,
                $userId,
                $args['period_a'] ?? 'this_month',
                $args['period_b'] ?? 'last_month'
            );

        case 'list_bills':
            return query_list_bills(
                $pdo,
                $userId,
                $args
            );

        case 'price_history':
            return query_price_history(
                $pdo,
                $userId,
                (string)($args['item'] ?? '')
            );

        case 'budget_status':
            return query_budget_status(
                $pdo,
                $userId,
                $args['month'] ?? null
            );

        case 'recurring_spend':
            return query_recurring_spend(
                $pdo,
                $userId
            );

        case 'list_reminders':
            return query_list_reminders_for_chat(
                $pdo,
                $userId
            );

        default:
            throw new RuntimeException("Unimplemented whitelisted function: {$functionName}");
    }
}

/**
 * Main function: Chat with user's financial data using Gemini function calling.
 */
function answer_user_query_with_gemini(
    PDO $pdo,
    int $userId,
    string $userQuestion,
    string $preferredCurrency = 'INR'
): array {
    $userQuestion = trim($userQuestion);
    if ($userQuestion === '') {
        return ['text' => 'Please ask a spending question, e.g. "Where did I spend the most this month?".'];
    }

    $systemInstruction = <<<SYS
You are SpendSense, an intelligent and friendly expense assistant.
The current date is October 2026.
You help the user understand their spending habits by using tool functions to query their real recorded bills.
CRITICAL RULES:
1. Always call the appropriate tool function to get accurate data. NEVER invent numbers, dates, or merchants.
2. Format currency amounts in {$preferredCurrency} (₹).
3. Be concise, direct, and conversational.
4. If the user asks for comparison or biggest bills, highlight the key takeaway first.
5. If the query returns a list or breakdown, summarize it cleanly.
6. JUDGEMENT QUESTIONS: When the user asks a judgement question like "am I spending a lot?", "am I spending too much?", "is my spending high?", or "how am I doing financially?":
   - Compare this month with last month (call compare_periods) and check category budgets (call budget_status).
   - If the user has fewer than 2 months of history or only 1-2 bills recorded, state clearly: "You don't have enough spending history recorded yet to evaluate whether you are spending a lot compared to your normal habits. So far this month, you have recorded [X bill/bills] totaling ₹[Y]."
   - If there is history, benchmark this month's spending against last month and against category budgets, clearly stating the increase/decrease and any budget alerts.
SYS;

    // Check if key is configured
    $apiKey = trim((string)GEMINI_API_KEY);
    if ($apiKey === '' || $apiKey === 'your_gemini_api_key_here') {
        // Run fallback query handler
        return answer_user_query_fallback($pdo, $userId, $userQuestion, $preferredCurrency);
    }

    $tools = get_gemini_tools_declaration();

    // 1. Initial Call: User question + Tools
    $contents = [
        [
            'role' => 'user',
            'parts' => [
                ['text' => $userQuestion],
            ],
        ],
    ];

    $payload = [
        'contents' => $contents,
        'tools' => $tools,
        'systemInstruction' => [
            'parts' => [
                ['text' => $systemInstruction],
            ],
        ],
        'generationConfig' => [
            'temperature' => 0.2,
        ],
    ];

    try {
        $response = call_gemini_api($payload, 30);
        $candidate = $response['candidates'][0] ?? null;

        if (!$candidate) {
            throw new RuntimeException('No response candidate from Gemini.');
        }

        $parts = $candidate['content']['parts'] ?? [];
        $functionCallPart = null;
        $directText = '';

        foreach ($parts as $p) {
            if (isset($p['functionCall'])) {
                $functionCallPart = $p['functionCall'];
                break;
            }
            if (isset($p['text'])) {
                $directText .= $p['text'];
            }
        }

        // If Gemini did not call a function, return its direct answer
        if (!$functionCallPart) {
            return [
                'text' => trim($directText) ?: "I couldn't find specific data for that. You can ask things like \"Where did I spend the most this month?\" or \"Show my 5 biggest bills\".",
                'function_called' => null,
            ];
        }

        // 2. Execute Whitelisted Function
        $funcName = (string)$functionCallPart['name'];
        $funcArgs = (array)($functionCallPart['args'] ?? []);
        $queryResult = execute_whitelisted_function($pdo, $userId, $funcName, $funcArgs);

        // 3. Second Call: Pass function output back to Gemini for natural language synthesis
        $contents[] = [
            'role' => 'model',
            'parts' => [
                [
                    'functionCall' => [
                        'name' => $funcName,
                        'args' => $funcArgs,
                    ],
                ],
            ],
        ];

        $contents[] = [
            'role' => 'function',
            'parts' => [
                [
                    'functionResponse' => [
                        'name' => $funcName,
                        'response' => [
                            'name' => $funcName,
                            'content' => $queryResult,
                        ],
                    ],
                ],
            ],
        ];

        $secondPayload = [
            'contents' => $contents,
            'tools' => $tools,
            'systemInstruction' => [
                'parts' => [
                    ['text' => $systemInstruction],
                ],
            ],
            'generationConfig' => [
                'temperature' => 0.2,
            ],
        ];

        $secondResponse = call_gemini_api($secondPayload, 30);
        $finalText = $secondResponse['candidates'][0]['content']['parts'][0]['text'] ?? '';

        // Generate optional visualization metadata
        $visualization = build_visualization_metadata($funcName, $queryResult);

        return [
            'text' => trim($finalText),
            'function_called' => $funcName,
            'function_args' => $funcArgs,
            'data' => $queryResult,
            'visualization' => $visualization,
        ];

    } catch (Throwable $e) {
        // Fallback to local heuristic query parser if Gemini fails (e.g. quota, timeout, network)
        return answer_user_query_fallback($pdo, $userId, $userQuestion, $preferredCurrency);
    }
}

/**
 * Heuristic fallback parser when Gemini API key is missing or quota is exceeded.
 * Guarantees that chat-with-data always answers the user's questions!
 */
function answer_user_query_fallback(
    PDO $pdo,
    int $userId,
    string $q,
    string $currency = 'INR'
): array {
    $ql = strtolower($q);

    if (str_contains($ql, 'biggest') || str_contains($ql, 'largest') || str_contains($ql, 'highest bill')) {
        $data = query_list_bills($pdo, $userId, ['order_by' => 'total_desc', 'limit' => 5]);
        $text = "Here are your top 5 biggest bills:\n\n";
        foreach ($data['bills'] as $idx => $b) {
            $text .= ($idx + 1) . ". **{$b['merchant_name']}** — ₹" . number_format((float)$b['grand_total'], 2) . " on {$b['bill_date']}\n";
        }
        return [
            'text' => $text,
            'function_called' => 'list_bills',
            'data' => $data,
            'visualization' => build_visualization_metadata('list_bills', $data),
        ];
    }

    if (str_contains($ql, 'compare') || (str_contains($ql, 'this month') && str_contains($ql, 'last month'))) {
        $data = query_compare_periods($pdo, $userId, 'this_month', 'last_month');
        $spentA = number_format($data['period_a']['total_spent'], 2);
        $spentB = number_format($data['period_b']['total_spent'], 2);
        $diff = number_format(abs($data['difference']['amount']), 2);
        $trend = $data['difference']['trend'];
        $pct = $data['difference']['percent_change'];

        $text = "Comparing your spending:\n\n"
              . "• **This Month (Oct 2026):** ₹{$spentA}\n"
              . "• **Last Month (Sep 2026):** ₹{$spentB}\n\n"
              . "Your spending has **{$trend}** by ₹{$diff} (" . abs($pct) . "%).";

        return [
            'text' => $text,
            'function_called' => 'compare_periods',
            'data' => $data,
            'visualization' => build_visualization_metadata('compare_periods', $data),
        ];
    }

    if (str_contains($ql, 'budget')) {
        $data = query_budget_status($pdo, $userId);
        if (!$data['has_budgets']) {
            return ['text' => "You haven't defined any monthly budgets yet. You can set them in the Budgets tab!"];
        }
        $text = "Here is your budget status for **{$data['month']}** (Overall: {$data['overall_percentage']}% used):\n\n";
        foreach ($data['categories'] as $c) {
            $icon = $c['status'] === 'exceeded' ? '🔴' : ($c['status'] === 'warning' ? '🟡' : '🟢');
            $text .= "{$icon} **{$c['category_name']}**: ₹" . number_format($c['spent'], 0) . " / ₹" . number_format($c['budgeted'], 0) . " ({$c['percentage_used']}%)\n";
        }
        return [
            'text' => $text,
            'function_called' => 'budget_status',
            'data' => $data,
            'visualization' => build_visualization_metadata('budget_status', $data),
        ];
    }

    if (str_contains($ql, 'reminder') || str_contains($ql, 'warranty') || str_contains($ql, 'deadline') || str_contains($ql, 'expir')) {
        $remData = query_list_reminders_for_chat($pdo, $userId);
        $dueSoon = get_due_reminders($pdo, $userId, 14);

        if (empty($remData['reminders'])) {
            $text = "You don't have any reminders set yet. When you upload electronics or retail receipts, I can suggest warranties and return deadlines for you!";
        } else {
            $text = "Here are your active reminders:\n\n";
            if (!empty($dueSoon)) {
                $text .= "⚠️ **Due Soon or Overdue:**\n";
                foreach ($dueSoon as $ds) {
                    $statusBadge = ($ds['days_remaining'] < 0) ? '🔴 Overdue' : (($ds['days_remaining'] === 0) ? '🟡 Due Today' : "🟢 In {$ds['days_remaining']} days");
                    $text .= "• **{$ds['title']}** — Due {$ds['due_date']} ({$statusBadge})\n";
                }
                $text .= "\n";
            }
            if (!empty($remData['upcoming'])) {
                $text .= "**Upcoming Coverage & Deadlines:**\n";
                foreach (array_slice($remData['upcoming'], 0, 5) as $up) {
                    $text .= "• **{$up['title']}** — Expires {$up['due_date']} ({$up['days_remaining']} days left)\n";
                }
            }
        }
        return [
            'text' => trim($text),
            'function_called' => 'list_reminders',
            'data' => $remData,
        ];
    }

    if (str_contains($ql, 'recurring') || str_contains($ql, 'repeat') || str_contains($ql, 'subscription') || str_contains($ql, 'monthly bill') || str_contains($ql, 'regular')) {
        $recData = query_recurring_spend($pdo, $userId);
        if (empty($recData['recurring_items'])) {
            $text = "I haven't detected recurring expenses yet. As you record repeat bills (like milk, rent, wifi, or fuel), they will be listed here with estimated monthly costs!";
        } else {
            $totalEst = number_format($recData['total_estimated_monthly'], 2);
            $text = "Here are your detected recurring expenses (Estimated Monthly: **₹{$totalEst}**):\n\n";
            foreach (array_slice($recData['recurring_items'], 0, 6) as $r) {
                $cost = number_format($r['avg_monthly_cost'], 2);
                $text .= "• **{$r['item_name']}** ({$r['frequency']}) — ~₹{$cost}/mo &bull; Next expected: {$r['next_expected_date']}\n";
            }
        }
        return [
            'text' => trim($text),
            'function_called' => 'recurring_spend',
            'data' => $recData,
        ];
    }

    // Judgement questions: "am I spending a lot?", "am I spending too much?", "is my spending high?"
    if (
        str_contains($ql, 'spending a lot') || 
        str_contains($ql, 'spending too much') || 
        str_contains($ql, 'am i spending') || 
        str_contains($ql, 'spending high') ||
        str_contains($ql, 'is my spending') ||
        str_contains($ql, 'overspending')
    ) {
        $histStmt = $pdo->prepare("SELECT DISTINCT SUBSTR(bill_date, 1, 7) AS ym FROM bills WHERE user_id = ? AND status != 'discarded'");
        $histStmt->execute([$userId]);
        $recordedMonths = $histStmt->fetchAll(PDO::FETCH_COLUMN);

        $billCountStmt = $pdo->prepare("SELECT COUNT(*) FROM bills WHERE user_id = ? AND status != 'discarded'");
        $billCountStmt->execute([$userId]);
        $totalBillsCount = (int)$billCountStmt->fetchColumn();

        if (count($recordedMonths) < 2 || $totalBillsCount <= 2) {
            $curSummary = query_get_spend_summary($pdo, $userId, 'this_month');
            $bCount = $curSummary['bill_count'];
            $bLabel = $bCount === 1 ? '1 bill' : "{$bCount} bills";
            $curTot = number_format($curSummary['total_spent'], 2);

            return [
                'text' => "You don't have enough spending history recorded yet to evaluate whether you are spending a lot compared to your normal habits. So far this month ({$curSummary['period']}), you have recorded {$bLabel} totaling **₹{$curTot}**. As you upload more receipts across multiple months, I will be able to benchmark your spending trends and alert you to unusual spikes.",
                'function_called' => 'get_spend_summary',
                'data' => $curSummary,
            ];
        }

        $comp = query_compare_periods($pdo, $userId, 'this_month', 'last_month');
        $bgt = query_budget_status($pdo, $userId);

        $spentA = number_format($comp['period_a']['total_spent'], 2);
        $spentB = number_format($comp['period_b']['total_spent'], 2);
        $diff = number_format(abs($comp['difference']['amount']), 2);
        $pct = abs($comp['difference']['percent_change']);
        $trend = $comp['difference']['trend'];

        $bgtText = '';
        if ($bgt['has_budgets']) {
            $overBudget = array_filter($bgt['categories'], fn($c) => $c['status'] === 'exceeded');
            $warnBudget = array_filter($bgt['categories'], fn($c) => $c['status'] === 'warning');
            if (!empty($overBudget)) {
                $overNames = implode(', ', array_map(fn($c) => $c['category_name'], $overBudget));
                $bgtText = "\n\n⚠️ You have **exceeded your budget** in: {$overNames}.";
            } elseif (!empty($warnBudget)) {
                $warnNames = implode(', ', array_map(fn($c) => $c['category_name'], $warnBudget));
                $bgtText = "\n\n⚠️ You are approaching 80% of your budget limit in: {$warnNames}.";
            } else {
                $bgtText = "\n\n✅ All your categories are currently within their monthly budgets.";
            }
        }

        if ($trend === 'increased') {
            $verdict = "Yes, your spending is trending higher this month.";
            $explanation = "You have spent **₹{$spentA}** this month compared to **₹{$spentB}** last month (an increase of **₹{$diff}** or **{$pct}%**).";
        } elseif ($trend === 'decreased') {
            $verdict = "No, you are actually spending less this month!";
            $explanation = "You have spent **₹{$spentA}** this month compared to **₹{$spentB}** last month (a decrease of **₹{$diff}** or **{$pct}%**).";
        } else {
            $verdict = "Your spending is steady.";
            $explanation = "You have spent **₹{$spentA}** this month, virtually identical to last month's **₹{$spentB}**.";
        }

        return [
            'text' => "{$verdict}\n\n{$explanation}{$bgtText}",
            'function_called' => 'compare_periods',
            'data' => $comp,
            'visualization' => build_visualization_metadata('compare_periods', $comp),
        ];
    }

    if (str_contains($ql, 'milk') || str_contains($ql, 'cheaper') || str_contains($ql, 'price') || str_contains($ql, 'rate')) {
        $item = str_contains($ql, 'milk') ? 'milk' : (str_contains($ql, 'oil') ? 'oil' : 'rice');
        $data = query_price_history($pdo, $userId, $item);
        if (empty($data['history'])) {
            return ['text' => "I couldn't find any purchases for \"{$item}\" in your recorded bills."];
        }
        $cheapest = $data['cheapest_at'];
        $text = "For **{$item}**, the cheapest store is **{$cheapest['merchant']}** at ₹{$cheapest['price']} on {$cheapest['date']}.\n\n"
              . "Latest recorded price is ₹{$data['latest_price']}.";
        return [
            'text' => $text,
            'function_called' => 'price_history',
            'data' => $data,
            'visualization' => build_visualization_metadata('price_history', $data),
        ];
    }

    if (str_contains($ql, 'reminder') || str_contains($ql, 'warranty') || str_contains($ql, 'deadline') || str_contains($ql, 'due date') || str_contains($ql, 'expir')) {
        $remData = query_list_reminders_for_chat($pdo, $userId);
        $totalCount = $remData['total_count'];
        if ($totalCount === 0) {
            return [
                'text' => "You don't have any active warranty or return deadlines saved. You can add one from the Reminders tab or when saving an electronics or apparel bill!",
                'function_called' => 'list_reminders',
                'data' => $remData,
            ];
        }
        $text = "Here are your active reminders and deadlines ({$totalCount}):\n\n";
        foreach ($remData['reminders'] as $r) {
            $statusIcon = $r['status'] === 'overdue' ? '🔴' : ($r['status'] === 'due_soon' ? '⚠️' : '⏰');
            $text .= "{$statusIcon} **{$r['title']}** — Due: {$r['due_date']} ({$r['days_remaining']})\n";
        }
        return [
            'text' => $text,
            'function_called' => 'list_reminders',
            'data' => $remData,
        ];
    }

    if (str_contains($ql, 'recurring') || str_contains($ql, 'repeat') || str_contains($ql, 'subscription') || str_contains($ql, 'regularly')) {
        $recData = query_recurring_spend($pdo, $userId);
        if (empty($recData['items'])) {
            return [
                'text' => "I haven't detected recurring repeat purchases yet (e.g. daily milk, monthly rent, or broadband subscriptions). As you record multiple bills, I will automatically calculate your repeating monthly commitments.",
                'function_called' => 'recurring_spend',
                'data' => $recData,
            ];
        }
        $totRec = number_format((float)$recData['total_recurring_monthly'], 2);
        $text = "Based on your bills, your estimated recurring expenses total **₹{$totRec}/month**:\n\n";
        foreach ($recData['items'] as $item) {
            $cost = number_format((float)$item['estimated_monthly_cost'], 2);
            $text .= "• **{$item['item_name']}**: ~₹{$cost}/mo ({$item['frequency']}) — Next expected: {$item['next_expected_date']}\n";
        }
        return [
            'text' => $text,
            'function_called' => 'recurring_spend',
            'data' => $recData,
        ];
    }

    if (str_contains($ql, 'snacks') || str_contains($ql, 'food') || str_contains($ql, 'grocer')) {
        $cat = str_contains($ql, 'snacks') ? 'Groceries & Supermarket' : (str_contains($ql, 'food') ? 'Food & Dining' : 'Groceries & Supermarket');
        $period = str_contains($ql, 'last month') ? 'last_month' : 'this_month';
        $data = query_get_spend_summary($pdo, $userId, $period, $cat);
        $tot = number_format($data['total_spent'], 2);
        $txLabel = $data['bill_count'] === 1 ? '1 transaction' : "{$data['bill_count']} transactions";
        $text = "In {$data['period']}, you spent **₹{$tot}** on {$cat} across {$txLabel}.";
        return [
            'text' => $text,
            'function_called' => 'get_spend_summary',
            'data' => $data,
            'visualization' => build_visualization_metadata('get_spend_summary', $data),
        ];
    }

    // Default: Spend summary this month
    $period = str_contains($ql, 'last month') ? 'last_month' : 'this_month';
    $data = query_get_spend_summary($pdo, $userId, $period);
    $tot = number_format($data['total_spent'], 2);
    $bLabel = $data['bill_count'] === 1 ? '1 bill' : "{$data['bill_count']} bills";
    $topCat = !empty($data['category_breakdown']) ? $data['category_breakdown'][0]['category_name'] : 'Groceries';
    $topCatSpend = !empty($data['category_breakdown']) ? number_format((float)$data['category_breakdown'][0]['category_spend'], 2) : '0';

    $text = "In **{$data['period']}**, your total spending is **₹{$tot}** across {$bLabel}.\n\n"
          . "Your highest expenditure was on **{$topCat}** (₹{$topCatSpend}).";

    return [
        'text' => $text,
        'function_called' => 'get_spend_summary',
        'data' => $data,
        'visualization' => build_visualization_metadata('get_spend_summary', $data),
    ];
}

/**
 * Builds visualization metadata (chart or table) from function results for chat UI rendering.
 */
function build_visualization_metadata(string $funcName, array $data): ?array {
    if ($funcName === 'get_spend_summary' && !empty($data['category_breakdown'])) {
        $labels = [];
        $values = [];
        foreach (array_slice($data['category_breakdown'], 0, 5) as $cat) {
            $labels[] = $cat['category_name'];
            $values[] = (float)$cat['category_spend'];
        }
        return [
            'type' => 'donut_chart',
            'title' => 'Spending by Category (' . ($data['period'] ?? '') . ')',
            'labels' => $labels,
            'values' => $values,
        ];
    }

    if ($funcName === 'compare_periods') {
        return [
            'type' => 'bar_chart',
            'title' => 'Period Comparison',
            'labels' => [$data['period_b']['label'] ?? 'Last Period', $data['period_a']['label'] ?? 'This Period'],
            'values' => [$data['period_b']['total_spent'] ?? 0, $data['period_a']['total_spent'] ?? 0],
        ];
    }

    if ($funcName === 'budget_status' && !empty($data['categories'])) {
        $labels = [];
        $spent = [];
        $limits = [];
        foreach ($data['categories'] as $c) {
            $labels[] = $c['category_name'];
            $spent[] = (float)$c['spent'];
            $limits[] = (float)$c['budgeted'];
        }
        return [
            'type' => 'budget_bars',
            'title' => 'Category Budgets vs Spent',
            'labels' => $labels,
            'spent' => $spent,
            'limits' => $limits,
        ];
    }

    if ($funcName === 'list_bills' && !empty($data['bills'])) {
        return [
            'type' => 'table',
            'title' => 'Bills List',
            'headers' => ['Merchant', 'Date', 'Total'],
            'rows' => array_map(function($b) {
                return [$b['merchant_name'], $b['bill_date'], '₹' . number_format((float)$b['grand_total'], 2)];
            }, $data['bills']),
        ];
    }

    return null;
}
