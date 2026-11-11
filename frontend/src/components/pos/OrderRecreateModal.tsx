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
  Search,
  Check,
  ChefHat,
  Pizza,
  Lock,
} from 'lucide-react';
import type { Order } from '@/lib/types';
import { useCartStore } from '@/store/cart';

export interface RecreateItemState {
  id?: number | string;
  product_id?: number | string | null;
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
  const {
    loadItems,
    setOrderType: setCartOrderType,
    setCustomerName: setCartCustName,
    setCustomerPhone: setCartCustPhone,
    setDeliveryAddress: setCartDeliveryAddr,
    setDeliveryFee: setCartDeliveryFee,
    setRecreatingOrder,
  } = useCartStore();

  const [mode, setMode] = useState<'new' | 'update'>('update');
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
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedProductId, setSelectedProductId] = useState<string>('');
  const [selectedVariation, setSelectedVariation] = useState<any>(null);
  const [addQty, setAddQty] = useState(1);
  const [addMode, setAddMode] = useState<'menu' | 'custom'>('menu');

  // Custom Item Inputs
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
    setMode('update');
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
    setSelectedVariation(null);
    setAddQty(1);
    setAddMode('menu');
    setSearchQuery('');
    setSelectedCategory('all');

    // Parse items
    const rawItems = Array.isArray(order.items) ? order.items : [];
    const mapped: RecreateItemState[] = rawItems.map((it: any, idx: number) => ({
      id: it.id || `item-${idx}-${Date.now()}`,
      product_id: String(it.product_id || it.product?.id || it.id || `prod-${idx}-${Date.now()}`),
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

  // Selected product object
  const currentSelectedProduct = useMemo(() => {
    if (!selectedProductId) return null;
    return availableProducts.find((p) => String(p.id) === String(selectedProductId)) || null;
  }, [selectedProductId, availableProducts]);

  // Reset selected variation when product changes
  useEffect(() => {
    if (currentSelectedProduct && currentSelectedProduct.variations && currentSelectedProduct.variations.length > 0) {
      setSelectedVariation(currentSelectedProduct.variations[0]);
    } else {
      setSelectedVariation(null);
    }
  }, [currentSelectedProduct]);

  // Categories list
  const categories = useMemo(() => {
    const set = new Set<string>();
    availableProducts.forEach((p) => {
      const catName = p.category?.name || p.category_name;
      if (catName && typeof catName === 'string' && catName.trim()) {
        set.add(catName.trim());
      }
    });
    return ['all', ...Array.from(set)];
  }, [availableProducts]);

  // Filtered products
  const filteredProducts = useMemo(() => {
    return availableProducts.filter((p) => {
      const catName = p.category?.name || p.category_name || '';
      const matchesSearch =
        !searchQuery.trim() ||
        p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        catName.toLowerCase().includes(searchQuery.toLowerCase());

      const matchesCat =
        selectedCategory === 'all' ||
        catName.toLowerCase() === selectedCategory.toLowerCase();

      return matchesSearch && matchesCat;
    });
  }, [availableProducts, searchQuery, selectedCategory]);

  // Calculations
  const subtotal = useMemo(() => {
    return items.reduce((acc, it) => acc + (Number(it.price) || 0) * (Number(it.qty) || 1), 0);
  }, [items]);

  const grandTotal = useMemo(() => {
    return subtotal + (orderType === 'delivery' ? Number(deliveryFee) || 0 : 0);
  }, [subtotal, orderType, deliveryFee]);

  // Quantity handlers
  const handleUpdateQty = (index: number, delta: number) => {
    setItems((prev) =>
      prev
        .map((it, idx) => {
          if (idx !== index) return it;
          const newQty = it.qty + delta;
          return { ...it, qty: newQty };
        })
        .filter((it) => it.qty > 0)
    );
  };

  const handleUpdatePrice = (index: number, newPrice: number) => {
    setItems((prev) =>
      prev.map((it, idx) => (idx === index ? { ...it, price: Math.max(0, newPrice) } : it))
    );
  };

  const handleRemoveItem = (index: number) => {
    setItems((prev) => prev.filter((_, idx) => idx !== index));
  };

  // Select product card
  const handleSelectProductCard = (prod: any) => {
    setSelectedProductId(String(prod.id));
    setAddQty(1);
    if (prod.variations && prod.variations.length > 0) {
      setSelectedVariation(prod.variations[0]);
    } else {
      setSelectedVariation(null);
    }
  };

  // Add menu item
  const handleAddMenuItem = () => {
    if (!currentSelectedProduct) return;

    const price = selectedVariation ? Number(selectedVariation.price) : Number(currentSelectedProduct.price) || 0;
    const detail = selectedVariation ? selectedVariation.name : undefined;

    const existingIndex = items.findIndex(
      (it) => String(it.product_id) === String(currentSelectedProduct.id) && it.detail === detail
    );

    if (existingIndex >= 0) {
      handleUpdateQty(existingIndex, addQty);
    } else {
      setItems((prev) => [
        ...prev,
        {
          id: `item-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          product_id: currentSelectedProduct.id,
          name: currentSelectedProduct.name,
          price,
          qty: Math.max(1, addQty),
          detail,
          variant_selection: selectedVariation ? { name: selectedVariation.name, price } : null,
          items_included: currentSelectedProduct.items_included || currentSelectedProduct.description || null,
        },
      ]);
    }

    setAddQty(1);
  };

  // Add custom item
  const handleAddCustomItem = () => {
    if (!customName.trim()) return;
    const priceNum = parseFloat(customPrice) || 0;
    const customId = `custom-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setItems((prev) => [
      ...prev,
      {
        id: customId,
        product_id: customId,
        name: customName.trim(),
        price: priceNum,
        qty: Math.max(1, customQty),
      },
    ]);
    setCustomName('');
    setCustomPrice('');
    setCustomQty(1);
  };

  // Load into POS Cart & Navigate
  const handleLoadIntoPosCart = () => {
    if (!order) return;
    if (items.length === 0) {
      toast.error('No items to load');
      return;
    }

    const cartItems = items.map((it, idx) => ({
      id: `${it.product_id || it.name}-${Date.now()}-${idx}`,
      product: {
        id: String(it.product_id || `custom-${Date.now()}-${idx}`),
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
    setRecreatingOrder(order.id, order.order_number);

    toast.success(`Loaded Order #${order.order_number} into POS Cart! Add/modify items and confirm to update.`);
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
        items: items.map((it, idx) => ({
          product_id: String(it.product_id || `item-${idx}-${Date.now()}`),
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

      // Trigger automatic printing if selected with fresh items attached
      const itemsToPrint = Array.isArray(createdOrder.items) && createdOrder.items.length > 0
        ? createdOrder.items
        : payload.items;

      if (printKot && printReceipt && createdOrder.id) {
        api.post('/printers/print-order', { orderId: createdOrder.id, printType: 'both', items: itemsToPrint }).catch(() => {});
      } else if (printKot && createdOrder.id) {
        api.post('/printers/print-order', { orderId: createdOrder.id, printType: 'kot', items: itemsToPrint }).catch(() => {});
      } else if (printReceipt && createdOrder.id) {
        api.post('/printers/print-order', { orderId: createdOrder.id, printType: 'bill', items: itemsToPrint }).catch(() => {});
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
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4 overflow-hidden animate-in fade-in duration-150">
      {/* ─── FULL SIZE MODAL CONTAINER (WIDESCREEN EXPANSIVE) ────── */}
      <div className="bg-white rounded-3xl w-full max-w-6xl xl:max-w-7xl h-[94vh] max-h-[94vh] shadow-2xl border border-slate-200 overflow-hidden flex flex-col">
        
        {/* Header */}
        <div className="bg-gradient-to-r from-orange-600 via-amber-600 to-red-600 text-white px-5 py-3.5 flex items-center justify-between shadow-md shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-white/20 backdrop-blur-md flex items-center justify-center text-white border border-white/20 shrink-0">
              <RefreshCw size={20} className="animate-spin-slow" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] font-black uppercase tracking-wider bg-white/20 px-2 py-0.5 rounded-full text-white">
                  FloDesktop POS Recreator
                </span>
                <span className="text-xs font-mono font-black bg-black/30 px-2.5 py-0.5 rounded-md text-amber-200 flex items-center gap-1">
                  <Lock size={11} className="text-emerald-400" />
                  Ref #{order.order_number}
                </span>
                <span className="text-[11px] font-bold bg-white/15 px-2 py-0.5 rounded-md text-white capitalize">
                  {orderType}
                </span>
              </div>
              <h3 className="text-base font-black text-white tracking-tight leading-snug">
                Recreate &amp; Modify Customer Order
              </h3>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleLoadIntoPosCart}
              className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/15 hover:bg-white/25 text-white font-extrabold text-xs transition-colors border border-white/20"
              title="Load items directly into active Cashier Cart"
            >
              <ShoppingBag size={13} />
              <span>Load into POS Cart</span>
            </button>
            <button
              onClick={onClose}
              className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/25 text-white flex items-center justify-center font-bold transition-colors cursor-pointer"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Error Alert */}
        {errorMsg && (
          <div className="mx-5 mt-3 p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-800 font-semibold flex items-center gap-2 shrink-0">
            <span>⚠️</span>
            <span>{errorMsg}</span>
          </div>
        )}

        {/* ─── TWO-COLUMN WORKSPACE BODY ───────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-12 flex-1 overflow-hidden min-h-0">
          
          {/* ════════════════════════════════════════════════════════════
              LEFT COLUMN: RECREATE ORDER ITEMS & SETTINGS (7 COLS)
              ════════════════════════════════════════════════════════════ */}
          <div className="lg:col-span-7 flex flex-col h-full overflow-hidden border-b lg:border-b-0 lg:border-r border-slate-200">
            
            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
              
              {/* Mode Selector Tabs */}
              <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 rounded-2xl border border-slate-200">
                <button
                  type="button"
                  onClick={() => setMode('update')}
                  className={`py-2 px-3 text-xs font-black rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                    mode === 'update'
                      ? 'bg-white text-orange-600 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <RefreshCw size={14} />
                  <span>Update Existing #{order.order_number}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setMode('new')}
                  className={`py-2 px-3 text-xs font-black rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                    mode === 'new'
                      ? 'bg-white text-orange-600 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Sparkles size={14} />
                  <span>Recreate as New Order</span>
                </button>
              </div>

              {/* Order Items Header */}
              <div className="flex items-center justify-between px-0.5">
                <span className="flex items-center gap-1.5 uppercase tracking-wider text-xs font-black text-slate-800">
                  <Layers size={14} className="text-orange-600" />
                  <span>Order Items ({items.length})</span>
                </span>
                <span className="font-mono text-xs font-bold text-slate-500">
                  Subtotal: {currency}{subtotal.toLocaleString()}
                </span>
              </div>

              {/* Items List */}
              <div className="border border-slate-200 rounded-2xl overflow-hidden divide-y divide-slate-100 bg-white shadow-2xs">
                {items.length === 0 ? (
                  <div className="p-8 text-center text-slate-400 text-xs space-y-1">
                    <ChefHat size={32} className="mx-auto text-slate-300" />
                    <p className="font-bold text-slate-700">Ticket is empty</p>
                    <p>Select Pizza or items from the catalog on the right.</p>
                  </div>
                ) : (
                  items.map((it, idx) => (
                    <div
                      key={idx}
                      className="p-3 text-xs flex items-center justify-between gap-3 hover:bg-slate-50/70 transition-colors"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-black text-xs text-slate-900 truncate">{it.name}</div>
                        {it.detail && (
                          <span className="inline-block mt-0.5 text-[10px] font-extrabold bg-orange-50 text-orange-700 border border-orange-200 px-1.5 py-0.2 rounded">
                            🍕 {it.detail}
                          </span>
                        )}
                      </div>

                      {/* Stepper, Price override, Line total, Delete */}
                      <div className="flex items-center gap-2 sm:gap-2.5 shrink-0">
                        {/* Stepper */}
                        <div className="flex items-center border border-slate-200 rounded-xl bg-slate-50 overflow-hidden shadow-2xs">
                          <button
                            type="button"
                            onClick={() => handleUpdateQty(idx, -1)}
                            className="w-6 h-6 text-slate-700 font-black hover:bg-slate-200 flex items-center justify-center text-xs"
                          >
                            −
                          </button>
                          <span className="px-2 text-xs font-black font-mono text-slate-900 min-w-5 text-center">
                            {it.qty}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleUpdateQty(idx, 1)}
                            className="w-6 h-6 text-slate-700 font-black hover:bg-slate-200 flex items-center justify-center text-xs"
                          >
                            +
                          </button>
                        </div>

                        {/* Price override */}
                        <div className="flex items-center bg-slate-50 border border-slate-200 rounded-xl px-1.5 py-0.5">
                          <span className="text-[10px] text-slate-400 font-bold mr-0.5">@</span>
                          <input
                            type="number"
                            min="0"
                            value={it.price}
                            onChange={(e) => handleUpdatePrice(idx, parseFloat(e.target.value) || 0)}
                            className="w-14 text-xs font-mono font-bold text-slate-800 bg-transparent text-right focus:outline-none"
                          />
                        </div>

                        {/* Line Total */}
                        <div className="w-16 sm:w-20 text-right font-mono font-black text-xs text-slate-900">
                          {currency}{(it.price * it.qty).toLocaleString()}
                        </div>

                        {/* Delete button */}
                        <button
                          type="button"
                          onClick={() => handleRemoveItem(idx)}
                          className="w-7 h-7 flex items-center justify-center text-slate-300 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                          title="Remove Item"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Customer & Order Settings Form */}
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3.5 space-y-3">
                <div className="text-[11px] font-black uppercase tracking-wider text-slate-500">
                  Customer &amp; Fulfillment Settings
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <div>
                    <label className="text-[10px] font-bold text-slate-600 block mb-1">Customer Name</label>
                    <input
                      type="text"
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      placeholder="Walk-in Customer"
                      className="w-full bg-white border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs font-bold text-slate-900"
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-bold text-slate-600 block mb-1">Phone Number</label>
                    <input
                      type="text"
                      value={customerPhone}
                      onChange={(e) => setCustomerPhone(e.target.value)}
                      placeholder="0300-1234567"
                      className="w-full bg-white border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs font-mono font-bold text-slate-900"
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-bold text-slate-600 block mb-1">Order Type</label>
                    <select
                      value={orderType}
                      onChange={(e: any) => setOrderType(e.target.value)}
                      className="w-full bg-white border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs font-bold text-slate-900"
                    >
                      <option value="takeaway">🛍️ Takeaway</option>
                      <option value="dine_in">🍽️ Dine-In</option>
                      <option value="delivery">🛵 Delivery</option>
                    </select>
                  </div>
                </div>

                {orderType === 'delivery' && (
                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5 pt-1 border-t border-slate-200/60">
                    <div className="sm:col-span-3">
                      <label className="text-[10px] font-bold text-slate-600 block mb-1">Delivery Address</label>
                      <input
                        type="text"
                        value={deliveryAddress}
                        onChange={(e) => setDeliveryAddress(e.target.value)}
                        placeholder="House #, Street, Block, Area"
                        className="w-full bg-white border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs text-slate-900"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-600 block mb-1">Delivery Fee ({currency})</label>
                      <input
                        type="number"
                        min="0"
                        value={deliveryFee}
                        onChange={(e) => setDeliveryFee(Math.max(0, parseFloat(e.target.value) || 0))}
                        className="w-full bg-white border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs font-mono font-bold text-slate-900 text-right"
                      />
                    </div>
                  </div>
                )}

                {/* Print Checkboxes */}
                <div className="flex items-center gap-4 pt-1 border-t border-slate-200/60 text-xs">
                  <span className="font-bold text-slate-600 text-[11px]">Auto Print:</span>
                  <label className="inline-flex items-center gap-1.5 cursor-pointer font-bold text-slate-800">
                    <input
                      type="checkbox"
                      checked={printKot}
                      onChange={(e) => setPrintKot(e.target.checked)}
                      className="rounded text-orange-600 focus:ring-orange-500 cursor-pointer"
                    />
                    <span>🍳 Kitchen KOT</span>
                  </label>
                  <label className="inline-flex items-center gap-1.5 cursor-pointer font-bold text-slate-800">
                    <input
                      type="checkbox"
                      checked={printReceipt}
                      onChange={(e) => setPrintReceipt(e.target.checked)}
                      className="rounded text-orange-600 focus:ring-orange-500 cursor-pointer"
                    />
                    <span>🧾 Customer Bill</span>
                  </label>
                </div>
              </div>
            </div>

            {/* Left Column Bottom Bar: Total & Submit */}
            <div className="p-4 border-t border-slate-200 bg-slate-50/90 backdrop-blur-md flex items-center justify-between gap-3 shrink-0">
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-2 border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 font-bold rounded-xl text-xs transition-colors"
              >
                Cancel
              </button>

              <div className="flex items-center gap-3">
                <div className="text-right">
                  <span className="text-[10px] uppercase font-black text-slate-400 block -mb-0.5">Total Amount</span>
                  <span className="text-base sm:text-xl font-black font-mono text-slate-900">
                    {currency}{grandTotal.toLocaleString()}
                  </span>
                </div>

                <button
                  type="button"
                  disabled={loading || items.length === 0}
                  onClick={handleSubmit}
                  className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-orange-600 via-amber-600 to-orange-600 hover:from-orange-700 hover:to-amber-700 active:scale-98 text-white text-xs sm:text-sm font-black transition-all shadow-md shadow-orange-600/25 disabled:opacity-40 cursor-pointer flex items-center gap-2"
                >
                  <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                  <span>
                    {loading
                      ? 'Recreating...'
                      : mode === 'new'
                      ? 'Recreate as New Order'
                      : 'Update Order & Send to Kitchen'}
                  </span>
                </button>
              </div>
            </div>
          </div>


          {/* ════════════════════════════════════════════════════════════
              RIGHT COLUMN: INTERACTIVE PIZZA & MENU CATALOG (5 COLS)
              ════════════════════════════════════════════════════════════ */}
          <div className="lg:col-span-5 flex flex-col h-full bg-slate-50/70 overflow-hidden">
            
            {/* Catalog Top Bar */}
            <div className="p-3.5 border-b border-slate-200 bg-white space-y-2.5 shrink-0">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 font-black text-xs text-slate-900 uppercase tracking-wide">
                  <Sparkles size={14} className="text-orange-600" />
                  <span>Select Items &amp; Pizza Sizes</span>
                </div>

                <div className="flex bg-slate-100 p-0.5 rounded-lg border border-slate-200 text-[11px] font-bold">
                  <button
                    type="button"
                    onClick={() => setAddMode('menu')}
                    className={`px-2.5 py-0.5 rounded-md transition-all cursor-pointer ${
                      addMode === 'menu' ? 'bg-white text-orange-600 shadow-2xs font-black' : 'text-slate-600'
                    }`}
                  >
                    Catalog
                  </button>
                  <button
                    type="button"
                    onClick={() => setAddMode('custom')}
                    className={`px-2.5 py-0.5 rounded-md transition-all cursor-pointer ${
                      addMode === 'custom' ? 'bg-white text-orange-600 shadow-2xs font-black' : 'text-slate-600'
                    }`}
                  >
                    Custom
                  </button>
                </div>
              </div>

              {addMode === 'menu' && (
                <>
                  {/* Search input */}
                  <div className="relative">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search pizza, burger, drink..."
                      className="w-full pl-8.5 pr-7 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 font-medium"
                    />
                    {searchQuery && (
                      <button
                        type="button"
                        onClick={() => setSearchQuery('')}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                      >
                        <X size={13} />
                      </button>
                    )}
                  </div>

                  {/* Category Pills */}
                  {categories.length > 1 && (
                    <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 no-scrollbar text-[11px] font-bold">
                      {categories.map((cat) => {
                        const isSelected = selectedCategory === cat;
                        const label = cat === 'all' ? 'All Products' : cat;
                        const isPizzaCat = cat.toLowerCase().includes('pizza');

                        return (
                          <button
                            key={cat}
                            type="button"
                            onClick={() => setSelectedCategory(cat)}
                            className={`px-2.5 py-1 rounded-lg shrink-0 transition-all cursor-pointer flex items-center gap-1 ${
                              isSelected
                                ? 'bg-orange-600 text-white font-black shadow-xs'
                                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                            }`}
                          >
                            {isPizzaCat && <span>🍕</span>}
                            <span>{label}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Catalog Content */}
            {addMode === 'custom' ? (
              <div className="p-4 space-y-3 flex-1 overflow-y-auto">
                <div className="bg-white border border-amber-200 rounded-2xl p-4 space-y-3 shadow-xs">
                  <h4 className="font-black text-xs text-slate-800 uppercase tracking-wide flex items-center gap-1.5">
                    <Plus size={14} className="text-orange-600 stroke-[3]" />
                    <span>Add Custom Item</span>
                  </h4>
                  <div className="space-y-2.5">
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Item Title *</label>
                      <input
                        type="text"
                        value={customName}
                        onChange={(e) => setCustomName(e.target.value)}
                        placeholder="e.g. Extra Dip, Loaded Fries"
                        className="w-full px-3 py-2 text-xs font-bold bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-1 focus:ring-orange-500"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Price ({currency}) *</label>
                        <input
                          type="number"
                          min="0"
                          value={customPrice}
                          onChange={(e) => setCustomPrice(e.target.value)}
                          placeholder="Price"
                          className="w-full px-3 py-2 text-xs font-mono font-bold bg-slate-50 border border-slate-200 rounded-xl text-slate-900 text-right focus:outline-none focus:ring-1 focus:ring-orange-500"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Qty</label>
                        <input
                          type="number"
                          min="1"
                          value={customQty}
                          onChange={(e) => setCustomQty(Math.max(1, parseInt(e.target.value) || 1))}
                          className="w-full px-3 py-2 text-xs font-bold bg-slate-50 border border-slate-200 rounded-xl text-slate-900 text-center focus:outline-none focus:ring-1 focus:ring-orange-500"
                        />
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={!customName.trim()}
                      onClick={handleAddCustomItem}
                      className="w-full py-2.5 bg-orange-600 hover:bg-orange-700 text-white text-xs font-black rounded-xl transition-all shadow-md shadow-orange-600/20 disabled:opacity-40 cursor-pointer flex items-center justify-center gap-1.5"
                    >
                      <Plus size={14} className="stroke-[3]" />
                      <span>Add Custom Item</span>
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col overflow-hidden">
                {/* Visual Product Grid */}
                <div className="flex-1 overflow-y-auto p-3 space-y-2">
                  {filteredProducts.length === 0 ? (
                    <div className="p-8 text-center text-xs text-slate-400 space-y-1">
                      <p className="font-bold text-slate-600">No products match &quot;{searchQuery}&quot;</p>
                      <p>Switch category or try another word.</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {filteredProducts.map((p) => {
                        const isSelected = String(selectedProductId) === String(p.id);
                        const hasVariations = p.variations && p.variations.length > 0;
                        const isPizza = p.name.toLowerCase().includes('pizza');

                        return (
                          <div
                            key={p.id}
                            onClick={() => handleSelectProductCard(p)}
                            className={`p-2.5 rounded-2xl border text-left transition-all cursor-pointer flex flex-col justify-between gap-1.5 ${
                              isSelected
                                ? 'bg-orange-50/90 border-orange-500 shadow-md ring-2 ring-orange-500/20'
                                : 'bg-white border-slate-200 hover:border-orange-300 hover:shadow-xs'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-1.5">
                              <div className="min-w-0 flex-1">
                                <div className="font-black text-xs text-slate-900 leading-snug truncate">
                                  {isPizza && <span className="mr-1">🍕</span>}
                                  {p.name}
                                </div>
                                {(p.category?.name || p.category_name) && (
                                  <span className="text-[10px] font-bold text-slate-400 block truncate">
                                    {p.category?.name || p.category_name}
                                  </span>
                                )}
                              </div>
                              {isSelected && (
                                <span className="w-5 h-5 rounded-full bg-orange-600 text-white flex items-center justify-center shrink-0">
                                  <Check size={11} className="stroke-[3]" />
                                </span>
                              )}
                            </div>

                            <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-100">
                              <span className="font-mono font-black text-slate-900 text-[11px]">
                                {hasVariations ? (
                                  <span className="text-orange-600">From {currency}{Math.min(...p.variations.map((v: any) => Number(v.price) || 0)).toLocaleString()}</span>
                                ) : (
                                  <span>{currency}{Number(p.price).toLocaleString()}</span>
                                )}
                              </span>

                              {hasVariations && (
                                <span className="text-[9.5px] font-extrabold bg-amber-100 text-amber-800 px-1.5 py-0.2 rounded-md">
                                  {p.variations.length} Sizes
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* SIZES BAR (BOTTOM OF CATALOG) */}
                {currentSelectedProduct && (
                  <div className="p-3.5 bg-white border-t border-slate-200 shadow-lg space-y-2.5 shrink-0">
                    <div className="flex items-center justify-between gap-2">
                      <div className="truncate flex items-center gap-1.5">
                        <span className="text-base">🍕</span>
                        <div className="truncate">
                          <span className="text-xs font-black text-slate-900 truncate block">
                            {currentSelectedProduct.name}
                          </span>
                          <span className="text-[10px] text-slate-400">
                            Select size variation &amp; quantity
                          </span>
                        </div>
                      </div>

                      {/* Quantity Stepper */}
                      <div className="flex items-center border border-slate-200 rounded-xl bg-slate-50 overflow-hidden shadow-2xs shrink-0">
                        <button
                          type="button"
                          onClick={() => setAddQty(Math.max(1, addQty - 1))}
                          className="w-7 h-7 text-slate-600 hover:bg-slate-200 flex items-center justify-center font-bold text-xs"
                        >
                          −
                        </button>
                        <span className="px-2 text-xs font-black font-mono text-slate-900 min-w-6 text-center">
                          {addQty}
                        </span>
                        <button
                          type="button"
                          onClick={() => setAddQty(addQty + 1)}
                          className="w-7 h-7 text-slate-600 hover:bg-slate-200 flex items-center justify-center font-bold text-xs"
                        >
                          +
                        </button>
                      </div>
                    </div>

                    {/* Size Variation Buttons */}
                    {currentSelectedProduct.variations && currentSelectedProduct.variations.length > 0 ? (
                      <div className="space-y-1.5">
                        <span className="text-[10px] font-black text-slate-500 uppercase tracking-wider block">
                          Pizza / Item Size:
                        </span>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                          {currentSelectedProduct.variations.map((v: any, vIdx: number) => {
                            const isVarSelected = selectedVariation?.name === v.name;

                            return (
                              <button
                                key={vIdx}
                                type="button"
                                onClick={() => setSelectedVariation(v)}
                                className={`px-2.5 py-2 rounded-xl text-left transition-all cursor-pointer border flex flex-col justify-between ${
                                  isVarSelected
                                    ? 'bg-gradient-to-r from-orange-600 to-amber-600 text-white border-orange-600 shadow-sm shadow-orange-600/30 ring-2 ring-orange-500/30'
                                    : 'bg-slate-50 text-slate-800 border-slate-200 hover:bg-slate-100 hover:border-slate-300'
                                }`}
                              >
                                <div className="flex items-center justify-between">
                                  <span className="text-[11px] font-black truncate">{v.name}</span>
                                  {isVarSelected && <Check size={11} className="stroke-[3]" />}
                                </div>
                                <span
                                  className={`text-[10px] font-mono font-bold ${
                                    isVarSelected ? 'text-orange-100' : 'text-slate-500'
                                  }`}
                                >
                                  {currency}{Number(v.price).toLocaleString()}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ) : (
                      <div className="text-xs font-mono font-bold text-slate-700">
                        Price: {currency}{Number(currentSelectedProduct.price).toLocaleString()}
                      </div>
                    )}

                    {/* Add to Ticket Button */}
                    <button
                      type="button"
                      onClick={handleAddMenuItem}
                      className="w-full py-2.5 bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-600 hover:from-emerald-700 hover:to-teal-700 active:scale-98 text-white text-xs font-black rounded-xl transition-all shadow-md shadow-emerald-600/25 cursor-pointer flex items-center justify-center gap-2"
                    >
                      <Plus size={15} className="stroke-[3]" />
                      <span>
                        Add to Ticket (
                        {currency}
                        {(
                          (selectedVariation ? Number(selectedVariation.price) : Number(currentSelectedProduct.price) || 0) *
                          addQty
                        ).toLocaleString()}
                        )
                      </span>
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
