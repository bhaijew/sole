'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function KitchenDisplayPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/pos');
  }, [router]);

  return (
    <div className="flex h-full min-h-[400px] flex-col items-center justify-center gap-3 p-8 text-center">
      <div className="w-8 h-8 border-4 border-brand border-t-transparent rounded-full animate-spin" />
      <p className="text-sm text-gray-500">Kitchen Display is disabled in POS. Redirecting to POS...</p>
    </div>
  );
}
