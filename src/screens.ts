import { invoke } from '@tauri-apps/api/core';
import { t } from './i18n';

export type ScreenInfo = { index: number; x: number; y: number; w: number; h: number; is_primary: boolean; name?: string | null };
type Bounds = { x: number; y: number; w: number; h: number };

export async function listScreens(): Promise<ScreenInfo[]> {
    const list = await invoke<ScreenInfo[]>('list_screens').catch(() => []);
    return Array.isArray(list) ? list : [];
}

export const screenLabel = (s: ScreenInfo) =>
    (s.name?.trim() || t('picker.monitor', { n: s.index + 1 })) + (s.is_primary ? ' ★' : '');

export async function virtualBounds(): Promise<Bounds> {
    try {
        const screens = await listScreens();
        if (screens.length) {
            const x = Math.min(...screens.map(s => s.x));
            const y = Math.min(...screens.map(s => s.y));
            const right = Math.max(...screens.map(s => s.x + s.w));
            const bottom = Math.max(...screens.map(s => s.y + s.h));
            return { x, y, w: right - x, h: bottom - y };
        }
    } catch (e) {}
    const [w, h] = await invoke<[number, number]>('get_screen_size').catch(() => [1920, 1080] as [number, number]);
    return { x: 0, y: 0, w, h };
}
