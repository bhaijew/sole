'use client';

import { useState, useEffect } from 'react';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { Separator } from '@/components/ui/separator';
import Link from 'next/link';
import { ClipboardList, Globe, UtensilsCrossed } from 'lucide-react';
import PrinterStatus from './PrinterStatus';
import CloudSyncStatus from './CloudSyncStatus';
import CashierBadge from './CashierBadge';
import api from '@/lib/api';

export default function PosTopbar() {
  const [onlinePendingCount, setOnlinePendingCount] = useState<number>(0);

  useEffect(() => {
    const checkOnlineOrders = async () => {
      try {
        const res = await api.get('/orders?status=pending&today=1');
        const orders = res.data?.orders || [];
        const onlinePending = orders.filter(
          (o: any) => o.order_source === 'online' || o.type === 'online'
        ).length;
        setOnlinePendingCount(onlinePending);
      } catch {
        // Fallback
      }
    };

    checkOnlineOrders();
    const interval = setInterval(checkOnlineOrders, 8000);

    const handleSync = () => checkOnlineOrders();
    window.addEventListener('flo:order-synced', handleSync);
    window.addEventListener('flo:online-order-received', handleSync);

    return () => {
      clearInterval(interval);
      window.removeEventListener('flo:order-synced', handleSync);
      window.removeEventListener('flo:online-order-received', handleSync);
    };
  }, []);

  return (
    <div className="flex items-center justify-between border-b bg-white shrink-0 px-4 h-12">
      {/* Sidebar toggle */}
      <div className="flex items-center gap-2">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="!h-4 hidden md:block" />
      </div>

      {/* Status items (Tables, Orders, Online Badge, Cloud Sync, Printer, Cashier) */}
      <div className="flex items-center gap-2">
        {/* Tables link */}
        <Link
          href="/tables"
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-bold transition-all border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 shadow-2xs"
          title="Live Tables Management (Pizza System)"
        >
          <UtensilsCrossed size={14} className="text-slate-500" />
          <span className="hidden sm:inline">Tables</span>
        </Link>

        {/* Orders link with dynamic Online Pending Badge */}
        <Link
          href="/orders"
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-bold transition-all ${
            onlinePendingCount > 0
              ? 'bg-purple-600 text-white border-purple-700 shadow-sm animate-pulse'
              : 'border-orange-200 bg-orange-50 text-orange-700 hover:bg-orange-100'
          }`}
          title={onlinePendingCount > 0 ? `${onlinePendingCount} Online Order(s) waiting!` : 'Orders Management'}
        >
          {onlinePendingCount > 0 ? <Globe size={14} className="animate-spin text-purple-200" /> : <ClipboardList size={14} />}
          <span className="hidden sm:inline">Orders</span>
          {onlinePendingCount > 0 && (
            <span className="bg-white text-purple-700 text-[10px] px-1.5 py-0.2 rounded-full font-black">
              {onlinePendingCount} NEW
            </span>
          )}
        </Link>

        <CloudSyncStatus />
        <PrinterStatus />
        <CashierBadge />
      </div>
    </div>
  );
}
