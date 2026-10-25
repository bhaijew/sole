import { createClient, SupabaseClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import bcrypt from 'bcryptjs';
import { getDatabase, now } from '../db';
import { notifyKdsUpdate } from './kds';
import { printKOT, printReceipt } from '../printers/thermal';

let supabaseClient: SupabaseClient | null = null;
let realtimeChannel: any = null;
let isRealtimeListening = false;

/**
 * Get setting value from SQLite settings table
 */
function getSetting(key: string, defaultValue: string = ''): string {
  try {
    const db = getDatabase();
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as any;
    return row?.value || defaultValue;
  } catch {
    return defaultValue;
  }
}

/**
 * Set setting value in SQLite settings table
 */
function setSetting(key: string, value: string): void {
  try {
    const db = getDatabase();
    db.prepare(`
      INSERT INTO settings (key, value, updated_at) 
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(key, value);
  } catch (err) {
    console.error(`[CloudSync] Error saving setting ${key}:`, err);
  }
}

/**
 * Initialize or get active Supabase client
 */
export function getSupabaseClient(): SupabaseClient | null {
  const url = getSetting('supabase_url', 'https://uadrrjrlhfttithjmdye.supabase.co');
  const key = getSetting('supabase_key', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVhZHJyanJsaGZ0dGl0aGptZHllIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MDYwNTg2OCwiZXhwIjoyMTA2MTgxODY4fQ.NuC74GhFlUEiaRR2BXPooYj7iahzrXXKCxMQYDUnfIg');

  if (!url || !key) {
    console.warn('[CloudSync] Missing supabase_url or supabase_key in settings');
    return null;
  }

  if (!supabaseClient) {
    try {
      supabaseClient = createClient(url, key, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
        realtime: {
          transport: WebSocket as any,
        },
      });
      console.log('[CloudSync] Supabase client initialized for:', url);
    } catch (err) {
      console.error('[CloudSync] Failed to initialize Supabase client:', err);
      return null;
    }
  }

  return supabaseClient;
}

/**
 * Reset client if settings change
 */
export function resetSupabaseClient(): void {
  stopRealtimeOrderListener();
  supabaseClient = null;
}

/**
 * Test Supabase cloud connection
 */
export async function testCloudConnection(): Promise<{ success: boolean; message: string; data?: any }> {
  try {
    const client = getSupabaseClient();
    if (!client) {
      return { success: false, message: 'Supabase credentials not configured' };
    }

    const { data, error } = await client.from('categories').select('id, name').limit(1);
    if (error) {
      return { success: false, message: `Cloud connection error: ${error.message}` };
    }

    return { 
      success: true, 
      message: 'Connection to Pizza System (Supabase) successful!', 
      data: { categoriesSample: data } 
    };
  } catch (err: any) {
    return { success: false, message: `Connection failed: ${err.message || String(err)}` };
  }
}

/**
 * Pull Categories and Products from Pizza System (Supabase) into local SQLite
 */
export async function syncMenuFromCloud(forcedShopId?: number | string): Promise<{
  success: boolean;
  message: string;
  categoriesCount?: number;
  productsCount?: number;
}> {
  const db = getDatabase();
  const client = getSupabaseClient();

  if (!client) {
    return { success: false, message: 'Supabase client not available' };
  }

  try {
    let shopId = forcedShopId !== undefined ? String(forcedShopId) : getSetting('cloud_shop_id', '');
    try {
      let targetShop: any = null;
      if (shopId) {
        const { data } = await client.from('shops').select('id, name, slug, address, phone').eq('id', Number(shopId)).maybeSingle();
        targetShop = data;
      }
      if (!targetShop) {
        const { data } = await client.from('shops').select('id, name, slug, address, phone').limit(1).maybeSingle();
        targetShop = data;
      }
      if (targetShop) {
        shopId = String(targetShop.id);
        setSetting('cloud_shop_id', shopId);
        setSetting('cloud_shop_name', targetShop.name);
        setSetting('cloud_shop_slug', targetShop.slug);
        setSetting('business_name', targetShop.name);
        setSetting('shop_name', targetShop.name);
        if (targetShop.address) {
          setSetting('address', targetShop.address);
          setSetting('business_address', targetShop.address);
        }
        if (targetShop.phone) {
          setSetting('phone', targetShop.phone);
          setSetting('business_phone', targetShop.phone);
        }
      }
    } catch (shopSyncErr: any) {
      console.warn('[CloudSync] Notice while updating active shop details:', shopSyncErr?.message);
    }
    console.log(`[CloudSync] Starting Menu Sync from Pizza System (Branch Filter: ${shopId ? `Shop #${shopId}` : 'All Branches'})...`);

    // 1. Fetch Categories for this branch or global
    let catQuery = client.from('categories').select('*').order('sort_order', { ascending: true });
    if (shopId) {
      catQuery = catQuery.eq('shop_id', Number(shopId));
    }
    const { data: cloudCategories, error: catError } = await catQuery;

    if (catError) {
      throw new Error(`Failed to fetch categories: ${catError.message}`);
    }

    // 2. Fetch Products for this branch or global
    let prodQuery = client.from('products').select('*').order('sort_order', { ascending: true });
    if (shopId) {
      prodQuery = prodQuery.eq('shop_id', Number(shopId));
    }
    const { data: cloudProducts, error: prodError } = await prodQuery;

    if (prodError) {
      throw new Error(`Failed to fetch products: ${prodError.message}`);
    }

    // 3. Fetch Raw Ingredients & Recipes for this branch
    let cloudIngredients: any[] = [];
    let cloudRecipes: any[] = [];
    try {
      let ingQuery = client.from('raw_ingredients').select('*');
      if (shopId) ingQuery = ingQuery.eq('shop_id', Number(shopId));
      const ingRes = await ingQuery;
      if (ingRes.data) cloudIngredients = ingRes.data;
    } catch (ingErr) {
      console.warn('[CloudSync] Could not fetch raw_ingredients:', ingErr);
    }

    try {
      let recQuery = client.from('product_recipes').select('*');
      if (shopId) recQuery = recQuery.eq('shop_id', Number(shopId));
      const recRes = await recQuery;
      if (recRes.data) cloudRecipes = recRes.data;
    } catch (recErr) {
      console.warn('[CloudSync] Could not fetch product_recipes:', recErr);
    }

    let syncedCategories = 0;
    let syncedProducts = 0;

    // Run local SQLite upserts inside a transaction for speed & consistency
    const syncTransaction = db.transaction(() => {
      // Mapping from cloud category id -> local category id
      const categoryMap = new Map<string, string>();

      // Strict branch isolation: wipe any items not belonging to the active shop
      if (shopId) {
        db.prepare('DELETE FROM products WHERE shop_id != ? OR shop_id IS NULL OR cloud_id IS NULL').run(Number(shopId));
        db.prepare('DELETE FROM categories WHERE shop_id != ? OR shop_id IS NULL OR cloud_id IS NULL').run(Number(shopId));
      } else {
        db.exec(`
          DELETE FROM products WHERE id IN ('prod-1', 'prod-2', 'prod-3', 'prod-4', 'prod-5', 'prod-6', 'prod-7', 'prod-8', 'prod-9', 'prod-10') OR (cloud_id IS NULL AND id LIKE 'prod-%');
          DELETE FROM categories WHERE id IN ('cat-1', 'cat-2', 'cat-3') OR (cloud_id IS NULL AND id LIKE 'cat-%');
        `);
      }

      // Upsert Categories
      const findCatStmt = db.prepare('SELECT id FROM categories WHERE cloud_id = ? OR slug = ? LIMIT 1');
      const updateCatStmt = db.prepare(`
        UPDATE categories 
        SET name = ?, slug = ?, description = ?, image_url = ?, sort_order = ?, is_active = ?, shop_id = ?, updated_at = datetime('now')
        WHERE id = ?
      `);
      const insertCatStmt = db.prepare(`
        INSERT INTO categories (id, cloud_id, name, slug, description, image_url, sort_order, is_active, shop_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const cat of cloudCategories || []) {
        const cloudIdStr = String(cat.id);
        const existing = findCatStmt.get(cloudIdStr, cat.slug) as any;
        let localId: string;

        const isActive = cat.is_active ? 1 : 0;
        const sortOrder = Number(cat.sort_order) || 0;

        const catShopId = cat.shop_id ? Number(cat.shop_id) : (shopId ? Number(shopId) : null);
        if (existing) {
          localId = existing.id;
          updateCatStmt.run(cat.name, cat.slug, cat.description || null, cat.image_url || null, sortOrder, isActive, catShopId, localId);
        } else {
          localId = `cloud_cat_${cat.id}`;
          insertCatStmt.run(localId, cloudIdStr, cat.name, cat.slug, cat.description || null, cat.image_url || null, sortOrder, isActive, catShopId);
        }

        categoryMap.set(cloudIdStr, localId);
        syncedCategories++;
      }

      // Upsert Products
      const findProdStmt = db.prepare('SELECT id FROM products WHERE cloud_id = ? OR slug = ? LIMIT 1');
      const updateProdStmt = db.prepare(`
        UPDATE products 
        SET category_id = ?, name = ?, slug = ?, description = ?, price = ?, image_url = ?, 
            is_active = ?, sort_order = ?, track_inventory = ?, stock_quantity = ?, 
            low_stock_threshold = ?, tags = ?, shop_id = ?, updated_at = datetime('now')
        WHERE id = ?
      `);
      const insertProdStmt = db.prepare(`
        INSERT INTO products (id, cloud_id, category_id, name, slug, description, price, image_url, is_active, sort_order, track_inventory, stock_quantity, low_stock_threshold, tags, shop_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const prod of cloudProducts || []) {
        const cloudIdStr = String(prod.id);
        const localCatId = categoryMap.get(String(prod.category_id)) || null;
        const existing = findProdStmt.get(cloudIdStr, prod.slug) as any;

        const isActive = (prod.is_active !== false && prod.is_available !== false) ? 1 : 0;
        const price = Number(prod.price) || 0;
        const sortOrder = Number(prod.sort_order) || 0;
        const trackInv = prod.track_inventory ? 1 : 0;
        const stockQty = Number(prod.stock_quantity) || 0;
        const lowStock = Number(prod.low_stock_threshold) || 5;
        
        // Store variations / toppings info in tags field as JSON
        let metaTags = '';
        if (prod.variations && Array.isArray(prod.variations) && prod.variations.length > 0) {
          metaTags = JSON.stringify({ variations: prod.variations, extra_toppings: prod.extra_toppings });
        }

        const prodShopId = prod.shop_id ? Number(prod.shop_id) : (shopId ? Number(shopId) : null);
        if (existing) {
          updateProdStmt.run(
            localCatId, prod.name, prod.slug || null, prod.description || null, price, prod.image_url || null,
            isActive, sortOrder, trackInv, stockQty, lowStock, metaTags, prodShopId, existing.id
          );
        } else {
          const localId = `cloud_prod_${prod.id}`;
          insertProdStmt.run(
            localId, cloudIdStr, localCatId, prod.name, prod.slug || null, prod.description || null, price, prod.image_url || null,
            isActive, sortOrder, trackInv, stockQty, lowStock, metaTags, prodShopId
          );
        }

        syncedProducts++;
      }
      // Clean up any cloud products that were deleted or don't belong to this branch
      const activeCloudProdIds = new Set((cloudProducts || []).map((p: any) => String(p.id)));
      const localCloudProds = db.prepare("SELECT id, cloud_id FROM products WHERE cloud_id IS NOT NULL").all() as any[];
      for (const lp of localCloudProds) {
        if (!activeCloudProdIds.has(String(lp.cloud_id))) {
          db.prepare("DELETE FROM products WHERE id = ?").run(lp.id);
        }
      }

      // Clean up any cloud categories that were deleted or don't belong to this branch
      const activeCloudCatIds = new Set((cloudCategories || []).map((c: any) => String(c.id)));
      const localCloudCats = db.prepare("SELECT id, cloud_id FROM categories WHERE cloud_id IS NOT NULL").all() as any[];
      for (const lc of localCloudCats) {
        if (!activeCloudCatIds.has(String(lc.cloud_id))) {
          db.prepare("DELETE FROM categories WHERE id = ?").run(lc.id);
        }
      }

      // Multi-Branch Recipe & Raw Material Inventory Isolation
      if (shopId) {
        db.prepare('DELETE FROM raw_ingredients WHERE shop_id != ? OR shop_id IS NULL').run(Number(shopId));
        db.prepare('DELETE FROM product_recipes WHERE shop_id != ? OR shop_id IS NULL').run(Number(shopId));
      }

      // Upsert Raw Ingredients for this branch
      if (cloudIngredients && Array.isArray(cloudIngredients)) {
        const insertIngStmt = db.prepare(`
          INSERT INTO raw_ingredients (id, cloud_id, shop_id, name, category, unit, current_stock, low_stock_threshold, cost_per_unit, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
          ON CONFLICT(id) DO UPDATE SET
            cloud_id = excluded.cloud_id,
            shop_id = excluded.shop_id,
            name = excluded.name,
            category = excluded.category,
            unit = excluded.unit,
            current_stock = excluded.current_stock,
            low_stock_threshold = excluded.low_stock_threshold,
            cost_per_unit = excluded.cost_per_unit,
            updated_at = excluded.updated_at
        `);
        for (const ing of cloudIngredients) {
          insertIngStmt.run(
            `cloud_ing_${ing.id}`,
            String(ing.id),
            ing.shop_id ? Number(ing.shop_id) : (shopId ? Number(shopId) : null),
            ing.name,
            ing.category || 'meat',
            ing.unit || 'kg',
            Number(ing.current_stock) || 0,
            Number(ing.low_stock_threshold) || 1,
            Number(ing.cost_per_unit) || 0
          );
        }
      }

      // Upsert Product Recipes for this branch
      if (cloudRecipes && Array.isArray(cloudRecipes)) {
        const insertRecStmt = db.prepare(`
          INSERT INTO product_recipes (id, cloud_id, shop_id, product_id, variation_name, ingredient_id, quantity_required, notes)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            cloud_id = excluded.cloud_id,
            shop_id = excluded.shop_id,
            product_id = excluded.product_id,
            variation_name = excluded.variation_name,
            ingredient_id = excluded.ingredient_id,
            quantity_required = excluded.quantity_required,
            notes = excluded.notes
        `);
        for (const r of cloudRecipes) {
          insertRecStmt.run(
            `cloud_rec_${r.id}`,
            String(r.id),
            r.shop_id ? Number(r.shop_id) : (shopId ? Number(shopId) : null),
            String(r.product_id),
            r.variation_name || null,
            String(r.ingredient_id),
            Number(r.quantity_required) || 0,
            r.notes || null
          );
        }
      }
    });

    syncTransaction();

    const timestamp = new Date().toISOString();
    setSetting('cloud_last_sync', timestamp);

    console.log(`[CloudSync] Menu Sync complete: ${syncedCategories} categories, ${syncedProducts} products synced.`);
    return {
      success: true,
      message: `Menu synced successfully: ${syncedCategories} categories, ${syncedProducts} products.`,
      categoriesCount: syncedCategories,
      productsCount: syncedProducts,
    };
  } catch (err: any) {
    console.error('[CloudSync] Menu Sync failed:', err);
    return {
      success: false,
      message: `Menu sync failed: ${err.message || String(err)}`,
    };
  }
}

/**
 * Direct lookup of staff or shop owner across Supabase by PIN
 */
export async function findStaffByPinInCloud(pin: string): Promise<{
  id: string;
  name: string;
  role: string;
  shop_id: number;
  email?: string;
} | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  try {
    const trimmedPin = String(pin).trim();

    // 1. Look in pos_staff
    const { data: staffList, error } = await client
      .from('pos_staff')
      .select('id, name, full_name, email, role, pin, shop_id, is_active, has_pos_access')
      .eq('pin', trimmedPin)
      .eq('is_active', true)
      .eq('has_pos_access', true)
      .limit(1);

    if (!error && staffList && staffList.length > 0) {
      const s = staffList[0];
      return {
        id: `cloud_staff_${s.id}`,
        name: s.name || s.full_name || 'Staff Member',
        role: s.role || 'cashier',
        shop_id: s.shop_id ? Number(s.shop_id) : 4,
        email: s.email || undefined,
      };
    }

    // 2. Look in shops table for owner
    const { data: shops } = await client
      .from('shops')
      .select('id, name, owner_name, owner_email, status, password')
      .eq('status', 'active');

    if (shops) {
      for (const sh of shops) {
        if (sh.password === trimmedPin) {
          return {
            id: `cloud_shop_owner_${sh.id}`,
            name: `${sh.owner_name} (Owner)`,
            role: 'owner',
            shop_id: Number(sh.id),
            email: sh.owner_email,
          };
        }
      }
    }

    return null;
  } catch (err: any) {
    console.warn('[CloudSync] findStaffByPinInCloud error:', err.message);
    return null;
  }
}

/**
 * Pull Staff / Users with POS access from Pizza System (Supabase) into local SQLite
 */
export async function syncStaffFromCloud(): Promise<{
  success: boolean;
  message: string;
  staffCount?: number;
}> {
  const db = getDatabase();
  const client = getSupabaseClient();

  if (!client) {
    return { success: false, message: 'Supabase client not available' };
  }

  try {
    const shopId = getSetting('cloud_shop_id', '');
    console.log(`[CloudSync] Starting Staff Sync from Pizza System (Active Branch: ${shopId ? `Shop #${shopId}` : 'All'})...`);
    // Immediately purge legacy dummy accounts from local SQLite
    db.exec("DELETE FROM users WHERE id IN ('user-1', 'user-2', 'user-3', 'user-4') OR email LIKE '%@flo.local';");
    let syncedStaff = 0;

    // Method 1: Check pos_staff table in Supabase across all active shops
    try {
      const res = await client.from('pos_staff').select('*');
      const cloudStaff = res.data;
      const staffError = res.error;

      if (!staffError && cloudStaff) {
        const validStaffIds = new Set<string>();
        for (const s of cloudStaff) {
          try {
            const staffId = `cloud_staff_${s.id}`;
            validStaffIds.add(staffId);
            const name = s.name || s.full_name || 'Staff Member';
            const email = s.email || null;

            // Normalize role to satisfy SQLite CHECK constraint: role IN ('owner', 'manager', 'cashier', 'waiter', 'chef')
            let role = (s.role || 'cashier').toLowerCase();
            if (role === 'sub_admin' || role === 'admin' || role === 'super_admin') role = 'manager';
            if (!['owner', 'manager', 'cashier', 'waiter', 'chef'].includes(role)) {
              role = 'cashier';
            }

            const pin = s.pin ? String(s.pin) : null;
            const isActive = (s.is_active !== false && s.has_pos_access !== false) ? 1 : 0;
            const pwd = s.password ? s.password : bcrypt.hashSync(pin || '1234', 10);

            const existing = db.prepare('SELECT id FROM users WHERE id = ? OR (email = ? AND email IS NOT NULL)').get(staffId, email) as any;
            const staffShopId = s.shop_id ? Number(s.shop_id) : null;
            if (existing) {
              db.prepare(`
                UPDATE users SET name = ?, email = ?, role = ?, pin = ?, is_active = ?, shop_id = ?, updated_at = datetime('now')
                WHERE id = ?
              `).run(name, email, role, pin, isActive, staffShopId, existing.id);
            } else {
              db.prepare(`
                INSERT INTO users (id, name, email, password, role, pin, is_active, shop_id, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
              `).run(staffId, name, email, pwd, role, pin, isActive, staffShopId);
            }
            syncedStaff++;
          } catch (staffItemErr: any) {
            console.warn(`[CloudSync] Error syncing staff ${s.name || s.id}:`, staffItemErr.message);
          }
        }

        // Clean up any staff removed from Supabase pos_staff table
        const localCloudStaff = db.prepare("SELECT id FROM users WHERE id LIKE 'cloud_staff_%'").all() as { id: string }[];
        for (const lcs of localCloudStaff) {
          if (!validStaffIds.has(lcs.id)) {
            db.prepare("DELETE FROM users WHERE id = ?").run(lcs.id);
          }
        }
      }
    } catch (e: any) {
      console.warn('[CloudSync] Staff sync pos_staff note:', e.message);
    }

    // Method 1b: Ensure active shops' owners from `shops` table are provisioned
    try {
      const { data: allShops } = await client.from('shops').select('id, name, owner_name, owner_email, status, password');
      if (allShops && allShops.length > 0) {
        for (const cs of allShops) {
          const ownerId = `cloud_shop_owner_${cs.id}`;
          const ownerName = `${cs.owner_name} (Owner)`;
          const ownerEmail = cs.owner_email || `shop_${cs.id}_owner@pos.local`;
          const ownerIsActive = cs.status === 'active' ? 1 : 0;

          // If owner already has an entry in pos_staff with shop_id, don't create duplicate
          const alreadyInStaff = db.prepare("SELECT id, pin FROM users WHERE shop_id = ? AND role = 'owner'").get(cs.id) as any;
          if (alreadyInStaff) {
            continue;
          }

          const existingUser = db.prepare('SELECT id, pin FROM users WHERE id = ? OR email = ?').get(ownerId, ownerEmail) as any;
          const ownerPin = existingUser?.pin || (cs.password && String(cs.password).length === 4 ? String(cs.password) : '1234');
          const pwd = bcrypt.hashSync(ownerPin, 10);

          if (existingUser) {
            db.prepare(`
              UPDATE users SET name = ?, email = ?, role = 'owner', is_active = ?, shop_id = ?, updated_at = datetime('now')
              WHERE id = ?
            `).run(ownerName, ownerEmail, ownerIsActive, cs.id, existingUser.id);
          } else {
            db.prepare(`
              INSERT INTO users (id, name, email, password, role, pin, is_active, shop_id, created_at, updated_at)
              VALUES (?, ?, ?, ?, 'owner', ?, ?, ?, datetime('now'), datetime('now'))
            `).run(ownerId, ownerName, ownerEmail, pwd, ownerPin, ownerIsActive, cs.id);
            syncedStaff++;
          }
        }
      }
    } catch (shopOwnerErr: any) {
      console.warn('[CloudSync] Shop owner sync note:', shopOwnerErr.message);
    }

    // Method 2: Check Supabase Auth Users (Super Admin creates/manages users with POS access)
    try {
      const { data: authUsers, error: authError } = await client.auth.admin.listUsers();
      if (!authError && authUsers?.users) {
        for (const u of authUsers.users) {
          const meta = u.user_metadata || {};
          const appMeta = u.app_metadata || {};
          const hasPosAccess = meta.pos_access === true || appMeta.pos_access === true || ['cashier', 'waiter', 'chef', 'manager', 'owner'].includes(meta.role);

          if (hasPosAccess) {
            const staffId = `cloud_auth_${u.id}`;
            const name = meta.name || meta.full_name || (u.email ? u.email.split('@')[0] : 'Staff');
            const email = u.email || null;
            const role = meta.role || 'cashier';
            const pin = meta.pin ? String(meta.pin) : null;
            const isActive = (u as any).banned || (u as any).banned_until ? 0 : 1;
            const pwd = bcrypt.hashSync(pin || '1234', 10);

            const existing = db.prepare('SELECT id FROM users WHERE id = ? OR (email = ? AND email IS NOT NULL)').get(staffId, email) as any;
            if (existing) {
              db.prepare(`
                UPDATE users SET name = ?, email = ?, role = ?, pin = ?, is_active = ?, updated_at = datetime('now')
                WHERE id = ?
              `).run(name, email, role, pin, isActive, existing.id);
            } else {
              db.prepare(`
                INSERT INTO users (id, name, email, password, role, pin, is_active, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
              `).run(staffId, name, email, pwd, role, pin, isActive);
            }
            syncedStaff++;
          }
        }
      }
    } catch (e: any) {
      console.warn('[CloudSync] Auth user sync note:', e.message);
    }

    console.log(`[CloudSync] Staff Sync complete: ${syncedStaff} staff members synced.`);
    return {
      success: true,
      message: `Staff synced successfully: ${syncedStaff} members.`,
      staffCount: syncedStaff,
    };
  } catch (err: any) {
    console.error('[CloudSync] Staff Sync failed:', err);
    return {
      success: false,
      message: `Staff sync failed: ${err.message || String(err)}`,
    };
  }
}

/**
 * Pull and synchronize Tables between local SQLite and Pizza System cloud (Supabase)
 */
export async function syncTablesFromCloud(forcedShopId?: number | string): Promise<{
  success: boolean;
  message: string;
  count?: number;
}> {
  const syncEnabled = getSetting('cloud_sync_enabled', '1') === '1';
  if (!syncEnabled) return { success: false, message: 'Cloud sync is disabled' };

  const client = getSupabaseClient();
  if (!client) return { success: false, message: 'Supabase client not available' };

  try {
    const db = getDatabase();
    const shopId = forcedShopId || getSetting('cloud_shop_id', '');

    // 1. Fetch tables from Supabase for this shop
    const { data: cloudTables, error } = await client
      .from('restaurant_tables')
      .select('*')
      .or(`shop_id.eq.${shopId},shop_id.is.null`)
      .order('table_number');

    if (error) {
      console.warn('[CloudSync] Error fetching restaurant_tables:', error.message);
      return { success: false, message: error.message };
    }

    // 2. Fetch local tables
    const localTables = db.prepare('SELECT * FROM tables').all() as any[];

    // 3. Handle DELETIONS from Pizza Management:
    // If a table was deleted in Pizza Management cloud, remove it locally immediately!
    const cloudIdSet = new Set((cloudTables || []).map((ct: any) => String(ct.id)));
    const cloudNumberSet = new Set((cloudTables || []).map((ct: any) => String(ct.table_number).toLowerCase()));

    let deletedCount = 0;
    const deleteStmt = db.prepare('DELETE FROM tables WHERE id = ?');

    for (const lt of localTables) {
      const existsInCloud =
        (lt.cloud_id && cloudIdSet.has(String(lt.cloud_id))) ||
        cloudNumberSet.has(String(lt.number).toLowerCase());

      if (!existsInCloud) {
        console.log(`[CloudSync] Table ${lt.number} (id: ${lt.id}, cloud_id: ${lt.cloud_id}) was deleted in Pizza Management. Removing locally...`);
        deleteStmt.run(lt.id);
        deletedCount++;
      }
    }

    // 4. Upsert cloud tables into local SQLite
    const insertStmt = db.prepare(`
      INSERT INTO tables (id, cloud_id, shop_id, token_code, name, number, capacity, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const updateStmt = db.prepare(`
      UPDATE tables SET
        cloud_id = ?,
        shop_id = ?,
        token_code = ?,
        name = ?,
        capacity = ?,
        status = CASE WHEN status = 'occupied' THEN 'occupied' ELSE ? END,
        updated_at = ?
      WHERE id = ? OR number = ? OR cloud_id = ?
    `);

    let addedCount = 0;
    let updatedCount = 0;

    if (cloudTables && cloudTables.length > 0) {
      for (const ct of cloudTables) {
        const localStatus = ct.status === 'reserved' ? 'reserved' : (ct.status === 'inactive' ? 'inactive' : 'available');
        const existing = localTables.find(
          (t) => (t.cloud_id && String(t.cloud_id) === String(ct.id)) || String(t.number).toLowerCase() === String(ct.table_number).toLowerCase()
        );

        if (existing) {
          updateStmt.run(
            String(ct.id),
            ct.shop_id || Number(shopId),
            ct.token_code || null,
            ct.table_name || ct.table_number,
            ct.capacity || 4,
            localStatus,
            ct.created_at || now(),
            existing.id,
            ct.table_number,
            String(ct.id)
          );
          updatedCount++;
        } else {
          const newId = `tbl-cloud-${ct.id}`;
          insertStmt.run(
            newId,
            String(ct.id),
            ct.shop_id || Number(shopId),
            ct.token_code || null,
            ct.table_name || ct.table_number,
            ct.table_number,
            ct.capacity || 4,
            localStatus,
            ct.created_at || now(),
            now()
          );
          addedCount++;
        }
      }
    }

    if (addedCount > 0 || deletedCount > 0 || updatedCount > 0) {
      console.log(`[CloudSync] Synced restaurant_tables: ${cloudTables?.length || 0} total (+${addedCount} added, -${deletedCount} deleted, ${updatedCount} updated).`);
      broadcastCloudEvent('tables-updated', { count: cloudTables?.length || 0, added: addedCount, deleted: deletedCount });
    }

    return {
      success: true,
      message: `Synced ${cloudTables?.length || 0} tables from Pizza System (+${addedCount}, -${deletedCount})`,
      count: cloudTables?.length || 0,
    };
  } catch (err: any) {
    console.error('[CloudSync] syncTablesFromCloud failed:', err.message);
    return { success: false, message: err.message };
  }
}

/**
 * Push new or updated table to Pizza System cloud (Supabase)
 */
export async function pushTableToCloud(table: {
  id?: string;
  cloud_id?: string;
  number: string;
  name?: string;
  capacity?: number;
  status?: string;
}): Promise<{ success: boolean; cloud_id?: string; token_code?: string; error?: string }> {
  const syncEnabled = getSetting('cloud_sync_enabled', '1') === '1';
  if (!syncEnabled) return { success: true };

  const client = getSupabaseClient();
  if (!client) return { success: false, error: 'Supabase client unavailable' };

  try {
    const db = getDatabase();
    const shopId = Number(getSetting('cloud_shop_id', '')) || 4;
    const cloudStatus = table.status === 'reserved' ? 'reserved' : (table.status === 'inactive' || table.status === 'cleaning' ? 'inactive' : 'active');
    
    const payload: any = {
      table_number: table.number,
      table_name: table.name || `Table ${table.number}`,
      capacity: Number(table.capacity) || 4,
      status: cloudStatus,
      shop_id: shopId,
    };

    if (table.cloud_id) {
      const { data, error } = await client
        .from('restaurant_tables')
        .update(payload)
        .eq('id', table.cloud_id)
        .select()
        .single();

      if (error) {
        console.warn('[CloudSync] pushTableToCloud update error:', error.message);
        return { success: false, error: error.message };
      }
      return { success: true, cloud_id: String(data?.id), token_code: data?.token_code };
    } else {
      const { data, error } = await client
        .from('restaurant_tables')
        .insert(payload)
        .select()
        .single();

      if (error) {
        console.warn('[CloudSync] pushTableToCloud insert error:', error.message);
        return { success: false, error: error.message };
      }

      if (data && table.id) {
        db.prepare(`
          UPDATE tables SET
            cloud_id = ?,
            shop_id = ?,
            token_code = ?,
            name = COALESCE(name, ?)
          WHERE id = ?
        `).run(String(data.id), shopId, data.token_code, data.table_name, table.id);
      }

      return { success: true, cloud_id: String(data?.id), token_code: data?.token_code };
    }
  } catch (err: any) {
    console.error('[CloudSync] pushTableToCloud exception:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Delete table from Pizza System cloud (Supabase)
 */
export async function deleteTableFromCloud(cloudId: string): Promise<boolean> {
  const syncEnabled = getSetting('cloud_sync_enabled', '1') === '1';
  if (!syncEnabled || !cloudId) return false;

  const client = getSupabaseClient();
  if (!client) return false;

  try {
    const { error } = await client
      .from('restaurant_tables')
      .delete()
      .eq('id', cloudId);

    if (error) {
      console.warn('[CloudSync] deleteTableFromCloud error:', error.message);
      return false;
    }
    return true;
  } catch (err: any) {
    console.error('[CloudSync] deleteTableFromCloud exception:', err.message);
    return false;
  }
}

/**
 * Unified sync: Pull both menu & staff from Pizza System
 */
export async function syncAllFromCloud(): Promise<{
  success: boolean;
  message: string;
  categoriesCount?: number;
  productsCount?: number;
  staffCount?: number;
  tablesCount?: number;
}> {
  const menuResult = await syncMenuFromCloud();
  const staffResult = await syncStaffFromCloud();
  const tablesResult = await syncTablesFromCloud();

  return {
    success: menuResult.success,
    message: `${menuResult.message} ${staffResult.message} ${tablesResult.message}`,
    categoriesCount: menuResult.categoriesCount,
    productsCount: menuResult.productsCount,
    staffCount: staffResult.staffCount,
    tablesCount: tablesResult.count,
  };
}

/**
 * Handle new online order received from Supabase Realtime
 */
export async function handleIncomingCloudOrder(cloudOrder: any): Promise<boolean> {
  const db = getDatabase();

  if (!cloudOrder || !cloudOrder.id) return false;

  const cloudOrderIdStr = String(cloudOrder.id);
  const orderNumber = cloudOrder.order_number || `ONL-${cloudOrder.id}`;

  try {
    // Branch check: ensure order belongs strictly to this shop
    const currentShopId = getSetting('cloud_shop_id', '');
    if (currentShopId) {
      if (!cloudOrder.shop_id || String(cloudOrder.shop_id) !== String(currentShopId)) {
        console.log(`[CloudSync] Order ${orderNumber} is for Shop #${cloudOrder.shop_id || 'unassigned'}, not current branch #${currentShopId}. Skipping.`);
        return false;
      }
    }

    // Check for duplicate
    const existing = db.prepare('SELECT id, status FROM orders WHERE cloud_order_id = ? OR order_number = ?').get(cloudOrderIdStr, orderNumber) as any;
    if (existing) {
      // If status changed in cloud, update local
      const localStatus = mapCloudStatusToLocal(cloudOrder.status);
      if (existing.status !== localStatus) {
        db.prepare("UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?").run(localStatus, existing.id);
        notifyKdsUpdate();
        broadcastCloudEvent('order-status-updated', { orderNumber, status: localStatus });
      }
      return false;
    }

    console.log(`[CloudSync] New Online Order received from Pizza System: ${orderNumber}`);

    // Resolve or create customer record
    let customerId: string | null = null;
    if (cloudOrder.customer_name || cloudOrder.customer_phone) {
      const phone = cloudOrder.customer_phone ? String(cloudOrder.customer_phone).trim() : '';
      const name = cloudOrder.customer_name ? String(cloudOrder.customer_name).trim() : 'Online Customer';
      let custRow: any = null;
      if (phone) {
        custRow = db.prepare('SELECT id FROM customers WHERE phone = ?').get(phone);
      }
      if (!custRow && name) {
        custRow = db.prepare('SELECT id FROM customers WHERE name = ?').get(name);
      }
      if (custRow?.id) {
        customerId = custRow.id;
      } else {
        customerId = `cust-cloud-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
        db.prepare(`
          INSERT INTO customers (id, name, phone, address, created_at, updated_at)
          VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
        `).run(customerId, name, phone || null, cloudOrder.delivery_address || null);
      }
    }

    // Parse items
    let rawItems: any[] = [];
    if (Array.isArray(cloudOrder.items)) {
      rawItems = cloudOrder.items;
    } else if (typeof cloudOrder.items === 'string') {
      try { rawItems = JSON.parse(cloudOrder.items); } catch { rawItems = []; }
    }

    const total = Number(cloudOrder.total) || 0;
    const deliveryFee = Number(cloudOrder.delivery_fee) || 0;
    const subtotal = Math.max(0, total - deliveryFee);
    const orderType = cloudOrder.order_type || (cloudOrder.delivery_address ? 'delivery' : 'takeaway');
    const status = mapCloudStatusToLocal(cloudOrder.status || 'pending');

    let localOrderId = 0;

    // Insert into local orders and order_items in a transaction
    const insertTx = db.transaction(() => {
      const orderStmt = db.prepare(`
        INSERT INTO orders (
          order_number, cloud_order_id, order_source, type, status,
          subtotal, total, delivery_charge, delivery_fee, delivery_address,
          special_instructions, customer_id, customer_name, shop_id, is_synced, created_at
        ) VALUES (
          ?, ?, 'online', ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?, 1, ?
        )
      `);

      const createdAt = cloudOrder.created_at ? new Date(cloudOrder.created_at).toISOString() : new Date().toISOString();
      const onlineCustName = cloudOrder.customer_name ? String(cloudOrder.customer_name).trim() : null;
      const notes = [
        cloudOrder.notes,
        cloudOrder.customer_name ? `Customer: ${cloudOrder.customer_name}` : null,
        cloudOrder.customer_phone ? `Phone: ${cloudOrder.customer_phone}` : null,
        cloudOrder.delivery_rider_name ? `Rider: ${cloudOrder.delivery_rider_name}` : null
      ].filter(Boolean).join(' | ');

      const res = orderStmt.run(
        orderNumber,
        cloudOrderIdStr,
        orderType,
        status,
        subtotal,
        total,
        deliveryFee,
        deliveryFee,
        cloudOrder.delivery_address || null,
        notes || null,
        customerId,
        onlineCustName,
        cloudOrder.shop_id ? Number(cloudOrder.shop_id) : (currentShopId ? Number(currentShopId) : null),
        createdAt
      );

      localOrderId = Number(res.lastInsertRowid);

      const itemStmt = db.prepare(`
        INSERT INTO order_items (
          order_id, product_id, product_name, unit_price, quantity,
          subtotal, total, variant_selection
        ) VALUES (
          ?, ?, ?, ?, ?,
          ?, ?, ?
        )
      `);

      for (const item of rawItems) {
        const prodId = item.id ? `cloud_prod_${item.id}` : `item-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
        const prodName = item.name || item.title || item.product_name || 'Pizza Item';
        const unitPrice = Number(item.price || item.unit_price) || 0;
        const qty = Number(item.qty || item.quantity) || 1;
        const itemSubtotal = Number(item.subtotal) || (unitPrice * qty);

        let variantInfo = '';
        if (item.selected_variation) {
          variantInfo = typeof item.selected_variation === 'object' ? item.selected_variation.name : String(item.selected_variation);
        } else if (item.variant_selection) {
          variantInfo = String(item.variant_selection);
        }

        itemStmt.run(
          localOrderId,
          prodId,
          prodName,
          unitPrice,
          qty,
          itemSubtotal,
          itemSubtotal,
          variantInfo || null
        );
      }
    });

    insertTx();

    console.log(`[CloudSync] Online Order inserted into local DB with ID: ${localOrderId}`);

    // 1. Notify KDS screens in real time
    notifyKdsUpdate();

    // 2. Broadcast to UI / POS screens in real time
    broadcastCloudEvent('online-order-received', { orderNumber, total, localOrderId, customerName: cloudOrder.customer_name });
    broadcastCloudEvent('order-synced', { orderNumber, localOrderId });

    // 3. Auto-print Customer Bill (Receipt) if enabled
    const autoPrintBill = getSetting('cloud_auto_print_bill', '1') === '1';
    if (autoPrintBill) {
      try {
        const localOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get(localOrderId) as any;
        const localItems = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(localOrderId) as any[];

        if (localOrder) {
          localOrder.customer_name = cloudOrder.customer_name || localOrder.customer_name;
          localOrder.customer_phone = cloudOrder.customer_phone || localOrder.customer_phone;
          localOrder.items = localItems;

          const bill = {
            order_id: localOrderId,
            subtotal: localOrder.subtotal,
            total: localOrder.total,
            bill_number: `B-${orderNumber}`,
            payment_status: 'paid',
            payment_details: [{ method: 'Online', amount: localOrder.total }],
            created_at: localOrder.created_at,
          };

          const business = {
            name: getSetting('business_name') || getSetting('cloud_shop_name') || getSetting('shop_name') || 'Sole What POS',
            address: getSetting('business_address') || getSetting('address') || '',
            phone: getSetting('business_phone') || getSetting('phone') || '',
            gstin: getSetting('gstin'),
            easypaisa_number: getSetting('easypaisa_number'),
            easypaisa_title: getSetting('easypaisa_title'),
            complaint_number: getSetting('complaint_number') || getSetting('business_phone') || getSetting('phone') || '',
            footer_message: getSetting('bill_footer_message'),
          };

          console.log(`[CloudSync] Triggering Auto-Print Customer Bill for online order ${orderNumber}...`);
          await printReceipt(localOrder, bill, business, 'classic', 'customer');
        }
      } catch (printBillErr) {
        console.error('[CloudSync] Failed to auto-print Customer Bill for online order:', printBillErr);
      }
    }

    // 4. Auto-print KOT if enabled
    const autoPrint = getSetting('cloud_auto_print_kot', '1') === '1';
    if (autoPrint) {
      try {
        const localOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get(localOrderId) as any;
        const localItems = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(localOrderId) as any[];

        if (localOrder) {
          localOrder.customer_name = cloudOrder.customer_name || localOrder.customer_name;
          localOrder.customer_phone = cloudOrder.customer_phone || localOrder.customer_phone;
        }

        console.log(`[CloudSync] Triggering Auto-Print KOT for online order ${orderNumber}...`);
        await printKOT(localOrder, localItems, 'Kitchen (Online)');
      } catch (printErr) {
        console.error('[CloudSync] Failed to auto-print KOT for online order:', printErr);
      }
    }

    return true;
  } catch (err) {
    console.error('[CloudSync] Failed to process online order:', err);
    return false;
  }
}

/**
 * Pull all recent online orders from Pizza System cloud (Supabase)
 */
export async function pullOnlineOrdersFromCloud(): Promise<{
  success: boolean;
  message: string;
  importedCount: number;
  totalCloudOrders: number;
}> {
  const syncEnabled = getSetting('cloud_sync_enabled', '1') === '1';
  if (!syncEnabled) {
    return { success: false, message: 'Cloud sync is disabled in settings', importedCount: 0, totalCloudOrders: 0 };
  }

  const client = getSupabaseClient();
  if (!client) {
    return { success: false, message: 'Supabase client not initialized', importedCount: 0, totalCloudOrders: 0 };
  }

  const currentShopId = getSetting('cloud_shop_id', '');
  if (!currentShopId) {
    return { success: true, message: 'No branch selected', importedCount: 0, totalCloudOrders: 0 };
  }
  try {
    let query = client
      .from('orders')
      .select('*')
      .order('id', { ascending: false })
      .limit(50);

    if (currentShopId) {
      query = query.eq('shop_id', Number(currentShopId));
    }

    const { data: cloudOrders, error } = await query;
    if (error) {
      console.warn('[CloudSync] Failed to pull orders from cloud:', error.message);
      return { success: false, message: error.message, importedCount: 0, totalCloudOrders: 0 };
    }

    if (!cloudOrders || cloudOrders.length === 0) {
      return { success: true, message: 'No orders found in cloud', importedCount: 0, totalCloudOrders: 0 };
    }

    let importedCount = 0;
    const db = getDatabase();

    for (const cloudOrder of cloudOrders) {
      const orderNumber = cloudOrder.order_number || `ONL-${cloudOrder.id}`;
      const cloudOrderIdStr = String(cloudOrder.id);

      const existing = db.prepare('SELECT id, status FROM orders WHERE cloud_order_id = ? OR order_number = ?')
        .get(cloudOrderIdStr, orderNumber) as any;

      if (!existing) {
        const ok = await handleIncomingCloudOrder(cloudOrder);
        if (ok) importedCount++;
      } else {
        // Sync status if changed in cloud
        const localStatus = mapCloudStatusToLocal(cloudOrder.status);
        if (existing.status !== localStatus) {
          db.prepare("UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?")
            .run(localStatus, existing.id);
        }
      }
    }

    // Reconcile and purge any local orders that were deleted from Pizza Admin (Supabase)
    const validCloudIds = new Set(cloudOrders.map((co: any) => String(co.id)));
    const validCloudNumbers = new Set(cloudOrders.map((co: any) => String(co.order_number || '')));
    const minCloudId = Math.min(...cloudOrders.map((co: any) => Number(co.id)));

    const localOnlineRows = db.prepare(`
      SELECT id, cloud_order_id, order_number 
      FROM orders 
      WHERE (cloud_order_id IS NOT NULL OR order_source = 'online' OR type = 'online')
        AND (shop_id = ? OR shop_id IS NULL OR shop_id = 0)
        AND created_at >= datetime('now', '-7 days')
    `).all(Number(currentShopId)) as Array<{ id: number; cloud_order_id: string | null; order_number: string }>;

    let deletedCount = 0;
    for (const loc of localOnlineRows) {
      const locCloudId = loc.cloud_order_id ? Number(loc.cloud_order_id) : null;
      if (locCloudId && locCloudId >= minCloudId) {
        const stillInCloud = validCloudIds.has(String(loc.cloud_order_id)) || (loc.order_number && validCloudNumbers.has(String(loc.order_number)));
        if (!stillInCloud) {
          db.prepare('DELETE FROM order_items WHERE order_id = ?').run(loc.id);
          db.prepare('DELETE FROM bills WHERE order_id = ?').run(loc.id);
          db.prepare('DELETE FROM orders WHERE id = ?').run(loc.id);
          deletedCount++;
          console.log(`[CloudSync] Removed local order ${loc.order_number} (ID: ${loc.id}) because it was deleted in Pizza Admin.`);
        }
      }
    }

    if (deletedCount > 0) {
      notifyKdsUpdate();
      broadcastCloudEvent('order-deleted', { count: deletedCount });
      broadcastCloudEvent('order-synced', { count: deletedCount });
    }

    if (importedCount > 0) {
      console.log(`[CloudSync] Pulled and imported ${importedCount} new online orders from Pizza System.`);
      broadcastCloudEvent('online-order-received', { count: importedCount });
      broadcastCloudEvent('order-synced', { count: importedCount });
    }

    return {
      success: true,
      message: `Checked ${cloudOrders.length} cloud orders, imported ${importedCount} new.`,
      importedCount,
      totalCloudOrders: cloudOrders.length,
    };
  } catch (err: any) {
    console.error('[CloudSync] pullOnlineOrdersFromCloud error:', err.message);
    return { success: false, message: err.message, importedCount: 0, totalCloudOrders: 0 };
  }
}

/**
 * Broadcast sync events to Electron main window and WebSocket connected clients
 */
export function broadcastCloudEvent(eventType: string, payload: any = {}): void {
  // 1. Send to Electron window via IPC
  try {
    const { getMainWindow } = require('../index');
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('cloud-sync-event', { event: eventType, ...payload });
    }
  } catch {}

  // 2. Send to KDS and web clients via WebSocket
  try {
    const { broadcastWsEvent } = require('./kds');
    broadcastWsEvent({ type: `cloud:${eventType}`, payload });
  } catch {}
}

/**
 * Map local POS order status to Pizza System Cloud status
 */
export function mapLocalStatusToCloud(status: string): string {
  switch (status?.toLowerCase()) {
    case 'pending': return 'pending';
    case 'preparing': return 'preparing';
    case 'ready': return 'ready';
    case 'served': return 'ready';
    case 'completed': return 'delivered';
    case 'cancelled': return 'cancelled';
    default: return status || 'pending';
  }
}

/**
 * Map Pizza System Cloud status to local POS order status
 */
export function mapCloudStatusToLocal(status: string): string {
  switch (status?.toLowerCase()) {
    case 'pending':
    case 'confirmed': return 'pending';
    case 'preparing': return 'preparing';
    case 'ready': return 'ready';
    case 'delivered': return 'completed';
    case 'cancelled': return 'cancelled';
    default: return status || 'pending';
  }
}

/**
 * Push an order created on FloDesktop POS up to Pizza System cloud (Supabase)
 */
export async function pushOrderToCloud(order: any, rawItems: any[]): Promise<boolean> {
  const syncEnabled = getSetting('cloud_sync_enabled', '1') === '1';
  if (!syncEnabled) return false;

  const client = getSupabaseClient();
  if (!client) return false;

  const shopId = order.shop_id || getSetting('cloud_shop_id', '');

  try {
    const db = getDatabase();
    const formattedItems = (rawItems || []).map((i) => ({
      name: i.product_name || i.name || 'Pizza Item',
      price: Number(i.unit_price || i.price) || 0,
      quantity: Number(i.quantity || i.qty) || 1,
      qty: Number(i.quantity || i.qty) || 1,
      subtotal: Number(i.subtotal) || 0,
      selected_variation: i.variant_selection || null,
      selectedVariation: i.variant_selection || null,
    }));

    // Find table name/number if dine_in
    let tableNumber: string | null = null;
    if (order.table_id) {
      const tbl = db.prepare('SELECT number FROM tables WHERE id = ?').get(order.table_id) as any;
      tableNumber = tbl?.number ? String(tbl.number) : String(order.table_id);
    }

    // Customer details if any
    let customerName: string | null = order.customer_name || null;
    let customerPhone: string | null = order.customer_phone || null;
    if (order.customer_id) {
      const cust = db.prepare('SELECT name, phone FROM customers WHERE id = ?').get(order.customer_id) as any;
      if (cust) {
        customerName = customerName || cust.name;
        customerPhone = customerPhone || cust.phone;
      }
    }

    const payload: Record<string, any> = {
      order_number: order.order_number,
      order_type: order.type || 'takeaway',
      status: mapLocalStatusToCloud(order.status || 'pending'),
      total: Number(order.total) || 0,
      delivery_fee: Number(order.delivery_charge || order.delivery_fee || 0),
      delivery_address: order.delivery_address || null,
      items: formattedItems,
      customer_name: customerName,
      customer_phone: customerPhone,
      table_number: tableNumber,
      token_number: order.order_number ? String(order.order_number).slice(-4) : null,
      notes: order.special_instructions ? `POS: ${order.special_instructions}` : `POS Terminal Order (${order.order_number})`,
      shop_id: shopId ? Number(shopId) : null,
      created_at: order.created_at ? new Date(order.created_at).toISOString() : new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await client
      .from('orders')
      .insert(payload)
      .select('id')
      .maybeSingle();

    if (error) {
      console.warn('[CloudSync] Error pushing POS order to cloud:', error.message);
      return false;
    }

    const cloudId = data?.id ? String(data.id) : null;
    console.log(`[CloudSync] POS Order ${order.order_number} successfully pushed to Pizza System cloud (Cloud ID: ${cloudId}, Shop #${shopId})`);

    // Mark as synced locally
    db.prepare(`
      UPDATE orders 
      SET is_synced = 1, 
          cloud_order_id = COALESCE(?, cloud_order_id), 
          updated_at = datetime('now') 
      WHERE id = ?
    `).run(cloudId, order.id);

    broadcastCloudEvent('order-synced', { orderNumber: order.order_number, cloudId });
    return true;
  } catch (err: any) {
    console.error('[CloudSync] pushOrderToCloud error:', err.message);
    return false;
  }
}

/**
 * Update order status on Pizza System cloud (Supabase) in real time
 */
export async function updateCloudOrderStatus(
  orderIdOrNumber: string | number,
  status: string,
  extra: { notes?: string; payment_status?: string } = {}
): Promise<boolean> {
  const syncEnabled = getSetting('cloud_sync_enabled', '1') === '1';
  if (!syncEnabled) return false;

  const client = getSupabaseClient();
  if (!client) return false;

  try {
    const db = getDatabase();
    const order = db.prepare('SELECT id, order_number, cloud_order_id, status FROM orders WHERE id = ? OR order_number = ? OR cloud_order_id = ?')
      .get(orderIdOrNumber, String(orderIdOrNumber), String(orderIdOrNumber)) as any;

    const cloudStatus = mapLocalStatusToCloud(status);
    const updatePayload: Record<string, any> = {
      status: cloudStatus,
      updated_at: new Date().toISOString(),
    };
    if (extra.notes) {
      updatePayload.notes = extra.notes;
    }

    let query = client.from('orders').update(updatePayload);
    if (order?.cloud_order_id) {
      query = query.eq('id', order.cloud_order_id);
    } else if (order?.order_number) {
      query = query.eq('order_number', order.order_number);
    } else {
      query = query.or(`id.eq.${orderIdOrNumber},order_number.eq.${orderIdOrNumber}`);
    }

    const { error } = await query;
    if (error) {
      console.warn(`[CloudSync] Failed to update cloud order status for ${order.order_number}:`, error.message);
      return false;
    }

    console.log(`[CloudSync] Cloud order status updated to '${cloudStatus}' for ${order.order_number}`);
    broadcastCloudEvent('order-status-updated', { orderNumber: order.order_number, status: cloudStatus });
    return true;
  } catch (err: any) {
    console.error('[CloudSync] updateCloudOrderStatus error:', err.message);
    return false;
  }
}

/**
 * Upload any pending offline orders to Pizza System cloud (Supabase)
 */
export async function syncPendingOfflineOrders(): Promise<number> {
  const syncEnabled = getSetting('cloud_sync_enabled', '1') === '1';
  if (!syncEnabled) return 0;

  const client = getSupabaseClient();
  if (!client) return 0;

  try {
    const db = getDatabase();
    const unsynced = db.prepare(`
      SELECT * FROM orders 
      WHERE (is_synced = 0 OR is_synced IS NULL) 
        AND (order_source IS NULL OR order_source != 'online')
      ORDER BY id ASC 
      LIMIT 25
    `).all() as any[];

    if (unsynced.length === 0) return 0;

    console.log(`[CloudSync] Syncing ${unsynced.length} pending offline orders to Pizza System cloud...`);
    let successCount = 0;

    for (const order of unsynced) {
      const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id) as any[];
      const ok = await pushOrderToCloud(order, items);
      if (ok) successCount++;
    }

    if (successCount > 0) {
      console.log(`[CloudSync] Successfully pushed ${successCount} offline orders to cloud.`);
    }
    return successCount;
  } catch (err: any) {
    console.warn('[CloudSync] syncPendingOfflineOrders error:', err.message);
    return 0;
  }
}

/**
 * Start listening for Realtime Orders, Staff & Menu from Supabase
 */
export function startRealtimeOrderListener(): void {
  const syncEnabled = getSetting('cloud_sync_enabled', '1') === '1';
  if (!syncEnabled) {
    console.log('[CloudSync] Cloud sync is disabled in settings. Skipping realtime listener.');
    return;
  }

  if (isRealtimeListening && realtimeChannel) {
    console.log('[CloudSync] Realtime order listener already active.');
    return;
  }

  const client = getSupabaseClient();
  if (!client) {
    console.warn('[CloudSync] Cannot start realtime listener: Supabase client not available.');
    return;
  }

  try {
    console.log('[CloudSync] Subscribing to Supabase Realtime channel for orders, staff & menu...');

    realtimeChannel = client
      .channel('flodesktop_orders_realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' }, async (payload) => {
        console.log('[CloudSync] Realtime INSERT event received from Supabase orders:', payload.new?.order_number);
        await handleIncomingCloudOrder(payload.new);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders' }, async (payload) => {
        const updated = payload.new;
        if (updated && updated.id) {
          try {
            const db = getDatabase();
            const localStatus = mapCloudStatusToLocal(updated.status);
            db.prepare("UPDATE orders SET status = ?, updated_at = datetime('now') WHERE cloud_order_id = ? OR order_number = ?")
              .run(localStatus, String(updated.id), updated.order_number);
            notifyKdsUpdate();
            broadcastCloudEvent('order-status-updated', { orderNumber: updated.order_number, status: localStatus });
          } catch (e) {
            console.error('[CloudSync] Error updating local order status from cloud:', e);
          }
        }
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'orders' }, async (payload) => {
        const deleted = payload.old;
        console.log('[CloudSync] Realtime DELETE event received from Supabase orders:', deleted);
        if (deleted) {
          try {
            const db = getDatabase();
            if (deleted.id) {
              const localOrder = db.prepare('SELECT id FROM orders WHERE cloud_order_id = ? OR id = ?').get(String(deleted.id), deleted.id) as any;
              if (localOrder) {
                db.prepare('DELETE FROM order_items WHERE order_id = ?').run(localOrder.id);
                db.prepare('DELETE FROM bills WHERE order_id = ?').run(localOrder.id);
                db.prepare('DELETE FROM orders WHERE id = ?').run(localOrder.id);
              }
            }
            if (deleted.order_number) {
              const localOrder = db.prepare('SELECT id FROM orders WHERE order_number = ?').get(deleted.order_number) as any;
              if (localOrder) {
                db.prepare('DELETE FROM order_items WHERE order_id = ?').run(localOrder.id);
                db.prepare('DELETE FROM bills WHERE order_id = ?').run(localOrder.id);
                db.prepare('DELETE FROM orders WHERE id = ?').run(localOrder.id);
              }
            }
            notifyKdsUpdate();
            broadcastCloudEvent('order-deleted', { cloudId: deleted.id, orderNumber: deleted.order_number });
            broadcastCloudEvent('order-synced');
          } catch (e) {
            console.error('[CloudSync] Error deleting local order from cloud:', e);
          }
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'restaurant_tables' }, async (payload) => {
        console.log('[CloudSync] Realtime update on restaurant_tables! Event:', payload?.eventType, payload);
        try {
          if (payload?.eventType === 'DELETE' && payload.old) {
            const db = getDatabase();
            if (payload.old.id) {
              db.prepare('DELETE FROM tables WHERE cloud_id = ?').run(String(payload.old.id));
            }
            if (payload.old.table_number) {
              db.prepare('DELETE FROM tables WHERE lower(number) = lower(?)').run(String(payload.old.table_number));
            }
          }
          await syncTablesFromCloud();
          broadcastCloudEvent('tables-updated');
        } catch (e) {
          console.error('[CloudSync] Realtime restaurant_tables sync error:', e);
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pos_staff' }, async (payload) => {
        console.log('[CloudSync] Realtime update on pos_staff table! Auto-syncing staff to local SQLite...');
        try {
          await syncStaffFromCloud();
          broadcastCloudEvent('staff-updated');
        } catch (e) {
          console.error('[CloudSync] Realtime staff sync error:', e);
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, async (payload) => {
        console.log('[CloudSync] Realtime update on products table! Auto-syncing menu to local SQLite...');
        try {
          await syncMenuFromCloud();
          broadcastCloudEvent('menu-updated');
        } catch (e) {
          console.error('[CloudSync] Realtime products sync error:', e);
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'categories' }, async (payload) => {
        console.log('[CloudSync] Realtime update on categories table! Auto-syncing categories to local SQLite...');
        try {
          await syncMenuFromCloud();
          broadcastCloudEvent('menu-updated');
        } catch (e) {
          console.error('[CloudSync] Realtime categories sync error:', e);
        }
      })
      .subscribe((status) => {
        console.log('[CloudSync] Realtime channel status:', status);
        if (status === 'SUBSCRIBED') {
          isRealtimeListening = true;
          broadcastCloudEvent('connection-status', { connected: true, realtime: true });
          // Flush any pending offline orders on connection!
          syncPendingOfflineOrders().catch(() => {});
        } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
          isRealtimeListening = false;
          broadcastCloudEvent('connection-status', { connected: true, realtime: false });
        }
      });
  } catch (err) {
    console.error('[CloudSync] Failed to start Realtime order listener:', err);
    isRealtimeListening = false;
  }
}

/**
 * Stop Realtime listener
 */
export function stopRealtimeOrderListener(): void {
  if (realtimeChannel && supabaseClient) {
    try {
      supabaseClient.removeChannel(realtimeChannel);
      console.log('[CloudSync] Realtime order listener stopped.');
    } catch (err) {
      console.error('[CloudSync] Error removing channel:', err);
    }
  }
  realtimeChannel = null;
  isRealtimeListening = false;
}

/**
 * Get current sync status & settings
 */
export function getCloudSyncStatus(): {
  configured: boolean;
  connected: boolean;
  isRealtimeActive: boolean;
  syncEnabled: boolean;
  autoPrintKot: boolean;
  autoPrintBill: boolean;
  supabaseUrl: string;
  lastSync: string;
  operatingMode: 'integrated' | 'standalone';
  isPizzaIntegrated: boolean;
  currentShopId: string;
  currentShopName: string;
  currentShopSlug: string;
} {
  const url = getSetting('supabase_url', 'https://uadrrjrlhfttithjmdye.supabase.co');
  const syncEnabled = getSetting('cloud_sync_enabled', '1') === '1';
  const autoPrintKot = getSetting('cloud_auto_print_kot', '1') === '1';
  const autoPrintBill = getSetting('cloud_auto_print_bill', '1') === '1';
  const lastSync = getSetting('cloud_last_sync', '');
  const operatingMode = (getSetting('pizza_system_mode', 'integrated') as 'integrated' | 'standalone');
  const isPizzaIntegrated = operatingMode === 'integrated' && syncEnabled;
  const currentShopId = getSetting('cloud_shop_id', '');
  const currentShopName = getSetting('cloud_shop_name', '');
  const currentShopSlug = getSetting('cloud_shop_slug', 'papa-pizza');

  return {
    configured: Boolean(url),
    connected: Boolean(supabaseClient),
    isRealtimeActive: isRealtimeListening,
    syncEnabled,
    autoPrintKot,
    autoPrintBill,
    supabaseUrl: url,
    lastSync,
    operatingMode,
    isPizzaIntegrated,
    currentShopId,
    currentShopName,
    currentShopSlug,
  };
}

/**
 * Fetch available pizza branches from Supabase
 */
export async function fetchCloudShops(): Promise<{
  success: boolean;
  shops: Array<{ id: number; name: string; slug: string; owner_name: string; status: string; plan: string; currency_symbol: string }>;
  currentShopId: string;
  currentShopName: string;
}> {
  const client = getSupabaseClient();
  const currentShopId = getSetting('cloud_shop_id', '');
  const currentShopName = getSetting('cloud_shop_name', '');

  if (!client) {
    return { success: false, shops: [], currentShopId, currentShopName };
  }

  try {
    const { data, error } = await client
      .from('shops')
      .select('id, name, slug, owner_name, status, plan, currency_symbol')
      .order('id', { ascending: true });

    if (error) throw error;

    let updatedShopName = currentShopName;
    if (data && data.length > 0) {
      const activeMatch = currentShopId ? data.find((s: any) => String(s.id) === String(currentShopId)) : data[0];
      if (activeMatch) {
        updatedShopName = activeMatch.name;
        setSetting('cloud_shop_name', activeMatch.name);
        setSetting('cloud_shop_slug', activeMatch.slug);
        setSetting('business_name', activeMatch.name);
        setSetting('shop_name', activeMatch.name);
      }
    }

    return {
      success: true,
      shops: (data || []) as any,
      currentShopId,
      currentShopName: updatedShopName,
    };
  } catch (err: any) {
    console.warn('[CloudSync] Failed to fetch shops:', err.message);
    return { success: false, shops: [], currentShopId, currentShopName };
  }
}

/**
 * Select active shop branch for this POS terminal
 */
export async function selectCloudShop(shopId: number | string): Promise<{ success: boolean; message: string; shopName?: string }> {
  try {
    const client = getSupabaseClient();
    let shopName = `Shop #${shopId}`;
    let shopSlug = `shop-${shopId}`;

    if (client) {
      const { data } = await client.from('shops').select('name, slug').eq('id', shopId).maybeSingle();
      if (data) {
        shopName = data.name;
        shopSlug = data.slug;
      }
    }

    setSetting('cloud_shop_id', String(shopId));
    setSetting('cloud_shop_name', shopName);
    setSetting('cloud_shop_slug', shopSlug);
    setSetting('business_name', shopName);

    console.log(`[CloudSync] Switched POS terminal to branch: ${shopName} (ID: ${shopId})`);

    // Multi-branch order isolation: clean up other shops' orders from local SQLite
    try {
      const db = getDatabase();
      db.prepare('DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE shop_id IS NOT NULL AND shop_id != ?)').run(Number(shopId));
      db.prepare('DELETE FROM orders WHERE shop_id IS NOT NULL AND shop_id != ?').run(Number(shopId));
    } catch (purgeErr) {
      console.warn('[CloudSync] Branch switch order purge notice:', purgeErr);
    }

    // Sync menu, staff, and online orders specifically for this branch
    await syncMenuFromCloud();
    await syncStaffFromCloud();
    await pullOnlineOrdersFromCloud();
    broadcastCloudEvent('order-synced');

    return { success: true, message: `Connected to branch: ${shopName}`, shopName };
  } catch (err: any) {
    return { success: false, message: `Failed to switch branch: ${err.message}` };
  }
}

/**
 * Update cloud sync settings
 */
export function updateCloudSyncSettings(settings: {
  supabase_url?: string;
  supabase_key?: string;
  cloud_sync_enabled?: boolean;
  cloud_auto_print_kot?: boolean;
  cloud_auto_print_bill?: boolean;
  pizza_system_mode?: 'integrated' | 'standalone';
}): void {
  if (settings.pizza_system_mode !== undefined) {
    setSetting('pizza_system_mode', settings.pizza_system_mode);
  }
  if (settings.supabase_url !== undefined) {
    setSetting('supabase_url', settings.supabase_url);
  }
  if (settings.supabase_key !== undefined) {
    setSetting('supabase_key', settings.supabase_key);
  }
  if (settings.cloud_sync_enabled !== undefined) {
    setSetting('cloud_sync_enabled', settings.cloud_sync_enabled ? '1' : '0');
  }
  if (settings.cloud_auto_print_kot !== undefined) {
    setSetting('cloud_auto_print_kot', settings.cloud_auto_print_kot ? '1' : '0');
  }
  if (settings.cloud_auto_print_bill !== undefined) {
    setSetting('cloud_auto_print_bill', settings.cloud_auto_print_bill ? '1' : '0');
  }

  // Reset client so new credentials take effect
  resetSupabaseClient();

  const isEnabled = settings.cloud_sync_enabled !== undefined 
    ? settings.cloud_sync_enabled 
    : getSetting('cloud_sync_enabled', '1') === '1';

  const mode = settings.pizza_system_mode !== undefined 
    ? settings.pizza_system_mode 
    : getSetting('pizza_system_mode', 'integrated');

  if (isEnabled && mode === 'integrated') {
    startRealtimeOrderListener();
  } else {
    stopRealtimeOrderListener();
  }
}

let syncIntervalHandle: NodeJS.Timeout | null = null;
let tableSyncIntervalHandle: NodeJS.Timeout | null = null;

/**
 * Clear all cloud sync interval timers and terminate listeners
 */
export function stopCloudSyncIntervals(): void {
  if (syncIntervalHandle) {
    clearInterval(syncIntervalHandle);
    syncIntervalHandle = null;
  }
  if (tableSyncIntervalHandle) {
    clearInterval(tableSyncIntervalHandle);
    tableSyncIntervalHandle = null;
  }
  stopRealtimeOrderListener();
  console.log('[CloudSync] All sync interval timers stopped');
}

/**
 * Initialize cloud sync on app launch
 */
export async function initCloudSync(): Promise<void> {
  console.log('[CloudSync] Initializing Cloud Sync Service...');
  const syncEnabled = getSetting('cloud_sync_enabled', '1') === '1';

  if (!syncEnabled) {
    console.log('[CloudSync] Cloud sync disabled in settings.');
    return;
  }

  // Start Realtime WebSocket listener for orders, staff, products, categories
  startRealtimeOrderListener();

  // Automatically pull latest staff, menu and online orders from Supabase cloud on startup
  console.log('[CloudSync] Syncing latest staff, menu and online orders from cloud in background...');
  pullOnlineOrdersFromCloud().catch((err) => {
    console.warn('[CloudSync] Initial background orders sync note:', err?.message || err);
  });
  syncStaffFromCloud().catch((err) => {
    console.warn('[CloudSync] Initial background staff sync note:', err?.message || err);
  });
  syncMenuFromCloud().catch((err) => {
    console.warn('[CloudSync] Initial background menu sync note:', err?.message || err);
  });
  syncTablesFromCloud().catch((err) => {
    console.warn('[CloudSync] Initial background tables sync note:', err?.message || err);
  });

  if (syncIntervalHandle) clearInterval(syncIntervalHandle);
  if (tableSyncIntervalHandle) clearInterval(tableSyncIntervalHandle);

  // Safety fallback: periodic background refresh & auto-reconnect every 15 seconds
  syncIntervalHandle = setInterval(() => {
    if (getSetting('cloud_sync_enabled', '1') === '1') {
      // 1. Ensure realtime listener is alive
      if (!isRealtimeListening) {
        startRealtimeOrderListener();
      }
      // 2. Upload any offline pending orders
      syncPendingOfflineOrders().catch(() => {});
      // 3. Pull latest online orders from customer storefront
      pullOnlineOrdersFromCloud().catch(() => {});
      // 4. Keep staff, menu and tables fresh
      syncStaffFromCloud().catch(() => {});
      syncMenuFromCloud().catch(() => {});
      syncTablesFromCloud().catch(() => {});
    }
  }, 15 * 1000);
  syncIntervalHandle.unref();

  // Fast Real-Time Table Sync Heartbeat (checks every 2.5s so tables created or deleted in Pizza Management reflect instantly)
  tableSyncIntervalHandle = setInterval(() => {
    if (getSetting('cloud_sync_enabled', '1') === '1') {
      syncTablesFromCloud().catch(() => {});
    }
  }, 2500);
  tableSyncIntervalHandle.unref();
}

