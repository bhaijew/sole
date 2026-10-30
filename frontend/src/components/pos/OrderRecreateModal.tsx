'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import toast from 'react-hot-toast';
import {
  X,
  Plus,
  Trash2,
  RefreshCw,
  ShoppingBag,
  Sparkles,
  User,
  Phone,
  MapPin,
  UtensilsCrossed,
  Printer,
  ChevronDown,
  ArrowRight,
  Layers,
} from 'lucide-react';
import type { Order } from '@/lib/types';
import { useCartStore } from '@/store/cart';

export interface RecreateItemState {
  id?: number | string;
  product_id?: number | null;
  name: string;
  price: number;
  qty: number;
  detail?: string;
  variant_selection?: any;
  items_included?: any;
  special_instructions?: string;
}

export interface OrderRecreateModalProps {
  isOpen: boolean;
  onClose: () => void;
  order: Order | null;
  currency?: string;
  onOrderRecreated?: (updatedOrNewOrder: any) => void;
}

export default function OrderRecreateModal({
  isOpen,
  onClose,
  order,
  currency = 'Rs.',
  onOrderRecreated,
}: OrderRecreateModalProps) {
  const router = useRouter();
  const { loadItems, setOrderType: setCartOrderType, setCustomerName: setCartCustName, setCustomerPhone: setCartCustPhone, setDeliveryAddress: setCartDeliveryAddr, setDeliveryFee: setCartDeliveryFee } = useCartStore();

  const [mode, setMode] = useState<'new' | 'update'>('new');
  const [items, setItems] = useState<RecreateItemState[]>([]);
  const [orderType, setOrderType] = useState<'dine_in' | 'takeaway' | 'delivery'>('takeaway');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [deliveryFee, setDeliveryFee] = useState<number>(0);
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'online' | 'paid'>('cash');
  const [specialInstructions, setSpecialInstructions] = useState('');
  const [printKot, setPrintKot] = useState(true);
  const [printReceipt, setPrintReceipt] = useState(true);

  // Available products for adding new items
  const [availableProducts, setAvailableProducts] = useState<any[]>([]);
  const [selectedProductId, setSelectedProductId] = useState<string>('');
  const [addQty, setAddQty] = useState(1);

  // Custom Item Inputs
  const [showCustomItem, setShowCustomItem] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customPrice, setCustomPrice] = useState<string>('');
  const [customQty, setCustomQty] = useState(1);

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Fetch available products
  useEffect(() => {
    if (!isOpen) return;
    api
      .get('/products')
      .then((res) => {
        if (Array.isArray(res.data)) {
          setAvailableProducts(res.data);
        } else if (res.data?.products && Array.isArray(res.data.products)) {
          setAvailableProducts(res.data.products);
        }
      })
      .catch(() => {});
  }, [isOpen]);

  // Populate data when order opens
  useEffect(() => {
    if (!order || !isOpen) return;

    setErrorMsg(null);
    setMode('new');
    setOrderType(order.type === 'dine_in' || order.type === 'delivery' ? order.type : 'takeaway');
    setCustomerName(order.customer_name || (order.customer as any)?.name || '');
    setCustomerPhone(order.customer_phone || (order.customer as any)?.phone || '');
    setDeliveryAddress(order.delivery_address || '');
    setDeliveryFee(Number(order.delivery_fee || order.delivery_charge || 0));
    setPaymentMethod(((order as any).payment_method as any) || 'cash');
    setSpecialInstructions(order.special_instructions || '');
    setPrintKot(true);
    setPrintReceipt(true);
    setSelectedProductId('');
    setAddQty(1);
    setShowCustomItem(false);

    // Parse items
    const rawItems = Array.isArray(order.items) ? order.items : [];
    const mapped: RecreateItemState[] = rawItems.map((it: any) => ({
      id: it.id,
      product_id: it.product_id || it.product?.id || null,
      name: it.product_name || it.name || it.product?.name || 'Menu Item',
      price: Number(it.unit_price || it.price || it.product?.price || 0),
      qty: Math.max(1, Number(it.quantity || it.qty || 1)),
      detail:
        it.variant_selection?.name ||
        (typeof it.variant_selection === 'string' ? it.variant_selection : undefined) ||
        it.detail ||
        undefined,
      variant_selection: it.variant_selection || null,
      items_included: it.items_included || null,
      special_instructions: it.special_instructions || undefined,
    }));

    setItems(mapped.length > 0 ? mapped : [{ name: 'Order Item', price: Number(order.total) || 0, qty: 1 }]);
  }, [order, isOpen]);

  // Calculations
  const subtotal = useMemo(() => {
    return items.reduce((acc, it) => acc + (Number(it.price) || 0) * (Number(it.qty) || 1), 0);
  }, [items]);

  const grandTotal = useMemo(() => {
    const fee = orderType === 'delivery' ? Number(deliveryFee) || 0 : 0;
    return subtotal + fee;
  }, [subtotal, deliveryFee, orderType]);

  // Quantity helpers
  const handleUpdateQty = (index: number, delta: number) => {
    setItems((prev) => {
      const next = [...prev];
      const cur = next[index];
      const newQty = cur.qty + delta;
      if (newQty <= 0) {
        next.splice(index, 1);
      } else {
        next[index] = { ...cur, qty: newQty };
      }
      return next;
    });
  };

  const handleRemoveItem = (index: number) => {
    setItems((prev) => prev.filter((_, idx) => idx !== index));
  };

  // Add menu item
  const handleAddMenuItem = () => {
    if (!selectedProductId) return;
    const prod = availableProducts.find((p) => String(p.id) === String(selectedProductId));
    if (!prod) return;

    setItems((prev) => [
      ...prev,
      {
        product_id: prod.id,
        name: prod.name,
        price: Number(prod.price) || 0,
        qty: Math.max(1, addQty),
      },
    ]);

    setSelectedProductId('');
    setAddQty(1);
  };

  // Add custom item
  const handleAddCustomItem = () => {
    if (!customName.trim()) return;
    const priceNum = parseFloat(customPrice) || 0;
    setItems((prev) => [
      ...prev,
      {
        name: customName.trim(),
        price: priceNum,
        qty: Math.max(1, customQty),
      },
    ]);
    setCustomName('');
    setCustomPrice('');
    setCustomQty(1);
    setShowCustomItem(false);
  };

  // Load into POS Cart & Navigate
  const handleLoadIntoPosCart = () => {
    if (items.length === 0) {
      toast.error('No items to load');
      return;
    }

    const cartItems = items.map((it) => ({
      id: `${it.product_id || it.name}-${Date.now()}`,
      product: {
        id: (it.product_id as number) || 999999,
        name: it.name,
        price: it.price,
        is_available: true,
      } as any,
      quantity: it.qty,
      addons: [],
      special_instructions: it.special_instructions || '',
      unit_price: it.price,
      size: it.detail,
    }));

    loadItems(cartItems, null, null, 1);
    setCartOrderType(orderType);
    setCartCustName(customerName);
    setCartCustPhone(customerPhone);
    setCartDeliveryAddr(deliveryAddress);
    setCartDeliveryFee(orderType === 'delivery' ? deliveryFee : 0);

    toast.success('Loaded into POS Cart! Complete payment at checkout.');
    onClose();
    router.push('/pos');
  };

  // Submit Recreated Order
  const handleSubmit = async () => {
    if (!order) return;
    if (items.length === 0) {
      setErrorMsg('Order must contain at least 1 item.');
      return;
    }

    setErrorMsg(null);
    setLoading(true);

    try {
      const payload = {
        mode,
        type: orderType,
        customer_name: customerName.trim() || undefined,
        customer_phone: customerPhone.trim() || undefined,
        delivery_address: orderType === 'delivery' ? deliveryAddress.trim() || undefined : undefined,
        delivery_fee: orderType === 'delivery' ? Number(deliveryFee) || 0 : 0,
        payment_method: paymentMethod,
        special_instructions: specialInstructions.trim() || undefined,
        items: items.map((it) => ({
          product_id: it.product_id,
          product_name: it.name,
          unit_price: it.price,
          quantity: it.qty,
          detail: it.detail,
          variant_selection: it.variant_selection,
          items_included: it.items_included,
          special_instructions: it.special_instructions,
        })),
      };

      const res = await api.post(`/orders/${order.id}/recreate`, payload);
      const createdOrder = res.data?.order;

      if (!createdOrder) {
        throw new Error(res.data?.error || 'Order creation failed');
      }

      toast.success(
        mode === 'new'
          ? `Order #${createdOrder.order_number} Recreated Successfully!`
          : `Order #${createdOrder.order_number} Updated & Re-sent to Kitchen!`
      );

      // Trigger automatic printing if selected
      if (printKot && createdOrder.id) {
        api.post('/printers/print-kot', { orderId: createdOrder.id, station: 'Kitchen' }).catch(() => {});
      }
      if (printReceipt && createdOrder.id) {
        api.post('/printers/print-bill', { orderId: createdOrder.id }).catch(() => {});
      }

      if (onOrderRecreated) {
        onOrderRecreated(createdOrder);
      }
      onClose();
    } catch (err: any) {
      console.error('[Recreate] Submit error:', err);
      setErrorMsg(err.response?.data?.error || err.message || 'Failed to recreate order');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen || !order) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl border border-slate-200 overflow-hidden relative my-6 flex flex-col max-h-[92vh]">
        
        {/* Header */}
        <div className="bg-gradient-to-r from-orange-600 via-amber-600 to-red-600 text-white px-5 py-3.5 flex items-center justify-between shadow-md shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/20 backdrop-blur-md flex items-center justify-center text-white border border-white/20">
              <RefreshCw size={20} className="animate-spin-slow" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-black uppercase tracking-tight text-white">
                  Recreate Order
                </h3>
                <span className="text-[10px] font-mono font-bold bg-black/25 px-2 py-0.5 rounded text-amber-100">
                  Ref #{order.order_number}
                </span>
              </div>
              <p className="text-xs text-amber-100">
                Repeat or modify this order with instant kitchen ticket & receipt
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/25 text-white flex items-center justify-center text-sm font-bold transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Error Alert */}
        {errorMsg && (
          <div className="mx-5 mt-3 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800 font-semibold flex items-center gap-2">
            <span>⚠️</span>
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Modal Scrollable Body */}
        <div className="p-5 overflow-y-auto space-y-4 flex-1">
          
          {/* Mode Selector Tabs */}
          <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 rounded-xl">
            <button
              type="button"
              onClick={() => setMode('new')}
              className={`py-2 px-3 text-xs font-black rounded-lg transition-all flex items-center justify-center gap-1.5 ${
                mode === 'new'
                  ? 'bg-white text-orange-600 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Sparkles size={14} />
              <span>Recreate as New Order</span>
            </button>
            <button
              type="button"
              onClick={() => setMode('update')}
              className={`py-2 px-3 text-xs font-black rounded-lg transition-all flex items-center justify-center gap-1.5 ${
                mode === 'update'
                  ? 'bg-white text-orange-600 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <RefreshCw size={14} />
              <span>Update Existing #{order.order_number}</span>
            </button>
          </div>

          {/* Quick Load into POS Cart Banner */}
          <div className="flex items-center justify-between p-3 rounded-xl bg-orange-50/80 border border-orange-200 text-xs">
            <div className="flex items-center gap-2 text-orange-950 font-medium">
              <ShoppingBag size={16} className="text-orange-600 shrink-0" />
              <span>Want to ring this up at the cashier counter?</span>
            </div>
            <button
              type="button"
              onClick={handleLoadIntoPosCart}
              className="px-3 py-1.5 rounded-lg bg-orange-600 hover:bg-orange-700 text-white font-extrabold text-xs transition-colors flex items-center gap-1 shrink-0"
            >
              <span>Load into POS Cart</span>
              <ArrowRight size={12} />
            </button>
          </div>

          {/* Items Section */}
          <div className="border border-slate-200 rounded-xl overflow-hidden bg-slate-50/50">
            <div className="px-4 py-2.5 bg-slate-100/80 border-b border-slate-200 flex items-center justify-between text-xs font-bold text-slate-700">
              <span className="flex items-center gap-1.5 uppercase tracking-wider text-[11px]">
                <Layers size={13} className="text-orange-600" />
                Order Items ({items.length})
              </span>
              <span className="font-mono text-slate-500">Subtotal: {currency}{subtotal.toLocaleString()}</span>
            </div>

            <div className="p-3 space-y-2 max-h-56 overflow-y-auto">
              {items.map((it, idx) => (
                <div
                  key={idx}
                  className="bg-white border border-slate-200 rounded-lg p-2.5 flex items-center justify-between gap-3 shadow-2xs"
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-bold text-xs text-slate-800 truncate">{it.name}</div>
                    {it.detail && (
                      <div className="text-[10px] text-orange-700 font-semibold">{it.detail}</div>
                    )}
                    <div className="text-[11px] font-mono text-slate-500">
                      {currency}{Number(it.price).toLocaleString()} each
                    </div>
                  </div>

                  {/* Quantity Controls */}
                  <div className="flex items-center gap-1.5 bg-slate-100 rounded-lg p-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleUpdateQty(idx, -1)}
                      className="w-6 h-6 rounded bg-white text-slate-700 font-black hover:bg-slate-200 flex items-center justify-center text-xs shadow-2xs"
                    >
                      -
                    </button>
                    <span className="w-7 text-center font-bold text-xs text-slate-900 font-mono">
                      {it.qty}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleUpdateQty(idx, 1)}
                      className="w-6 h-6 rounded bg-white text-slate-700 font-black hover:bg-slate-200 flex items-center justify-center text-xs shadow-2xs"
                    >
                      +
                    </button>
                  </div>

                  {/* Item Subtotal */}
                  <div className="w-20 text-right font-mono font-bold text-xs text-slate-800 shrink-0">
                    {currency}{(it.price * it.qty).toLocaleString()}
                  </div>

                  {/* Delete button */}
                  <button
                    type="button"
                    onClick={() => handleRemoveItem(idx)}
                    className="text-slate-400 hover:text-red-600 p-1 rounded hover:bg-red-50 transition-colors shrink-0"
                    title="Remove Item"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>

            {/* Add Item Row */}
            <div className="p-3 bg-white border-t border-slate-200 space-y-2">
              {!showCustomItem ? (
                <div className="flex flex-col sm:flex-row gap-2">
                  <div className="flex-1 relative">
                    <select
                      value={selectedProductId}
                      onChange={(e) => setSelectedProductId(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-medium text-slate-800 focus:outline-hidden focus:border-orange-500"
                    >
                      <option value="">＋ Select product from menu to add...</option>
                      {availableProducts.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} — {currency}{Number(p.price).toLocaleString()}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <input
                      type="number"
                      min="1"
                      value={addQty}
                      onChange={(e) => setAddQty(Math.max(1, parseInt(e.target.value) || 1))}
                      className="w-14 bg-slate-50 border border-slate-200 rounded-lg px-2 py-2 text-xs text-center font-bold font-mono"
                    />
                    <button
                      type="button"
                      disabled={!selectedProductId}
                      onClick={handleAddMenuItem}
                      className="px-3 py-2 rounded-lg bg-orange-600 hover:bg-orange-700 text-white font-bold text-xs disabled:opacity-40 transition-colors flex items-center gap-1"
                    >
                      <Plus size={13} />
                      <span>Add</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowCustomItem(true)}
                      className="px-2.5 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs transition-colors"
                      title="Add Custom Item"
                    >
                      Custom
                    </button>
                  </div>
                </div>
              ) : (
                <div className="p-2.5 bg-orange-50/60 border border-orange-200 rounded-lg space-y-2">
                  <div className="flex items-center justify-between text-xs font-bold text-orange-900">
                    <span>Add Custom Item:</span>
                    <button
                      type="button"
                      onClick={() => setShowCustomItem(false)}
                      className="text-slate-500 hover:text-slate-700 text-[11px]"
                    >
                      Cancel
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                    <input
                      type="text"
                      placeholder="Item name (e.g. Extra Wings)"
                      value={customName}
                      onChange={(e) => setCustomName(e.target.value)}
                      className="sm:col-span-2 bg-white border border-slate-200 rounded px-2.5 py-1.5 text-xs font-medium"
                    />
                    <input
                      type="number"
                      placeholder="Price"
                      value={customPrice}
                      onChange={(e) => setCustomPrice(e.target.value)}
                      className="bg-white border border-slate-200 rounded px-2.5 py-1.5 text-xs font-mono"
                    />
                    <button
                      type="button"
                      disabled={!customName.trim()}
                      onClick={handleAddCustomItem}
                      className="bg-orange-600 hover:bg-orange-700 text-white font-bold text-xs py-1.5 rounded disabled:opacity-40"
                    >
                      Add Custom
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Customer & Order Settings Form */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            
            {/* Order Type */}
            <div>
              <label className="block text-[11px] font-black uppercase tracking-wider text-slate-700 mb-1">
                Order Type *
              </label>
              <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-xl">
                {(['dine_in', 'takeaway', 'delivery'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setOrderType(t)}
                    className={`py-1.5 text-xs font-bold rounded-lg capitalize transition-all ${
                      orderType === t
                        ? 'bg-white text-orange-600 shadow-2xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {t === 'dine_in' ? 'Dine-In' : t}
                  </button>
                ))}
              </div>
            </div>

            {/* Payment Method */}
            <div>
              <label className="block text-[11px] font-black uppercase tracking-wider text-slate-700 mb-1">
                Payment Method
              </label>
              <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-xl">
                {(['cash', 'online', 'paid'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setPaymentMethod(m)}
                    className={`py-1.5 text-xs font-bold rounded-lg uppercase tracking-wider transition-all ${
                      paymentMethod === m
                        ? m === 'paid' ? 'bg-emerald-600 text-white' : 'bg-white text-orange-600 shadow-2xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>

            {/* Customer Name */}
            <div>
              <label className="block text-[11px] font-black uppercase tracking-wider text-slate-700 mb-1 flex items-center gap-1">
                <User size={12} className="text-slate-400" />
                Customer Name
              </label>
              <input
                type="text"
                placeholder="Walk-in Customer / Name"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-medium focus:border-orange-500 focus:outline-hidden"
              />
            </div>

            {/* Customer Phone */}
            <div>
              <label className="block text-[11px] font-black uppercase tracking-wider text-slate-700 mb-1 flex items-center gap-1">
                <Phone size={12} className="text-slate-400" />
                Customer Phone
              </label>
              <input
                type="text"
                placeholder="03001234567"
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-mono font-medium focus:border-orange-500 focus:outline-hidden"
              />
            </div>

            {/* Delivery Fields (if Delivery) */}
            {orderType === 'delivery' && (
              <>
                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-black uppercase tracking-wider text-slate-700 mb-1 flex items-center gap-1">
                    <MapPin size={12} className="text-slate-400" />
                    Delivery Address *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="House / Street / Area / Landmark..."
                    value={deliveryAddress}
                    onChange={(e) => setDeliveryAddress(e.target.value)}
                    className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-medium focus:border-orange-500 focus:outline-hidden"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-black uppercase tracking-wider text-slate-700 mb-1">
                    Delivery Fee ({currency})
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min="0"
                      value={deliveryFee}
                      onChange={(e) => setDeliveryFee(Math.max(0, parseFloat(e.target.value) || 0))}
                      className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-mono font-bold focus:border-orange-500 focus:outline-hidden"
                    />
                    <div className="flex gap-1 shrink-0">
                      {[0, 50, 100, 150].map((f) => (
                        <button
                          key={f}
                          type="button"
                          onClick={() => setDeliveryFee(f)}
                          className="px-2 py-1 bg-slate-100 hover:bg-slate-200 rounded text-[10px] font-bold text-slate-700"
                        >
                          {f === 0 ? 'Free' : f}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* Special Instructions */}
            <div className={orderType === 'delivery' ? '' : 'sm:col-span-2'}>
              <label className="block text-[11px] font-black uppercase tracking-wider text-slate-700 mb-1">
                Instructions / Notes
              </label>
              <input
                type="text"
                placeholder="e.g. Less spicy, extra sauce, call on arrival..."
                value={specialInstructions}
                onChange={(e) => setSpecialInstructions(e.target.value)}
                className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-medium focus:border-orange-500 focus:outline-hidden"
              />
            </div>
          </div>

          {/* Thermal Print Toggles */}
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex flex-wrap items-center justify-between gap-3 text-xs">
            <span className="font-bold text-slate-700">Auto Print on Recreate:</span>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-1.5 cursor-pointer font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={printKot}
                  onChange={(e) => setPrintKot(e.target.checked)}
                  className="rounded text-orange-600 focus:ring-orange-500"
                />
                <UtensilsCrossed size={13} className="text-amber-600" />
                <span>Kitchen KOT Slip</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={printReceipt}
                  onChange={(e) => setPrintReceipt(e.target.checked)}
                  className="rounded text-orange-600 focus:ring-orange-500"
                />
                <Printer size={13} className="text-emerald-600" />
                <span>Customer Receipt</span>
              </label>
            </div>
          </div>

        </div>

        {/* Footer / Action Bar */}
        <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-4 shrink-0">
          <div>
            <div className="text-[11px] text-slate-500 font-bold uppercase">Total Payable:</div>
            <div className="text-xl font-black text-slate-900 font-mono">
              {currency}{grandTotal.toLocaleString()}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 text-xs font-bold text-slate-600 hover:text-slate-900 rounded-xl hover:bg-slate-200 transition-colors"
            >
              Cancel
            </button>

            <button
              type="button"
              disabled={loading || items.length === 0}
              onClick={handleSubmit}
              className="bg-gradient-to-r from-orange-600 to-red-600 hover:from-orange-700 hover:to-red-700 text-white font-extrabold text-xs uppercase tracking-wider px-6 py-2.5 rounded-xl shadow-md shadow-orange-600/20 hover:shadow-lg transition-all disabled:opacity-50 flex items-center gap-2 cursor-pointer"
            >
              {loading ? (
                <RefreshCw size={14} className="animate-spin" />
              ) : (
                <Sparkles size={14} />
              )}
              <span>
                {loading
                  ? 'Processing...'
                  : mode === 'new'
                  ? `Recreate Order (${currency}${grandTotal.toLocaleString()})`
                  : `Update Order (${currency}${grandTotal.toLocaleString()})`}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
