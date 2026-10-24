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

    // Variant / Variation (strictly eliminate "variant = null")
    const vText = cleanVariant((item as any).variant_selection || (item as any).variant || (item as any).selected_variation);
    if (vText && vText.toLowerCase() !== 'null' && vText.toLowerCase() !== 'undefined' && !/^(vraint|variant)\s*[:=]\s*null$/i.test(vText)) {
      enc.bold(true).height(2).text(`  >> VARIANT: ${vText.toUpperCase()}`).height(1).newline();
    }

    // Addons
    if (item.addons && item.addons.length > 0) {
      for (const addon of item.addons) {
        enc.bold(true).text(`  + ADDON: ${truncate(addon.name.toUpperCase(), cols - 4)}`).newline();
      }
    }

    // Special instructions (eliminate any "vraint = null" or null)
    const cleanNotes = item.special_instructions ? String(item.special_instructions).trim() : '';
    if (
      cleanNotes &&
      cleanNotes.toLowerCase() !== 'null' &&
      cleanNotes.toLowerCase() !== 'undefined' &&
      !/^(vraint|variant)\s*[:=]\s*null$/i.test(cleanNotes)
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

export function cleanVariant(v: any): string {
  if (!v) return '';
  if (typeof v === 'string') {
    const trimmed = v.trim();
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
        if (parsed.name) return String(parsed.name).trim();
        if (parsed.title) return String(parsed.title).trim();
        const vals = Object.values(parsed).filter((x) => x && String(x).toLowerCase() !== 'null' && String(x).toLowerCase() !== 'undefined');
        return vals.join(', ');
      }
    } catch {
      return trimmed;
    }
    return trimmed;
  }
  if (typeof v === 'object') {
    if (v.name) return String(v.name).trim();
    if (v.title) return String(v.title).trim();
    const vals = Object.values(v).filter((x) => x && String(x).toLowerCase() !== 'null' && String(x).toLowerCase() !== 'undefined');
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
