'use client';

import React, { useEffect, useState } from 'react';
import { ArrowUpCircle, RefreshCw, X, DownloadCloud } from 'lucide-react';

interface UpdateState {
  status: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error' | 'not-available';
  version?: string;
  newVersion?: string;
  percent?: number;
  error?: string | null;
}

export default function UpdateNotificationBanner() {
  const [updateState, setUpdateState] = useState<UpdateState>({ status: 'idle' });
  const [dismissed, setDismissed] = useState(false);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const api = (window as any).electronAPI;
    if (!api) return;

    // 1. Initial status query
    if (api.getUpdateStatus) {
      api.getUpdateStatus().then((st: any) => {
        if (st && st.status) {
          setUpdateState(st);
        }
      }).catch(() => {});
    }

    // 2. Subscribe to real-time update events from Electron main process
    if (api.onUpdateStatus) {
      api.onUpdateStatus((st: any) => {
        if (st) {
          setUpdateState(st);
          // If a new update arrived or downloaded, re-show banner if previously dismissed
          if (st.status === 'downloaded' || st.status === 'available') {
            setDismissed(false);
          }
        }
      });
    }

    // 3. Fallback: Check GitHub Releases directly to ensure cashiers on very old builds see alert
    const checkGitHubRelease = async () => {
      try {
        const appInfo = api.getAppInfo ? await api.getAppInfo() : null;
        const currentVer = appInfo?.version || '1.8.18';
        const res = await fetch('https://api.github.com/repos/bhaijew/sole/releases/latest');
        if (res.ok) {
          const data = await res.json();
          const latestTag = (data.tag_name || '').replace(/^v/, '');
          if (latestTag && latestTag !== currentVer) {
            setUpdateState(prev => {
              if (prev.status === 'downloaded' || prev.status === 'downloading') return prev;
              return {
                status: 'available',
                version: currentVer,
                newVersion: latestTag,
              };
            });
          }
        }
      } catch {}
    };

    const timer = setTimeout(checkGitHubRelease, 3000);
    return () => clearTimeout(timer);
  }, []);

  if (dismissed) return null;
  if (!updateState || updateState.status === 'idle' || updateState.status === 'not-available' || updateState.status === 'checking') {
    return null;
  }

  const handleRestartAndInstall = async () => {
    setInstalling(true);
    const api = (window as any).electronAPI;
    if (api?.quitAndInstall) {
      await api.quitAndInstall();
    } else {
      window.location.reload();
    }
  };

  const handleTriggerDownload = async () => {
    const api = (window as any).electronAPI;
    if (api?.checkForUpdates) {
      await api.checkForUpdates();
    }
  };

  // Case A: Downloaded & Ready to Install
  if (updateState.status === 'downloaded') {
    return (
      <div className="bg-emerald-600 text-white px-4 py-2 flex items-center justify-between text-xs sm:text-sm font-medium shadow-md z-50 animate-in slide-in-from-top duration-300">
        <div className="flex items-center gap-2">
          <ArrowUpCircle className="w-5 h-5 animate-bounce shrink-0" />
          <span>
            <strong>New POS Version {updateState.newVersion ? `v${updateState.newVersion}` : ''} Ready!</strong>{' '}
            Restart POS now to apply latest performance upgrades and cloud sync fixes.
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleRestartAndInstall}
            disabled={installing}
            className="bg-white text-emerald-800 hover:bg-emerald-50 px-3 py-1 rounded font-bold shadow-sm transition-all"
          >
            {installing ? 'Restarting POS...' : 'Restart & Install Now'}
          </button>
          <button
            onClick={() => setDismissed(true)}
            className="text-emerald-100 hover:text-white p-1 rounded"
            title="Dismiss for now"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  // Case B: Downloading in background
  if (updateState.status === 'downloading') {
    const pct = Math.round(updateState.percent || 0);
    return (
      <div className="bg-blue-600 text-white px-4 py-2 flex items-center justify-between text-xs sm:text-sm font-medium shadow-md z-50">
        <div className="flex items-center gap-2">
          <DownloadCloud className="w-5 h-5 animate-pulse shrink-0" />
          <span>
            Downloading POS Update {updateState.newVersion ? `v${updateState.newVersion}` : ''}... ({pct}%)
          </span>
        </div>
        <div className="w-32 bg-blue-800 rounded-full h-2 overflow-hidden mr-4">
          <div className="bg-white h-2 transition-all duration-300" style={{ width: `${pct}%` }}></div>
        </div>
      </div>
    );
  }

  // Case C: Update available
  if (updateState.status === 'available') {
    return (
      <div className="bg-amber-600 text-white px-4 py-2 flex items-center justify-between text-xs sm:text-sm font-medium shadow-md z-50">
        <div className="flex items-center gap-2">
          <RefreshCw className="w-4 h-4 shrink-0" />
          <span>
            <strong>POS Update Available:</strong> Version {updateState.newVersion ? `v${updateState.newVersion}` : ''} is released on GitHub.
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleTriggerDownload}
            className="bg-white text-amber-900 hover:bg-amber-50 px-3 py-1 rounded font-bold shadow-sm transition-all"
          >
            Download & Update
          </button>
          <button
            onClick={() => setDismissed(true)}
            className="text-amber-100 hover:text-white p-1 rounded"
            title="Dismiss"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  return null;
}
