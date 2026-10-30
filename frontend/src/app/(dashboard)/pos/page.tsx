'use client';

import { useState, useEffect } from 'react';
import api from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { useCartStore, getProductPriceForSize, hasProductSizes } from '@/store/cart';
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
  const { autoPrintKot, autoPrintBill } = usePosSettingsStore();

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
    if ((product.addon_groups && product.addon_groups.length > 0) || hasProductSizes(product)) {
      setAddonProduct(product);
    } else {
      cart.addItem(product);
    }
  };

  const handleAddonAdd = (product: Product, quantity: number, addons: Addon[], instructions: string, size?: string) => {
    cart.addItem(product, quantity, addons, instructions, size);
  };

  const handlePlaceOrder = async () => {
    if (cart.items.length === 0) {
      toast.error('Cart is empty');
      return;
    }

    const chosenPaymentMethod = cart.paymentMethod || 'cash';
    const customerName = cart.customerName ? cart.customerName.trim() : undefined;
    const deliveryAddress = cart.deliveryAddress ? cart.deliveryAddress.trim() : undefined;
    const isDelivery = cart.orderType === 'delivery' || Boolean(deliveryAddress);
    const finalOrderType = isDelivery ? 'delivery' : (cart.orderType || 'takeaway');
    const safeDeliveryFee = isDelivery ? Math.max(0, Number(cart.deliveryFee) || 0) : 0;
    
    // Only accept real phone number entered by user (no fake dummy 03333333 or fallback from token)
    const rawPhone = cart.customerPhone ? cart.customerPhone.trim() : '';
    const isFakePhone = !rawPhone || rawPhone.length < 7 || /^03{4,}$/.test(rawPhone.replace(/\D/g, '')) || /^0+$/.test(rawPhone.replace(/\D/g, ''));
    const customerPhone = isFakePhone ? undefined : rawPhone;

    const notesParts: string[] = [];
    if (finalOrderType === 'dine_in' && cart.orderNumberInput?.trim()) {
      notesParts.push(`Table: ${cart.orderNumberInput.trim()}`);
    } else if (cart.orderNumberInput?.trim()) {
      notesParts.push(`Token: ${cart.orderNumberInput.trim()}`);
    }
    if (customerName) {
      notesParts.push(`Customer: ${customerName}`);
    }
    if (customerPhone) {
      notesParts.push(`Phone: ${customerPhone}`);
    }
    const orderSpecialInstructions = notesParts.length > 0 ? notesParts.join(' | ') : null;

    setSubmitting(true);
    try {
      const { data } = await api.post('/orders', {
        shop_id: (currentTenant as any)?.shop_id || undefined,
        table_id: null,
        customer_id: null,
        customer_name: customerName || null,
        customer_phone: customerPhone || null,
        phone: customerPhone || null,
        type: finalOrderType,
        payment_method: chosenPaymentMethod,
        guest_count: 1,
        delivery_charge: safeDeliveryFee,
        delivery_fee: safeDeliveryFee,
        delivery_address: deliveryAddress || null,
        special_instructions: orderSpecialInstructions,
        items: cart.items.map((item) => {
          const itemSize = item.size ? `Size: ${item.size}` : '';
          const instructionsCombined = [itemSize, item.special_instructions].filter(Boolean).join(' | ');
          const effectivePrice = item.unit_price ?? getProductPriceForSize(item.product, item.size);

          return {
            product_id: String(item.product?.id || `prod-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`),
            product_name: item.product?.name || 'Item',
            quantity: item.quantity,
            unit_price: effectivePrice,
            addons: item.addons.length > 0
              ? item.addons.map((a) => ({ id: a.id, name: a.name, price: a.price }))
              : null,
            special_instructions: instructionsCombined || null,
            variant_selection: item.size || null,
            items_included: (item.product as any)?.items_included ? JSON.stringify((item.product as any).items_included) : (item.product.description || null),
          };
        }),
      });

      toast.success(`Order #${data.order.order_number} placed!`);
      cart.clearCart();
      setMobileCartOpen(false);

      // Auto-generate bill, mark as paid with selected payment method (cash/online), and print directly
      try {
        const billRes = await api.post('/bills/generate', { order_id: data.order.id });
        const generatedBill = billRes.data?.bill;

        if (generatedBill) {
          try {
            const payRes = await api.post(`/bills/${generatedBill.id}/payment`, {
              method: chosenPaymentMethod,
              amount: generatedBill.total,
            });
            const paidBill = payRes.data?.bill || generatedBill;

            const finalCustomerObj = (paidBill.order?.customer || data.order?.customer) || (customerName || customerPhone ? { name: customerName || '', phone: customerPhone || '' } : undefined);
            const billToPrint = {
              ...paidBill,
              payment_method: chosenPaymentMethod,
              order: {
                ...(paidBill.order || data.order),
                payment_method: chosenPaymentMethod,
                customer_name: data.order?.customer_name || customerName,
                customer_phone: data.order?.customer_phone || customerPhone,
                delivery_address: data.order?.delivery_address || deliveryAddress,
                customer: finalCustomerObj,
              },
            };

            if (autoPrintBill && currentTenant) {
              await printBill(billToPrint, {
                business_name: currentTenant.business_name,
                currency,
              });
            }
          } catch {
            const finalCustomerObj = (generatedBill.order?.customer || data.order?.customer) || (customerName || customerPhone ? { name: customerName || '', phone: customerPhone || '' } : undefined);
            const billToPrint = {
              ...generatedBill,
              payment_method: chosenPaymentMethod,
              order: {
                ...(generatedBill.order || data.order),
                payment_method: chosenPaymentMethod,
                customer_name: data.order?.customer_name || customerName,
                customer_phone: data.order?.customer_phone || customerPhone,
                delivery_address: data.order?.delivery_address || deliveryAddress,
                customer: finalCustomerObj,
              },
            };
            if (autoPrintBill && currentTenant) {
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
          const finalCustomerObj = data.order?.customer || (customerName || customerPhone ? { name: customerName || '', phone: customerPhone || '' } : undefined);
          const orderForKot = {
            ...data.order,
            payment_method: chosenPaymentMethod,
            customer_name: data.order?.customer_name || customerName,
            customer_phone: data.order?.customer_phone || customerPhone,
            delivery_address: data.order?.delivery_address || deliveryAddress,
            customer: finalCustomerObj,
          };
          await printKot(orderForKot as Order);
        } catch {
          toast.error('KOT print failed — check printer connection');
        }
      }
    } catch (err: unknown) {
      console.error('Order placement error:', err);
      const error = err as { response?: { data?: { error?: string; message?: string } }; message?: string };
      const msg = error.response?.data?.message || error.response?.data?.error || error.message || 'Failed to place order';
      toast.error(msg);
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
