import { Router, Request, Response } from 'express';
import { getDatabase, now } from '../db';

const router = Router();

function getActiveShopId(db: any, reqQueryShopId?: any): number | null {
  const shop = reqQueryShopId || (db.prepare("SELECT value FROM settings WHERE key = 'cloud_shop_id'").get() as any)?.value;
  return shop ? parseInt(shop, 10) : null;
}

router.get('/daily-stats', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const today = new Date().toISOString().slice(0, 10);
    const shopId = getActiveShopId(db, req.query.shop_id);

    let salesQuery = `
      SELECT COALESCE(SUM(b.paid_amount), 0) as sales
      FROM bills b
      JOIN orders o ON b.order_id = o.id
      WHERE date(b.created_at) = date(?)
    `;
    const salesParams: any[] = [today];
    if (shopId) {
      salesQuery += ' AND o.shop_id = ?';
      salesParams.push(shopId);
    }
    const salesToday = db.prepare(salesQuery).get(...salesParams) as { sales: number };

    let runningQuery = `SELECT COUNT(*) as count FROM orders WHERE status IN ('pending', 'preparing')`;
    const runningParams: any[] = [];
    if (shopId) {
      runningQuery += ' AND shop_id = ?';
      runningParams.push(shopId);
    }
    const runningOrders = db.prepare(runningQuery).get(...runningParams) as { count: number };

    let pendingQuery = `SELECT COUNT(*) as count FROM orders WHERE status = 'pending'`;
    const pendingParams: any[] = [];
    if (shopId) {
      pendingQuery += ' AND shop_id = ?';
      pendingParams.push(shopId);
    }
    const pendingOrders = db.prepare(pendingQuery).get(...pendingParams) as { count: number };

    const tablesOccupied = db.prepare(`
      SELECT COUNT(*) as count FROM tables WHERE status = 'occupied'
    `).get() as { count: number };

    res.json({
      sales: salesToday.sales,
      runningOrders: runningOrders.count,
      pendingOrders: pendingOrders.count,
      tablesOccupied: tablesOccupied.count,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/summary', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const date = req.query.date as string || new Date().toISOString().slice(0, 10);
    const shopId = getActiveShopId(db, req.query.shop_id);

    let ordersTodayQuery = `
      SELECT COUNT(*) as count, COALESCE(SUM(total), 0) as total
      FROM orders WHERE date(created_at) = date(?)
    `;
    const ordersParams: any[] = [date];
    if (shopId) {
      ordersTodayQuery += ' AND shop_id = ?';
      ordersParams.push(shopId);
    }
    const ordersToday = db.prepare(ordersTodayQuery).get(...ordersParams) as { count: number; total: number };

    let billsTodayQuery = `
      SELECT COUNT(*) as count, COALESCE(SUM(b.total), 0) as total, COALESCE(SUM(b.paid_amount), 0) as collected
      FROM bills b
      JOIN orders o ON b.order_id = o.id
      WHERE date(b.created_at) = date(?)
    `;
    const billsParams: any[] = [date];
    if (shopId) {
      billsTodayQuery += ' AND o.shop_id = ?';
      billsParams.push(shopId);
    }
    const billsToday = db.prepare(billsTodayQuery).get(...billsParams) as { count: number; total: number; collected: number };

    const customersToday = db.prepare(`
      SELECT COUNT(*) as count FROM customers WHERE date(created_at) = date(?)
    `).get(date) as { count: number };

    let ordersByStatusQuery = `
      SELECT status, COUNT(*) as count FROM orders WHERE date(created_at) = date(?)
    `;
    const obsParams: any[] = [date];
    if (shopId) {
      ordersByStatusQuery += ' AND shop_id = ?';
      obsParams.push(shopId);
    }
    ordersByStatusQuery += ' GROUP BY status';
    const ordersByStatus = db.prepare(ordersByStatusQuery).all(...obsParams);

    let topPaymentMethodsQuery = `
      SELECT b.payment_details, COUNT(*) as count, SUM(b.paid_amount) as total
      FROM bills b
      JOIN orders o ON b.order_id = o.id
      WHERE b.payment_status = 'paid' AND date(b.paid_at) = date(?)
    `;
    const tpmParams: any[] = [date];
    if (shopId) {
      topPaymentMethodsQuery += ' AND o.shop_id = ?';
      tpmParams.push(shopId);
    }
    topPaymentMethodsQuery += ` GROUP BY json_extract(b.payment_details, '$.method')`;
    const topPaymentMethods = db.prepare(topPaymentMethodsQuery).all(...tpmParams);

    res.json({
      summary: {
        date,
        orders: { count: ordersToday.count, total: ordersToday.total },
        bills: { count: billsToday.count, total: billsToday.total, collected: billsToday.collected },
        customers: { new: customersToday.count },
        ordersByStatus,
        topPaymentMethods,
      }
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/sales', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const startDate = req.query.start_date as string || new Date().toISOString().slice(0, 10);
    const endDate = req.query.end_date as string || new Date().toISOString().slice(0, 10);
    const shopId = getActiveShopId(db, req.query.shop_id);

    let dailySalesQuery = `
      SELECT date(created_at) as date, COUNT(*) as orders, SUM(total) as sales
      FROM orders
      WHERE date(created_at) BETWEEN date(?) AND date(?)
    `;
    const dsParams: any[] = [startDate, endDate];
    if (shopId) {
      dailySalesQuery += ' AND shop_id = ?';
      dsParams.push(shopId);
    }
    dailySalesQuery += ' GROUP BY date(created_at) ORDER BY date';
    const dailySales = db.prepare(dailySalesQuery).all(...dsParams);

    let byPaymentMethodQuery = `
      SELECT json_extract(b.payment_details, '$.method') as method,
        COUNT(*) as count, SUM(b.paid_amount) as total
      FROM bills b
      JOIN orders o ON b.order_id = o.id
      WHERE b.payment_status = 'paid'
        AND date(b.paid_at) BETWEEN date(?) AND date(?)
    `;
    const bpmParams: any[] = [startDate, endDate];
    if (shopId) {
      byPaymentMethodQuery += ' AND o.shop_id = ?';
      bpmParams.push(shopId);
    }
    byPaymentMethodQuery += ` GROUP BY json_extract(b.payment_details, '$.method')`;
    const byPaymentMethod = db.prepare(byPaymentMethodQuery).all(...bpmParams);

    let byOrderTypeQuery = `
      SELECT type, COUNT(*) as count, SUM(total) as total
      FROM orders
      WHERE date(created_at) BETWEEN date(?) AND date(?)
    `;
    const botParams: any[] = [startDate, endDate];
    if (shopId) {
      byOrderTypeQuery += ' AND shop_id = ?';
      botParams.push(shopId);
    }
    byOrderTypeQuery += ' GROUP BY type';
    const byOrderType = db.prepare(byOrderTypeQuery).all(...botParams);

    res.json({
      sales: {
        startDate,
        endDate,
        dailySales,
        byPaymentMethod,
        byOrderType,
      }
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/topProducts', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const startDate = req.query.start_date as string || new Date().toISOString().slice(0, 10);
    const endDate = req.query.end_date as string || new Date().toISOString().slice(0, 10);
    const limit = parseInt(req.query.limit as string) || 10;
    const shopId = getActiveShopId(db, req.query.shop_id);

    let topProductsQuery = `
      SELECT oi.product_id, oi.product_name,
        SUM(oi.quantity) as total_quantity,
        SUM(oi.subtotal) as total_revenue,
        COUNT(DISTINCT oi.order_id) as order_count
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      WHERE date(o.created_at) BETWEEN date(?) AND date(?)
    `;
    const tpParams: any[] = [startDate, endDate];
    if (shopId) {
      topProductsQuery += ' AND o.shop_id = ?';
      tpParams.push(shopId);
    }
    topProductsQuery += `
      GROUP BY oi.product_id
      ORDER BY total_quantity DESC
      LIMIT ?
    `;
    tpParams.push(limit);

    const topProducts = db.prepare(topProductsQuery).all(...tpParams);

    res.json({ topProducts });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/recentOrders', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const limit = parseInt(req.query.limit as string) || 20;
    const shopId = getActiveShopId(db, req.query.shop_id);

    let recentOrdersQuery = `
      SELECT o.*, t.name as table_name, c.name as customer_name
      FROM orders o
      LEFT JOIN tables t ON o.table_id = t.id
      LEFT JOIN customers c ON o.customer_id = c.id
      WHERE 1=1
    `;
    const roParams: any[] = [];
    if (shopId) {
      recentOrdersQuery += ' AND o.shop_id = ?';
      roParams.push(shopId);
    }
    recentOrdersQuery += ' ORDER BY o.created_at DESC LIMIT ?';
    roParams.push(limit);

    const recentOrders = db.prepare(recentOrdersQuery).all(...roParams);

    const ordersWithItems = recentOrders.map((order: any) => {
      const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
      return { ...order, items };
    });

    res.json({ recentOrders: ordersWithItems });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/tables', (req: Request, res: Response) => {
  try {
    const db = getDatabase();

    const tableStats = db.prepare(`
      SELECT t.*,
        COUNT(DISTINCT o.id) as total_orders,
        COALESCE(SUM(o.total), 0) as total_revenue,
        MAX(o.created_at) as last_order_at
      FROM tables t
      LEFT JOIN orders o ON t.id = o.table_id
      WHERE date(o.created_at) = date('now') OR o.id IS NULL
      GROUP BY t.id
    `).all();

    const tableUtilization = db.prepare(`
      SELECT
        SUM(CASE WHEN status = 'occupied' THEN 1 ELSE 0 END) as occupied,
        SUM(CASE WHEN status = 'available' THEN 1 ELSE 0 END) as available,
        SUM(CASE WHEN status = 'reserved' THEN 1 ELSE 0 END) as reserved,
        SUM(CASE WHEN status = 'cleaning' THEN 1 ELSE 0 END) as cleaning,
        COUNT(*) as total
      FROM tables
    `).get();

    res.json({
      tableStats,
      tableUtilization
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export const reportRoutes = router;
