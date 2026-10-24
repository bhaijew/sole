import { create } from 'zustand';
import type { Customer, Product, Addon, CartItem } from '@/lib/types';

interface CartState {
  items: CartItem[];
  orderType: 'dine_in' | 'takeaway' | 'delivery' | 'online';
  tableId: number | null;
  customerId: number | null;
  customer: Customer | null;
  customerName: string;
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
  setTableId: (id: number | null) => void;
  setCustomerId: (id: number | null) => void;
  setCustomer: (customer: Customer | null) => void;
  setCustomerName: (name: string) => void;
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

export const useCartStore = create<CartState>((set, get) => ({
  items: [],
  orderType: 'dine_in',
  tableId: null,
  customerId: null,
  customer: null,
  customerName: '',
  orderNumberInput: '',
  deliveryFee: 0,
  deliveryAddress: '',
  guestCount: 1,

  addItem: (product, quantity = 1, addons = [], specialInstructions = '', size = '') => {
    const items = get().items;
    const itemId = generateCartItemId(product.id, addons, specialInstructions, size);
    const existing = items.find((i) => i.id === itemId);

    if (existing) {
      set({
        items: items.map((i) =>
          i.id === itemId ? { ...i, quantity: i.quantity + quantity } : i
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
            size: size || undefined,
            variant_selection: size || undefined,
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
    set({
      items: items.map((i) =>
        i.id === cartItemId
          ? {
              ...i,
              id: newId,
              size: newSize || undefined,
              variant_selection: newSize || undefined,
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
      tableId: null,
      customerId: null,
      customer: null,
      customerName: '',
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
  setTableId: (id) => set({ tableId: id }),
  setCustomerId: (id) => set({ customerId: id }),
  setCustomer: (customer) => set({ customer, customerId: customer?.id ?? null, customerName: customer?.name || get().customerName }),
  setCustomerName: (name) => set({ customerName: name }),
  setOrderNumberInput: (num) => set({ orderNumberInput: num }),
  setDeliveryFee: (fee) => set({ deliveryFee: Math.max(0, Number(fee) || 0) }),
  setDeliveryAddress: (address) => set({ deliveryAddress: address }),
  setGuestCount: (count) => set({ guestCount: count }),

  subtotal: () => {
    return get().items.reduce((sum, item) => {
      const addonTotal = item.addons.reduce((a, addon) => a + Number(addon.price), 0);
      return sum + (Number(item.product.price) + addonTotal) * item.quantity;
    }, 0);
  },

  itemCount: () => {
    return get().items.reduce((sum, item) => sum + item.quantity, 0);
  },
}));
