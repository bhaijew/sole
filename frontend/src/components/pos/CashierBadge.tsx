'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '@/store/auth';
import {
  User as UserIcon,
  Shield,
  Coins,
  ChefHat,
  ChevronDown,
  LogOut,
  RotateCcw,
  Delete,
  CheckCircle2,
  X,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import api from '@/lib/api';
import toast from 'react-hot-toast';

interface StaffPinItem {
  id: string | number;
  name: string;
  role: 'owner' | 'manager' | 'cashier' | 'waiter' | 'chef';
  email: string | null;
  has_pin: number | boolean;
}

const ROLE_BADGES: Record<string, { bg: string; icon: typeof UserIcon; label: string }> = {
  owner:   { bg: 'bg-amber-100 text-amber-800 border-amber-200', icon: Shield, label: 'Owner' },
  manager: { bg: 'bg-purple-100 text-purple-800 border-purple-200', icon: Shield, label: 'Manager' },
  cashier: { bg: 'bg-emerald-100 text-emerald-800 border-emerald-200', icon: Coins, label: 'Cashier' },
  waiter:  { bg: 'bg-blue-100 text-blue-800 border-blue-200', icon: UserIcon, label: 'Waiter' },
  chef:    { bg: 'bg-orange-100 text-orange-800 border-orange-200', icon: ChefHat, label: 'Chef' },
};

export default function CashierBadge() {
  const { user, currentTenant, loginWithPin, logout } = useAuthStore();
  const [modalOpen, setModalOpen] = useState(false);
  const [staffList, setStaffList] = useState<StaffPinItem[]>([]);
  const [selectedStaff, setSelectedStaff] = useState<StaffPinItem | null>(null);
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);

  const role = user?.role || currentTenant?.role || 'cashier';
  const roleConfig = ROLE_BADGES[role] || ROLE_BADGES.cashier;
  const RoleIcon = roleConfig.icon;

  const loadStaff = useCallback(async () => {
    try {
      const res = await api.get('/auth/staff-pins');
      setStaffList(res.data.staff || []);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (modalOpen) {
      loadStaff();
      setPin('');
      setSelectedStaff(null);
    }
  }, [modalOpen, loadStaff]);

  const handleSwitchPin = useCallback(async (pinToSubmit: string) => {
    if (pinToSubmit.length !== 4) return;
    setLoading(true);
    try {
      await loginWithPin(pinToSubmit);
      toast.success('Switched cashier successfully!');
      setModalOpen(false);
      setPin('');
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } } };
      toast.error(error.response?.data?.error || 'Invalid 4-digit PIN');
      setPin('');
    } finally {
      setLoading(false);
    }
  }, [loginWithPin]);

  const handleKeypadPress = (val: string) => {
    if (loading) return;
    if (val === 'clear') {
      setPin('');
      return;
    }
    if (val === 'backspace') {
      setPin((prev) => prev.slice(0, -1));
      return;
    }
    if (pin.length < 4) {
      const next = pin + val;
      setPin(next);
      if (next.length === 4) {
        handleSwitchPin(next);
      }
    }
  };

  // Keyboard events when switch modal is open
  useEffect(() => {
    if (!modalOpen) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key >= '0' && e.key <= '9') {
        e.preventDefault();
        handleKeypadPress(e.key);
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        handleKeypadPress('backspace');
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setModalOpen(false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [modalOpen, pin, loading, handleKeypadPress]);

  return (
    <>
      {/* Topbar Cashier Badge Trigger */}
      <button
        type="button"
        onClick={() => setModalOpen(true)}
        className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors text-left"
        title="Click to switch cashier or view profile"
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
        <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
      </button>

      {/* Switch Cashier / Shift Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-primary/10 rounded-xl text-primary">
                  <Users className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-base text-slate-900 dark:text-slate-100">
                    Switch Cashier / Shift
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Currently active: <strong className="text-slate-800 dark:text-slate-200">{user?.name}</strong> ({roleConfig.label})
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="p-1 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-5">
              {/* Staff Select Cards */}
              {staffList.length > 0 && (
                <div>
                  <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                    Select Staff Member
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {staffList.map((staff) => {
                      const isCurrent = staff.id === user?.id;
                      const isSelected = selectedStaff?.id === staff.id;
                      const staffRole = ROLE_BADGES[staff.role] || ROLE_BADGES.cashier;
                      const SIcon = staffRole.icon;

                      return (
                        <button
                          key={staff.id}
                          type="button"
                          onClick={() => {
                            setSelectedStaff(staff);
                            setPin('');
                          }}
                          className={`p-2 rounded-xl border text-left flex items-center gap-2 transition-all ${
                            isSelected
                              ? 'border-primary bg-primary/5 ring-2 ring-primary/20 shadow-sm'
                              : isCurrent
                              ? 'border-slate-300 dark:border-slate-700 bg-slate-100/70 dark:bg-slate-800/70 opacity-80'
                              : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 bg-slate-50/50'
                          }`}
                        >
                          <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 border ${staffRole.bg}`}>
                            <SIcon className="w-3.5 h-3.5" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-semibold truncate text-slate-800 dark:text-slate-100">
                              {staff.name} {isCurrent && '(Active)'}
                            </div>
                            <div className="text-[10px] text-muted-foreground capitalize truncate">
                              {staff.role}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* PIN Prompt & Dot Display */}
              <div className="text-center pt-1">
                <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">
                  {selectedStaff ? (
                    <span>Enter 4-digit PIN for <strong className="text-slate-800 dark:text-slate-200">{selectedStaff.name}</strong></span>
                  ) : (
                    <span>Enter 4-digit PIN to switch</span>
                  )}
                </div>

                <div className="flex justify-center items-center gap-4 py-2">
                  {[0, 1, 2, 3].map((index) => {
                    const isFilled = pin.length > index;
                    return (
                      <div
                        key={index}
                        className={`w-3.5 h-3.5 rounded-full transition-all duration-150 ${
                          isFilled
                            ? 'bg-primary scale-125 shadow-md shadow-primary/30'
                            : 'bg-slate-200 dark:bg-slate-700 border border-slate-300 dark:border-slate-600'
                        }`}
                      />
                    );
                  })}
                </div>
              </div>

              {/* Responsive Numpad */}
              <div className="grid grid-cols-3 gap-2 max-w-[260px] mx-auto">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
                  <button
                    key={num}
                    type="button"
                    disabled={loading}
                    onClick={() => handleKeypadPress(String(num))}
                    className="h-12 rounded-xl text-lg font-bold bg-slate-100 dark:bg-slate-800 hover:bg-primary hover:text-white transition-all active:scale-95 text-slate-800 dark:text-slate-100 border border-slate-200 dark:border-slate-700 shadow-sm flex items-center justify-center select-none"
                  >
                    {num}
                  </button>
                ))}

                <button
                  type="button"
                  disabled={loading}
                  onClick={() => handleKeypadPress('clear')}
                  title="Clear"
                  className="h-12 rounded-xl text-xs font-semibold bg-slate-100 dark:bg-slate-800 hover:bg-rose-50 hover:text-rose-600 transition-all active:scale-95 text-slate-500 border border-slate-200 dark:border-slate-700 shadow-sm flex items-center justify-center select-none"
                >
                  <RotateCcw className="h-4 w-4" />
                </button>

                <button
                  type="button"
                  disabled={loading}
                  onClick={() => handleKeypadPress('0')}
                  className="h-12 rounded-xl text-lg font-bold bg-slate-100 dark:bg-slate-800 hover:bg-primary hover:text-white transition-all active:scale-95 text-slate-800 dark:text-slate-100 border border-slate-200 dark:border-slate-700 shadow-sm flex items-center justify-center select-none"
                >
                  0
                </button>

                <button
                  type="button"
                  disabled={loading}
                  onClick={() => handleKeypadPress('backspace')}
                  title="Backspace"
                  className="h-12 rounded-xl text-xs font-semibold bg-slate-100 dark:bg-slate-800 hover:bg-amber-50 hover:text-amber-600 transition-all active:scale-95 text-slate-500 border border-slate-200 dark:border-slate-700 shadow-sm flex items-center justify-center select-none"
                >
                  <Delete className="h-4 w-4" />
                </button>
              </div>

              {/* Footer Actions */}
              <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setModalOpen(false);
                    logout();
                  }}
                  className="text-rose-600 border-rose-200 hover:bg-rose-50 dark:hover:bg-rose-950/30 gap-1.5"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  Full Logout
                </Button>

                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setModalOpen(false)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
