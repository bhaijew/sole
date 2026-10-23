'use client';

import { useState, useEffect } from 'react';
import { useAuthStore } from '@/store/auth';
import { usePosSettingsStore, type PaperSize, type BillTemplate } from '@/store/pos-settings';
import { usePrinterStore } from '@/hooks/usePrinter';
import { useSystemModeStore } from '@/store/system-mode';
import { Settings, Building2, Globe, CreditCard, Monitor, Users, Gift, Printer, Share2, FileText, Lock, Smartphone, RefreshCw, Copy, Check, Cloud, ShieldCheck, CheckCircle2, Plus, Trash2, X, Wifi } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import api from '@/lib/api';
import toast from 'react-hot-toast';

const CLASSIC_PREVIEW = `      PIZZA MAFIA
     Customer Copy
       Order #: 4
     Date: 9/9/2026
    Time: 3:31:04 PM
     Type: Takeaway
      Name: mubeen
--------------------------------
Item                Quantity  Price
--------------------------------
1L 7UP                     1    170
--------------------------------
         TOTAL: Rs 170
--------------------------------
EasyPaisa: 03001234567
Muhammad Ali
Complaint: 03121234567

          Thank You!`;

const COMPACT_PREVIEW = `  STORE NAME
-----------
Bill #1    12:30
-----------
Burger           99
  2 x 49.50
-----------
TOTAL            99
Cash             99
-----------
  Thank you!`;

const DETAILED_PREVIEW = `  [STORE NAME]
GSTIN: 22XXXXX
  TAX INVOICE
-----------
Bill#1   1 Jan 24
Cust: John
-----------
Item   Qty Rate Amt
Burger   1  99  99
-----------
Subtotal (excl.)  93
CGST @3%           3
SGST @3%           3
===============
TOTAL            99`;

interface TemplateCard {
  id: BillTemplate;
  name: string;
  description: string;
  preview: string;
}

const TEMPLATE_CARDS: TemplateCard[] = [
  { id: 'classic', name: 'Classic', description: 'Rich layout with 4-column item table, addon details, and full totals. Best for dine-in.', preview: CLASSIC_PREVIEW },
  { id: 'compact', name: 'Compact', description: 'Minimal, fast layout. One line per item. Ideal for quick service and takeaway.', preview: COMPACT_PREVIEW },
  { id: 'detailed', name: 'Detailed (GST)', description: 'Full GST compliance with GSTIN header, TAX INVOICE label, and per-rate tax breakdown.', preview: DETAILED_PREVIEW },
];

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      className={`relative w-11 h-6 rounded-full transition-colors ${value ? 'bg-brand' : 'bg-gray-300'}`}
    >
      <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${value ? 'translate-x-5' : 'translate-x-0'}`} />
    </button>
  );
}

export default function SettingsPage() {
  const { currentTenant, user } = useAuthStore();
  const posSettings = usePosSettingsStore();
  const { printMethod, setPrintMethod } = usePrinterStore();
  const isAdmin = currentTenant?.role === 'admin' || currentTenant?.role === 'owner';

  const [loyaltyDays, setLoyaltyDays] = useState(365);
  const [savingLoyalty, setSavingLoyalty] = useState(false);

  // Mobile App Pairing
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [pairingRotatedAt, setPairingRotatedAt] = useState<string | null>(null);
  const [rotatingCode, setRotatingCode] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  // Pizza System Cloud Sync State
  const [cloudStatus, setCloudStatus] = useState({
    configured: true,
    connected: false,
    isRealtimeActive: false,
    syncEnabled: true,
    autoPrintKot: true,
    supabaseUrl: 'https://uadrrjrlhfttithjmdye.supabase.co',
    lastSync: '',
    operatingMode: 'integrated' as 'integrated' | 'standalone',
    isPizzaIntegrated: true,
    currentShopId: '3',
    currentShopName: 'Pizza Crust - Master Branch',
    currentShopSlug: 'pizza-crust-main',
  });
  const [cloudShops, setCloudShops] = useState<Array<{ id: number; name: string; slug: string; owner_name: string; status: string; currency_symbol: string }>>([]);
  const [selectedShopId, setSelectedShopId] = useState<string>('3');
  const [switchingShop, setSwitchingShop] = useState(false);
  const [testingCloud, setTestingCloud] = useState(false);
  const [syncingMenu, setSyncingMenu] = useState(false);
  const [syncingStaff, setSyncingStaff] = useState(false);
  const [syncingPending, setSyncingPending] = useState(false);
  const { setOperatingMode: setStoreOperatingMode, fetchMode: fetchGlobalMode } = useSystemModeStore();

  const fetchCloudStatus = async () => {
    try {
      const res = await api.get('/cloud-sync/status');
      if (res.data?.success) {
        setCloudStatus((prev) => ({ ...prev, ...res.data }));
        if (res.data.currentShopId) {
          setSelectedShopId(String(res.data.currentShopId));
        }
      }
    } catch {
      // background fetch error ignored
    }
  };

  const fetchCloudShops = async () => {
    try {
      const res = await api.get('/cloud-sync/shops');
      if (res.data?.success && res.data.shops) {
        setCloudShops(res.data.shops);
        if (res.data.currentShopId) {
          setSelectedShopId(String(res.data.currentShopId));
        }
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    fetchCloudStatus();
    fetchCloudShops();
  }, []);

  const handleSwitchBranch = async (shopIdToSelect: string | number) => {
    if (!shopIdToSelect) return;
    try {
      setSwitchingShop(true);
      const res = await api.post('/cloud-sync/select-shop', { shop_id: shopIdToSelect });
      if (res.data?.success) {
        toast.success(res.data.message || 'Branch switched successfully!');
        setSelectedShopId(String(shopIdToSelect));
        fetchCloudStatus();
        fetchCloudShops();
      } else {
        toast.error(res.data?.message || 'Failed to switch branch');
      }
    } catch (err: any) {
      toast.error('Branch switch error: ' + (err.response?.data?.message || err.message));
    } finally {
      setSwitchingShop(false);
    }
  };

  const testCloudConnection = async () => {
    try {
      setTestingCloud(true);
      const res = await api.post('/cloud-sync/test');
      if (res.data?.success) {
        toast.success(res.data.message || 'Connected to Pizza System!');
        setCloudStatus((prev) => ({ ...prev, connected: true }));
      } else {
        toast.error(res.data?.message || 'Connection failed');
        setCloudStatus((prev) => ({ ...prev, connected: false }));
      }
    } catch (err: any) {
      toast.error('Connection test failed: ' + (err.response?.data?.error || err.message));
    } finally {
      setTestingCloud(false);
    }
  };

  const handleManualMenuSync = async () => {
    try {
      setSyncingMenu(true);
      const res = await api.post('/cloud-sync/sync-menu');
      if (res.data?.success) {
        toast.success(res.data.message || 'Menu synced successfully!');
        fetchCloudStatus();
      } else {
        toast.error(res.data?.message || 'Menu sync failed');
      }
    } catch (err: any) {
      toast.error('Menu sync error: ' + (err.response?.data?.message || err.message));
    } finally {
      setSyncingMenu(false);
    }
  };

  const handleManualStaffSync = async () => {
    try {
      setSyncingStaff(true);
      const res = await api.post('/cloud-sync/sync-staff');
      if (res.data?.success) {
        toast.success(res.data.message || 'Staff synced from Pizza Management!');
        fetchCloudStatus();
      } else {
        toast.error(res.data?.message || 'Staff sync failed');
      }
    } catch (err: any) {
      toast.error('Staff sync error: ' + (err.response?.data?.message || err.message));
    } finally {
      setSyncingStaff(false);
    }
  };

  const handlePushOfflineOrders = async () => {
    try {
      setSyncingPending(true);
      const res = await api.post('/cloud-sync/sync-pending');
      if (res.data?.success) {
        toast.success(res.data.message || 'Offline orders pushed to cloud!');
        fetchCloudStatus();
      } else {
        toast.error('Failed to sync offline orders');
      }
    } catch (err: any) {
      toast.error('Offline orders sync error: ' + (err.response?.data?.error || err.message));
    } finally {
      setSyncingPending(false);
    }
  };

  const handleOperatingModeChange = async (mode: 'integrated' | 'standalone') => {
    try {
      await setStoreOperatingMode(mode);
      setCloudStatus((prev) => ({
        ...prev,
        operatingMode: mode,
        isPizzaIntegrated: mode === 'integrated' && prev.syncEnabled,
      }));
      toast.success(`Switched to ${mode === 'integrated' ? 'Pizza Management Integrated' : 'Standalone POS'} mode`);
      fetchCloudStatus();
      fetchGlobalMode();
    } catch {
      toast.error('Failed to update operating mode');
    }
  };

  const updateCloudSetting = async (key: 'cloud_sync_enabled' | 'cloud_auto_print_kot', val: boolean) => {
    const updated = {
      ...cloudStatus,
      [key === 'cloud_sync_enabled' ? 'syncEnabled' : 'autoPrintKot']: val,
    };
    setCloudStatus(updated);

    try {
      await api.post('/cloud-sync/settings', {
        cloud_sync_enabled: key === 'cloud_sync_enabled' ? val : cloudStatus.syncEnabled,
        cloud_auto_print_kot: key === 'cloud_auto_print_kot' ? val : cloudStatus.autoPrintKot,
      });
      toast.success('Setting updated');
      fetchGlobalMode();
    } catch {
      toast.error('Failed to update setting');
      fetchCloudStatus();
    }
  };

  // Printing local state (buffered — saved only on explicit Save)
  type PrintingForm = {
    printerEnabled: boolean; printerPaperSize: PaperSize;
    printMethod: 'escpos' | 'browser';
    autoPrintKot: boolean; autoPrintBill: boolean;
    webPrintSize: PaperSize; whatsappShareEnabled: boolean;
    receiptCopies: 'customer' | 'both' | 'business';
    kitchenPrinterId: string;
  };
  const initPrinting = (): PrintingForm => ({
    printerEnabled: posSettings.printerEnabled,
    printerPaperSize: posSettings.printerPaperSize,
    printMethod: printMethod as 'escpos' | 'browser',
    autoPrintKot: posSettings.autoPrintKot,
    autoPrintBill: posSettings.autoPrintBill,
    webPrintSize: posSettings.webPrintSize,
    whatsappShareEnabled: posSettings.whatsappShareEnabled,
    receiptCopies: 'customer',
    kitchenPrinterId: '',
  });
  const [printingForm, setPrintingForm] = useState<PrintingForm>(initPrinting);
  const [savedPrinting, setSavedPrinting] = useState<PrintingForm>(initPrinting);
  const savePrinting = async () => {
    posSettings.setPrinterEnabled(printingForm.printerEnabled);
    posSettings.setPrinterPaperSize(printingForm.printerPaperSize);
    setPrintMethod(printingForm.printMethod);
    posSettings.setAutoPrintKot(printingForm.autoPrintKot);
    posSettings.setAutoPrintBill(printingForm.autoPrintBill);
    posSettings.setWebPrintSize(printingForm.webPrintSize);
    posSettings.setWhatsappShareEnabled(printingForm.whatsappShareEnabled);
    try {
      await api.put('/settings/receipt_copies', { value: printingForm.receiptCopies });
      if (printingForm.kitchenPrinterId) {
        await api.post(`/printers/${printingForm.kitchenPrinterId}/set-kitchen`);
      }
    } catch {}
    setSavedPrinting(printingForm);
    toast.success('Printing settings saved');
  };
  const resetPrinting = () => setPrintingForm(savedPrinting);

  // Hardware thermal printers state
  const [hardwarePrinters, setHardwarePrinters] = useState<any[]>([]);
  const [detectingPrinters, setDetectingPrinters] = useState(false);
  const [testingPrinterId, setTestingPrinterId] = useState<string | null>(null);
  const [showAddPrinter, setShowAddPrinter] = useState(false);
  const [savingCustomPrinter, setSavingCustomPrinter] = useState(false);
  const [customPrinterForm, setCustomPrinterForm] = useState({
    name: '',
    connection_type: 'network' as 'network' | 'usb',
    ip_address: '',
    port: 9100,
    paper_width: '80mm' as '58mm' | '80mm',
    is_default: false,
  });

  const fetchHardwarePrinters = async () => {
    try {
      const res = await api.get('/printers');
      const printersList = res.data?.printers || [];
      setHardwarePrinters(printersList);
      if (res.data?.receipt_copies) {
        setPrintingForm((p) => ({ ...p, receiptCopies: res.data.receipt_copies }));
        setSavedPrinting((p) => ({ ...p, receiptCopies: res.data.receipt_copies }));
      }
      if (res.data?.kitchen_printer_id) {
        setPrintingForm((p) => ({ ...p, kitchenPrinterId: res.data.kitchen_printer_id }));
        setSavedPrinting((p) => ({ ...p, kitchenPrinterId: res.data.kitchen_printer_id }));
      }
    } catch {}
  };

  const handleDetectHardwarePrinters = async () => {
    setDetectingPrinters(true);
    try {
      const res = await api.get('/printers/detect');
      const updated = res.data?.printers || [];
      const detected = res.data?.detected || [];
      setHardwarePrinters(updated);
      const active = updated.find((p: any) => p.is_default === 1);
      toast.success(`Found ${detected.length} printer(s) on this PC.${active ? ' Active: ' + active.name : ''}`);
      await usePrinterStore.getState().refreshBackendPrinter();
    } catch (err: any) {
      toast.error('Detection failed: ' + (err.response?.data?.error || err.message || 'Error'));
    } finally {
      setDetectingPrinters(false);
    }
  };

  const handleTestHardwarePrinter = async (id: string) => {
    setTestingPrinterId(id);
    try {
      const res = await api.post(`/printers/${id}/test`);
      if (res.data?.success) {
        toast.success(res.data?.message || 'Test receipt printed successfully!');
      } else {
        toast.error(res.data?.error || 'Test print failed');
      }
    } catch (err: any) {
      toast.error('Test print failed: ' + (err.response?.data?.error || err.message));
    } finally {
      setTestingPrinterId(null);
    }
  };

  const handleSetDefaultPrinter = async (id: string) => {
    try {
      await api.post(`/printers/${id}/set-default`);
      toast.success('Counter bill printer updated');
      await fetchHardwarePrinters();
      await usePrinterStore.getState().refreshBackendPrinter();
    } catch (err: any) {
      toast.error('Failed to set counter printer: ' + (err.message || 'Error'));
    }
  };

  const handleSetKitchenPrinter = async (id: string) => {
    try {
      await api.post(`/printers/${id}/set-kitchen`);
      toast.success('Dedicated kitchen printer updated');
      setPrintingForm((p) => ({ ...p, kitchenPrinterId: id }));
      setSavedPrinting((p) => ({ ...p, kitchenPrinterId: id }));
      await fetchHardwarePrinters();
    } catch (err: any) {
      toast.error('Failed to set kitchen printer: ' + (err.message || 'Error'));
    }
  };

  const handleRemoveKitchenPrinter = async (id: string) => {
    try {
      await api.post(`/printers/${id}/remove-kitchen`);
      toast.success('Kitchen printer role removed');
      setPrintingForm((p) => ({ ...p, kitchenPrinterId: '' }));
      setSavedPrinting((p) => ({ ...p, kitchenPrinterId: '' }));
      await fetchHardwarePrinters();
    } catch (err: any) {
      toast.error('Failed to remove kitchen printer: ' + (err.message || 'Error'));
    }
  };

  const handleUpdatePaperWidth = async (id: string, width: '58mm' | '80mm') => {
    try {
      await api.put(`/printers/${id}`, { paper_width: width });
      toast.success(`Paper width updated to ${width}`);
      await fetchHardwarePrinters();
      await usePrinterStore.getState().refreshBackendPrinter();
    } catch (err: any) {
      toast.error('Failed to update paper width: ' + (err.message || 'Error'));
    }
  };

  const handleDeletePrinter = async (id: string) => {
    if (!confirm('Are you sure you want to delete this printer?')) return;
    try {
      await api.delete(`/printers/${id}`);
      toast.success('Printer removed');
      await fetchHardwarePrinters();
      await usePrinterStore.getState().refreshBackendPrinter();
    } catch (err: any) {
      toast.error('Failed to remove printer: ' + (err.message || 'Error'));
    }
  };

  const handleAddCustomPrinter = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customPrinterForm.name.trim()) {
      toast.error('Printer name is required');
      return;
    }
    if (customPrinterForm.connection_type === 'network' && !customPrinterForm.ip_address.trim()) {
      toast.error('IP address is required for network printers');
      return;
    }
    setSavingCustomPrinter(true);
    try {
      await api.post('/printers', customPrinterForm);
      toast.success('Printer added successfully');
      setShowAddPrinter(false);
      setCustomPrinterForm({
        name: '',
        connection_type: 'network',
        ip_address: '',
        port: 9100,
        paper_width: '80mm',
        is_default: false,
      });
      await fetchHardwarePrinters();
      await usePrinterStore.getState().refreshBackendPrinter();
    } catch (err: any) {
      toast.error('Failed to add printer: ' + (err.response?.data?.error || err.message));
    } finally {
      setSavingCustomPrinter(false);
    }
  };

  // Bill template local state
  type BillTemplateForm = {
    billTemplate: BillTemplate;
    billFooterMessage: string;
    easypaisaNumber: string;
    easypaisaTitle: string;
    complaintNumber: string;
  };
  const initBillTemplate = (): BillTemplateForm => ({
    billTemplate: posSettings.billTemplate,
    billFooterMessage: posSettings.billFooterMessage,
    easypaisaNumber: posSettings.easypaisaNumber || '',
    easypaisaTitle: posSettings.easypaisaTitle || '',
    complaintNumber: posSettings.complaintNumber || '',
  });
  const [billForm, setBillForm] = useState<BillTemplateForm>(initBillTemplate);
  const [savedBillForm, setSavedBillForm] = useState<BillTemplateForm>(initBillTemplate);
  const saveBillTemplate = async () => {
    posSettings.setBillTemplate(billForm.billTemplate);
    posSettings.setBillFooterMessage(billForm.billFooterMessage);
    posSettings.setEasypaisaNumber(billForm.easypaisaNumber);
    posSettings.setEasypaisaTitle(billForm.easypaisaTitle);
    posSettings.setComplaintNumber(billForm.complaintNumber);

    try {
      await api.put('/settings/bill_template', { value: billForm.billTemplate }).catch(() => {});
      await api.put('/settings/bill_footer_message', { value: billForm.billFooterMessage }).catch(() => {});
      await api.put('/settings/easypaisa_number', { value: billForm.easypaisaNumber }).catch(() => {});
      await api.put('/settings/easypaisa_title', { value: billForm.easypaisaTitle }).catch(() => {});
      await api.put('/settings/complaint_number', { value: billForm.complaintNumber }).catch(() => {});
    } catch {}

    setSavedBillForm(billForm);
    toast.success('Bill template saved');
  };
  const resetBillTemplate = () => setBillForm(savedBillForm);

  // Store / business fields — local form state (saved only on explicit Save)
  type BusinessForm = {
    businessName: string; timezone: string; currency: string;
    gstin: string; businessAddress: string; businessPhone: string;
    billShowName: boolean; billShowAddress: boolean; billShowPhone: boolean; billShowGstn: boolean;
  };
  const [savedBusiness, setSavedBusiness] = useState<BusinessForm>({
    businessName: '', timezone: '', currency: '', gstin: '',
    businessAddress: '', businessPhone: '',
    billShowName: true, billShowAddress: true, billShowPhone: true, billShowGstn: false,
  });
  const [form, setForm] = useState<BusinessForm>(savedBusiness);
  const [savingBusiness, setSavingBusiness] = useState(false);

  const resetBusiness = () => setForm(savedBusiness);

  useEffect(() => {
    api.get('/settings/tax').then((res) => {
      if (res.data.loyalty_expiry_days) setLoyaltyDays(Number(res.data.loyalty_expiry_days));
    }).catch(() => {});

    api.get('/mobile/pairing-code').then((res) => {
      setPairingCode(res.data.pairing_code);
      setPairingRotatedAt(res.data.rotated_at);
    }).catch(() => {});

    api.get('/settings/business').then((res) => {
      const d = res.data;
      const loaded: BusinessForm = {
        businessName: d.business_name || '',
        timezone: d.timezone || '',
        currency: d.currency || '',
        gstin: d.gstin || '',
        businessAddress: d.business_address || '',
        businessPhone: d.business_phone || '',
        billShowName: typeof d.bill_show_name === 'boolean' ? d.bill_show_name : true,
        billShowAddress: typeof d.bill_show_address === 'boolean' ? d.bill_show_address : true,
        billShowPhone: typeof d.bill_show_phone === 'boolean' ? d.bill_show_phone : true,
        billShowGstn: typeof d.bill_show_gstn === 'boolean' ? d.bill_show_gstn : false,
      };
      setSavedBusiness(loaded);
      setForm(loaded);
      // Sync to pos-settings store for bill printing
      posSettings.setBillShowName(loaded.billShowName);
      posSettings.setBillShowAddress(loaded.billShowAddress);
      posSettings.setBillShowPhone(loaded.billShowPhone);
      posSettings.setBillShowGstn(loaded.billShowGstn);
      if (d.gstin) posSettings.setBillGstin(d.gstin);
      if (d.business_address) posSettings.setBillAddress(d.business_address);
      if (d.business_phone) posSettings.setBillPhone(d.business_phone);
    }).catch(() => {});

    fetchHardwarePrinters();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveLoyalty = async () => {
    setSavingLoyalty(true);
    try {
      await api.put('/settings/loyalty', { loyalty_expiry_days: loyaltyDays });
      toast.success('Loyalty settings saved');
    } catch {
      toast.error('Failed to save');
    } finally {
      setSavingLoyalty(false);
    }
  };

  const saveBusinessInfo = async () => {
    setSavingBusiness(true);
    try {
      await api.put('/settings/business', {
        business_name: form.businessName,
        timezone: form.timezone,
        currency: form.currency,
        gstin: form.gstin,
        business_address: form.businessAddress,
        business_phone: form.businessPhone,
        bill_show_name: form.billShowName,
        bill_show_address: form.billShowAddress,
        bill_show_phone: form.billShowPhone,
        bill_show_gstn: form.billShowGstn,
      });
      setSavedBusiness(form);
      posSettings.setBillGstin(form.gstin);
      posSettings.setBillAddress(form.businessAddress);
      posSettings.setBillPhone(form.businessPhone);
      posSettings.setBillShowName(form.billShowName);
      posSettings.setBillShowAddress(form.billShowAddress);
      posSettings.setBillShowPhone(form.billShowPhone);
      posSettings.setBillShowGstn(form.billShowGstn);
      toast.success('Store details saved');
    } catch {
      toast.error('Failed to save');
    } finally {
      setSavingBusiness(false);
    }
  };

  const rotatePairingCode = async () => {
    setRotatingCode(true);
    try {
      const res = await api.post('/mobile/rotate-code');
      setPairingCode(res.data.pairing_code);
      setPairingRotatedAt(res.data.rotated_at);
      toast.success('New pairing code generated');
    } catch {
      toast.error('Failed to generate code');
    } finally {
      setRotatingCode(false);
    }
  };

  const copyPairingCode = () => {
    if (!pairingCode) return;
    navigator.clipboard.writeText(pairingCode).then(() => {
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    });
  };

  const paperSizeOptions: { value: PaperSize; label: string }[] = [
    { value: 'thermal58', label: '2.5" (58mm)' },
    { value: 'thermal80', label: '3.5" (80mm)' },
    { value: 'a4', label: 'A4 Paper' },
    { value: 'a5', label: 'A5 Paper' },
  ];

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Settings size={28} className="text-brand" />
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
      </div>

      <Tabs defaultValue="general">
        <TabsList className="mb-6">
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="printing">Printing</TabsTrigger>
          <TabsTrigger value="bill-template">Bill Template</TabsTrigger>
          <TabsTrigger value="cloud-sync">Cloud Sync (Pizza System)</TabsTrigger>
        </TabsList>

        {/* ================================================================
            TAB: General
        ================================================================ */}
        <TabsContent value="general">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

            {/* Store Details — editable for admin, readonly otherwise */}
            <div className="lg:col-span-2 bg-white rounded-xl border border-gray-100 p-6">
              <div className="flex items-center gap-2 mb-4">
                <Building2 size={20} className="text-gray-500" />
                <h2 className="font-semibold text-gray-900">Store Details</h2>
                {!isAdmin && (
                  <span className="ml-auto flex items-center gap-1 text-xs text-gray-400">
                    <Lock size={12} /> Admin only
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-500 mb-1">Business Name</label>
                  {isAdmin ? (
                    <input type="text" value={form.businessName} onChange={(e) => setForm((p) => ({ ...p, businessName: e.target.value }))}
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-brand" />
                  ) : (
                    <p className="font-medium text-gray-900">{form.businessName || currentTenant?.business_name}</p>
                  )}
                </div>
                <div>
                  <label className="block text-sm text-gray-500 mb-1">Currency</label>
                  {isAdmin ? (
                    <input type="text" value={form.currency} onChange={(e) => setForm((p) => ({ ...p, currency: e.target.value }))}
                      placeholder="INR / THB / USD"
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-brand" />
                  ) : (
                    <p className="font-medium text-gray-900">{form.currency || currentTenant?.currency}</p>
                  )}
                </div>
                <div>
                  <label className="block text-sm text-gray-500 mb-1">Timezone</label>
                  {isAdmin ? (
                    <input type="text" value={form.timezone} onChange={(e) => setForm((p) => ({ ...p, timezone: e.target.value }))}
                      placeholder="Asia/Kolkata"
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-brand" />
                  ) : (
                    <p className="font-medium text-gray-900">{form.timezone || currentTenant?.timezone}</p>
                  )}
                </div>
                <div>
                  <label className="block text-sm text-gray-500 mb-1">GSTIN Number</label>
                  {isAdmin ? (
                    <input type="text" value={form.gstin} onChange={(e) => setForm((p) => ({ ...p, gstin: e.target.value.toUpperCase() }))}
                      placeholder="22AAAAA0000A1Z5"
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-brand" />
                  ) : (
                    <p className="font-medium text-gray-900">{form.gstin || '—'}</p>
                  )}
                </div>
                <div>
                  <label className="block text-sm text-gray-500 mb-1">Phone</label>
                  {isAdmin ? (
                    <input type="text" value={form.businessPhone} onChange={(e) => setForm((p) => ({ ...p, businessPhone: e.target.value }))}
                      placeholder="+91 9876543210"
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-brand" />
                  ) : (
                    <p className="font-medium text-gray-900">{form.businessPhone || '—'}</p>
                  )}
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm text-gray-500 mb-1">Address</label>
                  {isAdmin ? (
                    <textarea value={form.businessAddress} onChange={(e) => setForm((p) => ({ ...p, businessAddress: e.target.value }))}
                      rows={2} placeholder="123 Main Street, City, State - 123456"
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-brand resize-none" />
                  ) : (
                    <p className="font-medium text-gray-900">{form.businessAddress || '—'}</p>
                  )}
                </div>
              </div>

              {/* Bill display toggles */}
              <div className="mt-5 pt-5 border-t border-gray-100">
                <p className="text-sm font-semibold text-gray-700 mb-3">Show on Invoice</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {([
                    { label: 'Business Name', key: 'billShowName' as const },
                    { label: 'Address', key: 'billShowAddress' as const },
                    { label: 'Phone Number', key: 'billShowPhone' as const },
                    { label: 'GSTIN Number', key: 'billShowGstn' as const },
                  ] as const).map((item) => (
                    <div key={item.key} className="flex items-center justify-between py-2">
                      <span className="text-sm text-gray-700">{item.label}</span>
                      <Toggle
                        value={form[item.key]}
                        onChange={isAdmin ? (v) => setForm((p) => ({ ...p, [item.key]: v })) : () => {}}
                      />
                    </div>
                  ))}
                </div>
              </div>

              {isAdmin && (
                <div className="mt-4 flex gap-2">
                  <button onClick={saveBusinessInfo} disabled={savingBusiness}
                    className="px-5 py-2 text-sm bg-brand text-white rounded-lg hover:opacity-90 disabled:opacity-50 font-medium">
                    {savingBusiness ? 'Saving...' : 'Save'}
                  </button>
                  <button onClick={resetBusiness} disabled={savingBusiness}
                    className="px-5 py-2 text-sm border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50 font-medium">
                    Cancel
                  </button>
                </div>
              )}
            </div>

            {/* Subscription */}
            <div className="bg-white rounded-xl border border-gray-100 p-6">
              <div className="flex items-center gap-2 mb-4">
                <CreditCard size={20} className="text-gray-500" />
                <h2 className="font-semibold text-gray-900">Subscription</h2>
              </div>
              <div className="space-y-3">
                <div>
                  <p className="text-sm text-gray-500">Plan</p>
                  <p className="font-medium text-gray-900 capitalize">{currentTenant?.plan}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Status</p>
                  <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                    currentTenant?.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                  }`}>
                    {currentTenant?.status}
                  </span>
                </div>
              </div>
            </div>

            {/* POS Display */}
            <div className="bg-white rounded-xl border border-gray-100 p-6">
              <div className="flex items-center gap-2 mb-4">
                <Monitor size={20} className="text-gray-500" />
                <h2 className="font-semibold text-gray-900">POS Display</h2>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-900">Show Product Images</p>
                  <p className="text-sm text-gray-500">Display product images in the POS grid</p>
                </div>
                <Toggle value={posSettings.showProductImages} onChange={posSettings.setShowProductImages} />
              </div>
            </div>

            {/* POS Workflow */}
            <div className="bg-white rounded-xl border border-gray-100 p-6">
              <div className="flex items-center gap-2 mb-4">
                <Users size={20} className="text-gray-500" />
                <h2 className="font-semibold text-gray-900">POS Workflow</h2>
              </div>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-gray-900">Customer Mandatory</p>
                    <p className="text-sm text-gray-500">Require customer selection before placing an order</p>
                  </div>
                  <Toggle value={posSettings.customerMandatory} onChange={posSettings.setCustomerMandatory} />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <p className="font-medium text-gray-900">Phone Number Digits</p>
                      <p className="text-sm text-gray-500">Required digit count for phone validation (e.g. 10 for India)</p>
                    </div>
                  </div>
                  <input type="number" min={7} max={15} value={posSettings.phoneDigits}
                    onChange={(e) => posSettings.setPhoneDigits(parseInt(e.target.value) || 10)}
                    className="w-20 px-3 py-1.5 text-sm border border-gray-200 rounded-lg outline-none focus:ring-1 focus:ring-brand" />
                </div>
              </div>
            </div>

            {/* Loyalty */}
            <div className="bg-white rounded-xl border border-gray-100 p-6">
              <div className="flex items-center gap-2 mb-4">
                <Gift size={20} className="text-gray-500" />
                <h2 className="font-semibold text-gray-900">Loyalty Program</h2>
              </div>
              <div className="space-y-4">
                <div>
                  <p className="font-medium text-gray-900">Points Expiry</p>
                  <p className="text-sm text-gray-500 mb-2">Number of days before earned loyalty points expire</p>
                  <div className="flex items-center gap-3">
                    <input type="number" min={1} max={3650} value={loyaltyDays}
                      onChange={(e) => setLoyaltyDays(parseInt(e.target.value) || 365)}
                      className="w-24 px-3 py-1.5 text-sm border border-gray-200 rounded-lg outline-none focus:ring-1 focus:ring-brand" />
                    <span className="text-sm text-gray-500">days</span>
                    <button onClick={saveLoyalty} disabled={savingLoyalty}
                      className="px-4 py-1.5 text-sm bg-brand text-white rounded-lg hover:opacity-90 disabled:opacity-50">
                      {savingLoyalty ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Account */}
            <div className="bg-white rounded-xl border border-gray-100 p-6">
              <h2 className="font-semibold text-gray-900 mb-4">Account</h2>
              <div className="space-y-3">
                <div>
                  <p className="text-sm text-gray-500">Name</p>
                  <p className="font-medium text-gray-900">{user?.name}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Email</p>
                  <p className="font-medium text-gray-900">{user?.email}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Role</p>
                  <p className="font-medium text-gray-900 capitalize">{currentTenant?.role || '—'}</p>
                </div>
              </div>
            </div>

            {/* Mobile App */}
            <div className="bg-white rounded-xl border border-gray-100 p-6">
              <div className="flex items-center gap-2 mb-4">
                <Smartphone size={20} className="text-gray-500" />
                <h2 className="font-semibold text-gray-900">Mobile App</h2>
              </div>
              <p className="text-sm text-gray-500 mb-4">
                Connect the Flo mobile app to view reports and sales on your phone.
                Enter this code in the app to pair it with your account.
              </p>
              {pairingCode ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="flex-1 bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 text-center">
                      <span className="font-mono text-2xl font-bold tracking-[0.3em] text-gray-900">
                        {pairingCode}
                      </span>
                    </div>
                    <button
                      onClick={copyPairingCode}
                      className="p-2.5 border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-500"
                      title="Copy code"
                    >
                      {copiedCode ? <Check size={18} className="text-green-600" /> : <Copy size={18} />}
                    </button>
                  </div>
                  {pairingRotatedAt && (
                    <p className="text-xs text-gray-400">
                      Generated {new Date(pairingRotatedAt).toLocaleDateString()}
                    </p>
                  )}
                  <button
                    onClick={rotatePairingCode}
                    disabled={rotatingCode}
                    className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 disabled:opacity-50"
                  >
                    <RefreshCw size={14} className={rotatingCode ? 'animate-spin' : ''} />
                    {rotatingCode ? 'Generating...' : 'Generate new code'}
                  </button>
                  <p className="text-xs text-amber-600">
                    Generating a new code will disconnect all currently paired devices.
                  </p>
                </div>
              ) : (
                <button
                  onClick={rotatePairingCode}
                  disabled={rotatingCode}
                  className="px-5 py-2 text-sm bg-brand text-white rounded-lg hover:opacity-90 disabled:opacity-50 font-medium"
                >
                  {rotatingCode ? 'Generating...' : 'Generate Pairing Code'}
                </button>
              )}
            </div>
          </div>
        </TabsContent>

        {/* ================================================================
            TAB: Printing
        ================================================================ */}
        <TabsContent value="printing">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

            {/* Active Real Printer Hero Banner */}
            {(() => {
              const activePrinter = hardwarePrinters.find((p) => p.is_default === 1);
              const isOffline = activePrinter?.live_status === 'offline';
              return (
                <div className={`lg:col-span-2 rounded-2xl border p-5 shadow-sm transition-all ${
                  isOffline
                    ? 'bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent border-amber-300'
                    : 'bg-gradient-to-r from-emerald-500/10 via-emerald-500/5 to-transparent border-emerald-200'
                }`}>
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-start gap-3">
                      <div className={`p-3 text-white rounded-xl shadow-sm ${isOffline ? 'bg-amber-600' : 'bg-emerald-600'}`}>
                        <Printer size={24} />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className={`text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                            isOffline ? 'text-amber-800 bg-amber-100' : 'text-emerald-800 bg-emerald-100'
                          }`}>
                            Active POS Real Printer
                          </span>
                          {isOffline ? (
                            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700">
                              <span className="w-2 h-2 rounded-full bg-amber-500" /> Switched OFF (Turn switch ON to print)
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
                              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" /> Online & Ready
                            </span>
                          )}
                        </div>
                        <h3 className="text-xl font-bold text-gray-900 mt-1">
                          {activePrinter ? activePrinter.name : 'No Default Printer Selected'}
                        </h3>
                        <p className="text-xs text-gray-600 mt-0.5">
                          {activePrinter
                            ? `Connection: ${activePrinter.connection_type?.toUpperCase()} (Windows Spooler) • Paper Width: ${activePrinter.paper_width || '58mm'}`
                            : 'Click "Scan / Detect Printers" below to auto-connect your thermal printer.'}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {activePrinter && (
                        <button
                          type="button"
                          onClick={() => handleTestHardwarePrinter(activePrinter.id)}
                          disabled={testingPrinterId === activePrinter.id}
                          className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 text-white text-xs font-bold rounded-xl hover:bg-emerald-700 disabled:opacity-50 shadow-sm"
                        >
                          <Printer size={14} />
                          {testingPrinterId === activePrinter.id ? 'Printing...' : 'Test Print Active Printer'}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={handleDetectHardwarePrinters}
                        disabled={detectingPrinters}
                        className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-white border border-gray-300 text-gray-700 rounded-xl hover:bg-gray-50 disabled:opacity-50 shadow-sm"
                      >
                        <RefreshCw size={13} className={detectingPrinters ? 'animate-spin text-brand' : ''} />
                        {detectingPrinters ? 'Scanning...' : 'Scan / Detect Printers'}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Installed Hardware Printers Card */}
            <div className="lg:col-span-2 bg-white rounded-xl border border-gray-100 p-6 shadow-sm">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <Printer size={20} className="text-gray-700" />
                    <h2 className="font-bold text-gray-900 text-base">Connected Hardware Printers</h2>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Real USB & Network thermal printers detected on this computer. Select which one to use for POS receipts.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowAddPrinter((prev) => !prev)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50"
                  >
                    <Plus size={13} />
                    {showAddPrinter ? 'Close Form' : 'Add Network Printer'}
                  </button>
                  <button
                    type="button"
                    onClick={handleDetectHardwarePrinters}
                    disabled={detectingPrinters}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-brand text-white rounded-lg hover:opacity-90 disabled:opacity-50"
                  >
                    <RefreshCw size={13} className={detectingPrinters ? 'animate-spin' : ''} />
                    {detectingPrinters ? 'Scanning Windows...' : 'Scan Windows Printers'}
                  </button>
                </div>
              </div>

              {/* Add Custom Printer Sub-form */}
              {showAddPrinter && (
                <form onSubmit={handleAddCustomPrinter} className="mb-5 p-4 rounded-xl border border-blue-100 bg-blue-50/50 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold text-blue-900 uppercase tracking-wider flex items-center gap-1.5">
                      <Wifi size={14} /> Add Network or Thermal Printer
                    </h3>
                    <button type="button" onClick={() => setShowAddPrinter(false)} className="text-gray-400 hover:text-gray-600">
                      <X size={16} />
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Printer Name</label>
                      <input
                        type="text"
                        placeholder="e.g. Rongta 80mm Kitchen"
                        value={customPrinterForm.name}
                        onChange={(e) => setCustomPrinterForm((p) => ({ ...p, name: e.target.value }))}
                        className="w-full px-3 py-1.5 text-xs border border-gray-200 rounded-lg bg-white"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Connection Type</label>
                      <select
                        value={customPrinterForm.connection_type}
                        onChange={(e) => setCustomPrinterForm((p) => ({ ...p, connection_type: e.target.value as 'network' | 'usb' }))}
                        className="w-full px-3 py-1.5 text-xs border border-gray-200 rounded-lg bg-white"
                      >
                        <option value="network">Network (TCP/IP 9100)</option>
                        <option value="usb">USB Spooler</option>
                      </select>
                    </div>
                    {customPrinterForm.connection_type === 'network' && (
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">IP Address</label>
                        <input
                          type="text"
                          placeholder="e.g. 192.168.1.100"
                          value={customPrinterForm.ip_address}
                          onChange={(e) => setCustomPrinterForm((p) => ({ ...p, ip_address: e.target.value }))}
                          className="w-full px-3 py-1.5 text-xs border border-gray-200 rounded-lg bg-white"
                          required
                        />
                      </div>
                    )}
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Paper Width</label>
                      <select
                        value={customPrinterForm.paper_width}
                        onChange={(e) => setCustomPrinterForm((p) => ({ ...p, paper_width: e.target.value as '58mm' | '80mm' }))}
                        className="w-full px-3 py-1.5 text-xs border border-gray-200 rounded-lg bg-white"
                      >
                        <option value="58mm">58mm (2.5 inch)</option>
                        <option value="80mm">80mm (3.5 inch)</option>
                      </select>
                    </div>
                  </div>
                  <div className="flex justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setShowAddPrinter(false)}
                      className="px-3 py-1.5 text-xs text-gray-600 border border-gray-200 rounded-lg bg-white"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={savingCustomPrinter}
                      className="px-4 py-1.5 text-xs font-semibold bg-brand text-white rounded-lg hover:opacity-90 disabled:opacity-50"
                    >
                      {savingCustomPrinter ? 'Adding...' : 'Save Printer'}
                    </button>
                  </div>
                </form>
              )}

              {hardwarePrinters.length === 0 ? (
                <div className="text-center py-8 text-gray-400 text-sm border border-dashed rounded-xl space-y-2">
                  <Printer size={32} className="mx-auto text-gray-300" />
                  <p className="font-medium text-gray-600">No thermal printers configured yet</p>
                  <p className="text-xs text-gray-400">Click &quot;Scan Windows Printers&quot; above to auto-detect your Rongta or thermal printer.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {hardwarePrinters.map((p) => {
                    const isDefault = p.is_default === 1;
                    const paperWidth = p.paper_width || '58mm';
                    return (
                      <div
                        key={p.id}
                        className={`flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-xl border transition-all gap-3 ${
                          isDefault ? 'border-emerald-300 bg-emerald-50/30 shadow-xs' : 'border-gray-200 bg-white hover:border-gray-300'
                        }`}
                      >
                        <div className="flex items-start sm:items-center gap-3">
                          <div className={`p-2 rounded-lg ${isDefault ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>
                            <Printer size={18} />
                          </div>
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-bold text-gray-900 text-sm">{p.name}</span>
                              {isDefault && (
                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                                  <Check size={11} /> COUNTER BILL
                                </span>
                              )}
                              {p.is_kitchen === 1 && (
                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
                                  🍳 KITCHEN PRINTER (KOT)
                                </span>
                              )}
                              {p.live_status === 'offline' ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                                  🔴 Switched OFF / Offline
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                  🟢 Online
                                </span>
                              )}
                              <span className="text-[11px] font-medium text-gray-500 capitalize bg-gray-100 px-2 py-0.5 rounded">
                                {p.connection_type === 'network' ? `Network (${p.ip_address || 'IP'}:${p.port || 9100})` : 'USB Spooler'}
                              </span>
                            </div>
                            <p className="text-xs text-gray-400 mt-0.5">
                              Receipt formatting: {paperWidth === '58mm' ? '58mm / 32 cols' : '80mm / 48 cols'}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
                          {/* Paper Width Selector per printer */}
                          <div className="flex items-center gap-1 bg-gray-100 border border-gray-200 rounded-lg p-0.5">
                            <button
                              type="button"
                              onClick={() => handleUpdatePaperWidth(p.id, '58mm')}
                              className={`px-2 py-1 text-xs font-semibold rounded transition-all ${
                                paperWidth === '58mm'
                                  ? 'bg-white text-gray-900 shadow-xs'
                                  : 'text-gray-500 hover:text-gray-800'
                              }`}
                              title="Set paper size to 58mm"
                            >
                              58mm
                            </button>
                            <button
                              type="button"
                              onClick={() => handleUpdatePaperWidth(p.id, '80mm')}
                              className={`px-2 py-1 text-xs font-semibold rounded transition-all ${
                                paperWidth === '80mm'
                                  ? 'bg-white text-gray-900 shadow-xs'
                                  : 'text-gray-500 hover:text-gray-800'
                              }`}
                              title="Set paper size to 80mm"
                            >
                              80mm
                            </button>
                          </div>

                          {!isDefault && (
                            <button
                              type="button"
                              onClick={() => handleSetDefaultPrinter(p.id)}
                              className="px-3 py-1.5 text-xs font-semibold bg-gray-100 hover:bg-emerald-600 hover:text-white rounded-lg text-gray-700 transition-colors"
                              title="Set as active bill printer for checkout"
                            >
                              Set Counter
                            </button>
                          )}

                          {p.is_kitchen !== 1 ? (
                            <button
                              type="button"
                              onClick={() => handleSetKitchenPrinter(p.id)}
                              className="px-3 py-1.5 text-xs font-semibold bg-amber-50 hover:bg-amber-600 hover:text-white rounded-lg text-amber-800 border border-amber-200 transition-colors"
                              title="Set as dedicated kitchen printer for KOT tickets"
                            >
                              🍳 Set Kitchen
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleRemoveKitchenPrinter(p.id)}
                              className="px-3 py-1.5 text-xs font-semibold bg-gray-100 hover:bg-red-500 hover:text-white rounded-lg text-gray-600 transition-colors"
                              title="Remove kitchen printer assignment"
                            >
                              Unset Kitchen
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => handleTestHardwarePrinter(p.id)}
                            disabled={testingPrinterId === p.id}
                            className="px-3 py-1.5 text-xs font-semibold bg-brand text-white rounded-lg hover:opacity-90 disabled:opacity-50 flex items-center gap-1 shadow-xs"
                          >
                            <Printer size={12} />
                            {testingPrinterId === p.id ? 'Printing...' : 'Test Print'}
                          </button>

                          {!isDefault && hardwarePrinters.length > 1 && (
                            <button
                              type="button"
                              onClick={() => handleDeletePrinter(p.id)}
                              className="p-1.5 text-gray-400 hover:text-red-600 rounded-lg transition-colors"
                              title="Delete printer"
                            >
                              <Trash2 size={15} />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Print Options Card */}
            <div className="bg-white rounded-xl border border-gray-100 p-6 shadow-sm">
              <div className="flex items-center gap-2 mb-4">
                <Printer size={20} className="text-gray-500" />
                <h2 className="font-semibold text-gray-900">POS Print Options</h2>
              </div>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-gray-900">Enable Printer</p>
                    <p className="text-sm text-gray-500">Allow receipt and KOT printing from POS</p>
                  </div>
                  <Toggle value={printingForm.printerEnabled} onChange={(v) => setPrintingForm((p) => ({ ...p, printerEnabled: v }))} />
                </div>
                <div>
                  <p className="font-medium text-gray-900 mb-2">Receipt Print Copies</p>
                  <select
                    value={printingForm.receiptCopies}
                    onChange={(e) => setPrintingForm((p) => ({ ...p, receiptCopies: e.target.value as any }))}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-brand font-medium"
                  >
                    <option value="customer">Customer Copy Only (1 Slip - Saves Paper & Recommended)</option>
                    <option value="both">Both Copies (1 Customer Copy + 1 Business Copy)</option>
                    <option value="business">Business Copy Only (1 Slip)</option>
                  </select>
                  <p className="text-xs text-gray-500 mt-1">
                    {printingForm.receiptCopies === 'customer'
                      ? 'Only 1 customer bill will be printed upon checkout.'
                      : 'Prints two separate slips with auto-cut for customer and shop records.'}
                  </p>
                </div>
                <div>
                  <p className="font-medium text-gray-900 mb-2">Dedicated Kitchen Printer (KOT)</p>
                  <select
                    value={printingForm.kitchenPrinterId || (hardwarePrinters.find((p) => p.is_kitchen === 1)?.id || '')}
                    onChange={(e) => {
                      const val = e.target.value;
                      setPrintingForm((p) => ({ ...p, kitchenPrinterId: val }));
                      if (val) {
                        handleSetKitchenPrinter(val);
                      } else {
                        const currentKitchen = hardwarePrinters.find((p) => p.is_kitchen === 1);
                        if (currentKitchen) handleRemoveKitchenPrinter(currentKitchen.id);
                      }
                    }}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-brand"
                  >
                    <option value="">Default (Same as Counter Printer)</option>
                    {hardwarePrinters.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.connection_type === 'network' ? `Network ${p.ip_address}` : 'USB'}) {p.is_default ? '— Counter Default' : ''}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-500 mt-1">
                    Kitchen tickets (KOT) will automatically print to this printer. If not set, tickets print to the counter printer.
                  </p>
                </div>
                <div>
                  <p className="font-medium text-gray-900 mb-2">Default Paper Size</p>
                  <select
                    value={printingForm.printerPaperSize}
                    onChange={(e) => setPrintingForm((p) => ({ ...p, printerPaperSize: e.target.value as PaperSize }))}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-brand"
                  >
                    {paperSizeOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <p className="font-medium text-gray-900 mb-2">Print Method</p>
                  <select
                    value={printingForm.printMethod}
                    onChange={(e) => setPrintingForm((p) => ({ ...p, printMethod: e.target.value as 'escpos' | 'browser' }))}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-brand"
                  >
                    <option value="escpos">ESC/POS Thermal (Silent Raw Spooler - Recommended)</option>
                    <option value="browser">Browser Print Dialog (Standard A4/A5)</option>
                  </select>
                  <p className="text-xs text-gray-500 mt-1">
                    {printingForm.printMethod === 'escpos'
                      ? 'Direct silent printing to your thermal receipt printer via Windows Spooler (no popups).'
                      : 'Opens the standard print dialog — useful for laser/office printers.'}
                  </p>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-gray-900">Auto-print KOT</p>
                    <p className="text-sm text-gray-500">Print Kitchen Order Ticket when order is placed</p>
                  </div>
                  <Toggle value={printingForm.autoPrintKot} onChange={(v) => setPrintingForm((p) => ({ ...p, autoPrintKot: v }))} />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-gray-900">Auto-print Bill</p>
                    <p className="text-sm text-gray-500">Print customer bill when payment is completed</p>
                  </div>
                  <Toggle value={printingForm.autoPrintBill} onChange={(v) => setPrintingForm((p) => ({ ...p, autoPrintBill: v }))} />
                </div>
                <div>
                  <p className="font-medium text-gray-900 mb-2">Web Print Size (A4/A5)</p>
                  <select
                    value={printingForm.webPrintSize}
                    onChange={(e) => setPrintingForm((p) => ({ ...p, webPrintSize: e.target.value as PaperSize }))}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-brand"
                  >
                    <option value="a4">A4 (Default)</option>
                    <option value="a5">A5</option>
                  </select>
                </div>
              </div>
            </div>

            {/* WhatsApp Sharing Card */}
            <div className="bg-white rounded-xl border border-gray-100 p-6 shadow-sm">
              <div className="flex items-center gap-2 mb-4">
                <Share2 size={20} className="text-gray-500" />
                <h2 className="font-semibold text-gray-900">WhatsApp Sharing</h2>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-900">Enable WhatsApp Share</p>
                  <p className="text-sm text-gray-500">Send bill details via WhatsApp after payment</p>
                </div>
                <Toggle value={printingForm.whatsappShareEnabled} onChange={(v) => setPrintingForm((p) => ({ ...p, whatsappShareEnabled: v }))} />
              </div>
            </div>
          </div>

          {/* Printing tab Save/Cancel */}
          <div className="mt-6 flex gap-2">
            <button onClick={savePrinting} className="px-5 py-2 text-sm bg-brand text-white rounded-lg hover:opacity-90 font-medium shadow-sm">Save Preferences</button>
            <button onClick={resetPrinting} className="px-5 py-2 text-sm border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50 font-medium">Reset</button>
          </div>
        </TabsContent>

        {/* ================================================================
            TAB: Bill Template
        ================================================================ */}
        <TabsContent value="bill-template">
          <div className="space-y-6">
            <div className="bg-white rounded-xl border border-gray-100 p-6">
              <div className="flex items-center gap-2 mb-4">
                <FileText size={20} className="text-gray-500" />
                <h2 className="font-semibold text-gray-900">Choose Template</h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {TEMPLATE_CARDS.map((card) => {
                  const isSelected = billForm.billTemplate === card.id;
                  return (
                    <button key={card.id} onClick={() => setBillForm((p) => ({ ...p, billTemplate: card.id }))}
                      className={`text-left rounded-xl border-2 p-4 transition-all ${
                        isSelected ? 'border-brand bg-brand/5' : 'border-gray-200 hover:border-gray-300 bg-white'
                      }`}>
                      <p className="font-semibold text-gray-900 mb-2">{card.name}</p>
                      <pre className="font-mono text-[9px] leading-tight text-gray-600 bg-gray-50 p-2 rounded overflow-hidden mb-3 whitespace-pre">
                        {card.preview}
                      </pre>
                      <p className="text-xs text-gray-500">{card.description}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-100 p-6">
              <h2 className="font-semibold text-gray-900 mb-4">Footer Message</h2>
              <div>
                <label htmlFor="footer-message" className="block text-sm font-medium text-gray-700 mb-1">Footer Message</label>
                <textarea id="footer-message" rows={2}
                  placeholder="e.g. Thank you for visiting!"
                  value={billForm.billFooterMessage}
                  onChange={(e) => setBillForm((p) => ({ ...p, billFooterMessage: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-brand resize-none" />
                <p className="text-xs text-gray-400 mt-1">Printed at the bottom of every bill</p>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-100 p-6">
              <h2 className="font-semibold text-gray-900 mb-4">Receipt Payment & Contact Information</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label htmlFor="easypaisa-number" className="block text-sm font-medium text-gray-700 mb-1">EasyPaisa Account Number</label>
                  <input
                    id="easypaisa-number"
                    type="text"
                    placeholder="e.g. 03001234567"
                    value={billForm.easypaisaNumber}
                    onChange={(e) => setBillForm((p) => ({ ...p, easypaisaNumber: e.target.value }))}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-brand"
                  />
                  <p className="text-xs text-gray-400 mt-1">Displayed as EasyPaisa: [number]</p>
                </div>
                <div>
                  <label htmlFor="easypaisa-title" className="block text-sm font-medium text-gray-700 mb-1">Account Holder Name</label>
                  <input
                    id="easypaisa-title"
                    type="text"
                    placeholder="e.g. Muhammad Ali"
                    value={billForm.easypaisaTitle}
                    onChange={(e) => setBillForm((p) => ({ ...p, easypaisaTitle: e.target.value }))}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-brand"
                  />
                  <p className="text-xs text-gray-400 mt-1">Displayed directly below EasyPaisa</p>
                </div>
                <div>
                  <label htmlFor="complaint-number" className="block text-sm font-medium text-gray-700 mb-1">Complaint / Contact Number</label>
                  <input
                    id="complaint-number"
                    type="text"
                    placeholder="e.g. 03121234567"
                    value={billForm.complaintNumber}
                    onChange={(e) => setBillForm((p) => ({ ...p, complaintNumber: e.target.value }))}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-brand"
                  />
                  <p className="text-xs text-gray-400 mt-1">Displayed as Complaint: [number]</p>
                </div>
              </div>
            </div>
          </div>

          {/* Bill Template tab Save/Cancel */}
          <div className="mt-6 flex gap-2">
            <button onClick={saveBillTemplate} className="px-5 py-2 text-sm bg-brand text-white rounded-lg hover:opacity-90 font-medium">Save</button>
            <button onClick={resetBillTemplate} className="px-5 py-2 text-sm border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50 font-medium">Cancel</button>
          </div>
        </TabsContent>

        {/* ================================================================
            TAB: Cloud Sync (Pizza System / Supabase)
        ================================================================ */}
        <TabsContent value="cloud-sync">
          <div className="max-w-4xl space-y-6">
            {/* Status Card */}
            <div className="bg-white rounded-xl border border-gray-100 p-6 shadow-sm">
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <Cloud className="text-orange-500" size={24} />
                    <h2 className="text-lg font-bold text-gray-900">Pizza System Cloud Integration</h2>
                  </div>
                  <p className="text-sm text-gray-500 mt-1">
                    Connect FloDesktop with your online Pizza System (Supabase) for real-time menu sync and auto-printing online orders.
                  </p>
                </div>
                <div>
                  <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${
                    cloudStatus.connected ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-amber-50 text-amber-700 border border-amber-200'
                  }`}>
                    <span className={`w-2 h-2 rounded-full ${cloudStatus.connected ? 'bg-emerald-500 animate-pulse' : 'bg-amber-400'}`} />
                    {cloudStatus.connected ? 'Cloud Connected' : 'Ready to Connect'}
                  </span>
                </div>
              </div>

              <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 border-t border-gray-100 pt-4">
                <div className="bg-gray-50 rounded-lg p-3">
                  <p className="text-xs text-gray-500 font-medium">Assigned Branch (Locked)</p>
                  <p className="text-sm font-semibold text-gray-800 mt-0.5 truncate">
                    {cloudStatus.currentShopName || `Shop #${cloudStatus.currentShopId || '3'}`}
                  </p>
                </div>
                <div className="bg-gray-50 rounded-lg p-3">
                  <p className="text-xs text-gray-500 font-medium">Realtime Orders Listener</p>
                  <p className="text-sm font-semibold text-gray-800 mt-0.5">
                    {cloudStatus.isRealtimeActive ? '🟢 Active & Listening' : '🟡 Standby'}
                  </p>
                </div>
                <div className="bg-gray-50 rounded-lg p-3">
                  <p className="text-xs text-gray-500 font-medium">Auto-Print Kitchen Slip (KOT)</p>
                  <p className="text-sm font-semibold text-gray-800 mt-0.5">
                    {cloudStatus.autoPrintKot ? '✅ Enabled' : '❌ Disabled'}
                  </p>
                </div>
                <div className="bg-gray-50 rounded-lg p-3">
                  <p className="text-xs text-gray-500 font-medium">Last Synced</p>
                  <p className="text-sm font-semibold text-gray-800 mt-0.5">
                    {cloudStatus.lastSync ? new Date(cloudStatus.lastSync).toLocaleString() : 'Never'}
                  </p>
                </div>
              </div>
            </div>

            {/* System Operating Mode Card */}
            <div className="bg-white rounded-xl border border-gray-100 p-6 shadow-sm">
              <div className="mb-4">
                <h3 className="font-semibold text-gray-900 text-base">System Operating Mode</h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  Choose whether Flo POS is paired with your online Pizza Management System or operating as a standalone local counter system.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Integrated Mode Card */}
                <button
                  type="button"
                  onClick={() => handleOperatingModeChange('integrated')}
                  className={`p-4 rounded-xl border text-left transition-all relative ${
                    cloudStatus.operatingMode === 'integrated'
                      ? 'border-orange-500 bg-orange-50/40 ring-2 ring-orange-500/20 shadow-sm'
                      : 'border-gray-200 hover:border-gray-300 bg-white'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-2xl">🍕</span>
                      <span className="font-bold text-gray-900 text-sm">
                        Pizza Management Integrated
                      </span>
                    </div>
                    {cloudStatus.operatingMode === 'integrated' && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-orange-600 text-white">
                        ACTIVE
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-600 leading-relaxed">
                    Products, Categories, and Staff are managed centrally from the Pizza System Super Admin. Local product and staff addition menus are hidden in Flo POS to prevent sync conflicts.
                  </p>
                </button>

                {/* Standalone Mode Card */}
                <button
                  type="button"
                  onClick={() => handleOperatingModeChange('standalone')}
                  className={`p-4 rounded-xl border text-left transition-all relative ${
                    cloudStatus.operatingMode === 'standalone'
                      ? 'border-blue-500 bg-blue-50/40 ring-2 ring-blue-500/20 shadow-sm'
                      : 'border-gray-200 hover:border-gray-300 bg-white'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-2xl">💻</span>
                      <span className="font-bold text-gray-900 text-sm">
                        Standalone POS Mode
                      </span>
                    </div>
                    {cloudStatus.operatingMode === 'standalone' && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-600 text-white">
                        ACTIVE
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-600 leading-relaxed">
                    Independent counter mode. Enables full local Product Management (<code className="text-gray-800">/products</code>) and Staff Management (<code className="text-gray-800">/staff</code>) menus in the sidebar.
                  </p>
                </button>
              </div>
            </div>

            {/* Quick Actions Card */}
            <div className="bg-white rounded-xl border border-gray-100 p-6 shadow-sm">
              <h3 className="font-semibold text-gray-900 mb-4">Manual Sync Actions</h3>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={testCloudConnection}
                  disabled={testingCloud}
                  className="px-4 py-2 text-sm font-medium border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 flex items-center gap-2"
                >
                  <RefreshCw size={16} className={testingCloud ? 'animate-spin' : ''} />
                  {testingCloud ? 'Testing Connection...' : 'Test Cloud Connection'}
                </button>
                <button
                  type="button"
                  onClick={handleManualMenuSync}
                  disabled={syncingMenu}
                  className="px-4 py-2 text-sm font-medium bg-orange-600 hover:bg-orange-700 text-white rounded-lg flex items-center gap-2 shadow-sm"
                >
                  <RefreshCw size={16} className={syncingMenu ? 'animate-spin' : ''} />
                  {syncingMenu ? 'Syncing Menu...' : 'Sync Menu (Categories & Pizzas)'}
                </button>
                <button
                  type="button"
                  onClick={handleManualStaffSync}
                  disabled={syncingStaff}
                  className="px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg flex items-center gap-2 shadow-sm"
                >
                  <RefreshCw size={16} className={syncingStaff ? 'animate-spin' : ''} />
                  {syncingStaff ? 'Syncing Staff...' : 'Sync Staff (Users & PINs)'}
                </button>
                <button
                  type="button"
                  onClick={handlePushOfflineOrders}
                  disabled={syncingPending}
                  className="px-4 py-2 text-sm font-medium bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg flex items-center gap-2 shadow-sm"
                >
                  <RefreshCw size={16} className={syncingPending ? 'animate-spin' : ''} />
                  {syncingPending ? 'Uploading Offline...' : 'Sync Offline Orders (Push to Cloud)'}
                </button>
              </div>
            </div>

            {/* Preferences Card */}
            <div className="bg-white rounded-xl border border-gray-100 p-6 shadow-sm">
              <h3 className="font-semibold text-gray-900 mb-4">Sync Preferences</h3>
              <div className="space-y-4">
                <div className="flex items-center justify-between py-2 border-b border-gray-50">
                  <div>
                    <p className="text-sm font-medium text-gray-900">Enable Cloud Sync</p>
                    <p className="text-xs text-gray-500">Allow FloDesktop to communicate with Pizza System Supabase cloud</p>
                  </div>
                  <Toggle
                    value={cloudStatus.syncEnabled}
                    onChange={(v) => updateCloudSetting('cloud_sync_enabled', v)}
                  />
                </div>
                <div className="flex items-center justify-between py-2 border-b border-gray-50">
                  <div>
                    <p className="text-sm font-medium text-gray-900">Auto-Print Online Orders</p>
                    <p className="text-xs text-gray-500">Automatically print Kitchen Order Ticket (KOT) on thermal printer when an online pizza order arrives</p>
                  </div>
                  <Toggle
                    value={cloudStatus.autoPrintKot}
                    onChange={(v) => updateCloudSetting('cloud_auto_print_kot', v)}
                  />
                </div>
              </div>
            </div>

            {/* Supabase Endpoint info */}
            <div className="bg-gray-50 rounded-xl border border-gray-200 p-4 text-xs text-gray-600 space-y-1">
              <p className="font-semibold text-gray-700">Cloud Endpoint:</p>
              <p className="font-mono text-gray-500">{cloudStatus.supabaseUrl}</p>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
