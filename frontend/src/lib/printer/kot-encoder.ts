/**
 * kot-encoder.ts
 *
 * Converts a Flo POS Order into a Kitchen Order Ticket (KOT) ESC/POS byte array.
 * KOTs are printed in the kitchen to show what items need to be prepared.
 */

import ReceiptPrinterEncoder from '@point-of-sale/receipt-printer-encoder';
import type { Order } from '@/lib/types';

export interface KotOptions {
  /** 58 mm (32 chars) or 80 mm (48 chars). Default: 58 */
  paperWidth?: 58 | 80;
  /** Kitchen station name to print on KOT */
  stationName?: string;
}

const CHARS: Record<58 | 80, number> = { 58: 32, 80: 48 };

/**
 * Build a KOT byte array from an Order object.
 * The Order must have `items` populated.
 */
export function buildKotBytes(
  order: Order,
  opts: KotOptions = {}
): Uint8Array {
  const { paperWidth = 58, stationName } = opts;
  const cols = CHARS[paperWidth];

  const enc = new ReceiptPrinterEncoder({ columns: cols });

  // ── KOT Header ───────────────────────────────────────────────────────────────
  enc.initialize();

  // KOT Banner
  enc.align('center').bold(true).width(2).height(2).text('KITCHEN TICKET').width(1).height(1).newline();
  if (stationName) {
    enc.align('center').bold(true).text(`STATION: ${stationName.toUpperCase()}`).newline();
  }
  enc.rule({ style: 'double' });

  // Order details
  enc.align('left').bold(true);
  enc.width(2).height(2).text(`ORDER #${order.order_number}`).width(1).height(1).newline();

  const orderType = order.type.replace('_', ' ').toUpperCase();
  enc.height(2).text(`TYPE: ${orderType}`).height(1).newline();

  if (order.table) {
    enc.height(2).text(`TABLE: ${order.table.name}`).height(1).newline();
  }

  const customerName = order.customer?.name || (order as any).customer_name;
  if (customerName) {
    enc.text(`Customer: ${customerName}`).newline();
  }

  let customerPhone = order.customer?.phone || (order as any).customer_phone;
  if (!customerPhone && (order as any).notes && (order as any).notes.includes('Phone: ')) {
    customerPhone = (order as any).notes.split('Phone: ')[1]?.split('|')[0]?.trim();
  }
  if (!customerPhone && order.special_instructions && order.special_instructions.includes('Phone: ')) {
    customerPhone = order.special_instructions.split('Phone: ')[1]?.split('|')[0]?.trim();
  }
  if (customerPhone) {
    enc.text(`Contact: ${customerPhone}`).newline();
  }

  const deliveryAddr = order.delivery_address || (order as any).address;
  if (deliveryAddr && String(deliveryAddr).trim().toLowerCase() !== 'null') {
    enc.text(`Delivery: ${String(deliveryAddr).trim()}`).newline();
  }

  enc.text(`Time: ${formatTime(order.created_at)}`).newline();
  enc.rule({ style: 'double' });

  // ── Items ────────────────────────────────────────────────────────────────────
  const items = order.items ?? [];
  let hasItems = false;
  const maxDoubleCols = Math.floor(cols / 2);

  for (const item of items) {
    // Skip items that are already served/completed
    if (item.status === 'served' || item.status === 'ready') {
      continue;
    }

    hasItems = true;

    // Item name with quantity (Double Width & Double Height Bold)
    const qtyName = `${item.quantity}x ${item.product_name}`;
    enc.bold(true).width(2).height(2).text(truncate(qtyName, maxDoubleCols)).width(1).height(1).newline();

    // Variant / Variation / Size (Double Height Bold)
    const vText = cleanVariant((item as any).variant_selection || (item as any).variant || (item as any).size || (item as any).selected_variation);
    if (vText) {
      enc.bold(true).height(2).text(`  >> SIZE / VARIANT: ${vText.toUpperCase()}`).height(1).newline();
    }

    // Deal combo items included (e.g. 1x Small Pizza, 1x Zinger Burger, 1x 500ml Drink)
    const dealItems = extractDealItemsFromItem(item);
    if (dealItems.length > 0) {
      enc.bold(true).height(2).text('  >> INCLUDES:').height(1).newline();
      for (const dItem of dealItems) {
        enc.bold(true).height(2).text(`     * ${dItem}`).height(1).newline();
      }
    }

    // Addons
    if (item.addons && item.addons.length > 0) {
      for (const addon of item.addons) {
        enc.bold(true).text(`  + ADDON: ${truncate(addon.name.toUpperCase(), cols - 4)}`).newline();
      }
    }

    // Special instructions (eliminate any "vraint = null" or null)
    const cleanNotes = cleanNotesText(item.special_instructions);
    if (
      cleanNotes &&
      cleanNotes.toLowerCase() !== 'null' &&
      cleanNotes.toLowerCase() !== 'undefined' &&
      cleanNotes.toUpperCase() !== vText?.toUpperCase()
    ) {
      enc.bold(true).height(2).text(`  ⚠️ NOTE: ${truncate(cleanNotes.toUpperCase(), cols - 12)}`).height(1).newline();
    }

    enc.rule({ style: 'single' });
  }

  if (!hasItems) {
    enc.bold(true).text('(No pending items)').newline();
  }

  // ── Footer ─────────────────────────────────────────────────────────────────
  enc.rule({ style: 'double' });
  enc.align('center').bold(true).text('--- End of KOT ---').newline();

  enc.newline().cut();

  return enc.encode();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function cleanNotesText(notes: any): string {
  if (!notes) return '';
  let str = String(notes).trim();
  str = str.replace(/(?:vraint|variant)\s*[:=]\s*null/gi, '');
  str = str.replace(/\bnull\b/gi, '');
  str = str.replace(/\|\s*\|/g, '|').replace(/^[\s|]+|[\s|]+$/g, '').trim();
  return str;
}

export function cleanVariant(v: any): string {
  if (!v) return '';
  if (typeof v === 'string') {
    let trimmed = v.trim();
    trimmed = trimmed.replace(/(?:vraint|variant)\s*[:=]\s*null/gi, '').trim();
    if (
      !trimmed ||
      trimmed.toLowerCase() === 'null' ||
      trimmed.toLowerCase() === 'undefined' ||
      trimmed === '{}' ||
      trimmed === '[]' ||
      /^(vraint|variant)\s*[:=]\s*null$/i.test(trimmed)
    ) {
      return '';
    }
    try {
      const parsed = JSON.parse(trimmed);
      if (!parsed || parsed === 'null' || parsed === 'undefined') return '';
      if (typeof parsed === 'string') return cleanVariant(parsed);
      if (typeof parsed === 'object') {
        if (parsed.name) return cleanVariant(String(parsed.name));
        if (parsed.title) return cleanVariant(String(parsed.title));
        const vals = Object.values(parsed)
          .map((x) => cleanVariant(x))
          .filter(Boolean);
        return vals.join(', ');
      }
    } catch {
      return trimmed;
    }
    return trimmed;
  }
  if (typeof v === 'object') {
    if (v.name) return cleanVariant(String(v.name));
    if (v.title) return cleanVariant(String(v.title));
    const vals = Object.values(v)
      .map((x) => cleanVariant(x))
      .filter(Boolean);
    return vals.join(', ');
  }
  return String(v);
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max - 1) + '…' : str;
}

function formatTime(iso?: string): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleTimeString('en', {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function extractDealItemsFromItem(item: any): string[] {
  if (!item) return [];

  // Direct items_included or deal_items
  if (Array.isArray(item.deal_items) && item.deal_items.length > 0) {
    return item.deal_items.map((s: any) => String(s).trim()).filter(Boolean);
  }
  if (Array.isArray(item.items_included) && item.items_included.length > 0) {
    return item.items_included.map((s: any) => String(s).trim()).filter(Boolean);
  }
  if (typeof item.items_included === 'string' && item.items_included.trim()) {
    try {
      const parsed = JSON.parse(item.items_included);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map((s: any) => String(s).trim()).filter(Boolean);
      }
    } catch {
      const parts = item.items_included.split(',').map((s: string) => s.trim()).filter(Boolean);
      if (parts.length > 0) return parts;
    }
  }

  // Also check product.items_included / product.description if attached
  const prod = item.product || {};
  if (Array.isArray(prod.items_included) && prod.items_included.length > 0) {
    return prod.items_included.map((s: any) => String(s).trim()).filter(Boolean);
  }
  if (typeof prod.items_included === 'string' && prod.items_included.trim()) {
    try {
      const parsed = JSON.parse(prod.items_included);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map((s: any) => String(s).trim()).filter(Boolean);
      }
    } catch {
      const parts = prod.items_included.split(',').map((s: string) => s.trim()).filter(Boolean);
      if (parts.length > 0) return parts;
    }
  }

  const desc = String(item.description || prod.description || '').trim();
  const prodName = String(item.product_name || item.name || prod.name || '').toLowerCase();
  const isDeal = prodName.includes('deal') || prodName.includes('bumper') || prodName.includes('combo') || prodName.includes('super');

  if (desc) {
    if (desc.includes('•') || desc.includes('·')) {
      const sep = desc.includes('•') ? '•' : '·';
      return desc.split(sep).map((s) => s.replace(/^[•\-\*✓\d+\.]\s*/, '').trim()).filter(Boolean);
    }
    if (desc.includes('\n')) {
      const parts = desc.split('\n').map((s) => s.replace(/^[•\-\*✓\d+\.]\s*/, '').trim()).filter(Boolean);
      if (parts.length > 1) return parts;
    }
    if (desc.includes('+')) {
      const parts = desc.split('+').map((s) => s.trim()).filter(Boolean);
      if (parts.length > 1) return parts;
    }
    if (isDeal && desc.includes(',')) {
      const parts = desc.split(',').map((s) => s.trim()).filter(Boolean);
      if (parts.length > 1) return parts;
    }
    if (isDeal && desc.length > 0) {
      return [desc];
    }
  }

  return [];
}
