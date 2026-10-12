<?php
/**
 * SpendSense - Realistic Demo Data Seeder
 * Seeds ~40 realistic Indian bills across 3 months (Groceries, Dining, Pharmacy, Tech, Fuel),
 * along with category budgets and warranty reminders.
 * Ensures charts and chat answers work immediately without uploading receipts.
 */

declare(strict_types=1);

require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../db.php';

function seed_demo_data(PDO $pdo, int $userId): array {
    $now = gmdate('Y-m-d H:i:s');

    // 1. Ensure user has default categories
    seed_default_categories($pdo, $userId);

    // Fetch category map
    $catStmt = $pdo->prepare('SELECT id, name FROM categories WHERE user_id = ?');
    $catStmt->execute([$userId]);
    $catMap = [];
    foreach ($catStmt->fetchAll() as $row) {
        $catMap[$row['name']] = (int)$row['id'];
    }

    $getCatId = function(string $catName) use (&$catMap, $pdo, $userId, $now): int {
        if (isset($catMap[$catName])) {
            return $catMap[$catName];
        }
        $stmt = $pdo->prepare('INSERT INTO categories (user_id, name, created_at) VALUES (?, ?, ?)');
        $stmt->execute([$userId, $catName, $now]);
        $newId = (int)$pdo->lastInsertId();
        $catMap[$catName] = $newId;
        return $newId;
    };

    // Realistic bills template covering 3 months: Aug, Sep, Oct 2026
    $billsData = [
        // ── AUGUST 2026 ──────────────────────────────────────────
        [
            'merchant' => 'DMart Ready',
            'type' => 'supermarket',
            'date' => '2026-08-03',
            'bill_no' => 'DMR-AUG-101',
            'method' => 'UPI',
            'items' => [
                ['name' => 'Fortune Sunflower Oil 5L', 'cat' => 'Groceries & Supermarket', 'qty' => 1, 'unit' => 'can', 'price' => 740, 'tax' => 0, 'tot' => 740],
                ['name' => 'Daawat Basmati Rice 5kg', 'cat' => 'Groceries & Supermarket', 'qty' => 1, 'unit' => 'bag', 'price' => 450, 'tax' => 5, 'tot' => 472.5],
                ['name' => 'Tata Salt 1kg', 'cat' => 'Groceries & Supermarket', 'qty' => 2, 'unit' => 'pack', 'price' => 28, 'tax' => 0, 'tot' => 56],
                ['name' => 'Aashirvaad Shudh Atta 10kg', 'cat' => 'Groceries & Supermarket', 'qty' => 1, 'unit' => 'bag', 'price' => 460, 'tax' => 0, 'tot' => 460],
            ],
            'subtotal' => 1706.0, 'tax' => 22.5, 'total' => 1728.5
        ],
        [
            'merchant' => 'Social Cafe & Pub',
            'type' => 'restaurant',
            'date' => '2026-08-06',
            'bill_no' => 'SOC-8821',
            'method' => 'card',
            'items' => [
                ['name' => 'Butter Chicken Biryani Box', 'cat' => 'Food & Dining', 'qty' => 1, 'unit' => 'portion', 'price' => 480, 'tax' => 5, 'tot' => 504],
                ['name' => 'Classic Cold Coffee', 'cat' => 'Food & Dining', 'qty' => 2, 'unit' => 'glass', 'price' => 210, 'tax' => 5, 'tot' => 441],
                ['name' => 'Chilli Paneer Platter', 'cat' => 'Food & Dining', 'qty' => 1, 'unit' => 'plate', 'price' => 380, 'tax' => 5, 'tot' => 399],
            ],
            'subtotal' => 1280.0, 'tax' => 64.0, 'total' => 1344.0
        ],
        [
            'merchant' => 'Apollo Pharmacy',
            'type' => 'pharmacy',
            'date' => '2026-08-08',
            'bill_no' => 'APL-AUG-319',
            'method' => 'UPI',
            'items' => [
                ['name' => 'Dolo 650mg Strip of 15', 'cat' => 'Pharmacy & Healthcare', 'qty' => 2, 'unit' => 'strip', 'price' => 34, 'tax' => 12, 'tot' => 76.16],
                ['name' => 'Shelcal 500 Calcium Tablets', 'cat' => 'Pharmacy & Healthcare', 'qty' => 1, 'unit' => 'bottle', 'price' => 145, 'tax' => 12, 'tot' => 162.4],
                ['name' => 'Volini Pain Relief Gel 50g', 'cat' => 'Pharmacy & Healthcare', 'qty' => 1, 'unit' => 'tube', 'price' => 170, 'tax' => 12, 'tot' => 190.4],
            ],
            'subtotal' => 383.0, 'tax' => 45.96, 'total' => 428.96
        ],
        [
            'merchant' => 'Indian Oil Petrol Pump',
            'type' => 'fuel',
            'date' => '2026-08-10',
            'bill_no' => 'IOCL-55219',
            'method' => 'UPI',
            'items' => [
                ['name' => 'Petrol (Speed Extra)', 'cat' => 'Fuel & Transport', 'qty' => 15.2, 'unit' => 'litres', 'price' => 105.5, 'tax' => 0, 'tot' => 1603.6],
            ],
            'subtotal' => 1603.6, 'tax' => 0, 'total' => 1603.6
        ],
        [
            'merchant' => 'Starbucks Coffee',
            'type' => 'restaurant',
            'date' => '2026-08-14',
            'bill_no' => 'SBUX-194',
            'method' => 'UPI',
            'items' => [
                ['name' => 'Java Chip Frappuccino Tall', 'cat' => 'Food & Dining', 'qty' => 1, 'unit' => 'cup', 'price' => 375, 'tax' => 5, 'tot' => 393.75],
                ['name' => 'Blueberry Muffin', 'cat' => 'Food & Dining', 'qty' => 1, 'unit' => 'pcs', 'price' => 240, 'tax' => 5, 'tot' => 252],
            ],
            'subtotal' => 615.0, 'tax' => 30.75, 'total' => 645.75
        ],
        [
            'merchant' => 'Reliance Digital',
            'type' => 'electronics',
            'date' => '2026-08-16',
            'bill_no' => 'RD-AUG-404',
            'method' => 'card',
            'items' => [
                ['name' => 'boAt Airdopes 141 ANC', 'cat' => 'Electronics & Gadgets', 'qty' => 1, 'unit' => 'unit', 'price' => 1694.9, 'tax' => 18, 'tot' => 1999.0],
            ],
            'subtotal' => 1694.9, 'tax' => 304.1, 'total' => 1999.0
        ],
        [
            'merchant' => 'Haldirams Restaurant',
            'type' => 'restaurant',
            'date' => '2026-08-18',
            'bill_no' => 'HLD-9102',
            'method' => 'UPI',
            'items' => [
                ['name' => 'Raj Kachori Special', 'cat' => 'Food & Dining', 'qty' => 2, 'unit' => 'plate', 'price' => 160, 'tax' => 5, 'tot' => 336],
                ['name' => 'Chole Bhature Combo', 'cat' => 'Food & Dining', 'qty' => 2, 'unit' => 'portion', 'price' => 220, 'tax' => 5, 'tot' => 462],
                ['name' => 'Kesar Rasmalai', 'cat' => 'Food & Dining', 'qty' => 2, 'unit' => 'pcs', 'price' => 85, 'tax' => 5, 'tot' => 178.5],
            ],
            'subtotal' => 930.0, 'tax' => 46.5, 'total' => 976.5
        ],
        [
            'merchant' => 'DMart Ready',
            'type' => 'supermarket',
            'date' => '2026-08-22',
            'bill_no' => 'DMR-AUG-552',
            'method' => 'UPI',
            'items' => [
                ['name' => 'Amul Pasteurised Butter 500g', 'cat' => 'Groceries & Supermarket', 'qty' => 2, 'unit' => 'pack', 'price' => 275, 'tax' => 0, 'tot' => 550],
                ['name' => 'Amul Taaza Milk 1L', 'cat' => 'Groceries & Supermarket', 'qty' => 4, 'unit' => 'pack', 'price' => 68, 'tax' => 0, 'tot' => 272],
                ['name' => 'Maggi 2-Minute Noodles 12-pack', 'cat' => 'Groceries & Supermarket', 'qty' => 1, 'unit' => 'pack', 'price' => 168, 'tax' => 0, 'tot' => 168],
                ['name' => 'Bourbon Dark Biscuits', 'cat' => 'Groceries & Supermarket', 'qty' => 3, 'unit' => 'pack', 'price' => 40, 'tax' => 0, 'tot' => 120],
                ['name' => 'Surf Excel Matic Liquid 2L', 'cat' => 'Home & Maintenance', 'qty' => 1, 'unit' => 'bottle', 'price' => 410, 'tax' => 18, 'tot' => 483.8],
            ],
            'subtotal' => 1520.0, 'tax' => 73.8, 'total' => 1593.8
        ],
        [
            'merchant' => 'Uber India',
            'type' => 'fuel',
            'date' => '2026-08-25',
            'bill_no' => 'UBR-TRIP-771',
            'method' => 'UPI',
            'items' => [
                ['name' => 'Uber Premier Airport Ride', 'cat' => 'Fuel & Transport', 'qty' => 1, 'unit' => 'trip', 'price' => 680, 'tax' => 5, 'tot' => 714],
            ],
            'subtotal' => 680.0, 'tax' => 34.0, 'total' => 714.0
        ],
        [
            'merchant' => 'Adani Electricity',
            'type' => 'other',
            'date' => '2026-08-27',
            'bill_no' => 'ADANI-AUG-09',
            'method' => 'netbanking',
            'items' => [
                ['name' => 'Monthly Electricity Charges', 'cat' => 'Utilities & Bills', 'qty' => 1, 'unit' => 'bill', 'price' => 2450, 'tax' => 0, 'tot' => 2450],
            ],
            'subtotal' => 2450.0, 'tax' => 0, 'total' => 2450.0
        ],
        [
            'merchant' => 'MedPlus Pharmacy',
            'type' => 'pharmacy',
            'date' => '2026-08-29',
            'bill_no' => 'MP-AUG-228',
            'method' => 'cash',
            'items' => [
                ['name' => 'Celin 500mg Vitamin C Tabs', 'cat' => 'Pharmacy & Healthcare', 'qty' => 2, 'unit' => 'strip', 'price' => 42, 'tax' => 12, 'tot' => 94.08],
                ['name' => 'Hansaplast Adhesive Bandages', 'cat' => 'Pharmacy & Healthcare', 'qty' => 1, 'unit' => 'box', 'price' => 65, 'tax' => 12, 'tot' => 72.8],
            ],
            'subtotal' => 149.0, 'tax' => 17.88, 'total' => 166.88
        ],
        [
            'merchant' => 'Domino\'s Pizza',
            'type' => 'restaurant',
            'date' => '2026-08-31',
            'bill_no' => 'DOM-89312',
            'method' => 'UPI',
            'items' => [
                ['name' => 'Farmhouse Medium Pizza', 'cat' => 'Food & Dining', 'qty' => 1, 'unit' => 'pizza', 'price' => 459, 'tax' => 5, 'tot' => 481.95],
                ['name' => 'Garlic Breadsticks with Dip', 'cat' => 'Food & Dining', 'qty' => 1, 'unit' => 'box', 'price' => 149, 'tax' => 5, 'tot' => 156.45],
            ],
            'subtotal' => 608.0, 'tax' => 30.4, 'total' => 638.4
        ],

        // ── SEPTEMBER 2026 ───────────────────────────────────────
        [
            'merchant' => 'DMart Ready',
            'type' => 'supermarket',
            'date' => '2026-09-02',
            'bill_no' => 'DMR-SEP-021',
            'method' => 'UPI',
            'items' => [
                ['name' => 'Fortune Sunflower Oil 5L', 'cat' => 'Groceries & Supermarket', 'qty' => 1, 'unit' => 'can', 'price' => 760, 'tax' => 0, 'tot' => 760],
                ['name' => 'Daawat Basmati Rice 5kg', 'cat' => 'Groceries & Supermarket', 'qty' => 1, 'unit' => 'bag', 'price' => 460, 'tax' => 5, 'tot' => 483],
                ['name' => 'Tata Tea Gold 500g', 'cat' => 'Groceries & Supermarket', 'qty' => 1, 'unit' => 'pack', 'price' => 280, 'tax' => 5, 'tot' => 294],
                ['name' => 'Toor Dal Premium 2kg', 'cat' => 'Groceries & Supermarket', 'qty' => 1, 'unit' => 'pack', 'price' => 330, 'tax' => 0, 'tot' => 330],
            ],
            'subtotal' => 1830.0, 'tax' => 37.0, 'total' => 1867.0
        ],
        [
            'merchant' => 'HP Auto Care Petrol',
            'type' => 'fuel',
            'date' => '2026-09-04',
            'bill_no' => 'HP-SEP-449',
            'method' => 'card',
            'items' => [
                ['name' => 'Petrol Unleaded', 'cat' => 'Fuel & Transport', 'qty' => 18.5, 'unit' => 'litres', 'price' => 104.8, 'tax' => 0, 'tot' => 1938.8],
            ],
            'subtotal' => 1938.8, 'tax' => 0, 'total' => 1938.8
        ],
        [
            'merchant' => 'Biryani By Kilo',
            'type' => 'restaurant',
            'date' => '2026-09-07',
            'bill_no' => 'BBK-1982',
            'method' => 'UPI',
            'items' => [
                ['name' => 'Hyderabadi Chicken Biryani 1kg Handi', 'cat' => 'Food & Dining', 'qty' => 1, 'unit' => 'handi', 'price' => 695, 'tax' => 5, 'tot' => 729.75],
                ['name' => 'Galouti Kebab 4 pcs', 'cat' => 'Food & Dining', 'qty' => 1, 'unit' => 'plate', 'price' => 360, 'tax' => 5, 'tot' => 378],
            ],
            'subtotal' => 1055.0, 'tax' => 52.75, 'total' => 1107.75
        ],
        [
            'merchant' => 'Nature\'s Basket',
            'type' => 'supermarket',
            'date' => '2026-09-09',
            'bill_no' => 'NB-SEP-303',
            'method' => 'card',
            'items' => [
                ['name' => 'Amul Taaza Milk 1L', 'cat' => 'Groceries & Supermarket', 'qty' => 3, 'unit' => 'pack', 'price' => 72, 'tax' => 0, 'tot' => 216],
                ['name' => 'Greek Yogurt Blueberry', 'cat' => 'Groceries & Supermarket', 'qty' => 2, 'unit' => 'cup', 'price' => 90, 'tax' => 5, 'tot' => 189],
                ['name' => 'Sourdough Artisan Bread', 'cat' => 'Groceries & Supermarket', 'qty' => 1, 'unit' => 'loaf', 'price' => 160, 'tax' => 0, 'tot' => 160],
            ],
            'subtotal' => 556.0, 'tax' => 9.0, 'total' => 565.0
        ],
        [
            'merchant' => 'Apollo Pharmacy',
            'type' => 'pharmacy',
            'date' => '2026-09-12',
            'bill_no' => 'APL-SEP-772',
            'method' => 'UPI',
            'items' => [
                ['name' => 'Paracetamol 650 Strip', 'cat' => 'Pharmacy & Healthcare', 'qty' => 1, 'unit' => 'strip', 'price' => 32, 'tax' => 12, 'tot' => 35.84],
                ['name' => 'Benadryl Cough Syrup 100ml', 'cat' => 'Pharmacy & Healthcare', 'qty' => 1, 'unit' => 'bottle', 'price' => 130, 'tax' => 12, 'tot' => 145.6],
                ['name' => 'Otrivin Nasal Spray', 'cat' => 'Pharmacy & Healthcare', 'qty' => 1, 'unit' => 'bottle', 'price' => 110, 'tax' => 12, 'tot' => 123.2],
            ],
            'subtotal' => 272.0, 'tax' => 32.64, 'total' => 304.64
        ],
        [
            'merchant' => 'Croma Electronics',
            'type' => 'electronics',
            'date' => '2026-09-15',
            'bill_no' => 'CROMA-SEP-889',
            'method' => 'card',
            'items' => [
                ['name' => 'SanDisk Extreme Portable SSD 1TB', 'cat' => 'Electronics & Gadgets', 'qty' => 1, 'unit' => 'unit', 'price' => 7457.6, 'tax' => 18, 'tot' => 8800.0],
                ['name' => 'Type-C Fast Charging Cable 2m', 'cat' => 'Electronics & Gadgets', 'qty' => 1, 'unit' => 'unit', 'price' => 423.7, 'tax' => 18, 'tot' => 500.0],
            ],
            'subtotal' => 7881.3, 'tax' => 1418.7, 'total' => 9300.0
        ],
        [
            'merchant' => 'Chai Point',
            'type' => 'restaurant',
            'date' => '2026-09-18',
            'bill_no' => 'CP-SEP-19',
            'method' => 'UPI',
            'items' => [
                ['name' => 'Ginger Chai Flask 500ml', 'cat' => 'Food & Dining', 'qty' => 1, 'unit' => 'flask', 'price' => 170, 'tax' => 5, 'tot' => 178.5],
                ['name' => 'Bun Maska Classic', 'cat' => 'Food & Dining', 'qty' => 2, 'unit' => 'pcs', 'price' => 65, 'tax' => 5, 'tot' => 136.5],
            ],
            'subtotal' => 300.0, 'tax' => 15.0, 'total' => 315.0
        ],
        [
            'merchant' => 'DMart Ready',
            'type' => 'supermarket',
            'date' => '2026-09-20',
            'bill_no' => 'DMR-SEP-419',
            'method' => 'UPI',
            'items' => [
                ['name' => 'Amul Taaza Milk 1L', 'cat' => 'Groceries & Supermarket', 'qty' => 4, 'unit' => 'pack', 'price' => 68, 'tax' => 0, 'tot' => 272],
                ['name' => 'Bourbon Dark Biscuits', 'cat' => 'Groceries & Supermarket', 'qty' => 4, 'unit' => 'pack', 'price' => 40, 'tax' => 0, 'tot' => 160],
                ['name' => 'Lipton Green Tea 100 bags', 'cat' => 'Groceries & Supermarket', 'qty' => 1, 'unit' => 'box', 'price' => 440, 'tax' => 5, 'tot' => 462],
                ['name' => 'Colgate Total Toothpaste 150g', 'cat' => 'Pharmacy & Healthcare', 'qty' => 2, 'unit' => 'tube', 'price' => 160, 'tax' => 18, 'tot' => 377.6],
            ],
            'subtotal' => 1192.0, 'tax' => 79.6, 'total' => 1271.6
        ],
        [
            'merchant' => 'Zara Clothing',
            'type' => 'other',
            'date' => '2026-09-23',
            'bill_no' => 'ZARA-SEP-551',
            'method' => 'card',
            'items' => [
                ['name' => 'Slim Fit Cotton Chinos Olive', 'cat' => 'Shopping & Clothing', 'qty' => 1, 'unit' => 'pcs', 'price' => 2847.6, 'tax' => 5, 'tot' => 2990.0],
                ['name' => 'Crew Neck Tee White', 'cat' => 'Shopping & Clothing', 'qty' => 1, 'unit' => 'pcs', 'price' => 1228.6, 'tax' => 5, 'tot' => 1290.0],
            ],
            'subtotal' => 4076.2, 'tax' => 203.8, 'total' => 4280.0
        ],
        [
            'merchant' => 'Indian Oil Petrol Pump',
            'type' => 'fuel',
            'date' => '2026-09-26',
            'bill_no' => 'IOCL-SEP-991',
            'method' => 'UPI',
            'items' => [
                ['name' => 'Petrol', 'cat' => 'Fuel & Transport', 'qty' => 16.0, 'unit' => 'litres', 'price' => 105.0, 'tax' => 0, 'tot' => 1680.0],
            ],
            'subtotal' => 1680.0, 'tax' => 0, 'total' => 1680.0
        ],
        [
            'merchant' => 'Airtel Broadband',
            'type' => 'other',
            'date' => '2026-09-28',
            'bill_no' => 'AIRTEL-SEP-11',
            'method' => 'UPI',
            'items' => [
                ['name' => 'Fiber Xstream 200Mbps Monthly', 'cat' => 'Utilities & Bills', 'qty' => 1, 'unit' => 'plan', 'price' => 999, 'tax' => 18, 'tot' => 1178.82],
            ],
            'subtotal' => 999.0, 'tax' => 179.82, 'total' => 1178.82
        ],
        [
            'merchant' => 'Social Cafe & Pub',
            'type' => 'restaurant',
            'date' => '2026-09-30',
            'bill_no' => 'SOC-SEP-910',
            'method' => 'card',
            'items' => [
                ['name' => 'Loaded Nachos Grande', 'cat' => 'Food & Dining', 'qty' => 1, 'unit' => 'plate', 'price' => 380, 'tax' => 5, 'tot' => 399],
                ['name' => 'Classic Cold Coffee', 'cat' => 'Food & Dining', 'qty' => 1, 'unit' => 'glass', 'price' => 210, 'tax' => 5, 'tot' => 220.5],
            ],
            'subtotal' => 590.0, 'tax' => 29.5, 'total' => 619.5
        ],

        // ── OCTOBER 2026 (Current Month) ─────────────────────────
        [
            'merchant' => 'DMart Ready',
            'type' => 'supermarket',
            'date' => '2026-10-02',
            'bill_no' => 'DMR-OCT-092',
            'method' => 'UPI',
            'items' => [
                ['name' => 'Fortune Sunflower Oil 5L', 'cat' => 'Groceries & Supermarket', 'qty' => 1, 'unit' => 'can', 'price' => 775, 'tax' => 0, 'tot' => 775],
                ['name' => 'Daawat Basmati Rice 5kg', 'cat' => 'Groceries & Supermarket', 'qty' => 1, 'unit' => 'bag', 'price' => 470, 'tax' => 5, 'tot' => 493.5],
                ['name' => 'Tata Tea Gold 500g', 'cat' => 'Groceries & Supermarket', 'qty' => 1, 'unit' => 'pack', 'price' => 285, 'tax' => 5, 'tot' => 299.25],
                ['name' => 'Amul Butter 500g', 'cat' => 'Groceries & Supermarket', 'qty' => 1, 'unit' => 'pack', 'price' => 280, 'tax' => 0, 'tot' => 280],
                ['name' => 'Bourbon Biscuits 150g', 'cat' => 'Groceries & Supermarket', 'qty' => 3, 'unit' => 'pack', 'price' => 40, 'tax' => 0, 'tot' => 120],
            ],
            'subtotal' => 1930.0, 'tax' => 37.75, 'total' => 1967.75
        ],
        [
            'merchant' => 'Starbucks Coffee',
            'type' => 'restaurant',
            'date' => '2026-10-04',
            'bill_no' => 'SBUX-OCT-112',
            'method' => 'UPI',
            'items' => [
                ['name' => 'Caramel Macchiato Grande', 'cat' => 'Food & Dining', 'qty' => 1, 'unit' => 'cup', 'price' => 410, 'tax' => 5, 'tot' => 430.5],
                ['name' => 'Almond Croissant', 'cat' => 'Food & Dining', 'qty' => 1, 'unit' => 'pcs', 'price' => 260, 'tax' => 5, 'tot' => 273],
            ],
            'subtotal' => 670.0, 'tax' => 33.5, 'total' => 703.5
        ],
        [
            'merchant' => 'Apollo Pharmacy',
            'type' => 'pharmacy',
            'date' => '2026-10-06',
            'bill_no' => 'APL-OCT-550',
            'method' => 'UPI',
            'items' => [
                ['name' => 'Dolo 650mg Strip of 15', 'cat' => 'Pharmacy & Healthcare', 'qty' => 2, 'unit' => 'strip', 'price' => 34, 'tax' => 12, 'tot' => 76.16],
                ['name' => 'Becadexamin Multivitamin', 'cat' => 'Pharmacy & Healthcare', 'qty' => 1, 'unit' => 'bottle', 'price' => 55, 'tax' => 12, 'tot' => 61.6],
                ['name' => 'Dettol Antiseptic Liquid 250ml', 'cat' => 'Home & Maintenance', 'qty' => 1, 'unit' => 'bottle', 'price' => 165, 'tax' => 18, 'tot' => 194.7],
            ],
            'subtotal' => 288.0, 'tax' => 44.46, 'total' => 332.46
        ],
        [
            'merchant' => 'Bharat Petroleum Pump',
            'type' => 'fuel',
            'date' => '2026-10-07',
            'bill_no' => 'BPCL-OCT-771',
            'method' => 'card',
            'items' => [
                ['name' => 'Speed Petrol', 'cat' => 'Fuel & Transport', 'qty' => 17.5, 'unit' => 'litres', 'price' => 106.0, 'tax' => 0, 'tot' => 1855.0],
            ],
            'subtotal' => 1855.0, 'tax' => 0, 'total' => 1855.0
        ],
        [
            'merchant' => 'Biryani By Kilo',
            'type' => 'restaurant',
            'date' => '2026-10-09',
            'bill_no' => 'BBK-OCT-391',
            'method' => 'UPI',
            'items' => [
                ['name' => 'Hyderabadi Chicken Biryani 1kg Handi', 'cat' => 'Food & Dining', 'qty' => 1, 'unit' => 'handi', 'price' => 720, 'tax' => 5, 'tot' => 756],
                ['name' => 'Phirni Dessert Pot', 'cat' => 'Food & Dining', 'qty' => 2, 'unit' => 'pot', 'price' => 95, 'tax' => 5, 'tot' => 199.5],
            ],
            'subtotal' => 910.0, 'tax' => 45.5, 'total' => 955.5
        ],
        [
            'merchant' => 'DMart Ready',
            'type' => 'supermarket',
            'date' => '2026-10-10',
            'bill_no' => 'DMR-OCT-802',
            'method' => 'UPI',
            'items' => [
                ['name' => 'Amul Taaza Milk 1L', 'cat' => 'Groceries & Supermarket', 'qty' => 4, 'unit' => 'pack', 'price' => 68, 'tax' => 0, 'tot' => 272],
                ['name' => 'Kurkure Masala Munch 90g', 'cat' => 'Groceries & Supermarket', 'qty' => 3, 'unit' => 'pack', 'price' => 20, 'tax' => 0, 'tot' => 60],
                ['name' => 'Lay\'s India\'s Magic Masala', 'cat' => 'Groceries & Supermarket', 'qty' => 2, 'unit' => 'pack', 'price' => 30, 'tax' => 0, 'tot' => 60],
                ['name' => 'Cadbury Dairy Milk Silk', 'cat' => 'Groceries & Supermarket', 'qty' => 2, 'unit' => 'bar', 'price' => 85, 'tax' => 0, 'tot' => 170],
                ['name' => 'Vim Dishwash Liquid 1L', 'cat' => 'Home & Maintenance', 'qty' => 1, 'unit' => 'bottle', 'price' => 220, 'tax' => 18, 'tot' => 259.6],
            ],
            'subtotal' => 775.0, 'tax' => 46.6, 'total' => 821.6
        ],
        [
            'merchant' => 'Social Cafe & Pub',
            'type' => 'restaurant',
            'date' => '2026-10-11',
            'bill_no' => 'SOC-OCT-441',
            'method' => 'card',
            'items' => [
                ['name' => 'BBQ Chicken Wings Platter', 'cat' => 'Food & Dining', 'qty' => 1, 'unit' => 'plate', 'price' => 420, 'tax' => 5, 'tot' => 441],
                ['name' => 'Craft Beer Draught Pint', 'cat' => 'Food & Dining', 'qty' => 2, 'unit' => 'pint', 'price' => 310, 'tax' => 5, 'tot' => 651],
            ],
            'subtotal' => 1040.0, 'tax' => 52.0, 'total' => 1092.0
        ],
        [
            'merchant' => 'Indian Oil Petrol Pump',
            'type' => 'fuel',
            'date' => '2026-10-12',
            'bill_no' => 'IOCL-OCT-990',
            'method' => 'UPI',
            'items' => [
                ['name' => 'Petrol', 'cat' => 'Fuel & Transport', 'qty' => 12.0, 'unit' => 'litres', 'price' => 105.5, 'tax' => 0, 'tot' => 1266.0],
            ],
            'subtotal' => 1266.0, 'tax' => 0, 'total' => 1266.0
        ],
    ];

    $pdo->beginTransaction();
    try {
        // Clear previous demo bills to allow clean re-runs
        $delOld = $pdo->prepare('DELETE FROM bills WHERE user_id = ? AND bill_number LIKE ?');
        $delOld->execute([$userId, '%DMR-%']);
        $delOld->execute([$userId, '%SOC-%']);
        $delOld->execute([$userId, '%APL-%']);
        $delOld->execute([$userId, '%IOCL-%']);
        $delOld->execute([$userId, '%HP-%']);
        $delOld->execute([$userId, '%BBK-%']);
        $delOld->execute([$userId, '%CROMA-%']);
        $delOld->execute([$userId, '%RD-%']);

        $insertBill = $pdo->prepare('
            INSERT INTO bills (
                user_id, merchant_name, merchant_type, bill_number, bill_date,
                payment_method, subtotal, tax_amount, grand_total, status,
                file_name, file_path, notes, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, \'confirmed\', ?, ?, ?, ?, ?)
        ');

        $insertItem = $pdo->prepare('
            INSERT INTO bill_items (
                user_id, bill_id, category_id, category_name, item_name,
                quantity, unit, unit_price, tax_percent, line_total, confidence, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, \'high\', ?)
        ');

        $seededCount = 0;
        foreach ($billsData as $b) {
            $insertBill->execute([
                $userId,
                $b['merchant'],
                $b['type'],
                $b['bill_no'],
                $b['date'],
                $b['method'],
                $b['subtotal'],
                $b['tax'],
                $b['total'],
                'demo_' . strtolower($b['bill_no']) . '.jpg',
                'uploads/demo.jpg',
                'Demo expense entry',
                $b['date'] . ' 12:00:00',
                $b['date'] . ' 12:00:00',
            ]);
            $billId = (int)$pdo->lastInsertId();
            $seededCount++;

            foreach ($b['items'] as $it) {
                $catId = $getCatId($it['cat']);
                $insertItem->execute([
                    $userId,
                    $billId,
                    $catId,
                    $it['cat'],
                    $it['name'],
                    $it['qty'],
                    $it['unit'],
                    $it['price'],
                    $it['tax'],
                    $it['tot'],
                    $b['date'] . ' 12:00:00',
                ]);
            }
        }

        // 2. Seed monthly category budgets for 2026-10
        $budgets = [
            ['cat' => 'Groceries & Supermarket', 'amount' => 12000.0],
            ['cat' => 'Food & Dining', 'amount' => 6000.0],
            ['cat' => 'Fuel & Transport', 'amount' => 4500.0],
            ['cat' => 'Pharmacy & Healthcare', 'amount' => 2000.0],
            ['cat' => 'Utilities & Bills', 'amount' => 3000.0],
        ];

        $insertBudget = $pdo->prepare('
            INSERT INTO budgets (user_id, category_id, monthly_amount, month, created_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(user_id, category_id, month) DO UPDATE SET
                monthly_amount = excluded.monthly_amount
        ');

        foreach ($budgets as $bgt) {
            $catId = $getCatId($bgt['cat']);
            $insertBudget->execute([$userId, $catId, $bgt['amount'], '2026-10', $now]);
            $insertBudget->execute([$userId, $catId, $bgt['amount'], 'default', $now]);
        }

        // 3. Seed warranty reminders
        $insertReminder = $pdo->prepare('
            INSERT INTO reminders (user_id, title, reminder_type, due_date, notes, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
        ');
        $insertReminder->execute([
            $userId,
            'boAt Airdopes 141 ANC - 1 Year Warranty',
            'warranty',
            '2027-08-16',
            'Purchased at Reliance Digital. Claim via boAt website.',
            $now,
        ]);
        $insertReminder->execute([
            $userId,
            'SanDisk Extreme Portable SSD - 3 Year Warranty',
            'warranty',
            '2029-09-15',
            'Purchased at Croma. Retain digital invoice CROMA-SEP-889.',
            $now,
        ]);

        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        throw $e;
    }

    return [
        'success' => true,
        'bills_seeded' => $seededCount,
        'months' => ['2026-08', '2026-09', '2026-10'],
        'budgets_seeded' => count($budgets),
        'reminders_seeded' => 2,
        'message' => "Successfully seeded {$seededCount} realistic bills, monthly budgets, and warranty reminders.",
    ];
}
