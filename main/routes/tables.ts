import { Router, Request, Response } from 'express';
import { getDatabase, now } from '../db';
import {
  syncTablesFromCloud,
  pushTableToCloud,
  deleteTableFromCloud,
  broadcastCloudEvent,
} from '../services/cloud-sync';

const router = Router();

// GET all tables with real-time active order and cloud info
router.get('/', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    let query = 'SELECT * FROM tables WHERE 1=1';
    const params: any[] = [];

    if (req.query.status) {
      query += ' AND status = ?';
      params.push(req.query.status);
    }
    if (req.query.floor) {
      query += ' AND floor = ?';
      params.push(req.query.floor);
    }
    if (req.query.section) {
      query += ' AND section = ?';
      params.push(req.query.section);
    }

    query += ' ORDER BY number';

    const rows = db.prepare(query).all(...params) as any[];

    // Fetch all currently active orders for this branch
    const activeShop = (req.query.shop_id as string) || (db.prepare("SELECT value FROM settings WHERE key = 'cloud_shop_id'").get() as any)?.value;
    const shopId = activeShop ? parseInt(activeShop, 10) : null;

    let activeOrdersQuery = `
      SELECT id, order_number, table_id, status, total, guest_count, created_at
      FROM orders
      WHERE status NOT IN ('completed', 'cancelled')
    `;
    const activeOrdersParams: any[] = [];
    if (shopId) {
      activeOrdersQuery += ' AND shop_id = ?';
      activeOrdersParams.push(shopId);
    }
    activeOrdersQuery += ' ORDER BY created_at DESC';

    const activeOrders = db.prepare(activeOrdersQuery).all(...activeOrdersParams) as any[];

    const tables = rows.map((t: any) => {
      // Match active order by table id OR table number
      const activeOrder = activeOrders.find(
        (o) => o.table_id === t.id || (t.number && o.table_id === t.number)
      );

      let effectiveStatus = t.status || 'available';
      if (activeOrder) {
        effectiveStatus = 'occupied';
      }

      let elapsedMinutes = null;
      if (activeOrder?.created_at) {
        const createdTime = new Date(activeOrder.created_at).getTime();
        elapsedMinutes = Math.max(0, Math.floor((Date.now() - createdTime) / 60000));
      }

      return {
        ...t,
        name: t.name || t.number,
        status: effectiveStatus,
        active_order: activeOrder ? {
          ...activeOrder,
          elapsed_minutes: elapsedMinutes,
        } : null,
      };
    });

    res.json({ tables });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Trigger real-time sync with Pizza Management Cloud
router.post('/sync', async (_req: Request, res: Response) => {
  try {
    const result = await syncTablesFromCloud();
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET single table by ID
router.get('/:id', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const table = db.prepare('SELECT * FROM tables WHERE id = ?').get(req.params.id) as any;
    if (!table) {
      return res.status(404).json({ error: 'Table not found' });
    }

    const activeShop = (req.query.shop_id as string) || (db.prepare("SELECT value FROM settings WHERE key = 'cloud_shop_id'").get() as any)?.value;
    const shopId = activeShop ? parseInt(activeShop, 10) : null;

    let activeOrderQuery = `
      SELECT * FROM orders 
      WHERE (table_id = ? OR table_id = ?) AND status NOT IN ('completed', 'cancelled')
    `;
    const orderParams: any[] = [table.id, table.number];
    if (shopId) {
      activeOrderQuery += ' AND shop_id = ?';
      orderParams.push(shopId);
    }
    activeOrderQuery += ' ORDER BY created_at DESC LIMIT 1';

    const activeOrder = db.prepare(activeOrderQuery).get(...orderParams);

    res.json({
      table: {
        ...table,
        name: table.name || table.number,
        status: activeOrder ? 'occupied' : table.status,
        active_order: activeOrder || null,
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST create table (Local + Pizza Management Cloud)
router.post('/', async (req: Request, res: Response) => {
  try {
    const { number, name, capacity, floor, section } = req.body;
    const tableNumber = (number || name || '').trim();

    if (!tableNumber) {
      return res.status(400).json({ error: 'Table number is required' });
    }

    const db = getDatabase();

    // Check duplicate
    const existing = db.prepare('SELECT id FROM tables WHERE lower(number) = lower(?)').get(tableNumber);
    if (existing) {
      return res.status(400).json({ error: `Table "${tableNumber}" already exists` });
    }

    const newId = `tbl-${Date.now()}`;
    const tableName = (name || `Table ${tableNumber}`).trim();
    const tableCapacity = Number(capacity) || 4;

    db.prepare(`
      INSERT INTO tables (id, number, name, capacity, status, floor, section, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'available', ?, ?, ?, ?)
    `).run(newId, tableNumber, tableName, tableCapacity, floor || 'Ground', section || null, now(), now());

    // Push to Pizza Management cloud Supabase in background
    pushTableToCloud({
      id: newId,
      number: tableNumber,
      name: tableName,
      capacity: tableCapacity,
      status: 'available',
    }).catch((e) => console.warn('[TablesRoute] Cloud push warning:', e?.message));

    broadcastCloudEvent('tables-updated');

    const created = db.prepare('SELECT * FROM tables WHERE id = ?').get(newId);
    res.status(201).json({ table: created });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// PUT update table (Local + Pizza Management Cloud)
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { number, name, capacity, floor, section, status } = req.body;
    const db = getDatabase();

    const table = db.prepare('SELECT * FROM tables WHERE id = ?').get(req.params.id) as any;
    if (!table) {
      return res.status(404).json({ error: 'Table not found' });
    }

    const tableNumber = number ? String(number).trim() : table.number;
    const tableName = name ? String(name).trim() : (table.name || table.number);
    const tableCapacity = capacity ? Number(capacity) : table.capacity;

    db.prepare(`
      UPDATE tables SET
        number = ?,
        name = ?,
        capacity = ?,
        floor = COALESCE(?, floor),
        section = COALESCE(?, section),
        status = COALESCE(?, status),
        updated_at = ?
      WHERE id = ?
    `).run(tableNumber, tableName, tableCapacity, floor || null, section || null, status || null, now(), req.params.id);

    // Sync updates to cloud
    pushTableToCloud({
      id: table.id,
      cloud_id: table.cloud_id,
      number: tableNumber,
      name: tableName,
      capacity: tableCapacity,
      status: status || table.status,
    }).catch((e) => console.warn('[TablesRoute] Cloud update warning:', e?.message));

    broadcastCloudEvent('tables-updated');

    const updated = db.prepare('SELECT * FROM tables WHERE id = ?').get(req.params.id);
    res.json({ table: updated });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE table (Local + Pizza Management Cloud)
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const table = db.prepare('SELECT * FROM tables WHERE id = ?').get(req.params.id) as any;
    if (!table) {
      return res.status(404).json({ error: 'Table not found' });
    }

    const activeOrder = db.prepare(`
      SELECT id FROM orders 
      WHERE (table_id = ? OR table_id = ?) AND status NOT IN ('completed', 'cancelled')
    `).get(table.id, table.number);

    if (activeOrder) {
      return res.status(400).json({ error: 'Cannot delete table with an active order. Please clear the table first.' });
    }

    // Delete in cloud if linked
    if (table.cloud_id) {
      deleteTableFromCloud(table.cloud_id).catch((e) => console.warn('[TablesRoute] Cloud delete note:', e?.message));
    }

    db.prepare('DELETE FROM tables WHERE id = ?').run(req.params.id);
    broadcastCloudEvent('tables-updated');

    res.json({ message: 'Table deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// PATCH update status (available, reserved, occupied, cleaning)
router.patch('/:id/status', async (req: Request, res: Response) => {
  try {
    const { status } = req.body;

    if (!status) {
      return res.status(400).json({ error: 'Status is required' });
    }

    const validStatuses = ['available', 'occupied', 'reserved', 'cleaning', 'inactive'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Use: ${validStatuses.join(', ')}` });
    }

    const db = getDatabase();
    const table = db.prepare('SELECT * FROM tables WHERE id = ?').get(req.params.id) as any;
    if (!table) {
      return res.status(404).json({ error: 'Table not found' });
    }

    db.prepare('UPDATE tables SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, now(), req.params.id);

    // Sync status change to Pizza Management cloud
    pushTableToCloud({
      id: table.id,
      cloud_id: table.cloud_id,
      number: table.number,
      name: table.name,
      capacity: table.capacity,
      status,
    }).catch((e) => console.warn('[TablesRoute] Cloud status push warning:', e?.message));

    broadcastCloudEvent('tables-updated');

    const updated = db.prepare('SELECT * FROM tables WHERE id = ?').get(req.params.id);
    res.json({ table: updated });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST clear table (mark order completed / clear occupancy)
router.post('/:id/clear', async (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const table = db.prepare('SELECT * FROM tables WHERE id = ?').get(req.params.id) as any;
    if (!table) {
      return res.status(404).json({ error: 'Table not found' });
    }

    // Mark any active orders on this table as completed
    db.prepare(`
      UPDATE orders SET status = 'completed', completed_at = ?, updated_at = ?
      WHERE (table_id = ? OR table_id = ?) AND status NOT IN ('completed', 'cancelled')
    `).run(now(), now(), table.id, table.number);

    // Mark table as available
    db.prepare('UPDATE tables SET status = ?, updated_at = ? WHERE id = ?')
      .run('available', now(), table.id);

    // Push available status to cloud
    pushTableToCloud({
      id: table.id,
      cloud_id: table.cloud_id,
      number: table.number,
      name: table.name,
      capacity: table.capacity,
      status: 'available',
    }).catch((e) => console.warn('[TablesRoute] Cloud status push warning:', e?.message));

    broadcastCloudEvent('tables-updated');
    broadcastCloudEvent('order-status-updated');

    res.json({ message: `Table ${table.name || table.number} cleared and available.` });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export const tableRoutes = router;
