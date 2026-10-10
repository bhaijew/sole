'use client';

import { useState, useEffect } from 'react';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { Separator } from '@/components/ui/separator';
import Link from 'next/link';
import { ClipboardList, Globe, Bell } from 'lucide-react';
import PrinterStatus from './PrinterStatus';
import CustomerSearch from './CustomerSearch';
import CloudSyncStatus from './CloudSyncStatus';
import CashierBadge from './CashierBadge';
import api from '@/lib/api';

export default function PosTopbar() {
  const [onlinePendingCount, setOnlinePendingCount] = useState<number>(0);

  useEffect(() => {
    const checkOnlineOrders = async () => {
      try {
        const res = await api.get('/orders?status=pending');
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
    <div className="
      grid items-center gap-x-2 border-b bg-white shrink-0 px-4
      grid-cols-[auto_1fr_auto] gap-y-2 py-2
      md:grid-cols-[auto_auto_1fr_auto] md:h-12 md:py-0 md:gap-y-0
    ">
      {/* Col 1, Row 1: sidebar toggle */}
      <SidebarTrigger className="-ml-1" />

      {/* Col 2, Row 1: separator — desktop only */}
      <Separator orientation="vertical" className="!h-4 hidden md:block" />

      {/* Customer search:
          Mobile  → col 1-3, row 2 (full width below toggle+printer)
          Desktop → col 3,   row 1 (fills remaining space) */}
      <div className="col-span-3 row-start-2 md:col-span-1 md:col-start-3 md:row-start-1">
        <CustomerSearch variant="topbar" />
      </div>

      {/* Status items (Orders, Online Badge, Cloud Sync, Printer, Cashier):
          Mobile  → col 3, row 1 (right side, same row as toggle)
          Desktop → col 4, row 1 */}
      <div className="col-start-3 row-start-1 md:col-start-4 md:row-start-1 flex items-center gap-2">
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
