import { Router, Request, Response } from 'express';
import { getDatabase, now } from '../db';
import { v4 as uuidv4 } from 'uuid';
import { 
  printViaNetwork, 
  printViaUSB, 
  buildTestPage, 
  printReceipt, 
  printKOT, 
  detectConnectedPrinters, 
  refreshDefaultPrinter, 
  refreshPrinters, 
  getKitchenPrinter,
  getPrinterConfig 
} from '../printers/thermal';

const router = Router();

// GET /api/printers — list all
router.get('/', (_req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const printers = db.prepare('SELECT * FROM printers ORDER BY is_default DESC, is_kitchen DESC, name').all();
    const kitchenSetting = db.prepare("SELECT value FROM settings WHERE key = 'kitchen_printer_id'").get() as any;
    const copiesSetting = db.prepare("SELECT value FROM settings WHERE key = 'receipt_copies'").get() as any;
    res.json({ 
      printers,
      kitchen_printer_id: kitchenSetting?.value || null,
      receipt_copies: copiesSetting?.value || 'customer',
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/printers/detect — detect connected USB/network printers AND auto-sync to DB
router.get('/detect', async (_req: Request, res: Response) => {
  try {
    const detected = await detectConnectedPrinters();
    console.log('[Printer] Detected printers on host:', detected);

    const db = getDatabase();
    const existing = db.prepare('SELECT * FROM printers').all() as any[];
    const existingNames = new Set(existing.map((p: any) => p.name.toLowerCase()));
    const hasDefault = existing.some((p: any) => p.is_default === 1);

    // Auto-register any detected hardware printers into SQLite catalog
    for (const p of detected) {
      if (!p.name) continue;
      const lower = p.name.toLowerCase();
      // Skip dummy virtual printers unless nothing else is found
      const isVirtual = lower.includes('onenote') || lower.includes('fax');
      if (isVirtual && detected.length > 1) continue;

      const pWidth = (p.model && p.model.includes('58')) || lower.includes('58') ? '58mm' : '80mm';

      if (!existingNames.has(lower)) {
        const id = 'printer-' + uuidv4().substring(0, 8);
        const makeDefault = !hasDefault && (p.isDefault || p.make !== 'Unknown');

        db.prepare(`
          INSERT INTO printers (id, name, connection_type, paper_width, is_default, created_at, updated_at)
          VALUES (?, ?, 'usb', ?, ?, ?, ?)
        `).run(id, p.name, pWidth, makeDefault ? 1 : 0, now(), now());

        existingNames.add(lower);
      }
    }

    refreshDefaultPrinter();
    const printers = db.prepare('SELECT * FROM printers ORDER BY is_default DESC, name').all() as any[];
    const statusMap = new Map(detected.map((d: any) => [d.name.toLowerCase(), d.status]));
    const enriched = printers.map((p: any) => ({
      ...p,
      live_status: statusMap.get(p.name.toLowerCase()) || 'offline',
    }));
    res.json({ printers: enriched, detected });
  } catch (error: any) {
    console.error('[Printer] Detection error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/printers/select-active — one-click activate a printer
router.post('/select-active', (req: Request, res: Response) => {
  try {
    const { id, name, paper_width } = req.body;
    const db = getDatabase();

    db.prepare('UPDATE printers SET is_default = 0').run();

    if (id) {
      db.prepare(`
        UPDATE printers 
        SET is_default = 1, 
            paper_width = COALESCE(?, paper_width), 
            updated_at = ? 
        WHERE id = ?
      `).run(paper_width || null, now(), id);
    } else if (name) {
      const existing = db.prepare('SELECT * FROM printers WHERE name = ?').get(name) as any;
      if (existing) {
        db.prepare(`
          UPDATE printers 
          SET is_default = 1, 
              paper_width = COALESCE(?, paper_width), 
              updated_at = ? 
          WHERE id = ?
        `).run(paper_width || null, now(), existing.id);
      } else {
        const newId = 'printer-' + uuidv4().substring(0, 8);
        const pWidth = paper_width || (name.includes('58') ? '58mm' : '80mm');
        db.prepare(`
          INSERT INTO printers (id, name, connection_type, paper_width, is_default, created_at, updated_at)
          VALUES (?, ?, 'usb', ?, 1, ?, ?)
        `).run(newId, name, pWidth, now(), now());
      }
    }

    refreshDefaultPrinter();
    const defaultPrinter = db.prepare('SELECT * FROM printers WHERE is_default = 1').get();
    const printers = db.prepare('SELECT * FROM printers ORDER BY is_default DESC, name').all();
    res.json({ success: true, defaultPrinter, printers });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/printers/:id
router.get('/:id', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const printer = db.prepare('SELECT * FROM printers WHERE id = ?').get(req.params.id);
    if (!printer) return res.status(404).json({ error: 'Printer not found' });
    res.json({ printer });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/printers — create
router.post('/', (req: Request, res: Response) => {
  try {
    const { name, connection_type, ip_address, port, usb_device_path, paper_width, is_default } = req.body;

    if (!name) return res.status(400).json({ error: 'name is required' });
    if (!connection_type) return res.status(400).json({ error: 'connection_type is required' });
    if (!['network', 'usb', 'webusb'].includes(connection_type)) {
      return res.status(400).json({ error: 'connection_type must be network | usb | webusb' });
    }
    if (connection_type === 'network' && !ip_address) {
      return res.status(400).json({ error: 'ip_address is required for network printers' });
    }

    const db = getDatabase();
    const id = uuidv4();

    // Check if this is the first printer - auto-set as default
    const existingPrinters = db.prepare('SELECT COUNT(*) as count FROM printers').get() as any;
    const isFirstPrinter = existingPrinters?.count === 0;
    
    // If new printer should be default, or it's the first printer, clear existing default first
    if (is_default || isFirstPrinter) {
      db.prepare('UPDATE printers SET is_default = 0').run();
    }

    db.prepare(`
      INSERT INTO printers (id, name, connection_type, ip_address, port, usb_device_path, paper_width, is_default, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, name, connection_type,
      ip_address || null,
      port || 9100,
      usb_device_path || null,
      paper_width || '80mm',
      (is_default || isFirstPrinter) ? 1 : 0,
      now(), now()
    );

    refreshDefaultPrinter();
    const printer = db.prepare('SELECT * FROM printers WHERE id = ?').get(id);
    res.status(201).json({ printer });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/printers/:id — update
router.put('/:id', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const existing = db.prepare('SELECT * FROM printers WHERE id = ?').get(req.params.id) as any;
    if (!existing) return res.status(404).json({ error: 'Printer not found' });

    const { name, connection_type, ip_address, port, usb_device_path, paper_width, is_default } = req.body;

    if (is_default) {
      db.prepare('UPDATE printers SET is_default = 0').run();
    }

    db.prepare(`
      UPDATE printers SET
        name = COALESCE(?, name),
        connection_type = COALESCE(?, connection_type),
        ip_address = ?,
        port = COALESCE(?, port),
        usb_device_path = ?,
        paper_width = COALESCE(?, paper_width),
        is_default = COALESCE(?, is_default),
        updated_at = ?
      WHERE id = ?
    `).run(
      name || null,
      connection_type || null,
      ip_address !== undefined ? (ip_address || null) : existing.ip_address,
      port || null,
      usb_device_path !== undefined ? (usb_device_path || null) : existing.usb_device_path,
      paper_width || null,
      is_default !== undefined ? (is_default ? 1 : 0) : null,
      now(), req.params.id
    );

    refreshDefaultPrinter();
    const printer = db.prepare('SELECT * FROM printers WHERE id = ?').get(req.params.id);
    res.json({ printer });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/printers/:id
router.delete('/:id', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const printer = db.prepare('SELECT * FROM printers WHERE id = ?').get(req.params.id);
    if (!printer) return res.status(404).json({ error: 'Printer not found' });

    db.prepare('DELETE FROM printers WHERE id = ?').run(req.params.id);
    refreshDefaultPrinter();
    res.json({ message: 'Printer deleted' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/printers/:id/set-default
router.post('/:id/set-default', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const printer = db.prepare('SELECT * FROM printers WHERE id = ?').get(req.params.id);
    if (!printer) return res.status(404).json({ error: 'Printer not found' });

    db.prepare('UPDATE printers SET is_default = 0').run();
    db.prepare('UPDATE printers SET is_default = 1, updated_at = ? WHERE id = ?').run(now(), req.params.id);

    refreshDefaultPrinter();
    res.json({ message: 'Default printer set', printer });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/printers/:id/set-kitchen — designate dedicated kitchen printer
router.post('/:id/set-kitchen', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const printer = db.prepare('SELECT * FROM printers WHERE id = ?').get(req.params.id);
    if (!printer) return res.status(404).json({ error: 'Printer not found' });

    db.prepare('UPDATE printers SET is_kitchen = 0').run();
    db.prepare('UPDATE printers SET is_kitchen = 1, updated_at = ? WHERE id = ?').run(now(), req.params.id);
    db.prepare(`
      INSERT INTO settings (key, value, updated_at) VALUES ('kitchen_printer_id', ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(req.params.id, now());

    refreshPrinters();
    const updated = db.prepare('SELECT * FROM printers ORDER BY is_default DESC, is_kitchen DESC, name').all();
    res.json({ message: 'Kitchen printer set', printer, printers: updated });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/printers/:id/remove-kitchen — clear kitchen printer role
router.post('/:id/remove-kitchen', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    db.prepare('UPDATE printers SET is_kitchen = 0, updated_at = ? WHERE id = ?').run(now(), req.params.id);
    db.prepare(`
      INSERT INTO settings (key, value, updated_at) VALUES ('kitchen_printer_id', '', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(now());

    refreshPrinters();
    const updated = db.prepare('SELECT * FROM printers ORDER BY is_default DESC, is_kitchen DESC, name').all();
    res.json({ message: 'Kitchen printer role cleared', printers: updated });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/printers/:id/test — send a test print job
router.post('/:id/test', async (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const printer = db.prepare('SELECT * FROM printers WHERE id = ?').get(req.params.id) as any;
    if (!printer) return res.status(404).json({ error: 'Printer not found' });

    console.log(`[Printer] Testing printer ${printer.name} (${printer.paper_width})`);
    const testData = buildTestPage(printer.paper_width, printer.name);
    let success = false;

    switch (printer.connection_type) {
      case 'network':
        if (!printer.ip_address) return res.status(400).json({ error: 'No IP address configured' });
        success = await printViaNetwork(printer.ip_address, printer.port || 9100, testData);
        break;
      case 'usb':
        success = await printViaUSB(testData, printer.name);
        break;
      case 'webusb':
        return res.json({ success: true, webusb: true, bytes: Array.from(testData) });
    }

    if (success) {
      res.json({ success: true, message: `Test receipt printed to ${printer.name}` });
    } else {
      res.status(502).json({ error: `Could not send print job to ${printer.name}. Check printer power and USB connection.` });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/printers/test-direct — send a test print job by name directly
router.post('/test-direct', async (req: Request, res: Response) => {
  try {
    const { printerName, paperWidth = '58mm' } = req.body;
    if (!printerName) return res.status(400).json({ error: 'printerName is required' });

    const testData = buildTestPage(paperWidth, printerName);
    const success = await printViaUSB(testData, printerName);

    if (success) {
      res.json({ success: true, message: `Test receipt printed to ${printerName}` });
    } else {
      res.status(502).json({ error: `Print to ${printerName} failed. Check printer connection.` });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Universal Order Resolver for Printing:
 * Resolves order by local id, order_number, cloud_order_id, or fallbackBillId.
 * If missing from SQLite, dynamically imports it from Supabase Cloud on-demand.
 */
async function resolveOrderForPrinting(db: any, orderIdOrNumber: any, fallbackBillId?: any): Promise<any> {
  const rawId = String(orderIdOrNumber || '').trim();
  const numId = Number(rawId);

  let order: any = null;

  // 1. Try finding locally in SQLite: id, order_number, cloud_order_id
  if (!isNaN(numId) && numId > 0) {
    order = db.prepare(`
      SELECT o.*, COALESCE(NULLIF(o.customer_name, ''), c.name) as customer_name, COALESCE(NULLIF(o.customer_phone, ''), c.phone) as customer_phone
      FROM orders o
      LEFT JOIN customers c ON o.customer_id = c.id
      WHERE o.id = ?
    `).get(numId);
  }

  if (!order && rawId) {
    order = db.prepare(`
      SELECT o.*, COALESCE(NULLIF(o.customer_name, ''), c.name) as customer_name, COALESCE(NULLIF(o.customer_phone, ''), c.phone) as customer_phone
      FROM orders o
      LEFT JOIN customers c ON o.customer_id = c.id
      WHERE o.order_number = ? OR o.cloud_order_id = ?
    `).get(rawId, rawId);
  }

  // 2. If billId was passed, check via bills table
  if (!order && fallbackBillId) {
    const bill = db.prepare('SELECT * FROM bills WHERE id = ?').get(fallbackBillId);
    if (bill && bill.order_id) {
      order = db.prepare(`
        SELECT o.*, COALESCE(NULLIF(o.customer_name, ''), c.name) as customer_name, COALESCE(NULLIF(o.customer_phone, ''), c.phone) as customer_phone
        FROM orders o
        LEFT JOIN customers c ON o.customer_id = c.id
        WHERE o.id = ? OR o.order_number = ? OR o.cloud_order_id = ?
      `).get(bill.order_id, String(bill.order_id), String(bill.order_id));
    }
  }

  // 3. If STILL not found in local SQLite, query Supabase Cloud on demand!
  if (!order && rawId) {
    try {
      const { getSupabaseClient, handleIncomingCloudOrder } = await import('../services/cloud-sync');
      const client = getSupabaseClient();
      if (client) {
        let cloudOrder: any = null;
        if (!isNaN(numId) && numId > 0) {
          const res = await client.from('orders').select('*').eq('id', numId).maybeSingle();
          cloudOrder = res.data;
        }
        if (!cloudOrder) {
          const res = await client.from('orders').select('*').eq('order_number', rawId).maybeSingle();
          cloudOrder = res.data;
        }

        if (cloudOrder) {
          console.log(`[Printer] Found order ${cloudOrder.order_number} (ID: ${cloudOrder.id}) in cloud! Importing into local database...`);
          await handleIncomingCloudOrder(cloudOrder, true);

          order = db.prepare(`
            SELECT o.*, COALESCE(NULLIF(o.customer_name, ''), c.name) as customer_name, COALESCE(NULLIF(o.customer_phone, ''), c.phone) as customer_phone
            FROM orders o
            LEFT JOIN customers c ON o.customer_id = c.id
            WHERE o.cloud_order_id = ? OR o.order_number = ?
          `).get(String(cloudOrder.id), String(cloudOrder.order_number || ''));

          if (!order) {
            // Direct memory fallback
            let parsedItems: any[] = [];
            if (Array.isArray(cloudOrder.items)) parsedItems = cloudOrder.items;
            else if (typeof cloudOrder.items === 'string') {
              try { parsedItems = JSON.parse(cloudOrder.items); } catch {}
            }
            order = {
              id: cloudOrder.id,
              order_number: cloudOrder.order_number || `ONL-${cloudOrder.id}`,
              customer_name: cloudOrder.customer_name,
              customer_phone: cloudOrder.customer_phone,
              delivery_address: cloudOrder.delivery_address,
              subtotal: Math.max(0, Number(cloudOrder.total || 0) - Number(cloudOrder.delivery_fee || 0)),
              total: Number(cloudOrder.total || 0),
              delivery_charge: Number(cloudOrder.delivery_fee || 0),
              delivery_fee: Number(cloudOrder.delivery_fee || 0),
              type: cloudOrder.order_type || (cloudOrder.delivery_address ? 'delivery' : 'takeaway'),
              status: cloudOrder.status || 'pending',
              order_source: cloudOrder.source || cloudOrder.order_source || 'online',
              created_at: cloudOrder.created_at,
              items: parsedItems.map((it: any, idx: number) => ({
                id: idx + 1,
                order_id: cloudOrder.id,
                product_name: it.name || it.title || it.product_name || 'Item',
                unit_price: Number(it.price || it.unit_price || 0),
                quantity: Number(it.qty || it.quantity || 1),
                total: Number(it.subtotal || (Number(it.price || 0) * Number(it.qty || 1))),
                variant_selection: it.selected_variation ? (typeof it.selected_variation === 'object' ? it.selected_variation.name : String(it.selected_variation)) : (it.variant_selection || null),
                special_instructions: it.special_instructions || null,
              })),
            };
          }
        }
      }
    } catch (cloudErr: any) {
      console.warn('[Printer] Cloud lookup fallback error:', cloudErr?.message);
    }
  }

  if (!order) return null;

  // Ensure items are attached using order.id
  if (!order.items || order.items.length === 0) {
    const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
    if (items && items.length > 0) {
      order.items = items;
    } else if (order.cloud_order_id) {
      const itemsByCloud = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.cloud_order_id);
      if (itemsByCloud && itemsByCloud.length > 0) {
        order.items = itemsByCloud;
      }
    }
  }

  // Parse items_included if items still empty
  if ((!order.items || order.items.length === 0) && order.items_included) {
    try {
      const parsed = JSON.parse(order.items_included);
      if (Array.isArray(parsed)) {
        order.items = parsed.map((it: any, idx: number) => ({
          id: idx + 1,
          order_id: order.id,
          product_name: it.name || it.product_name || 'Item',
          quantity: it.quantity || it.qty || 1,
          unit_price: it.unit_price || it.price || 0,
          total: (it.quantity || 1) * (it.unit_price || it.price || 0),
        }));
      }
    } catch {}
  }

  // Ensure table name is populated if table_id exists
  if (order.table_id && !order.table) {
    const table = db.prepare('SELECT * FROM tables WHERE id = ?').get(order.table_id);
    if (table) {
      order.table = { name: table.number };
    }
  }

  return order;
}

// POST /api/printers/print-bill — print bill via backend (desktop app)
router.post('/print-bill', async (req: Request, res: Response) => {
  try {
    const { billId, orderId } = req.body;
    console.log('[Print Bill] Request:', { billId, orderId });
    
    if (!billId && !orderId) {
      console.log('[Print Bill] Error: No billId or orderId provided');
      return res.status(400).json({ error: 'billId or orderId is required' });
    }

    const db = getDatabase();
    const printer = db.prepare('SELECT * FROM printers WHERE is_default = 1').get();
    console.log('[Print Bill] Default printer:', printer);
    
    if (!printer) {
      console.log('[Print Bill] Error: No default printer');
      return res.status(400).json({ error: 'No default printer configured. Add a printer in Settings.' });
    }

    // Resolve order with universal lookup (local id, order_number, cloud_order_id, cloud on-demand)
    const order = await resolveOrderForPrinting(db, orderId || billId, billId);
    if (!order) {
      console.log('[Print Bill] Error: Order not found');
      return res.status(404).json({ error: 'Order not found' });
    }

    // Get bill data
    let bill: any;
    if (billId) {
      bill = db.prepare('SELECT * FROM bills WHERE id = ?').get(billId);
    }
    if (!bill && order.id) {
      bill = db.prepare('SELECT b.* FROM bills b WHERE b.order_id = ?').get(order.id);
    }

    // If order has no bill row yet (e.g. online order from menu), create synthetic bill object
    if (!bill) {
      bill = {
        id: `auto_${order.id}`,
        order_id: order.id,
        bill_number: order.order_number,
        subtotal: order.subtotal || order.total,
        total: order.total,
        tax_amount: order.tax_amount || 0,
        discount_amount: order.discount_amount || 0,
        delivery_charge: order.delivery_charge || order.delivery_fee || 0,
        balance: 0,
        paid_amount: order.total,
        payment_status: 'paid',
        payment_details: [{ method: order.order_source === 'online' ? 'Online' : 'Cash', amount: order.total }],
        created_at: order.created_at,
      };
    }
    console.log('[Print Bill] Bill:', bill.bill_number, 'Total:', bill.total);
    console.log('[Print Bill] Order:', order.order_number);

    // Fetch order items
    const items: any[] = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
    order.items = items;
    console.log('[Print Bill] Items count:', items.length);

    // Fetch table info
    if (order.table_id) {
      const table: any = db.prepare('SELECT * FROM tables WHERE id = ?').get(order.table_id);
      if (table) {
        order.table = { name: table.number };
      }
    }

    // Helper to fetch live business info from database settings
    const getSetting = (k: string): string => {
      try {
        const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(k) as any;
        return (row?.value || '').trim();
      } catch {
        return '';
      }
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
    const billTemplate = db.prepare("SELECT value FROM settings WHERE key = 'bill_template'").get() as any;
    const copySetting = db.prepare("SELECT value FROM settings WHERE key = 'receipt_copies'").get() as any;
    const copyType = req.body.copyType || copySetting?.value || 'customer';
    console.log('[Print Bill] Business:', business.name, 'Template:', billTemplate?.value || 'classic', 'CopyType:', copyType);

    // Use printReceipt with 80mm Pizza Mafia format & dual copy support
    console.log('[Print Bill] Calling printReceipt...');
    const success = await printReceipt(order, bill, business, billTemplate?.value || 'classic', copyType);
    console.log('[Print Bill] Print result:', success);

    if (success) {
      res.json({ success: true });
    } else {
      res.status(502).json({ error: 'Print failed. Check printer connection and settings.' });
    }
  } catch (error: any) {
    console.error('[Print Bill] Error:', error);
    console.error('[Print Bill] Error stack:', error.stack);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/printers/print-kot — print KOT via backend (desktop app)
router.post('/print-kot', async (req: Request, res: Response) => {
  try {
    const { orderId, stationName, items } = req.body;
    
    if (!orderId) {
      return res.status(400).json({ error: 'orderId is required' });
    }

    const db = getDatabase();
    const printer = getKitchenPrinter() || getPrinterConfig();
    
    if (!printer) {
      return res.status(400).json({ error: 'No kitchen or default printer configured. Add a printer in Settings.' });
    }

    const order = await resolveOrderForPrinting(db, orderId);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const orderItems: any[] = order.items || db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
    
    // Fetch table info if available
    let tableName: string | undefined;
    if (order.table_id) {
      const table: any = db.prepare('SELECT * FROM tables WHERE id = ?').get(order.table_id);
      if (table) {
        order.table = { name: table.number };
      }
    }

    // Use existing printKOT function
    const kotItems = items || orderItems;
    const station = stationName || 'Kitchen';
    const success = await printKOT(order, kotItems, station);

    if (success) {
      res.json({ success: true });
    } else {
      res.status(502).json({ error: 'KOT print failed. Check printer connection.' });
    }
  } catch (error: any) {
    console.error('[Print KOT] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/printers/print-order — one-click print for order (receipt, KOT, or both)
router.post('/print-order', async (req: Request, res: Response) => {
  try {
    const { orderId, printType = 'bill', delivery_charge, delivery_fee } = req.body;
    const overrideFee = delivery_charge !== undefined || delivery_fee !== undefined
      ? Math.max(0, Number(delivery_charge ?? delivery_fee ?? 0))
      : null;
    if (!orderId) {
      return res.status(400).json({ error: 'orderId is required' });
    }

    const db = getDatabase();
    const printer = db.prepare('SELECT * FROM printers WHERE is_default = 1').get();
    if (!printer) {
      return res.status(400).json({ error: 'No default printer configured. Please configure a printer in Settings.' });
    }

    const order = await resolveOrderForPrinting(db, orderId);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    if (overrideFee !== null) {
      const oldFee = Number(order.delivery_charge || order.delivery_fee || 0);
      const diff = overrideFee - oldFee;
      order.delivery_charge = overrideFee;
      order.delivery_fee = overrideFee;
      order.total = Math.max(0, Number(order.total || 0) + diff);
    }

    const items: any[] = order.items || db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
    order.items = items;

    if (order.table_id && !order.table) {
      const table: any = db.prepare('SELECT * FROM tables WHERE id = ?').get(order.table_id);
      if (table) order.table = { name: table.number };
    }

    let billSuccess = false;
    let kotSuccess = false;

    // 1. If bill / receipt requested
    if (printType === 'bill' || printType === 'receipt' || printType === 'both') {
      let bill = db.prepare('SELECT b.* FROM bills b WHERE b.order_id = ?').get(order.id) as any;
      if (!bill) {
        bill = {
          id: `auto_${order.id}`,
          order_id: order.id,
          bill_number: order.order_number,
          subtotal: order.subtotal || order.total,
          total: order.total,
          tax_amount: order.tax_amount || 0,
          discount_amount: order.discount_amount || 0,
          delivery_charge: order.delivery_charge || order.delivery_fee || 0,
          balance: 0,
          paid_amount: order.total,
          payment_status: 'paid',
          payment_details: [{ method: order.order_source === 'online' ? 'Online' : 'Cash', amount: order.total }],
          created_at: order.created_at,
        };
      }

      const getSetting = (k: string): string => {
        try {
          const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(k) as any;
          return (row?.value || '').trim();
        } catch {
          return '';
        }
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
      const billTemplate = db.prepare("SELECT value FROM settings WHERE key = 'bill_template'").get() as any;
      const copySetting = db.prepare("SELECT value FROM settings WHERE key = 'receipt_copies'").get() as any;
      const copyType = req.body.copyType || copySetting?.value || 'customer';

      billSuccess = await printReceipt(order, bill, business, billTemplate?.value || 'classic', copyType);
    }

    // 2. If KOT requested
    if (printType === 'kot' || printType === 'both') {
      const station = order.order_source === 'online' ? 'Kitchen (Online)' : 'Kitchen';
      kotSuccess = await printKOT(order, items, station);
    }

    const overallSuccess = printType === 'both' ? (billSuccess || kotSuccess) : (billSuccess || kotSuccess);
    if (overallSuccess) {
      res.json({
        success: true,
        billSuccess,
        kotSuccess,
        message: printType === 'kot' ? 'KOT sent to printer' : (printType === 'both' ? 'Receipt and KOT sent to printer' : 'Receipt sent to printer')
      });
    } else {
      res.status(502).json({ error: 'Print failed. Check printer connection and cable/network.' });
    }
  } catch (error: any) {
    console.error('[Print Order] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

export const printerRoutes = router;
