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
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="flex flex-col items-center gap-4">
          <div className="relative w-16 h-16 flex items-center justify-center">
            <div className="absolute inset-0 rounded-full border-2 border-red-200 border-t-red-600 border-r-orange-500 animate-spin" />
            <div className="w-11 h-11 rounded-full bg-white shadow-sm flex items-center justify-center p-1.5 overflow-hidden">
              <img src="/logo.png" alt="Sole What Logo" className="w-full h-full object-contain" />
            </div>
          </div>
          <div className="text-center">
            <p className="text-xs font-black uppercase tracking-widest text-gray-900">Sole What</p>
            <p className="text-[11px] text-gray-500 font-medium">Loading POS...</p>
          </div>
        </div>
      </div>
    );
  }

  const hasToken = typeof window !== 'undefined' && !!localStorage.getItem('token');
  if (!user && !hasToken) return null;

  return <>{children}</>;
}
