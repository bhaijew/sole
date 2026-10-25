import { Router, Request, Response } from 'express';
import {
  getUpdateProgressState,
  triggerUpdateCheck,
  triggerQuitAndInstall,
} from '../services/updater-state';

const router = Router();

// GET /api/updates/status
router.get('/status', (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: getUpdateProgressState(),
  });
});

// POST /api/updates/check
router.post('/check', (_req: Request, res: Response) => {
  triggerUpdateCheck(true);
  res.json({
    success: true,
    message: 'Checking for updates initiated',
    data: getUpdateProgressState(),
  });
});

// POST /api/updates/install
router.post('/install', (_req: Request, res: Response) => {
  triggerQuitAndInstall();
  res.json({
    success: true,
    message: 'Restarting app to apply update',
  });
});

export const updateRoutes = router;
