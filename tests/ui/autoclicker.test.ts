import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (cmd: string) =>
    cmd === 'list_screens'
      ? [
          { index: 0, x: 0, y: 0, w: 1920, h: 1080, is_primary: true, name: 'Dell U2414H' },
          { index: 1, x: 1920, y: 0, w: 1920, h: 1200, is_primary: false, name: null },
        ]
      : { running: false, clicks: 0 },
  ),
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock('../../src/ui/clickOverlay', () => ({
  showOverlayFor: vi.fn(async () => {}),
  hideClickOverlay: vi.fn(async () => {}),
}));

import { renderAutoclicker, disposeAutoclickerPanel } from '../../src/ui/autoclicker';
import { autoclicker } from '../../src/autoclicker';

const F6 = {
  ctrl: false,
  alt: false,
  shift: false,
  win: false,
  trigger: { kind: 'key' as const, vk: 117, label: 'F6' },
};

function render(patch: Record<string, unknown> = {}) {
  autoclicker.hotkey = F6;
  Object.assign(autoclicker, patch);
  const el = document.createElement('div');
  document.body.appendChild(el);
  renderAutoclicker(el);
  const $ = <T extends HTMLElement>(id: string) => el.querySelector(`#${id}`) as T;
  return $;
}

function change(input: HTMLInputElement | HTMLSelectElement, value: boolean | string) {
  if (typeof value === 'boolean') (input as HTMLInputElement).checked = value;
  else input.value = value;
  input.dispatchEvent(new Event('change'));
}

describe('autoclicker panel', () => {
  afterEach(() => {
    disposeAutoclickerPanel();
    document.body.innerHTML = '';
  });

  it('status and summary', () => {
    const $ = render({
      targetKind: 'mouse',
      button: 'LEFT',
      positionMode: 'fixed',
      posX: 40,
      posY: 60,
      randomRate: false,
      rate: 600,
      unit: 'minute',
      limitClicks: 0,
      limitSeconds: 0,
    });
    expect($('acToggleBtn')).toBeNull();
    expect($('acStatusText').textContent).toBe('Stopped');
    expect($('acSummary').textContent).toBe('Clicks the Left mouse button, 10/s, at 40, 60.');
  });

  it('no warning with a hotkey', () => {
    const $ = render({
      hotkey: { ...F6, trigger: { kind: 'mouse', button: 'x1', label: 'Mouse4' } },
    });
    expect($('acHotkeyWarn').style.display).toBe('none');
  });

  it('warning without a hotkey', () => {
    const $ = render({ hotkey: { ...F6, trigger: null } });
    const warn = $('acHotkeyWarn');
    expect(warn.style.display).toBe('');
    expect(warn.textContent).toContain('No hotkey set');
    const opened = vi.fn();
    $('acHotkeyBtn').addEventListener('click', opened);
    warn.click();
    expect(opened).toHaveBeenCalled();
  });

  it('sequence toggle', () => {
    const $ = render({
      positionMode: 'fixed',
      basePositionMode: 'fixed',
      showMarkers: false,
      showPointMarkers: false,
      points: [{ x: 10, y: 20 }],
    });
    const xy = $('acFixedPosGroup');
    const select = $<HTMLSelectElement>('acPositionMode');
    const toggle = $<HTMLInputElement>('acUseSequence');
    expect([...select.options].map(o => o.value)).toEqual(['cursor', 'fixed']);
    expect(toggle.checked).toBe(false);

    change(toggle, true);
    expect(autoclicker.positionMode).toBe('sequence');
    expect(select.disabled).toBe(true);
    expect(xy.style.display).toBe('');
    expect(xy.classList.contains('off')).toBe(true);
    expect($<HTMLInputElement>('acShowMarkers').disabled).toBe(true);

    change($<HTMLInputElement>('acShowPointMarkers'), true);
    expect(autoclicker).toMatchObject({ showPointMarkers: true, showMarkers: false });

    change(toggle, false);
    expect(autoclicker.positionMode).toBe('fixed');
    expect(select.disabled).toBe(false);
  });

  it('point preview per screen', async () => {
    const $ = render({ positionMode: 'sequence', points: [{ x: 2000, y: 300 }] });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    const ratio = () => $('acMap').style.aspectRatio;
    expect(ratio()).toBe('1920 / 1200');

    const sel = $<HTMLSelectElement>('acMapScreen');
    expect(sel.classList.contains('hidden')).toBe(false);
    expect([...sel.options].map(o => [o.value, o.textContent])).toEqual([
      ['auto', 'Screen of the points'],
      ['0', 'Dell U2414H ★'],
      ['1', 'Monitor 2'],
      ['all', 'All screens'],
    ]);

    change(sel, '0');
    expect(ratio()).toBe('1920 / 1080');
    change(sel, 'all');
    expect(ratio()).toBe('3840 / 1200');
  });
});
