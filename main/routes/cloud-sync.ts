import { Router, Request, Response } from 'express';
import {
  getCloudSyncStatus,
  testCloudConnection,
  syncMenuFromCloud,
  syncStaffFromCloud,
  syncAllFromCloud,
  updateCloudSyncSettings,
  fetchCloudShops,
  selectCloudShop,
  syncPendingOfflineOrders,
  pullOnlineOrdersFromCloud,
} from '../services/cloud-sync';

const router = Router();

/**
 * GET /api/cloud-sync/shops
 * List all available branches from Supabase
 */
router.get('/shops', async (_req: Request, res: Response) => {
  try {
    const result = await fetchCloudShops();
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/cloud-sync/select-shop
 * Switch active branch for this POS terminal
 */
router.post('/select-shop', async (req: Request, res: Response) => {
  try {
    const { shop_id } = req.body;
    if (!shop_id) {
      return res.status(400).json({ success: false, error: 'shop_id is required' });
    }
    const result = await selectCloudShop(shop_id);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/cloud-sync/status
 * Return connection status, last sync, auto-print config, operatingMode
 */
router.get('/status', async (_req: Request, res: Response) => {
  try {
    const status = getCloudSyncStatus();
    res.json({
      success: true,
      ...status,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/cloud-sync/test
 * Test Supabase connection
 */
router.post('/test', async (_req: Request, res: Response) => {
  try {
    const result = await testCloudConnection();
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/cloud-sync/sync-menu
 * Trigger manual menu sync from Pizza System (Supabase)
 */
router.post('/sync-menu', async (_req: Request, res: Response) => {
  try {
    const result = await syncMenuFromCloud();
    if (result.success) {
      res.json(result);
    } else {
      res.status(500).json(result);
    }
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/cloud-sync/sync-staff
 * Trigger manual staff & user sync from Pizza System
 */
router.post('/sync-staff', async (_req: Request, res: Response) => {
  try {
    const result = await syncStaffFromCloud();
    if (result.success) {
      res.json(result);
    } else {
      res.status(500).json(result);
    }
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/cloud-sync/sync-all
 * Trigger full sync (Menu + Staff) from Pizza System
 */
router.post('/sync-all', async (_req: Request, res: Response) => {
  try {
    const result = await syncAllFromCloud();
    if (result.success) {
      res.json(result);
    } else {
      res.status(500).json(result);
    }
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/cloud-sync/sync-pending
 * Trigger manual push of unsynced offline orders
 */
router.post('/sync-pending', async (_req: Request, res: Response) => {
  try {
    const count = await syncPendingOfflineOrders();
    res.json({ success: true, message: `Synced ${count} offline orders to cloud.`, count });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/cloud-sync/pull-orders
 * Trigger pulling latest online orders from Pizza System
 */
router.post('/pull-orders', async (_req: Request, res: Response) => {
  try {
    const result = await pullOnlineOrdersFromCloud();
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/cloud-sync/settings
 * Update sync settings (enabled/disabled, auto print, keys, operating mode)
 */
router.post('/settings', (req: Request, res: Response) => {
  try {
    const { supabase_url, supabase_key, cloud_sync_enabled, cloud_auto_print_kot, cloud_auto_print_bill, pizza_system_mode, terminal_code } = req.body;
    updateCloudSyncSettings({
      supabase_url,
      supabase_key,
      cloud_sync_enabled,
      cloud_auto_print_kot,
      cloud_auto_print_bill,
      pizza_system_mode,
      terminal_code,
    });
    res.json({ success: true, message: 'Cloud sync settings updated.' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export const cloudSyncRoutes = router;
