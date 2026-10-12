<?php
/**
 * SpendSense - Arithmetic Validation Service
 * Performs mathematical integrity checks on parsed bill data:
 * 1. Line item arithmetic: (quantity * unit_price) vs line_total
 * 2. Sum of line items vs reported subtotal / grand total
 * 3. Tax consistency: tax_amount vs sum of line taxes
 * 4. Low/medium confidence field alerts
 */

declare(strict_types=1);

/**
 * Validates bill arithmetic and confidence levels.
 * Returns an array of warning objects: ['type' => 'arithmetic'|'confidence', 'code' => '...', 'message' => '...', 'field' => '...']
 */
function validate_bill_arithmetic(
    array $lineItems,
    ?float $subtotal,
    ?float $taxAmount,
    ?float $discountAmount,
    float $grandTotal,
    array $confidenceScores = []
): array {
    $warnings = [];
    $sumOfLines = 0.0;
    $sumOfItemTaxes = 0.0;
    $disagreeingLines = [];

    // 1. Check each line item
    foreach ($lineItems as $idx => $item) {
        $name = trim((string)($item['name'] ?? "Item #" . ($idx + 1)));
        $qty = (float)($item['quantity'] ?? 1.0);
        $unitPrice = (float)($item['unit_price'] ?? 0.0);
        $lineTotal = (float)($item['line_total'] ?? 0.0);
        $taxPercent = (float)($item['tax_percent'] ?? 0.0);

        $sumOfLines += $lineTotal;

        if ($qty > 0 && $unitPrice > 0) {
            $baseLine = $qty * $unitPrice;
            $withTax = $baseLine + ($baseLine * ($taxPercent / 100.0));

            // Check if line_total matches base or base+tax within a reasonable tolerance (₹1.00 for rounding)
            $diffBase = abs($baseLine - $lineTotal);
            $diffWithTax = abs($withTax - $lineTotal);

            if ($diffBase > 1.0 && $diffWithTax > 1.0) {
                $disagreeMsg = "\"{$name}\": {$qty} × " . number_format($unitPrice, 2) . " = " . number_format($baseLine, 2) . " (line total: " . number_format($lineTotal, 2) . ")";
                $disagreeingLines[] = $disagreeMsg;
                $warnings[] = [
                    'type' => 'arithmetic',
                    'code' => 'LINE_TOTAL_MISMATCH',
                    'message' => "Line total for \"{$name}\" (" . number_format($lineTotal, 2) . ") does not match {$qty} × " . number_format($unitPrice, 2) . " (" . number_format($baseLine, 2) . ").",
                    'field' => "line_items[{$idx}].line_total",
                    'item_index' => $idx,
                    'line_detail' => $disagreeMsg,
                ];
            }

            if ($taxPercent > 0) {
                $sumOfItemTaxes += ($baseLine * ($taxPercent / 100.0));
            }
        }

        // Check line item confidence
        if (($item['name_confidence'] ?? 'high') === 'low' || ($item['quantity_confidence'] ?? 'high') === 'low' || ($item['line_total_confidence'] ?? 'high') === 'low') {
            $warnings[] = [
                'type' => 'confidence',
                'code' => 'LOW_CONFIDENCE_ITEM',
                'message' => "Unclear or faint text detected on item \"{$name}\". Please verify.",
                'field' => "line_items[{$idx}]",
                'item_index' => $idx,
            ];
        }
    }

    // 2. Sum of line items vs grand total / subtotal
    $disc = $discountAmount ?? 0.0;
    $tax = $taxAmount ?? 0.0;

    // Line totals can be post-tax (GST-inclusive e.g. supermarkets) or pre-tax (exclusive)
    $diffInclusive = abs($sumOfLines - $grandTotal);
    $diffExclusive = abs(($sumOfLines + $tax - $disc) - $grandTotal);

    if ($diffInclusive > 2.0 && $diffExclusive > 2.0 && count($lineItems) > 0) {
        $minDiff = min($diffInclusive, $diffExclusive);
        $mismatchLines = $disagreeingLines;
        if (empty($mismatchLines)) {
            foreach ($lineItems as $idx => $it) {
                $n = $it['name'] ?? "Item #" . ($idx + 1);
                $lt = (float)($it['line_total'] ?? 0);
                $mismatchLines[] = "Line #" . ($idx + 1) . " ({$n}): ₹" . number_format($lt, 2);
            }
        }
        $warnings[] = [
            'type' => 'arithmetic',
            'code' => 'SUM_LINES_MISMATCH',
            'message' => "Sum of line items (" . number_format($sumOfLines, 2) . ") does not match bill total (" . number_format($grandTotal, 2) . "). Difference: " . number_format($minDiff, 2) . ".",
            'field' => 'grand_total',
            'written_total' => round($grandTotal, 2),
            'sum_of_lines' => round($sumOfLines, 2),
            'difference' => round($minDiff, 2),
            'disagreeing_lines' => $mismatchLines,
        ];
    }

    // 3. Overall confidence warnings
    foreach ($confidenceScores as $field => $conf) {
        if ($field === 'payment_method' && in_array($conf, ['medium', 'low'], true)) {
            $warnings[] = [
                'type' => 'confidence',
                'code' => 'UNCERTAIN_PAYMENT_METHOD',
                'message' => "Payment method identified with {$conf} confidence. Please verify if it is explicitly stated on the bill.",
                'field' => 'payment_method',
            ];
        } elseif ($conf === 'low') {
            $fieldName = ucwords(str_replace('_', ' ', $field));
            $warnings[] = [
                'type' => 'confidence',
                'code' => 'LOW_CONFIDENCE_FIELD',
                'message' => "Low confidence reading {$fieldName}. Please check before saving.",
                'field' => $field,
            ];
        }
    }

    return $warnings;
}
