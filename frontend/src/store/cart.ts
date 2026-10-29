import { create } from 'zustand';
import type { Customer, Product, Addon, CartItem } from '@/lib/types';

interface CartState {
  items: CartItem[];
  orderType: 'dine_in' | 'takeaway' | 'delivery' | 'online';
  paymentMethod: 'cash' | 'online';
  tableId: number | null;
  customerId: number | null;
  customer: Customer | null;
  customerName: string;
  customerPhone: string;
  orderNumberInput: string;
  deliveryFee: number;
  deliveryAddress: string;
  guestCount: number;

  addItem: (product: Product, quantity?: number, addons?: Addon[], specialInstructions?: string, size?: string) => void;
  updateItemSize: (cartItemId: string, size: string) => void;
  removeItem: (cartItemId: string) => void;
  updateQuantity: (cartItemId: string, quantity: number) => void;
  clearCart: () => void;
  loadItems: (items: CartItem[], tableId: number | null, customerId: number | null, guestCount: number) => void;
  setOrderType: (type: CartState['orderType']) => void;
  setPaymentMethod: (method: 'cash' | 'online') => void;
  setTableId: (id: number | null) => void;
  setCustomerId: (id: number | null) => void;
  setCustomer: (customer: Customer | null) => void;
  setCustomerName: (name: string) => void;
  setCustomerPhone: (phone: string) => void;
  setOrderNumberInput: (num: string) => void;
  setDeliveryFee: (fee: number) => void;
  setDeliveryAddress: (address: string) => void;
  setGuestCount: (count: number) => void;

  subtotal: () => number;
  itemCount: () => number;
}

function generateCartItemId(productId: number, addons: Addon[], specialInstructions: string, size?: string): string {
  const parts = [String(productId)];
  if (size) {
    parts.push(`size:${size}`);
  }
  if (addons.length > 0) {
    parts.push(addons.map((a) => a.id).sort((a, b) => a - b).join(','));
  }
  if (specialInstructions) {
    parts.push(specialInstructions);
  }
  return parts.join('-');
}

export function hasProductSizes(product: Product): boolean {
  return Boolean(
    product.variations &&
    Array.isArray(product.variations) &&
    product.variations.length > 0
  );
}

export function getProductPriceForSize(product: Product, size?: string): number {
  const basePrice = Number(product.price) || 0;
  if (!size) return basePrice;

  // 1. Check if product has variations from database
  if (product.variations && Array.isArray(product.variations) && product.variations.length > 0) {
    const sLower = size.toLowerCase().trim();
    // Normalize size matching
    const match = product.variations.find((v: any) => {
      const vName = String(v.name || '').toLowerCase().trim();
      if (vName === sLower) return true;
      if (sLower.includes('small') && vName.includes('small')) return true;
      if (sLower.includes('medium') && (vName.includes('medium') || vName.includes('big'))) return true;
      if (sLower === 'large' && vName === 'large') return true;
      if ((sLower.includes('extra') || sLower === 'xl') && (vName.includes('extra') || vName.includes('xl'))) return true;
      return false;
    });

    if (match && Number(match.price) > 0) {
      return Number(match.price);
    }
  }

  return basePrice;
}

export const useCartStore = create<CartState>((set, get) => ({
  items: [],
  orderType: 'dine_in',
  paymentMethod: 'cash',
  tableId: null,
  customerId: null,
  customer: null,
  customerName: '',
  customerPhone: '',
  orderNumberInput: '',
  deliveryFee: 0,
  deliveryAddress: '',
  guestCount: 1,

  addItem: (product, quantity = 1, addons = [], specialInstructions = '', size = '') => {
    const items = get().items;
    const isSized = hasProductSizes(product);
    const effectiveSize = isSized ? (size || 'Medium') : undefined;
    const itemId = generateCartItemId(product.id, addons, specialInstructions, effectiveSize);
    const existing = items.find((i) => i.id === itemId);
    const unitPrice = isSized ? getProductPriceForSize(product, effectiveSize) : (Number(product.price) || 0);

    if (existing) {
      set({
        items: items.map((i) =>
          i.id === itemId ? { ...i, quantity: i.quantity + quantity, unit_price: unitPrice } : i
        ),
      });
    } else {
      set({
        items: [
          ...items,
          {
            id: itemId,
            product,
            quantity,
            addons,
            special_instructions: specialInstructions,
            size: effectiveSize,
            variant_selection: effectiveSize,
            unit_price: unitPrice,
          },
        ],
      });
    }
  },

  updateItemSize: (cartItemId, newSize) => {
    const items = get().items;
    const targetItem = items.find((i) => i.id === cartItemId);
    if (!targetItem) return;

    const newId = generateCartItemId(targetItem.product.id, targetItem.addons, targetItem.special_instructions, newSize);
    const newUnitPrice = getProductPriceForSize(targetItem.product, newSize);

    set({
      items: items.map((i) =>
        i.id === cartItemId
          ? {
              ...i,
              id: newId,
              size: newSize || undefined,
              variant_selection: newSize || undefined,
              unit_price: newUnitPrice,
            }
          : i
      ),
    });
  },

  removeItem: (cartItemId) => {
    set({ items: get().items.filter((i) => i.id !== cartItemId) });
  },

  updateQuantity: (cartItemId, quantity) => {
    if (quantity <= 0) {
      get().removeItem(cartItemId);
      return;
    }
    set({
      items: get().items.map((i) =>
        i.id === cartItemId ? { ...i, quantity } : i
      ),
    });
  },

  clearCart: () => {
    set({
      items: [],
      paymentMethod: 'cash',
      tableId: null,
      customerId: null,
      customer: null,
      customerName: '',
      customerPhone: '',
      orderNumberInput: '',
      guestCount: 1,
      deliveryFee: 0,
      deliveryAddress: '',
    });
  },

  loadItems: (items, tableId, customerId, guestCount) => {
    set({ items, tableId, customerId, guestCount });
  },

  setOrderType: (type) => set({ orderType: type }),
  setPaymentMethod: (method) => set({ paymentMethod: method }),
  setTableId: (id) => set({ tableId: id }),
  setCustomerId: (id) => set({ customerId: id }),
  setCustomer: (customer) => set({
    customer,
    customerId: customer?.id ?? null,
    customerName: customer?.name || get().customerName,
    customerPhone: customer?.phone || get().customerPhone,
    deliveryAddress: customer?.address || get().deliveryAddress,
  }),
  setCustomerName: (name) => set({ customerName: name }),
  setCustomerPhone: (phone) => set({ customerPhone: phone }),
  setOrderNumberInput: (num) => set({ orderNumberInput: num }),
  setDeliveryFee: (fee) => set({ deliveryFee: Math.max(0, Number(fee) || 0) }),
  setDeliveryAddress: (address) => set({ deliveryAddress: address }),
  setGuestCount: (count) => set({ guestCount: count }),

  subtotal: () => {
    return get().items.reduce((sum, item) => {
      const itemBase = item.unit_price ?? getProductPriceForSize(item.product, item.size);
      const addonTotal = item.addons.reduce((a, addon) => a + Number(addon.price), 0);
      return sum + (itemBase + addonTotal) * item.quantity;
    }, 0);
  },

  itemCount: () => {
    return get().items.reduce((sum, item) => sum + item.quantity, 0);
  },
}));
