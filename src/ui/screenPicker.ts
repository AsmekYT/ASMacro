import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { register, unregister } from '@tauri-apps/plugin-global-shortcut';
import { t } from '../i18n';
import { listScreens, screenLabel, type ScreenInfo } from '../screens';

let screensInfo: ScreenInfo[] = [];
listScreens()
  .then(list => {
    screensInfo = list;
  })
  .catch(() => {});
const primaryScreenIndex = () => screensInfo.find(s => s.is_primary)?.index ?? 0;

function el<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function addMonitorSwitcher(
  screenshotOverlay: HTMLElement | null,
  reload: (idx: number) => void,
): HTMLDivElement | null {
  if (screensInfo.length <= 1) return null;
  const bar = document.createElement('div');
  Object.assign(bar.style, {
    position: 'absolute',
    bottom: '24px',
    left: '50%',
    transform: 'translateX(-50%)',
    display: 'flex',
    gap: '8px',
    zIndex: '10001',
  });
  screensInfo.forEach(s => {
    const b = document.createElement('button');
    b.className = 'gui-btn';
    b.innerText = screenLabel(s);
    b.onclick = ev => {
      ev.stopPropagation();
      reload(s.index);
    };
    bar.appendChild(b);
  });
  screenshotOverlay?.appendChild(bar);
  return bar;
}

export type PickerOpts = {
  mode: 'point' | 'rect';
  infoText: string;
  showZoom?: boolean;
  multi?: boolean;
  onPoint?: (imgX: number, imgY: number, res: any, img: HTMLImageElement) => void | Promise<void>;
  onRect?: (
    rX: number,
    rY: number,
    rW: number,
    rH: number,
    res: any,
    img: HTMLImageElement,
  ) => void | Promise<void>;
  onDone?: () => void;
};

export async function openScreenPicker(opts: PickerOpts) {
  const screenshotOverlay = el<HTMLElement>('screenshotOverlay');
  const screenshotCanvas = el<HTMLCanvasElement>('screenshotCanvas');
  if (!screenshotCanvas) return;

  try {
    let res: any = await invoke<any>('take_screenshot', { screenIndex: primaryScreenIndex() });
    const win = getCurrentWindow();
    await win.unminimize();
    await win.show();
    await new Promise(r => setTimeout(r, 100));
    await win.setFullscreen(true);
    await win.setAlwaysOnTop(true);
    await win.setFocus();

    screenshotOverlay?.classList.remove('hidden');

    const ctx = screenshotCanvas.getContext('2d');
    let img = new Image();
    const drawShot = () => {
      screenshotCanvas.width = res.image_w || img.naturalWidth || img.width;
      screenshotCanvas.height = res.image_h || img.naturalHeight || img.height;
      screenshotCanvas.style.width = `${window.innerWidth}px`;
      screenshotCanvas.style.height = `${window.innerHeight}px`;
      ctx?.clearRect(0, 0, screenshotCanvas.width, screenshotCanvas.height);
      ctx?.drawImage(img, 0, 0, screenshotCanvas.width, screenshotCanvas.height);
    };
    img.onload = drawShot;
    img.src = res.data_url || res;

    const overlayInfo = document.createElement('div');
    Object.assign(overlayInfo.style, {
      position: 'absolute',
      top: '30px',
      left: '50%',
      transform: 'translateX(-50%)',
      backgroundColor: 'rgba(0, 0, 0, 0.8)',
      color: 'white',
      padding: '12px 24px',
      borderRadius: '8px',
      fontSize: '18px',
      fontWeight: 'bold',
      pointerEvents: 'none',
      zIndex: '10000',
      border: '1px solid #555',
    });
    overlayInfo.innerText = opts.infoText;
    screenshotOverlay?.appendChild(overlayInfo);

    const monBar = addMonitorSwitcher(screenshotOverlay, async i => {
      res = await invoke<any>('take_screenshot', { screenIndex: i });
      img = new Image();
      img.onload = drawShot;
      img.src = res.data_url || res;
    });

    const picked: { x: number; y: number }[] = [];
    const drawMarkers = () => {
      if (!ctx || picked.length === 0) return;
      picked.forEach((pt, i) => {
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 12, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0, 122, 204, 0.35)';
        ctx.fill();
        ctx.strokeStyle = '#00c2ff';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 13px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(i + 1), pt.x, pt.y);
      });
    };

    let onKey: ((e: KeyboardEvent) => void) | null = null;

    const cleanup = async () => {
      if (onKey) {
        window.removeEventListener('keydown', onKey, true);
        onKey = null;
      }
      overlayInfo.remove();
      monBar?.remove();
      screenshotCanvas.onmousemove = null;
      screenshotCanvas.onmousedown = null;
      screenshotCanvas.onmouseup = null;
      screenshotCanvas.onclick = null;
      screenshotOverlay?.classList.add('hidden');
      await win.setAlwaysOnTop(false);
      await win.setFullscreen(false);
      opts.onDone?.();
    };

    if (opts.mode === 'point') {
      screenshotCanvas.onmousemove = e => {
        if (!ctx || !opts.showZoom) return;
        const rect = screenshotCanvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        ctx.clearRect(0, 0, screenshotCanvas.width, screenshotCanvas.height);
        ctx.drawImage(img, 0, 0, screenshotCanvas.width, screenshotCanvas.height);
        const scaleX = screenshotCanvas.width / rect.width;
        const scaleY = screenshotCanvas.height / rect.height;
        const imgX = mouseX * scaleX;
        const imgY = mouseY * scaleY;
        const zoomSize = 120;
        const zoomLevel = 6;
        ctx.save();
        ctx.beginPath();
        ctx.arc(mouseX, mouseY, zoomSize / 2, 0, Math.PI * 2);
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#007acc';
        ctx.stroke();
        ctx.clip();
        ctx.drawImage(
          img,
          imgX - zoomSize / 2 / zoomLevel,
          imgY - zoomSize / 2 / zoomLevel,
          zoomSize / zoomLevel,
          zoomSize / zoomLevel,
          mouseX - zoomSize / 2,
          mouseY - zoomSize / 2,
          zoomSize,
          zoomSize,
        );
        ctx.beginPath();
        ctx.moveTo(mouseX - 8, mouseY);
        ctx.lineTo(mouseX + 8, mouseY);
        ctx.moveTo(mouseX, mouseY - 8);
        ctx.lineTo(mouseX, mouseY + 8);
        ctx.strokeStyle = 'red';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
        drawMarkers();
      };
      screenshotCanvas.onclick = async e => {
        const rect = screenshotCanvas.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const clickY = e.clientY - rect.top;
        const scaleX = screenshotCanvas.width / rect.width;
        const scaleY = screenshotCanvas.height / rect.height;
        const imgX = Math.floor(clickX * scaleX);
        const imgY = Math.floor(clickY * scaleY);
        await opts.onPoint?.(imgX, imgY, res, img);
        if (!opts.multi) {
          await cleanup();
          return;
        }
        picked.push({ x: imgX, y: imgY });
        drawMarkers();
      };
      if (opts.multi) {
        onKey = (e: KeyboardEvent) => {
          if (e.key !== 'Escape' && e.key !== 'Enter') return;
          e.preventDefault();
          e.stopPropagation();
          void cleanup();
        };
        window.addEventListener('keydown', onKey, true);
      }
    } else {
      let isDragging = false;
      let sX = 0,
        sY = 0;
      screenshotCanvas.onmousedown = e => {
        isDragging = true;
        const rect = screenshotCanvas.getBoundingClientRect();
        sX = e.clientX - rect.left;
        sY = e.clientY - rect.top;
      };
      screenshotCanvas.onmousemove = e => {
        if (!isDragging) return;
        const rect = screenshotCanvas.getBoundingClientRect();
        const cX = e.clientX - rect.left;
        const cY = e.clientY - rect.top;
        ctx?.clearRect(0, 0, screenshotCanvas.width, screenshotCanvas.height);
        ctx?.drawImage(img, 0, 0, screenshotCanvas.width, screenshotCanvas.height);
        ctx!.strokeStyle = '#007acc';
        ctx!.lineWidth = 2;
        ctx?.strokeRect(sX, sY, cX - sX, cY - sY);
        ctx!.fillStyle = 'rgba(0, 122, 204, 0.2)';
        ctx?.fillRect(sX, sY, cX - sX, cY - sY);
      };
      screenshotCanvas.onmouseup = async e => {
        isDragging = false;
        const rect = screenshotCanvas.getBoundingClientRect();
        const eX = e.clientX - rect.left;
        const eY = e.clientY - rect.top;
        const scaleX = screenshotCanvas.width / rect.width;
        const scaleY = screenshotCanvas.height / rect.height;
        const rX = Math.min(sX, eX) * scaleX;
        const rY = Math.min(sY, eY) * scaleY;
        const rW = Math.abs(eX - sX) * scaleX;
        const rH = Math.abs(eY - sY) * scaleY;
        await opts.onRect?.(rX, rY, rW, rH, res, img);
        await cleanup();
      };
    }
  } catch (err) {
    console.error('Screen picker failed:', err);
  }
}

export function makePickButtons(
  pickText: string,
  start: () => Promise<void> | void,
): HTMLDivElement {
  const targetToast = el<HTMLElement>('targetToast');
  const btnGroup = document.createElement('div');
  btnGroup.className = 'pick-btn-group';
  const pickBtn = document.createElement('button');
  pickBtn.className = 'gui-btn';
  pickBtn.style.flex = '1';
  const timerBtn = document.createElement('button');
  timerBtn.className = 'gui-btn';
  timerBtn.style.flex = '1';
  pickBtn.innerHTML = `${t('picker.pick', { what: pickText })}<br><span style="font-size:0.75rem; font-weight: normal; opacity: 0.7;">[Ctrl+Alt+P]</span>`;
  timerBtn.innerHTML = `${t('picker.pickIn3s')}<br><span style="font-size:0.75rem; font-weight: normal; opacity: 0.7;">[${t('picker.timer')}]</span>`;
  pickBtn.onclick = async () => {
    if (targetToast) targetToast.innerText = t('picker.waitingHotkey');
    targetToast?.classList.remove('hidden');
    try {
      await register('Ctrl+Alt+P', async () => {
        try {
          await unregister('Ctrl+Alt+P');
        } catch (e) {}
        targetToast?.classList.add('hidden');
        await start();
      });
    } catch (e) {}
  };
  timerBtn.onclick = async () => {
    const win = getCurrentWindow();
    if (targetToast) targetToast.innerText = t('picker.screenshotIn3');
    targetToast?.classList.remove('hidden');
    try {
      await win.hide();
    } catch (e) {}
    setTimeout(async () => {
      targetToast?.classList.add('hidden');
      await start();
    }, 3000);
  };
  btnGroup.appendChild(pickBtn);
  btnGroup.appendChild(timerBtn);
  return btnGroup;
}
