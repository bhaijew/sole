import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CartItem } from '@/lib/types';

interface HeldOrder {
  tableId: number | string;
  items: CartItem[];
  customerId: number | null;
  guestCount: number;
  heldAt: string;
}

interface HeldOrdersState {
  orders: Record<string, HeldOrder>;
  holdOrder: (tableId: number | string, items: CartItem[], customerId: number | null, guestCount: number) => void;
  restoreOrder: (tableId: number | string) => HeldOrder | null;
  removeHeldOrder: (tableId: number | string) => void;
  hasHeldOrder: (tableId: number | string) => boolean;
  getHeldOrder: (tableId: number | string) => HeldOrder | undefined;
}

export const useHeldOrdersStore = create<HeldOrdersState>()(
  persist(
    (set, get) => ({
      orders: {},

      holdOrder: (tableId, items, customerId, guestCount) => {
        set((state) => ({
          orders: {
            ...state.orders,
            [tableId]: { tableId, items, customerId, guestCount, heldAt: new Date().toISOString() },
          },
        }));
      },

      restoreOrder: (tableId) => {
        const order = get().orders[tableId];
        if (!order) return null;
        set((state) => {
          const { [tableId]: _, ...rest } = state.orders;
          return { orders: rest };
        });
        return order;
      },

      removeHeldOrder: (tableId) => {
        set((state) => {
          const { [tableId]: _, ...rest } = state.orders;
          return { orders: rest };
        });
      },

      hasHeldOrder: (tableId) => !!get().orders[tableId],

      getHeldOrder: (tableId) => get().orders[tableId],
    }),
    { name: 'held-orders' }
  )
);
