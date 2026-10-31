'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import api from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import toast from 'react-hot-toast';
import {
  ShieldCheck,
  CheckCircle2,
  XCircle,
  Clock,
  Printer,
  Phone,
  MessageSquare,
  MapPin,
  RefreshCw,
  Search,
  Bike,
  ShoppingBag,
  UtensilsCrossed,
  AlertTriangle,
  Volume2,
  VolumeX,
  ExternalLink,
  ChevronRight,
  Flame,
  Check,
  X,
} from 'lucide-react';
import type { Order } from '@/lib/types';

type VerifyTab = 'pending' | 'verified' | 'all';

export default function VerifyOrdersPage() {
  const { currentTenant, user } = useAuthStore();
  const currency = currentTenant?.currency === 'THB' ? '฿' : (currentTenant?.currency === 'INR' ? '₹' : 'Rs ');

  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<VerifyTab>('pending');
  const [searchQuery, setSearchQuery] = useState('');
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [processingId, setProcessingId] = useState<number | string | null>(null);

  // Reject Modal State
  const [rejectingOrder, setRejectingOrder] = useState<Order | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectLoading, setRejectLoading] = useState(false);

  const prevPendingCountRef = useRef<number>(0);

  const fetchOrders = useCallback(async (isManual = false) => {
    if (isManual) setRefreshing(true);
    try {
      // 1. Fetch pending verification orders from local POS backend
      const res = await api.get('/orders/verify-pending');
      const pendingList: Order[] = res.data?.orders || [];

      // 2. Also fetch recent verified/completed orders to display on other tabs
      const recentRes = await api.get('/orders?per_page=30');
      const recentList: Order[] = recentRes.data?.orders || [];

      // Merge and deduplicate by id
      const orderMap = new Map<number | string, Order>();
      pendingList.forEach((o) => orderMap.set(o.id, o));
      recentList.forEach((o) => {
        if (!orderMap.has(o.id)) orderMap.set(o.id, o);
      });

      const merged = Array.from(orderMap.values());
      setOrders(merged);

      // Play chime if new pending verification orders arrived
      const currentPendingCount = pendingList.length;
      if (soundEnabled && currentPendingCount > prevPendingCountRef.current && prevPendingCountRef.current > 0) {
        try {
          const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
          audio.volume = 0.9;
          audio.play().catch(() => {});
          toast('New Online Order Awaiting Verification!', {
            icon: '🔔',
            style: { background: '#0f172a', color: '#fbbf24', border: '1px solid #f59e0b', fontWeight: 700 },
          });
        } catch {}
      }
      prevPendingCountRef.current = currentPendingCount;
    } catch (err: any) {
      console.error('[VerifyPage] Error loading orders:', err);
    } finally {
      setLoading(false);
      if (isManual) setRefreshing(false);
    }
  }, [soundEnabled]);

  useEffect(() => {
    fetchOrders();
    const interval = setInterval(() => {
      fetchOrders();
    }, 4000);
    return () => clearInterval(interval);
  }, [fetchOrders]);

  // Handle Order Verification + Auto Print
  const handleVerifyOrder = async (order: Order) => {
    setProcessingId(order.id);
    const cashierName = user?.name || currentTenant?.business_name || 'POS Cashier';
    try {
      const res = await api.post(`/orders/${order.id}/verify`, {
        cashier_name: cashierName,
      });

      if (res.data?.success) {
        toast.success(`Order #${order.order_number} Verified! Thermal receipt & KOT printed.`, {
          duration: 4000,
          style: { background: '#064e3b', color: '#6ee7b7', border: '1px solid #10b981', fontWeight: 700 },
        });

        // Update local state immediately
        setOrders((prev) =>
          prev.map((o) =>
            o.id === order.id
              ? {
                  ...o,
                  is_verified: 1,
                  status: 'pending',
                  special_instructions: `[VERIFIED & ACCEPTED by ${cashierName}] ${o.special_instructions || ''}`,
                }
              : o
          )
        );
      } else {
        toast.error(res.data?.error || 'Verification failed');
      }
    } catch (err: any) {
      toast.error(err.response?.data?.error || err.message || 'Verification failed');
    } finally {
      setProcessingId(null);
    }
  };

  // Handle Order Rejection
  const handleRejectConfirm = async () => {
    if (!rejectingOrder) return;
    const reason = rejectReason.trim() || 'Cancelled by Store Staff';
    setRejectLoading(true);
    try {
      const res = await api.post(`/orders/${rejectingOrder.id}/reject`, { reason });
      if (res.data?.success) {
        toast('Order Rejected', {
          icon: '🚫',
          style: { background: '#7f1d1d', color: '#fca5a5', border: '1px solid #ef4444', fontWeight: 700 },
        });
        setOrders((prev) =>
          prev.map((o) =>
            o.id === rejectingOrder.id
              ? { ...o, status: 'cancelled', is_verified: 0, cancellation_reason: reason }
              : o
          )
        );
        setRejectingOrder(null);
        setRejectReason('');
      } else {
        toast.error(res.data?.error || 'Failed to reject order');
      }
    } catch (err: any) {
      toast.error(err.response?.data?.error || err.message || 'Reject error');
    } finally {
      setRejectLoading(false);
    }
  };

  // Helper to extract customer phone cleanly
  const extractPhone = (o: Order) => {
    if (o.customer_phone && o.customer_phone.trim() !== '03345725942') return o.customer_phone.trim();
    const inst = `${o.special_instructions || ''} ${(o as any).notes || ''}`;
    if (inst.includes('Phone: ')) {
      const raw = inst.split('Phone: ')[1]?.split('|')[0]?.split('[')[0]?.trim();
      if (raw && raw.length >= 7) return raw;
    }
    return o.customer?.phone || '';
  };

  // Helper to format WhatsApp link
  const getWhatsAppLink = (phone: string, orderNumber: string) => {
    const clean = phone.replace(/\D/g, '');
    let intl = clean;
    if (intl.startsWith('0')) intl = '92' + intl.slice(1);
    else if (!intl.startsWith('92') && intl.length === 10) intl = '92' + intl;
    const msg = encodeURIComponent(`Assalam-o-Alaikum, this is ${currentTenant?.business_name || 'Pizza Restaurant'} regarding your Order #${orderNumber}.`);
    return `https://wa.me/${intl}?text=${msg}`;
  };

  // Filter & Counts
  const isPendingOrder = (o: Order) => {
    const isUnverified = (o as any).is_verified === 0 || (o as any).is_verified === false || (o as any).is_verified === null;
    const hasAwaitingNote = (o.special_instructions || '').includes('AWAITING_VERIFICATION') || ((o as any).notes || '').includes('AWAITING_VERIFICATION');
    const isOnline = o.order_source === 'online' || (o as any).source === 'online_menu';
    const notCompleted = o.status !== 'completed' && o.status !== 'cancelled';
    return (isUnverified || hasAwaitingNote) && isOnline && notCompleted;
  };

  const pendingOrders = orders.filter(isPendingOrder);
  const verifiedOrders = orders.filter((o) => !isPendingOrder(o) && o.status !== 'cancelled');

  const filteredOrders = orders.filter((o) => {
    // Tab filter
    if (activeTab === 'pending' && !isPendingOrder(o)) return false;
    if (activeTab === 'verified' && (isPendingOrder(o) || o.status === 'cancelled')) return false;

    // Search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const num = (o.order_number || '').toLowerCase();
      const name = (o.customer_name || o.customer?.name || '').toLowerCase();
      const phone = extractPhone(o).toLowerCase();
      const addr = (o.delivery_address || '').toLowerCase();
      return num.includes(q) || name.includes(q) || phone.includes(q) || addr.includes(q);
    }
    return true;
  });

  return (
    <div className="p-4 max-w-7xl mx-auto pb-24 font-sans text-slate-100">
      {/* ─── HEADER BANNER ─── */}
      <div className="bg-gradient-to-r from-slate-950 via-slate-900 to-slate-950 border border-slate-800 rounded-lg p-5 mb-5 shadow-xl relative overflow-hidden">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 relative z-10">
          <div>
            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-bold tracking-wide uppercase mb-2">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>FloDesktop Verification Portal</span>
            </div>
            <h1 className="text-2xl font-black text-white tracking-tight">
              Online Menu Orders Verification
            </h1>
            <p className="text-xs sm:text-sm text-slate-400 max-w-2xl mt-1">
              Confirm customer details before sending orders to the kitchen. Verifying auto-prints the thermal receipt and kitchen KOT immediately.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setSoundEnabled(!soundEnabled)}
              title={soundEnabled ? 'Mute alert chime' : 'Enable alert chime'}
              className={`p-2.5 rounded-lg border text-xs font-semibold flex items-center gap-1.5 transition ${
                soundEnabled
                  ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-400'
                  : 'bg-slate-800/80 border-slate-700 text-slate-400'
              }`}
            >
              {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
              <span className="hidden sm:inline">{soundEnabled ? 'Alerts ON' : 'Muted'}</span>
            </button>

            <button
              onClick={() => fetchOrders(true)}
              disabled={refreshing}
              className="px-3.5 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-bold text-white flex items-center gap-1.5 transition"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
          </div>
        </div>

        {/* Real-time Statistics KPI strip */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-5">
          <div className="bg-slate-900/80 border border-amber-500/30 rounded-lg p-3.5 flex items-center justify-between">
            <div>
              <span className="text-[11px] font-bold text-amber-400 uppercase tracking-wider block">
                Awaiting Verification
              </span>
              <span className="text-2xl font-black text-white">{pendingOrders.length}</span>
            </div>
            <div className="w-10 h-10 rounded-full bg-amber-500/10 flex items-center justify-center text-amber-400 font-bold">
              <Clock className="w-5 h-5 animate-pulse" />
            </div>
          </div>

          <div className="bg-slate-900/80 border border-emerald-500/30 rounded-lg p-3.5 flex items-center justify-between">
            <div>
              <span className="text-[11px] font-bold text-emerald-400 uppercase tracking-wider block">
                Verified & Printed Today
              </span>
              <span className="text-2xl font-black text-white">{verifiedOrders.length}</span>
            </div>
            <div className="w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-400 font-bold">
              <CheckCircle2 className="w-5 h-5" />
            </div>
          </div>

          <div className="bg-slate-900/80 border border-slate-700 rounded-lg p-3.5 flex items-center justify-between">
            <div>
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                Total Orders Tracked
              </span>
              <span className="text-2xl font-black text-white">{orders.length}</span>
            </div>
            <div className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center text-slate-400 font-bold">
              <Printer className="w-5 h-5" />
            </div>
          </div>
        </div>
      </div>

      {/* ─── TABS & SEARCH BAR ─── */}
      <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3 mb-5">
        <div className="flex bg-slate-900 border border-slate-800 rounded-lg p-1 gap-1">
          <button
            onClick={() => setActiveTab('pending')}
            className={`px-3 py-1.5 rounded-md text-xs font-bold flex items-center gap-2 transition ${
              activeTab === 'pending'
                ? 'bg-amber-500 text-slate-950 shadow-md'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            <span>Pending Verification</span>
            {pendingOrders.length > 0 && (
              <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-black ${activeTab === 'pending' ? 'bg-slate-950 text-amber-400' : 'bg-amber-500 text-slate-950'}`}>
                {pendingOrders.length}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('verified')}
            className={`px-3 py-1.5 rounded-md text-xs font-bold flex items-center gap-2 transition ${
              activeTab === 'verified'
                ? 'bg-emerald-600 text-white shadow-md'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Verified Orders</span>
          </button>

          <button
            onClick={() => setActiveTab('all')}
            className={`px-3 py-1.5 rounded-md text-xs font-bold flex items-center gap-2 transition ${
              activeTab === 'all'
                ? 'bg-slate-700 text-white shadow-md'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <span>All</span>
          </button>
        </div>

        <div className="relative min-w-[260px]">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search order #, customer, phone..."
            className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-500 transition"
          />
        </div>
      </div>

      {/* ─── ORDERS LIST ─── */}
      {loading ? (
        <div className="py-24 text-center">
          <RefreshCw className="w-8 h-8 text-amber-500 animate-spin mx-auto mb-3" />
          <p className="text-sm text-slate-400">Loading incoming orders...</p>
        </div>
      ) : filteredOrders.length === 0 ? (
        <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-12 text-center my-6">
          <div className="w-14 h-14 rounded-full bg-emerald-500/10 text-emerald-400 flex items-center justify-center mx-auto mb-4">
            <Check className="w-7 h-7" />
          </div>
          <h3 className="text-lg font-bold text-white mb-1">
            {activeTab === 'pending' ? 'All Clear! No Orders Awaiting Verification' : 'No Orders Found'}
          </h3>
          <p className="text-xs text-slate-400 max-w-md mx-auto">
            {activeTab === 'pending'
              ? 'When a customer places an order on the online menu, it will appear here instantly with full details.'
              : 'Try clearing your search query or switching tabs.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredOrders.map((order) => {
            const isPending = isPendingOrder(order);
            const phone = extractPhone(order);
            const customerName = order.customer_name || order.customer?.name || 'Online Customer';
            const isProcessing = processingId === order.id;

            return (
              <div
                key={order.id}
                className={`rounded-lg border transition duration-200 flex flex-col justify-between overflow-hidden shadow-lg ${
                  isPending
                    ? 'bg-slate-900/95 border-amber-500/50 hover:border-amber-500'
                    : 'bg-slate-900/60 border-slate-800/80 hover:border-slate-700'
                }`}
              >
                {/* Card Header */}
                <div className="p-4 border-b border-slate-800/80">
                  <div className="flex justify-between items-start gap-2 mb-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-base font-black text-white">
                          #{order.order_number}
                        </span>
                        {isPending ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/40 uppercase">
                            <Clock className="w-3 h-3 animate-spin" />
                            Awaiting Verify
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 uppercase">
                            <CheckCircle2 className="w-3 h-3" />
                            Verified
                          </span>
                        )}
                      </div>
                      <span className="text-[11px] text-slate-400 block mt-0.5">
                        {new Date(order.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} •{' '}
                        {new Date(order.created_at).toLocaleDateString()}
                      </span>
                    </div>

                    <div className="text-right">
                      <span className="text-base font-black text-amber-400 block">
                        {currency}{order.total?.toLocaleString()}
                      </span>
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-800 text-slate-300 uppercase">
                        {order.type === 'delivery' ? <Bike className="w-2.5 h-2.5 text-blue-400" /> : <ShoppingBag className="w-2.5 h-2.5 text-amber-400" />}
                        {order.type}
                      </span>
                    </div>
                  </div>

                  {/* Customer Information Box */}
                  <div className="bg-slate-950/60 rounded border border-slate-800/80 p-2.5 mt-2 space-y-1.5 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-white flex items-center gap-1.5">
                        <span>{customerName}</span>
                      </span>
                      {phone && (
                        <div className="flex items-center gap-1.5">
                          <a
                            href={`tel:${phone}`}
                            className="p-1 rounded bg-blue-950/60 border border-blue-600/40 text-blue-400 hover:bg-blue-900/60 transition"
                            title="Call customer"
                          >
                            <Phone className="w-3 h-3" />
                          </a>
                          <a
                            href={getWhatsAppLink(phone, order.order_number)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1 rounded bg-emerald-950/60 border border-emerald-600/40 text-emerald-400 hover:bg-emerald-900/60 transition"
                            title="WhatsApp Customer"
                          >
                            <MessageSquare className="w-3 h-3" />
                          </a>
                        </div>
                      )}
                    </div>

                    {phone && (
                      <div className="text-slate-300 font-mono text-[11px] flex items-center gap-1">
                        <Phone className="w-3 h-3 text-slate-500" />
                        <span>{phone}</span>
                      </div>
                    )}

                    {order.delivery_address && (
                      <div className="text-slate-400 text-[11px] flex items-start gap-1">
                        <MapPin className="w-3 h-3 text-rose-400 shrink-0 mt-0.5" />
                        <span className="line-clamp-2">{order.delivery_address}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Items Preview */}
                <div className="p-4 flex-1">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1.5">
                    Order Items ({order.items?.length || 0})
                  </span>
                  <div className="space-y-1.5 text-xs">
                    {order.items && order.items.length > 0 ? (
                      order.items.slice(0, 4).map((item, idx) => (
                        <div key={idx} className="flex justify-between items-start text-slate-300">
                          <div className="pr-2">
                            <span className="font-bold text-amber-400 mr-1.5">{item.quantity}x</span>
                            <span>{item.product_name}</span>
                            {(item as any).variant_selection && (
                              <span className="text-[10px] text-slate-400 block ml-4">
                                » {String((item as any).variant_selection)}
                              </span>
                            )}
                          </div>
                          <span className="font-mono text-slate-400 shrink-0">
                            {currency}{Number(item.total || 0).toLocaleString()}
                          </span>
                        </div>
                      ))
                    ) : (
                      <span className="text-slate-500 text-xs italic">Items details in ticket</span>
                    )}
                    {order.items && order.items.length > 4 && (
                      <span className="text-[11px] text-slate-500 italic block">
                        +{order.items.length - 4} more items...
                      </span>
                    )}
                  </div>
                </div>

                {/* Card Action Buttons */}
                <div className="p-3 bg-slate-950/40 border-t border-slate-800 flex items-center gap-2">
                  {isPending ? (
                    <>
                      <button
                        onClick={() => handleVerifyOrder(order)}
                        disabled={isProcessing}
                        className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs py-2 px-3 rounded flex items-center justify-center gap-1.5 shadow transition disabled:opacity-50"
                      >
                        {isProcessing ? (
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <ShieldCheck className="w-3.5 h-3.5" />
                        )}
                        <span>{isProcessing ? 'Verifying...' : 'Verify & Print'}</span>
                      </button>

                      <button
                        onClick={() => setRejectingOrder(order)}
                        disabled={isProcessing}
                        className="p-2 bg-rose-950/40 hover:bg-rose-900/60 border border-rose-600/40 text-rose-400 rounded transition"
                        title="Reject Order"
                      >
                        <XCircle className="w-4 h-4" />
                      </button>
                    </>
                  ) : (
                    <div className="w-full flex items-center justify-between text-xs text-slate-400">
                      <span className="text-emerald-400 font-semibold flex items-center gap-1">
                        <Check className="w-3.5 h-3.5" />
                        <span>Verified & Printed</span>
                      </span>
                      <button
                        onClick={() => handleVerifyOrder(order)}
                        className="text-[11px] text-slate-400 hover:text-white flex items-center gap-1 underline underline-offset-2"
                      >
                        <Printer className="w-3 h-3" />
                        <span>Re-print</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ─── REJECT MODAL ─── */}
      {rejectingOrder && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-lg max-w-md w-full p-6 shadow-2xl">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-rose-500" />
                <span>Reject Order #{rejectingOrder.order_number}</span>
              </h3>
              <button
                onClick={() => setRejectingOrder(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-400 mb-4">
              Are you sure you want to reject this order? It will be marked cancelled and will not be sent to the kitchen.
            </p>

            <div className="space-y-3 mb-5">
              <label className="text-xs font-bold text-slate-300 block">
                Select or Type Reason:
              </label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  'Customer uncontactable',
                  'Fake / prank order',
                  'Out of delivery zone',
                  'Item out of stock',
                ].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setRejectReason(preset)}
                    className={`text-[11px] p-2 rounded border text-left transition ${
                      rejectReason === preset
                        ? 'bg-rose-950 border-rose-500 text-rose-300 font-bold'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    {preset}
                  </button>
                ))}
              </div>

              <input
                type="text"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Or custom rejection reason..."
                className="w-full bg-slate-950 border border-slate-800 rounded p-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-rose-500"
              />
            </div>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setRejectingOrder(null)}
                disabled={rejectLoading}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs rounded transition"
              >
                Cancel
              </button>
              <button
                onClick={handleRejectConfirm}
                disabled={rejectLoading}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs rounded transition flex items-center gap-1.5"
              >
                {rejectLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <XCircle className="w-3.5 h-3.5" />}
                <span>Confirm Rejection</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

