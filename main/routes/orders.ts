import { Router, Request, Response } from 'express';
import { getDatabase, generateOrderNumber, now, parseItemJson } from '../db';
import { calculateItemTax } from '../services/tax';
import { notifyKdsUpdate } from '../services/kds';

const router = Router();

router.get('/', async (req: Request, res: Response) => {
  try {
    // Auto-sync latest online orders from Pizza System cloud unless disabled
    if (req.query.sync !== '0') {
      try {
        const { pullOnlineOrdersFromCloud } = require('../services/cloud-sync');
        await pullOnlineOrdersFromCloud();
      } catch {}
    }

    const db = getDatabase();
    const activeShop = (req.query.shop_id as string) || (db.prepare("SELECT value FROM settings WHERE key = 'cloud_shop_id'").get() as any)?.value;
    // Preserving original shop_id for multi-branch isolation

    let query = 'SELECT * FROM orders WHERE 1=1';
    const params: any[] = [];

    if (activeShop) {
      query += ' AND (shop_id = ? OR shop_id IS NULL OR shop_id = 0)';
      params.push(parseInt(activeShop, 10));
    }

    if (req.query.status) {
      query += ' AND status = ?';
      params.push(req.query.status);
    }
    if (req.query.type) {
      query += ' AND type = ?';
      params.push(req.query.type);
    }
    if (req.query.today && req.query.today !== '0' && req.query.today !== 'false') {
      query += " AND date(created_at) = date('now')";
    }
    if (req.query.table_id) {
      query += ' AND table_id = ?';
      params.push(req.query.table_id);
    }

    query += ' ORDER BY created_at DESC';

    if (req.query.per_page) {
      query += ` LIMIT ${parseInt(req.query.per_page as string)}`;
    }

    const orders = db.prepare(query).all(...params);

    // Load related data
    const ordersWithRelations = orders.map((order: any) => {
      const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id).map(parseItemJson);
      const tableRow = order.table_id ? db.prepare('SELECT * FROM tables WHERE id = ?').get(order.table_id) as any : null;
      const table = tableRow ? { ...tableRow, name: tableRow.number } : null;
      let customer = order.customer_id ? db.prepare('SELECT * FROM customers WHERE id = ?').get(order.customer_id) : null;
      if (!customer && order.customer_name) {
        customer = { name: order.customer_name };
      }
      const bill = db.prepare('SELECT * FROM bills WHERE order_id = ?').get(order.id) as any;
      return { ...order, items, table, customer, bill };
    });

    res.json({ orders: ordersWithRelations });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(req.params.id).map(parseItemJson);
    const tableRow = (order as any).table_id ? db.prepare('SELECT * FROM tables WHERE id = ?').get((order as any).table_id) as any : null;
    const table = tableRow ? { ...tableRow, name: tableRow.number } : null;
    let customer = (order as any).customer_id ? db.prepare('SELECT * FROM customers WHERE id = ?').get((order as any).customer_id) : null;
    if (!customer && (order as any).customer_name) {
      customer = { name: (order as any).customer_name };
    }
    const bill = db.prepare('SELECT * FROM bills WHERE order_id = ?').get(req.params.id);

    res.json({ order: { ...order, items, table, customer, bill } });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/', async (req: Request, res: Response) => {
  try {
    const { table_id, customer_id, customer_name, user_id, type, guest_count, special_instructions, packaging_charge, delivery_charge, delivery_fee, delivery_address, items } = req.body;
    const safeDeliveryFee = Math.max(0, Number(delivery_charge ?? delivery_fee ?? 0));
    const cleanDeliveryAddress = delivery_address ? String(delivery_address).trim() : null;

    if (!items || items.length === 0) {
      return res.status(400).json({ error: 'At least one item is required' });
    }

    if (!type || !['dine_in', 'takeaway', 'delivery', 'online'].includes(type)) {
      return res.status(400).json({ error: 'Valid type is required (dine_in, takeaway, delivery, online)' });
    }

    const db = getDatabase();
    const orderNumber = generateOrderNumber();

    // Get settings for tax calculation
    const settings: Record<string, string> = {};
    db.prepare('SELECT key, value FROM settings').all().forEach((row: any) => {
      settings[row.key] = row.value;
    });

    const tenantInfo = {
      country: settings.country || 'IN',
      business_type: settings.business_type || 'restaurant',
      state_code: settings.state_code || '',
    };

    // Create order
    const activeShop = req.body.shop_id || settings.cloud_shop_id || (db.prepare("SELECT value FROM settings WHERE key = 'cloud_shop_id'").get() as any)?.value;
    const shopIdNum = activeShop ? parseInt(activeShop, 10) : null;
    const cleanCustomerName = customer_name ? String(customer_name).trim() : null;

    const orderResult = db.prepare(`
      INSERT INTO orders (
        order_number, table_id, customer_id, customer_name, user_id, type, guest_count,
        special_instructions, packaging_charge, delivery_charge, delivery_fee, delivery_address,
        status, shop_id, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
    `).run(
      orderNumber,
      table_id || null,
      customer_id || null,
      cleanCustomerName || null,
      user_id || null,
      type,
      guest_count || null,
      special_instructions || null,
      packaging_charge || 0,
      safeDeliveryFee,
      safeDeliveryFee,
      cleanDeliveryAddress,
      shopIdNum,
      now(),
      now()
    );

    const orderId = orderResult.lastInsertRowid;

    // Insert items
    let subtotal = 0;
    let totalTax = 0;
    const allTaxBreakdowns: any[] = [];

    const insertItem = db.prepare(`
      INSERT INTO order_items (order_id, product_id, product_name, product_sku, unit_price, quantity,
        subtotal, tax_amount, tax_breakdown, tax_type, discount_amount, total, variant_selection,
        modifier_selection, addons, special_instructions, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `);

    for (const item of items) {
      const product = db.prepare('SELECT * FROM products WHERE id = ?').get(item.product_id) as any;
      if (!product) {
        throw new Error(`Product ${item.product_id} not found`);
      }

      // Check stock
      if (product.track_inventory && product.stock_quantity < item.quantity) {
        throw new Error(`Insufficient stock for ${product.name}`);
      }

      const unitPrice = parseFloat(product.price);
      const quantity = item.quantity;
      const itemDiscount = item.discount_amount || 0;

      let itemSubtotal = unitPrice * quantity;
      if (item.addons) {
        for (const addon of item.addons) {
          itemSubtotal += (addon.price || 0) * quantity;
        }
      }
      itemSubtotal = Math.max(0, itemSubtotal - itemDiscount);

      // Calculate tax
      const customer = customer_id ? db.prepare('SELECT * FROM customers WHERE id = ?').get(customer_id) as any : null;
      const taxResult = calculateItemTax(tenantInfo, product, itemSubtotal, customer);

      totalTax += taxResult.tax_amount;
      if (taxResult.tax_breakdown) {
        allTaxBreakdowns.push(taxResult.tax_breakdown);
      }

      const itemTotal = itemSubtotal + taxResult.tax_amount;
      subtotal += itemSubtotal;

      insertItem.run(
        orderId, product.id, product.name, product.sku, unitPrice, quantity,
        itemSubtotal, taxResult.tax_amount, JSON.stringify(taxResult.tax_breakdown),
        product.tax_type, itemDiscount, itemTotal,
        item.variant_selection ? JSON.stringify(item.variant_selection) : null,
        JSON.stringify(item.modifier_selection || null),
        JSON.stringify(item.addons || null),
        item.special_instructions || null, now(), now()
      );

      // Decrease stock
      if (product.track_inventory) {
        db.prepare('UPDATE products SET stock_quantity = stock_quantity - ?, updated_at = ? WHERE id = ?')
          .run(quantity, now(), product.id);
      }
    }

    // Calculate round off
    const preRoundTotal = subtotal + totalTax + (packaging_charge || 0) + safeDeliveryFee;
    const roundOff = Math.round(preRoundTotal) - preRoundTotal;
    const total = Math.round(preRoundTotal) + roundOff;

    // Update order totals
    db.prepare(`
      UPDATE orders SET subtotal = ?, tax_amount = ?, tax_breakdown = ?, total = ?,
        round_off = ?, delivery_charge = ?, delivery_fee = ?, delivery_address = ?, updated_at = ? WHERE id = ?
    `).run(subtotal, totalTax, JSON.stringify(allTaxBreakdowns), total, roundOff, safeDeliveryFee, safeDeliveryFee, cleanDeliveryAddress, now(), orderId);

    // Mark table as occupied
    if (table_id && type === 'dine_in') {
      db.prepare("UPDATE tables SET status = 'occupied', updated_at = ? WHERE id = ?").run(now(), table_id);
    }

    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId) as any;
    const orderItems = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId).map(parseItemJson);
    const customer = order.customer_id
      ? db.prepare('SELECT * FROM customers WHERE id = ?').get(order.customer_id)
      : (order.customer_name ? { name: order.customer_name } : null);

    notifyKdsUpdate();

    // Push POS order up to Pizza Management cloud (Supabase) in background
    try {
      const { pushOrderToCloud } = await import('../services/cloud-sync');
      pushOrderToCloud(order, orderItems).catch(() => {});
    } catch {}

    res.status(201).json({ order: Object.assign({}, order, { items: orderItems, customer }) });
  } catch (error: any) {
    console.error('[Orders] Create error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/:id/items', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    if (['completed', 'cancelled'].includes((order as any).status)) {
      return res.status(400).json({ error: 'Cannot add items to a completed or cancelled order' });
    }

    const { items } = req.body;
    if (!items || items.length === 0) {
      return res.status(400).json({ error: 'At least one item is required' });
    }

    // Get settings
    const settings: Record<string, string> = {};
    db.prepare('SELECT key, value FROM settings').all().forEach((row: any) => {
      settings[row.key] = row.value;
    });

    const tenantInfo = {
      country: settings.country || 'IN',
      business_type: settings.business_type || 'restaurant',
      state_code: settings.state_code || '',
    };

    const customer = (order as any).customer_id ? db.prepare('SELECT * FROM customers WHERE id = ?').get((order as any).customer_id) as any : null;

    const insertItem = db.prepare(`
      INSERT INTO order_items (order_id, product_id, product_name, product_sku, unit_price, quantity,
        subtotal, tax_amount, tax_breakdown, tax_type, discount_amount, total, variant_selection,
        modifier_selection, addons, special_instructions, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `);

    for (const item of items) {
      const product = db.prepare('SELECT * FROM products WHERE id = ?').get(item.product_id) as any;
      if (!product) {
        throw new Error(`Product ${item.product_id} not found`);
      }

      if (product.track_inventory && product.stock_quantity < item.quantity) {
        throw new Error(`Insufficient stock for ${product.name}`);
      }

      const unitPrice = parseFloat(product.price);
      const quantity = item.quantity;
      const itemDiscount = item.discount_amount || 0;

      let itemSubtotal = unitPrice * quantity;
      if (item.addons) {
        for (const addon of item.addons) {
          itemSubtotal += (addon.price || 0) * quantity;
        }
      }
      itemSubtotal = Math.max(0, itemSubtotal - itemDiscount);

      const taxResult = calculateItemTax(tenantInfo, product, itemSubtotal, customer);
      const itemTotal = itemSubtotal + taxResult.tax_amount;

      insertItem.run(
        req.params.id, product.id, product.name, product.sku, unitPrice, quantity,
        itemSubtotal, taxResult.tax_amount, JSON.stringify(taxResult.tax_breakdown),
        product.tax_type, itemDiscount, itemTotal,
        item.variant_selection ? JSON.stringify(item.variant_selection) : null,
        JSON.stringify(item.modifier_selection || null),
        JSON.stringify(item.addons || null),
        item.special_instructions || null, now(), now()
      );

      if (product.track_inventory) {
        db.prepare('UPDATE products SET stock_quantity = stock_quantity - ?, updated_at = ? WHERE id = ?')
          .run(quantity, now(), product.id);
      }
    }

    // Recalculate order totals
    const orderItems = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(req.params.id) as any[];
    let subtotal = 0;
    let totalTax = 0;
    for (const item of orderItems) {
      subtotal += item.subtotal;
      totalTax += item.tax_amount;
    }

    const preRoundTotal = subtotal + totalTax + ((order as any).packaging_charge || 0);
    const roundOff = Math.round(preRoundTotal) - preRoundTotal;
    const total = Math.round(preRoundTotal) + roundOff;

    db.prepare(`
      UPDATE orders SET subtotal = ?, tax_amount = ?, total = ?, round_off = ?, updated_at = ? WHERE id = ?
    `).run(subtotal, totalTax, total, roundOff, now(), req.params.id);

    const updatedOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id) as any;
    const updatedItems = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(req.params.id).map(parseItemJson);

    res.json({ order: Object.assign({}, updatedOrder, { items: updatedItems }) });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.patch('/:id/status', async (req: Request, res: Response) => {
  try {
    const { status, reason } = req.body;

    if (!status) {
      return res.status(400).json({ error: 'Status is required' });
    }

    const validStatuses = ['preparing', 'ready', 'served', 'completed', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Use: ${validStatuses.join(', ')}` });
    }

    // reason is optional for cancellation

    const db = getDatabase();
    let order = db.prepare('SELECT * FROM orders WHERE id = ? OR cloud_order_id = ? OR order_number = ?')
      .get(req.params.id, String(req.params.id), String(req.params.id)) as any;

    const nowStr = now();
    const cloudTargetId = order?.cloud_order_id || req.params.id;

    if (order) {
      const targetId = order.id;

      switch (status) {
        case 'preparing':
          db.prepare('UPDATE orders SET status = ?, cooking_started_at = ?, updated_at = ? WHERE id = ?')
            .run(status, nowStr, nowStr, targetId);
          break;

        case 'ready':
          db.prepare('UPDATE orders SET status = ?, ready_at = ?, updated_at = ? WHERE id = ?')
            .run(status, nowStr, nowStr, targetId);
          break;

        case 'served':
          db.prepare('UPDATE orders SET status = ?, served_at = ?, updated_at = ? WHERE id = ?')
            .run(status, nowStr, nowStr, targetId);
          break;

        case 'completed':
          db.prepare('UPDATE orders SET status = ?, completed_at = ?, updated_at = ? WHERE id = ?')
            .run(status, nowStr, nowStr, targetId);
          // Free table
          if (order.table_id) {
            db.prepare("UPDATE tables SET status = 'available', updated_at = ? WHERE id = ?")
              .run(nowStr, order.table_id);
          }
          break;

        case 'cancelled':
          // Restore stock
          const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(targetId) as any[];
          for (const item of items) {
            const product = db.prepare('SELECT * FROM products WHERE id = ?').get(item.product_id) as any;
            if (product && product.track_inventory) {
              db.prepare('UPDATE products SET stock_quantity = stock_quantity + ?, updated_at = ? WHERE id = ?')
                .run(item.quantity, nowStr, product.id);
            }
          }
          db.prepare('UPDATE orders SET status = ?, cancelled_at = ?, cancellation_reason = ?, updated_at = ? WHERE id = ?')
            .run(status, nowStr, reason, nowStr, targetId);
          // Free table
          if (order.table_id) {
            db.prepare("UPDATE tables SET status = 'available', updated_at = ? WHERE id = ?")
              .run(nowStr, order.table_id);
          }
          break;
      }
    }

    // Real-time notification to local KDS displays
    notifyKdsUpdate();

    // Real-time synchronization of order status to Pizza System Cloud (Supabase)
    try {
      const { updateCloudOrderStatus } = await import('../services/cloud-sync');
      updateCloudOrderStatus(cloudTargetId, status, { notes: reason || undefined }).catch(() => {});
    } catch {}

    const updatedOrder = order
      ? db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id) as any
      : { id: req.params.id, status };
    const orderItems = order
      ? db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id).map(parseItemJson)
      : [];
    const tableRow2 = updatedOrder?.table_id ? db.prepare('SELECT * FROM tables WHERE id = ?').get(updatedOrder.table_id) as any : null;
    const table = tableRow2 ? { ...tableRow2, name: tableRow2.number } : null;

    res.json({ order: Object.assign({}, updatedOrder, { items: orderItems, table }) });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export const orderRoutes = router;
// PATCH /api/orders/:id/delivery — Adjust delivery fee and address on the fly (for POS printer/staff/admin)
router.patch('/:id/delivery', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { delivery_charge, delivery_fee, delivery_address, type } = req.body;
    const db = getDatabase();

    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id) as any;
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const fee = Math.max(0, Number(delivery_charge ?? delivery_fee ?? 0));
    const cleanAddress = delivery_address !== undefined ? (delivery_address ? String(delivery_address).trim() : null) : order.delivery_address;
    const newType = type || order.type;

    const subtotal = Number(order.subtotal) || 0;
    const taxAmount = Number(order.tax_amount) || 0;
    const pkg = Number(order.packaging_charge) || 0;
    const discount = Number(order.discount_amount) || 0;

    const preRound = subtotal + taxAmount + pkg + fee - discount;
    const roundOff = Math.round(preRound) - preRound;
    const total = Math.max(0, Math.round(preRound) + roundOff);

    db.prepare(`
      UPDATE orders
      SET delivery_charge = ?, delivery_fee = ?, delivery_address = ?, type = ?, total = ?, round_off = ?, updated_at = ?
      WHERE id = ?
    `).run(fee, fee, cleanAddress, newType, total, roundOff, now(), id);

    // Also update existing bill if any
    try {
      db.prepare(`
        UPDATE bills
        SET delivery_charge = ?, total = ?, updated_at = ?
        WHERE order_id = ?
      `).run(fee, total, now(), id);
    } catch {}

    const updated = db.prepare('SELECT * FROM orders WHERE id = ?').get(id) as any;

    // Push update to Cloud Supabase
    try {
      const { pushOrderToCloud } = await import('../services/cloud-sync');
      const orderItems = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(id).map(parseItemJson);
      pushOrderToCloud(updated, orderItems).catch(() => {});
    } catch {}

    res.json({ success: true, order: updated });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
