'use client';

/**
 * PrinterStatus — toolbar button that shows printer connection state and
 * exposes connect / disconnect actions.
 *
 * Place it in the POS page header or sidebar header alongside other toolbar
 * icons.  Example:
 *
 *   <PrinterStatus currency={currency} />
 *
 * The `navigator.usb.requestDevice` picker is only opened on an explicit user
 * click, satisfying the browser's "transient user activation" requirement.
 */

import { useState } from 'react';
import {
  Printer,
  PrinterCheck,
  PrinterX,
  Loader2,
  Unplug,
  ChevronDown,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { usePrinterStore, usePrinterStatusSync } from '@/hooks/usePrinter';
import type { PrinterStatus } from '@/lib/printer/PrinterService';
import toast from 'react-hot-toast';
import api from '@/lib/api';

const STATUS_CONFIG: Record<
  PrinterStatus,
  { label: string; color: string; Icon: React.ElementType }
> = {
  disconnected: {
    label: 'No Printer',
    color: 'text-gray-400',
    Icon: Printer,
  },
  connecting: {
    label: 'Connecting…',
    color: 'text-amber-500',
    Icon: Loader2,
  },
  connected: {
    label: 'Printer Ready',
    color: 'text-green-600',
    Icon: PrinterCheck,
  },
  error: {
    label: 'Printer Error',
    color: 'text-red-500',
    Icon: PrinterX,
  },
};

export default function PrinterStatus() {
  usePrinterStatusSync();

  const {
    status, deviceInfo, lastError,
    connect, disconnect, clearError,
    printMethod,
  } = usePrinterStore();

  const cfg = STATUS_CONFIG[status];
  const Icon = cfg.Icon;

  const handleConnect = async () => {
    clearError();
    await connect();
    if (usePrinterStore.getState().status === 'connected') {
      toast.success('Printer connected');
    } else if (usePrinterStore.getState().lastError) {
      toast.error(usePrinterStore.getState().lastError!);
    }
  };

  const handleDisconnect = async () => {
    await disconnect();
    toast('Printer disconnected');
  };

  const [testing, setTesting] = useState(false);

  const handleTestPrint = async () => {
    setTesting(true);
    try {
      const printer = usePrinterStore.getState().backendPrinter;
      let targetId = printer?.id;

      if (!targetId) {
        const res = await api.get('/printers');
        targetId = res.data?.printers?.[0]?.id;
      }

      if (targetId) {
        const res = await api.post(`/printers/${targetId}/test`);
        if (res.data?.success) {
          toast.success('Test print sent to printer!');
        } else {
          toast.error(res.data?.error || 'Test print failed');
        }
      } else {
        toast.error('No printer configured to test');
      }
    } catch (err: any) {
      toast.error('Test print failed: ' + (err.response?.data?.error || err.message));
    } finally {
      setTesting(false);
    }
  };

  const handleDetect = async () => {
    try {
      const res = await api.get('/printers/detect');
      const detected = res.data?.printers || [];
      if (detected.length > 0) {
        toast.success(`Found ${detected.length} printer: ${detected[0].name}`);
        await usePrinterStore.getState().refreshBackendPrinter();
      } else {
        toast('No thermal printers detected on USB.');
      }
    } catch (err: any) {
      toast.error('Detection failed: ' + (err.response?.data?.error || err.message));
    }
  };

  const isConnected = status === 'connected';
  const isConnecting = status === 'connecting';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={`flex items-center gap-1.5 ${cfg.color} border-current/30`}
        >
          <Icon
            size={16}
            className={isConnecting ? 'animate-spin' : undefined}
          />
          <span className="hidden sm:inline text-xs font-medium">
            {cfg.label}
          </span>
          <ChevronDown size={12} className="text-gray-400" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-xs text-gray-500">
          Thermal Receipt Printer
        </DropdownMenuLabel>

        {isConnected && deviceInfo && (
          <div className="px-2 py-1.5 text-xs text-gray-500 border-b border-gray-100">
            <p className="font-semibold text-gray-800 truncate">
              {deviceInfo.productName ?? 'Thermal Printer'}
            </p>
            <p className="text-[11px] text-gray-400">
              {deviceInfo.manufacturerName ?? 'Connected'}
            </p>
          </div>
        )}

        {lastError && (
          <div className="px-2 py-1.5 text-xs text-red-600 bg-red-50 rounded mx-1 my-1">
            {lastError}
          </div>
        )}

        <DropdownMenuSeparator />

        {isConnected && (
          <DropdownMenuItem
            onClick={handleTestPrint}
            disabled={testing}
            className="text-sm cursor-pointer text-brand focus:text-brand"
          >
            <Printer size={14} className="mr-2" />
            {testing ? 'Printing test...' : 'Test Print'}
          </DropdownMenuItem>
        )}

        <DropdownMenuItem
          onClick={handleDetect}
          className="text-sm cursor-pointer"
        >
          <PrinterCheck size={14} className="mr-2" />
          Scan / Detect Printers
        </DropdownMenuItem>

        {printMethod === 'escpos' && (
          <>
            {!isConnected && !isConnecting && (
              <DropdownMenuItem
                onClick={handleConnect}
                disabled={isConnecting}
                className="text-sm cursor-pointer"
              >
                <Printer size={14} className="mr-2" />
                {isConnecting ? 'Connecting…' : 'Connect WebUSB Printer'}
              </DropdownMenuItem>
            )}

            {isConnected && (
              <DropdownMenuItem
                onClick={handleDisconnect}
                className="text-sm cursor-pointer text-red-600 focus:text-red-600"
              >
                <Unplug size={14} className="mr-2" />
                Disconnect
              </DropdownMenuItem>
            )}
          </>
        )}

        {printMethod === 'browser' && (
          <div className="px-2 py-1.5 text-xs text-gray-500">
            Browser print mode — change in Settings
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
