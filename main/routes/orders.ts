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
    if (req.query.date) {
      const targetDate = String(req.query.date).trim();
      query += " AND (date(created_at, 'localtime') = ? OR date(created_at) = ?)";
      params.push(targetDate, targetDate);
    } else if (req.query.today && req.query.today !== '0' && req.query.today !== 'false') {
      query += " AND (date(created_at, 'localtime') = date('now', 'localtime') OR date(created_at) = date('now'))";
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
      if (!customer && (order.customer_name || order.customer_phone)) {
        customer = { name: order.customer_name || '', phone: order.customer_phone || '' };
      }
      const bill = db.prepare('SELECT * FROM bills WHERE order_id = ?').get(order.id) as any;
      return { ...order, items, table, customer, bill };
    });

    res.json({ orders: ordersWithRelations });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const db = getDatabase();
    let order = db.prepare('SELECT * FROM orders WHERE id = ? OR order_number = ? OR cloud_order_id = ?').get(id, id, id) as any;
    if (!order) {
      try {
        const { getSupabaseClient, handleIncomingCloudOrder } = await import('../services/cloud-sync');
        const client = getSupabaseClient();
        if (client) {
          const num = Number(id);
          let cloudOrder: any = null;
          if (!isNaN(num) && num > 0) {
            const r = await client.from('orders').select('*').eq('id', num).maybeSingle();
            cloudOrder = r.data;
          }
          if (!cloudOrder) {
            const r = await client.from('orders').select('*').eq('order_number', id).maybeSingle();
            cloudOrder = r.data;
          }
          if (cloudOrder) {
            await handleIncomingCloudOrder(cloudOrder, true);
            order = db.prepare('SELECT * FROM orders WHERE cloud_order_id = ? OR order_number = ?').get(String(cloudOrder.id), String(cloudOrder.order_number || '')) as any;
          }
        }
      } catch {}
    }

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id).map(parseItemJson);
    const tableRow = order.table_id ? db.prepare('SELECT * FROM tables WHERE id = ?').get(order.table_id) as any : null;
    const table = tableRow ? { ...tableRow, name: tableRow.number } : null;
    let customer = order.customer_id ? db.prepare('SELECT * FROM customers WHERE id = ?').get(order.customer_id) : null;
    if (!customer && (order.customer_name || order.customer_phone)) {
      customer = { name: order.customer_name || '', phone: order.customer_phone || '' };
    }
    const bill = db.prepare('SELECT * FROM bills WHERE order_id = ?').get(order.id);

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
    const cleanCustomerPhone = (req.body.customer_phone || req.body.phone || req.body.customer_contact) ? String(req.body.customer_phone || req.body.phone || req.body.customer_contact).trim() : null;
    const rawPaymentMethod = (req.body.payment_method || 'cash').toString().toLowerCase().trim();
    const paymentMethod = rawPaymentMethod.includes('online') || rawPaymentMethod.includes('bank') || rawPaymentMethod.includes('card') ? 'online' : 'cash';

    let orderNumber = generateOrderNumber();
    let orderResult: any = null;
    const insertOrderStmt = db.prepare(`
      INSERT INTO orders (
        order_number, table_id, customer_id, customer_name, customer_phone, user_id, type, payment_method, guest_count,
        special_instructions, packaging_charge, delivery_charge, delivery_fee, delivery_address,
        status, shop_id, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
    `);

    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        orderResult = insertOrderStmt.run(
          orderNumber,
          table_id || null,
          customer_id || null,
          cleanCustomerName || null,
          cleanCustomerPhone || null,
          user_id || null,
          type,
          paymentMethod,
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
        break;
      } catch (insertErr: any) {
        if (insertErr.message?.includes('UNIQUE') && attempt < 4) {
          orderNumber = `${generateOrderNumber()}-${Date.now().toString().slice(-4)}`;
          continue;
        }
        throw insertErr;
      }
    }

    const orderId = orderResult.lastInsertRowid;

    // Insert items
    let subtotal = 0;
    let totalTax = 0;
    const allTaxBreakdowns: any[] = [];

    const insertItem = db.prepare(`
      INSERT INTO order_items (order_id, product_id, product_name, product_sku, unit_price, quantity,
        subtotal, tax_amount, tax_breakdown, tax_type, discount_amount, total, variant_selection,
        modifier_selection, addons, special_instructions, items_included, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `);

    for (const item of items) {
      let product = item.product_id ? (db.prepare('SELECT * FROM products WHERE id = ?').get(item.product_id) as any) : null;
      if (!product && (item.product_name || item.name)) {
        product = db.prepare('SELECT * FROM products WHERE name = ?').get(item.product_name || item.name) as any;
      }

      // Check stock
      if (product && product.track_inventory && product.stock_quantity < item.quantity) {
        throw new Error(`Insufficient stock for ${product.name}`);
      }

      // Determine real price according to database variation or size
      let unitPrice = product ? (parseFloat(product.price) || 0) : (Number(item.unit_price || item.price) || 0);
      if (item.unit_price && Number(item.unit_price) > 0) {
        unitPrice = Number(item.unit_price);
      } else if (product && item.variant_selection && product.tags) {
        try {
          const parsed = JSON.parse(product.tags);
          if (parsed && Array.isArray(parsed.variations)) {
            const sLower = String(item.variant_selection).toLowerCase().trim();
            const match = parsed.variations.find((v: any) => {
              const vName = String(v.name || '').toLowerCase().trim();
              if (vName === sLower) return true;
              if (sLower.includes('small') && vName.includes('small')) return true;
              if (sLower.includes('medium') && (vName.includes('medium') || vName.includes('big'))) return true;
              if (sLower === 'large' && vName === 'large') return true;
              if ((sLower.includes('extra') || sLower === 'xl') && (vName.includes('extra') || vName.includes('xl'))) return true;
              return false;
            });
            if (match && Number(match.price) > 0) {
              unitPrice = Number(match.price);
            }
          }
        } catch {}
      }

      const quantity = item.quantity || 1;
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
      const taxResult = calculateItemTax(tenantInfo, product || { tax_type: 'exclusive', tax_rate: 0 }, itemSubtotal, customer);

      totalTax += taxResult.tax_amount;
      if (taxResult.tax_breakdown) {
        allTaxBreakdowns.push(taxResult.tax_breakdown);
      }

      const itemTotal = itemSubtotal + taxResult.tax_amount;
      subtotal += itemSubtotal;

      const safeProductId = String(product?.id || item.product_id || `custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
      const safeProductName = String(product?.name || item.product_name || item.name || 'Custom Item');
      const safeProductSku = product ? product.sku : null;
      const safeTaxType = product ? product.tax_type : 'exclusive';
      const safeItemsInc = item.items_included ? String(item.items_included) : (product?.items_included ? String(product.items_included) : (product?.description || null));

      insertItem.run(
        orderId, safeProductId, safeProductName, safeProductSku, unitPrice, quantity,
        itemSubtotal, taxResult.tax_amount, JSON.stringify(taxResult.tax_breakdown),
        safeTaxType, itemDiscount, itemTotal,
        item.variant_selection ? (typeof item.variant_selection === 'object' ? JSON.stringify(item.variant_selection) : String(item.variant_selection)) : null,
        JSON.stringify(item.modifier_selection || null),
        JSON.stringify(item.addons || null),
        item.special_instructions || null,
        safeItemsInc,
        now(), now()
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
      : ((order.customer_name || order.customer_phone) ? { name: order.customer_name || '', phone: order.customer_phone || '' } : null);

    notifyKdsUpdate();

    // Push POS order up to Pizza Management cloud (Supabase) in background
    try {
      const { pushOrderToCloud } = await import('../services/cloud-sync');
      pushOrderToCloud(order, orderItems).catch((err) => {
        console.warn('[Orders] Background cloud push error:', err?.message || err);
      });
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
        modifier_selection, addons, special_instructions, items_included, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
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
        item.special_instructions || null,
        (item.items_included ? String(item.items_included) : (product.items_included ? String(product.items_included) : (product.description || null))),
        now(), now()
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

// PATCH /api/orders/:id/customer — Update customer name, phone number, and delivery address
router.patch('/:id/customer', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { customer_name, customer_phone, phone, delivery_address } = req.body;
    const db = getDatabase();

    const order = db.prepare('SELECT * FROM orders WHERE id = ? OR order_number = ? OR cloud_order_id = ?').get(id, id, id) as any;
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const cleanName = customer_name !== undefined ? (customer_name ? String(customer_name).trim() : null) : order.customer_name;
    const cleanPhone = (customer_phone !== undefined || phone !== undefined)
      ? (customer_phone || phone ? String(customer_phone || phone).trim() : null)
      : order.customer_phone;
    const cleanAddress = delivery_address !== undefined ? (delivery_address ? String(delivery_address).trim() : null) : order.delivery_address;

    db.prepare(`
      UPDATE orders
      SET customer_name = ?, customer_phone = ?, delivery_address = ?, updated_at = ?
      WHERE id = ?
    `).run(cleanName, cleanPhone, cleanAddress, now(), order.id);

    // Also update cloud if synced
    try {
      const { updateCloudOrderCustomer } = await import('../services/cloud-sync');
      if (updateCloudOrderCustomer) {
        await updateCloudOrderCustomer(order.cloud_order_id || order.order_number || order.id, {
          customer_name: cleanName,
          customer_phone: cleanPhone,
          delivery_address: cleanAddress,
        });
      }
    } catch {}

    const updated = db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id) as any;
    const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id).map(parseItemJson);
    const customer = (cleanName || cleanPhone) ? { name: cleanName || '', phone: cleanPhone || '' } : null;

    res.json({ success: true, order: Object.assign({}, updated, { items, customer }) });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// PATCH /api/orders/:id/delivery — Adjust delivery fee, address, and customer info on the fly (for POS printer/staff/admin)
router.patch('/:id/delivery', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { delivery_charge, delivery_fee, delivery_address, customer_name, customer_phone, phone, type } = req.body;
    const db = getDatabase();

    const order = db.prepare('SELECT * FROM orders WHERE id = ? OR order_number = ? OR cloud_order_id = ?').get(id, id, id) as any;
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const fee = Math.max(0, Number(delivery_charge ?? delivery_fee ?? 0));
    const cleanAddress = delivery_address !== undefined ? (delivery_address ? String(delivery_address).trim() : null) : order.delivery_address;
    const cleanName = customer_name !== undefined ? (customer_name ? String(customer_name).trim() : null) : order.customer_name;
    const cleanPhone = (customer_phone !== undefined || phone !== undefined)
      ? (customer_phone || phone ? String(customer_phone || phone).trim() : null)
      : order.customer_phone;
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
      SET delivery_charge = ?, delivery_fee = ?, delivery_address = ?, customer_name = ?, customer_phone = ?, type = ?, total = ?, round_off = ?, updated_at = ?
      WHERE id = ?
    `).run(fee, fee, cleanAddress, cleanName, cleanPhone, newType, total, roundOff, now(), order.id);

    // Also update existing bill if any
    try {
      db.prepare(`
        UPDATE bills
        SET delivery_charge = ?, total = ?, updated_at = ?
        WHERE order_id = ?
      `).run(fee, total, now(), order.id);
    } catch {}

    const updated = db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id) as any;

    // Push update to Cloud Supabase
    try {
      const { updateCloudOrderCustomer } = await import('../services/cloud-sync');
      if (updateCloudOrderCustomer) {
        await updateCloudOrderCustomer(order.cloud_order_id || order.order_number || order.id, {
          customer_name: cleanName,
          customer_phone: cleanPhone,
          delivery_address: cleanAddress,
        });
      }
    } catch {}

    const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id).map(parseItemJson);
    const customer = (cleanName || cleanPhone) ? { name: cleanName || '', phone: cleanPhone || '' } : null;

    res.json({ success: true, order: Object.assign({}, updated, { items, customer }) });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ── POST /api/orders/:id/recreate ───────────────────────────────────────────
router.post('/:id/recreate', async (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const sourceOrder = db.prepare('SELECT * FROM orders WHERE id = ? OR order_number = ?').get(req.params.id, String(req.params.id)) as any;
    if (!sourceOrder) {
      return res.status(404).json({ error: 'Source order not found' });
    }

    const mode = (req.body.mode || 'new').toLowerCase().trim(); // 'new' | 'update'
    const inputItems = Array.isArray(req.body.items) && req.body.items.length > 0
      ? req.body.items
      : db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(sourceOrder.id).map(parseItemJson);

    if (inputItems.length === 0) {
      return res.status(400).json({ error: 'Order must contain at least 1 item' });
    }

    const type = req.body.type || req.body.order_type || sourceOrder.type || 'takeaway';
    const customer_name = req.body.customer_name !== undefined ? (req.body.customer_name ? String(req.body.customer_name).trim() : null) : sourceOrder.customer_name;
    const customer_phone = req.body.customer_phone !== undefined ? (req.body.customer_phone ? String(req.body.customer_phone).trim() : null) : sourceOrder.customer_phone;
    const delivery_address = req.body.delivery_address !== undefined ? (req.body.delivery_address ? String(req.body.delivery_address).trim() : null) : sourceOrder.delivery_address;
    const delivery_fee = type === 'delivery' ? (req.body.delivery_fee !== undefined ? Number(req.body.delivery_fee) : Number(sourceOrder.delivery_fee || 0)) : 0;
    const table_id = type === 'dine_in' ? (req.body.table_id !== undefined ? req.body.table_id : sourceOrder.table_id) : null;
    const payment_method = req.body.payment_method || sourceOrder.payment_method || 'cash';
    const special_instructions = req.body.special_instructions !== undefined ? req.body.special_instructions : sourceOrder.special_instructions;

    // Calculate subtotal & total
    let subtotal = 0;
    const preparedItems: any[] = [];
    for (const it of inputItems) {
      const qty = Math.max(1, Number(it.quantity || it.qty || 1));
      const price = Math.max(0, Number(it.unit_price || it.price || 0));
      const itemSubtotal = qty * price;
      subtotal += itemSubtotal;
      const safeProdId = String(
        it.product_id ||
        it.productId ||
        it.id ||
        `prod-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      );
      preparedItems.push({
        product_id: safeProdId,
        product_name: it.product_name || it.name || 'Item',
        unit_price: price,
        quantity: qty,
        subtotal: itemSubtotal,
        total: itemSubtotal,
        variant_selection: it.variant_selection || (it.detail ? JSON.stringify({ name: it.detail }) : null),
        special_instructions: it.special_instructions || null,
        items_included: it.items_included || null,
      });
    }

    const total = subtotal + delivery_fee;
    const roundOff = 0;

    const activeShop = req.body.shop_id || sourceOrder.shop_id;
    const shopIdNum = activeShop ? parseInt(String(activeShop), 10) : null;

    if (mode === 'update') {
      // In-place update / re-issuance of the existing order
      db.prepare(`
        UPDATE orders
        SET type = ?, customer_name = ?, customer_phone = ?, delivery_address = ?,
            delivery_fee = ?, delivery_charge = ?, table_id = ?, payment_method = ?,
            special_instructions = ?, subtotal = ?, total = ?, round_off = ?,
            status = 'pending', updated_at = ?
        WHERE id = ?
      `).run(
        type, customer_name, customer_phone, delivery_address,
        delivery_fee, delivery_fee, table_id, payment_method,
        special_instructions, subtotal, total, roundOff, now(), sourceOrder.id
      );

      // Replace items
      db.prepare('DELETE FROM order_items WHERE order_id = ?').run(sourceOrder.id);
      const insertItem = db.prepare(`
        INSERT INTO order_items (
          order_id, product_id, product_name, unit_price, quantity, subtotal, total,
          variant_selection, special_instructions, items_included, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
      `);
      for (const pi of preparedItems) {
        insertItem.run(
          sourceOrder.id, pi.product_id, pi.product_name, pi.unit_price, pi.quantity, pi.subtotal, pi.total,
          typeof pi.variant_selection === 'object' ? JSON.stringify(pi.variant_selection) : pi.variant_selection,
          pi.special_instructions,
          typeof pi.items_included === 'object' ? JSON.stringify(pi.items_included) : pi.items_included,
          now(), now()
        );
      }

      notifyKdsUpdate();

      const finalOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get(sourceOrder.id) as any;
      const finalItems = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(sourceOrder.id).map(parseItemJson);

      // Cloud push update
      try {
        const { pushOrderToCloud } = await import('../services/cloud-sync');
        pushOrderToCloud(finalOrder, finalItems).catch(() => {});
      } catch {}

      return res.json({
        success: true,
        mode: 'update',
        order: Object.assign({}, finalOrder, { items: finalItems })
      });
    } else {
      // Mode 'new': generate new order number and insert fresh record
      let newOrderNumber = generateOrderNumber();
      const insertOrder = db.prepare(`
        INSERT INTO orders (
          order_number, table_id, customer_name, customer_phone, type, payment_method,
          special_instructions, packaging_charge, delivery_charge, delivery_fee, delivery_address,
          status, subtotal, total, round_off, shop_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)
      `);

      let orderRes: any;
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          orderRes = insertOrder.run(
            newOrderNumber, table_id || null, customer_name || null, customer_phone || null,
            type, payment_method, special_instructions || `Recreated from ${sourceOrder.order_number}`,
            delivery_fee, delivery_fee, delivery_address || null,
            subtotal, total, roundOff, shopIdNum, now(), now()
          );
          break;
        } catch (err: any) {
          if (err.message?.includes('UNIQUE') && attempt < 4) {
            newOrderNumber = `${generateOrderNumber()}-${Date.now().toString().slice(-4)}`;
            continue;
          }
          throw err;
        }
      }

      const createdOrderId = orderRes.lastInsertRowid;

      // Mark table occupied if dine_in
      if (table_id && type === 'dine_in') {
        try {
          db.prepare("UPDATE tables SET status = 'occupied', updated_at = ? WHERE id = ?").run(now(), table_id);
        } catch {}
      }

      const insertItem = db.prepare(`
        INSERT INTO order_items (
          order_id, product_id, product_name, unit_price, quantity, subtotal, total,
          variant_selection, special_instructions, items_included, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
      `);
      for (const pi of preparedItems) {
        insertItem.run(
          createdOrderId, pi.product_id, pi.product_name, pi.unit_price, pi.quantity, pi.subtotal, pi.total,
          typeof pi.variant_selection === 'object' ? JSON.stringify(pi.variant_selection) : pi.variant_selection,
          pi.special_instructions,
          typeof pi.items_included === 'object' ? JSON.stringify(pi.items_included) : pi.items_included,
          now(), now()
        );
      }

      notifyKdsUpdate();

      const createdOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get(createdOrderId) as any;
      const createdItems = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(createdOrderId).map(parseItemJson);

      // Cloud push new order to Supabase
      try {
        const { pushOrderToCloud } = await import('../services/cloud-sync');
        pushOrderToCloud(createdOrder, createdItems).catch(() => {});
      } catch {}

      return res.status(201).json({
        success: true,
        mode: 'new',
        order: Object.assign({}, createdOrder, { items: createdItems })
      });
    }
  } catch (err: any) {
    console.error('[Orders] Recreate error:', err);
    res.status(500).json({ error: err?.message || 'Failed to recreate order' });
  }
});


export const orderRoutes = router;
