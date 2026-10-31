'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';
import api from '@/lib/api';
import {
  ShoppingCart,
  UtensilsCrossed,
  ClipboardList,
  ShieldCheck,
  Package,
  UserCog,
  Settings,
  LogOut,
} from 'lucide-react';
import { useAuthStore } from '@/store/auth';
import { useSystemModeStore } from '@/store/system-mode';
import { getLandingPage } from '@/components/layout/AuthGuard';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar';

interface NavItem {
  href: string;
  label: string;
  icon: React.ElementType;
  roles: string[];
  businessTypes: string[] | null;
}

// null = show for all business types
const ALL_NAV_ITEMS: NavItem[] = [
  { href: '/pos',             label: 'POS',          icon: ShoppingCart,    roles: ['owner', 'manager', 'cashier'],              businessTypes: null },
  { href: '/tables',          label: 'Tables',       icon: UtensilsCrossed, roles: ['owner', 'manager', 'cashier'],              businessTypes: null },
  { href: '/orders',          label: 'Orders',       icon: ClipboardList,   roles: ['owner', 'manager', 'cashier'],              businessTypes: null },
  { href: '/verify',          label: 'Verify Orders',icon: ShieldCheck,     roles: ['owner', 'manager', 'cashier'],              businessTypes: null },
  { href: '/products',        label: 'Products',     icon: Package,         roles: ['owner', 'manager'],                         businessTypes: null },
  { href: '/staff',           label: 'Staff',        icon: UserCog,         roles: ['owner', 'manager'],                         businessTypes: null },
  { href: '/settings',        label: 'Settings',     icon: Settings,        roles: ['owner', 'manager'],                         businessTypes: null },
];

export default function AppSidebar() {
  const pathname = usePathname();
  const { currentTenant, logout } = useAuthStore();
  const { isPizzaIntegrated, fetchMode } = useSystemModeStore();
  const { isMobile, setOpenMobile } = useSidebar();
  const closeMobile = () => { if (isMobile) setOpenMobile(false); };

  const [pendingVerifyCount, setPendingVerifyCount] = useState(0);

  useEffect(() => {
    fetchMode();
  }, [fetchMode]);

  useEffect(() => {
    let mounted = true;
    const checkPending = async () => {
      try {
        const res = await api.get('/orders/verify-pending');
        if (mounted && res.data?.orders) {
          setPendingVerifyCount(res.data.orders.length);
        }
      } catch {}
    };
    checkPending();
    const interval = setInterval(checkPending, 5000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  const role = currentTenant?.role || 'cashier';
  const businessType = currentTenant?.business_type || 'restaurant';
  const navItems = ALL_NAV_ITEMS.filter((item) => {
    if (!item.roles.includes(role)) return false;
    if (item.businessTypes !== null && !item.businessTypes.includes(businessType)) return false;
    // When integrated with Pizza Management System, products and staff are managed centrally
    if (isPizzaIntegrated && (item.href === '/products' || item.href === '/staff')) return false;
    return true;
  });
  const homeHref = getLandingPage(role, businessType);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <a href={homeHref}>
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg overflow-hidden bg-slate-900 border border-slate-700/50 shadow-sm">
                  <img src="/icon-32.png" alt="Sole What" width={24} height={24} className="rounded" />
                </div>
                <div className="flex flex-col gap-0.5 leading-none">
                  <span className="font-semibold truncate">
                    {currentTenant?.business_name || 'Sole What'}
                  </span>
                  <span className="text-xs text-muted-foreground truncate">
                    Point of Sale
                  </span>
                </div>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => {
                const isActive = pathname === item.href || pathname === item.href + '/' || pathname?.startsWith(item.href + '/');
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton asChild isActive={isActive}>
                      <a href={item.href} onClick={closeMobile} title={item.label}>
                        <item.icon />
                        <span className="flex-1">{item.label}</span>
                        {item.href === '/verify' && pendingVerifyCount > 0 && (
                          <span className="ml-auto px-1.5 py-0.5 rounded-full text-[10px] font-black bg-amber-500 text-slate-950 animate-pulse">
                            {pendingVerifyCount}
                          </span>
                        )}
                      </a>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={logout} title="Logout">
              <LogOut />
              <span>Logout</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
