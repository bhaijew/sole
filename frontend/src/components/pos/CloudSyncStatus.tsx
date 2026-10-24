'use client';

import { useState, useEffect } from 'react';
import { RefreshCw, Store } from 'lucide-react';
import api from '@/lib/api';
import toast from 'react-hot-toast';

export default function CloudSyncStatus() {
  const [status, setStatus] = useState<any>(null);
  const [syncing, setSyncing] = useState(false);

  const fetchStatus = async () => {
    try {
      const res = await api.get('/cloud-sync/status');
      if (res.data?.success) {
        setStatus(res.data);
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 30000);

    // 1. Electron IPC Listener for live Realtime events from Main process
    if (typeof window !== 'undefined' && (window as any).electronAPI?.onCloudSyncEvent) {
      (window as any).electronAPI.onCloudSyncEvent((data: any) => {
        if (!data) return;
        if (data.event === 'menu-updated') {
          toast.success('🍕 Live Menu updated from Pizza System!');
          window.dispatchEvent(new Event('flo:menu-synced'));
        } else if (data.event === 'staff-updated') {
          toast.success('👤 Staff updated from Cloud!');
          window.dispatchEvent(new Event('flo:staff-synced'));
        } else if (data.event === 'online-order-received') {
          toast.success(`🔔 New Online Order #${data.orderNumber || ''}! Printing KOT...`, { duration: 5000 });
          window.dispatchEvent(new Event('flo:order-synced'));
        } else if (data.event === 'order-deleted') {
          toast('🗑️ Order removed from Pizza Admin', { icon: 'ℹ️' });
          window.dispatchEvent(new Event('flo:order-deleted'));
          window.dispatchEvent(new Event('flo:order-synced'));
        } else if (data.event === 'order-status-updated') {
          window.dispatchEvent(new Event('flo:order-status-updated'));
          window.dispatchEvent(new Event('flo:order-synced'));
        } else if (data.event === 'connection-status') {
          fetchStatus();
        }
      });
    }

    // 2. WebSocket listener for Web/browser clients fallback
    let ws: WebSocket | null = null;
    if (typeof window !== 'undefined') {
      try {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.host || 'localhost:3001';
        ws = new WebSocket(`${protocol}//${host}/kds`);

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data?.type === 'cloud:menu-updated') {
              toast.success('🍕 Live Menu updated from Pizza System!');
              window.dispatchEvent(new Event('flo:menu-synced'));
            } else if (data?.type === 'cloud:staff-updated') {
              window.dispatchEvent(new Event('flo:staff-synced'));
            } else if (data?.type === 'cloud:online-order-received') {
              toast.success(`🔔 Online Order #${data.payload?.orderNumber || ''} received!`, { duration: 5000 });
              window.dispatchEvent(new Event('flo:order-synced'));
            } else if (data?.type === 'cloud:order-deleted') {
              window.dispatchEvent(new Event('flo:order-deleted'));
              window.dispatchEvent(new Event('flo:order-synced'));
            } else if (data?.type === 'orders_updated') {
              window.dispatchEvent(new Event('flo:order-synced'));
            }
          } catch {}
        };
      } catch {}
    }

    return () => {
      clearInterval(interval);
      if (ws) {
        try { ws.close(); } catch {}
      }
    };
  }, []);

  const handleSync = async () => {
    try {
      setSyncing(true);
      const res = await api.post('/cloud-sync/sync-all');
      if (res.data?.success) {
        toast.success('Cloud sync complete!');
        await fetchStatus();
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new Event('flo:menu-synced'));
        }
      } else {
        toast.error(res.data?.message || 'Sync failed');
      }
    } catch (err: any) {
      toast.error('Sync error: ' + (err.response?.data?.message || err.message));
    } finally {
      setSyncing(false);
    }
  };

  const isLive = status?.isRealtimeActive && status?.connected;
  const currentShopId = status?.currentShopId ? Number(status.currentShopId) : null;
  const branchName = status?.currentShopName || (currentShopId ? `Shop #${currentShopId}` : 'Pizza System');

  return (
    <div className="relative inline-block">
      <div className="inline-flex items-center rounded-lg border border-orange-200 bg-orange-50/90 text-orange-900 shadow-xs">
        {/* Static Branch Badge - Display only, no public switching */}
        <div
          title={`Active Branch: ${branchName}`}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-l-lg border-r border-orange-200 select-none"
        >
          <Store size={13} className="text-orange-600 shrink-0" />
          <span className="truncate max-w-[130px]">{branchName}</span>
        </div>

        {/* Sync Trigger & Live Indicator */}
        <button
          type="button"
          onClick={handleSync}
          disabled={syncing}
          title={`Pizza Cloud Sync (${branchName}) — ${isLive ? 'Realtime Connected' : 'Offline / Standby'}. Click to pull latest updates.`}
          className="inline-flex items-center gap-1.5 px-2 py-1 text-xs hover:bg-orange-100/80 rounded-r-lg transition-colors cursor-pointer"
        >
          <RefreshCw
            size={12}
            className={syncing ? 'animate-spin text-orange-600' : 'text-orange-500'}
          />
          <span
            className={`w-2 h-2 rounded-full transition-all ${
              isLive ? 'bg-emerald-500 animate-pulse ring-2 ring-emerald-200' : 'bg-amber-400'
            }`}
          />
        </button>
      </div>
    </div>
  );
}
