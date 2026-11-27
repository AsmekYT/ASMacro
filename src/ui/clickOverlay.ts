import { emitTo } from '@tauri-apps/api/event';
import { PhysicalPosition, PhysicalSize } from '@tauri-apps/api/dpi';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { virtualBounds } from '../screens';
import type { OverlayPoint, OverlayPayload } from '../overlay';
import type { AutoclickerConfig } from '../autoclicker';

const LABEL = 'ac-overlay';

let creating: Promise<WebviewWindow | null> | null = null;
let origin = { x: 0, y: 0 };

async function ensureWindow(): Promise<WebviewWindow | null> {
  const existing = await WebviewWindow.getByLabel(LABEL);
  if (existing) return existing;
  if (creating) return creating;

  creating = (async () => {
    const b = await virtualBounds();
    origin = { x: b.x, y: b.y };
    const win = new WebviewWindow(LABEL, {
      url: 'overlay.html',
      transparent: true,
      decorations: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      shadow: false,
      resizable: false,
      focus: false,
      visible: false,
      width: 100,
      height: 100,
    });
    await new Promise<void>((resolve, reject) => {
      win.once('tauri://created', () => resolve());
      win.once('tauri://error', e => reject(e));
    });
    await win.setIgnoreCursorEvents(true);
    await win.setPosition(new PhysicalPosition(b.x, b.y));
    await win.setSize(new PhysicalSize(b.w, b.h));
    await win.setAlwaysOnTop(true);
    await win.show();
    return win;
  })()
    .catch(() => null)
    .finally(() => {
      creating = null;
    });

  return creating;
}

async function showClickOverlay(points: OverlayPoint[], single = false): Promise<void> {
  if (!points.length) {
    await hideClickOverlay();
    return;
  }
  const win = await ensureWindow();
  if (!win) return;
  try {
    await emitTo(LABEL, 'ac-overlay-points', { points, origin, single } satisfies OverlayPayload);
  } catch (e) {}
}

export async function hideClickOverlay(): Promise<void> {
  try {
    const win = await WebviewWindow.getByLabel(LABEL);
    await win?.destroy();
  } catch (e) {}
}

export function showOverlayFor(c: AutoclickerConfig): Promise<void> {
  if (c.positionMode === 'fixed' && c.showMarkers) {
    return showClickOverlay([{ x: Math.round(c.posX), y: Math.round(c.posY) }], true);
  }
  if (c.positionMode !== 'sequence' || !c.showPointMarkers) return hideClickOverlay();
  return showClickOverlay(c.points.map(p => ({ x: p.x, y: p.y })));
}
