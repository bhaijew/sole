'use client';

import {
  ShoppingCart, UtensilsCrossed, Package, Truck,
  Plus, Minus, Trash2, User, X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCartStore, getProductPriceForSize, hasProductSizes } from '@/store/cart';
import type { Table } from '@/lib/types';

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

  return (
    <div
      className={
        isDrawer
          ? 'flex flex-col w-full'
          : 'w-full h-full bg-white rounded-xl border border-gray-100 flex flex-col shadow-sm'
      }
    >
      {/* Order Type & Customer */}
      <div className="p-3.5 border-b border-gray-100 space-y-2">
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
          {(['dine_in', 'takeaway', 'delivery'] as const).map((type) => {
            const Icon = orderTypeIcons[type];
            return (
              <button
                key={type}
                onClick={() => cart.setOrderType(type)}
                className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  cart.orderType === type
                    ? 'bg-white text-brand shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                <Icon size={14} />
                {type.replace('_', ' ')}
              </button>
            );
          })}
        </div>

        {/* Order Type specific number field (Table / Token / Rider / Phone) */}
        <div className="relative flex items-center">
          <input
            type="text"
            value={cart.orderNumberInput || ''}
            onChange={(e) => cart.setOrderNumberInput(e.target.value)}
            placeholder={
              cart.orderType === 'dine_in'
                ? 'Table # / Token # (Optional)'
                : cart.orderType === 'delivery'
                ? 'Rider / Contact # (Optional)'
                : 'Takeaway Token / Phone # (Optional)'
            }
            className="w-full px-3 py-1.5 text-xs bg-gray-50 hover:bg-gray-100/70 focus:bg-white border border-gray-200 rounded-lg text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-brand focus:border-brand transition-all"
          />
          {cart.orderNumberInput && (
            <button
              type="button"
              onClick={() => cart.setOrderNumberInput('')}
              className="absolute right-2 text-gray-400 hover:text-gray-600 p-0.5 rounded-full"
              title="Clear"
            >
              <X size={12} />
            </button>
          )}
        </div>

        {/* Customer Name Input */}
        <div className="relative flex items-center">
          <div className="absolute left-2.5 text-gray-400 pointer-events-none">
            <User size={13} />
          </div>
          <input
            type="text"
            value={cart.customerName}
            onChange={(e) => cart.setCustomerName(e.target.value)}
            placeholder="Customer Name (Optional)"
            className="w-full pl-7 pr-7 py-1.5 text-xs bg-gray-50 hover:bg-gray-100/70 focus:bg-white border border-gray-200 rounded-lg text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-brand focus:border-brand transition-all"
          />
          {cart.customerName && (
            <button
              type="button"
              onClick={() => cart.setCustomerName('')}
              className="absolute right-2 text-gray-400 hover:text-gray-600 p-0.5 rounded-full"
              title="Clear Name"
            >
              <X size={12} />
            </button>
          )}
        </div>

        {/* Delivery Field (Directly under Customer Name) */}
        <div className="space-y-1.5">
          <div className="relative flex items-center">
            <div className="absolute left-2.5 text-gray-400 pointer-events-none">
              <Truck size={13} className={cart.orderType === 'delivery' || cart.deliveryAddress ? 'text-emerald-600' : 'text-gray-400'} />
            </div>
            <input
              type="text"
              value={cart.deliveryAddress}
              onChange={(e) => {
                const val = e.target.value;
                cart.setDeliveryAddress(val);
                if (val.trim() && cart.orderType !== 'delivery') {
                  cart.setOrderType('delivery');
                }
              }}
              placeholder="Delivery Address / Details (Optional)"
              className={`w-full pl-7 pr-7 py-1.5 text-xs border rounded-lg text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-1 transition-all ${
                cart.orderType === 'delivery' || cart.deliveryAddress
                  ? 'bg-emerald-50/50 border-emerald-300 focus:border-emerald-500 focus:ring-emerald-500'
                  : 'bg-gray-50 hover:bg-gray-100/70 focus:bg-white border-gray-200 focus:ring-brand focus:border-brand'
              }`}
            />
            {cart.deliveryAddress && (
              <button
                type="button"
                onClick={() => cart.setDeliveryAddress('')}
                className="absolute right-2 text-gray-400 hover:text-gray-600 p-0.5 rounded-full"
                title="Clear Address"
              >
                <X size={12} />
              </button>
            )}
          </div>

          {/* Delivery Charges & Quick Chips (shown when Delivery is selected or address entered) */}
          {(cart.orderType === 'delivery' || cart.deliveryAddress.trim().length > 0) && (
            <div className="bg-emerald-50/90 border border-emerald-200 rounded-lg p-2 space-y-1.5">
              <div className="flex items-center justify-between text-[10px] font-bold text-emerald-900">
                <span className="flex items-center gap-1 uppercase tracking-wider text-emerald-800">
                  Delivery Charges (Rs.)
                </span>
                <span className="font-extrabold text-emerald-700">
                  {cart.deliveryFee > 0 ? `${currency}${cart.deliveryFee.toLocaleString()}` : 'Free (Rs. 0)'}
                </span>
              </div>

              <div className="flex items-center gap-1.5">
                <span className="text-xs font-bold text-emerald-800">Rs.</span>
                <input
                  type="number"
                  min="0"
                  step="10"
                  value={cart.deliveryFee === 0 ? '' : cart.deliveryFee}
                  placeholder="0 (Free Delivery)"
                  onChange={(e) => cart.setDeliveryFee(Math.max(0, Number(e.target.value) || 0))}
                  className="w-full h-6 px-2 text-xs font-bold bg-white border border-emerald-300 rounded text-gray-900 focus:outline-none focus:border-emerald-500"
                />
              </div>

              {/* Quick Preset Buttons */}
              <div className="flex items-center gap-1 flex-wrap pt-0.5">
                <span className="text-[10px] font-semibold text-emerald-700 mr-0.5">Quick:</span>
                {[0, 50, 100, 150, 200].map((fee) => (
                  <button
                    key={fee}
                    type="button"
                    onClick={() => cart.setDeliveryFee(fee)}
                    className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all cursor-pointer ${
                      cart.deliveryFee === fee
                        ? 'bg-emerald-600 text-white shadow-xs'
                        : 'bg-white text-emerald-800 border border-emerald-200 hover:bg-emerald-100'
                    }`}
                  >
                    {fee === 0 ? 'Free' : `${fee}`}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Cart Items */}
      <div className={isDrawer ? 'overflow-y-auto p-4 max-h-[40vh]' : 'flex-1 overflow-y-auto p-4'}>
        {cart.items.length === 0 ? (
          <div className={`flex flex-col items-center justify-center text-gray-400 ${isDrawer ? 'py-8' : 'h-full'}`}>
            <ShoppingCart size={40} />
            <p className="mt-2 text-sm">Cart is empty</p>
          </div>
        ) : (
          <div className="space-y-3">
            {cart.items.map((item) => (
              <div key={item.id} className="flex items-start gap-3 border-b border-gray-50 pb-2.5 last:border-0 last:pb-0">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-gray-900 truncate">
                    {item.product.name}
                  </p>

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
        <div className="flex justify-between mb-3 text-base pt-2 border-t border-gray-100">
          <span className="font-semibold text-gray-900">Total</span>
          <span className="font-bold text-brand">
            {currency}{(cart.subtotal() + (cart.orderType === 'delivery' ? cart.deliveryFee : 0)).toLocaleString()}
          </span>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={onPlaceOrder}
            disabled={submitting || cart.items.length === 0}
            className="flex-1"
            size="lg"
          >
            {submitting ? 'Placing...' : 'Place Order'}
          </Button>
        </div>
      </div>
    </div>
  );
}
