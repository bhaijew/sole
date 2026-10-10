'use client';

import { useState, useRef, useEffect } from 'react';
import { useAuthStore } from '@/store/auth';
import {
  User as UserIcon,
  Shield,
  Coins,
  ChefHat,
  ChevronDown,
  Lock,
  Building2,
  Mail,
  CheckCircle,
} from 'lucide-react';

const ROLE_BADGES: Record<string, { bg: string; icon: typeof UserIcon; label: string }> = {
  owner:   { bg: 'bg-amber-100 text-amber-800 border-amber-200', icon: Shield, label: 'Owner' },
  manager: { bg: 'bg-purple-100 text-purple-800 border-purple-200', icon: Shield, label: 'Manager' },
  cashier: { bg: 'bg-emerald-100 text-emerald-800 border-emerald-200', icon: Coins, label: 'Cashier' },
  waiter:  { bg: 'bg-blue-100 text-blue-800 border-blue-200', icon: UserIcon, label: 'Waiter' },
  chef:    { bg: 'bg-orange-100 text-orange-800 border-orange-200', icon: ChefHat, label: 'Chef' },
};

export default function CashierBadge() {
  const { user, currentTenant, logout } = useAuthStore();
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const role = user?.role || currentTenant?.role || 'cashier';
  const roleConfig = ROLE_BADGES[role] || ROLE_BADGES.cashier;
  const RoleIcon = roleConfig.icon;

  const businessName = currentTenant?.business_name || 'Sole What POS';

  // Close when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const handleLockTerminal = () => {
    setIsOpen(false);
    logout();
  };

  return (
    <div className="relative inline-block" ref={menuRef}>
      {/* Topbar Profile Badge Trigger */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors text-left cursor-pointer"
        title="View profile & lock terminal"
      >
        <div className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 border ${roleConfig.bg}`}>
          <RoleIcon className="w-3.5 h-3.5" />
        </div>
        <div className="flex flex-col text-xs leading-tight">
          <span className="font-semibold text-slate-800 dark:text-slate-200 truncate max-w-[90px]">
            {user?.name || 'Cashier'}
          </span>
          <span className="text-[10px] text-muted-foreground capitalize">
            {roleConfig.label}
          </span>
        </div>
        <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-150 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {/* Profile & Lock Dropdown Popover */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-72 rounded-2xl bg-white dark:bg-slate-900 shadow-2xl border border-slate-200 dark:border-slate-800 p-4 z-50 animate-in fade-in zoom-in-95 duration-100">
          {/* User Profile Info (See) */}
          <div className="flex items-center gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
            <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 border shadow-sm ${roleConfig.bg}`}>
              <RoleIcon className="w-6 h-6" />
            </div>
            <div className="min-w-0 flex-1">
              <h4 className="font-bold text-sm text-slate-900 dark:text-slate-100 truncate">
                {user?.name || 'Cashier'}
              </h4>
              <div className="inline-flex items-center gap-1 mt-0.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                <span className="capitalize">{roleConfig.label}</span>
              </div>
            </div>
          </div>

          {/* Details Section */}
          <div className="py-3 space-y-2 text-xs">
            {/* Active Business/Branch */}
            <div className="flex items-center justify-between text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/50 p-2 rounded-lg">
              <div className="flex items-center gap-2">
                <Building2 className="w-3.5 h-3.5 text-orange-500 shrink-0" />
                <span className="text-[11px] font-medium">Branch</span>
              </div>
              <span className="font-semibold text-slate-900 dark:text-slate-100 truncate max-w-[130px]">
                {businessName}
              </span>
            </div>

            {/* Email / Username if available */}
            {user?.email && (
              <div className="flex items-center justify-between text-slate-600 dark:text-slate-400 px-2 py-1">
                <div className="flex items-center gap-2">
                  <Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <span className="text-[11px]">Email</span>
                </div>
                <span className="text-[11px] text-slate-700 dark:text-slate-300 truncate max-w-[140px]">
                  {user.email}
                </span>
              </div>
            )}

            {/* Session Status */}
            <div className="flex items-center justify-between text-slate-600 dark:text-slate-400 px-2 py-1">
              <span className="text-[11px]">Session</span>
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                <CheckCircle className="w-3 h-3" />
                Active
              </span>
            </div>
          </div>

          {/* Lock Terminal / Logout Button (Lock) */}
          <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={handleLockTerminal}
              className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl font-bold text-xs bg-rose-600 hover:bg-rose-700 text-white shadow-md shadow-rose-600/20 active:scale-98 transition-all cursor-pointer"
            >
              <Lock className="w-3.5 h-3.5" />
              <span>Lock Terminal</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
