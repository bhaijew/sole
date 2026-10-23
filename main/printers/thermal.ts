import * as net from 'net';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync, exec } from 'child_process';
import { getDatabase } from '../db';

let defaultPrinter: any = null;
let kitchenPrinter: any = null;

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
    const psCmd = `powershell -NoProfile -Command "Get-CimInstance Win32_Printer | Select-Object Name, Default, PrinterStatus, ExtendedPrinterStatus, WorkOffline, DetectedErrorState, DriverName | ConvertTo-Json"`;
    const output = execSync(psCmd, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
    if (!output || !output.trim()) return printers;

    const parsed = JSON.parse(output.trim());
    const list = Array.isArray(parsed) ? parsed : [parsed];

    for (const item of list) {
      if (!item || !item.Name) continue;
      const name = String(item.Name).trim();
      const isDefault = Boolean(item.Default);
      const isOffline = Boolean(item.WorkOffline) ||
                        item.ExtendedPrinterStatus === 9 ||
                        item.ExtendedPrinterStatus === 7 ||
                        item.DetectedErrorState === 1 ||
                        item.PrinterStatus === 1;
      const status = isOffline ? 'offline' : 'idle';
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

export async function printReceipt(
  order: any,
  bill: any,
  business?: any,
  template?: string,
  copyType: 'customer' | 'business' | 'both' = 'both'
): Promise<boolean> {
  try {
    const db = getDatabase();
    let effectiveCopyType = copyType;
    if (!effectiveCopyType || effectiveCopyType === 'both') {
      try {
        const copySetting = db.prepare("SELECT value FROM settings WHERE key = 'receipt_copies'").get() as any;
        if (copySetting?.value) {
          effectiveCopyType = copySetting.value as any;
        }
      } catch {}
    }
    if (!effectiveCopyType) effectiveCopyType = 'customer';

    console.log('[Printer] printReceipt called, template:', template, 'copyType:', effectiveCopyType);
    const printer = getPrinterConfig();
    if (!printer) {
      console.log('[Printer] No counter printer configured');
      return false;
    }
    console.log('[Printer] Using counter printer:', printer.name, printer.connection_type);
    
    const paperWidth = printer.paper_width || '80mm';
    const cols = paperWidth === '58mm' ? 42 : 48;
    
    let data: Buffer;
    try {
      data = formatReceipt(order, bill, business, template, cols, effectiveCopyType);
      console.log('[Printer] Receipt data length:', data.length, 'bytes');
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
    const printer = getKitchenPrinter() || getPrinterConfig();
    if (!printer) {
      console.log('[Printer] No kitchen or counter printer configured');
      return false;
    }
    console.log('[Printer] Using kitchen printer:', printer.name, printer.connection_type);
    
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

export function refreshPrinters(): { defaultPrinter: any; kitchenPrinter: any } {
  try {
    const db = getDatabase();
    defaultPrinter = db.prepare('SELECT * FROM printers WHERE is_default = 1').get() || null;
    
    const kitchenSetting = db.prepare("SELECT value FROM settings WHERE key = 'kitchen_printer_id'").get() as any;
    if (kitchenSetting?.value) {
      kitchenPrinter = db.prepare('SELECT * FROM printers WHERE id = ?').get(kitchenSetting.value) || null;
    }
    if (!kitchenPrinter) {
      kitchenPrinter = db.prepare('SELECT * FROM printers WHERE is_kitchen = 1').get() || null;
    }
    return { defaultPrinter, kitchenPrinter };
  } catch {
    return { defaultPrinter: null, kitchenPrinter: null };
  }
}

export function refreshDefaultPrinter(): any {
  return refreshPrinters().defaultPrinter;
}

export function getKitchenPrinter(): any {
  try {
    const db = getDatabase();
    const kitchenSetting = db.prepare("SELECT value FROM settings WHERE key = 'kitchen_printer_id'").get() as any;
    if (kitchenSetting?.value) {
      const p = db.prepare('SELECT * FROM printers WHERE id = ?').get(kitchenSetting.value);
      if (p) {
        kitchenPrinter = p;
        return p;
      }
    }
    const currentKitchen = db.prepare('SELECT * FROM printers WHERE is_kitchen = 1').get();
    if (currentKitchen) {
      kitchenPrinter = currentKitchen;
      return currentKitchen;
    }
  } catch {}
  return kitchenPrinter || getPrinterConfig();
}

export function getPrinterConfig(): any {
  try {
    const db = getDatabase();
    const current = db.prepare('SELECT * FROM printers WHERE is_default = 1').get();
    if (current) {
      defaultPrinter = current;
      return current;
    }
  } catch {}
  return defaultPrinter;
}

function formatReceipt(
  order: any,
  bill: any,
  business?: any,
  template?: string,
  cols: number = 48,
  copyType: 'customer' | 'business' | 'both' = 'customer'
): Buffer {
  console.log('[Printer] formatReceipt - template:', template, 'copyType:', copyType);
  console.log('[Printer] formatReceipt - order:', order?.order_number, 'bill:', bill?.bill_number);
  console.log('[Printer] formatReceipt - items count:', order?.items?.length || 0, 'cols:', cols);
  
  const biz = business || { name: 'PIZZA MAFIA', address: '', phone: '', gstin: '' };

  try {
    if (copyType === 'customer') {
      return formatSingleReceiptCopy(order, bill, biz, cols, 'Customer Copy');
    }
    if (copyType === 'business') {
      return formatSingleReceiptCopy(order, bill, biz, cols, 'Business Copy');
    }
    // Default 'both': Customer Copy + Cut + Business Copy + Cut
    const customerBuf = formatSingleReceiptCopy(order, bill, biz, cols, 'Customer Copy');
    const businessBuf = formatSingleReceiptCopy(order, bill, biz, cols, 'Business Copy');
    return Buffer.concat([customerBuf, businessBuf]);
  } catch (err) {
    console.error('[Printer] formatReceipt error:', err);
    throw err;
  }
}

/**
 * Format a single receipt copy (Customer Copy or Business Copy) matching Pizza Mafia layout.
 */
function formatSingleReceiptCopy(
  order: any,
  bill: any,
  biz: any,
  cols: number = 48,
  copyLabel: 'Customer Copy' | 'Business Copy' = 'Customer Copy'
): Buffer {
  const lines: string[] = [];
  const dateObj = order?.created_at ? new Date(order.created_at) : (bill?.created_at ? new Date(bill.created_at) : new Date());
  
  const month = dateObj.getMonth() + 1;
  const day = dateObj.getDate();
  const year = dateObj.getFullYear();
  const dateStr = `${month}/${day}/${year}`;
  const timeStr = dateObj.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });

  const orderNum = order?.order_number || bill?.bill_number || '1';
  const orderType = formatOrderType(order?.type || order?.order_type || order?.order_source);
  let customerName = order?.customer?.name || order?.customer_name || '';
  if (!customerName && order?.notes && order.notes.includes('Customer: ')) {
    customerName = order.notes.split('Customer: ')[1]?.split('|')[0]?.trim();
  }
  if (!customerName) {
    customerName = order?.order_source === 'online' ? 'Online Customer' : 'Walk-in';
  }
  const restaurantName = (biz.name || biz.business_name || 'PIZZA MAFIA').toUpperCase();

  const dash = '-'.repeat(cols);

  // 1. Initialize & Header
  lines.push('{INIT}');
  lines.push('{CENTER}{DOUBLE_HEIGHT}{BOLD}' + restaurantName + '{/BOLD}{/DOUBLE_HEIGHT}{/CENTER}');
  lines.push('{CENTER}{BOLD}' + copyLabel + '{/BOLD}{/CENTER}');
  lines.push('{CENTER}Order #: ' + orderNum + '{/CENTER}');
  lines.push('{CENTER}Date: ' + dateStr + '{/CENTER}');
  lines.push('{CENTER}Time: ' + timeStr + '{/CENTER}');
  lines.push('{CENTER}Type: ' + orderType + '{/CENTER}');
  lines.push('{CENTER}Name: ' + customerName + '{/CENTER}');

  // 2. Separator
  lines.push(dash);

  // 3. Items Table Header (3-column)
  const itemColWidth = cols >= 48 ? 30 : 16;
  const qtyColWidth = cols >= 48 ? 8 : 6;
  const priceColWidth = 10;
  
  const headerStr = 'Item'.padEnd(itemColWidth) + 'Quantity'.padStart(qtyColWidth) + 'Price'.padStart(priceColWidth);
  lines.push('{BOLD}' + headerStr + '{/BOLD}');
  lines.push(dash);

  // Items List
  if (order?.items) {
    for (const item of order.items) {
      const name = item.product_name || 'Item';
      const qty = String(item.quantity || 1).padStart(qtyColWidth);
      const itemTotal = Number(item.total ?? (Number(item.unit_price || 0) * Number(item.quantity || 1)));
      const price = formatPriceNumber(itemTotal).padStart(priceColWidth);

      // Clean line wrapping for long names
      const wrappedLines = wrapText(name, itemColWidth);
      lines.push(wrappedLines[0].padEnd(itemColWidth) + qty + price);
      for (let i = 1; i < wrappedLines.length; i++) {
        lines.push(wrappedLines[i]);
      }

      // Addons
      const addons = parseAddons(item.addons);
      for (const addon of addons) {
        const addonPrice = addon.price ? ` (Rs ${formatPriceNumber(addon.price)})` : '';
        lines.push('  + ' + addon.name + addonPrice);
      }

      // Special instructions
      if (item.special_instructions) {
        lines.push('  >> ' + item.special_instructions);
      }
    }
  }

  lines.push(dash);

  // Subtotal / Breakdown if discounts, delivery or taxes exist
  const subtotal = Number(bill?.subtotal || order?.subtotal || bill?.total || 0);
  const total = Number(bill?.total || order?.total || 0);
  const discount = Number(bill?.discount_amount || order?.discount_amount || 0);
  const delivery = Number(bill?.delivery_charge || order?.delivery_charge || 0);
  const tax = Number(bill?.tax_amount || order?.tax_amount || 0);

  if (discount > 0 || delivery > 0 || tax > 0) {
    lines.push('Subtotal' + rightAlign('Rs ' + formatPriceNumber(subtotal), cols - 8));
    if (discount > 0) {
      lines.push('Discount' + rightAlign('-Rs ' + formatPriceNumber(discount), cols - 8));
    }
    if (delivery > 0) {
      lines.push('Delivery' + rightAlign('Rs ' + formatPriceNumber(delivery), cols - 8));
    }
    if (tax > 0) {
      lines.push('Tax' + rightAlign('Rs ' + formatPriceNumber(tax), cols - 3));
    }
    lines.push(dash);
  }

  // 4. Prominent Centered Total
  lines.push('{CENTER}{DOUBLE_HEIGHT}{BOLD}TOTAL: Rs ' + formatPriceNumber(total) + '{/BOLD}{/DOUBLE_HEIGHT}{/CENTER}');
  lines.push(dash);

  // 5. Payment and Footer
  const epNumber = biz.easypaisa_number || biz.payment_phone || '';
  const epTitle = biz.easypaisa_title || biz.account_title || '';
  const compNumber = biz.complaint_number || biz.complaint_phone || biz.phone || '';

  if (epNumber) {
    lines.push('EasyPaisa: ' + epNumber);
  }
  if (epTitle) {
    lines.push(epTitle);
  }
  if (compNumber) {
    lines.push('Complaint: ' + compNumber);
  }
  if (biz.footer_message) {
    lines.push(biz.footer_message);
  }

  lines.push('');
  lines.push('{CENTER}{BOLD}Thank You!{/BOLD}{/CENTER}');
  lines.push('{CUT}');

  return buildEscPos(lines);
}

function formatCompactReceipt(order: any, bill: any, biz: any, cols: number = 48): Buffer {
  return formatSingleReceiptCopy(order, bill, biz, cols, 'Customer Copy');
}

function formatClassicReceipt(order: any, bill: any, biz: any, cols: number = 48): Buffer {
  return formatSingleReceiptCopy(order, bill, biz, cols, 'Customer Copy');
}

function formatDetailedReceipt(order: any, bill: any, biz: any, cols: number = 48): Buffer {
  return formatSingleReceiptCopy(order, bill, biz, cols, 'Customer Copy');
}

function wrapText(text: string, maxWidth: number): string[] {
  if (!text) return [''];
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    if (!current) {
      current = word;
    } else if ((current + ' ' + word).length <= maxWidth) {
      current += ' ' + word;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [text.substring(0, maxWidth)];
}

function formatPriceNumber(amount: number | string): string {
  const n = Number(amount) || 0;
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(2);
}

function formatOrderType(type?: string): string {
  if (!type) return 'Takeaway';
  const clean = type.toLowerCase().replace(/[_\s-]+/g, '');
  if (clean.includes('take') || clean.includes('pickup') || clean.includes('togo')) {
    return 'Takeaway';
  }
  if (clean.includes('dine') || clean.includes('table')) {
    return 'Dine-in';
  }
  if (clean.includes('delivery')) {
    return 'Delivery';
  }
  if (clean.includes('online')) {
    return 'Online';
  }
  return type.charAt(0).toUpperCase() + type.slice(1);
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
  const dash = '-'.repeat(cols);

  const orderNum = order?.order_number || '1';
  const orderType = formatOrderType(order?.type || order?.order_type || order?.order_source);

  // Customer Name & Phone
  let customerName = order?.customer?.name || order?.customer_name || '';
  let customerPhone = order?.customer?.phone || order?.customer_phone || '';
  if (!customerName && order?.notes && order.notes.includes('Customer: ')) {
    customerName = order.notes.split('Customer: ')[1]?.split('|')[0]?.trim();
  }
  if (!customerPhone && order?.notes && order.notes.includes('Phone: ')) {
    customerPhone = order.notes.split('Phone: ')[1]?.split('|')[0]?.trim();
  }
  if (!customerName && order?.order_source === 'online') {
    customerName = 'Online Customer';
  }

  const dateObj = order?.created_at ? new Date(order.created_at) : new Date();
  const timeStr = dateObj.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });

  lines.push('{INIT}');
  lines.push('{CENTER}{DOUBLE_HEIGHT}{BOLD}KITCHEN ORDER TICKET{/BOLD}{/DOUBLE_HEIGHT}{/CENTER}');
  lines.push('{CENTER}Station: ' + (stationName || 'Kitchen') + '{/CENTER}');
  lines.push(dash);
  lines.push('{DOUBLE_HEIGHT}{BOLD}ORDER #: ' + orderNum + '{/BOLD}{/DOUBLE_HEIGHT}');
  lines.push('{BOLD}Type: ' + orderType.toUpperCase() + '{/BOLD}');
  if (order.table?.name || order.table) {
    const tName = typeof order.table === 'object' ? order.table.name : order.table;
    lines.push('Table: ' + tName);
  }
  if (customerName) {
    lines.push('{BOLD}Customer: ' + customerName + '{/BOLD}');
  }
  if (customerPhone) {
    lines.push('Phone: ' + customerPhone);
  }
  lines.push('Time: ' + timeStr);
  lines.push(bar);
  lines.push('');

  for (const item of (items || [])) {
    const qty = item.quantity || item.qty || 1;
    const name = item.product_name || item.name || 'Item';
    lines.push('{DOUBLE_HEIGHT}{BOLD}' + qty + 'x  ' + name + '{/BOLD}{/DOUBLE_HEIGHT}');
    
    // Variant / Variation
    if (item.variant_selection) {
      lines.push('  [' + item.variant_selection + ']');
    }

    // Addons
    const addons = parseAddons(item.addons);
    for (const addon of addons) {
      lines.push('  + ' + addon.name);
    }

    if (item.special_instructions) {
      lines.push('  ** ' + item.special_instructions + ' **');
    }
  }

  lines.push('');
  lines.push(bar);
  lines.push('{CUT}');

  return buildEscPos(lines);
}

export function buildTestPage(paperWidth: string = '80mm', printerName?: string): Buffer {
  const width = paperWidth === '58mm' ? 32 : 48;
  const bar = '='.repeat(width);
  const lines = [
    '{INIT}',
    '{CENTER}{BOLD}FLO POS TEST PRINT{/BOLD}{/CENTER}',
    '{CENTER}--------------------------------{/CENTER}',
    '',
    `Printer: ${printerName || 'Thermal Printer'}`,
    `Paper Width: ${paperWidth}`,
    `Connection: Windows Spooler`,
    `Date: ${new Date().toLocaleDateString()}`,
    `Time: ${new Date().toLocaleTimeString()}`,
    '',
    bar,
    '{CENTER}{BOLD}PRINTER CONFIGURED OK!{/BOLD}{/CENTER}',
    '{CENTER}Flo POS Real Printing Ready{/CENTER}',
    bar,
    '',
    '',
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
      buf.push(0x1B, 0x64, 0x04);
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

export function ensureWindowsPrintScript(): string {
  const scriptPath = path.join(os.tmpdir(), 'flo-print-raw-windows.ps1');
  const ps1Script = `param(
    [string]$PrinterName = "RONGTA 58mm Series Printer",
    [string]$FilePath
)

$code = @"
using System;
using System.IO;
using System.Runtime.InteropServices;

public class RawPrinterHelper
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
    public class DOCINFOA
    {
        [MarshalAs(UnmanagedType.LPStr)]
        public string pDocName;
        [MarshalAs(UnmanagedType.LPStr)]
        public string pOutputFile;
        [MarshalAs(UnmanagedType.LPStr)]
        public string pDataType;
    }

    [DllImport("winspool.Drv", EntryPoint = "OpenPrinterA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool OpenPrinter([MarshalAs(UnmanagedType.LPStr)] string szPrinter, out IntPtr hPrinter, IntPtr pd);

    [DllImport("winspool.Drv", EntryPoint = "ClosePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool ClosePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "StartDocPrinterA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool StartDocPrinter(IntPtr hPrinter, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOA di);

    [DllImport("winspool.Drv", EntryPoint = "EndDocPrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool EndDocPrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "StartPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool StartPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "EndPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool EndPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "WritePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);

    public static bool SendFileToPrinter(string szPrinterName, string szFileName)
    {
        if (!File.Exists(szFileName)) return false;
        byte[] bytes = File.ReadAllBytes(szFileName);
        if (bytes.Length == 0) return true;

        IntPtr pUnmanagedBytes = Marshal.AllocCoTaskMem(bytes.Length);
        Marshal.Copy(bytes, 0, pUnmanagedBytes, bytes.Length);

        IntPtr hPrinter = IntPtr.Zero;
        DOCINFOA di = new DOCINFOA();
        di.pDocName = "Flo POS Document";
        di.pDataType = "RAW";

        bool success = false;
        if (OpenPrinter(szPrinterName, out hPrinter, IntPtr.Zero))
        {
            if (StartDocPrinter(hPrinter, 1, di))
            {
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
"@

if (-not ([System.Management.Automation.PSTypeName]'RawPrinterHelper').Type) {
    Add-Type -TypeDefinition $code -Language CSharp
}
$res = [RawPrinterHelper]::SendFileToPrinter($PrinterName, $FilePath)
Write-Output $res
`;

  try {
    fs.writeFileSync(scriptPath, ps1Script, 'utf8');
  } catch (err) {
    console.error('[Printer] Could not write spooler script:', err);
  }
  return scriptPath;
}

async function printViaUSBWindows(data: Buffer, printerName?: string): Promise<boolean> {
  try {
    let targetPrinter = printerName?.trim();

    // If no printer name or generic placeholder name, look up default/connected thermal printer
    if (!targetPrinter || targetPrinter.toLowerCase() === 'thermal printer') {
      const dbPrinter = getPrinterConfig();
      if (dbPrinter && dbPrinter.name && dbPrinter.name.toLowerCase() !== 'thermal printer') {
        targetPrinter = dbPrinter.name.trim();
      } else {
        const detected = detectWindowsPrinters();
        const defaultP = detected.find(p => p.isDefault) || detected.find(p => p.make !== 'Unknown') || detected[0];
        if (defaultP) {
          targetPrinter = defaultP.name.trim();
        }
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

    const scriptPath = ensureWindowsPrintScript();
    const escapedPrinter = printerName.replace(/"/g, '`"');
    const cmd = `powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}" -PrinterName "${escapedPrinter}" -FilePath "${tmpFile}"`;

    console.log(`[Printer] Spooling raw data to Windows printer "${printerName}" (${data.length} bytes)`);
    const result = execSync(cmd, { encoding: 'utf8', timeout: 15000 }).trim();
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
