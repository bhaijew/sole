import { WebSocketServer, WebSocket } from 'ws';
import { getDatabase, now } from '../db';
import * as jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'flo-local-secret-change-in-production';

interface KdsClient {
  ws: WebSocket;
  userId: string | null;
  userName: string | null;
  role: string | null;
  categoryIds: string[];
  token: string | null;
}

const clients: Map<WebSocket, KdsClient> = new Map();

let kdsPingInterval: NodeJS.Timeout | null = null;

export function stopKdsIntervals(): void {
  if (kdsPingInterval) {
    clearInterval(kdsPingInterval);
    kdsPingInterval = null;
  }
  clients.forEach((_, ws) => {
    try {
      ws.terminate();
    } catch {}
  });
  clients.clear();
  console.log('[KDS] WebSocket intervals stopped and clients disconnected');
}

export function setupKdsWebSocket(wss: WebSocketServer): void {
  wss.on('connection', (ws: WebSocket, req) => {
    console.log('[KDS] New client connection');

    const client: KdsClient = {
      ws,
      userId: null,
      userName: null,
      role: null,
      categoryIds: [],
      token: null,
    };
    clients.set(ws, client);

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        handleMessage(ws, message);
      } catch (error) {
        console.error('[KDS] Message parse error:', error);
      }
    });

    ws.on('close', () => {
      console.log('[KDS] Client disconnected');
      clients.delete(ws);
    });

    ws.on('error', (error) => {
      console.error('[KDS] Client error:', error);
    });

    ws.on('pong', () => {
    });

    ws.send(JSON.stringify({
      type: 'connected',
      message: 'Connected to Flo KDS',
      timestamp: new Date().toISOString(),
    }));
  });

  if (kdsPingInterval) {
    clearInterval(kdsPingInterval);
  }
  kdsPingInterval = setInterval(() => {
    clients.forEach((client, ws) => {
      if (client.userId && ws.readyState === WebSocket.OPEN) {
        ws.ping();
      }
    });
  }, 30000);
  kdsPingInterval.unref();

  console.log('[KDS] WebSocket server setup complete');
}

function handleMessage(ws: WebSocket, message: any): void {
  const client = clients.get(ws);
  if (!client) return;

  switch (message.type) {
    case 'auth':
      handleAuth(ws, client, message);
      break;

    case 'status_update':
      handleStatusUpdate(client, message);
      break;

    case 'ping':
      ws.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
      break;

    default:
      ws.send(JSON.stringify({ type: 'error', message: 'Unknown message type' }));
  }
}

function handleAuth(ws: WebSocket, client: KdsClient, message: any): void {
  const { token, email, password } = message;

  // Login with email/password
  if (email && password) {
    const db = getDatabase();
    const user = db.prepare('SELECT * FROM users WHERE email = ? AND is_active = 1').get(email) as any;

    if (!user) {
      ws.send(JSON.stringify({ type: 'auth_error', message: 'User not found' }));
      return;
    }

    // Check password (bcrypt)
    const bcrypt = require('bcryptjs');
    if (!bcrypt.compareSync(password, user.password)) {
      ws.send(JSON.stringify({ type: 'auth_error', message: 'Invalid password' }));
      return;
    }

    // Check if user is chef role
    if (user.role !== 'chef' && user.role !== 'owner' && user.role !== 'manager') {
      ws.send(JSON.stringify({ type: 'auth_error', message: 'Only kitchen staff can access KDS' }));
      return;
    }

    // Parse category_ids
    const categoryIds = user.category_ids ? JSON.parse(user.category_ids) : [];

    client.userId = user.id;
    client.userName = user.name;
    client.role = user.role;
    client.categoryIds = categoryIds;

    ws.send(JSON.stringify({
      type: 'auth_success',
      user: {
        id: user.id,
        name: user.name,
        role: user.role,
        categoryIds: categoryIds,
      },
    }));

    sendActiveOrders(ws, client.categoryIds);
    return;
  }

  // Validate JWT token
  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as any;
      const db = getDatabase();
      const user = db.prepare('SELECT * FROM users WHERE id = ? AND is_active = 1').get(decoded.userId) as any;

      if (!user) {
        ws.send(JSON.stringify({ type: 'auth_error', message: 'User not found' }));
        return;
      }

      if (user.role !== 'chef' && user.role !== 'owner' && user.role !== 'manager') {
        ws.send(JSON.stringify({ type: 'auth_error', message: 'Only kitchen staff can access KDS' }));
        return;
      }

      const categoryIds = user.category_ids ? JSON.parse(user.category_ids) : [];

      client.userId = user.id;
      client.userName = user.name;
      client.role = user.role;
      client.categoryIds = categoryIds;
      client.token = token;

      ws.send(JSON.stringify({
        type: 'auth_success',
        user: {
          id: user.id,
          name: user.name,
          role: user.role,
          categoryIds: categoryIds,
        },
      }));

      sendActiveOrders(ws, client.categoryIds);
      return;
    } catch (err) {
      ws.send(JSON.stringify({ type: 'auth_error', message: 'Invalid token' }));
      return;
    }
  }

  ws.send(JSON.stringify({ type: 'auth_error', message: 'Email/password or token required' }));
}

function handleStatusUpdate(client: KdsClient, message: any): void {
  if (!client.userId) {
    client.ws.send(JSON.stringify({ type: 'error', message: 'Not authenticated' }));
    return;
  }

  const { order_item_id, status } = message;

  if (!order_item_id || !status) {
    client.ws.send(JSON.stringify({ type: 'error', message: 'order_item_id and status required' }));
    return;
  }

  const db = getDatabase();
  const nowStr = now();

  // Verify the item belongs to a category this user manages
  if (client.categoryIds.length > 0) {
    const item = db.prepare(`
      SELECT oi.*, p.category_id 
      FROM order_items oi 
      JOIN products p ON oi.product_id = p.id 
      WHERE oi.id = ?
    `).get(order_item_id) as any;

    if (!item) {
      client.ws.send(JSON.stringify({ type: 'error', message: 'Item not found' }));
      return;
    }

    if (!client.categoryIds.includes(item.category_id)) {
      client.ws.send(JSON.stringify({ type: 'error', message: 'Not authorized to update this item' }));
      return;
    }
  }

  // Update item status
  db.prepare('UPDATE order_items SET status = ?, updated_at = ? WHERE id = ?')
    .run(status, nowStr, order_item_id);

  broadcastOrderUpdate();

  client.ws.send(JSON.stringify({
    type: 'status_updated',
    order_item_id,
    status,
  }));
}

function sendActiveOrders(ws: WebSocket, categoryIds: string[]): void {
  const db = getDatabase();
  const activeShop = (db.prepare("SELECT value FROM settings WHERE key = 'cloud_shop_id'").get() as any)?.value;

  let query = `
    SELECT o.*, t.number as table_name, COALESCE(NULLIF(o.customer_name, ''), c.name) as customer_name
    FROM orders o
    LEFT JOIN tables t ON o.table_id = t.id
    LEFT JOIN customers c ON o.customer_id = c.id
    WHERE o.status NOT IN ('completed', 'cancelled')
  `;
  const params: any[] = [];
  if (activeShop) {
    query += ' AND o.shop_id = ?';
    params.push(parseInt(activeShop, 10));
  }

  query += ' ORDER BY o.created_at ASC';

  const orders = db.prepare(query).all(...params);

  // Filter and attach items
  const ordersWithItems = orders.map((order: any) => {
    let items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);

    // Filter items by category if user has category restrictions
    if (categoryIds.length > 0) {
      items = items.filter((item: any) => {
        const product = db.prepare('SELECT category_id FROM products WHERE id = ?').get(item.product_id) as any;
        return product && categoryIds.includes(product.category_id);
      });
    }

    return { ...order, items };
  }).filter((order: any) => order.items.length > 0);

  // Get counts (filtered by category and active shop)
  let countsQuery = `
    SELECT oi.status, COUNT(*) as count
    FROM order_items oi
    JOIN products p ON oi.product_id = p.id
    JOIN orders o ON oi.order_id = o.id
    WHERE o.status NOT IN ('completed', 'cancelled')
  `;
  const countParams: any[] = [];

  if (activeShop) {
    countsQuery += ' AND o.shop_id = ?';
    countParams.push(parseInt(activeShop, 10));
  }

  if (categoryIds.length > 0) {
    countsQuery += ` AND p.category_id IN (${categoryIds.map(() => '?').join(',')})`;
    countParams.push(...categoryIds);
  }

  countsQuery += ' GROUP BY oi.status';

  const counts = db.prepare(countsQuery).all(...countParams) as { status: string; count: number }[];

  const countMap: Record<string, number> = {};
  counts.forEach((c) => { countMap[c.status] = c.count; });

  ws.send(JSON.stringify({
    type: 'initial_data',
    orders: ordersWithItems,
    counts: countMap,
  }));
}

function broadcastOrderUpdate(): void {
  clients.forEach((client) => {
    if (client.userId) {
      sendActiveOrders(client.ws, client.categoryIds);
    }
  });
}

/** Broadcast a structured WebSocket event to all connected clients (KDS displays, POS screens) */
export function broadcastWsEvent(event: { type: string; payload?: any }): void {
  const msg = JSON.stringify(event);
  clients.forEach((client) => {
    if (client.ws.readyState === WebSocket.OPEN) {
      try {
        client.ws.send(msg);
      } catch (e) {
        console.warn('[KDS] Failed to send ws event to client:', e);
      }
    }
  });
}

export function notifyKdsUpdate(): void {
  broadcastOrderUpdate();
  broadcastWsEvent({ type: 'orders_updated', payload: { timestamp: new Date().toISOString() } });
}

