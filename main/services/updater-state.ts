export interface UpdateProgressState {
  status: 'idle' | 'checking' | 'available' | 'downloading' | 'ready-to-install' | 'up-to-date' | 'error';
  version: string;
  newVersion?: string | null;
  releaseDate?: string | null;
  releaseNotes?: string | null;
  percent: number;
  transferred: number;
  total: number;
  transferredMb: string;
  totalMb: string;
  speedMb: string;
  error?: string | null;
  lastChecked?: string | null;
}

let state: UpdateProgressState = {
  status: 'idle',
  version: '1.0.0',
  newVersion: null,
  releaseDate: null,
  releaseNotes: null,
  percent: 0,
  transferred: 0,
  total: 0,
  transferredMb: '0',
  totalMb: '0',
  speedMb: '0',
  error: null,
  lastChecked: null,
};

let onCheckFn: ((manual: boolean) => void) | null = null;
let onInstallFn: (() => void) | null = null;

export function getUpdateProgressState(): UpdateProgressState {
  return { ...state };
}

export function setUpdateProgressState(partial: Partial<UpdateProgressState>): void {
  state = { ...state, ...partial };
}

export function setCheckForUpdatesHandler(fn: (manual: boolean) => void): void {
  onCheckFn = fn;
}

export function setQuitAndInstallHandler(fn: () => void): void {
  onInstallFn = fn;
}

export function triggerUpdateCheck(manual = true): void {
  setUpdateProgressState({
    status: 'checking',
    error: null,
    lastChecked: new Date().toISOString(),
  });
  if (onCheckFn) {
    onCheckFn(manual);
  }
}

export function triggerQuitAndInstall(): void {
  if (onInstallFn) {
    onInstallFn();
  }
}
