import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (cmd: string) => cmd === 'list_screens'
    ? [
        { index: 0, x: 0, y: 0, w: 1920, h: 1080, is_primary: true, name: 'Dell U2414H' },
        { index: 1, x: 1920, y: 0, w: 1920, h: 1200, is_primary: false, name: null },
      ]
    : { running: false, clicks: 0 }),
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock('../../src/ui/clickOverlay', () => ({ showOverlayFor: vi.fn(async () => {}), hideClickOverlay: vi.fn(async () => {}) }));

import { renderAutoclicker, disposeAutoclickerPanel } from '../../src/ui/autoclicker';
import { autoclicker } from '../../src/autoclicker';

function mount(): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

const withHotkey = () => {
  autoclicker.hotkey = { ctrl: false, alt: false, shift: false, win: false, trigger: { kind: 'key', vk: 117, label: 'F6' } };
};

describe('autoclicker panel', () => {
  afterEach(() => { disposeAutoclickerPanel(); document.body.innerHTML = ''; });

  it('has no start button, only the status, since the hotkey is how it runs', () => {
    const el = mount();
    withHotkey();

    renderAutoclicker(el);

    expect(el.querySelector('#acToggleBtn')).toBeNull();
    expect((el.querySelector('#acStatusText') as HTMLElement).textContent).toBe('Stopped');
  });

  it('says what the current configuration will do, with the rate per second', () => {
    const el = mount();
    withHotkey();
    Object.assign(autoclicker, { targetKind: 'mouse', button: 'LEFT', positionMode: 'fixed', posX: 40, posY: 60, randomRate: false, rate: 600, unit: 'minute', limitClicks: 0, limitSeconds: 0 });

    renderAutoclicker(el);

    expect((el.querySelector('#acSummary') as HTMLElement).textContent)
      .toBe('Clicks the Left mouse button, 10/s, at 40, 60.');
  });

  it('keeps the position card layout fixed and switches to the points with a toggle', () => {
    const el = mount();
    withHotkey();
    Object.assign(autoclicker, { positionMode: 'fixed', basePositionMode: 'fixed', showMarkers: false, showPointMarkers: false });
    autoclicker.points = [{ x: 10, y: 20 }];

    renderAutoclicker(el);

    const xy = el.querySelector('#acFixedPosGroup') as HTMLElement;
    const select = el.querySelector('#acPositionMode') as HTMLSelectElement;
    const toggle = el.querySelector('#acUseSequence') as HTMLInputElement;
    expect([...select.options].map(o => o.value)).toEqual(['cursor', 'fixed']);
    expect(xy.style.display).toBe('');
    expect(toggle.checked).toBe(false);

    toggle.checked = true;
    toggle.dispatchEvent(new Event('change'));
    expect(autoclicker.positionMode).toBe('sequence');
    expect(select.disabled).toBe(true);
    expect(xy.style.display).toBe('');
    expect(xy.classList.contains('off')).toBe(true);
    const fixedMarker = el.querySelector('#acShowMarkers') as HTMLInputElement;
    const pointMarkers = el.querySelector('#acShowPointMarkers') as HTMLInputElement;
    expect(fixedMarker.disabled).toBe(true);
    expect(pointMarkers.disabled).toBe(false);
    pointMarkers.checked = true;
    pointMarkers.dispatchEvent(new Event('change'));
    expect(autoclicker.showPointMarkers).toBe(true);
    expect(autoclicker.showMarkers).toBe(false);
    expect(fixedMarker.checked).toBe(false);

    toggle.checked = false;
    toggle.dispatchEvent(new Event('change'));
    expect(autoclicker.positionMode).toBe('fixed');
    expect(select.disabled).toBe(false);
  });

  it('hides the hotkey warning once a hotkey is bound', () => {
    const el = mount();
    autoclicker.hotkey = { ctrl: false, alt: false, shift: false, win: false, trigger: { kind: 'mouse', button: 'x1', label: 'Mouse4' } };

    renderAutoclicker(el);

    expect((el.querySelector('#acHotkeyWarn') as HTMLElement).style.display).toBe('none');
  });

  it('warns when no hotkey is set, since nothing else can start it', () => {
    const el = mount();
    autoclicker.hotkey = { ctrl: false, alt: false, shift: false, win: false, trigger: null };

    renderAutoclicker(el);

    const warn = el.querySelector('#acHotkeyWarn') as HTMLElement;
    expect(warn.style.display).toBe('');
    expect(warn.textContent).toContain('No hotkey set');
    const hotkeyBtn = el.querySelector('#acHotkeyBtn') as HTMLButtonElement;
    let opened = false;
    hotkeyBtn.addEventListener('click', () => { opened = true; });
    warn.click();
    expect(opened).toBe(true);
  });

  it('shapes the point preview like the screen the points sit on, and lists the screens to choose from', async () => {
    const el = mount();
    withHotkey();
    Object.assign(autoclicker, { positionMode: 'sequence', points: [{ x: 2000, y: 300 }] });

    renderAutoclicker(el);
    for (let i = 0; i < 10; i++) await Promise.resolve();

    // Point 1 is on the second screen, which is 16:10, not the 16:9 primary.
    expect((el.querySelector('#acMap') as HTMLElement).style.aspectRatio).toBe('1920 / 1200');

    const sel = el.querySelector('#acMapScreen') as HTMLSelectElement;
    expect(sel.classList.contains('hidden')).toBe(false);
    expect(Array.from(sel.options).map(o => o.value)).toEqual(['auto', '0', '1', 'all']);
    // The system's own name where there is one, the monitor number where there is not.
    expect(Array.from(sel.options).map(o => o.textContent)).toEqual(
      ['Screen of the points', 'Dell U2414H ★', 'Monitor 2', 'All screens'],
    );

    sel.value = '0';
    sel.dispatchEvent(new Event('change'));
    expect((el.querySelector('#acMap') as HTMLElement).style.aspectRatio).toBe('1920 / 1080');

    sel.value = 'all';
    sel.dispatchEvent(new Event('change'));
    expect((el.querySelector('#acMap') as HTMLElement).style.aspectRatio).toBe('3840 / 1200');
  });
});
