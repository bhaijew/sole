'use client';

import { useState, useEffect, useRef } from 'react';
import { RefreshCw, Store, ChevronDown, Check } from 'lucide-react';
import api from '@/lib/api';
import toast from 'react-hot-toast';

interface Shop {
  id: number;
  name: string;
  slug: string;
}

export default function CloudSyncStatus() {
  const [status, setStatus] = useState<any>(null);
  const [syncing, setSyncing] = useState(false);
  const [shops, setShops] = useState<Shop[]>([]);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [switchingShop, setSwitchingShop] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

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

  const fetchShops = async () => {
    try {
      const res = await api.get('/cloud-sync/shops');
      if (res.data?.success && res.data?.shops) {
        setShops(res.data.shops);
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    fetchStatus();
    fetchShops();
    const interval = setInterval(fetchStatus, 30000);

    // Close dropdown on outside click
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);

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
            } else if (data?.type === 'orders_updated') {
              window.dispatchEvent(new Event('flo:order-synced'));
            }
          } catch {}
        };
      } catch {}
    }

    return () => {
      clearInterval(interval);
      document.removeEventListener('mousedown', handleClickOutside);
      if (ws) {
        try { ws.close(); } catch {}
      }
    };
  }, []);

  const handleSync = async () => {
    try {
      setSyncing(true);
      const res = await api.post('/cloud-sync/sync-menu');
      if (res.data?.success) {
        toast.success(res.data.message || 'Menu synced from Pizza System!');
        fetchStatus();
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

  const handleSelectShop = async (shop: Shop) => {
    try {
      setSwitchingShop(true);
      const res = await api.post('/cloud-sync/select-shop', { shop_id: shop.id });
      if (res.data?.success) {
        toast.success(`🏢 Switched to ${shop.name}! Loading pizza menu...`);
        setIsDropdownOpen(false);
        await fetchStatus();
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new Event('flo:menu-synced'));
        }
      } else {
        toast.error(res.data?.error || 'Failed to switch shop branch');
      }
    } catch (e: any) {
      toast.error('Error switching branch: ' + e.message);
    } finally {
      setSwitchingShop(false);
    }
  };

  const isLive = status?.isRealtimeActive && status?.connected;
  const currentShopId = status?.currentShopId ? Number(status.currentShopId) : null;
  const branchName = status?.currentShopName || (currentShopId ? `Shop #${currentShopId}` : 'Pizza System');

  return (
    <div className="relative inline-block" ref={dropdownRef}>
      <div className="inline-flex items-center rounded-lg border border-orange-200 bg-orange-50/90 text-orange-900 shadow-xs">
        {/* Branch Selector Button */}
        <button
          type="button"
          onClick={() => {
            fetchShops();
            setIsDropdownOpen((prev) => !prev);
          }}
          title="Click to view or switch branch outlet"
          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold hover:bg-orange-100/80 rounded-l-lg transition-colors border-r border-orange-200"
        >
          <Store size={13} className="text-orange-600 shrink-0" />
          <span className="truncate max-w-[120px]">{branchName}</span>
          <ChevronDown size={11} className="text-orange-500 opacity-80" />
        </button>

        {/* Sync Trigger & Live Indicator */}
        <button
          type="button"
          onClick={handleSync}
          disabled={syncing || switchingShop}
          title={`Pizza Cloud Sync (${branchName}) — ${isLive ? 'Realtime Connected' : 'Offline / Standby'}. Click to pull latest menu.`}
          className="inline-flex items-center gap-1.5 px-2 py-1 text-xs hover:bg-orange-100/80 rounded-r-lg transition-colors"
        >
          <RefreshCw
            size={12}
            className={syncing || switchingShop ? 'animate-spin text-orange-600' : 'text-orange-500'}
          />
          <span
            className={`w-2 h-2 rounded-full transition-all ${
              isLive ? 'bg-emerald-500 animate-pulse ring-2 ring-emerald-200' : 'bg-amber-400'
            }`}
          />
        </button>
      </div>

      {/* Branch Outlets Dropdown */}
      {isDropdownOpen && (
        <div className="absolute right-0 mt-1 w-64 rounded-xl bg-white shadow-xl border border-slate-200 p-2 z-50 animate-in fade-in zoom-in-95 duration-100">
          <div className="px-2 py-1.5 border-b border-slate-100 mb-1">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
              Active Pizza Branch Outlet
            </span>
            <span className="text-[11px] text-slate-400">
              Each branch gets its own dedicated pizza menu & database
            </span>
          </div>

          <div className="max-h-52 overflow-y-auto space-y-1 py-1">
            {shops.length === 0 ? (
              <div className="text-xs text-slate-500 text-center py-3">No branches found in cloud</div>
            ) : (
              shops.map((s) => {
                const isSelected = currentShopId === s.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => handleSelectShop(s)}
                    disabled={switchingShop}
                    className={`w-full text-left px-2.5 py-2 rounded-lg text-xs font-semibold flex items-center justify-between transition-colors ${
                      isSelected
                        ? 'bg-orange-500 text-white shadow-xs'
                        : 'text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Store size={14} className={isSelected ? 'text-white' : 'text-orange-600'} />
                      <div>
                        <div className="font-bold">{s.name}</div>
                        <div className={`text-[10px] ${isSelected ? 'text-orange-100' : 'text-slate-400'}`}>
                          Branch #{s.id} • /{s.slug}
                        </div>
                      </div>
                    </div>
                    {isSelected && <Check size={14} className="text-white shrink-0" />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
