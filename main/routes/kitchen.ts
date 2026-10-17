import { Router, Request, Response } from 'express';
import { getDatabase, parseItemJson } from '../db';

const router = Router();

// GET /api/kitchen/orders — returns active orders with items for KDS display
router.get('/orders', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const activeShop = (req.query.shop_id as string) || (db.prepare("SELECT value FROM settings WHERE key = 'cloud_shop_id'").get() as any)?.value;
    const shopId = activeShop ? parseInt(activeShop, 10) : null;

    let ordersQuery = `
      SELECT o.*
      FROM orders o
      WHERE o.status NOT IN ('completed', 'cancelled')
    `;
    const ordersParams: any[] = [];
    if (shopId) {
      ordersQuery += ' AND o.shop_id = ?';
      ordersParams.push(shopId);
    }
    ordersQuery += ' ORDER BY o.created_at ASC';

    const orders = db.prepare(ordersQuery).all(...ordersParams);

    const ordersWithItems = orders.map((order: any) => {
      const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id).map(parseItemJson);
      const tableRow = order.table_id
        ? db.prepare('SELECT * FROM tables WHERE id = ?').get(order.table_id) as any
        : null;
      // Normalize: frontend expects table.name, schema column is `number`
      const table = tableRow ? { ...tableRow, name: tableRow.number } : null;
      return { ...order, items, table };
    });

    let countsQuery = `
      SELECT status, COUNT(*) as count
      FROM order_items
      WHERE order_id IN (
        SELECT id FROM orders 
        WHERE status NOT IN ('completed', 'cancelled')
        ${shopId ? 'AND shop_id = ?' : ''}
      )
      GROUP BY status
    `;
    const counts = db.prepare(countsQuery).all(...(shopId ? [shopId] : [])) as { status: string; count: number }[];

    const countMap: Record<string, number> = {};
    counts.forEach((c) => { countMap[c.status] = c.count; });

    res.json({ orders: ordersWithItems, counts: countMap });
  } catch (error: any) {
    console.error('[Kitchen] Orders fetch error:', error);
    res.status(500).json({ error: error.message });
  }
});

export const kitchenRoutes = router;
