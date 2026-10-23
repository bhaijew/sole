/**
 * web-print.ts
 *
 * 80mm Thermal Receipt Print Template & Native Browser Printing.
 * Matches the Pizza Mafia reference design with clean 3-column items table,
 * centered header, prominent centered total, payment details, and dual-copy
 * (Customer Copy & Business Copy) support.
 */

import type { Bill, Tenant, Order, OrderItem } from '@/lib/types';

export type PaperSize = 'a4' | 'a5' | 'thermal58' | 'thermal80';
export type CopyType = 'customer' | 'business' | 'both';

export interface WebPrintOptions {
  paperSize?: PaperSize;
  includeGst?: boolean;
  gstin?: string;
  address?: string;
  phone?: string;
  footerNote?: string;
  businessName?: string;
  easypaisaNumber?: string;
  easypaisaTitle?: string;
  complaintNumber?: string;
  copyType?: CopyType;
}

/**
 * Open browser print dialog with the 80mm thermal receipt HTML.
 */
export function printWebBill(
  bill: Bill,
  tenant: Pick<Tenant, 'business_name' | 'currency'>,
  opts: WebPrintOptions = {}
): void {
  const html = generateBillHtml(bill, tenant, opts);

  const printWindow = window.open('', '_blank', 'width=450,height=750');
  if (!printWindow) {
    alert('Please allow popups to print receipts');
    return;
  }

  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();

  printWindow.onload = () => {
    printWindow.focus();
    printWindow.print();
  };
}

/**
 * Generate complete HTML document for 80mm thermal receipt.
 * Supports 'customer', 'business', or 'both' copies.
 */
export function generateBillHtml(
  bill: Bill,
  tenant: Pick<Tenant, 'business_name' | 'currency'>,
  opts: WebPrintOptions = {}
): string {
  const { copyType = 'both' } = opts;

  let copiesHtml = '';
  if (copyType === 'both') {
    copiesHtml = `
      ${renderSingleReceipt(bill, tenant, opts, 'Customer Copy')}
      <div class="page-break-divider"></div>
      ${renderSingleReceipt(bill, tenant, opts, 'Business Copy')}
    `;
  } else if (copyType === 'business') {
    copiesHtml = renderSingleReceipt(bill, tenant, opts, 'Business Copy');
  } else {
    copiesHtml = renderSingleReceipt(bill, tenant, opts, 'Customer Copy');
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Receipt - Order #${bill.order?.order_number || bill.bill_number}</title>
  <style>
    /* CSS Reset */
    *, *::before, *::after {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    /* Print & Paper Setup for 80mm Thermal Printer */
    @page {
      size: 80mm auto;
      margin: 0mm;
    }

    body {
      background-color: #f3f4f6;
      color: #000000;
      font-family: 'Courier New', Courier, 'Lucida Console', Monaco, monospace;
      font-size: 14px;
      line-height: 1.3;
      padding: 20px 0;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }

    /* Screen view wrapper */
    .receipt-screen-wrapper {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 16px;
      width: 100%;
    }

    /* Top control toolbar (hidden in print) */
    .no-print {
      margin-bottom: 8px;
      display: flex;
      gap: 8px;
    }
    .print-btn {
      background: #111827;
      color: #ffffff;
      border: none;
      border-radius: 6px;
      padding: 8px 16px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      font-family: sans-serif;
      box-shadow: 0 1px 3px rgba(0,0,0,0.2);
    }
    .print-btn:hover {
      background: #374151;
    }
    .close-btn {
      background: #e5e7eb;
      color: #374151;
      border: none;
      border-radius: 6px;
      padding: 8px 14px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      font-family: sans-serif;
    }

    /* Thermal 80mm Receipt Card */
    .receipt-card {
      width: 72mm;
      max-width: 72mm;
      background: #ffffff;
      padding: 5mm 3mm;
      margin: 0 auto;
      border: 1px solid #e5e7eb;
      box-shadow: 0 4px 10px rgba(0, 0, 0, 0.08);
      page-break-inside: avoid;
      break-inside: avoid;
    }

    /* Screen Tear-off indicator */
    .page-break-divider {
      width: 72mm;
      border-top: 2px dashed #9ca3af;
      margin: 12px auto;
      text-align: center;
      position: relative;
    }
    .page-break-divider::after {
      content: "✂ Tear / Second Copy ✂";
      position: absolute;
      top: -8px;
      left: 50%;
      transform: translateX(-50%);
      background: #f3f4f6;
      padding: 0 8px;
      font-size: 10px;
      font-family: sans-serif;
      color: #6b7280;
    }

    /* Header */
    .receipt-header {
      text-align: center;
      margin-bottom: 6px;
    }
    .restaurant-name {
      font-size: 26px;
      font-weight: 900;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      line-height: 1.15;
      margin-bottom: 2px;
    }
    .copy-label {
      font-size: 15px;
      font-weight: 700;
      margin-bottom: 4px;
      text-transform: capitalize;
    }
    .header-info-line {
      font-size: 14px;
      line-height: 1.35;
      margin: 1px 0;
    }

    /* Separators */
    .dashed-line {
      border: none;
      border-top: 1px dashed #000000;
      margin: 6px 0;
      width: 100%;
    }

    /* 3-Column Items Table */
    .items-table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      margin: 2px 0 6px 0;
    }
    .items-table thead th {
      font-size: 14px;
      font-weight: bold;
      padding: 4px 0;
      border-bottom: 1px dashed #000000;
    }
    .items-table tbody td {
      font-size: 14px;
      padding: 3px 0;
      vertical-align: top;
      word-wrap: break-word;
      overflow-wrap: break-word;
    }

    .col-item {
      text-align: left;
      width: 58%;
      padding-right: 4px;
    }
    .col-qty {
      text-align: right;
      width: 18%;
      padding-right: 4px;
      font-weight: 600;
    }
    .col-price {
      text-align: right;
      width: 24%;
      font-weight: 600;
    }

    .item-name {
      font-weight: 500;
      line-height: 1.25;
    }
    .item-addon {
      font-size: 12px;
      padding-left: 8px;
      line-height: 1.25;
    }
    .item-note {
      font-size: 12px;
      padding-left: 8px;
      font-style: italic;
      line-height: 1.25;
    }

    /* Calculation breakdown rows */
    .breakdown-row {
      display: flex;
      justify-content: space-between;
      font-size: 13px;
      line-height: 1.35;
      padding: 1px 0;
    }

    /* Prominent Centered Total */
    .total-section {
      text-align: center;
      margin: 6px 0;
    }
    .total-amount {
      font-size: 22px;
      font-weight: 900;
      letter-spacing: 0.5px;
    }

    /* Payment & Contact Info */
    .payment-info {
      font-size: 13.5px;
      line-height: 1.4;
      margin-top: 4px;
      text-align: left;
    }

    /* Thank You */
    .thank-you {
      font-size: 17px;
      font-weight: bold;
      text-align: center;
      margin-top: 8px;
      margin-bottom: 2px;
    }

    /* Print Media Query */
    @media print {
      body {
        background: #ffffff !important;
        padding: 0 !important;
        margin: 0 !important;
        width: 80mm !important;
      }
      .no-print {
        display: none !important;
      }
      .receipt-screen-wrapper {
        gap: 0 !important;
        width: 80mm !important;
      }
      .receipt-card {
        width: 72mm !important;
        max-width: 72mm !important;
        margin: 0 auto !important;
        padding: 2mm 1mm !important;
        border: none !important;
        box-shadow: none !important;
        page-break-inside: avoid !important;
        break-inside: avoid !important;
      }
      .page-break-divider {
        page-break-after: always !important;
        break-after: page !important;
        height: 0 !important;
        margin: 0 !important;
        border: none !important;
      }
      .page-break-divider::after {
        display: none !important;
      }
    }
  </style>
</head>
<body>
  <div class="receipt-screen-wrapper">
    <div class="no-print">
      <button class="print-btn" onclick="window.print()">🖨️ Print Receipt</button>
      <button class="close-btn" onclick="window.close()">Close</button>
    </div>

    ${copiesHtml}
  </div>
</body>
</html>`;
}

/**
 * Render a single receipt block (Customer Copy or Business Copy)
 */
function renderSingleReceipt(
  bill: Bill,
  tenant: Pick<Tenant, 'business_name' | 'currency'>,
  opts: WebPrintOptions,
  copyLabel: 'Customer Copy' | 'Business Copy'
): string {
  const order = bill.order;
  const displayName = opts.businessName || tenant.business_name || 'PIZZA MAFIA';
  const orderNumber = order?.order_number || bill.bill_number || '1';

  // Format date and time
  const createdDate = order?.created_at ? new Date(order.created_at) : ((bill as any)?.created_at ? new Date((bill as any).created_at) : new Date());
  const dateFormatted = formatReceiptDate(createdDate);
  const timeFormatted = formatReceiptTime(createdDate);

  // Order type: Takeaway, Dine-in, Delivery, etc.
  const orderType = formatOrderType(order?.type || (order as any)?.order_type);

  // Customer Name
  const customerName = order?.customer?.name || (order as any)?.customer_name || 'Walk-in';

  // Items
  const items = order?.items || [];

  // Totals & charges
  const subtotal = Number(bill.subtotal || order?.subtotal || bill.total || 0);
  const total = Number(bill.total || order?.total || 0);
  const discount = Number(bill.discount_amount || order?.discount_amount || 0);
  const delivery = Number(bill.delivery_charge || (order as any)?.delivery_charge || 0);
  const tax = Number(bill.tax_amount || order?.tax_amount || 0);

  const hasBreakdown = discount > 0 || delivery > 0 || tax > 0;

  // Payment Details & Contact Info from settings
  const easypaisaNumber = opts.easypaisaNumber || '';
  const easypaisaTitle = opts.easypaisaTitle || '';
  const complaintNumber = opts.complaintNumber || opts.phone || '';

  return `
    <div class="receipt-card">
      <!-- 2. Receipt Header -->
      <div class="receipt-header">
        <div class="restaurant-name">${escapeHtml(displayName)}</div>
        <div class="copy-label">${escapeHtml(copyLabel)}</div>
        <div class="header-info-line">Order #: ${escapeHtml(String(orderNumber))}</div>
        <div class="header-info-line">Date: ${escapeHtml(dateFormatted)}</div>
        <div class="header-info-line">Time: ${escapeHtml(timeFormatted)}</div>
        <div class="header-info-line">Type: ${escapeHtml(orderType)}</div>
        <div class="header-info-line">Name: ${escapeHtml(customerName)}</div>
      </div>

      <!-- 3. Items Table -->
      <table class="items-table">
        <thead>
          <tr>
            <th class="col-item">Item</th>
            <th class="col-qty">Quantity</th>
            <th class="col-price">Price</th>
          </tr>
        </thead>
        <tbody>
          ${items.map((item) => renderItemRow(item)).join('')}
        </tbody>
      </table>

      <!-- Breakdown if discount or taxes exist -->
      ${hasBreakdown ? `
        <div style="margin: 4px 0;">
          <div class="breakdown-row"><span>Subtotal:</span><span>${formatPrice(subtotal)}</span></div>
          ${discount > 0 ? `<div class="breakdown-row"><span>Discount:</span><span>-${formatPrice(discount)}</span></div>` : ''}
          ${delivery > 0 ? `<div class="breakdown-row"><span>Delivery:</span><span>${formatPrice(delivery)}</span></div>` : ''}
          ${tax > 0 ? `<div class="breakdown-row"><span>Tax:</span><span>${formatPrice(tax)}</span></div>` : ''}
        </div>
      ` : ''}

      <hr class="dashed-line" />

      <!-- 4. Total Section -->
      <div class="total-section">
        <div class="total-amount">TOTAL: Rs ${formatPrice(total)}</div>
      </div>

      <hr class="dashed-line" />

      <!-- 5. Payment and Footer -->
      <div class="payment-info">
        ${easypaisaNumber ? `<div>EasyPaisa: ${escapeHtml(easypaisaNumber)}</div>` : ''}
        ${easypaisaTitle ? `<div>${escapeHtml(easypaisaTitle)}</div>` : ''}
        ${complaintNumber ? `<div>Complaint: ${escapeHtml(complaintNumber)}</div>` : ''}
        ${opts.footerNote ? `<div style="margin-top:2px;">${escapeHtml(opts.footerNote)}</div>` : ''}
      </div>

      <div class="thank-you">Thank You!</div>
    </div>
  `;
}

/**
 * Render individual product item row with modifiers and special instructions.
 */
function renderItemRow(item: OrderItem): string {
  const name = item.product_name || 'Item';
  const qty = item.quantity || 1;
  const itemTotal = Number(item.total ?? (Number(item.unit_price || 0) * qty));

  // Parse addons
  let addonsHtml = '';
  if (item.addons) {
    const parsedAddons = Array.isArray(item.addons)
      ? item.addons
      : typeof item.addons === 'string'
      ? (() => { try { return JSON.parse(item.addons); } catch { return []; } })()
      : [];

    if (Array.isArray(parsedAddons) && parsedAddons.length > 0) {
      addonsHtml = parsedAddons
        .map((a: any) => {
          const addonPrice = a.price ? ` (Rs ${formatPrice(a.price)})` : '';
          return `<div class="item-addon">+ ${escapeHtml(a.name || a.addon_name || 'Addon')}${addonPrice}</div>`;
        })
        .join('');
    }
  }

  // Instructions
  const noteHtml = item.special_instructions
    ? `<div class="item-note">>> ${escapeHtml(item.special_instructions)}</div>`
    : '';

  return `
    <tr>
      <td class="col-item">
        <div class="item-name">${escapeHtml(name)}</div>
        ${addonsHtml}
        ${noteHtml}
      </td>
      <td class="col-qty">${qty}</td>
      <td class="col-price">${formatPrice(itemTotal)}</td>
    </tr>
  `;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function formatPrice(amount: number | string): string {
  const n = Number(amount) || 0;
  // If whole number, show integer, else 2 decimals
  if (Number.isInteger(n)) {
    return String(n);
  }
  return n.toFixed(2);
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
