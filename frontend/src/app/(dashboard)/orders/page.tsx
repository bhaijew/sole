'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import api from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import toast from 'react-hot-toast';
import {
  Printer,
  UtensilsCrossed,
  RefreshCw,
  Search,
  Clock,
  CheckCircle2,
  AlertCircle,
  XCircle,
  MapPin,
  Phone,
  User,
  ShoppingBag,
  Globe,
  Sparkles,
  ChevronRight,
  Flame,
  Volume2,
  VolumeX,
  LayoutGrid,
  List,
  Eye,
  X,
  Receipt,
  ArrowUpRight,
  Copy,
  Check,
} from 'lucide-react';
import type { Order, OrderItem } from '@/lib/types';

type FilterType = 'all' | 'online' | 'dine_in' | 'takeaway' | 'delivery';
type StatusFilter = 'all' | 'pending' | 'preparing' | 'ready' | 'completed' | 'cancelled';
type ViewMode = 'grid' | 'table';

const SUPABASE_REST_URL = 'https://uadrrjrlhfttithjmdye.supabase.co/rest/v1/orders?select=*&order=id.desc&limit=40';
const SUPABASE_BASE_URL = 'https://uadrrjrlhfttithjmdye.supabase.co/rest/v1/orders';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVhZHJyanJsaGZ0dGl0aGptZHllIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MDYwNTg2OCwiZXhwIjoyMTA2MTgxODY4fQ.NuC74GhFlUEiaRR2BXPooYj7iahzrXXKCxMQYDUnfIg';

export default function OrdersPage() {
  const { currentTenant } = useAuthStore();
  const currency = currentTenant?.currency === 'THB' ? '฿' : (currentTenant?.currency === 'INR' ? '₹' : 'Rs ');

  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filterType, setFilterType] = useState<FilterType>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('grid');

  // Selected order for detailed modal
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [copiedPhone, setCopiedPhone] = useState<string | null>(null);

  // Track printing order states: { [orderId_printType]: boolean }
  const [printingMap, setPrintingMap] = useState<Record<string, boolean>>({});
  // Track updating order status: { [orderId]: boolean }
  const [updatingStatusMap, setUpdatingStatusMap] = useState<Record<number | string, boolean>>({});

  // Optimistic status cache to completely prevent polling from reverting user's status updates
  const optimisticStatusMapRef = useRef<Record<string, { status: string; timestamp: number }>>({});
  const previousOnlineCountRef = useRef<number | null>(null);

  // Map Supabase cloud statuses to local POS statuses
  const mapCloudToLocalStatus = useCallback((st: string) => {
    const s = (st || 'pending').toLowerCase();
    if (s === 'delivered') return 'completed';
    if (s === 'confirmed') return 'pending';
    return s;
  }, []);

  // Map local POS status to Supabase cloud status
  const mapLocalToCloudStatus = useCallback((st: string) => {
    const s = (st || 'pending').toLowerCase();
    if (s === 'completed') return 'delivered';
    return s;
  }, []);

  // Audio chime for new online orders using Web Audio API synthesis
  const playChime = useCallback(() => {
    if (!soundEnabled) return;
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
      osc.frequency.setValueAtTime(880, ctx.currentTime + 0.12); // A5

      gain.gain.setValueAtTime(0.4, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + 0.55);
    } catch {
      // Audio context might be restricted before interaction
    }
  }, [soundEnabled]);

  // Main fetch function with dual live sync (local Express API + direct Supabase REST fallback)
  const fetchOrders = useCallback(async (isSilent = false) => {
    try {
      if (!isSilent) setRefreshing(true);

      // 1. Trigger local backend cloud pull
      try {
        await api.post('/cloud-sync/pull-orders');
      } catch {
        // Backend pull-orders route fallback
      }

      // 2. Fetch local SQLite orders
      const syncStatusRes = await api.get('/cloud-sync/status').catch(() => null);
      const activeBranchId = syncStatusRes?.data?.currentShopId || (currentTenant as any)?.shop_id || '';
      const res = await api.get('/orders?sync=1' + (activeBranchId ? `&shop_id=${activeBranchId}` : ''));
      let fetched: Order[] = res.data?.orders || [];

      // 3. Resilient Direct Supabase REST fallback to ensure any newly placed online orders appear instantaneously
      try {
        const syncStatusRes = await api.get('/cloud-sync/status').catch(() => null);
        const activeBranchId = syncStatusRes?.data?.currentShopId || (currentTenant as any)?.shop_id || '';

        const branchRestUrl = `${SUPABASE_BASE_URL}?select=*&shop_id=eq.${activeBranchId}&order=id.desc&limit=40`;

        const cloudRes = await fetch(branchRestUrl, {
          headers: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          },
        });

        if (cloudRes.ok) {
          const cloudOrders = await cloudRes.json();
          for (const co of cloudOrders) {
            if (String(co.shop_id || '') !== String(activeBranchId)) {
              continue; // Strictly filter out other shops' orders
            }
            const alreadyExistsIndex = fetched.findIndex(
              (o) =>
                o.order_number === co.order_number ||
                (o.cloud_order_id && String(o.cloud_order_id) === String(co.id)) ||
                String(o.id) === String(co.id)
            );

            // Determine status for this cloud order
            let effectiveStatus = mapCloudToLocalStatus(co.status);

            // Check if user recently updated status in UI (within 60s)
            const opt =
              optimisticStatusMapRef.current[String(co.id)] ||
              optimisticStatusMapRef.current[String(co.order_number)];

            if (opt && Date.now() - opt.timestamp < 60000) {
              effectiveStatus = opt.status;
            }

            if (alreadyExistsIndex >= 0) {
              // Update status in existing order if optimistic or cloud status changed
              fetched[alreadyExistsIndex].status = effectiveStatus as any;
            } else {
              // Insert synthetic order for UI
              let parsedItems: any[] = [];
              if (Array.isArray(co.items)) parsedItems = co.items;
              else if (typeof co.items === 'string') {
                try {
                  parsedItems = JSON.parse(co.items);
                } catch {}
              }

              const formattedItems: OrderItem[] = parsedItems.map((it, idx) => ({
                id: idx + 1000,
                order_id: co.id,
                product_id: it.id || idx,
                product_name: it.name || it.title || it.product_name || 'Pizza Item',
                product_sku: null,
                unit_price: Number(it.price || it.unit_price) || 0,
                quantity: Number(it.qty || it.quantity) || 1,
                subtotal: Number(it.subtotal) || ((Number(it.price) || 0) * (Number(it.qty || it.quantity) || 1)),
                tax_amount: 0,
                total: Number(it.subtotal) || ((Number(it.price) || 0) * (Number(it.qty || it.quantity) || 1)),
                addons: null,
                special_instructions: it.selected_variation
                  ? (typeof it.selected_variation === 'object' ? it.selected_variation.name : String(it.selected_variation))
                  : (it.variant_selection || null),
                status: effectiveStatus as any,
              }));

              const syntheticOrder: Order = {
                id: co.id,
                order_number: co.order_number || `ONL-${co.id}`,
                table_id: null,
                customer_id: null,
                type: (co.order_type || (co.delivery_address ? 'delivery' : 'takeaway')) as any,
                status: effectiveStatus as any,
                subtotal: Math.max(0, Number(co.total) - Number(co.delivery_fee || 0)),
                tax_amount: 0,
                discount_amount: 0,
                delivery_charge: Number(co.delivery_fee || 0),
                total: Number(co.total) || 0,
                guest_count: null,
                special_instructions: co.notes || null,
                created_by: 0,
                created_at: co.created_at || new Date().toISOString(),
                items: formattedItems,
                customer:
                  co.customer_name || co.customer_phone
                    ? {
                        id: co.id,
                        name: co.customer_name || 'Online Customer',
                        phone: co.customer_phone || '',
                        country_code: '+92',
                        email: null,
                        visits_count: 1,
                        total_spent: Number(co.total) || 0,
                        last_visit_at: co.created_at,
                      }
                    : undefined,
                order_source: 'online',
                delivery_address: co.delivery_address || null,
                delivery_fee: Number(co.delivery_fee || 0),
                cloud_order_id: String(co.id),
                shop_id: co.shop_id,
              };

              fetched.unshift(syntheticOrder);
            }
          }
        }
      } catch {
        // Fallback silently if direct fetch fails
      }

      // Preserve recent optimistic status on all orders in fetched
      const finalOrders = fetched.map((fo) => {
        const opt =
          optimisticStatusMapRef.current[String(fo.id)] ||
          optimisticStatusMapRef.current[String(fo.order_number)] ||
          (fo.cloud_order_id ? optimisticStatusMapRef.current[String(fo.cloud_order_id)] : null);

        if (opt && Date.now() - opt.timestamp < 60000) {
          return { ...fo, status: opt.status as any };
        }
        return fo;
      });

      // Check for incoming new online orders to trigger sound chime
      const currentOnlineCount = finalOrders.filter(
        (o) => (o as any).order_source === 'online' || o.type === 'online'
      ).length;

      if (previousOnlineCountRef.current !== null && currentOnlineCount > previousOnlineCountRef.current) {
        playChime();
        toast.success(`🔔 New Online Order received from Customer Menu!`, { duration: 5000 });
      }
      previousOnlineCountRef.current = currentOnlineCount;

      const branchOrders = activeBranchId
        ? finalOrders.filter((fo) => !fo.shop_id || String(fo.shop_id) === String(activeBranchId))
        : finalOrders;
      setOrders(branchOrders);
    } catch (err: any) {
      if (!isSilent) {
        toast.error('Failed to load orders: ' + (err.response?.data?.error || err.message));
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [mapCloudToLocalStatus, playChime]);

  // Initial load
  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  // Real-time listener for cloud online orders & local events
  useEffect(() => {
    const handleOrderSynced = () => {
      fetchOrders(true);
    };

    window.addEventListener('flo:order-synced', handleOrderSynced);
    window.addEventListener('flo:online-order-received', handleOrderSynced);
    window.addEventListener('flo:menu-synced', handleOrderSynced);

    return () => {
      window.removeEventListener('flo:order-synced', handleOrderSynced);
      window.removeEventListener('flo:online-order-received', handleOrderSynced);
      window.removeEventListener('flo:menu-synced', handleOrderSynced);
    };
  }, [fetchOrders]);

  // Snappy auto-refresh interval (5 seconds for truly live orders)
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      fetchOrders(true);
    }, 5000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchOrders]);

  // 1-Click Print Handler
  const handlePrint = async (orderId: number | string, printType: 'bill' | 'kot' | 'both') => {
    const key = `${orderId}_${printType}`;
    if (printingMap[key]) return;

    setPrintingMap((prev) => ({ ...prev, [key]: true }));
    try {
      const res = await api.post('/printers/print-order', { orderId, printType });
      if (res.data?.success) {
        const label = printType === 'kot' ? 'KOT (Kitchen ticket)' : printType === 'both' ? 'Receipt & KOT' : 'Receipt';
        toast.success(`🖨️ ${label} printed successfully!`);
      } else {
        toast.error(res.data?.error || 'Printing failed');
      }
    } catch (err: any) {
      toast.error('Printer error: ' + (err.response?.data?.error || err.message));
    } finally {
      setPrintingMap((prev) => ({ ...prev, [key]: false }));
    }
  };

  // Robust Status Change Handler: Updates UI, Local SQLite API & Supabase Cloud simultaneously
  const handleUpdateStatus = async (orderId: number | string, newStatus: string) => {
    if (updatingStatusMap[orderId]) return;

    const targetOrder = orders.find((o) => String(o.id) === String(orderId));
    const cloudId = targetOrder?.cloud_order_id || String(orderId);
    const orderNum = targetOrder?.order_number;

    // 1. Immediately record in optimistic status cache to prevent any polling overwrite
    const nowTime = Date.now();
    optimisticStatusMapRef.current[String(orderId)] = { status: newStatus, timestamp: nowTime };
    if (cloudId) optimisticStatusMapRef.current[String(cloudId)] = { status: newStatus, timestamp: nowTime };
    if (orderNum) optimisticStatusMapRef.current[String(orderNum)] = { status: newStatus, timestamp: nowTime };

    // 2. Immediately update React state for instant UI response
    setOrders((prev) =>
      prev.map((o) => (String(o.id) === String(orderId) ? { ...o, status: newStatus as any } : o))
    );
    if (selectedOrder && String(selectedOrder.id) === String(orderId)) {
      setSelectedOrder((prev) => (prev ? { ...prev, status: newStatus as any } : null));
    }

    setUpdatingStatusMap((prev) => ({ ...prev, [orderId]: true }));

    try {
      // 3. Update local backend API
      try {
        await api.patch(`/orders/${orderId}/status`, { status: newStatus });
      } catch {
        // Fallback for purely cloud orders not yet in local DB
      }

      // 4. Update Supabase Cloud directly via REST API so it never reverts!
      const cloudStatus = mapLocalToCloudStatus(newStatus);
      const queryParam = cloudId ? `id=eq.${cloudId}` : `order_number=eq.${orderNum}`;

      await fetch(`${SUPABASE_BASE_URL}?${queryParam}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({
          status: cloudStatus,
          updated_at: new Date().toISOString(),
        }),
      }).catch(() => {});

      const statusLabels: Record<string, string> = {
        preparing: '👨‍🍳 Cooking Started',
        ready: '✓ Marked Ready',
        completed: '✔ Order Completed',
        delivered: '✔ Order Delivered',
        cancelled: '✕ Order Cancelled',
      };
      toast.success(statusLabels[newStatus] || `Order status updated to ${newStatus}!`);
    } catch {
      toast.success(`Order marked as ${newStatus}!`);
    } finally {
      setUpdatingStatusMap((prev) => ({ ...prev, [orderId]: false }));
    }
  };

  // Filtered orders
  const filteredOrders = orders.filter((order) => {
    const isOnline = (order as any).order_source === 'online' || order.type === 'online';
    if (filterType === 'online' && !isOnline) return false;
    if (filterType === 'dine_in' && order.type !== 'dine_in') return false;
    if (filterType === 'takeaway' && (order.type !== 'takeaway' || isOnline)) return false;
    if (filterType === 'delivery' && (order.type !== 'delivery' || isOnline)) return false;

    if (statusFilter !== 'all' && order.status !== statusFilter) return false;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchNumber = order.order_number?.toLowerCase().includes(q);
      const matchCustomer = order.customer?.name?.toLowerCase().includes(q);
      const matchPhone = order.customer?.phone?.toLowerCase().includes(q);
      const matchInstructions = order.special_instructions?.toLowerCase().includes(q);
      const matchAddress = order.delivery_address?.toLowerCase().includes(q);
      const matchItem = order.items?.some((i) => i.product_name?.toLowerCase().includes(q));
      if (!matchNumber && !matchCustomer && !matchPhone && !matchInstructions && !matchItem && !matchAddress) {
        return false;
      }
    }

    return true;
  });

  // KPI Counts
  const totalCount = orders.length;
  const onlineCount = orders.filter((o) => (o as any).order_source === 'online' || o.type === 'online').length;
  const pendingCount = orders.filter((o) => o.status === 'pending').length;
  const preparingCount = orders.filter((o) => o.status === 'preparing').length;

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending':
        return 'bg-amber-100 text-amber-800 border-amber-300';
      case 'preparing':
        return 'bg-blue-100 text-blue-800 border-blue-300';
      case 'ready':
        return 'bg-emerald-100 text-emerald-800 border-emerald-300';
      case 'completed':
      case 'delivered':
        return 'bg-slate-100 text-slate-800 border-slate-300';
      case 'cancelled':
        return 'bg-red-100 text-red-800 border-red-300';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-300';
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedPhone(text);
    toast.success('Phone copied to clipboard!');
    setTimeout(() => setCopiedPhone(null), 2000);
  };

  return (
    <div className="flex-1 flex flex-col p-4 md:p-6 bg-slate-50 min-h-screen">
      {/* ============================================================ */}
      {/* TOP HEADER & LIVE STATUS BAR */}
      {/* ============================================================ */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-5">
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="text-2xl font-black text-slate-900 tracking-tight">Orders Management</h1>
            {/* Live Realtime Connected Badge */}
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
              <span>LIVE ORDERS SYNC</span>
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Real-time orders feed from <strong>Online Customer Menu</strong> and <strong>FloDesktop POS</strong>.
          </p>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Sound Alert Toggle */}
          <button
            onClick={() => setSoundEnabled(!soundEnabled)}
            className={`p-2 rounded-lg border text-xs font-semibold flex items-center gap-1.5 transition-colors ${
              soundEnabled
                ? 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100'
                : 'bg-white border-slate-200 text-slate-400 hover:bg-slate-50'
            }`}
            title={soundEnabled ? 'Order Sound Alert: ON' : 'Order Sound Alert: MUTED'}
          >
            {soundEnabled ? <Volume2 size={15} /> : <VolumeX size={15} />}
            <span className="hidden sm:inline">{soundEnabled ? 'Chime ON' : 'Muted'}</span>
          </button>

          {/* Auto-refresh Toggle */}
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`px-3 py-1.5 rounded-lg border text-xs font-semibold flex items-center gap-1.5 transition-colors ${
              autoRefresh
                ? 'bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100'
                : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
            }`}
          >
            <Clock size={14} />
            <span>{autoRefresh ? 'Live (5s)' : 'Paused'}</span>
          </button>

          {/* View Mode Toggle */}
          <div className="flex items-center border border-slate-200 rounded-lg p-0.5 bg-white">
            <button
              onClick={() => setViewMode('grid')}
              className={`p-1.5 rounded ${viewMode === 'grid' ? 'bg-slate-900 text-white' : 'text-slate-500 hover:text-slate-900'}`}
              title="Cards Grid View"
            >
              <LayoutGrid size={15} />
            </button>
            <button
              onClick={() => setViewMode('table')}
              className={`p-1.5 rounded ${viewMode === 'table' ? 'bg-slate-900 text-white' : 'text-slate-500 hover:text-slate-900'}`}
              title="Table View"
            >
              <List size={15} />
            </button>
          </div>

          {/* Manual Refresh / Sync Button */}
          <button
            onClick={() => fetchOrders()}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-orange-600 hover:bg-orange-700 text-white text-xs font-bold transition-all shadow-sm disabled:opacity-50"
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
            <span>Sync Cloud Orders</span>
          </button>
        </div>
      </div>

      {/* ============================================================ */}
      {/* KPI METRICS BAR */}
      {/* ============================================================ */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-xs">
          <div className="text-slate-500 text-xs font-semibold flex items-center justify-between">
            <span>Total Orders</span>
            <Receipt size={15} className="text-slate-400" />
          </div>
          <div className="text-2xl font-black text-slate-900 mt-1">{totalCount}</div>
        </div>

        {/* Online Orders Pill with Vibrant Purple Accent */}
        <div
          onClick={() => setFilterType('online')}
          className={`border rounded-xl p-3 shadow-xs cursor-pointer transition-all ${
            filterType === 'online'
              ? 'bg-purple-100 border-purple-400 ring-2 ring-purple-300'
              : 'bg-purple-50/70 border-purple-200 hover:bg-purple-100/70'
          }`}
        >
          <div className="text-purple-700 text-xs font-bold flex items-center justify-between">
            <span className="flex items-center gap-1">
              <Globe size={13} />
              <span>Online Menu</span>
            </span>
            <span className="w-2 h-2 rounded-full bg-purple-600 animate-pulse" />
          </div>
          <div className="text-2xl font-black text-purple-900 mt-1">{onlineCount}</div>
        </div>

        <div
          onClick={() => setStatusFilter('pending')}
          className={`border rounded-xl p-3 shadow-xs cursor-pointer transition-all ${
            statusFilter === 'pending'
              ? 'bg-amber-100 border-amber-400 ring-2 ring-amber-300'
              : 'bg-white border-slate-200 hover:bg-amber-50/40'
          }`}
        >
          <div className="text-amber-700 text-xs font-semibold flex items-center justify-between">
            <span>Pending Action</span>
            <AlertCircle size={15} className="text-amber-500" />
          </div>
          <div className="text-2xl font-black text-amber-900 mt-1">{pendingCount}</div>
        </div>

        <div
          onClick={() => setStatusFilter('preparing')}
          className={`border rounded-xl p-3 shadow-xs cursor-pointer transition-all ${
            statusFilter === 'preparing'
              ? 'bg-blue-100 border-blue-400 ring-2 ring-blue-300'
              : 'bg-white border-slate-200 hover:bg-blue-50/40'
          }`}
        >
          <div className="text-blue-700 text-xs font-semibold flex items-center justify-between">
            <span>In Kitchen</span>
            <Flame size={15} className="text-blue-500" />
          </div>
          <div className="text-2xl font-black text-blue-900 mt-1">{preparingCount}</div>
        </div>
      </div>

      {/* ============================================================ */}
      {/* FILTERS & SEARCH BAR */}
      {/* ============================================================ */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 mb-5 shadow-xs flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        {/* Search Input */}
        <div className="relative flex-1 min-w-[240px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search by order #, customer name, phone, item..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500"
          />
        </div>

        {/* Source Filter Tabs */}
        <div className="flex items-center gap-1 overflow-x-auto pb-1 md:pb-0">
          <button
            onClick={() => setFilterType('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-colors ${
              filterType === 'all'
                ? 'bg-slate-900 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            All ({orders.length})
          </button>

          {/* Prominent Online Orders Tab */}
          <button
            onClick={() => setFilterType('online')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap flex items-center gap-1.5 transition-colors ${
              filterType === 'online'
                ? 'bg-purple-700 text-white shadow-xs'
                : 'bg-purple-50 text-purple-700 border border-purple-200 hover:bg-purple-100'
            }`}
          >
            <Globe size={13} />
            <span>Online Menu ({onlineCount})</span>
          </button>

          <button
            onClick={() => setFilterType('dine_in')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-colors ${
              filterType === 'dine_in'
                ? 'bg-slate-900 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            Dine-In
          </button>

          <button
            onClick={() => setFilterType('takeaway')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-colors ${
              filterType === 'takeaway'
                ? 'bg-slate-900 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            Takeaway
          </button>

          <button
            onClick={() => setFilterType('delivery')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-colors ${
              filterType === 'delivery'
                ? 'bg-slate-900 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            Delivery
          </button>
        </div>

        {/* Status Dropdown */}
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as any)}
          className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold text-slate-700 focus:outline-none"
        >
          <option value="all">All Statuses</option>
          <option value="pending">⏳ Pending</option>
          <option value="preparing">🍳 Preparing</option>
          <option value="ready">✓ Ready</option>
          <option value="completed">✔ Completed / Delivered</option>
          <option value="cancelled">✕ Cancelled</option>
        </select>
      </div>

      {/* ============================================================ */}
      {/* CONTENT: EMPTY STATE / GRID VIEW / TABLE VIEW */}
      {/* ============================================================ */}
      {loading ? (
        <div className="flex-1 flex flex-col items-center justify-center p-12 text-slate-400">
          <RefreshCw size={32} className="animate-spin text-orange-500 mb-3" />
          <p className="text-sm font-semibold">Connecting to POS database and cloud storefront...</p>
        </div>
      ) : filteredOrders.length === 0 ? (
        <div className="flex-1 bg-white border-2 border-dashed border-slate-200 rounded-2xl flex flex-col items-center justify-center p-12 text-center">
          <div className="w-16 h-16 rounded-full bg-orange-50 text-orange-600 flex items-center justify-center mb-4">
            <ShoppingBag size={28} />
          </div>
          <h3 className="text-base font-bold text-slate-800 mb-1">
            {searchQuery ? 'No matching orders found' : 'No orders in this view'}
          </h3>
          <p className="text-xs text-slate-500 max-w-sm mb-4">
            When customers place orders from the online pizza website or cashier takes counter orders, they will appear here live!
          </p>
          <button
            onClick={() => fetchOrders()}
            className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg text-xs font-bold transition-all shadow-xs"
          >
            Refresh Feed
          </button>
        </div>
      ) : viewMode === 'grid' ? (
        /* ================= CARDS GRID VIEW ================= */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredOrders.map((order) => {
            const isOnline = (order as any).order_source === 'online' || order.type === 'online';
            const customerName = order.customer?.name || (order.special_instructions?.match(/Customer:\s*([^|]+)/)?.[1]?.trim());
            const customerPhone = order.customer?.phone || (order.special_instructions?.match(/Phone:\s*([^|]+)/)?.[1]?.trim());

            return (
              <div
                key={order.id}
                className={`bg-white border rounded-xl overflow-hidden flex flex-col justify-between transition-all shadow-xs hover:shadow-md ${
                  isOnline
                    ? 'border-purple-300 ring-1 ring-purple-200'
                    : 'border-slate-200'
                }`}
              >
                <div>
                  {/* Online Order Ribbon Header */}
                  {isOnline && (
                    <div className="bg-gradient-to-r from-purple-700 to-indigo-700 text-white px-3.5 py-1.5 flex items-center justify-between text-xs font-bold tracking-wide">
                      <div className="flex items-center gap-1.5">
                        <Globe size={13} className="animate-spin text-purple-200" />
                        <span>ONLINE MENU ORDER</span>
                      </div>
                      <span className="text-[10px] bg-purple-900/60 px-1.5 py-0.5 rounded text-purple-100 font-mono">
                        {order.cloud_order_id ? `#${order.cloud_order_id}` : 'WEB'}
                      </span>
                    </div>
                  )}

                  {/* Card Main Info Bar */}
                  <div className="p-3.5 border-b border-slate-100">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div>
                        <div className="font-mono text-sm font-black text-slate-900">
                          {order.order_number}
                        </div>
                        <div className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-1">
                          <Clock size={11} />
                          <span>{new Date(order.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                          <span>•</span>
                          <span className="capitalize font-semibold text-slate-600">
                            {order.type === 'dine_in' ? (order.table ? `Table ${order.table.name}` : 'Dine-In') : order.type}
                          </span>
                        </div>
                      </div>

                      {/* Status Pill */}
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-[11px] font-extrabold border capitalize ${getStatusColor(
                          order.status
                        )}`}
                      >
                        {order.status}
                      </span>
                    </div>

                    {/* Customer Info Pill if exists */}
                    {(customerName || customerPhone) && (
                      <div className="bg-slate-50 border border-slate-200/80 rounded-lg p-2 mb-2 text-xs flex flex-col gap-0.5">
                        {customerName && (
                          <div className="flex items-center gap-1.5 font-bold text-slate-800">
                            <User size={12} className="text-slate-400 shrink-0" />
                            <span className="truncate">{customerName}</span>
                          </div>
                        )}
                        {customerPhone && (
                          <div className="flex items-center justify-between text-[11px] text-slate-600 font-medium mt-0.5">
                            <div className="flex items-center gap-1">
                              <Phone size={11} className="text-slate-400" />
                              <span className="font-mono">{customerPhone}</span>
                            </div>
                            <button
                              onClick={() => copyToClipboard(customerPhone)}
                              className="text-slate-400 hover:text-slate-700 p-0.5"
                              title="Copy Phone"
                            >
                              {copiedPhone === customerPhone ? <Check size={11} className="text-emerald-600" /> : <Copy size={11} />}
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Delivery Address if delivery */}
                    {order.delivery_address && (
                      <div className="text-[11px] text-slate-600 bg-amber-50/70 border border-amber-200 rounded p-1.5 mb-2 flex items-start gap-1">
                        <MapPin size={12} className="text-amber-600 shrink-0 mt-0.5" />
                        <span className="line-clamp-2">{order.delivery_address}</span>
                      </div>
                    )}

                    {/* Items List preview */}
                    <div className="space-y-1.5 mt-2">
                      {order.items?.slice(0, 3).map((item, idx) => (
                        <div key={idx} className="flex items-start justify-between text-xs text-slate-700">
                          <div className="flex items-start gap-1.5 min-w-0 pr-2">
                            <span className="font-extrabold text-orange-600 shrink-0">{item.quantity}×</span>
                            <div className="truncate">
                              <span className="font-semibold text-slate-800">{item.product_name}</span>
                              {item.special_instructions && (
                                <span className="text-[10px] text-slate-400 ml-1">({item.special_instructions})</span>
                              )}
                            </div>
                          </div>
                          <span className="font-mono font-semibold text-slate-600 shrink-0">
                            {currency}{Number(item.subtotal || item.total).toLocaleString()}
                          </span>
                        </div>
                      ))}
                      {(order.items?.length || 0) > 3 && (
                        <div className="text-[10px] text-slate-400 font-semibold italic text-center pt-0.5">
                          + {(order.items?.length || 0) - 3} more items...
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Pricing row */}
                  <div className="px-3.5 py-2.5 bg-slate-50/70 flex items-center justify-between border-b border-slate-100">
                    <span className="text-xs font-semibold text-slate-500">Order Total:</span>
                    <span className="text-base font-black text-slate-900 font-mono">
                      {currency}{Number(order.total).toLocaleString()}
                    </span>
                  </div>
                </div>

                {/* Card Action Controls: Print Buttons & Status Actions */}
                <div className="p-3 bg-white flex flex-col gap-2">
                  {/* Direct 1-Click Print Buttons */}
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      onClick={() => handlePrint(order.id, 'bill')}
                      disabled={Boolean(printingMap[`${order.id}_bill`])}
                      className="flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold transition-all shadow-xs disabled:opacity-50"
                      title="Print Customer Bill / Receipt"
                    >
                      <Printer size={13} className={printingMap[`${order.id}_bill`] ? 'animate-bounce' : ''} />
                      <span>{printingMap[`${order.id}_bill`] ? 'Printing...' : 'Receipt'}</span>
                    </button>

                    <button
                      onClick={() => handlePrint(order.id, 'kot')}
                      disabled={Boolean(printingMap[`${order.id}_kot`])}
                      className="flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs font-extrabold transition-all shadow-xs disabled:opacity-50"
                      title="Print Kitchen Order Ticket (KOT)"
                    >
                      <UtensilsCrossed size={13} className={printingMap[`${order.id}_kot`] ? 'animate-bounce' : ''} />
                      <span>{printingMap[`${order.id}_kot`] ? 'Printing...' : 'KOT'}</span>
                    </button>
                  </div>

                  {/* Status Progression & View Details */}
                  <div className="flex items-center gap-1.5">
                    {order.status === 'pending' ? (
                      <button
                        onClick={() => handleUpdateStatus(order.id, 'preparing')}
                        disabled={Boolean(updatingStatusMap[order.id])}
                        className="flex-1 py-1.5 px-2 bg-blue-50 border border-blue-200 hover:bg-blue-100 text-blue-700 rounded-lg text-xs font-bold text-center transition-colors disabled:opacity-60"
                      >
                        {updatingStatusMap[order.id] ? 'Updating...' : '▶ Start Cooking'}
                      </button>
                    ) : order.status === 'preparing' ? (
                      <button
                        onClick={() => handleUpdateStatus(order.id, 'ready')}
                        disabled={Boolean(updatingStatusMap[order.id])}
                        className="flex-1 py-1.5 px-2 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 text-emerald-700 rounded-lg text-xs font-bold text-center transition-colors disabled:opacity-60"
                      >
                        {updatingStatusMap[order.id] ? 'Updating...' : '✓ Mark Ready'}
                      </button>
                    ) : order.status === 'ready' ? (
                      <button
                        onClick={() => handleUpdateStatus(order.id, 'completed')}
                        disabled={Boolean(updatingStatusMap[order.id])}
                        className="flex-1 py-1.5 px-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-bold text-center transition-colors disabled:opacity-60"
                      >
                        {updatingStatusMap[order.id] ? 'Updating...' : '✔ Complete Order'}
                      </button>
                    ) : (
                      <div className="flex-1 py-1.5 px-2 bg-slate-100 text-slate-500 rounded-lg text-[11px] font-bold text-center capitalize">
                        ✔ Completed
                      </div>
                    )}

                    <button
                      onClick={() => setSelectedOrder(order)}
                      className="py-1.5 px-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-bold transition-colors flex items-center gap-1"
                      title="View Details & Receipt Preview"
                    >
                      <Eye size={13} />
                      <span className="hidden sm:inline">Details</span>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* ================= TABLE VIEW ================= */
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-600">
              <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                <tr>
                  <th className="py-3 px-4">Order #</th>
                  <th className="py-3 px-4">Type / Source</th>
                  <th className="py-3 px-4">Customer</th>
                  <th className="py-3 px-4">Items</th>
                  <th className="py-3 px-4">Total</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Time</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium">
                {filteredOrders.map((order) => {
                  const isOnline = (order as any).order_source === 'online' || order.type === 'online';
                  const customerName = order.customer?.name || (order.special_instructions?.match(/Customer:\s*([^|]+)/)?.[1]?.trim());
                  const customerPhone = order.customer?.phone || (order.special_instructions?.match(/Phone:\s*([^|]+)/)?.[1]?.trim());

                  return (
                    <tr key={order.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3 px-4 font-mono font-black text-slate-900">
                        {order.order_number}
                      </td>
                      <td className="py-3 px-4">
                        {isOnline ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-purple-100 text-purple-800 border border-purple-200">
                            <Globe size={10} /> Online
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700 capitalize">
                            {order.type}
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-bold text-slate-800">{customerName || 'Walk-in Customer'}</div>
                        {customerPhone && <div className="text-[11px] text-slate-400 font-mono">{customerPhone}</div>}
                      </td>
                      <td className="py-3 px-4">
                        <span className="font-bold text-slate-700">{order.items?.length || 0} items</span>
                      </td>
                      <td className="py-3 px-4 font-mono font-black text-slate-900">
                        {currency}{Number(order.total).toLocaleString()}
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold border capitalize ${getStatusColor(
                            order.status
                          )}`}
                        >
                          {order.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-slate-400 text-[11px]">
                        {new Date(order.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => handlePrint(order.id, 'bill')}
                            className="p-1.5 rounded-md bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 font-bold"
                            title="Print Receipt"
                          >
                            <Printer size={13} />
                          </button>
                          <button
                            onClick={() => handlePrint(order.id, 'kot')}
                            className="p-1.5 rounded-md bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200 font-bold"
                            title="Print KOT"
                          >
                            <UtensilsCrossed size={13} />
                          </button>
                          <button
                            onClick={() => setSelectedOrder(order)}
                            className="p-1.5 rounded-md bg-slate-100 text-slate-700 hover:bg-slate-200 font-bold"
                            title="View Details"
                          >
                            <Eye size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* DETAILED ORDER & RECEIPT PREVIEW MODAL */}
      {/* ============================================================ */}
      {selectedOrder && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-xl w-full max-h-[90vh] overflow-y-auto shadow-2xl flex flex-col animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="p-4 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white z-10">
              <div className="flex items-center gap-2">
                <div className="font-mono text-base font-black text-slate-900">
                  {selectedOrder.order_number}
                </div>
                {(selectedOrder as any).order_source === 'online' && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-purple-100 text-purple-800">
                    ONLINE
                  </span>
                )}
              </div>
              <button
                onClick={() => setSelectedOrder(null)}
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 space-y-4">
              {/* Customer & Order Metadata */}
              <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3.5 text-xs space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-slate-500 font-medium">Order Type:</span>
                  <span className="font-bold text-slate-800 capitalize">{selectedOrder.type}</span>
                </div>
                {selectedOrder.customer && (
                  <>
                    <div className="flex justify-between">
                      <span className="text-slate-500 font-medium">Customer Name:</span>
                      <span className="font-bold text-slate-800">{selectedOrder.customer.name}</span>
                    </div>
                    {selectedOrder.customer.phone && (
                      <div className="flex justify-between">
                        <span className="text-slate-500 font-medium">Phone:</span>
                        <span className="font-mono font-bold text-slate-800">{selectedOrder.customer.phone}</span>
                      </div>
                    )}
                  </>
                )}
                {selectedOrder.delivery_address && (
                  <div className="flex justify-between pt-1 border-t border-slate-200">
                    <span className="text-slate-500 font-medium">Delivery Address:</span>
                    <span className="font-medium text-slate-800 text-right max-w-xs">{selectedOrder.delivery_address}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-slate-500 font-medium">Date & Time:</span>
                  <span className="text-slate-700 font-medium">{new Date(selectedOrder.created_at).toLocaleString()}</span>
                </div>
              </div>

              {/* Items Breakdown */}
              <div>
                <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">Order Items:</h4>
                <div className="border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-100">
                  {selectedOrder.items?.map((item, idx) => (
                    <div key={idx} className="p-3 text-xs flex items-center justify-between bg-white">
                      <div>
                        <div className="font-bold text-slate-900">
                          {item.quantity}× {item.product_name}
                        </div>
                        {item.special_instructions && (
                          <div className="text-[11px] text-slate-400 mt-0.5">{item.special_instructions}</div>
                        )}
                      </div>
                      <div className="font-mono font-bold text-slate-800">
                        {currency}{Number(item.subtotal || item.total).toLocaleString()}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Total & Summary */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 text-xs space-y-1.5 font-medium">
                <div className="flex justify-between text-slate-600">
                  <span>Subtotal:</span>
                  <span className="font-mono">{currency}{Number(selectedOrder.subtotal).toLocaleString()}</span>
                </div>
                {selectedOrder.delivery_charge > 0 && (
                  <div className="flex justify-between text-slate-600">
                    <span>Delivery Fee:</span>
                    <span className="font-mono">{currency}{Number(selectedOrder.delivery_charge).toLocaleString()}</span>
                  </div>
                )}
                <div className="flex justify-between text-base font-black text-slate-900 pt-2 border-t border-slate-200">
                  <span>Grand Total:</span>
                  <span className="font-mono">{currency}{Number(selectedOrder.total).toLocaleString()}</span>
                </div>
              </div>

              {/* Update Status Actions */}
              <div className="pt-2">
                <label className="block text-xs font-bold text-slate-600 mb-1.5">Change Order Status:</label>
                <div className="grid grid-cols-4 gap-2">
                  {['pending', 'preparing', 'ready', 'completed'].map((st) => (
                    <button
                      key={st}
                      onClick={() => handleUpdateStatus(selectedOrder.id, st)}
                      className={`py-1.5 rounded-lg text-xs font-bold capitalize transition-all border ${
                        selectedOrder.status === st
                          ? 'bg-slate-900 text-white border-slate-900 shadow-xs'
                          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      {st === 'completed' ? 'complete' : st}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Modal Footer Controls */}
            <div className="p-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between gap-3 sticky bottom-0">
              <button
                onClick={() => setSelectedOrder(null)}
                className="px-4 py-2 border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 rounded-xl text-xs font-bold"
              >
                Close
              </button>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => handlePrint(selectedOrder.id, 'kot')}
                  className="px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold flex items-center gap-1.5 shadow-xs"
                >
                  <UtensilsCrossed size={14} />
                  <span>Print KOT</span>
                </button>
                <button
                  onClick={() => handlePrint(selectedOrder.id, 'bill')}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1.5 shadow-xs"
                >
                  <Printer size={14} />
                  <span>Print Receipt</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
