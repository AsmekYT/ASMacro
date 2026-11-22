import { invoke } from '@tauri-apps/api/core';

export type PlatformCapabilities = {
  platform: string;
  session: string;
  input_write: boolean;
  input_read: boolean;
  ocr: boolean;
  notes: string[];
};

const FALLBACK: PlatformCapabilities = {
  platform: 'win32',
  session: '',
  input_write: true,
  input_read: true,
  ocr: true,
  notes: [],
};

export async function getMousePos(): Promise<[number, number]> {
  return invoke<[number, number]>('get_mouse_pos');
}

let cached: PlatformCapabilities | null = null;
let pending: Promise<PlatformCapabilities> | null = null;

export async function getPlatformCapabilities(): Promise<PlatformCapabilities> {
  if (cached) return cached;
  if (!pending) {
    pending = invoke<PlatformCapabilities>('platform_capabilities')
      .then((r) => { cached = r; return r; })
      .catch(() => { cached = FALLBACK; return FALLBACK; });
  }
  return pending;
}
