'use client';

import { useState } from 'react';
import { Printer, FileText, MessageCircle, Download, Usb, Globe, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePrinterStore } from '@/hooks/usePrinter';
import { usePosSettingsStore } from '@/store/pos-settings';
import { printerService } from '@/lib/printer/PrinterService';
import {
  createTestBill,
  createTestOrder,
  createTestTenant,
  createTestCustomer,
  createPizzaMafiaTestBill,
  createMultiItemTestBill,
} from '@/lib/printer/test-data';
import { printWebBill, generateBillHtml, type CopyType } from '@/lib/printer/web-print';
import { shareBillViaWhatsApp, getWhatsAppMessage } from '@/lib/whatsapp-share';
import toast from 'react-hot-toast';

type TestMode = 'pizza-mafia' | 'multi-item' | 'receipt' | 'gst' | 'kot' | 'web-a4' | 'whatsapp';
type PaperWidth = 58 | 80;

export default function PrintTestPage() {
  const [testMode, setTestMode] = useState<TestMode>('pizza-mafia');
  const [paperWidth, setPaperWidth] = useState<PaperWidth>(80);
  const [copyType, setCopyType] = useState<CopyType>('both');
  const [testing, setTesting] = useState(false);

  const {
    printBill,
    printGstBill,
    printKot,
    printMethod,
    setPrintMethod,
    downloadLastReceipt,
    lastPrintedBytes,
    status,
  } = usePrinterStore();

  const posSettings = usePosSettingsStore();

  const pizzaMafiaBill = createPizzaMafiaTestBill();
  const multiItemBill = createMultiItemTestBill();
  const standardTestBill = createTestBill();
  const testOrder = createTestOrder();
  const testCustomer = createTestCustomer();

  const pizzaMafiaTenant = {
    business_name: 'PIZZA MAFIA',
    currency: 'Rs',
  };

  const getActiveBill = () => {
    switch (testMode) {
      case 'pizza-mafia':
        return { bill: pizzaMafiaBill, tenant: pizzaMafiaTenant };
      case 'multi-item':
        return { bill: multiItemBill, tenant: pizzaMafiaTenant };
      default:
        return { bill: standardTestBill, tenant: pizzaMafiaTenant };
    }
  };

  const handlePrint = async () => {
    setTesting(true);
    try {
      const { bill, tenant } = getActiveBill();

      const printOpts = {
        paperWidth,
        paperSize: paperWidth === 80 ? ('thermal80' as const) : ('thermal58' as const),
        businessName: tenant.business_name,
        easypaisaNumber: posSettings.easypaisaNumber || '03001234567',
        easypaisaTitle: posSettings.easypaisaTitle || 'Muhammad Ali',
        complaintNumber: posSettings.complaintNumber || '03121234567',
        copyType,
      };

      switch (testMode) {
        case 'pizza-mafia':
        case 'multi-item':
        case 'receipt':
          if (printMethod === 'browser') {
            printWebBill(bill, tenant, printOpts);
            toast.success('80mm Browser print window opened!');
          } else {
            await printBill(bill, tenant, printOpts);
            toast.success('Thermal receipt sent to printer!');
          }
          break;

        case 'gst':
          if (printMethod === 'browser') {
            printWebBill(bill, tenant, {
              ...printOpts,
              includeGst: true,
              gstin: posSettings.billGstin || '22AAAAA0000A1Z5',
            });
            toast.success('GST Bill print window opened!');
          } else {
            await printGstBill(bill, tenant, {
              paperWidth,
              gstin: posSettings.billGstin || '22AAAAA0000A1Z5',
            });
            toast.success('GST Bill printed!');
          }
          break;

        case 'kot':
          if (printMethod === 'browser') {
            const html = generateKotHtml(testOrder, paperWidth);
            await printerService.printViaBrowser(html, paperWidth);
            toast.success('KOT print window opened!');
          } else {
            await printKot(testOrder, { paperWidth });
            toast.success('KOT printed!');
          }
          break;

        case 'web-a4':
          printWebBill(bill, tenant, { paperSize: 'a4', includeGst: true, copyType: 'customer' });
          toast.success('A4 Print dialog opened');
          break;

        case 'whatsapp':
          shareBillViaWhatsApp(bill, testCustomer, tenant as any, {
            pointsEarned: 50,
            walletBalance: 200,
          });
          toast.success('WhatsApp opened');
          break;
      }
    } catch (err) {
      toast.error(`Print failed: ${(err as Error).message}`);
    } finally {
      setTesting(false);
    }
  };

  const handleDownloadHtml = () => {
    const { bill, tenant } = getActiveBill();
    const html = generateBillHtml(bill, tenant, {
      paperSize: 'thermal80',
      businessName: tenant.business_name,
      easypaisaNumber: posSettings.easypaisaNumber || '03001234567',
      easypaisaTitle: posSettings.easypaisaTitle || 'Muhammad Ali',
      complaintNumber: posSettings.complaintNumber || '03121234567',
      copyType,
    });

    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `receipt-${testMode}.html`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Receipt HTML downloaded');
  };

  const handleCopyWhatsappText = async () => {
    const { bill, tenant } = getActiveBill();
    const message = getWhatsAppMessage(bill, tenant, {
      pointsEarned: 50,
      walletBalance: 200,
    });
    await navigator.clipboard.writeText(message);
    toast.success('WhatsApp message copied to clipboard');
  };

  const testOptions: { value: TestMode; label: string; description: string; icon: React.ElementType }[] = [
    {
      value: 'pizza-mafia',
      label: 'Pizza Mafia Reference (80mm)',
      description: 'Exact match: Order #4, 1L 7UP (Rs 170), EasyPaisa footer',
      icon: Printer,
    },
    {
      value: 'multi-item',
      label: 'Multi-Item & Modifiers (80mm)',
      description: 'Long names, addons, instructions, discount, large total',
      icon: Printer,
    },
    {
      value: 'receipt',
      label: 'Standard Receipt',
      description: 'Default test bill layout',
      icon: Printer,
    },
    {
      value: 'gst',
      label: 'GST Tax Invoice',
      description: 'With GSTIN and tax breakdown',
      icon: Printer,
    },
    {
      value: 'kot',
      label: 'KOT (Kitchen Ticket)',
      description: 'Kitchen order ticket with double height',
      icon: Printer,
    },
    {
      value: 'web-a4',
      label: 'A4 Office Print',
      description: 'Full page layout for standard printers',
      icon: FileText,
    },
    {
      value: 'whatsapp',
      label: 'WhatsApp Share',
      description: 'Formatted receipt message for customer',
      icon: MessageCircle,
    },
  ];

  const active = getActiveBill();

  return (
    <div className="min-h-screen bg-gray-50 p-6 md:p-8">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <Printer size={28} className="text-brand" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">80mm POS Thermal Receipt Tester</h1>
            <p className="text-sm text-gray-500">Preview and test the Pizza Mafia thermal receipt layout</p>
          </div>
        </div>

        {/* Test Type Selection */}
        <div className="bg-white rounded-xl border border-gray-100 p-6 mb-6 shadow-sm">
          <h2 className="font-semibold text-gray-900 mb-3">1. Select Receipt Scenario</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {testOptions.map((opt) => {
              const Icon = opt.icon;
              const isSelected = testMode === opt.value;
              return (
                <button
                  key={opt.value}
                  onClick={() => setTestMode(opt.value)}
                  className={`flex items-start gap-3 p-3 rounded-lg border text-left transition-all ${
                    isSelected
                      ? 'border-brand bg-brand/5 ring-1 ring-brand text-gray-900'
                      : 'border-gray-200 hover:border-gray-300 text-gray-700'
                  }`}
                >
                  <Icon size={18} className={isSelected ? 'text-brand mt-0.5' : 'text-gray-400 mt-0.5'} />
                  <div>
                    <div className="text-sm font-semibold">{opt.label}</div>
                    <div className="text-xs text-gray-500 mt-0.5">{opt.description}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Copies & Paper Settings */}
        <div className="bg-white rounded-xl border border-gray-100 p-6 mb-6 shadow-sm">
          <h2 className="font-semibold text-gray-900 mb-4">2. Print & Copy Options</h2>

          <div className="space-y-4">
            {/* Copy Type Selection */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Receipt Copy Mode (Requirement 6)
              </label>
              <div className="grid grid-cols-3 gap-2">
                {(['both', 'customer', 'business'] as CopyType[]).map((c) => (
                  <button
                    key={c}
                    onClick={() => setCopyType(c)}
                    className={`px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
                      copyType === c
                        ? 'border-brand bg-brand/5 text-brand ring-1 ring-brand'
                        : 'border-gray-200 hover:border-gray-300 text-gray-700'
                    }`}
                  >
                    {c === 'both' ? 'Both Copies (Dual)' : c === 'customer' ? 'Customer Copy' : 'Business Copy'}
                  </button>
                ))}
              </div>
              <p className="text-xs text-gray-500 mt-1.5">
                {copyType === 'both'
                  ? 'Prints Customer Copy, cuts paper, then prints Business Copy.'
                  : `Only prints the ${copyType === 'customer' ? 'Customer' : 'Business'} Copy.`}
              </p>
            </div>

            {/* Paper Width Selection */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Paper Width
              </label>
              <div className="flex gap-2">
                <button
                  onClick={() => setPaperWidth(80)}
                  className={`flex-1 px-4 py-2 rounded-lg border transition-colors text-sm font-medium ${
                    paperWidth === 80
                      ? 'border-brand bg-brand/5 text-brand ring-1 ring-brand'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  80mm Thermal (Standard Receipt Paper)
                </button>
                <button
                  onClick={() => setPaperWidth(58)}
                  className={`px-4 py-2 rounded-lg border transition-colors text-sm font-medium ${
                    paperWidth === 58
                      ? 'border-brand bg-brand/5 text-brand ring-1 ring-brand'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  58mm Thermal
                </button>
              </div>
            </div>

            {/* Print Method */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Print Method
              </label>
              <div className="flex gap-2">
                <button
                  onClick={() => setPrintMethod('browser')}
                  className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg border transition-colors text-sm font-medium ${
                    printMethod === 'browser'
                      ? 'border-brand bg-brand/5 text-brand ring-1 ring-brand'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <Globe size={16} />
                  Browser Print / Preview (HTML)
                </button>
                <button
                  onClick={() => setPrintMethod('escpos')}
                  className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg border transition-colors text-sm font-medium ${
                    printMethod === 'escpos'
                      ? 'border-brand bg-brand/5 text-brand ring-1 ring-brand'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <Usb size={16} />
                  ESC/POS Spooler (Desktop / WebUSB)
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-2">
                {printMethod === 'browser'
                  ? 'Opens 80mm styled thermal preview window using native print engine.'
                  : `Sends raw ESC/POS binary commands directly to default printer. Status: ${status}`}
              </p>
            </div>

            {printMethod === 'escpos' && lastPrintedBytes && (
              <div className="p-3 bg-gray-50 rounded-lg flex items-center justify-between">
                <span className="text-sm text-gray-600">
                  Last ESC/POS buffer: {lastPrintedBytes.length} bytes
                </span>
                <button
                  onClick={downloadLastReceipt}
                  className="text-sm text-brand hover:underline flex items-center gap-1 font-medium"
                >
                  <Download size={14} /> Download .bin
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap gap-3 mb-6">
          <Button
            onClick={handlePrint}
            disabled={testing}
            className="flex-1 bg-brand text-white hover:opacity-90 font-semibold"
            size="lg"
          >
            {testing ? 'Printing...' : '🖨️ Run Print Test'}
          </Button>

          <Button
            onClick={handleDownloadHtml}
            variant="outline"
            size="lg"
            className="border-gray-300"
          >
            <Download size={18} className="mr-2" />
            Download HTML
          </Button>

          {testMode === 'whatsapp' && (
            <Button
              onClick={handleCopyWhatsappText}
              variant="outline"
              size="lg"
            >
              <Copy size={16} className="mr-2" />
              Copy Text
            </Button>
          )}
        </div>

        {/* Live Active Data Summary */}
        <div className="bg-white rounded-xl border border-gray-100 p-6 shadow-sm">
          <h3 className="font-semibold text-gray-900 mb-2">Active Test Order Preview</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
            <div className="bg-gray-50 p-3 rounded-lg">
              <span className="text-gray-500 block">Order #:</span>
              <span className="font-bold text-gray-800 text-sm">{active.bill.order?.order_number}</span>
            </div>
            <div className="bg-gray-50 p-3 rounded-lg">
              <span className="text-gray-500 block">Customer:</span>
              <span className="font-bold text-gray-800 text-sm">{active.bill.order?.customer?.name || 'Walk-in'}</span>
            </div>
            <div className="bg-gray-50 p-3 rounded-lg">
              <span className="text-gray-500 block">Items Count:</span>
              <span className="font-bold text-gray-800 text-sm">{active.bill.order?.items?.length} item(s)</span>
            </div>
            <div className="bg-gray-50 p-3 rounded-lg">
              <span className="text-gray-500 block">Total:</span>
              <span className="font-bold text-brand text-sm">Rs {active.bill.total}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function generateKotHtml(
  order: ReturnType<typeof createTestOrder>,
  paperWidth: 58 | 80
): string {
  const fontSize = paperWidth === 58 ? '10px' : '12px';
  const padding = paperWidth === 58 ? '4px' : '6px';
  
  const items = order.items || [];
  const rows = items.map((item, idx) => `
    <tr>
      <td style="font-size:${fontSize};padding:${padding};">${idx + 1}. ${item.product_name}</td>
      <td style="font-size:${fontSize};padding:${padding};text-align:right;font-weight:bold;">${item.quantity}</td>
    </tr>
  `).join('');

  return `
    <div style="text-align:center;padding:${padding};font-family:'Courier New',monospace;font-size:${fontSize};">
      <h2 style="margin:0;font-size:${paperWidth === 58 ? '14px' : '16px'};">KOT</h2>
      <p style="margin:2px 0;">Order #: ${order.order_number}</p>
      <p style="margin:2px 0;">${new Date(order.created_at).toLocaleString()}</p>
      <hr style="border:1px dashed #000;margin:4px 0;">
      <table style="width:100%;border-collapse:collapse;font-size:${fontSize};">
        <tbody>
          ${rows}
        </tbody>
      </table>
      <hr style="border:1px dashed #000;margin:8px 0;">
    </div>
  `;
}
