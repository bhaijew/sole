'use client';

import { useState, useEffect } from 'react';
import api from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { useCartStore } from '@/store/cart';
import { usePosSettingsStore } from '@/store/pos-settings';
import toast from 'react-hot-toast';
import { ShoppingCart } from 'lucide-react';
import type { Addon, Category, Product, Order } from '@/lib/types';
import {
  Drawer, DrawerContent, DrawerTrigger,
} from '@/components/ui/drawer';

import ProductGrid from '@/components/pos/ProductGrid';
import CartPanel from '@/components/pos/CartPanel';
import AddonModal from '@/components/pos/AddonModal';
import PosTopbar from '@/components/pos/PosTopbar';
import { usePrinterStore } from '@/hooks/usePrinter';

export default function POSPage() {
  const { currentTenant } = useAuthStore();
  const cart = useCartStore();
  const { autoPrintKot } = usePosSettingsStore();

  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [mobileCartOpen, setMobileCartOpen] = useState(false);

  // Modal state
  const [addonProduct, setAddonProduct] = useState<Product | null>(null);

  const currency = currentTenant?.currency === 'THB' ? '฿' : (currentTenant?.currency === 'INR' ? '₹' : 'Rs ');
  const { printBill, printKot } = usePrinterStore();

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [catRes, prodRes] = await Promise.all([
          api.get('/categories?active=1'),
          api.get('/products?active=1'),
        ]);
        setCategories((catRes.data.categories as Category[]) || []);
        setProducts((prodRes.data.products as Product[]) || []);
      } catch {
        toast.error('Failed to load menu data');
      }
    };

    fetchData();

    // Listen for live real-time sync events from cloud
    const handleLiveSync = () => {
      fetchData();
    };

    window.addEventListener('flo:menu-synced', handleLiveSync);
    window.addEventListener('flo:order-synced', handleLiveSync);

    return () => {
      window.removeEventListener('flo:menu-synced', handleLiveSync);
      window.removeEventListener('flo:order-synced', handleLiveSync);
    };
  }, []);

  const handleProductClick = (product: Product) => {
    if (product.addon_groups && product.addon_groups.length > 0) {
      setAddonProduct(product);
    } else {
      cart.addItem(product);
    }
  };

  const handleAddonAdd = (product: Product, quantity: number, addons: Addon[], instructions: string) => {
    cart.addItem(product, quantity, addons, instructions);
  };

  const handlePlaceOrder = async () => {
    if (cart.items.length === 0) {
      toast.error('Cart is empty');
      return;
    }

    const customerName = cart.customerName.trim() || undefined;
    const isDelivery = cart.orderType === 'delivery' || Boolean(cart.deliveryAddress.trim());
    const finalOrderType = isDelivery ? 'delivery' : (cart.orderType || 'takeaway');
    const safeDeliveryFee = isDelivery ? Math.max(0, Number(cart.deliveryFee) || 0) : 0;

    setSubmitting(true);
    try {
      const { data } = await api.post('/orders', {
        shop_id: (currentTenant as any)?.shop_id || undefined,
        table_id: null,
        customer_id: null,
        customer_name: customerName,
        type: finalOrderType,
        guest_count: 1,
        delivery_charge: safeDeliveryFee,
        delivery_fee: safeDeliveryFee,
        delivery_address: cart.deliveryAddress.trim() || null,
        items: cart.items.map((item) => ({
          product_id: item.product.id,
          quantity: item.quantity,
          addons: item.addons.length > 0
            ? item.addons.map((a) => ({ id: a.id, name: a.name, price: a.price }))
            : null,
          special_instructions: item.special_instructions || null,
        })),
      });

      toast.success(`Order #${data.order.order_number} placed!`);
      cart.clearCart();
      setMobileCartOpen(false);

      // Auto-generate bill, mark as paid (cash), and print directly without any popup
      try {
        const billRes = await api.post('/bills/generate', { order_id: data.order.id });
        const generatedBill = billRes.data?.bill;

        if (generatedBill) {
          try {
            const payRes = await api.post(`/bills/${generatedBill.id}/payment`, {
              method: 'cash',
              amount: generatedBill.total,
            });
            const paidBill = payRes.data?.bill || generatedBill;

            const billToPrint = {
              ...paidBill,
              order: {
                ...(paidBill.order || data.order),
                customer_name: data.order?.customer_name || customerName,
                customer: (paidBill.order?.customer || data.order?.customer) || (customerName ? { name: customerName } : undefined),
              },
            };

            if (currentTenant) {
              await printBill(billToPrint, {
                business_name: currentTenant.business_name,
                currency,
              });
            }
          } catch {
            const billToPrint = {
              ...generatedBill,
              order: {
                ...(generatedBill.order || data.order),
                customer_name: data.order?.customer_name || customerName,
                customer: (generatedBill.order?.customer || data.order?.customer) || (customerName ? { name: customerName } : undefined),
              },
            };
            if (currentTenant) {
              await printBill(billToPrint, {
                business_name: currentTenant.business_name,
                currency,
              });
            }
          }
        }
      } catch (billErr) {
        console.error('Auto bill generation failed:', billErr);
      }

      if (autoPrintKot) {
        try {
          const orderForKot = {
            ...data.order,
            customer_name: data.order?.customer_name || customerName,
            customer: data.order?.customer || (customerName ? { name: customerName } : undefined),
          };
          await printKot(orderForKot as Order);
        } catch {
          toast.error('KOT print failed — check printer connection');
        }
      }
    } catch (err: unknown) {
      const error = err as { response?: { data?: { message?: string } } };
      toast.error(error.response?.data?.message || 'Failed to place order');
    } finally {
      setSubmitting(false);
    }
  };

  const cartPanelProps = {
    currency,
    submitting,
    onPlaceOrder: handlePlaceOrder,
  };

  const itemCount = cart.itemCount();

  return (
    <>
      <PosTopbar />

      {/* Main content area */}
      <div className="flex flex-1 min-h-0 overflow-hidden p-4 gap-4">
        {/* Product Grid — full width on mobile, flex-1 on desktop */}
        <div className="flex-1 min-w-0 h-full flex flex-col">
          <ProductGrid
            categories={categories}
            products={products}
            selectedCategory={selectedCategory}
            setSelectedCategory={setSelectedCategory}
            search={search}
            setSearch={setSearch}
            currency={currency}
            onProductClick={handleProductClick}
          />
        </div>

        {/* Desktop Cart — hidden on mobile */}
        <div className="hidden md:flex md:w-80 md:shrink-0 h-full">
          <CartPanel {...cartPanelProps} />
        </div>
      </div>

      {/* Mobile: Floating Cart Button + Bottom Sheet — outside flex container */}
      <Drawer open={mobileCartOpen} onOpenChange={setMobileCartOpen}>
        <DrawerTrigger asChild>
          <button className="fixed bottom-5 right-5 z-40 w-14 h-14 bg-brand text-white rounded-full shadow-lg flex items-center justify-center hover:bg-brand-hover transition-colors md:hidden">
            <ShoppingCart size={22} />
            {itemCount > 0 && (
              <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs w-5 h-5 rounded-full flex items-center justify-center font-bold">
                {itemCount}
              </span>
            )}
          </button>
        </DrawerTrigger>
        <DrawerContent className="max-h-[85vh]">
          <div className="overflow-y-auto max-h-[80vh] px-2 pb-2">
            <CartPanel {...cartPanelProps} variant="drawer" />
          </div>
        </DrawerContent>
      </Drawer>

      {/* Addon Modal */}
      {addonProduct && (
        <AddonModal
          product={addonProduct}
          currency={currency}
          onAdd={handleAddonAdd}
          onClose={() => setAddonProduct(null)}
        />
      )}
    </>
  );
}
