'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuthStore } from '@/store/auth';

export function getLandingPage(_role?: string, _businessType?: string): string {
  return '/pos';
}

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, currentTenant, loading, loadFromStorage } = useAuthStore();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    loadFromStorage();
  }, [loadFromStorage]);

  useEffect(() => {
    if (!loading) {
      const hasToken = typeof window !== 'undefined' && !!localStorage.getItem('token');
      if (!user && !hasToken) {
        router.push('/auth/login');
      } else if (!currentTenant && !hasToken) {
        router.push('/auth/login?select_tenant=true');
      } else if (currentTenant && (pathname === '/dashboard' || pathname === '/dashboard/')) {
        router.replace(getLandingPage(currentTenant.role, currentTenant.business_type));
      }
    }
  }, [user, currentTenant, loading, router, pathname]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-slate-900 to-slate-950">
        <div className="flex flex-col items-center gap-5">
          <div className="relative w-20 h-20 flex items-center justify-center">
            {/* Ambient Brand Glow */}
            <div className="absolute inset-0 rounded-2xl bg-orange-500/25 blur-xl animate-pulse" />
            {/* Animated Brand Ring */}
            <div className="absolute inset-0 rounded-2xl border-2 border-orange-500/30 border-t-orange-500 border-r-amber-400 animate-spin" />
            {/* Real SoleWhat Logo Emblem */}
            <div className="relative w-14 h-14 rounded-xl bg-slate-900/90 border border-slate-700/80 shadow-2xl flex items-center justify-center p-2 overflow-hidden">
              <img
                src="/logo.png"
                alt="SoleWhat Logo"
                className="w-full h-full object-contain drop-shadow-[0_2px_8px_rgba(249,115,22,0.4)]"
              />
            </div>
          </div>
          <div className="text-center">
            <p className="text-sm font-black uppercase tracking-widest text-white drop-shadow-sm">SoleWhat</p>
            <p className="text-xs text-orange-400/90 font-medium tracking-wide mt-0.5 flex items-center justify-center gap-1">
              <span>Loading POS</span>
              <span className="inline-flex animate-pulse">...</span>
            </p>
          </div>
        </div>
      </div>
    );
  }

  const hasToken = typeof window !== 'undefined' && !!localStorage.getItem('token');
  if (!user && !hasToken) return null;

  return <>{children}</>;
}
