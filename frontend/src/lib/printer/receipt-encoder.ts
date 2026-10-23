/**
 * receipt-encoder.ts
 *
 * Converts a Flo POS Bill (+ its nested Order) into raw ESC/POS bytes
 * using `@point-of-sale/receipt-printer-encoder`.
 *
 * Implements the 80mm Thermal Receipt layout matching the reference image:
 *   - Centered restaurant name & copy label (Customer Copy / Business Copy)
 *   - Dynamic Order #, Date, Time, Type, Name
 *   - Clean 3-column items table (Item, Quantity, Price) with dashed separators
 *   - Prominently centered TOTAL: Rs ...
 *   - Payment (EasyPaisa), account title, complaint contact, and centered Thank You!
 *   - Dual copy support (Customer Copy + cut + Business Copy + cut)
 */

import ReceiptPrinterEncoder from '@point-of-sale/receipt-printer-encoder';
import type { Bill, Tenant, Order, OrderItem } from '@/lib/types';

export type CopyType = 'customer' | 'business' | 'both';

export interface ReceiptOptions {
  /** 58 mm (32 chars) or 80 mm (48 chars). Default: 80 */
  paperWidth?: 58 | 80;
  /** Show a "Thank you" footer line. Default: true */
  showFooter?: boolean;
  /** Extra line of custom text printed below the footer. */
  footerNote?: string;
  /** GSTIN to print in footer / header */
  gstin?: string;
  /** Business address to print */
  address?: string;
  /** Business phone to print */
  phone?: string;
  /** Show per-tax-rate breakdown lines */
  showTaxBreakdown?: boolean;
  /** Restaurant/Business Name override */
  businessName?: string;
  /** EasyPaisa phone number */
  easypaisaNumber?: string;
  /** EasyPaisa account holder title */
  easypaisaTitle?: string;
  /** Complaint contact number */
  complaintNumber?: string;
  /** Receipt copy mode */
  copyType?: CopyType;
}

const CHARS: Record<58 | 80, number> = { 58: 32, 80: 48 };

/**
 * Build 3-column table header for 80mm (or 58mm)
 * Columns: [Item, Quantity, Price]
 */
function col3Header(cols: number): string {
  if (cols >= 48) {
    // 30 + 8 + 10 = 48
    return 'Item'.padEnd(30) + 'Quantity'.padStart(8) + 'Price'.padStart(10);
  }
  // 32 cols: 16 + 6 + 10 = 32
  return 'Item'.padEnd(16) + 'Qty'.padStart(6) + 'Price'.padStart(10);
}

/**
 * Format a single line item into the 3-column layout.
 * If product name exceeds available width, wraps cleanly.
 */
function col3ItemLines(
  name: string,
  qty: number,
  price: number | string,
  cols: number
): string[] {
  const itemWidth = cols >= 48 ? 30 : 16;
  const qtyWidth = cols >= 48 ? 8 : 6;
  const priceWidth = 10;

  const qtyStr = String(qty).padStart(qtyWidth);
  const priceStr = formatAmountNumber(price).padStart(priceWidth);

  const nameWords = name.split(' ');
  const lines: string[] = [];
  let currentLine = '';

  for (const word of nameWords) {
    if (!currentLine) {
      currentLine = word;
    } else if ((currentLine + ' ' + word).length <= itemWidth) {
      currentLine += ' ' + word;
    } else {
      lines.push(currentLine);
      currentLine = word;
    }
  }
  if (currentLine) {
    lines.push(currentLine);
  }

  if (lines.length === 0) {
    lines.push('');
  }

  // First line gets Item name + Qty + Price
  const first = lines[0].padEnd(itemWidth) + qtyStr + priceStr;
  const result: string[] = [first];

  // Subsequent wrapped lines
  for (let i = 1; i < lines.length; i++) {
    result.push(lines[i]);
  }

  return result;
}

/**
 * Encode a single receipt copy (Customer Copy or Business Copy) into ESC/POS bytes.
 */
function buildSingleCopyBytes(
  bill: Bill,
  tenant: Pick<Tenant, 'business_name' | 'currency'>,
  opts: ReceiptOptions,
  copyLabel: 'Customer Copy' | 'Business Copy'
): Uint8Array {
  const {
    paperWidth = 80,
    footerNote,
    businessName,
    easypaisaNumber,
    easypaisaTitle,
    complaintNumber,
    phone,
  } = opts;

  const cols = CHARS[paperWidth] || 48;
  const order = bill.order;
  const displayName = (businessName || tenant.business_name || 'PIZZA MAFIA').toUpperCase();
  const orderNum = order?.order_number || bill.bill_number || '1';

  const dateObj = order?.created_at ? new Date(order.created_at) : ((bill as any)?.created_at ? new Date((bill as any).created_at) : new Date());
  const dateStr = formatReceiptDate(dateObj);
  const timeStr = formatReceiptTime(dateObj);
  const orderType = formatOrderType(order?.type || (order as any)?.order_type);
  const customerName = order?.customer?.name || (order as any)?.customer_name || 'Walk-in';

  const enc = new ReceiptPrinterEncoder({ columns: cols });

  // 1. Initialize
  enc.initialize();

  // 2. Receipt Header (Centered)
  enc.align('center');

  // Prominent Restaurant Name (Double width & double height for 80mm)
  enc.bold(true).width(2).height(2).text(truncate(displayName, Math.floor(cols / 2))).width(1).height(1).bold(false).newline();

  // Copy Label
  enc.bold(true).text(copyLabel).bold(false).newline();

  // Order Details
  enc.text(`Order #: ${orderNum}`).newline();
  enc.text(`Date: ${dateStr}`).newline();
  enc.text(`Time: ${timeStr}`).newline();
  enc.text(`Type: ${orderType}`).newline();
  enc.text(`Name: ${customerName}`).newline();

  // Dashed line before items
  enc.align('left');
  enc.text('-'.repeat(cols)).newline();

  // 3. Items Table Header
  enc.bold(true).text(col3Header(cols)).bold(false).newline();
  enc.text('-'.repeat(cols)).newline();

  // Items List
  const items = order?.items || [];
  for (const item of items) {
    const itemTotal = Number(item.total ?? (Number(item.unit_price || 0) * Number(item.quantity || 1)));
    const lines = col3ItemLines(item.product_name || 'Item', item.quantity || 1, itemTotal, cols);

    for (const l of lines) {
      enc.text(l).newline();
    }

    // Addons
    if (item.addons) {
      const addons = Array.isArray(item.addons)
        ? item.addons
        : typeof item.addons === 'string'
        ? (() => { try { return JSON.parse(item.addons); } catch { return []; } })()
        : [];

      for (const addon of addons) {
        const addonPrice = addon.price ? ` (Rs ${formatAmountNumber(addon.price)})` : '';
        const addonLine = `  + ${addon.name || addon.addon_name || 'Addon'}${addonPrice}`;
        enc.text(truncate(addonLine, cols)).newline();
      }
    }

    // Instructions
    if (item.special_instructions) {
      enc.text(truncate(`  >> ${item.special_instructions}`, cols)).newline();
    }
  }

  enc.text('-'.repeat(cols)).newline();

  // Breakdown if discounts, delivery or taxes exist
  const subtotal = Number(bill.subtotal || order?.subtotal || bill.total || 0);
  const total = Number(bill.total || order?.total || 0);
  const discount = Number(bill.discount_amount || order?.discount_amount || 0);
  const delivery = Number(bill.delivery_charge || (order as any)?.delivery_charge || 0);
  const tax = Number(bill.tax_amount || order?.tax_amount || 0);

  if (discount > 0 || delivery > 0 || tax > 0) {
    enc.text(padRow('Subtotal', `Rs ${formatAmountNumber(subtotal)}`, cols)).newline();
    if (discount > 0) {
      enc.text(padRow('Discount', `-Rs ${formatAmountNumber(discount)}`, cols)).newline();
    }
    if (delivery > 0) {
      enc.text(padRow('Delivery', `Rs ${formatAmountNumber(delivery)}`, cols)).newline();
    }
    if (tax > 0) {
      enc.text(padRow('Tax', `Rs ${formatAmountNumber(tax)}`, cols)).newline();
    }
    enc.text('-'.repeat(cols)).newline();
  }

  // 4. Prominently Centered Total
  enc.align('center');
  enc.bold(true).height(2).text(`TOTAL: Rs ${formatAmountNumber(total)}`).height(1).bold(false).newline();
  enc.align('left');
  enc.text('-'.repeat(cols)).newline();

  // 5. Payment and Footer
  const epNumber = easypaisaNumber || '';
  const epTitle = easypaisaTitle || '';
  const compNumber = complaintNumber || phone || '';

  if (epNumber) {
    enc.text(`EasyPaisa: ${epNumber}`).newline();
  }
  if (epTitle) {
    enc.text(epTitle).newline();
  }
  if (compNumber) {
    enc.text(`Complaint: ${compNumber}`).newline();
  }
  if (footerNote) {
    enc.text(truncate(footerNote, cols)).newline();
  }

  enc.newline();
  enc.align('center').bold(true).text('Thank You!').bold(false).newline();
  enc.newline().cut();

  return enc.encode();
}

/**
 * Combine two Uint8Arrays into one contiguous byte array.
 */
function concatUint8Arrays(a: Uint8Array, b: Uint8Array): Uint8Array {
  const result = new Uint8Array(a.length + b.length);
  result.set(a, 0);
  result.set(b, a.length);
  return result;
}

/**
 * Build ESC/POS bytes for receipt printing.
 * When opts.copyType === 'both' (default), returns Customer Copy (with cut)
 * followed by Business Copy (with cut).
 */
export function buildClassicReceiptBytes(
  bill: Bill,
  tenant: Pick<Tenant, 'business_name' | 'currency'>,
  opts: ReceiptOptions = {}
): Uint8Array {
  const copyType = opts.copyType || 'both';

  if (copyType === 'customer') {
    return buildSingleCopyBytes(bill, tenant, opts, 'Customer Copy');
  }

  if (copyType === 'business') {
    return buildSingleCopyBytes(bill, tenant, opts, 'Business Copy');
  }

  // 'both': Customer Copy + Cut + Business Copy + Cut
  const customerBytes = buildSingleCopyBytes(bill, tenant, opts, 'Customer Copy');
  const businessBytes = buildSingleCopyBytes(bill, tenant, opts, 'Business Copy');
  return concatUint8Arrays(customerBytes, businessBytes);
}

/**
 * Compact template (delegates to standard Pizza Mafia thermal layout)
 */
export function buildCompactReceiptBytes(
  bill: Bill,
  tenant: Pick<Tenant, 'business_name' | 'currency'>,
  opts: ReceiptOptions = {}
): Uint8Array {
  return buildClassicReceiptBytes(bill, tenant, opts);
}

/**
 * Detailed GST template (keeps GSTIN if needed, with Pizza Mafia formatting)
 */
export function buildDetailedReceiptBytes(
  bill: Bill,
  tenant: Pick<Tenant, 'business_name' | 'currency'>,
  opts: ReceiptOptions = {}
): Uint8Array {
  return buildClassicReceiptBytes(bill, tenant, opts);
}

/** Default export */
export const buildReceiptBytes = buildClassicReceiptBytes;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function padRow(left: string, right: string, cols: number): string {
  const gap = cols - left.length - right.length;
  return gap > 0
    ? left + ' '.repeat(gap) + right
    : left.slice(0, cols - right.length - 1) + ' ' + right;
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max - 1) + '..' : str;
}

function formatAmountNumber(value: number | string): string {
  const n = Number(value) || 0;
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(2);
}

function formatReceiptDate(d: Date): string {
  if (!d || isNaN(d.getTime())) return '';
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const year = d.getFullYear();
  return `${month}/${day}/${year}`;
}

function formatReceiptTime(d: Date): string {
  if (!d || isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
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
