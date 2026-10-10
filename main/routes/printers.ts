import { Router, Request, Response } from 'express';
import { getDatabase, now } from '../db';
import { v4 as uuidv4 } from 'uuid';
import { printViaNetwork, printViaUSB, buildTestPage, printReceipt, printKOT, detectConnectedPrinters } from '../printers/thermal';

const router = Router();

// GET /api/printers — list all
router.get('/', (_req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const printers = db.prepare('SELECT * FROM printers ORDER BY is_default DESC, name').all();
    res.json({ printers });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/printers/detect — detect connected USB/network printers
router.get('/detect', async (_req: Request, res: Response) => {
  try {
    const printers = await detectConnectedPrinters();
    console.log('[Printer] Detected printers:', printers);
    res.json({ printers });
  } catch (error: any) {
    console.error('[Printer] Detection error:', error);
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

    res.json({ message: 'Default printer set' });
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

    const testData = buildTestPage(printer.paper_width);
    let success = false;

    switch (printer.connection_type) {
      case 'network':
        if (!printer.ip_address) return res.status(400).json({ error: 'No IP address configured' });
        success = await printViaNetwork(printer.ip_address, printer.port || 9100, testData);
        break;
      case 'usb':
        // node-thermal-printer auto-detects USB printers, no path needed
        success = await printViaUSB(testData, undefined);
        break;
      case 'webusb':
        // WebUSB is handled entirely in the browser; return the bytes for the frontend to send
        return res.json({ success: true, webusb: true, bytes: Array.from(testData) });
    }

    if (success) {
      res.json({ success: true });
    } else {
      res.status(502).json({ error: 'Printer did not respond or print failed' });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

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

    // Get bill and order data
    let bill: any;
    if (billId) {
      bill = db.prepare('SELECT * FROM bills WHERE id = ?').get(billId);
    } else {
      bill = db.prepare('SELECT b.* FROM bills b WHERE b.order_id = ?').get(orderId);
    }

    let order: any;
    if (bill) {
      order = db.prepare('SELECT * FROM orders WHERE id = ?').get(bill.order_id);
    } else if (orderId) {
      order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    }

    if (!order) {
      console.log('[Print Bill] Error: Order not found');
      return res.status(404).json({ error: 'Order not found' });
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

    // Fetch business settings for bill template
    const businessName = db.prepare("SELECT value FROM settings WHERE key = 'business_name'").get() as any;
    const businessAddress = db.prepare("SELECT value FROM settings WHERE key = 'address'").get() as any;
    const businessPhone = db.prepare("SELECT value FROM settings WHERE key = 'phone'").get() as any;
    const gstin = db.prepare("SELECT value FROM settings WHERE key = 'gstin'").get() as any;
    const billTemplate = db.prepare("SELECT value FROM settings WHERE key = 'bill_template'").get() as any;

    const business = {
      name: businessName?.value || 'Store',
      address: businessAddress?.value || '',
      phone: businessPhone?.value || '',
      gstin: gstin?.value || '',
    };
    console.log('[Print Bill] Business:', business.name, 'Template:', billTemplate?.value || 'compact');

    // Use existing printReceipt function with template support
    console.log('[Print Bill] Calling printReceipt...');
    const success = await printReceipt(order, bill, business, billTemplate?.value || 'compact');
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
    const printer = db.prepare('SELECT * FROM printers WHERE is_default = 1').get();
    
    if (!printer) {
      return res.status(400).json({ error: 'No default printer configured. Add a printer in Settings.' });
    }

    const order: any = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Fetch order items from database
    const orderItems: any[] = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId);
    
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
    const { orderId, printType = 'bill' } = req.body;
    if (!orderId) {
      return res.status(400).json({ error: 'orderId is required' });
    }

    const db = getDatabase();
    const printer = db.prepare('SELECT * FROM printers WHERE is_default = 1').get();
    if (!printer) {
      return res.status(400).json({ error: 'No default printer configured. Please configure a printer in Settings.' });
    }

    const order: any = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const items: any[] = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId);
    order.items = items;

    if (order.table_id) {
      const table: any = db.prepare('SELECT * FROM tables WHERE id = ?').get(order.table_id);
      if (table) order.table = { name: table.number };
    }

    let billSuccess = false;
    let kotSuccess = false;

    // 1. If bill / receipt requested
    if (printType === 'bill' || printType === 'receipt' || printType === 'both') {
      let bill = db.prepare('SELECT b.* FROM bills b WHERE b.order_id = ?').get(orderId) as any;
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

      const businessName = db.prepare("SELECT value FROM settings WHERE key = 'business_name'").get() as any;
      const businessAddress = db.prepare("SELECT value FROM settings WHERE key = 'address'").get() as any;
      const businessPhone = db.prepare("SELECT value FROM settings WHERE key = 'phone'").get() as any;
      const gstin = db.prepare("SELECT value FROM settings WHERE key = 'gstin'").get() as any;
      const billTemplate = db.prepare("SELECT value FROM settings WHERE key = 'bill_template'").get() as any;

      const business = {
        name: businessName?.value || 'Store',
        address: businessAddress?.value || '',
        phone: businessPhone?.value || '',
        gstin: gstin?.value || '',
      };

      billSuccess = await printReceipt(order, bill, business, billTemplate?.value || 'compact');
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
