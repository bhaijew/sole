'use client';

import { useEffect } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { printerService, type PrinterStatus, type PrinterInfo, type PrintMode } from '@/lib/printer/PrinterService';
import {
  buildClassicReceiptBytes,
  buildCompactReceiptBytes,
  buildDetailedReceiptBytes,
  type ReceiptOptions,
} from '@/lib/printer/receipt-encoder';
import { usePosSettingsStore } from '@/store/pos-settings';
import { buildGstBillBytes, type GstBillOptions } from '@/lib/printer/gst-bill-encoder';
import { buildKotBytes, type KotOptions } from '@/lib/printer/kot-encoder';
import type { Bill, Tenant, Order } from '@/lib/types';
import api from '@/lib/api';

type PrintModeType = 'receipt' | 'gst' | 'kot';
type PaperWidth = 58 | 80;

interface PrinterState {
  status: PrinterStatus;
  deviceInfo: PrinterInfo | null;
  lastError: string | null;
  lastPrintedBytes: Uint8Array | null;
  printMode: PrintModeType;
  paperWidth: PaperWidth;
  printMethod: PrintMode;

  backendPrinter: any | null;
  refreshBackendPrinter: () => Promise<void>;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  printBill: (bill: Bill, tenant: Pick<Tenant, 'business_name' | 'currency'>, opts?: ReceiptOptions) => Promise<void>;
  printGstBill: (bill: Bill, tenant: Pick<Tenant, 'business_name' | 'currency'>, opts?: GstBillOptions) => Promise<void>;
  printKot: (order: Order, opts?: KotOptions) => Promise<void>;
  setPrintMode: (mode: PrintModeType) => void;
  setPaperWidth: (width: PaperWidth) => void;
  setPrintMethod: (method: PrintMode) => void;
  clearError: () => void;
  downloadLastReceipt: () => void;
  copyLastReceiptHex: () => Promise<void>;
}

export const usePrinterStore = create<PrinterState>()(
  persist(
    (set, get) => ({
      status: 'disconnected',
      deviceInfo: null,
      backendPrinter: null,
      lastError: null,
      lastPrintedBytes: null,
      printMode: 'receipt',
      paperWidth: 58,
      printMethod: 'escpos',

      refreshBackendPrinter: async () => {
        try {
          const res = await api.get('/printers');
          const printers = res.data?.printers || [];
          const defaultP = printers.find((p: any) => p.is_default) || printers[0] || null;
          set({ backendPrinter: defaultP });
          if (defaultP && !printerService.isConnected) {
            set({
              status: 'connected',
              deviceInfo: {
                vendorId: 0,
                productId: 0,
                productName: defaultP.name,
                manufacturerName: `${defaultP.connection_type.toUpperCase()} Thermal Printer`,
              },
              paperWidth: defaultP.paper_width === '58mm' ? 58 : 80,
            });
          }
        } catch {
          // Pure browser mode or backend offline
        }
      },

      connect: async () => {
        set({ lastError: null });
        try {
          await printerService.connect();
        } catch (err) {
          set({ lastError: (err as Error).message });
          // If WebUSB fails, try refreshing desktop backend printer
          await get().refreshBackendPrinter();
        }
      },

      disconnect: async () => {
        await printerService.disconnect();
        set({ status: 'disconnected', deviceInfo: null });
      },

      printBill: async (bill, tenant, opts) => {
        set({ lastError: null });
        try {
          const {
            billTemplate,
            billGstin, billAddress, billPhone, billFooterMessage,
            billShowName, billShowAddress, billShowPhone, billShowGstn,
            webPrintSize,
          } = usePosSettingsStore.getState();

          if (get().printMethod === 'browser') {
            // Browser / A4 print path
            const { printWebBill } = await import('@/lib/printer/web-print');
            printWebBill(bill, tenant, {
              paperSize: webPrintSize,
              includeGst: billShowGstn,
              gstin: billShowGstn && billGstin ? billGstin : undefined,
              address: billShowAddress && billAddress ? billAddress : undefined,
              phone: billShowPhone && billPhone ? billPhone : undefined,
              footerNote: billFooterMessage || undefined,
              businessName: billShowName ? tenant.business_name : undefined,
            });
            return;
          }

          // ESC/POS thermal path
          const { paperWidth } = get();
          const builderOpts: ReceiptOptions = {
            ...opts,
            paperWidth,
            gstin: billShowGstn && billGstin ? billGstin : undefined,
            address: billShowAddress && billAddress ? billAddress : undefined,
            phone: billShowPhone && billPhone ? billPhone : undefined,
            footerNote: billFooterMessage || undefined,
            showTaxBreakdown: billShowGstn,
          };

          let bytes: Uint8Array;
          if (billTemplate === 'compact') {
            bytes = buildCompactReceiptBytes(bill, tenant, builderOpts);
          } else if (billTemplate === 'detailed') {
            bytes = buildDetailedReceiptBytes(bill, tenant, builderOpts);
          } else {
            bytes = buildClassicReceiptBytes(bill, tenant, builderOpts);
          }

          set({ lastPrintedBytes: bytes });

          if (printerService.isConnected) {
            await printerService.print(bytes);
          } else {
            // Desktop backend printer path
            try {
              const res = await api.post('/printers/print-bill', {
                billId: bill.id,
                orderId: bill.order_id,
              });
              if (!res.data?.success) {
                throw new Error(res.data?.error || 'Failed to print bill');
              }
            } catch (backendErr: any) {
              const errMsg = backendErr.response?.data?.error || backendErr.message || 'Thermal printer error';
              throw new Error(errMsg);
            }
          }
        } catch (err) {
          set({ lastError: (err as Error).message });
          throw err;
        }
      },

      printGstBill: async (bill, tenant, opts) => {
        set({ lastError: null });
        try {
          const { paperWidth } = get();
          const bytes = buildGstBillBytes(bill, tenant, { ...opts, paperWidth });
          set({ lastPrintedBytes: bytes });
          
          if (get().printMethod === 'escpos') {
            if (printerService.isConnected) {
              await printerService.print(bytes);
            } else {
              try {
                const res = await api.post('/printers/print-bill', {
                  billId: bill.id,
                  orderId: bill.order_id,
                });
                if (!res.data?.success) {
                  throw new Error(res.data?.error || 'Failed to print GST bill');
                }
              } catch (backendErr: any) {
                const errMsg = backendErr.response?.data?.error || backendErr.message || 'Thermal printer error';
                throw new Error(errMsg);
              }
            }
          } else {
            throw new Error('Browser print mode - use printViaBrowser instead');
          }
        } catch (err) {
          set({ lastError: (err as Error).message });
          throw err;
        }
      },

      printKot: async (order, opts) => {
        set({ lastError: null });
        try {
          const { paperWidth } = get();
          const bytes = buildKotBytes(order, { ...opts, paperWidth });
          set({ lastPrintedBytes: bytes });
          
          if (get().printMethod === 'escpos') {
            if (printerService.isConnected) {
              await printerService.print(bytes);
            } else {
              try {
                const res = await api.post('/printers/print-kot', {
                  orderId: order.id,
                  items: order.items,
                });
                if (!res.data?.success) {
                  throw new Error(res.data?.error || 'Failed to print KOT');
                }
              } catch (backendErr: any) {
                const errMsg = backendErr.response?.data?.error || backendErr.message || 'Thermal printer error';
                throw new Error(errMsg);
              }
            }
          } else {
            throw new Error('Browser print mode - use printViaBrowser instead');
          }
        } catch (err) {
          set({ lastError: (err as Error).message });
          throw err;
        }
      },

      setPrintMode: (mode) => set({ printMode: mode }),
      setPaperWidth: (width) => set({ paperWidth: width }),
      setPrintMethod: (method) => {
        printerService.setPrintMode(method);
        set({ printMethod: method, lastError: null });
      },

      clearError: () => set({ lastError: null }),

      downloadLastReceipt: () => {
        const bytes = get().lastPrintedBytes;
        if (!bytes) return;
        const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'receipt.bin';
        a.click();
        URL.revokeObjectURL(url);
      },

      copyLastReceiptHex: async () => {
        const bytes = get().lastPrintedBytes;
        if (!bytes) return;
        const hex = Array.from(bytes)
          .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
          .join(' ');
        await navigator.clipboard.writeText(hex);
      },
    }),
    {
      name: 'flo-printer-settings',
      partialize: (state) => ({ printMode: state.printMode, paperWidth: state.paperWidth, printMethod: state.printMethod }),
    }
  )
);

export function usePrinterStatusSync(): void {
  useEffect(() => {
    // 1. Initial WebUSB check
    if (printerService.isConnected) {
      usePrinterStore.setState({
        status: printerService.status,
        deviceInfo: printerService.deviceInfo,
      });
    }

    // 2. Sync with desktop backend printer
    usePrinterStore.getState().refreshBackendPrinter();

    // 3. Listen to WebUSB changes
    const unsub = printerService.onStatusChange((status, info) => {
      if (status === 'connected') {
        usePrinterStore.setState({
          status,
          deviceInfo: info ?? printerService.deviceInfo,
        });
      } else {
        usePrinterStore.getState().refreshBackendPrinter();
      }
    });

    return unsub;
  }, []);
}
