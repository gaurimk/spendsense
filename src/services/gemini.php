<?php
/**
 * SpendSense - Google Gemini AI Service
 * Native PHP cURL REST integration for structured bill OCR extraction and natural language chat.
 * Never logs or exposes the API key. Retries once on transient failures.
 */

declare(strict_types=1);

require_once dirname(__DIR__) . '/config.php';

/**
 * Builds the system prompt for extracting structured receipt data.
 * Adheres strictly to privacy rules (ignoring card numbers and phone numbers)
 * and India defaults (GST, UPI, cash, multilingual receipts).
 */
/**
 * Builds the system prompt for extracting structured receipt data.
 * Adheres strictly to privacy rules (ignoring card numbers and phone numbers),
 * India defaults (GST, UPI, cash, multilingual receipts), and robust handwritten / low-quality handling.
 */
function build_receipt_extraction_prompt(string $preferredCurrency = 'INR', bool $isHandwrittenRetry = false): string {
    $handwrittenFocus = $isHandwrittenRetry 
        ? "\nNOTE: This receipt has been identified as handwritten or low-legibility. Carefully examine stroke thickness, overwritten digits, Indian shop notation, and Devanagari script." 
        : "";

    return <<<PROMPT
You are SpendSense's specialized receipt and expense document parser.
You accurately extract information from supermarket receipts (e.g. DMart, Reliance, BigBasket), restaurant bills, medical / pharmacy bills, electronics invoices, fuel receipts, and local store memos.
Bills may contain text in English, Hindi, Marathi, or mixed scripts, and may be printed or handwritten.{$handwrittenFocus}

PRIVACY & SECURITY RULES (CRITICAL):
1. IGNORE and NEVER extract or return credit/debit card numbers, bank account numbers, or personal phone numbers.
2. If printed or written on the receipt, discard them completely.

PAYMENT METHOD RULE (CRITICAL FOR ALL BILLS - PRINTED AND HANDWRITTEN):
1. ONLY return a payment_method if the bill text EXPLICITLY and visibly displays one (e.g. "UPI", "Google Pay", "PhonePe", "Paytm", "Cash", "Card", "Debit Card", "Credit Card", "Net Banking", "Cheque").
2. If the bill does NOT explicitly state the payment method, YOU MUST RETURN null for "payment_method".
3. NEVER guess, assume, or default to "UPI", "Cash", or any other method for printed or handwritten bills.
4. If a payment method is inferred with any uncertainty, set "payment_method_confidence" to "medium" or "low".

STATIONERY & OFFICE CATEGORIZATION (CRITICAL):
1. Items such as paper, copier paper, A4 ream, pens, ballpoint pens, gel pens, notebooks, registers, diaries, notepads, memo pads, staplers, staple pins, tape, scissors, files, folders, clips, and office desk supplies MUST be categorized as "Stationery & Office".

HANDWRITTEN & LOW-QUALITY RECEIPT RULES (CRITICAL):
1. DOCUMENT CLASSIFICATION:
   - Identify "document_type": "printed" | "handwritten" | "mixed" | "photo_of_screen".
   - Rate "legibility": "clear" | "moderate" | "poor".
2. INDIAN SHORTHAND & NOTATION:
   - Amounts frequently end with "/-" (e.g. "120/-", "1500/-") or have "Rs", "R", "₹".
   - Notation like "1,20/-" or "1.20/-" often denotes 120 or 1.20 based on item context. Extract clean numeric floats without currency symbols.
3. DITTO MARKS:
   - A ditto mark ('"', ',,', or '-' under a previous row's item or unit) means the EXACT SAME item name or unit as the row directly above it. Resolve ditto marks to the actual inherited item name and unit.
4. OVERWRITTEN & CROSSED-OUT NUMBERS:
   - If an amount, rate, or total was struck out or overwritten with a correction, always extract the FINAL corrected number written over or beside it.
5. DEVANAGARI SCRIPT & NUMERALS:
   - Convert all Devanagari numerals (०, १, २, ३, ४, ५, ६, ७, ८, ९) to standard Arabic digits (0-9).
   - If item names are in Devanagari (Hindi/Marathi), provide an English translation alongside the original name (e.g. "दूध (Milk)", "साखर (Sugar)", "पोहे (Poha)").
6. ACCURACY & CONFIDENCE:
   - For handwritten bills, mark every uncertain field as "medium" or "low" confidence.
   - Return null for any field that is not clearly legible. NEVER guess, estimate, or hallucinate a value.
   - Ensure all numeric amounts, quantities, unit prices, and tax rates are floats/integers, not strings.

Extract this exact JSON structure:
{
  "document_type": "printed" | "handwritten" | "mixed" | "photo_of_screen",
  "document_type_confidence": "high" | "medium" | "low",
  "legibility": "clear" | "moderate" | "poor",
  "merchant_name": "Store, supermarket, or merchant name (or null if unreadable)",
  "merchant_name_confidence": "high" | "medium" | "low",
  "merchant_type": "supermarket" | "restaurant" | "pharmacy" | "electronics" | "fuel" | "other",
  "merchant_type_confidence": "high" | "medium" | "low",
  "bill_number": "Invoice / Bill / Token number (or null)",
  "bill_number_confidence": "high" | "medium" | "low",
  "bill_date": "YYYY-MM-DD format (or null)",
  "bill_date_confidence": "high" | "medium" | "low",
  "bill_time": "HH:MM 24-hr format (or null)",
  "bill_time_confidence": "high" | "medium" | "low",
  "payment_method": "UPI" | "cash" | "card" | "netbanking" | "other" | null,
  "payment_method_confidence": "high" | "medium" | "low",
  "currency": "{$preferredCurrency}",
  "line_items": [
    {
      "name": "Clear item name or description",
      "name_confidence": "high" | "medium" | "low",
      "quantity": float (default 1.0 if not specified),
      "quantity_confidence": "high" | "medium" | "low",
      "unit": "pcs, kg, g, litre, ml, pack, box, plate, etc. (or null)",
      "unit_confidence": "high" | "medium" | "low",
      "unit_price": float (price per single unit before tax/discount),
      "unit_price_confidence": "high" | "medium" | "low",
      "tax_percent": float (GST % such as 0, 5, 12, 18, 28 or 0 if not stated),
      "tax_percent_confidence": "high" | "medium" | "low",
      "line_total": float (final item total for this line),
      "line_total_confidence": "high" | "medium" | "low",
      "category": "Suggested category: Groceries & Supermarket, Food & Dining, Pharmacy & Healthcare, Electronics & Gadgets, Fuel & Transport, Shopping & Clothing, Utilities & Bills, Home & Maintenance, Entertainment, Stationery & Office, General & Miscellaneous",
      "category_confidence": "high" | "medium" | "low"
    }
  ],
  "subtotal": float (sum before taxes/discounts, or null),
  "subtotal_confidence": "high" | "medium" | "low",
  "tax_amount": float (total GST or tax amount, or 0.0),
  "tax_amount_confidence": "high" | "medium" | "low",
  "discount_amount": float (total discount or savings, or 0.0),
  "discount_amount_confidence": "high" | "medium" | "low",
  "grand_total": float (final amount paid),
  "grand_total_confidence": "high" | "medium" | "low",
  "warranty_suggested": {
    "has_warranty": boolean,
    "item_name": "Item name if warranty applicable else null",
    "months": integer or null
  },
  "return_deadline_suggested": {
    "has_deadline": boolean,
    "days": integer or null
  }
}
PROMPT;
}

/**
 * Executes a cURL request to Google Gemini generateContent endpoint.
 * Classifies errors clearly: invalid key, quota, model not found, timeout.
 */
function call_gemini_api(
    array $payload,
    int $timeoutSeconds = 45,
    ?string $overrideApiKey = null,
    ?string $model = null
): array {
    $apiKey = $overrideApiKey !== null ? trim($overrideApiKey) : trim((string)GEMINI_API_KEY);
    if ($apiKey === '' || $apiKey === 'your_gemini_api_key_here') {
        throw new RuntimeException('Gemini API key is not configured. Please add your GEMINI_API_KEY to spendsense/.env or set the GEMINI_API_KEY environment variable.', 401);
    }

    $targetModel = !empty($model) ? trim($model) : trim((string)GEMINI_MODEL);
    if ($targetModel === '') {
        $targetModel = 'gemini-3.8-flash';
    }

    $url = 'https://generativelanguage.googleapis.com/v1beta/models/' . urlencode($targetModel) . ':generateContent?key=' . urlencode($apiKey);
    $jsonData = json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);

    $ch = curl_init();
    curl_setopt_array($ch, [
        CURLOPT_URL => $url,
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => $jsonData,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => [
            'Content-Type: application/json',
        ],
        CURLOPT_TIMEOUT => $timeoutSeconds,
        CURLOPT_CONNECTTIMEOUT => 15,
        CURLOPT_SSL_VERIFYPEER => true,
    ]);

    $response = curl_exec($ch);
    $httpCode = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlErrno = curl_errno($ch);
    $curlError = curl_error($ch);
    curl_close($ch);

    if ($response === false) {
        if ($curlErrno === CURLE_OPERATION_TIMEDOUT) {
            throw new RuntimeException("Gemini request timed out after {$timeoutSeconds} seconds. Please try again.", 504);
        }
        throw new RuntimeException("Network connection to Gemini API failed: {$curlError}", 502);
    }

    $decoded = json_decode((string)$response, true);

    if ($httpCode >= 400) {
        $apiErrorMsg = $decoded['error']['message'] ?? "HTTP error {$httpCode}";

        if ($httpCode === 400 && str_contains(strtolower($apiErrorMsg), 'api key not valid')) {
            throw new RuntimeException('Gemini API key is invalid or unauthorized. Please verify your GEMINI_API_KEY in spendsense/.env.', 401);
        }
        if ($httpCode === 403) {
            throw new RuntimeException('Gemini API access denied. Ensure your API key has Generative Language API enabled in Google AI Studio / Google Cloud.', 403);
        }
        if ($httpCode === 404) {
            throw new RuntimeException("Gemini model '{$targetModel}' was not found. Please verify GEMINI_MODEL in spendsense/.env.", 404);
        }
        if ($httpCode === 429) {
            throw new RuntimeException('Gemini API quota exceeded or rate limit reached. Please wait a moment and try again.', 429);
        }

        throw new RuntimeException("Gemini API error ({$httpCode}): {$apiErrorMsg}", $httpCode);
    }

    if (!is_array($decoded)) {
        throw new RuntimeException('Invalid JSON received from Gemini API.', 502);
    }

    return $decoded;
}

/**
 * Quick connection and credentials test endpoint helper.
 * Tests Gemini model availability with a lightweight prompt.
 */
function test_gemini_connection(): array {
    $startTime = microtime(true);
    $payload = [
        'contents' => [
            [
                'parts' => [
                    ['text' => 'Respond with a simple JSON object: {"status": "ok", "service": "SpendSense AI"}'],
                ],
            ],
        ],
        'generationConfig' => [
            'response_mime_type' => 'application/json',
            'temperature' => 0.1,
            'maxOutputTokens' => 60,
        ],
    ];

    $response = call_gemini_api($payload, 20);
    $elapsedMs = round((microtime(true) - $startTime) * 1000);

    $candidateText = $response['candidates'][0]['content']['parts'][0]['text'] ?? '';
    $parsed = json_decode(trim($candidateText), true) ?: [];

    return [
        'status' => 'connected',
        'model' => GEMINI_MODEL,
        'handwritten_model' => GEMINI_MODEL_HANDWRITTEN,
        'latency_ms' => $elapsedMs,
        'response' => $parsed,
        'message' => 'Gemini API connection test successful.',
    ];
}

/**
 * Extracts structured receipt details from uploaded images or PDF.
 * Supports multiple photos (up to 3) for long receipts.
 * Automatically retries once with GEMINI_MODEL_HANDWRITTEN if handwritten or low-legibility.
 */
function extract_receipt_with_gemini(
    string|array $filesInput,
    ?string $singleMimeType = null,
    string $preferredCurrency = 'INR'
): array {
    // Normalize into array of files
    $fileList = [];
    if (is_array($filesInput) && isset($filesInput[0])) {
        foreach ($filesInput as $f) {
            if (is_array($f) && isset($f['full_path'], $f['mime_type'])) {
                $fileList[] = ['path' => $f['full_path'], 'mime_type' => $f['mime_type']];
            } elseif (is_string($f)) {
                $fileList[] = ['path' => $f, 'mime_type' => $singleMimeType ?? 'image/jpeg'];
            }
        }
    } else {
        $filePath = is_array($filesInput) ? ($filesInput['full_path'] ?? '') : (string)$filesInput;
        $mime = $singleMimeType ?? (is_array($filesInput) ? ($filesInput['mime_type'] ?? 'image/jpeg') : 'image/jpeg');
        $fileList[] = ['path' => $filePath, 'mime_type' => $mime];
    }

    if (empty($fileList)) {
        throw new InvalidArgumentException('No receipt files provided for extraction.', 400);
    }

    // Build parts array containing all images/documents
    $buildParts = function(string $promptText) use ($fileList): array {
        $parts = [['text' => $promptText]];
        foreach ($fileList as $f) {
            if (!file_exists($f['path'])) {
                throw new InvalidArgumentException("Receipt file not found: {$f['path']}", 404);
            }
            $bytes = file_get_contents($f['path']);
            if ($bytes === false) {
                throw new RuntimeException("Unable to read file: {$f['path']}", 500);
            }
            $parts[] = [
                'inline_data' => [
                    'mime_type' => $f['mime_type'],
                    'data' => base64_encode($bytes),
                ],
            ];
        }
        return $parts;
    };

    // Helper to call Gemini and parse candidate text
    $performExtraction = function(string $model, bool $isHandwritten) use ($buildParts, $preferredCurrency): array {
        $promptText = build_receipt_extraction_prompt($preferredCurrency, $isHandwritten);
        $payload = [
            'contents' => [
                ['parts' => $buildParts($promptText)],
            ],
            'generationConfig' => [
                'response_mime_type' => 'application/json',
                'temperature' => $isHandwritten ? 0.15 : 0.1,
            ],
        ];

        $raw = call_gemini_api($payload, 45, null, $model);
        $candidateText = $raw['candidates'][0]['content']['parts'][0]['text'] ?? null;
        if (!$candidateText) {
            throw new RuntimeException('Empty extraction response returned by Gemini.');
        }

        $candidateText = trim($candidateText);
        if (str_starts_with($candidateText, '```json')) {
            $candidateText = substr($candidateText, 7);
        }
        if (str_starts_with($candidateText, '```')) {
            $candidateText = substr($candidateText, 3);
        }
        if (str_ends_with($candidateText, '```')) {
            $candidateText = substr($candidateText, 0, -3);
        }
        $candidateText = trim($candidateText);

        $extracted = json_decode($candidateText, true);
        if (!is_array($extracted)) {
            throw new RuntimeException('Failed to parse Gemini output into structured JSON.');
        }

        // Defaults for required new fields
        $extracted['document_type'] = $extracted['document_type'] ?? 'printed';
        $extracted['legibility'] = $extracted['legibility'] ?? 'clear';

        return $extracted;
    };

    // Attempt 1 with primary GEMINI_MODEL
    $primaryResult = $performExtraction(GEMINI_MODEL, false);

    $isHandwritten = in_array($primaryResult['document_type'] ?? '', ['handwritten', 'mixed'], true);
    $isLowLegibility = in_array($primaryResult['legibility'] ?? '', ['poor', 'moderate', 'low'], true);

    // If bill is handwritten or low-legibility, automatically retry once with GEMINI_MODEL_HANDWRITTEN
    if ($isHandwritten || $isLowLegibility) {
        $handwrittenModel = defined('GEMINI_MODEL_HANDWRITTEN') ? GEMINI_MODEL_HANDWRITTEN : GEMINI_MODEL;
        try {
            $retryResult = $performExtraction($handwrittenModel, true);

            // Compare attempt 1 vs attempt 2 and select the better extraction
            $score1 = score_extraction_quality($primaryResult);
            $score2 = score_extraction_quality($retryResult);

            if ($score2 >= $score1) {
                $retryResult['attempts_made'] = 2;
                $retryResult['model_used'] = $handwrittenModel;
                return $retryResult;
            }
        } catch (Throwable $retryErr) {
            // If retry failed, fallback to primary result safely
            app_log('WARNING', 'Handwritten retry attempt failed: ' . $retryErr->getMessage());
        }
    }

    $primaryResult['attempts_made'] = 1;
    $primaryResult['model_used'] = GEMINI_MODEL;
    return $primaryResult;
}

/**
 * Scores extraction quality to select the better result between primary and retry.
 * Higher score = more non-null fields, higher legibility, fewer arithmetic errors.
 */
function score_extraction_quality(array $data): int {
    $score = 0;
    if (!empty($data['merchant_name'])) $score += 2;
    if (!empty($data['bill_date'])) $score += 2;
    if (!empty($data['grand_total']) && (float)$data['grand_total'] > 0) $score += 3;

    $items = (array)($data['line_items'] ?? []);
    $score += count($items) * 2;

    $legibility = $data['legibility'] ?? 'moderate';
    if ($legibility === 'clear') $score += 5;
    elseif ($legibility === 'moderate') $score += 2;

    $sumLines = 0.0;
    foreach ($items as $it) {
        $sumLines += (float)($it['line_total'] ?? 0);
    }
    $grand = (float)($data['grand_total'] ?? 0);
    if ($grand > 0 && abs($sumLines - $grand) <= 2.0) {
        $score += 5; // Perfect reconciliation bonus
    }

    return $score;
}
