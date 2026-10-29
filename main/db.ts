import Database from 'better-sqlite3';
import * as path from 'path';
import { app } from 'electron';
import * as fs from 'fs';
import * as bcrypt from 'bcryptjs';

// Bump this whenever the schema changes incompatibly
const SCHEMA_VERSION = 18;

let db: Database.Database;

export function getDbPath(): string {
  const userDataPath = app?.isPackaged ? app.getPath('userData') : path.join(__dirname, '../../');
  return path.join(userDataPath, 'flo.db');
}

function getBackupDir(): string {
  const userDataPath = app?.getPath ? app.getPath('userData') : path.join(__dirname, '../../');
  return path.join(userDataPath, 'backups');
}

export function initDatabase(): void {
  const dbPath = getDbPath();
  const backupDir = getBackupDir();

  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  console.log(`[DB] Opening database at: ${dbPath}`);
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = OFF'); // Off during migrations

  runMigrations();

  db.pragma('foreign_keys = ON');
}

export function getDatabase(): Database.Database {
  if (!db) throw new Error('Database not initialized');
  return db;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    console.log('[DB] Database closed');
  }
}

export async function createBackup(): Promise<string> {
  console.log('[DB] createBackup: Starting...');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(getBackupDir(), `flo-backup-${timestamp}.db`);
  console.log('[DB] createBackup: Target path:', backupPath);
  await db.backup(backupPath);
  console.log(`[DB] Backup created: ${backupPath}`);
  return backupPath;
}

export function restoreBackup(backupPath: string): void {
  db.close();
  const dbPath = getDbPath();
  fs.copyFileSync(backupPath, dbPath);
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  console.log(`[DB] Restored from: ${backupPath}`);
}

function getCurrentSchemaVersion(): number {
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'schema_version'").get() as any;
    return row ? parseInt(row.value, 10) : 0;
  } catch {
    return 0;
  }
}

function columnExists(table: string, column: string): boolean {
  try {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as any[];
    return cols.some(c => c.name === column);
  } catch {
    return false;
  }
}

function dropAllTables(): void {
  console.log('[DB] Dropping all tables for schema migration...');
  const tables = [
    'loyalty_ledger', 'bills', 'order_items', 'orders',
    'addon_group_product', 'addons', 'addon_groups',
    'printers', 'kds_pairing_tokens', 'settings',
    'users', 'staff',  // handle both old and new name
    'customers', 'tables', 'kitchen_stations',
    'products', 'categories',
  ];
  for (const t of tables) {
    db.exec(`DROP TABLE IF EXISTS ${t}`);
  }
}

function runMigrations(): void {
  console.log('[DB] Running migrations...');

  // Bootstrap: create settings table to check version
  db.exec(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  const currentVersion = getCurrentSchemaVersion();
  console.log(`[DB] Schema version: ${currentVersion} → ${SCHEMA_VERSION}`);

  if (currentVersion === 0) {
    // Fresh install - create everything
    createSchema();
    seedData();
  } else if (currentVersion < SCHEMA_VERSION) {
    // Incremental migrations
    runIncrementalMigrations(currentVersion);
  }

  // Defensive guarantee: Ensure shop_id & cloud_id exist on core multi-branch tables
  const coreColumns = [
    { table: 'categories', column: 'shop_id', type: 'INTEGER' },
    { table: 'categories', column: 'cloud_id', type: 'TEXT' },
    { table: 'products', column: 'shop_id', type: 'INTEGER' },
    { table: 'products', column: 'cloud_id', type: 'TEXT' },
    { table: 'orders', column: 'shop_id', type: 'INTEGER' },
    { table: 'orders', column: 'customer_name', type: 'TEXT' },
    { table: 'users', column: 'shop_id', type: 'INTEGER' },
    { table: 'tables', column: 'shop_id', type: 'INTEGER' },
  ];
  for (const { table, column, type } of coreColumns) {
    if (!columnExists(table, column)) {
      try {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
        console.log(`[DB] Defensive check: Added missing column ${column} to ${table}`);
      } catch (err: any) {
        console.warn(`[DB] Defensive column check (${table}.${column}):`, err.message);
      }
    }
  }

  // Ensure default cloud_auto_print settings exist (non-destructive)
  try {
    db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('cloud_auto_print_bill', '1')").run();
    db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('cloud_auto_print_kot', '1')").run();
  } catch {}

  console.log('[DB] Migrations complete');
}

function runIncrementalMigrations(fromVersion: number): void {
  const insert = (key: string, value: string) =>
    db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run(key, value);

  // Migration from version 7 to 8
  if (fromVersion < 8) {
    console.log('[DB] Running migration to v8...');
    
    // Add printers table if it doesn't exist
    db.exec(`CREATE TABLE IF NOT EXISTS printers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      connection_type TEXT NOT NULL CHECK (connection_type IN ('network', 'usb', 'webusb')),
      ip_address TEXT,
      port INTEGER DEFAULT 9100,
      usb_device_path TEXT,
      is_default INTEGER DEFAULT 0,
      paper_width TEXT DEFAULT '80mm',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);

    // Add default printer if none exists
    const existingPrinter = db.prepare('SELECT COUNT(*) as count FROM printers').get() as any;
    if (!existingPrinter || existingPrinter.count === 0) {
      db.prepare(`
        INSERT INTO printers (id, name, connection_type, paper_width, is_default)
        VALUES (?, ?, ?, ?, ?)
      `).run('printer-1', 'Thermal Printer', 'usb', '80mm', 1);
      console.log('[DB] Added default printer');
    }
  }

  // Migration from version 8 to 9 (Supabase Hybrid Cloud Sync)
  if (fromVersion < 9) {
    console.log('[DB] Running migration to v9 (Supabase Hybrid Cloud Sync)...');

    if (!columnExists('categories', 'cloud_id')) {
      db.exec(`ALTER TABLE categories ADD COLUMN cloud_id TEXT`);
    }
    if (!columnExists('products', 'cloud_id')) {
      db.exec(`ALTER TABLE products ADD COLUMN cloud_id TEXT`);
    }
    if (!columnExists('products', 'slug')) {
      db.exec(`ALTER TABLE products ADD COLUMN slug TEXT`);
    }
    if (!columnExists('orders', 'cloud_order_id')) {
      db.exec(`ALTER TABLE orders ADD COLUMN cloud_order_id TEXT`);
    }
    if (!columnExists('orders', 'order_source')) {
      db.exec(`ALTER TABLE orders ADD COLUMN order_source TEXT DEFAULT 'pos'`);
    }
    if (!columnExists('orders', 'delivery_address')) {
      db.exec(`ALTER TABLE orders ADD COLUMN delivery_address TEXT`);
    }
    if (!columnExists('orders', 'delivery_fee')) {
      db.exec(`ALTER TABLE orders ADD COLUMN delivery_fee REAL DEFAULT 0`);
    }
    if (!columnExists('orders', 'is_synced')) {
      db.exec(`ALTER TABLE orders ADD COLUMN is_synced INTEGER DEFAULT 0`);
    }

    insert('supabase_url', 'https://uadrrjrlhfttithjmdye.supabase.co');
    insert('supabase_key', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVhZHJyanJsaGZ0dGl0aGptZHllIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MDYwNTg2OCwiZXhwIjoyMTA2MTgxODY4fQ.NuC74GhFlUEiaRR2BXPooYj7iahzrXXKCxMQYDUnfIg');
    insert('cloud_sync_enabled', '1');
    insert('cloud_auto_print_kot', '1');
    insert('cloud_last_sync', '');

    // Purge legacy dummy/fake users so ONLY real staff from Super Admin exists
    db.exec("DELETE FROM users WHERE id IN ('user-1', 'user-2', 'user-3', 'user-4') OR email LIKE '%@flo.local';");
    console.log('[DB] Cleaned up legacy dummy accounts. Staff synced exclusively from Pizza System Super Admin.');
  }
  // Migration from version 9 to 10 (Multi-Tenant Branch & Pizza Menu Isolation)
  if (fromVersion < 10) {
    console.log('[DB] Running migration to v10 (Multi-Tenant Branch & Pizza Menu Isolation)...');

    if (!columnExists('products', 'shop_id')) {
      db.exec(`ALTER TABLE products ADD COLUMN shop_id INTEGER`);
    }
    if (!columnExists('categories', 'shop_id')) {
      db.exec(`ALTER TABLE categories ADD COLUMN shop_id INTEGER`);
    }
    if (!columnExists('users', 'shop_id')) {
      db.exec(`ALTER TABLE users ADD COLUMN shop_id INTEGER`);
    }
    if (!columnExists('orders', 'shop_id')) {
      db.exec(`ALTER TABLE orders ADD COLUMN shop_id INTEGER`);
    }

    insert('cloud_shop_id', '4');
    insert('cloud_shop_name', 'papa pizza');
    insert('cloud_shop_slug', 'papa-pizza-346');

    // Purge legacy offline dummy food items and dummy categories so only real pizza management products appear
    db.exec(`
      DELETE FROM products WHERE id IN ('prod-1', 'prod-2', 'prod-3', 'prod-4', 'prod-5', 'prod-6', 'prod-7', 'prod-8', 'prod-9', 'prod-10') OR (cloud_id IS NULL AND id LIKE 'prod-%');
      DELETE FROM categories WHERE id IN ('cat-1', 'cat-2', 'cat-3') OR (cloud_id IS NULL AND id LIKE 'cat-%');
    `);
    console.log('[DB] Purged dummy placeholder items. POS menu dedicated exclusively to Pizza Management System.');
  }

  // Migration from version 10 to 11 (Multi-Branch Recipe & Raw Material Inventory Isolation)
  if (fromVersion < 11) {
    console.log('[DB] Running migration to v11 (Multi-Branch Recipe & Inventory Isolation)...');

    db.exec(`
      CREATE TABLE IF NOT EXISTS raw_ingredients (
        id TEXT PRIMARY KEY,
        cloud_id TEXT,
        shop_id INTEGER,
        name TEXT NOT NULL,
        category TEXT DEFAULT 'meat',
        unit TEXT DEFAULT 'kg',
        current_stock REAL DEFAULT 0,
        low_stock_threshold REAL DEFAULT 1,
        cost_per_unit REAL DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS product_recipes (
        id TEXT PRIMARY KEY,
        cloud_id TEXT,
        shop_id INTEGER,
        product_id TEXT NOT NULL,
        variation_name TEXT,
        ingredient_id TEXT NOT NULL,
        quantity_required REAL DEFAULT 0,
        notes TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS ingredient_wastage_logs (
        id TEXT PRIMARY KEY,
        cloud_id TEXT,
        shop_id INTEGER,
        ingredient_id TEXT NOT NULL,
        quantity_wasted REAL DEFAULT 0,
        reason TEXT NOT NULL,
        reported_by TEXT DEFAULT 'Chef',
        cost_loss REAL DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS ingredient_stock_logs (
        id TEXT PRIMARY KEY,
        cloud_id TEXT,
        shop_id INTEGER,
        ingredient_id TEXT NOT NULL,
        change_type TEXT NOT NULL,
        quantity_change REAL NOT NULL,
        previous_stock REAL NOT NULL,
        new_stock REAL NOT NULL,
        reference_id TEXT,
        notes TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('[DB] Multi-Branch Recipe & Inventory tables initialized.');
  }

  // Migration from version 11 to 12 (Pizza Management Realtime Table Integration)
  if (fromVersion < 12) {
    console.log('[DB] Running migration to v12 (Pizza Management Realtime Table Integration)...');

    if (!columnExists('tables', 'cloud_id')) {
      db.exec(`ALTER TABLE tables ADD COLUMN cloud_id TEXT`);
    }
    if (!columnExists('tables', 'shop_id')) {
      db.exec(`ALTER TABLE tables ADD COLUMN shop_id INTEGER`);
    }
    if (!columnExists('tables', 'token_code')) {
      db.exec(`ALTER TABLE tables ADD COLUMN token_code TEXT`);
    }
    if (!columnExists('tables', 'name')) {
      db.exec(`ALTER TABLE tables ADD COLUMN name TEXT`);
    }
    console.log('[DB] Tables table upgraded for Pizza Management cloud sync.');
  }

  // Migration from version 12 to 13 (Fix missing shop_id on categories, products, orders)
  if (fromVersion < 13) {
    console.log('[DB] Running migration to v13 (Ensuring shop_id on all multi-tenant tables)...');

    if (!columnExists('categories', 'shop_id')) {
      db.exec(`ALTER TABLE categories ADD COLUMN shop_id INTEGER`);
    }
    if (!columnExists('categories', 'cloud_id')) {
      db.exec(`ALTER TABLE categories ADD COLUMN cloud_id TEXT`);
    }
    if (!columnExists('products', 'shop_id')) {
      db.exec(`ALTER TABLE products ADD COLUMN shop_id INTEGER`);
    }
    if (!columnExists('products', 'cloud_id')) {
      db.exec(`ALTER TABLE products ADD COLUMN cloud_id TEXT`);
    }
    if (!columnExists('orders', 'shop_id')) {
      db.exec(`ALTER TABLE orders ADD COLUMN shop_id INTEGER`);
    }
    if (!columnExists('users', 'shop_id')) {
      db.exec(`ALTER TABLE users ADD COLUMN shop_id INTEGER`);
    }
    if (!columnExists('tables', 'shop_id')) {
      db.exec(`ALTER TABLE tables ADD COLUMN shop_id INTEGER`);
    }
    console.log('[DB] v13 migration complete: shop_id ensured on all tables.');
  }

  // Migration from version 13 to 14 (Dual thermal printers: counter + kitchen printer & receipt copies)
  if (fromVersion < 14) {
    console.log('[DB] Running migration to v14 (Dual thermal printers & receipt preferences)...');

    if (!columnExists('printers', 'is_kitchen')) {
      db.exec(`ALTER TABLE printers ADD COLUMN is_kitchen INTEGER DEFAULT 0`);
    }
    insert('receipt_copies', 'customer');
    insert('kitchen_printer_id', '');
    console.log('[DB] v14 migration complete: is_kitchen column and receipt_copies setting ensured.');
  }

  // Migration from version 14 to 15 (Customer name field on orders for POS & Receipts)
  if (fromVersion < 15) {
    console.log('[DB] Running migration to v15 (Customer name field on orders)...');

    if (!columnExists('orders', 'customer_name')) {
      db.exec(`ALTER TABLE orders ADD COLUMN customer_name TEXT`);
    }
    console.log('[DB] v15 migration complete: customer_name ensured on orders table.');
  }

  // Migration from version 15 to 16 (Customer phone field on orders for Delivery & POS)
  if (fromVersion < 16) {
    console.log('[DB] Running migration to v16 (Customer phone field on orders)...');

    if (!columnExists('orders', 'customer_phone')) {
      db.exec(`ALTER TABLE orders ADD COLUMN customer_phone TEXT`);
    }
    console.log('[DB] v16 migration complete: customer_phone ensured on orders table.');
  }

  // Migration from version 16 to 17 (Deals table & items_included for detailed deal print slips)
  if (fromVersion < 17) {
    console.log('[DB] Running migration to v17 (Deals table & items_included for deal print slips)...');

    db.exec(`
      CREATE TABLE IF NOT EXISTS deals (
        id TEXT PRIMARY KEY,
        cloud_id TEXT,
        shop_id INTEGER,
        product_id TEXT,
        title TEXT NOT NULL,
        slug TEXT,
        description TEXT,
        deal_price REAL DEFAULT 0,
        original_price REAL DEFAULT 0,
        items_included TEXT,
        badge TEXT,
        is_active INTEGER DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    if (!columnExists('products', 'items_included')) {
      db.exec(`ALTER TABLE products ADD COLUMN items_included TEXT`);
    }
    if (!columnExists('order_items', 'items_included')) {
      db.exec(`ALTER TABLE order_items ADD COLUMN items_included TEXT`);
    }
    console.log('[DB] v17 migration complete: deals table and items_included ensured.');
  }

  // Migration from version 17 to 18 (Payment method on orders and bills for POS Cash/Online tracking)
  if (fromVersion < 18) {
    console.log('[DB] Running migration to v18 (Payment method on orders and bills)...');

    if (!columnExists('orders', 'payment_method')) {
      db.exec("ALTER TABLE orders ADD COLUMN payment_method TEXT DEFAULT 'cash'");
    }
    if (!columnExists('bills', 'payment_method')) {
      db.exec("ALTER TABLE bills ADD COLUMN payment_method TEXT DEFAULT 'cash'");
    }
    console.log('[DB] v18 migration complete: payment_method ensured on orders and bills.');
  }


  // Update schema version
  db.prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES ('schema_version', ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(String(SCHEMA_VERSION));
  console.log('[DB] Incremental migration complete (version ' + SCHEMA_VERSION + ')');
}

function createSchema(): void {
  db.exec(`
    -- ── Master data tables ──────────────────────────────────────────────

    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      cloud_id TEXT,
      shop_id INTEGER,
      name TEXT NOT NULL,
      description TEXT,
      image_url TEXT,
      sort_order INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      parent_id TEXT,
      slug TEXT,
      color TEXT,
      icon TEXT,
      deleted_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      cloud_id TEXT,
      shop_id INTEGER,
      category_id TEXT,
      name TEXT NOT NULL,
      slug TEXT,
      description TEXT,
      price REAL NOT NULL DEFAULT 0,
      cost REAL DEFAULT 0,
      sku TEXT,
      barcode TEXT,
      image_url TEXT,
      is_active INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0,
      track_inventory INTEGER DEFAULT 0,
      stock_quantity REAL DEFAULT 0,
      low_stock_threshold REAL DEFAULT 5,
      tax_type TEXT DEFAULT 'none',
      tax_rate REAL DEFAULT 0,
      cb_percent REAL DEFAULT 0,
      tags TEXT,
      items_included TEXT,
      deleted_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (category_id) REFERENCES categories(id)
    );

    CREATE TABLE IF NOT EXISTS addon_groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      is_required INTEGER DEFAULT 0,
      min_selection INTEGER DEFAULT 0,
      max_selection INTEGER DEFAULT 1,
      is_active INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS addons (
      id TEXT PRIMARY KEY,
      addon_group_id TEXT NOT NULL,
      name TEXT NOT NULL,
      price REAL NOT NULL DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (addon_group_id) REFERENCES addon_groups(id)
    );

    CREATE TABLE IF NOT EXISTS addon_group_product (
      product_id TEXT NOT NULL,
      addon_group_id TEXT NOT NULL,
      PRIMARY KEY (product_id, addon_group_id)
    );

    CREATE TABLE IF NOT EXISTS kitchen_stations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      category_ids TEXT,
      printer_ip TEXT,
      printer_port INTEGER DEFAULT 9100,
      printer_name TEXT,
      is_active INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS tables (
      id TEXT PRIMARY KEY,
      cloud_id TEXT,
      shop_id INTEGER,
      token_code TEXT,
      name TEXT,
      number TEXT NOT NULL UNIQUE,
      capacity INTEGER DEFAULT 4,
      status TEXT DEFAULT 'available',
      floor TEXT,
      section TEXT,
      position_x REAL,
      position_y REAL,
      kitchen_station_id TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      country_code TEXT DEFAULT '+91',
      address TEXT,
      loyalty_points INTEGER DEFAULT 0,
      notes TEXT,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- ── Users (authentication + roles) ──────────────────────────────────
    -- Roles: owner, manager, cashier, waiter, chef
    -- KDS is operated by the chef role.

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE,
      password TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'cashier'
        CHECK (role IN ('owner', 'manager', 'cashier', 'waiter', 'chef')),
      pin TEXT,
      shop_id INTEGER,
      category_ids TEXT,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- ── Transactional tables ─────────────────────────────────────────────

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_number TEXT UNIQUE NOT NULL,
      cloud_order_id TEXT,
      shop_id INTEGER,
      order_source TEXT DEFAULT 'pos',
      delivery_address TEXT,
      delivery_fee REAL DEFAULT 0,
      is_synced INTEGER DEFAULT 0,
      table_id TEXT,
      customer_id TEXT,
      customer_name TEXT,
      customer_phone TEXT,
      user_id TEXT,
      type TEXT DEFAULT 'takeaway',
      payment_method TEXT DEFAULT 'cash',
      guest_count INTEGER,
      special_instructions TEXT,
      items_included TEXT,
      packaging_charge REAL DEFAULT 0,
      delivery_charge REAL DEFAULT 0,
      status TEXT DEFAULT 'pending',
      subtotal REAL DEFAULT 0,
      tax_amount REAL DEFAULT 0,
      tax_breakdown TEXT,
      discount_amount REAL DEFAULT 0,
      discount_type TEXT,
      discount_value REAL,
      discount_reason TEXT,
      round_off REAL DEFAULT 0,
      total REAL DEFAULT 0,
      cooking_started_at TEXT,
      ready_at TEXT,
      served_at TEXT,
      completed_at TEXT,
      cancelled_at TEXT,
      cancellation_reason TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      product_id TEXT NOT NULL,
      product_name TEXT NOT NULL,
      product_sku TEXT,
      unit_price REAL NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      subtotal REAL NOT NULL,
      tax_amount REAL DEFAULT 0,
      tax_breakdown TEXT,
      tax_type TEXT,
      discount_amount REAL DEFAULT 0,
      total REAL NOT NULL,
      variant_selection TEXT,
      modifier_selection TEXT,
      addons TEXT,
      special_instructions TEXT,
      items_included TEXT,
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (order_id) REFERENCES orders(id)
    );

    CREATE TABLE IF NOT EXISTS bills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bill_number TEXT UNIQUE NOT NULL,
      order_id INTEGER NOT NULL,
      customer_id TEXT,
      subtotal REAL DEFAULT 0,
      tax_amount REAL DEFAULT 0,
      tax_breakdown TEXT,
      discount_amount REAL DEFAULT 0,
      discount_type TEXT,
      discount_value REAL,
      discount_reason TEXT,
      delivery_charge REAL DEFAULT 0,
      packaging_charge REAL DEFAULT 0,
      round_off REAL DEFAULT 0,
      total REAL DEFAULT 0,
      paid_amount REAL DEFAULT 0,
      balance REAL DEFAULT 0,
      payment_status TEXT DEFAULT 'unpaid',
      payment_method TEXT DEFAULT 'cash',
      payment_details TEXT,
      paid_at TEXT,
      printed_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (order_id) REFERENCES orders(id)
    );

    CREATE TABLE IF NOT EXISTS loyalty_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id TEXT NOT NULL,
      bill_id INTEGER,
      type TEXT NOT NULL,
      amount REAL NOT NULL,
      description TEXT,
      expires_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- ── Recipe & Inventory tables (per shop isolation) ───────────────────

    CREATE TABLE IF NOT EXISTS raw_ingredients (
      id TEXT PRIMARY KEY,
      cloud_id TEXT,
      shop_id INTEGER,
      name TEXT NOT NULL,
      category TEXT DEFAULT 'meat',
      unit TEXT DEFAULT 'kg',
      current_stock REAL DEFAULT 0,
      low_stock_threshold REAL DEFAULT 1,
      cost_per_unit REAL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS product_recipes (
      id TEXT PRIMARY KEY,
      cloud_id TEXT,
      shop_id INTEGER,
      product_id TEXT NOT NULL,
      variation_name TEXT,
      ingredient_id TEXT NOT NULL,
      quantity_required REAL DEFAULT 0,
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS ingredient_wastage_logs (
      id TEXT PRIMARY KEY,
      cloud_id TEXT,
      shop_id INTEGER,
      ingredient_id TEXT NOT NULL,
      quantity_wasted REAL DEFAULT 0,
      reason TEXT NOT NULL,
      reported_by TEXT DEFAULT 'Chef',
      cost_loss REAL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS ingredient_stock_logs (
      id TEXT PRIMARY KEY,
      cloud_id TEXT,
      shop_id INTEGER,
      ingredient_id TEXT NOT NULL,
      change_type TEXT NOT NULL,
      quantity_change REAL NOT NULL,
      previous_stock REAL NOT NULL,
      new_stock REAL NOT NULL,
      reference_id TEXT,
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- ── Config tables ────────────────────────────────────────────────────

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS kds_pairing_tokens (
      id TEXT PRIMARY KEY,
      token TEXT UNIQUE NOT NULL,
      station_id TEXT,
      expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS printers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      connection_type TEXT NOT NULL CHECK (connection_type IN ('network', 'usb', 'webusb')),
      ip_address TEXT,
      port INTEGER DEFAULT 9100,
      usb_device_path TEXT,
      is_default INTEGER DEFAULT 0,
      is_kitchen INTEGER DEFAULT 0,
      paper_width TEXT DEFAULT '80mm',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- ── Indexes ──────────────────────────────────────────────────────────

    CREATE INDEX idx_products_category ON products(category_id);
    CREATE INDEX idx_products_active   ON products(is_active);
    CREATE INDEX idx_orders_status     ON orders(status);
    CREATE INDEX idx_orders_created    ON orders(created_at);
    CREATE INDEX idx_orders_user       ON orders(user_id);
    CREATE INDEX idx_order_items_order ON order_items(order_id);
    CREATE INDEX idx_bills_order       ON bills(order_id);
  `);
}

function seedData(): void {
  const insert = (key: string, value: string) =>
    db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run(key, value);

  insert('schema_version',      String(SCHEMA_VERSION));
  insert('business_name',       'Sole-What');
  insert('country',             'PK');
  insert('currency',            'PKR');
  insert('currency_symbol',     'Rs');
  insert('timezone',            'Asia/Karachi');
  insert('address',             '');
  insert('phone',               '');
  insert('email',               '');
  insert('tax_registered',      'false');
  insert('gstin',               '');
  insert('state_code',          '');
  insert('tax_scheme',          'regular');
  insert('billing_type',        'postpaid');
  insert('loyalty_expiry_days', '365');
  insert('cloud_server_url',    '');
  insert('cloud_connected',     'false');
  insert('supabase_url',        'https://uadrrjrlhfttithjmdye.supabase.co');
  insert('supabase_key',        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVhZHJyanJsaGZ0dGl0aGptZHllIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MDYwNTg2OCwiZXhwIjoyMTA2MTgxODY4fQ.NuC74GhFlUEiaRR2BXPooYj7iahzrXXKCxMQYDUnfIg');
  insert('cloud_sync_enabled',  '1');
  insert('cloud_auto_print_kot','1');
  insert('cloud_auto_print_bill','1');
  insert('cloud_last_sync',     '');
  insert('pizza_system_mode',   'integrated');
  insert('receipt_copies',      'customer');
  insert('kitchen_printer_id',  '');

  // Note: All POS staff accounts are synchronized from Pizza Management Super Admin (Supabase pos_staff)
  db.exec("DELETE FROM users WHERE id IN ('user-1', 'user-2', 'user-3', 'user-4') OR email LIKE '%@flo.local';");

  // Default printer (will be detected on first run)
  db.prepare(`
    INSERT OR IGNORE INTO printers (id, name, connection_type, paper_width, is_default)
    VALUES (?, ?, ?, ?, ?)
  `).run('printer-1', 'Thermal Printer', 'usb', '80mm', 1);

  // Sample categories
  const cats = [
    ['cat-1', 'Food',      '#FF6B6B', '🍔', 1],
    ['cat-2', 'Beverages', '#4ECDC4', '🥤', 2],
    ['cat-3', 'Desserts',  '#FFE66D', '🍰', 3],
  ];
  for (const [id, name, color, icon, sort] of cats) {
    db.prepare(`
      INSERT OR IGNORE INTO categories (id, name, color, icon, sort_order)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, name, color, icon, sort);
  }

  // Sample products
  const products = [
    ['prod-1', 'cat-1', 'Cheeseburger',     250.00, 1],
    ['prod-2', 'cat-1', 'Veggie Wrap',       180.00, 2],
    ['prod-3', 'cat-1', 'Chicken Sandwich',  220.00, 3],
    ['prod-4', 'cat-1', 'French Fries',       80.00, 4],
    ['prod-5', 'cat-2', 'Cola',               60.00, 1],
    ['prod-6', 'cat-2', 'Fresh Lime Soda',    70.00, 2],
    ['prod-7', 'cat-2', 'Mango Lassi',        90.00, 3],
    ['prod-8', 'cat-2', 'Mineral Water',      30.00, 4],
    ['prod-9', 'cat-3', 'Chocolate Brownie', 120.00, 1],
    ['prod-10','cat-3', 'Ice Cream Scoop',    80.00, 2],
  ];
  for (const [id, catId, name, price, sort] of products) {
    db.prepare(`
      INSERT OR IGNORE INTO products (id, category_id, name, price, sort_order, is_active)
      VALUES (?, ?, ?, ?, ?, 1)
    `).run(id, catId, name, price, sort);
  }

  // Sample tables
  const tables = [
    ['tbl-1', 'T1', 4], ['tbl-2', 'T2', 4],  ['tbl-3', 'T3', 6],
    ['tbl-4', 'T4', 2], ['tbl-5', 'T5', 4],  ['tbl-6', 'T6', 8],
  ];
  for (const [id, number, capacity] of tables) {
    db.prepare(`
      INSERT OR IGNORE INTO tables (id, number, capacity)
      VALUES (?, ?, ?)
    `).run(id, number, capacity);
  }

  try { db.exec("UPDATE orders SET created_at = datetime('now') WHERE created_at IS NULL OR created_at = '0' OR created_at = 0;"); } catch {}
  console.log('[DB] Seed data loaded');
}

export function generateOrderNumber(): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const prefix = `ORD-${date}-`;
  const latest = db.prepare(
    "SELECT order_number FROM orders WHERE order_number LIKE ? ORDER BY id DESC LIMIT 1"
  ).get(`${prefix}%`) as { order_number?: string } | undefined;

  let nextSeq = 1;
  if (latest?.order_number) {
    const parts = latest.order_number.split('-');
    const lastNum = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(lastNum)) {
      nextSeq = lastNum + 1;
    }
  }

  while (db.prepare("SELECT 1 FROM orders WHERE order_number = ?").get(`${prefix}${String(nextSeq).padStart(4, '0')}`)) {
    nextSeq++;
  }

  return `${prefix}${String(nextSeq).padStart(4, '0')}`;
}

export function generateBillNumber(): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const prefix = `INV-${date}-`;
  const latest = db.prepare(
    "SELECT bill_number FROM bills WHERE bill_number LIKE ? ORDER BY id DESC LIMIT 1"
  ).get(`${prefix}%`) as { bill_number?: string } | undefined;

  let nextSeq = 1;
  if (latest?.bill_number) {
    const parts = latest.bill_number.split('-');
    const lastNum = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(lastNum)) {
      nextSeq = lastNum + 1;
    }
  }

  while (db.prepare("SELECT 1 FROM bills WHERE bill_number = ?").get(`${prefix}${String(nextSeq).padStart(4, '0')}`)) {
    nextSeq++;
  }

  return `${prefix}${String(nextSeq).padStart(4, '0')}`;
}

export function now(): string {
  return new Date().toISOString();
}

/** Parse JSON string fields on order_item rows returned from SQLite.
 *  Stored as JSON.stringify(value) — may be "null", "[...]", "{...}" etc.
 *  Returns actual JS value (array / object / null) so the frontend can map/iterate. */
export function parseItemJson(item: any): any {
  const tryParse = (val: any) => {
    if (!val || val === 'null' || val === 'undefined') return null;
    if (typeof val !== 'string') return val;
    try {
      const parsed = JSON.parse(val);
      if (parsed === 'null' || parsed === 'undefined') return null;
      return parsed;
    } catch {
      return val;
    }
  };
  return {
    ...item,
    addons: tryParse(item.addons),
    variant_selection: tryParse(item.variant_selection),
    modifier_selection: tryParse(item.modifier_selection),
    tax_breakdown: tryParse(item.tax_breakdown),
  };
}
