import { create } from 'zustand';
import api from '@/lib/api';
import type { User, Tenant } from '@/lib/types';

interface AuthState {
  user: User | null;
  token: string | null;
  tenants: Tenant[];
  currentTenant: Tenant | null;
  loading: boolean;

  login: (email: string, password: string) => Promise<void>;
  loginWithPin: (pin: string, userId?: string | number) => Promise<void>;
  register: (data: RegisterData) => Promise<void>;
  selectTenant: (tenantId: number) => Promise<void>;
  logout: () => void;
  loadFromStorage: () => void;
}

interface RegisterData {
  name: string;
  email: string;
  password: string;
  password_confirmation: string;
  business_name: string;
  business_type: string;
  country: string;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: null,
  tenants: [],
  currentTenant: null,
  loading: true,

  login: async (email: string, password: string) => {
    const { data } = await api.post('/auth/login', { email, password });
    localStorage.setItem('token', data.access_token);
    localStorage.setItem('user', JSON.stringify(data.user));
    if (data.tenants?.[0]) {
      localStorage.setItem('tenant', JSON.stringify(data.tenants[0]));
    }
    set({
      user: data.user,
      token: data.access_token,
      tenants: data.tenants,
      currentTenant: data.tenants?.[0] ?? null,
      loading: false,
    });
  },

  loginWithPin: async (pin: string, userId?: string | number) => {
    const { data } = await api.post('/auth/pin-login', { pin, userId });
    localStorage.setItem('token', data.access_token);
    localStorage.setItem('user', JSON.stringify(data.user));
    if (data.tenants?.[0]) {
      localStorage.setItem('tenant', JSON.stringify(data.tenants[0]));
    }
    set({
      user: data.user,
      token: data.access_token,
      tenants: data.tenants,
      currentTenant: data.tenants?.[0] ?? null,
      loading: false,
    });
  },

  register: async (registerData: RegisterData) => {
    const { data } = await api.post('/auth/register', registerData);
    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(data.user));
    if (data.tenant) {
      localStorage.setItem('tenant', JSON.stringify(data.tenant));
    }
    set({
      user: data.user,
      token: data.token,
      tenants: [data.tenant],
      currentTenant: data.tenant,
      loading: false,
    });
  },

  selectTenant: async (tenantId: number) => {
    const { data } = await api.post('/auth/tenants/select', { tenant_id: tenantId });
    localStorage.setItem('token', data.access_token);
    localStorage.setItem('tenant', JSON.stringify(data.tenant));
    if (data.user) {
      localStorage.setItem('user', JSON.stringify(data.user));
    }
    set({
      token: data.access_token,
      currentTenant: data.tenant,
      loading: false,
    });
  },

  logout: () => {
    api.post('/auth/logout').catch(() => { });
    localStorage.removeItem('token');
    localStorage.removeItem('tenant');
    localStorage.removeItem('user');
    set({ user: null, token: null, tenants: [], currentTenant: null, loading: false });
  },

  loadFromStorage: () => {
    if (typeof window === 'undefined') {
      set({ loading: false });
      return;
    }
    const token = localStorage.getItem('token');
    const tenantStr = localStorage.getItem('tenant');
    const userStr = localStorage.getItem('user');
    const cachedTenant = tenantStr ? JSON.parse(tenantStr) : null;
    const cachedUser = userStr ? JSON.parse(userStr) : null;

    if (token) {
      // Synchronously load cached credentials so there is ZERO flash to login
      set({
        token,
        user: cachedUser,
        currentTenant: cachedTenant,
        loading: !cachedTenant && !cachedUser,
      });

      // Background validation with API
      api.get('/auth/me')
        .then(({ data }) => {
          localStorage.setItem('user', JSON.stringify(data.user));
          if (data.tenants?.[0] && !cachedTenant) {
            localStorage.setItem('tenant', JSON.stringify(data.tenants[0]));
          }
          set({
            user: data.user,
            token,
            tenants: data.tenants,
            currentTenant: cachedTenant || (data.tenants?.[0] ?? null),
            loading: false,
          });
        })
        .catch(() => {
          localStorage.removeItem('token');
          localStorage.removeItem('tenant');
          localStorage.removeItem('user');
          set({ user: null, token: null, tenants: [], currentTenant: null, loading: false });
        });
    } else {
      set({ loading: false });
    }
  },
}));
