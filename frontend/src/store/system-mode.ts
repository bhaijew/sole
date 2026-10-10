import { create } from 'zustand';
import api from '@/lib/api';

interface SystemModeState {
  operatingMode: 'integrated' | 'standalone';
  isPizzaIntegrated: boolean;
  syncEnabled: boolean;
  connected: boolean;
  loading: boolean;

  fetchMode: () => Promise<void>;
  setOperatingMode: (mode: 'integrated' | 'standalone') => Promise<void>;
}

export const useSystemModeStore = create<SystemModeState>((set, get) => ({
  operatingMode: 'integrated',
  isPizzaIntegrated: true,
  syncEnabled: true,
  connected: false,
  loading: true,

  fetchMode: async () => {
    try {
      const res = await api.get('/cloud-sync/status');
      if (res.data?.success) {
        const mode = res.data.operatingMode || 'integrated';
        const syncEnabled = res.data.syncEnabled !== false;
        const isPizzaIntegrated = mode === 'integrated' && syncEnabled;

        set({
          operatingMode: mode,
          isPizzaIntegrated,
          syncEnabled,
          connected: Boolean(res.data.connected),
          loading: false,
        });
      }
    } catch {
      set({ loading: false });
    }
  },

  setOperatingMode: async (mode: 'integrated' | 'standalone') => {
    try {
      await api.post('/cloud-sync/settings', {
        pizza_system_mode: mode,
      });

      const syncEnabled = get().syncEnabled;
      const isPizzaIntegrated = mode === 'integrated' && syncEnabled;

      set({
        operatingMode: mode,
        isPizzaIntegrated,
      });

      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('flo:mode-changed', { detail: { mode } }));
      }
    } catch (err: any) {
      console.error('Failed to change system mode:', err);
      throw err;
    }
  },
}));
