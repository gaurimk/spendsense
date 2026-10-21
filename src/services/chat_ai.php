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
 * Generates dynamic, contextual follow-up questions to keep the conversation flowing smoothly.
 */
function get_contextual_followups(string $funcName, array $data = [], string $mode = 'personal'): array {
    if ($mode === 'business' || $mode === 'shop') {
        switch ($funcName) {
            case 'get_spend_summary':
                return [
                    'Check GST Input Tax Credit (ITC)',
                    'Who are my top wholesale suppliers?',
                ];
            case 'compare_periods':
                return [
                    'Which procurement category increased most?',
                    'Compare wholesale distributor rates',
                ];
            case 'list_bills':
                return [
                    'Show biggest supplier invoice',
                    'View unpaid supplier payables',
                ];
            default:
                return [];
        }
    }

    switch ($funcName) {
        case 'get_spend_summary':
            return [
                'Compare spending with last month',
                'Am I on track with my monthly budget?',
            ];
        case 'compare_periods':
            return [
                'Which category increased the most?',
                'Show my 5 biggest bills',
            ];
        case 'top_items':
            return [
                'Which supermarket has the lowest prices?',
                'What are my recurring monthly expenses?',
            ];
        case 'price_history':
            return [
                'Which store is cheapest overall?',
                'Show recent grocery bills',
            ];
        case 'budget_status':
            return [
                'Show categories exceeding budget',
                'Compare spending with last month',
            ];
        case 'recurring_spend':
            return [
                'Cheapest store for recurring items',
                'Check warranty and return deadlines',
            ];
        case 'list_reminders':
            return [
                'Show deadlines due within 7 days',
                'Upload a new receipt',
            ];
        case 'list_bills':
            return [
                'Where did I spend the most this month?',
                'Compare spending with last month',
            ];
        default:
            return [];
    }
}

/**
 * Strips all Unicode emojis, pictographs, and casual symbols to maintain professional corporate text.
 */
function strip_emojis(string $text): string {
    $pattern = '/[\x{1F300}-\x{1F5FF}\x{1F600}-\x{1F64F}\x{1F680}-\x{1F6FF}\x{1F700}-\x{1F77F}\x{1F780}-\x{1F7FF}\x{1F800}-\x{1F8FF}\x{1F900}-\x{1F9FF}\x{1FA00}-\x{1FA6F}\x{1FA70}-\x{1FAFF}\x{2600}-\x{26FF}\x{2700}-\x{27BF}\x{2300}-\x{23FF}\x{2B50}\x{200D}\x{FE0E}\x{FE0F}]/u';
    $clean = preg_replace($pattern, '', $text);
    $clean = preg_replace('/[ \t]{2,}/', ' ', $clean);
    return trim($clean);
}

/**
 * Main function: Chat with user's financial data using Gemini function calling.
 */
function answer_user_query_with_gemini(
    PDO $pdo,
    int $userId,
    string $userQuestion,
    string $preferredCurrency = 'INR',
    string $mode = 'personal'
): array {
    $userQuestion = trim($userQuestion);
    if ($userQuestion === '') {
        return ['text' => 'Please ask a spending question, e.g. "Where did I spend the most this month?".'];
    }

    $systemInstruction = <<<SYS
You are SpendSense, an articulate, highly competent, professional financial intelligence analyst and expense management assistant.
The current date is October 2026.
Your communication style is polished, objective, concise, and professional.

STRICT TONE AND FORMATTING RULES:
1. NEVER USE ANY EMOJIS UNDER ANY CIRCUMSTANCES. No smileys, symbols, or pictograms. Ensure all text looks human, professional, and corporate.
2. Maintain a professional, executive advisory tone. Write clear, well-structured, grammatical sentences.
3. Always retrieve accurate data by calling the appropriate tool function. Never fabricate numbers, dates, or merchants.
4. Format all currency amounts with {$preferredCurrency} (₹).
5. Present financial observations clearly and concisely. Highlight variance, budget limits, and key trends objectively.
6. When greeting or introducing yourself, be professional and concise: "Welcome to SpendSense. I can assist you in analyzing your bills, tracking category budgets, monitoring store prices, and reviewing recurring expenses. How may I assist you today?"
7. When closing an answer, offer a brief, relevant follow-up inquiry without hype (e.g. "Would you like to examine category breakdown details or compare these figures with your previous month?").
8. JUDGEMENT QUESTIONS: When the user asks "am I spending a lot?", "am I spending too much?", "is my spending high?", or "how am I doing financially?":
   - Compare this month with last month (call compare_periods) and review category budgets (call budget_status).
   - If the user has fewer than 2 months of history or only 1-2 bills recorded, state clearly: "You don't have enough spending history recorded yet to evaluate whether you are spending a lot compared to your normal habits. So far this month, you have recorded [X bill/bills] totaling ₹[Y]."
   - If history exists, benchmark current spend against previous periods and budget limits, stating numerical deltas and budget limit notifications clearly.
SYS;

    if ($mode === 'business' || $mode === 'shop') {
        $systemInstruction .= "\n\nCOMMERCIAL WORKSPACE CONTEXT:\n"
            . "- You are operating in Commercial / Business Mode as an enterprise procurement and business accounting analyst.\n"
            . "- Treat expenses as commercial invoices, vendor disbursements, inventory procurement, and operating overhead.\n"
            . "- Refer to merchants as Suppliers, Vendors, or Distributors as appropriate.\n"
            . "- Highlight GST subtotal taxable values, Input Tax Credit (ITC) eligibility, and vendor unit price variances objectively.\n"
            . "- Track supplier credit terms (Net-15/30) and pending payable obligations professionally.\n"
            . "- STRICTLY DO NOT USE ANY EMOJIS.";
    }

    // Check if key is configured
    $apiKey = trim((string)GEMINI_API_KEY);
    if ($apiKey === '' || $apiKey === 'your_gemini_api_key_here') {
        // Run fallback query handler
        return answer_user_query_fallback($pdo, $userId, $userQuestion, $preferredCurrency, $mode);
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
            $directClean = strip_emojis(trim($directText));
            if ($directClean === '') {
                $directClean = "I can assist you with your expense records, category budgets, vendor price histories, and recurring commitments. You may ask questions such as \"Where did I spend the most this month?\" or \"Show my 5 biggest bills\".";
            }
            return [
                'text' => $directClean,
                'function_called' => null,
                'followups' => null,
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

        $finalClean = strip_emojis(trim($finalText));

        return [
            'text' => $finalClean,
            'function_called' => $funcName,
            'function_args' => $funcArgs,
            'data' => $queryResult,
            'visualization' => $visualization,
            'followups' => get_contextual_followups($funcName, $queryResult, $mode),
        ];

    } catch (Throwable $e) {
        // Fallback to local heuristic query parser if Gemini fails (e.g. quota, timeout, network)
        return answer_user_query_fallback($pdo, $userId, $userQuestion, $preferredCurrency, $mode);
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
    string $currency = 'INR',
    string $mode = 'personal'
): array {
    $ql = strtolower($q);

    // Direct greetings or help inquiries: no data query, no followups
    if (preg_match('/^(hi|hello|hey|greetings|good\s+(morning|afternoon|evening)|who\s+are\s+you|what\s+can\s+you\s+do|help)\b/i', trim($ql))) {
        return [
            'text' => "Hello! I am your SpendSense financial intelligence assistant. I can assist you with your expense records, category budgets, vendor price histories, and recurring commitments.",
            'function_called' => null,
            'followups' => null,
        ];
    }

    // Refusal / Security / Out of bounds queries: no followups
    if (preg_match('/(other\s+user|rest\s+of\s+user|backend\s+storage|database\s+access|give\s+me.*access|grant.*access|show.*users|admin\s+password)/i', $ql)) {
        return [
            'text' => "I cannot fulfill this request. I do not have access to backend storage systems or other users' data, and I am restricted strictly to analyzing your personal expense records.",
            'function_called' => null,
            'followups' => null,
        ];
    }

    if (str_contains($ql, 'biggest') || str_contains($ql, 'largest') || str_contains($ql, 'highest bill')) {
        $data = query_list_bills($pdo, $userId, ['order_by' => 'total_desc', 'limit' => 5]);
        if (empty($data['bills'])) {
            $text = "You have not recorded any bills yet. Upload a receipt or select Load 40 Demo Bills to review your largest expenditures.";
            return [
                'text' => $text,
                'function_called' => 'list_bills',
                'data' => $data,
                'visualization' => null,
                'followups' => null,
            ];
        } else {
            $count = count($data['bills']);
            $label = $count === 5 ? "top 5 biggest bills" : "{$count} recorded bills";
            $text = "Here are your {$label} sorted by total amount:\n\n";
            foreach ($data['bills'] as $idx => $b) {
                $text .= ($idx + 1) . ". **{$b['merchant_name']}** — ₹" . number_format((float)$b['grand_total'], 2) . " on {$b['bill_date']}\n";
            }
            $text .= "\nWould you like to examine line items or compare these against your category budgets?";
        }
        return [
            'text' => $text,
            'function_called' => 'list_bills',
            'data' => $data,
            'visualization' => build_visualization_metadata('list_bills', $data),
            'followups' => get_contextual_followups('list_bills', $data, $mode),
        ];
    }

    if (str_contains($ql, 'compare') || (str_contains($ql, 'this month') && str_contains($ql, 'last month'))) {
        $data = query_compare_periods($pdo, $userId, 'this_month', 'last_month');
        $spentA = number_format($data['period_a']['total_spent'], 2);
        $spentB = number_format($data['period_b']['total_spent'], 2);
        $diff = number_format(abs($data['difference']['amount']), 2);
        $trend = $data['difference']['trend'];
        $pct = $data['difference']['percent_change'];

        $text = "Spending comparison between billing periods:\n\n"
              . "• **This Month (Oct 2026):** ₹{$spentA}\n"
              . "• **Last Month (Sep 2026):** ₹{$spentB}\n\n"
              . "Your spending has **{$trend}** by ₹{$diff} (" . abs($pct) . "%).";

        return [
            'text' => $text,
            'function_called' => 'compare_periods',
            'data' => $data,
            'visualization' => build_visualization_metadata('compare_periods', $data),
            'followups' => get_contextual_followups('compare_periods', $data, $mode),
        ];
    }

    if (str_contains($ql, 'budget')) {
        $data = query_budget_status($pdo, $userId);
        if (!$data['has_budgets']) {
            return [
                'text' => "You have not defined monthly budgets yet. You can configure category limits in the Budgets tab.",
                'followups' => null,
            ];
        }
        $text = "Budget status for **{$data['month']}** (Overall utilization: {$data['overall_percentage']}%):\n\n";
        foreach ($data['categories'] as $c) {
            $statusLabel = $c['status'] === 'exceeded' ? '[Exceeded]' : ($c['status'] === 'warning' ? '[Warning]' : '[On Track]');
            $text .= "• **{$c['category_name']}**: ₹" . number_format($c['spent'], 0) . " / ₹" . number_format($c['budgeted'], 0) . " ({$c['percentage_used']}% - {$statusLabel})\n";
        }
        $text .= "\nWould you like a breakdown of any specific category?";
        return [
            'text' => $text,
            'function_called' => 'budget_status',
            'data' => $data,
            'visualization' => build_visualization_metadata('budget_status', $data),
            'followups' => get_contextual_followups('budget_status', $data, $mode),
        ];
    }

    if (str_contains($ql, 'reminder') || str_contains($ql, 'warranty') || str_contains($ql, 'deadline') || str_contains($ql, 'expir')) {
        $remData = query_list_reminders_for_chat($pdo, $userId);
        $dueSoon = get_due_reminders($pdo, $userId, 14);

        if (empty($remData['reminders'])) {
            $text = "You do not have any active reminders set. When you upload electronics or retail bills, warranty coverage and return deadlines can be automatically scheduled.";
        } else {
            $text = "Active Reminders and Deadlines:\n\n";
            if (!empty($dueSoon)) {
                $text .= "Due Soon or Overdue:\n";
                foreach ($dueSoon as $ds) {
                    $statusBadge = ($ds['days_remaining'] < 0) ? 'Overdue' : (($ds['days_remaining'] === 0) ? 'Due Today' : "In {$ds['days_remaining']} days");
                    $text .= "• **{$ds['title']}** — Due {$ds['due_date']} ({$statusBadge})\n";
                }
                $text .= "\n";
            }
            if (!empty($remData['upcoming'])) {
                $text .= "Upcoming Coverage and Deadlines:\n";
                foreach (array_slice($remData['upcoming'], 0, 5) as $up) {
                    $text .= "• **{$up['title']}** — Expires {$up['due_date']} ({$up['days_remaining']} days remaining)\n";
                }
            }
        }
        return [
            'text' => trim($text),
            'function_called' => 'list_reminders',
            'data' => $remData,
            'followups' => !empty($remData['reminders']) ? get_contextual_followups('list_reminders', $remData, $mode) : null,
        ];
    }

    if (str_contains($ql, 'recurring') || str_contains($ql, 'repeat') || str_contains($ql, 'subscription') || str_contains($ql, 'monthly bill') || str_contains($ql, 'regular')) {
        $recData = query_recurring_spend($pdo, $userId);
        if (empty($recData['recurring_items'])) {
            $text = "No recurring expenses detected yet. Repeat purchases (such as milk, utilities, rent, or subscriptions) will be compiled here with estimated monthly commitments.";
        } else {
            $totalEst = number_format($recData['total_estimated_monthly'], 2);
            $text = "Identified Recurring Expenses (Estimated Monthly Commitment: **₹{$totalEst}**):\n\n";
            foreach (array_slice($recData['recurring_items'], 0, 6) as $r) {
                $cost = number_format($r['avg_monthly_cost'], 2);
                $text .= "• **{$r['item_name']}** ({$r['frequency']}) — ~₹{$cost}/mo — Next expected: {$r['next_expected_date']}\n";
            }
            $text .= "\nWould you like to review price trends for any of these repeating items?";
        }
        return [
            'text' => trim($text),
            'function_called' => 'recurring_spend',
            'data' => $recData,
            'followups' => !empty($recData['recurring_items']) ? get_contextual_followups('recurring_spend', $recData, $mode) : null,
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
                'text' => "You don't have enough spending history recorded yet to evaluate whether you are spending a lot compared to your normal habits. So far this month ({$curSummary['period']}), you have recorded {$bLabel} totaling **₹{$curTot}**. As you upload additional receipts across consecutive months, benchmark analysis will identify variations and spending trends.",
                'function_called' => 'get_spend_summary',
                'data' => $curSummary,
                'followups' => null,
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
                $bgtText = "\n\nNotice: You have **exceeded your budget** in: {$overNames}.";
            } elseif (!empty($warnBudget)) {
                $warnNames = implode(', ', array_map(fn($c) => $c['category_name'], $warnBudget));
                $bgtText = "\n\nNotice: You are approaching 80% of your budget limit in: {$warnNames}.";
            } else {
                $bgtText = "\n\nAll categories are currently within their monthly budget limits.";
            }
        }

        if ($trend === 'increased') {
            $verdict = "Yes, your spending is trending higher this month.";
            $explanation = "You have spent **₹{$spentA}** this month compared to **₹{$spentB}** last month (an increase of **₹{$diff}** or **{$pct}%**).";
        } elseif ($trend === 'decreased') {
            $verdict = "No, your spending is lower this month.";
            $explanation = "You have spent **₹{$spentA}** this month compared to **₹{$spentB}** last month (a decrease of **₹{$diff}** or **{$pct}%**).";
        } else {
            $verdict = "Your spending is steady.";
            $explanation = "You have spent **₹{$spentA}** this month, virtually identical to last month's **₹{$spentB}**.";
        }

        return [
            'text' => "{$verdict}\n\n{$explanation}{$bgtText}\n\nWould you like to examine your largest expenditures or review category allocations?",
            'function_called' => 'compare_periods',
            'data' => $comp,
            'visualization' => build_visualization_metadata('compare_periods', $comp),
            'followups' => get_contextual_followups('compare_periods', $comp, $mode),
        ];
    }

    if (str_contains($ql, 'milk') || str_contains($ql, 'cheaper') || str_contains($ql, 'price') || str_contains($ql, 'rate')) {
        $item = str_contains($ql, 'milk') ? 'milk' : (str_contains($ql, 'oil') ? 'oil' : 'rice');
        $data = query_price_history($pdo, $userId, $item);
        if (empty($data['history'])) {
            return [
                'text' => "No purchase records found for \"{$item}\" in your recorded bills. Upload receipts containing {$item} to begin price tracking.",
                'followups' => null,
            ];
        }
        $cheapest = $data['cheapest_at'];
        $text = "Price analysis for **{$item}**:\n\n"
              . "• Lowest recorded price: **{$cheapest['merchant']}** at ₹{$cheapest['price']} on {$cheapest['date']}.\n"
              . "• Latest recorded price: ₹{$data['latest_price']}.\n\n"
              . "Purchasing from {$cheapest['merchant']} provides the most competitive rate based on your records.";
        return [
            'text' => $text,
            'function_called' => 'price_history',
            'data' => $data,
            'visualization' => build_visualization_metadata('price_history', $data),
            'followups' => get_contextual_followups('price_history', $data, $mode),
        ];
    }

    if (str_contains($ql, 'payable') || str_contains($ql, 'vendor') || str_contains($ql, 'supplier payable') || str_contains($ql, 'pending due')) {
        $remData = query_list_reminders_for_chat($pdo, $userId);
        $totalCount = (int)($remData['counts']['total'] ?? count($remData['reminders'] ?? []));
        if ($totalCount === 0) {
            return [
                'text' => "You have **no pending payables or supplier dues** recorded. When you save supplier invoices with credit terms (such as Net-15 or Net-30), payment deadlines will appear here.",
                'function_called' => 'list_reminders',
                'data' => $remData,
                'followups' => null,
            ];
        }
        $text = "Pending supplier payables and due dates ({$totalCount}):\n\n";
        foreach ($remData['reminders'] as $r) {
            $text .= "• **{$r['title']}** — Due: {$r['due_date']} ({$r['days_remaining']})\n";
        }
        return [
            'text' => $text,
            'function_called' => 'list_reminders',
            'data' => $remData,
            'followups' => get_contextual_followups('list_reminders', $remData, $mode),
        ];
    }

    if (str_contains($ql, 'gst') || str_contains($ql, 'tax')) {
        $taxStmt = $pdo->prepare("
            SELECT 
                COUNT(*) as bill_count,
                ROUND(COALESCE(SUM(tax_amount), 0), 2) as total_tax,
                ROUND(COALESCE(SUM(subtotal), 0), 2) as total_subtotal,
                ROUND(COALESCE(SUM(grand_total), 0), 2) as total_grand
            FROM bills
            WHERE user_id = ? AND strftime('%Y-%m', bill_date) = strftime('%Y-%m', 'now')
        ");
        $taxStmt->execute([$userId]);
        $taxInfo = $taxStmt->fetch();
        $totalTax = number_format((float)($taxInfo['total_tax'] ?? 0), 2);
        $totalGrand = number_format((float)($taxInfo['total_grand'] ?? 0), 2);
        $totalSub = number_format((float)($taxInfo['total_subtotal'] ?? 0), 2);
        $count = (int)($taxInfo['bill_count'] ?? 0);

        if ($count === 0) {
            $text = "No tax invoices or bills recorded for this month yet. Upload supplier invoices or purchase bills to compute your GST and tax breakdown.";
        } else {
            $text = "GST and Tax Summary for current month across **{$count} bill(s)**:\n\n"
                  . "• **Taxable Value (Subtotal):** ₹{$totalSub}\n"
                  . "• **Total GST / Tax Paid:** ₹{$totalTax}\n"
                  . "• **Gross Total:** ₹{$totalGrand}\n\n"
                  . "You can export the full line items CSV in Settings for Input Tax Credit (ITC) reconciliation.";
        }
        return [
            'text' => $text,
            'followups' => ($count > 0) ? get_contextual_followups('get_spend_summary', [], $mode) : null,
        ];
    }

    if (str_contains($ql, 'wholesale') || str_contains($ql, 'supplier') || str_contains($ql, 'distributor')) {
        $merchStmt = $pdo->prepare("
            SELECT merchant_name, COUNT(*) as bill_count, ROUND(SUM(grand_total), 2) as total_amount, ROUND(AVG(grand_total), 2) as avg_order
            FROM bills
            WHERE user_id = ? AND merchant_name IS NOT NULL
            GROUP BY merchant_name
            ORDER BY total_amount DESC
            LIMIT 5
        ");
        $merchStmt->execute([$userId]);
        $suppliers = $merchStmt->fetchAll();

        if (empty($suppliers)) {
            $text = "You have not recorded any supplier or wholesale purchase bills yet. Upload an invoice to begin vendor procurement tracking.";
        } else {
            $text = "Top suppliers and wholesale vendors by total spend:\n\n";
            foreach ($suppliers as $s) {
                $tot = number_format((float)$s['total_amount'], 2);
                $avg = number_format((float)$s['avg_order'], 2);
                $text .= "• **{$s['merchant_name']}**: ₹{$tot} across {$s['bill_count']} orders (Average: ₹{$avg})\n";
            }
            $text .= "\nWould you like to review pending payables or compare unit costs?";
        }
        return [
            'text' => $text,
            'followups' => !empty($suppliers) ? get_contextual_followups('list_bills', [], $mode) : null,
        ];
    }

    if (str_contains($ql, 'snacks') || str_contains($ql, 'food') || str_contains($ql, 'grocer')) {
        $cat = str_contains($ql, 'snacks') ? 'Groceries & Supermarket' : (str_contains($ql, 'food') ? 'Food & Dining' : 'Groceries & Supermarket');
        $period = str_contains($ql, 'last month') ? 'last_month' : 'this_month';
        $data = query_get_spend_summary($pdo, $userId, $period, $cat);
        $tot = number_format($data['total_spent'], 2);
        $txLabel = $data['bill_count'] === 1 ? '1 transaction' : "{$data['bill_count']} transactions";
        $text = "In {$data['period']}, expenditure on **{$cat}** was **₹{$tot}** across {$txLabel}.\n\nWould you like to examine specific item prices or review your monthly category limit?";
        return [
            'text' => $text,
            'function_called' => 'get_spend_summary',
            'data' => $data,
            'visualization' => build_visualization_metadata('get_spend_summary', $data),
            'followups' => get_contextual_followups('get_spend_summary', $data, $mode),
        ];
    }

    // If user's query has no financial or spending intent, return guidance with no followups
    $hasFinancialIntent = preg_match('/(spend|spending|expense|bill|cost|total|summary|month|bought|purchase|where\s+did|how\s+much|overview|breakdown|category|categories|rupee|rs|inr)/i', $ql);
    if (!$hasFinancialIntent) {
        return [
            'text' => "I am your SpendSense financial intelligence assistant. I can help analyze your expenses, bills, category budgets, and store price trends. You may ask a spending question, e.g. \"Where did I spend the most this month?\" or \"Show my 5 biggest bills\".",
            'function_called' => null,
            'followups' => null,
        ];
    }

    // Default: Spend summary this month
    $period = str_contains($ql, 'last month') ? 'last_month' : 'this_month';
    $data = query_get_spend_summary($pdo, $userId, $period);
    $tot = number_format($data['total_spent'], 2);
    $bLabel = $data['bill_count'] === 1 ? '1 bill' : "{$data['bill_count']} bills";
    $topCat = !empty($data['category_breakdown']) ? $data['category_breakdown'][0]['category_name'] : 'Groceries';
    $topCatSpend = !empty($data['category_breakdown']) ? number_format((float)$data['category_breakdown'][0]['category_spend'], 2) : '0';

    $text = "Summary of expenditure for **{$data['period']}**:\n\n"
          . "Total spending is **₹{$tot}** across {$bLabel}.\n\n"
          . "Largest category expenditure: **{$topCat}** (₹{$topCatSpend}).\n\n"
          . "Would you like to compare these figures against last month or review your category budgets?";

    return [
        'text' => $text,
        'function_called' => 'get_spend_summary',
        'data' => $data,
        'visualization' => build_visualization_metadata('get_spend_summary', $data),
        'followups' => ($data['bill_count'] > 0) ? get_contextual_followups('get_spend_summary', $data, $mode) : null,
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
