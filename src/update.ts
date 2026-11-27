import { invoke } from '@tauri-apps/api/core';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { getPlatformCapabilities } from './platformInfo';

export const RELEASES_URL = 'https://github.com/AsmekYT/ASMacro/releases/latest';

export type UpdateCheck =
  | { kind: 'none' }
  | { kind: 'ready'; update: Update }
  | { kind: 'manual'; version: string; notes?: string };

export type DownloadProgress = {
  downloaded: number;
  total: number;
};

let dismissedThisSession = false;
let inFlight: Promise<UpdateCheck> | null = null;

async function canSelfUpdate(): Promise<boolean> {
  try {
    return await invoke<boolean>('updater_supported');
  } catch {
    const caps = await getPlatformCapabilities();
    return caps.platform !== 'linux';
  }
}

export function checkForUpdate(silent: boolean): Promise<UpdateCheck> {
  if (silent && dismissedThisSession) return Promise.resolve({ kind: 'none' });
  if (inFlight) return inFlight;

  inFlight = (async (): Promise<UpdateCheck> => {
    let update: Update | null = null;
    try {
      update = await check();
    } catch (e) {
      if (silent) {
        console.warn('Update check failed', e);
        return { kind: 'none' };
      }
      throw e;
    }
    if (!update) return { kind: 'none' };
    if (await canSelfUpdate()) return { kind: 'ready', update };
    return { kind: 'manual', version: update.version, notes: update.body };
  })().finally(() => {
    inFlight = null;
  });

  return inFlight;
}

export function dismissUpdateForSession(): void {
  dismissedThisSession = true;
}

export async function runUpdate(
  update: Update,
  onProgress?: (p: DownloadProgress) => void,
): Promise<void> {
  let downloaded = 0;
  let total = 0;
  await update.downloadAndInstall(event => {
    if (event.event === 'Started') {
      total = event.data.contentLength ?? 0;
      downloaded = 0;
    } else if (event.event === 'Progress') {
      downloaded += event.data.chunkLength;
    } else if (event.event === 'Finished') {
      downloaded = total || downloaded;
    }
    onProgress?.({ downloaded, total });
  });
  await relaunch();
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
