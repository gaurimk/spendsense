<?php
/**
 * SpendSense - Database Management (PDO SQLite)
 * Strict prepared statements, WAL mode, foreign key constraints enabled.
 * All tables have user_id for strict multi-tenant isolation.
 */

declare(strict_types=1);

require_once __DIR__ . '/config.php';

function get_db(?string $customDbPath = null): PDO {
    static $cachedPdo = null;

    if ($customDbPath !== null) {
        $path = $customDbPath;
    } else {
        if ($cachedPdo !== null) {
            return $cachedPdo;
        }
        $path = DB_FILE;
    }

    $dir = dirname($path);
    if (!is_dir($dir)) {
        mkdir($dir, 0755, true);
    }

    $dsn = 'sqlite:' . $path;
    $pdo = new PDO($dsn, null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);

    // Enable foreign keys & WAL mode for SQLite
    $pdo->exec('PRAGMA foreign_keys = ON;');
    $pdo->exec('PRAGMA journal_mode = WAL;');

    if ($customDbPath === null) {
        $cachedPdo = $pdo;
    }

    return $pdo;
}

/**
 * Creates all tables and indices if they do not exist.
 * Keeps SQL portable to standard SQL / MySQL.
 */
function setup_database(PDO $pdo): void {
    $schema = <<<SQL
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        full_name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        usage_type TEXT DEFAULT 'personal',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL UNIQUE,
        currency TEXT DEFAULT 'INR',
        currency_symbol TEXT DEFAULT '₹',
        date_format TEXT DEFAULT 'DD-MM-YYYY',
        daily_upload_limit INTEGER DEFAULT 20,
        shop_mode INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        icon TEXT DEFAULT 'tag',
        color TEXT DEFAULT '#4f46e5',
        is_system INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE(user_id, name)
    );

    CREATE TABLE IF NOT EXISTS bills (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        merchant_name TEXT NOT NULL,
        merchant_type TEXT,
        bill_number TEXT,
        bill_date TEXT NOT NULL,
        bill_time TEXT,
        payment_method TEXT DEFAULT NULL,
        file_path TEXT,
        file_name TEXT,
        file_type TEXT,
        subtotal REAL DEFAULT 0.0,
        tax_amount REAL DEFAULT 0.0,
        discount_amount REAL DEFAULT 0.0,
        grand_total REAL NOT NULL DEFAULT 0.0,
        status TEXT DEFAULT 'confirmed',
        raw_gemini_json TEXT,
        notes TEXT,
        shared_share_amount REAL DEFAULT NULL,
        my_share_total REAL DEFAULT NULL,
        document_type TEXT DEFAULT 'printed',
        legibility TEXT DEFAULT 'clear',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS bill_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        bill_id INTEGER NOT NULL,
        category_id INTEGER,
        category_name TEXT,
        item_name TEXT NOT NULL,
        quantity REAL DEFAULT 1.0,
        unit TEXT DEFAULT 'pcs',
        unit_price REAL DEFAULT 0.0,
        tax_percent REAL DEFAULT 0.0,
        line_total REAL DEFAULT 0.0,
        is_shared INTEGER DEFAULT 0,
        split_type TEXT DEFAULT 'mine',
        my_share_amount REAL DEFAULT NULL,
        confidence TEXT DEFAULT 'high',
        created_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (bill_id) REFERENCES bills(id) ON DELETE CASCADE,
        FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS item_category_map (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        item_name_normalized TEXT NOT NULL,
        category_id INTEGER NOT NULL,
        category_name TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE,
        UNIQUE(user_id, item_name_normalized)
    );

    CREATE TABLE IF NOT EXISTS budgets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        category_id INTEGER NOT NULL,
        monthly_amount REAL NOT NULL,
        month TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE,
        UNIQUE(user_id, category_id, month)
    );

    CREATE TABLE IF NOT EXISTS reminders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        bill_id INTEGER,
        title TEXT NOT NULL,
        reminder_type TEXT DEFAULT 'warranty',
        due_date TEXT NOT NULL,
        is_completed INTEGER DEFAULT 0,
        notes TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (bill_id) REFERENCES bills(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        role TEXT NOT NULL,
        message_text TEXT NOT NULL,
        metadata_json TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS accuracy_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        bill_id INTEGER,
        document_type TEXT DEFAULT 'printed',
        total_fields INTEGER DEFAULT 0,
        corrected_fields INTEGER DEFAULT 0,
        accuracy_percent REAL DEFAULT 100.0,
        corrections_detail TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (bill_id) REFERENCES bills(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS upload_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        file_name TEXT NOT NULL,
        file_size INTEGER NOT NULL,
        upload_date TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- Indices for high performance queries filtered by user_id
    CREATE INDEX IF NOT EXISTS idx_settings_user ON settings(user_id);
    CREATE INDEX IF NOT EXISTS idx_categories_user ON categories(user_id);
    CREATE INDEX IF NOT EXISTS idx_bills_user_date ON bills(user_id, bill_date);
    CREATE INDEX IF NOT EXISTS idx_bills_user_merchant ON bills(user_id, merchant_name);
    CREATE INDEX IF NOT EXISTS idx_bill_items_bill ON bill_items(bill_id);
    CREATE INDEX IF NOT EXISTS idx_bill_items_user ON bill_items(user_id);
    CREATE INDEX IF NOT EXISTS idx_item_cat_map ON item_category_map(user_id, item_name_normalized);
    CREATE INDEX IF NOT EXISTS idx_budgets_user ON budgets(user_id, month);
    CREATE INDEX IF NOT EXISTS idx_reminders_user ON reminders(user_id, due_date);
    CREATE INDEX IF NOT EXISTS idx_chat_messages_user ON chat_messages(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_upload_log_user_date ON upload_log(user_id, upload_date);
SQL;

    $pdo->exec($schema);

    // Auto-migration: ensure document_type and legibility columns exist in existing DB
    try {
        $billCols = $pdo->query("PRAGMA table_info(bills);")->fetchAll(PDO::FETCH_COLUMN, 1);
        if (!in_array('document_type', $billCols, true)) {
            $pdo->exec("ALTER TABLE bills ADD COLUMN document_type TEXT DEFAULT 'printed';");
        }
        if (!in_array('legibility', $billCols, true)) {
            $pdo->exec("ALTER TABLE bills ADD COLUMN legibility TEXT DEFAULT 'clear';");
        }
        if (!in_array('my_share_total', $billCols, true)) {
            $pdo->exec("ALTER TABLE bills ADD COLUMN my_share_total REAL DEFAULT NULL;");
        }

        $itemCols = $pdo->query("PRAGMA table_info(bill_items);")->fetchAll(PDO::FETCH_COLUMN, 1);
        if (!in_array('split_type', $itemCols, true)) {
            $pdo->exec("ALTER TABLE bill_items ADD COLUMN split_type TEXT DEFAULT 'mine';");
        }
        if (!in_array('my_share_amount', $itemCols, true)) {
            $pdo->exec("ALTER TABLE bill_items ADD COLUMN my_share_amount REAL DEFAULT NULL;");
        }

        // Auto-migration: ensure 'Stationery & Office' category exists for existing users
        $pdo->exec("
            INSERT OR IGNORE INTO categories (user_id, name, icon, color, is_system, created_at)
            SELECT DISTINCT id, 'Stationery & Office', 'pencil', '#0284c7', 1, datetime('now')
            FROM users
            WHERE NOT EXISTS (
                SELECT 1 FROM categories c WHERE c.user_id = users.id AND c.name = 'Stationery & Office'
            );
        ");
    } catch (Throwable) {
        // Table info check failed or already exists
    }
}

/**
 * Seeds standard default categories for a new user
 */
function seed_default_categories(PDO $pdo, int $userId): void {
    $defaultCategories = [
        ['name' => 'Groceries & Supermarket', 'icon' => 'shopping-cart', 'color' => '#10b981'],
        ['name' => 'Food & Dining', 'icon' => 'utensils', 'color' => '#f59e0b'],
        ['name' => 'Pharmacy & Healthcare', 'icon' => 'heart-pulse', 'color' => '#ef4444'],
        ['name' => 'Electronics & Gadgets', 'icon' => 'laptop', 'color' => '#3b82f6'],
        ['name' => 'Fuel & Transport', 'icon' => 'gas-pump', 'color' => '#8b5cf6'],
        ['name' => 'Shopping & Clothing', 'icon' => 'shirt', 'color' => '#ec4899'],
        ['name' => 'Utilities & Bills', 'icon' => 'bolt', 'color' => '#6366f1'],
        ['name' => 'Home & Maintenance', 'icon' => 'home', 'color' => '#14b8a6'],
        ['name' => 'Entertainment', 'icon' => 'film', 'color' => '#f97316'],
        ['name' => 'Stationery & Office', 'icon' => 'pencil', 'color' => '#0284c7'],
        ['name' => 'General & Miscellaneous', 'icon' => 'tag', 'color' => '#6b7280'],
    ];

    $now = gmdate('Y-m-d H:i:s');
    $stmt = $pdo->prepare('
        INSERT OR IGNORE INTO categories (user_id, name, icon, color, is_system, created_at)
        VALUES (?, ?, ?, ?, 1, ?)
    ');

    foreach ($defaultCategories as $cat) {
        $stmt->execute([$userId, $cat['name'], $cat['icon'], $cat['color'], $now]);
    }
}
