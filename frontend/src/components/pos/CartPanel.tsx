'use client';

import { useState, useRef } from 'react';
import {
  ShoppingCart, UtensilsCrossed, Package, Truck,
  Plus, Minus, Trash2, User, X, Phone, Hash, Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCartStore, getProductPriceForSize, hasProductSizes } from '@/store/cart';
import type { Table, Customer } from '@/lib/types';
import api from '@/lib/api';

interface Props {
  tables?: Table[];
  currency: string;
  submitting: boolean;
  onPlaceOrder: () => void;
  onShowTablePicker?: () => void;
  variant?: 'sidebar' | 'drawer';
}

const orderTypeIcons = {
  dine_in: UtensilsCrossed,
  takeaway: Package,
  delivery: Truck,
};

export default function CartPanel({
  currency,
  submitting,
  onPlaceOrder,
  variant = 'sidebar',
}: Props) {
  const cart = useCartStore();
  const isDrawer = variant === 'drawer';

  const [customerSuggestions, setCustomerSuggestions] = useState<Customer[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handlePhoneChange = (val: string) => {
    cart.setCustomerPhone(val);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);

    const clean = val.trim();
    if (clean.length >= 3) {
      searchTimeoutRef.current = setTimeout(async () => {
        try {
          const res = await api.get(`/customers-search?q=${encodeURIComponent(clean)}`);
          const found = (res.data?.customers || []) as Customer[];
          setCustomerSuggestions(found.slice(0, 3));
          setShowSuggestions(found.length > 0);
        } catch {
          setCustomerSuggestions([]);
          setShowSuggestions(false);
        }
      }, 300);
    } else {
      setCustomerSuggestions([]);
      setShowSuggestions(false);
    }
  };

  const handleSelectCustomer = (c: Customer) => {
    cart.setCustomer(c);
    cart.setCustomerName(c.name || '');
    cart.setCustomerPhone(c.phone || '');
    if (c.address) {
      cart.setDeliveryAddress(c.address);
    }
    setShowSuggestions(false);
  };

  return (
    <div
      className={
        isDrawer
          ? 'flex flex-col w-full'
          : 'w-full h-full bg-white rounded-xl border border-gray-100 flex flex-col shadow-sm'
      }
    >
      {/* Order Type & Contextual Customer / Delivery Information */}
      <div className="p-2.5 border-b border-gray-100 space-y-2 bg-gray-50/40">
        {/* Top Order Type Selector */}
        <div className="flex gap-1 bg-gray-200/80 rounded-lg p-0.5">
          {(['dine_in', 'takeaway', 'delivery'] as const).map((type) => {
            const Icon = orderTypeIcons[type];
            const isActive = cart.orderType === type;
            return (
              <button
                key={type}
                type="button"
                onClick={() => cart.setOrderType(type)}
                className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-bold transition-all cursor-pointer ${
                  isActive
                    ? 'bg-white text-gray-900 shadow-xs'
                    : 'text-gray-500 hover:text-gray-800'
                }`}
              >
                <Icon size={13} className={isActive ? 'text-brand' : ''} />
                <span className="capitalize">{type.replace('_', ' ')}</span>
              </button>
            );
          })}
        </div>

        {/* ── Contextual Input Fields based on Order Type ── */}
        {cart.orderType === 'dine_in' && (
          <div className="grid grid-cols-2 gap-1.5 animate-in fade-in duration-150">
            {/* Table / Token # */}
            <div className="relative flex items-center">
              <div className="absolute left-2.5 text-gray-400 pointer-events-none">
                <Hash size={13} />
              </div>
              <input
                type="text"
                value={cart.orderNumberInput || ''}
                onChange={(e) => cart.setOrderNumberInput(e.target.value)}
                placeholder="Table / Token #"
                className="w-full pl-7 pr-6 py-1.5 text-xs bg-white border border-gray-200 rounded-lg text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-brand font-semibold shadow-2xs"
              />
              {cart.orderNumberInput && (
                <button
                  type="button"
                  onClick={() => cart.setOrderNumberInput('')}
                  className="absolute right-1.5 text-gray-400 hover:text-gray-600 p-0.5 rounded-full"
                  title="Clear"
                >
                  <X size={11} />
                </button>
              )}
            </div>

            {/* Optional Customer Name */}
            <div className="relative flex items-center">
              <div className="absolute left-2.5 text-gray-400 pointer-events-none">
                <User size={13} />
              </div>
              <input
                type="text"
                value={cart.customerName || ''}
                onChange={(e) => cart.setCustomerName(e.target.value)}
                placeholder="Customer Name"
                className="w-full pl-7 pr-6 py-1.5 text-xs bg-white border border-gray-200 rounded-lg text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-brand shadow-2xs"
              />
              {cart.customerName && (
                <button
                  type="button"
                  onClick={() => cart.setCustomerName('')}
                  className="absolute right-1.5 text-gray-400 hover:text-gray-600 p-0.5 rounded-full"
                  title="Clear"
                >
                  <X size={11} />
                </button>
              )}
            </div>
          </div>
        )}

        {cart.orderType === 'takeaway' && (
          <div className="grid grid-cols-2 gap-1.5 animate-in fade-in duration-150">
            {/* Phone Number */}
            <div className="relative">
              <div className="relative flex items-center">
                <div className="absolute left-2.5 text-gray-400 pointer-events-none">
                  <Phone size={13} className={cart.customerPhone ? 'text-brand' : ''} />
                </div>
                <input
                  type="tel"
                  value={cart.customerPhone || ''}
                  onChange={(e) => handlePhoneChange(e.target.value)}
                  placeholder="Phone # (Optional)"
                  className="w-full pl-7 pr-6 py-1.5 text-xs bg-white border border-gray-200 rounded-lg text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-brand font-medium shadow-2xs"
                />
                {cart.customerPhone && (
                  <button
                    type="button"
                    onClick={() => {
                      cart.setCustomerPhone('');
                      setShowSuggestions(false);
                    }}
                    className="absolute right-1.5 text-gray-400 hover:text-gray-600 p-0.5 rounded-full"
                    title="Clear"
                  >
                    <X size={11} />
                  </button>
                )}
              </div>

              {/* Suggestions dropdown */}
              {showSuggestions && customerSuggestions.length > 0 && (
                <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-brand/20 rounded-lg shadow-lg z-30 p-1 space-y-1">
                  <div className="px-2 py-0.5 text-[10px] font-semibold text-brand flex items-center gap-1">
                    <Sparkles size={10} /> Existing customer:
                  </div>
                  {customerSuggestions.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => handleSelectCustomer(c)}
                      className="w-full text-left px-2 py-1 rounded hover:bg-brand-light flex items-center justify-between text-xs"
                    >
                      <span className="font-semibold text-gray-800 truncate">{c.name || 'Unnamed'}</span>
                      <span className="text-gray-500 font-mono text-[11px] ml-2 shrink-0">{c.phone}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Customer Name */}
            <div className="relative flex items-center">
              <div className="absolute left-2.5 text-gray-400 pointer-events-none">
                <User size={13} className={cart.customerName ? 'text-brand' : ''} />
              </div>
              <input
                type="text"
                value={cart.customerName || ''}
                onChange={(e) => cart.setCustomerName(e.target.value)}
                placeholder="Customer Name"
                className="w-full pl-7 pr-6 py-1.5 text-xs bg-white border border-gray-200 rounded-lg text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-brand shadow-2xs"
              />
              {cart.customerName && (
                <button
                  type="button"
                  onClick={() => cart.setCustomerName('')}
                  className="absolute right-1.5 text-gray-400 hover:text-gray-600 p-0.5 rounded-full"
                  title="Clear"
                >
                  <X size={11} />
                </button>
              )}
            </div>
          </div>
        )}

        {cart.orderType === 'delivery' && (
          <div className="space-y-1.5 animate-in fade-in duration-150">
            {/* Row 1: Phone & Name in 2 columns */}
            <div className="grid grid-cols-2 gap-1.5">
              <div className="relative">
                <div className="relative flex items-center">
                  <div className="absolute left-2.5 pointer-events-none">
                    <Phone size={13} className={cart.customerPhone ? 'text-emerald-600' : 'text-gray-400'} />
                  </div>
                  <input
                    type="tel"
                    value={cart.customerPhone || ''}
                    onChange={(e) => handlePhoneChange(e.target.value)}
                    placeholder="Mobile / Phone #"
                    className="w-full pl-7 pr-6 py-1.5 text-xs bg-white border border-emerald-300 focus:border-emerald-500 rounded-lg text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-emerald-500 font-medium shadow-2xs"
                  />
                  {cart.customerPhone && (
                    <button
                      type="button"
                      onClick={() => {
                        cart.setCustomerPhone('');
                        setShowSuggestions(false);
                      }}
                      className="absolute right-1.5 text-gray-400 hover:text-gray-600 p-0.5 rounded-full"
                      title="Clear"
                    >
                      <X size={11} />
                    </button>
                  )}
                </div>

                {/* Suggestions dropdown */}
                {showSuggestions && customerSuggestions.length > 0 && (
                  <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-emerald-300 rounded-lg shadow-lg z-30 p-1 space-y-1">
                    <div className="px-2 py-0.5 text-[10px] font-semibold text-emerald-800 flex items-center gap-1">
                      <Sparkles size={10} /> Existing customer found:
                    </div>
                    {customerSuggestions.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => handleSelectCustomer(c)}
                        className="w-full text-left px-2 py-1 rounded hover:bg-emerald-50 flex items-center justify-between text-xs"
                      >
                        <span className="font-semibold text-gray-800 truncate">{c.name || 'Unnamed'}</span>
                        <span className="text-gray-500 font-mono text-[11px] ml-2 shrink-0">{c.phone}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Customer Name */}
              <div className="relative flex items-center">
                <div className="absolute left-2.5 text-gray-400 pointer-events-none">
                  <User size={13} className={cart.customerName ? 'text-emerald-600' : ''} />
                </div>
                <input
                  type="text"
                  value={cart.customerName || ''}
                  onChange={(e) => cart.setCustomerName(e.target.value)}
                  placeholder="Customer Name"
                  className="w-full pl-7 pr-6 py-1.5 text-xs bg-white border border-gray-200 rounded-lg text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-emerald-500 shadow-2xs"
                />
                {cart.customerName && (
                  <button
                    type="button"
                    onClick={() => cart.setCustomerName('')}
                    className="absolute right-1.5 text-gray-400 hover:text-gray-600 p-0.5 rounded-full"
                    title="Clear"
                  >
                    <X size={11} />
                  </button>
                )}
              </div>
            </div>

            {/* Row 2: Delivery Address (Compact 1-line) */}
            <div className="relative flex items-center">
              <div className="absolute left-2.5 text-emerald-600 pointer-events-none">
                <Truck size={13} />
              </div>
              <input
                type="text"
                value={cart.deliveryAddress || ''}
                onChange={(e) => cart.setDeliveryAddress(e.target.value)}
                placeholder="House, Street, Area / Delivery Address"
                className="w-full pl-7 pr-6 py-1.5 text-xs bg-emerald-50/30 border border-emerald-300 rounded-lg text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-emerald-500 shadow-2xs font-medium"
              />
              {cart.deliveryAddress && (
                <button
                  type="button"
                  onClick={() => cart.setDeliveryAddress('')}
                  className="absolute right-1.5 text-gray-400 hover:text-gray-600 p-0.5 rounded-full"
                  title="Clear"
                >
                  <X size={11} />
                </button>
              )}
            </div>

            {/* Row 3: Compact 1-line Delivery Charges & Quick Chips */}
            <div className="flex items-center justify-between bg-emerald-50/70 border border-emerald-200/90 rounded-lg px-2 py-1 text-xs">
              <div className="flex items-center gap-1 text-emerald-900 font-bold shrink-0">
                <span className="text-[11px] text-emerald-800">Fee:</span>
                <div className="flex items-center bg-white border border-emerald-300 rounded px-1.5 py-0.5">
                  <span className="text-[10px] text-gray-400 mr-0.5">{currency}</span>
                  <input
                    type="number"
                    min="0"
                    step="10"
                    value={cart.deliveryFee === 0 ? '' : cart.deliveryFee}
                    placeholder="0"
                    onChange={(e) => cart.setDeliveryFee(Math.max(0, Number(e.target.value) || 0))}
                    className="w-12 text-xs font-mono font-bold text-gray-900 focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex items-center gap-1">
                {[0, 50, 100, 150].map((fee) => (
                  <button
                    key={fee}
                    type="button"
                    onClick={() => cart.setDeliveryFee(fee)}
                    className={`px-1.5 py-0.5 rounded text-[10px] font-bold transition-all cursor-pointer ${
                      cart.deliveryFee === fee
                        ? 'bg-emerald-600 text-white shadow-2xs'
                        : 'bg-white text-emerald-800 border border-emerald-200 hover:bg-emerald-100'
                    }`}
                  >
                    {fee === 0 ? 'Free' : `${fee}`}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Cart Items */}
      <div className={isDrawer ? 'overflow-y-auto p-3 max-h-[60vh]' : 'flex-1 overflow-y-auto p-3 min-h-[160px]'}>
        {cart.items.length === 0 ? (
          <div className={`flex flex-col items-center justify-center text-gray-400 ${isDrawer ? 'py-8' : 'h-full'}`}>
            <ShoppingCart size={40} />
            <p className="mt-2 text-sm">Cart is empty</p>
          </div>
        ) : (
          <div className="space-y-3">
            {cart.items.map((item) => (
              <div key={item.id} className="flex items-start gap-3 border-b border-gray-100 pb-2.5 last:border-0 last:pb-0">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-gray-900 truncate">
                    {item.product.name}
                  </p>

                  {/* Deal items summary */}
                  {((item.product as any)?.items_included || (item.product as any)?.description) && (
                    <p className="text-[10px] text-orange-700/90 font-medium line-clamp-1 mt-0.5">
                      {Array.isArray((item.product as any)?.items_included)
                        ? (item.product as any).items_included.join(' • ')
                        : String((item.product as any)?.items_included || (item.product as any)?.description)}
                    </p>
                  )}

                  {/* Size Selector: Small, Medium, Large, Extra Large (Only for Pizza / products with variations) */}
                  {hasProductSizes(item.product) && (
                    <div className="flex items-center gap-1 my-1 flex-wrap">
                      {(['Small', 'Medium', 'Large', 'Extra Large'] as const).map((sz) => {
                        const isCurrentSize = item.size?.toLowerCase() === sz.toLowerCase();
                        const szPrice = getProductPriceForSize(item.product, sz);
                        return (
                          <button
                            key={sz}
                            type="button"
                            onClick={() => cart.updateItemSize(item.id, sz)}
                            className={`px-1.5 py-0.5 rounded text-[10px] font-bold transition-all ${
                              isCurrentSize
                                ? 'bg-orange-600 text-white shadow-xs'
                                : 'bg-gray-100 hover:bg-gray-200 text-gray-600 border border-gray-200'
                            }`}
                            title={`${sz}: ${currency}${szPrice}`}
                          >
                            {sz === 'Extra Large' ? 'XL' : sz} {szPrice > 0 && `(${currency}${szPrice})`}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {item.addons.length > 0 && (
                    <div className="mt-0.5">
                      {item.addons.map((a) => (
                        <p key={a.id} className="text-xs text-gray-400">
                          + {a.name} {Number(a.price) > 0 && `(${currency}${Number(a.price).toLocaleString()})`}
                        </p>
                      ))}
                    </div>
                  )}
                  {item.special_instructions && (
                    <p className="text-xs text-gray-400 italic mt-0.5">{item.special_instructions}</p>
                  )}
                  <p className="text-sm font-bold text-gray-800 mt-0.5">
                    {currency}{Number(item.unit_price ?? getProductPriceForSize(item.product, item.size)).toLocaleString()}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => cart.updateQuantity(item.id, item.quantity - 1)}
                    className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center hover:bg-gray-200 transition-colors"
                  >
                    <Minus size={14} />
                  </button>
                  <span className="text-sm font-medium w-5 text-center">{item.quantity}</span>
                  <button
                    onClick={() => cart.updateQuantity(item.id, item.quantity + 1)}
                    className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center hover:bg-gray-200 transition-colors"
                  >
                    <Plus size={14} />
                  </button>
                  <button
                    onClick={() => cart.removeItem(item.id)}
                    className="w-7 h-7 rounded-full text-red-400 hover:bg-red-50 flex items-center justify-center transition-colors"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Cart Footer */}
      <div className="p-4 border-t border-gray-100">
        <div className="flex justify-between mb-1 text-xs text-gray-500">
          <span>Items</span>
          <span className="font-medium">{cart.itemCount()}</span>
        </div>
        <div className="flex justify-between mb-1 text-xs text-gray-500">
          <span>Subtotal</span>
          <span className="font-medium">{currency}{cart.subtotal().toLocaleString()}</span>
        </div>
        {cart.orderType === 'delivery' && (
          <div className="flex justify-between mb-1 text-xs font-semibold text-emerald-600">
            <span>🛵 Delivery Fee</span>
            <span>{cart.deliveryFee > 0 ? `+${currency}${cart.deliveryFee.toLocaleString()}` : 'FREE'}</span>
          </div>
        )}
        <div className="flex justify-between mb-2 text-base pt-2 border-t border-gray-100">
          <span className="font-semibold text-gray-900">Total</span>
          <span className="font-bold text-brand text-lg">
            {currency}{(cart.subtotal() + (cart.orderType === 'delivery' ? cart.deliveryFee : 0)).toLocaleString()}
          </span>
        </div>

        {/* Quick Payment Method Selector: Cash, Online, or Paid directly above Place Order */}
        <div className="pt-1 pb-2">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] font-black text-gray-500 uppercase tracking-wider">
              Payment (Printed on Slip):
            </span>
            <span
              className={`text-[10px] font-black px-2 py-0.5 rounded-full uppercase ${
                cart.paymentMethod === 'online'
                  ? 'bg-blue-100 text-blue-700'
                  : cart.paymentMethod === 'paid'
                  ? 'bg-emerald-100 text-emerald-800'
                  : 'bg-amber-100 text-amber-800'
              }`}
            >
              {cart.paymentMethod === 'online'
                ? '📱 ONLINE'
                : cart.paymentMethod === 'paid'
                ? '✅ PAID'
                : '💵 CASH'}
            </span>
          </div>

          <div className="grid grid-cols-3 gap-1 bg-gray-100 p-1 rounded-lg">
            <button
              type="button"
              onClick={() => cart.setPaymentMethod('cash')}
              className={`flex items-center justify-center gap-1 py-1.5 px-1.5 rounded-md text-xs font-black transition-all cursor-pointer ${
                cart.paymentMethod === 'cash'
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'bg-white text-gray-700 hover:text-gray-900 border border-gray-200'
              }`}
            >
              <span>💵</span>
              <span>CASH</span>
            </button>
            <button
              type="button"
              onClick={() => cart.setPaymentMethod('online')}
              className={`flex items-center justify-center gap-1 py-1.5 px-1.5 rounded-md text-xs font-black transition-all cursor-pointer ${
                cart.paymentMethod === 'online'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'bg-white text-gray-700 hover:text-gray-900 border border-gray-200'
              }`}
            >
              <span>📱</span>
              <span>ONLINE</span>
            </button>
            <button
              type="button"
              onClick={() => cart.setPaymentMethod('paid')}
              className={`flex items-center justify-center gap-1 py-1.5 px-1.5 rounded-md text-xs font-black transition-all cursor-pointer ${
                cart.paymentMethod === 'paid'
                  ? 'bg-purple-600 text-white shadow-xs'
                  : 'bg-white text-gray-700 hover:text-gray-900 border border-gray-200'
              }`}
            >
              <span>✅</span>
              <span>PAID</span>
            </button>
          </div>
        </div>

        <div className="flex gap-2">
          <Button
            onClick={onPlaceOrder}
            disabled={submitting || cart.items.length === 0}
            className={`flex-1 font-extrabold h-11 text-sm shadow-sm transition-all cursor-pointer ${
              cart.paymentMethod === 'online'
                ? 'bg-blue-600 hover:bg-blue-700 text-white'
                : cart.paymentMethod === 'paid'
                ? 'bg-purple-600 hover:bg-purple-700 text-white'
                : 'bg-orange-600 hover:bg-orange-700 text-white'
            }`}
            size="lg"
          >
            {submitting
              ? 'Placing Order...'
              : `Place Order (${
                  cart.paymentMethod === 'online'
                    ? 'Online'
                    : cart.paymentMethod === 'paid'
                    ? 'PAID'
                    : 'Cash'
                })`}
          </Button>
        </div>
      </div>
    </div>
  );
}
