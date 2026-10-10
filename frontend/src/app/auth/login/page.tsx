'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { getLandingPage } from '@/components/layout/AuthGuard';
import Link from 'next/link';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import api from '@/lib/api';
import toast from 'react-hot-toast';
import {
  KeyRound,
  Mail,
  Lock,
  ArrowRight,
  Delete,
  RotateCcw,
  Store,
  Check,
  RefreshCw,
  X,
  ChevronRight,
  Sparkles,
} from 'lucide-react';

interface BranchItem {
  id: number;
  name: string;
  slug: string;
  owner_name: string;
  status: string;
  plan: string;
  currency_symbol: string;
}

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login, loginWithPin, selectTenant, user, tenants, currentTenant, loadFromStorage } = useAuthStore();

  const [mode, setMode] = useState<'password' | 'pin'>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [showTenantSelect, setShowTenantSelect] = useState(false);
  const [branchName, setBranchName] = useState<string>('');
  const [currentShopId, setCurrentShopId] = useState<string>('');

  // Branch switcher modal state
  const [showBranchModal, setShowBranchModal] = useState(false);
  const [branches, setBranches] = useState<BranchItem[]>([]);
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [switchingBranch, setSwitchingBranch] = useState(false);

  const fetchBranchStatus = useCallback(() => {
    api.get('/cloud-sync/status')
      .then((res) => {
        if (res.data?.currentShopName) {
          setBranchName(res.data.currentShopName);
        }
        if (res.data?.currentShopId) {
          setCurrentShopId(String(res.data.currentShopId));
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadFromStorage();
    fetchBranchStatus();
  }, [loadFromStorage, fetchBranchStatus]);

  const loadBranches = useCallback(async () => {
    setLoadingBranches(true);
    try {
      const res = await api.get('/cloud-sync/shops');
      if (res.data?.shops) {
        setBranches(res.data.shops);
      }
      if (res.data?.currentShopId) {
        setCurrentShopId(String(res.data.currentShopId));
      }
      if (res.data?.currentShopName) {
        setBranchName(res.data.currentShopName);
      }
    } catch {
      toast.error('Failed to load branches from cloud');
    } finally {
      setLoadingBranches(false);
    }
  }, []);

  const handleSelectBranch = async (shop: BranchItem) => {
    setSwitchingBranch(true);
    try {
      const res = await api.post('/cloud-sync/select-shop', { shop_id: shop.id });
      if (res.data?.success) {
        setBranchName(shop.name);
        setCurrentShopId(String(shop.id));
        setShowBranchModal(false);
        setPin('');
        toast.success(`Connected to ${shop.name}! Menu & staff updated.`);
      } else {
        toast.error(res.data?.message || 'Failed to switch branch');
      }
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } } };
      toast.error(error.response?.data?.error || 'Failed to switch branch');
    } finally {
      setSwitchingBranch(false);
    }
  };

  // Handle auto-redirect once logged in
  useEffect(() => {
    if (user && currentTenant) {
      router.push(getLandingPage(currentTenant.role, currentTenant.business_type));
    } else if (user && tenants.length === 1) {
      handleTenantSelect(tenants[0].id);
    } else if (user && tenants.length > 1) {
      setShowTenantSelect(true);
    }
    if (searchParams.get('select_tenant') === 'true' && user) {
      setShowTenantSelect(true);
    }
  }, [user, tenants, currentTenant, router, searchParams]);

  // Submit PIN login (verifies PIN directly with multi-shop auto detection)
  const submitPin = useCallback(async (pinToSubmit: string) => {
    if (pinToSubmit.length !== 4) return;
    setLoading(true);
    try {
      await loginWithPin(pinToSubmit);
      const tenantStr = typeof window !== 'undefined' ? localStorage.getItem('tenant') : null;
      const tenant = tenantStr ? JSON.parse(tenantStr) : null;
      const connectedName = tenant?.business_name || 'POS';
      toast.success(`Welcome! Connected to ${connectedName}`);
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } } };
      toast.error(error.response?.data?.error || 'Invalid 4-digit PIN');
      setPin('');
    } finally {
      setLoading(false);
    }
  }, [loginWithPin]);

  // Handle number pad button clicks
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
      const nextPin = pin + val;
      setPin(nextPin);
      if (nextPin.length === 4) {
        submitPin(nextPin);
      }
    }
  };

  // Physical keyboard support for PIN
  useEffect(() => {
    if (mode !== 'pin') return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (loading) return;
      if (e.key >= '0' && e.key <= '9') {
        e.preventDefault();
        handleKeypadPress(e.key);
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        handleKeypadPress('backspace');
      } else if (e.key === 'Escape') {
        e.preventDefault();
        handleKeypadPress('clear');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mode, pin, loading, handleKeypadPress]);

  // Standard Email/Password login
  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      toast.error('Email/Username and password are required');
      return;
    }
    setLoading(true);
    try {
      await login(email, password);
      toast.success('Signed in successfully!');
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } } };
      toast.error(error.response?.data?.error || 'Invalid credentials');
    } finally {
      setLoading(false);
    }
  };

  const handleTenantSelect = async (tenantId: number) => {
    setLoading(true);
    try {
      await selectTenant(tenantId);
    } catch {
      toast.error('Failed to select business');
    } finally {
      setLoading(false);
    }
  };

  if (showTenantSelect) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 px-4">
        <div className="w-full max-w-md">
          <Card className="border-slate-200 shadow-xl">
            <CardContent className="pt-6">
              <h2 className="text-2xl font-bold mb-2">Select Business</h2>
              <p className="text-muted-foreground text-sm mb-6">Choose which business to manage</p>
              <div className="space-y-3">
                {tenants.map((tenant) => (
                  <button
                    key={tenant.id}
                    onClick={() => handleTenantSelect(tenant.id)}
                    disabled={loading}
                    className="w-full text-left p-4 border rounded-xl hover:border-primary hover:bg-primary/5 transition-all group flex items-center justify-between"
                  >
                    <div>
                      <div className="font-semibold group-hover:text-primary text-base">{tenant.business_name}</div>
                      <div className="text-sm text-muted-foreground mt-0.5 capitalize">{tenant.business_type} &middot; {tenant.role}</div>
                    </div>
                    <ArrowRight className="h-5 w-5 text-muted-foreground group-hover:text-primary group-hover:translate-x-1 transition-transform" />
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-screen overflow-hidden flex items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-4 select-none">
      <div className="w-full max-w-md">
        <Card className="border-slate-800 shadow-2xl overflow-hidden rounded-2xl bg-slate-900/95 text-slate-100 backdrop-blur-md">
          {/* Top Brand & Status Bar */}
          <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl overflow-hidden border border-slate-700/50 flex items-center justify-center bg-slate-900 shadow-sm">
                <img src="/icon-64.png" alt="Sole What" className="h-8 w-8 rounded-lg" />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-sm font-black tracking-tight text-white leading-tight">
                    Sole What POS
                  </h1>
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    Online
                  </span>
                </div>

                {/* Interactive Branch Switcher Badge */}
                <button
                  type="button"
                  onClick={() => {
                    loadBranches();
                    setShowBranchModal(true);
                  }}
                  className="mt-1 flex items-center gap-1 text-[11px] text-orange-400 hover:text-orange-300 bg-orange-500/10 hover:bg-orange-500/20 border border-orange-500/30 px-2 py-0.5 rounded-md transition-all group font-medium cursor-pointer"
                  title="Click to switch shop branch"
                >
                  <span className="truncate max-w-[150px]">🏪 {branchName || 'Select Shop'}</span>
                  <span className="text-[9px] bg-orange-500/20 text-orange-200 px-1 py-0.2 rounded font-mono group-hover:bg-orange-500/30">
                    ⇄ Switch
                  </span>
                </button>
              </div>
            </div>

            {/* Mode Switcher Tabs */}
            <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs font-semibold">
              <button
                type="button"
                onClick={() => setMode('password')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all ${
                  mode === 'password'
                    ? 'bg-orange-600 text-white shadow-sm font-bold'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Mail className="h-3.5 w-3.5" />
                <span>Password</span>
              </button>
              <button
                type="button"
                onClick={() => setMode('pin')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all ${
                  mode === 'pin'
                    ? 'bg-orange-600 text-white shadow-sm font-bold'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <KeyRound className="h-3.5 w-3.5" />
                <span>PIN</span>
              </button>
            </div>
          </div>

          <CardContent className="p-6">
            {mode === 'password' ? (
              /* Real Standard Login (Email/Username + Password) */
              <form onSubmit={handlePasswordLogin} className="space-y-4">
                <div className="text-center mb-2">
                  <h2 className="text-lg font-bold text-white">Sign In to POS</h2>
                  <p className="text-xs text-slate-400 mt-1">
                    Enter your operator credentials to access the terminal
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="email" className="text-xs font-semibold text-slate-300">
                    Email Address or Username
                  </Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                    <Input
                      id="email"
                      type="text"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="e.g. cashier or user@pizza.com"
                      className="pl-9 bg-slate-950 border-slate-800 text-white placeholder:text-slate-600 focus:border-orange-500"
                      required
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="password" className="text-xs font-semibold text-slate-300">
                    Password
                  </Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                    <Input
                      id="password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter your password or PIN"
                      className="pl-9 bg-slate-950 border-slate-800 text-white placeholder:text-slate-600 focus:border-orange-500"
                      required
                    />
                  </div>
                </div>

                <Button
                  type="submit"
                  disabled={loading}
                  className="w-full h-11 text-sm font-bold bg-orange-600 hover:bg-orange-700 text-white mt-2 shadow-lg shadow-orange-600/20"
                  size="lg"
                >
                  {loading ? 'Verifying Credentials...' : 'Sign In'}
                </Button>

                <div className="pt-2 text-center">
                  <p className="text-xs text-slate-400">
                    Or switch to{' '}
                    <button
                      type="button"
                      onClick={() => setMode('pin')}
                      className="text-orange-400 hover:underline font-semibold"
                    >
                      Quick 4-Digit PIN
                    </button>
                  </p>
                </div>
              </form>
            ) : (
              /* Real PIN Login (Direct Secret PIN with multi-shop auto detect) */
              <div className="flex flex-col items-center justify-center space-y-4">
                <div className="text-center">
                  <h2 className="text-lg font-bold text-white">Staff PIN Access</h2>
                  <p className="text-xs text-slate-400 mt-1">
                    Enter your secret 4-digit PIN to authenticate
                  </p>
                  <div className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-medium bg-orange-500/10 text-orange-300 border border-orange-500/20">
                    <Sparkles className="h-3 w-3 text-orange-400 shrink-0" />
                    <span>Auto-detects newly created shops &amp; branches</span>
                  </div>
                </div>

                {/* 4-Digit PIN Dots Display */}
                <div className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800 w-full max-w-[240px] flex flex-col items-center justify-center shadow-inner">
                  <div className="flex items-center justify-center gap-4 py-1">
                    {[0, 1, 2, 3].map((index) => {
                      const isFilled = pin.length > index;
                      return (
                        <div
                          key={index}
                          className={`w-3.5 h-3.5 rounded-full transition-all duration-150 ${
                            isFilled
                              ? 'bg-orange-500 scale-125 shadow-lg shadow-orange-500/50'
                              : 'bg-slate-800 border border-slate-700'
                          }`}
                        />
                      );
                    })}
                  </div>
                  <span className="text-[10px] text-slate-500 mt-2 font-mono">
                    {loading ? 'Verifying PIN...' : `${pin.length} / 4 digits`}
                  </span>
                </div>

                {/* Ergonomic Touch Numpad */}
                <div className="grid grid-cols-3 gap-2.5 w-full max-w-[250px]">
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
                    <button
                      key={num}
                      type="button"
                      disabled={loading}
                      onClick={() => handleKeypadPress(String(num))}
                      className="h-12 rounded-xl text-lg font-bold bg-slate-800/80 hover:bg-orange-600 hover:text-white transition-all active:scale-95 text-white border border-slate-700/60 shadow-sm flex items-center justify-center select-none"
                    >
                      {num}
                    </button>
                  ))}

                  {/* Clear Button */}
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => handleKeypadPress('clear')}
                    title="Clear (Esc)"
                    className="h-12 rounded-xl text-xs font-bold bg-slate-800/40 hover:bg-rose-950/60 hover:text-rose-400 hover:border-rose-800/60 transition-all active:scale-95 text-slate-400 border border-slate-700/50 flex items-center justify-center select-none"
                  >
                    <RotateCcw className="h-4 w-4" />
                  </button>

                  {/* 0 Button */}
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => handleKeypadPress('0')}
                    className="h-12 rounded-xl text-lg font-bold bg-slate-800/80 hover:bg-orange-600 hover:text-white transition-all active:scale-95 text-white border border-slate-700/60 shadow-sm flex items-center justify-center select-none"
                  >
                    0
                  </button>

                  {/* Backspace Button */}
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => handleKeypadPress('backspace')}
                    title="Backspace"
                    className="h-12 rounded-xl text-xs font-bold bg-slate-800/40 hover:bg-amber-950/60 hover:text-amber-400 hover:border-amber-800/60 transition-all active:scale-95 text-slate-400 border border-slate-700/50 flex items-center justify-center select-none"
                  >
                    <Delete className="h-4 w-4" />
                  </button>
                </div>

                <div className="pt-1 text-center">
                  <p className="text-xs text-slate-400">
                    Need password login?{' '}
                    <button
                      type="button"
                      onClick={() => setMode('password')}
                      className="text-orange-400 hover:underline font-semibold"
                    >
                      Use Email &amp; Password
                    </button>
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Interactive Branch Switcher Modal */}
      {showBranchModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
            <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/70">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-orange-600/10 rounded-xl text-orange-400 border border-orange-500/20">
                  <Store className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-white">Select Shop Branch</h2>
                  <p className="text-[11px] text-slate-400">Choose which branch this terminal operates</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowBranchModal(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-all"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto space-y-2.5 flex-1">
              {loadingBranches ? (
                <div className="py-12 flex flex-col items-center justify-center text-slate-400 gap-2">
                  <RefreshCw className="h-6 w-6 animate-spin text-orange-500" />
                  <span className="text-xs font-medium">Loading branches from cloud...</span>
                </div>
              ) : branches.length === 0 ? (
                <div className="py-12 text-center text-slate-400">
                  <Store className="h-8 w-8 mx-auto text-slate-600 mb-2" />
                  <p className="text-xs">No branches found in cloud database.</p>
                </div>
              ) : (
                branches.map((b) => {
                  const isActive = String(b.id) === String(currentShopId);
                  return (
                    <button
                      key={b.id}
                      type="button"
                      disabled={switchingBranch}
                      onClick={() => handleSelectBranch(b)}
                      className={`w-full text-left p-3.5 rounded-xl border transition-all flex items-center justify-between group ${
                        isActive
                          ? 'bg-orange-500/10 border-orange-500/50 text-white shadow-sm'
                          : 'bg-slate-950/60 border-slate-800/80 hover:border-slate-700 hover:bg-slate-800/50 text-slate-300'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div
                          className={`h-9 w-9 rounded-lg flex items-center justify-center font-bold text-xs ${
                            isActive
                              ? 'bg-orange-600 text-white shadow-md'
                              : 'bg-slate-800 text-slate-300 group-hover:bg-slate-700'
                          }`}
                        >
                          {b.name.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-sm text-white truncate">{b.name}</span>
                            <span className="text-[10px] px-1.5 py-0.2 rounded font-mono bg-slate-800 text-slate-400 border border-slate-700">
                              #{b.id}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-400 truncate mt-0.5">
                            Owner: <span className="text-slate-300">{b.owner_name || 'Admin'}</span> &bull; {b.slug}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {isActive ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
                            <Check className="h-3 w-3" />
                            Active
                          </span>
                        ) : (
                          <span className="text-[11px] font-medium text-orange-400 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5">
                            Connect <ChevronRight className="h-3 w-3" />
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })
              )}
            </div>

            <div className="p-3 bg-slate-950/80 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
              <span className="text-[11px]">
                {branches.length} branch{branches.length !== 1 ? 'es' : ''} available
              </span>
              <button
                type="button"
                onClick={() => loadBranches()}
                disabled={loadingBranches || switchingBranch}
                className="flex items-center gap-1 text-[11px] text-orange-400 hover:text-orange-300 transition-colors cursor-pointer"
              >
                <RefreshCw className={`h-3 w-3 ${loadingBranches ? 'animate-spin' : ''}`} />
                Refresh List
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginContent />
    </Suspense>
  );
}
