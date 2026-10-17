import * as net from 'net';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync, exec } from 'child_process';
import { getDatabase } from '../db';

let defaultPrinter: any = null;

export interface PrinterInfo {
  name: string;
  make: string;
  model: string;
  connectionType: 'usb' | 'network' | 'bluetooth';
  deviceUri: string;
  driver?: string;
  status: 'idle' | 'printing' | 'offline';
  isDefault: boolean;
}

export async function detectConnectedPrinters(): Promise<PrinterInfo[]> {
  const printers: PrinterInfo[] = [];

  if (process.platform === 'darwin') {
    return await detectMacOSPrinters();
  }

  if (process.platform === 'win32') {
    return detectWindowsPrinters();
  }

  if (process.platform === 'linux') {
    return detectLinuxPrinters();
  }

  return printers;
}

async function detectMacOSPrinters(): Promise<PrinterInfo[]> {
  const printers: PrinterInfo[] = [];

  try {
    const lpStatOutput = execSync('lpstat -v 2>/dev/null', { encoding: 'utf8' });
    const lines = lpStatOutput.split('\n');

    const printerNames = new Set<string>();

    for (const line of lines) {
      const match = line.match(/device for (\S+):\s*(.+)/);
      if (match) {
        const name = match[1];
        const uri = match[2].trim();

        if (!printerNames.has(name)) {
          printerNames.add(name);

          const makeModel = await getMacOSPrinterDetails(name);
          const isDefault = await isMacOSDefaultPrinter(name);

          printers.push({
            name,
            make: makeModel.make,
            model: makeModel.model,
            connectionType: uri.includes('usb://') ? 'usb' :
                          uri.includes('socket://') || uri.includes('ipp://') ? 'network' : 'usb',
            deviceUri: uri,
            status: 'idle',
            isDefault
          });
        }
      }
    }
  } catch (err) {
    console.log('[Printer] Could not detect macOS printers:', err);
  }

  return printers;
}

async function getMacOSPrinterDetails(name: string): Promise<{ make: string; model: string }> {
  let make = 'Unknown';
  let model = 'Thermal Printer';

  try {
    const info = execSync(`lpoptions -p "${name}" -l 2>/dev/null`, { encoding: 'utf8' });

    const lower = info.toLowerCase();

    if (lower.includes('epson') || name.toLowerCase().includes('tm-')) {
      make = 'Epson';
      model = extractEpsonModel(name, info);
    } else if (lower.includes('xprinter') || name.toLowerCase().includes('xprinter')) {
      make = 'Xprinter';
      model = name.includes('80') ? 'Xprinter 80mm' : 'Xprinter 58mm';
    } else if (lower.includes('star') || name.toLowerCase().includes('tsp')) {
      make = 'Star';
      model = 'TSP Thermal';
    } else if (lower.includes('zjiang') || name.toLowerCase().includes('zj')) {
      make = 'Zjiang';
      model = '58mm Thermal';
    } else if (lower.includes('zebra')) {
      make = 'Zebra';
      model = 'Zebra Thermal';
    } else if (lower.includes('brother')) {
      make = 'Brother';
      model = 'Brother Thermal';
    } else if (lower.includes('canon')) {
      make = 'Canon';
      model = 'Canon Printer';
    } else if (lower.includes('hp') || lower.includes('hewlett')) {
      make = 'HP';
      model = 'HP Printer';
    } else {
      const nameLower = name.toLowerCase();
      if (nameLower.includes('58') || nameLower.includes('thermal')) {
        make = 'Generic';
        model = '58mm Thermal Printer';
      } else if (nameLower.includes('80')) {
        make = 'Generic';
        model = '80mm Thermal Printer';
      }
    }
  } catch {
    const nameLower = name.toLowerCase();
    if (nameLower.includes('epson') || nameLower.includes('tm-')) {
      make = 'Epson';
      model = 'TM Series';
    } else if (nameLower.includes('xprinter')) {
      make = 'Xprinter';
      model = nameLower.includes('80') ? 'Xprinter 80mm' : 'Xprinter 58mm';
    }
  }

  return { make, model };
}

function extractEpsonModel(name: string, info: string): string {
  const lower = name.toLowerCase();
  if (lower.includes('tm-m30')) return 'TM-m30';
  if (lower.includes('tm-t88')) return 'TM-T88';
  if (lower.includes('tm-t82')) return 'TM-T82';
  if (lower.includes('tm-t20')) return 'TM-T20';
  if (lower.includes('tm-t60')) return 'TM-T60';
  if (lower.includes('tm-l90')) return 'TM-L90';
  if (lower.includes('tm-h600')) return 'TM-H600';
  if (lower.includes('tm-u')) return 'TM-U Series';
  if (lower.includes('tm-')) return 'TM Series';
  return 'Epson Thermal';
}

async function isMacOSDefaultPrinter(name: string): Promise<boolean> {
  try {
    const defaultPrinter = execSync('lpstat -d 2>/dev/null', { encoding: 'utf8' });
    return defaultPrinter.includes(name);
  } catch {
    return false;
  }
}

function detectWindowsPrinters(): PrinterInfo[] {
  const printers: PrinterInfo[] = [];

  try {
    const psCmd = `powershell -NoProfile -Command "Get-CimInstance Win32_Printer | Select-Object Name, Default, PrinterStatus, DriverName | ConvertTo-Json"`;
    const output = execSync(psCmd, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
    if (!output || !output.trim()) return printers;

    const parsed = JSON.parse(output.trim());
    const list = Array.isArray(parsed) ? parsed : [parsed];

    for (const item of list) {
      if (!item || !item.Name) continue;
      const name = String(item.Name).trim();
      const isDefault = Boolean(item.Default);
      const status = item.PrinterStatus === 0 || item.PrinterStatus === 3 ? 'idle' : 'offline';
      const driver = String(item.DriverName || '');

      const makeModel = detectWindowsMakeModel(name, driver);

      printers.push({
        name,
        make: makeModel.make,
        model: makeModel.model,
        connectionType: 'usb',
        deviceUri: name,
        driver,
        status,
        isDefault
      });
    }
  } catch (err) {
    console.log('[Printer] Could not detect Windows printers:', err);
  }

  return printers;
}

function detectWindowsMakeModel(name: string, driver: string): { make: string; model: string } {
  let make = 'Unknown';
  let model = 'Thermal Printer';

  const lower = (name + ' ' + driver).toLowerCase();

  if (lower.includes('rongta') || lower.includes('80normal') || lower.includes('80series') || lower.includes('58normal')) {
    make = 'Rongta';
    model = lower.includes('58') ? 'Rongta 58mm' : 'Rongta 80mm';
  } else if (lower.includes('epson') || name.toLowerCase().includes('tm-')) {
    make = 'Epson';
    model = name.includes('TM-m30') ? 'TM-m30' :
            name.includes('TM-T88') ? 'TM-T88' :
            name.includes('TM-T82') ? 'TM-T82' :
            name.includes('TM-T20') ? 'TM-T20' : 'TM Series';
  } else if (lower.includes('xprinter')) {
    make = 'Xprinter';
    model = lower.includes('80') ? 'Xprinter 80mm' : 'Xprinter 58mm';
  } else if (lower.includes('star') || lower.includes('tsp')) {
    make = 'Star';
    model = 'TSP Thermal';
  } else if (lower.includes('zjiang')) {
    make = 'Zjiang';
    model = '58mm Thermal';
  } else if (lower.includes('zebra')) {
    make = 'Zebra';
    model = 'Zebra Thermal';
  } else if (lower.includes('brother')) {
    make = 'Brother';
    model = 'Brother Thermal';
  } else if (lower.includes('58') || lower.includes('thermal')) {
    make = 'Generic';
    model = '58mm Thermal';
  } else if (lower.includes('80')) {
    make = 'Generic';
    model = '80mm Thermal';
  }

  return { make, model };
}

function detectLinuxPrinters(): PrinterInfo[] {
  const printers: PrinterInfo[] = [];

  try {
    const output = execSync('lpstat -v 2>/dev/null', { encoding: 'utf8' });
    const lines = output.split('\n');

    for (const line of lines) {
      const match = line.match(/device for (\S+):\s*(.+)/);
      if (match) {
        const name = match[1];
        const uri = match[2].trim();

        printers.push({
          name,
          make: 'Generic',
          model: 'Thermal Printer',
          connectionType: uri.includes('/dev/usb') ? 'usb' : 'network',
          deviceUri: uri,
          status: 'idle',
          isDefault: false
        });
      }
    }
  } catch {
    console.log('[Printer] Could not detect Linux printers');
  }

  return printers;
}

export async function initPrinter(): Promise<void> {
  try {
    const db = getDatabase();
    defaultPrinter = db.prepare('SELECT * FROM printers WHERE is_default = 1').get();

    // Auto-detect printers on system
    const detected = await detectConnectedPrinters();
    console.log(`[Printer] Found ${detected.length} system printers:`, detected.map(p => p.name));

    // Look for thermal or default printer
    const realPrinter = detected.find(p => p.isDefault) || detected.find(p => p.make !== 'Unknown') || detected[0];

    if (realPrinter) {
      if (!defaultPrinter) {
        const id = 'printer-' + Date.now();
        db.prepare(`
          INSERT INTO printers (id, name, connection_type, paper_width, is_default, created_at, updated_at)
          VALUES (?, ?, 'usb', ?, 1, datetime('now'), datetime('now'))
        `).run(id, realPrinter.name, realPrinter.model.includes('58') ? '58mm' : '80mm');
        defaultPrinter = db.prepare('SELECT * FROM printers WHERE is_default = 1').get();
        console.log(`[Printer] Auto-configured default printer: ${realPrinter.name}`);
      } else if (defaultPrinter.name === 'Thermal Printer' && realPrinter.name !== 'Thermal Printer') {
        db.prepare("UPDATE printers SET name = ?, paper_width = ?, updated_at = datetime('now') WHERE id = ?")
          .run(realPrinter.name, realPrinter.model.includes('58') ? '58mm' : '80mm', defaultPrinter.id);
        defaultPrinter = db.prepare('SELECT * FROM printers WHERE is_default = 1').get();
        console.log(`[Printer] Updated default printer to real printer: ${realPrinter.name}`);
      }
    }

    if (defaultPrinter) {
      console.log(`[Printer] Default printer: ${defaultPrinter.name} (${defaultPrinter.connection_type})`);
    } else {
      console.log('[Printer] No default printer configured');
    }
  } catch (error) {
    console.log('[Printer] Printer initialization skipped (database not ready):', error);
  }
}

export async function printReceipt(order: any, bill: any, business?: any, template?: string): Promise<boolean> {
  try {
    console.log('[Printer] printReceipt called, template:', template);
    const printer = getPrinterConfig();
    if (!printer) {
      console.log('[Printer] No printer configured');
      return false;
    }
    console.log('[Printer] Using printer:', printer.name, printer.connection_type);
    
    const paperWidth = printer.paper_width || '80mm';
    const cols = paperWidth === '58mm' ? 42 : 48;
    
    let data: Buffer;
    try {
      data = formatReceipt(order, bill, business, template, cols);
      console.log('[Printer] Receipt data length:', data.length, 'bytes');
      console.log('[Printer] First 100 bytes:', Array.from(data.slice(0, 100)).map(b => b.toString(16)).join(' '));
    } catch (err) {
      console.error('[Printer] formatReceipt failed:', err);
      throw err;
    }
    
    return await dispatchPrint(printer, data);
  } catch (error: any) {
    console.error('[Printer] Print error:', error);
    return false;
  }
}

export async function printKOT(order: any, items: any[], stationName: string): Promise<boolean> {
  try {
    console.log('[Printer] printKOT called, items count:', items?.length || 0);
    const printer = getPrinterConfig();
    if (!printer) {
      console.log('[Printer] No printer configured');
      return false;
    }
    console.log('[Printer] Using printer:', printer.name, printer.connection_type);
    
    const paperWidth = printer.paper_width || '80mm';
    const cols = paperWidth === '58mm' ? 42 : 48;
    
    const data = formatKOT(order, items, stationName, cols);
    console.log('[Printer] KOT data length:', data.length, 'bytes');
    return await dispatchPrint(printer, data);
  } catch (error: any) {
    console.error('[Printer] KOT print error:', error);
    return false;
  }
}

async function dispatchPrint(printer: any, data: Buffer): Promise<boolean> {
  switch (printer.connection_type) {
    case 'network':
      return await printViaNetwork(printer.ip_address, printer.port || 9100, data);
    case 'usb':
      return await printViaUSB(data, printer.name);
    case 'webusb':
      console.log('[Printer] WebUSB printer — not supported in Electron');
      return false;
    default:
      console.log(`[Printer] Unsupported connection type: ${printer.connection_type}`);
      return false;
  }
}

function getPrinterConfig(): any {
  if (defaultPrinter) return defaultPrinter;
  const db = getDatabase();
  return db.prepare('SELECT * FROM printers WHERE is_default = 1').get();
}

function formatReceipt(order: any, bill: any, business?: any, template?: string, cols: number = 48): Buffer {
  console.log('[Printer] formatReceipt - template:', template);
  console.log('[Printer] formatReceipt - order:', order?.order_number, 'bill:', bill?.bill_number);
  console.log('[Printer] formatReceipt - items count:', order?.items?.length || 0, 'cols:', cols);
  
  const tpl = template || 'compact';
  const biz = business || { name: 'Store', address: '', phone: '', gstin: '' };

  try {
    switch (tpl) {
      case 'classic':
        return formatClassicReceipt(order, bill, biz, cols);
      case 'detailed':
        return formatDetailedReceipt(order, bill, biz, cols);
      default:
        return formatCompactReceipt(order, bill, biz, cols);
    }
  } catch (err) {
    console.error('[Printer] formatReceipt error:', err);
    throw err;
  }
}

function formatCompactReceipt(order: any, bill: any, biz: any, cols: number = 48): Buffer {
  const lines: string[] = [];
  const date = new Date(order.created_at);
  
  const bar = '='.repeat(cols);
  const dash = '-'.repeat(cols);
  
  const itemNameLen = cols === 42 ? 22 : 28;
  const amtLen = cols === 42 ? 10 : 10;

  lines.push('{INIT}');
  lines.push('{CENTER}{BOLD}' + (biz.name || 'Store') + '{/BOLD}{/CENTER}');
  lines.push(bar);
  lines.push('Bill #: ' + (bill.bill_number || order.order_number));
  lines.push('Date: ' + date.toLocaleDateString() + ' ' + date.toLocaleTimeString());
  lines.push(dash);
  lines.push('Item' + ' '.repeat(itemNameLen) + 'Qty    Amount');
  lines.push(dash);

  if (order.items) {
    for (const item of order.items) {
      const name = truncate(item.product_name, itemNameLen);
      const qty = String(item.quantity).padEnd(5);
      const taxRate = getTaxRate(item);
      const taxStr = taxRate > 0 ? (taxRate + '%').padEnd(5) : '     ';
      const amt = formatCurrency(item.total);
      lines.push(name + qty + taxStr + rightAlign(amt, amtLen));

      const addons = parseAddons(item.addons);
      for (const addon of addons) {
        const addonName = truncate('  + ' + addon.name, itemNameLen + 4);
        const addonPrice = addon.price ? formatCurrency(addon.price) : '';
        lines.push(addonName + rightAlign(addonPrice, cols - itemNameLen - 8));
      }
      if (item.special_instructions) {
        lines.push('  Note: ' + truncate(item.special_instructions, cols - 8));
      }
    }
  }

  lines.push(dash);
  lines.push('Subtotal' + rightAlign(formatCurrency(bill.subtotal), cols - 8));
  if (bill.discount_amount > 0) {
    lines.push('Discount' + rightAlign('-' + formatCurrency(bill.discount_amount), cols - 8));
  }
  lines.push('Tax' + rightAlign(formatCurrency(bill.tax_amount), cols - 3));
  lines.push('{BOLD}TOTAL' + rightAlign(formatCurrency(bill.total), cols - 5) + '{/BOLD}');

  if (bill.payment_details) {
    lines.push(dash);
    try {
      const payments = typeof bill.payment_details === 'string' ? JSON.parse(bill.payment_details) : bill.payment_details;
      if (payments && Array.isArray(payments)) {
        for (const payment of payments) {
          if (payment && payment.method) {
            lines.push(payment.method + rightAlign(formatCurrency(payment.amount), cols - payment.method.length));
          }
        }
      }
    } catch {}
  }

  lines.push(bar);
  if (biz.address) lines.push(biz.address);
  if (biz.phone) lines.push('Ph: ' + biz.phone);
  if (biz.gstin) lines.push('GSTIN: ' + biz.gstin);
  lines.push('{CENTER}Thank you!{/CENTER}');
  lines.push('{CUT}');

  return buildEscPos(lines);
}

function formatClassicReceipt(order: any, bill: any, biz: any, cols: number = 48): Buffer {
  const lines: string[] = [];
  const date = new Date(order.created_at);
  
  const bar = '='.repeat(cols);
  const dash = '-'.repeat(cols);
  
  const itemNameLen = cols === 42 ? 22 : 28;

  lines.push('{INIT}');
  lines.push('{CENTER}{BOLD}' + (biz.name || 'Store') + '{/BOLD}{/CENTER}');
  lines.push(bar);
  lines.push('Bill #: ' + (bill.bill_number || order.order_number));
  lines.push('Date: ' + date.toLocaleDateString() + ' ' + date.toLocaleTimeString());
  lines.push(dash);
  lines.push('Item' + ' '.repeat(itemNameLen) + 'Qty    Amount');
  lines.push(dash);

  if (order.items) {
    for (const item of order.items) {
      const name = truncate(item.product_name, itemNameLen);
      const qty = String(item.quantity).padEnd(5);
      const taxRate = getTaxRate(item);
      const taxStr = taxRate > 0 ? (taxRate + '%').padEnd(5) : '     ';
      const amt = formatCurrency(item.total);
      lines.push(name + qty + taxStr + rightAlign(amt, 10));

      const addons = parseAddons(item.addons);
      for (const addon of addons) {
        const addonName = truncate('  + ' + addon.name, itemNameLen + 4);
        const addonPrice = addon.price ? formatCurrency(addon.price) : '';
        lines.push(addonName + rightAlign(addonPrice, cols - itemNameLen - 8));
      }
      if (item.special_instructions) {
        lines.push('  Note: ' + truncate(item.special_instructions, cols - 8));
      }
    }
  }

  lines.push(dash);
  lines.push('Subtotal' + rightAlign(formatCurrency(bill.subtotal), cols - 8));
  if (bill.discount_amount > 0) {
    lines.push('Discount' + rightAlign('-' + formatCurrency(bill.discount_amount), cols - 8));
  }
  lines.push('Tax' + rightAlign(formatCurrency(bill.tax_amount), cols - 3));
  lines.push('{BOLD}TOTAL' + rightAlign(formatCurrency(bill.total), cols - 5) + '{/BOLD}');

  if (bill.payment_details) {
    lines.push(dash);
    try {
      const payments = typeof bill.payment_details === 'string' ? JSON.parse(bill.payment_details) : bill.payment_details;
      if (payments && Array.isArray(payments)) {
        for (const payment of payments) {
          if (payment && payment.method) {
            lines.push(payment.method + rightAlign(formatCurrency(payment.amount), cols - payment.method.length));
          }
        }
      }
    } catch {}
  }

  lines.push(bar);
  if (biz.address) lines.push(biz.address);
  if (biz.phone) lines.push('Ph: ' + biz.phone);
  if (biz.gstin) lines.push('GSTIN: ' + biz.gstin);
  lines.push('{CENTER}Thank you!{/CENTER}');
  lines.push('{CUT}');

  return buildEscPos(lines);
}

function formatDetailedReceipt(order: any, bill: any, biz: any, cols: number = 48): Buffer {
  const lines: string[] = [];
  const date = new Date(order.created_at);
  
  const bar = '='.repeat(cols);
  const dash = '-'.repeat(cols);
  
  const itemNameLen = cols === 42 ? 22 : 28;

  lines.push('{INIT}');
  lines.push('{CENTER}{BOLD}' + (biz.name || 'Store').toUpperCase() + '{/BOLD}{/CENTER}');
  lines.push(bar);
  lines.push('{CENTER}TAX INVOICE{/CENTER}');
  lines.push(bar);
  lines.push('Invoice #: ' + (bill.bill_number || order.order_number));
  lines.push('Date: ' + date.toLocaleDateString());
  lines.push('Time: ' + date.toLocaleTimeString());
  lines.push(dash);
  lines.push('Item' + ' '.repeat(itemNameLen) + 'Qty    Amount');
  lines.push(dash);

  if (order.items) {
    for (const item of order.items) {
      const name = truncate(item.product_name, itemNameLen);
      const qty = String(item.quantity).padEnd(5);
      const taxRate = getTaxRate(item);
      const taxStr = taxRate > 0 ? (taxRate + '%').padEnd(5) : '     ';
      const amt = formatCurrency(item.total);
      lines.push(name + qty + taxStr + rightAlign(amt, 10));

      const addons = parseAddons(item.addons);
      for (const addon of addons) {
        const addonName = truncate('  + ' + addon.name, itemNameLen + 4);
        const addonPrice = addon.price ? formatCurrency(addon.price) : '';
        lines.push(addonName + rightAlign(addonPrice, cols - itemNameLen - 8));
      }
      if (item.special_instructions) {
        lines.push('  Note: ' + truncate(item.special_instructions, cols - 8));
      }
    }
  }

  lines.push(dash);
  lines.push('Subtotal' + rightAlign(formatCurrency(bill.subtotal), cols - 8));
  if (bill.discount_amount > 0) {
    lines.push('Discount' + rightAlign('-' + formatCurrency(bill.discount_amount), cols - 8));
  }

  if (bill.tax_breakdown) {
    try {
      const taxBreakdown = typeof bill.tax_breakdown === 'string' ? JSON.parse(bill.tax_breakdown) : bill.tax_breakdown;
      if (Array.isArray(taxBreakdown) && taxBreakdown.length > 0) {
        for (const tax of taxBreakdown) {
          if (tax.amount > 0) {
            lines.push((tax.name || 'Tax') + ' @' + tax.rate + '%' + rightAlign(formatCurrency(tax.amount), cols - 16));
          }
        }
      }
    } catch {
      lines.push('Tax' + rightAlign(formatCurrency(bill.tax_amount), cols - 3));
    }
  } else {
    lines.push('Tax' + rightAlign(formatCurrency(bill.tax_amount), cols - 3));
  }

  lines.push(bar);
  lines.push('{BOLD}GRAND TOTAL' + rightAlign(formatCurrency(bill.total), cols - 12) + '{/BOLD}');

  if (bill.payment_details) {
    lines.push(dash);
    try {
      const payments = typeof bill.payment_details === 'string' ? JSON.parse(bill.payment_details) : bill.payment_details;
      if (payments && Array.isArray(payments)) {
        for (const payment of payments) {
          if (payment && payment.method) {
            lines.push(payment.method + rightAlign(formatCurrency(payment.amount), cols - payment.method.length));
          }
        }
      }
    } catch {}
  }

  lines.push(bar);
  if (biz.address) lines.push('Address: ' + biz.address);
  if (biz.phone) lines.push('Phone: ' + biz.phone);
  if (biz.gstin) lines.push('GSTIN: ' + biz.gstin);
  lines.push('{CENTER}Thank you for your business!{/CENTER}');
  lines.push('{CUT}');

  return buildEscPos(lines);
}

function parseAddons(addons: any): any[] {
  if (!addons) return [];
  if (typeof addons === 'string') {
    try {
      const parsed = JSON.parse(addons);
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  }
  return Array.isArray(addons) ? addons : [];
}

function formatCurrency(amount: number): string {
  return '₹' + (Number(amount) || 0).toFixed(2);
}

function rightAlign(text: string, width: number = 24): string {
  return ' '.repeat(Math.max(1, width - text.length)) + text;
}

function getTaxRate(item: any): number {
  if (item.tax_rate !== undefined && item.tax_rate !== null) return Number(item.tax_rate);
  if (item.tax_type && item.tax_type !== 'none') {
    const match = item.tax_type.match(/(\d+)/);
    if (match) return parseInt(match[1]);
  }
  if (item.unit_price && item.tax_amount) {
    const rate = (item.tax_amount / item.unit_price / item.quantity) * 100;
    return Math.round(rate);
  }
  return 0;
}

function truncate(text: string, length: number): string {
  return text.length > length ? text.substring(0, length - 2) + '..' : text;
}

function formatKOT(order: any, items: any[], stationName: string, cols: number = 48): Buffer {
  const lines: string[] = [];
  const bar = '='.repeat(cols);

  lines.push('{INIT}');
  lines.push('{CENTER}{BOLD}KITCHEN ORDER TICKET{/BOLD}{/CENTER}');
  lines.push('');
  lines.push('Station: ' + stationName);
  lines.push('Order: ' + order.order_number);
  if (order.table) {
    lines.push('Table: ' + order.table.name);
  }
  lines.push('Time: ' + new Date(order.created_at).toLocaleTimeString());
  lines.push(bar);
  lines.push('');

  for (const item of items) {
    lines.push('{DOUBLE_HEIGHT}{BOLD}' + item.quantity + 'x  ' + item.product_name + '{/BOLD}{/DOUBLE_HEIGHT}');
    if (item.special_instructions) {
      lines.push('  ** ' + item.special_instructions + ' **');
    }
  }

  lines.push('');
  lines.push(bar);
  lines.push('{CUT}');

  return buildEscPos(lines);
}

export function buildTestPage(paperWidth: string = '80mm'): Buffer {
  const width = paperWidth === '58mm' ? 42 : 48;
  const bar = '='.repeat(width);
  const lines = [
    '{INIT}',
    '{CENTER}{BOLD}Flo Printer Test{/BOLD}{/CENTER}',
    '',
    bar,
    '{CENTER}Network / USB test print{/CENTER}',
    bar,
    '',
    `Paper: ${paperWidth}`,
    `Time: ${new Date().toLocaleString()}`,
    '',
    bar,
    '{CENTER}If you can read this, your printer is working!{/CENTER}',
    bar,
    '{CUT}',
  ];
  return buildEscPos(lines);
}

function buildEscPos(lines: string[]): Buffer {
  const buf: number[] = [];

  const resetAllStyles = () => {
    buf.push(0x1B, 0x45, 0x00);
    buf.push(0x1B, 0x21, 0x00);
    buf.push(0x1B, 0x61, 0x00);
  };

  for (let line of lines) {
    if (line.includes('{INIT}')) {
      buf.push(0x1B, 0x40);
      resetAllStyles();
      continue;
    }

    if (line.includes('{FEED}')) {
      buf.push(0x1B, 0x64, 0x02);
      continue;
    }

    if (line.includes('{CUT}')) {
      buf.push(0x1B, 0x64, 0x02);
      buf.push(0x1D, 0x56, 0x00);
      continue;
    }

    let lineBold = line.includes('{BOLD}');
    let lineDH = line.includes('{DOUBLE_HEIGHT}');
    let lineDW = line.includes('{DOUBLE_WIDTH}');
    let center = line.startsWith('{CENTER}') && line.includes('{/CENTER}');

    line = line.replace(/\{CENTER\}/g, '').replace(/\{\/CENTER\}/g, '');
    line = line.replace(/\{BOLD\}/g, '').replace(/\{\/BOLD\}/g, '');
    line = line.replace(/\{DOUBLE_HEIGHT\}/g, '').replace(/\{\/DOUBLE_HEIGHT\}/g, '');
    line = line.replace(/\{DOUBLE_WIDTH\}/g, '').replace(/\{\/DOUBLE_WIDTH\}/g, '');

    buf.push(0x1B, 0x61, center ? 0x01 : 0x00);

    if (lineBold || lineDH || lineDW) {
      let mode = 0;
      if (lineDH) mode |= 0x10;
      if (lineDW) mode |= 0x20;
      if (lineBold) mode |= 0x08;
      buf.push(0x1B, 0x21, mode);
    } else {
      buf.push(0x1B, 0x21, 0x00);
    }

    if (lineBold) {
      buf.push(0x1B, 0x45, 0x01);
    }

    buf.push(...Buffer.from(line, 'utf8'));
    buf.push(0x0A);
  }

  return Buffer.from(buf);
}

export async function printViaNetwork(ip: string, port: number, data: Buffer): Promise<boolean> {
  return new Promise((resolve) => {
    const client = new net.Socket();

    client.connect(port, ip, () => {
      client.write(data);
      client.end();
      resolve(true);
    });

    client.on('error', (err) => {
      console.error(`[Printer] Network error: ${err.message}`);
      resolve(false);
    });

    client.setTimeout(5000, () => {
      client.destroy();
      resolve(false);
    });
  });
}

export async function printViaUSB(data: Buffer, printerName?: string): Promise<boolean> {
  console.log('[Printer] printViaUSB called, platform:', process.platform, 'printer:', printerName);

  if (process.platform === 'darwin') {
    return await printViaUSBMacOS(data, printerName);
  }

  if (process.platform === 'win32') {
    return await printViaUSBWindows(data, printerName);
  }

  if (process.platform === 'linux') {
    return await printViaUSBLinux(data, printerName);
  }

  console.log('[Printer] Unsupported platform:', process.platform);
  return false;
}

async function printViaUSBMacOS(data: Buffer, printerName?: string): Promise<boolean> {
  const tmpFile = `/tmp/flo_print_${Date.now()}.bin`;

  try {
    fs.writeFileSync(tmpFile, data);
    console.log('[Printer] Data written to:', tmpFile, 'size:', data.length, 'bytes');
    console.log('[Printer] First 50 bytes:', Array.from(data.slice(0, 50)).map(b => b.toString(16)).join(' '));

    let cmd: string;
    if (printerName) {
      cmd = `lp -d "${printerName}" -o raw "${tmpFile}"`;
    } else {
      cmd = `lp -o raw "${tmpFile}"`;
    }

    console.log('[Printer] Executing:', cmd);
    const result = execSync(cmd, { encoding: 'utf8' });
    console.log('[Printer] Print sent successfully, result:', result);
    return true;
  } catch (err: any) {
    console.error('[Printer] macOS print error:', err.message);
    console.error('[Printer] Error details:', err);
    return false;
  } finally {
    try { fs.unlinkSync(tmpFile); } catch {}
  }
}

async function printViaUSBWindows(data: Buffer, printerName?: string): Promise<boolean> {
  try {
    let targetPrinter = printerName;

    // If no printer name or generic placeholder name, look up default/connected thermal printer
    if (!targetPrinter || targetPrinter.toLowerCase() === 'thermal printer') {
      const detected = detectWindowsPrinters();
      const defaultP = detected.find(p => p.isDefault) || detected.find(p => p.make !== 'Unknown') || detected[0];
      if (defaultP) {
        targetPrinter = defaultP.name;
      }
    }

    if (!targetPrinter) {
      console.error('[Printer] No Windows printer specified or found');
      return false;
    }

    console.log(`[Printer] Printing via Windows raw spooler to: ${targetPrinter}`);
    return await printViaWindowsRawSpooler(data, targetPrinter);
  } catch (err: any) {
    console.error('[Printer] Windows print error:', err.message);
    return false;
  }
}

async function printViaWindowsRawSpooler(data: Buffer, printerName: string): Promise<boolean> {
  const tmpFile = path.join(os.tmpdir(), `flo_print_${Date.now()}_${Math.random().toString(36).substring(7)}.bin`);
  try {
    fs.writeFileSync(tmpFile, data);

    const scriptPath = path.join(__dirname, 'print-raw-windows.ps1');
    let cmd: string;
    if (fs.existsSync(scriptPath)) {
      cmd = `powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}" -PrinterName "${printerName}" -FilePath "${tmpFile}"`;
    } else {
      const escapedPrinter = printerName.replace(/"/g, '`"');
      const escapedFile = tmpFile.replace(/\\/g, '\\\\');
      cmd = `powershell -NoProfile -Command "$code = @'
using System;
using System.IO;
using System.Runtime.InteropServices;
public class RawPrinterHelper {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
  public class DOCINFOA {
    [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
  }
  [DllImport(\\"winspool.Drv\\", EntryPoint = \\"OpenPrinterA\\", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
  public static extern bool OpenPrinter([MarshalAs(UnmanagedType.LPStr)] string szPrinter, out IntPtr hPrinter, IntPtr pd);
  [DllImport(\\"winspool.Drv\\", EntryPoint = \\"ClosePrinter\\", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
  public static extern bool ClosePrinter(IntPtr hPrinter);
  [DllImport(\\"winspool.Drv\\", EntryPoint = \\"StartDocPrinterA\\", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
  public static extern bool StartDocPrinter(IntPtr hPrinter, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOA di);
  [DllImport(\\"winspool.Drv\\", EntryPoint = \\"EndDocPrinter\\", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
  public static extern bool EndDocPrinter(IntPtr hPrinter);
  [DllImport(\\"winspool.Drv\\", EntryPoint = \\"StartPagePrinter\\", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
  public static extern bool StartPagePrinter(IntPtr hPrinter);
  [DllImport(\\"winspool.Drv\\", EntryPoint = \\"EndPagePrinter\\", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
  public static extern bool EndPagePrinter(IntPtr hPrinter);
  [DllImport(\\"winspool.Drv\\", EntryPoint = \\"WritePrinter\\", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
  public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);
  public static bool SendFileToPrinter(string szPrinterName, string szFileName) {
    if (!File.Exists(szFileName)) return false;
    byte[] bytes = File.ReadAllBytes(szFileName);
    if (bytes.Length == 0) return true;
    IntPtr pUnmanagedBytes = Marshal.AllocCoTaskMem(bytes.Length);
    Marshal.Copy(bytes, 0, pUnmanagedBytes, bytes.Length);
    IntPtr hPrinter = IntPtr.Zero;
    DOCINFOA di = new DOCINFOA();
    di.pDocName = \\"Flo POS Document\\";
    di.pDataType = \\"RAW\\";
    bool success = false;
    if (OpenPrinter(szPrinterName, out hPrinter, IntPtr.Zero)) {
      if (StartDocPrinter(hPrinter, 1, di)) {
        int dwWritten = 0;
        success = WritePrinter(hPrinter, pUnmanagedBytes, bytes.Length, out dwWritten);
        EndDocPrinter(hPrinter);
      }
      ClosePrinter(hPrinter);
    }
    Marshal.FreeCoTaskMem(pUnmanagedBytes);
    return success;
  }
}
'@
Add-Type -TypeDefinition $code -Language CSharp
[RawPrinterHelper]::SendFileToPrinter(\\"${escapedPrinter}\\", '${escapedFile}')"`;
    }

    const result = execSync(cmd, { encoding: 'utf8' }).trim();
    console.log('[Printer] Windows raw print result:', result);
    return result.toLowerCase().includes('true');
  } catch (err: any) {
    console.error('[Printer] Windows raw print error:', err.message);
    return false;
  } finally {
    try { fs.unlinkSync(tmpFile); } catch {}
  }
}

async function printViaUSBLinux(data: Buffer, printerName?: string): Promise<boolean> {
  const tmpFile = `/tmp/flo_print_${Date.now()}.bin`;

  try {
    fs.writeFileSync(tmpFile, data);

    if (printerName) {
      const cmd = `lp -d "${printerName}" -o raw "${tmpFile}"`;
      execSync(cmd, { encoding: 'utf8' });
    } else {
      const cmd = `lp -o raw "${tmpFile}"`;
      execSync(cmd, { encoding: 'utf8' });
    }

    return true;
  } catch (err: any) {
    console.error('[Printer] Linux print error:', err.message);
    return false;
  } finally {
    try { fs.unlinkSync(tmpFile); } catch {}
  }
}

export function getPrinterStatus(): { connected: boolean; printer: any } {
  const printer = getPrinterConfig();
  return { connected: !!printer, printer };
}
