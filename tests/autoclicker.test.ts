import { describe, it, expect, beforeEach } from 'vitest';
import {
  autoclicker,
  defaultAutoclickerConfig,
  loadAutoclickerConfig,
  saveAutoclickerConfig,
  toBackendConfig,
  toHotkeyCombo,
  applyAutoclickerConfig,
  cloneAutoclickerConfig,
  onAutoclickerConfigChange,
  clampCps,
  MAX_CPS,
  type AutoclickerConfig,
} from '../src/autoclicker';

const STORAGE_KEY = 'asmacro_autoclicker_v1';

function cfg(patch: Partial<AutoclickerConfig> = {}): AutoclickerConfig {
  return { ...JSON.parse(JSON.stringify(defaultAutoclickerConfig)), ...patch };
}

function backend(patch: Partial<AutoclickerConfig> = {}): any {
  return toBackendConfig(cfg(patch));
}

describe('loadAutoclickerConfig', () => {
  beforeEach(() => localStorage.clear());

  it('falls back to defaults', () => {
    expect(loadAutoclickerConfig()).toEqual(defaultAutoclickerConfig);
    localStorage.setItem(STORAGE_KEY, '{not json');
    expect(loadAutoclickerConfig()).toEqual(defaultAutoclickerConfig);
  });

  it('fills missing fields', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ rate: 42, hotkey: { ctrl: true } }));
    const c = loadAutoclickerConfig();
    expect(c.rate).toBe(42);
    expect(c.unit).toBe(defaultAutoclickerConfig.unit);
    expect(c.hotkey.ctrl).toBe(true);
    expect(c.hotkey.trigger).toBe(null);
  });

  it('migrates old fixedPos', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ fixedPos: true, posX: 12, posY: 34 }));
    expect(loadAutoclickerConfig()).toMatchObject({ positionMode: 'fixed', posX: 12 });
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ fixedPos: false }));
    expect(loadAutoclickerConfig().positionMode).toBe('cursor');
  });
});

it('clampCps', () => {
  expect(clampCps(9999)).toBe(MAX_CPS);
  expect(clampCps(10)).toBe(10);
  for (const bad of [0, -5, NaN]) expect(clampCps(bad)).toBeGreaterThan(0);
});

describe('toBackendConfig', () => {
  it.each([
    [60, 'minute'],
    [3600, 'hour'],
    [86400, 'day'],
  ] as const)('%i per %s is 1 cps', (rate, unit) => {
    expect(backend({ rate, unit }).cps_min).toBeCloseTo(1);
  });

  it('clamps rate', () => {
    expect(backend({ rate: 999999, unit: 'second' }).cps_min).toBe(MAX_CPS);
    const b = backend({ randomRate: true, unit: 'second', rateMin: 50, rateMax: 5 });
    expect(b.cps_min).toBeLessThanOrEqual(b.cps_max);
  });

  it('zero limits mean none', () => {
    expect(backend({ limitClicks: 0, limitSeconds: 0 })).toMatchObject({ limit_clicks: null, limit_ms: null });
    expect(backend({ limitClicks: 500 }).limit_clicks).toBe(500);
  });

  it('position modes', () => {
    const points = [{ x: 10, y: 20 }, { x: 30, y: 40 }];
    expect(backend({ positionMode: 'cursor' }).position).toBe(null);
    expect(backend({ positionMode: 'fixed', posX: 100, posY: 200, points })).toMatchObject({ position: [100, 200], points: null });
    expect(backend({ positionMode: 'sequence', points }).points).toEqual([[10, 20], [30, 40]]);
    expect(backend({ positionMode: 'sequence', points: [] })).toMatchObject({ points: null, position: null });
  });

  it('sequence options', () => {
    const b = backend({ positionMode: 'sequence', points: [{ x: 1, y: 2 }], sequenceLoop: false, sequenceRandom: true, clicksPerPoint: 0 });
    expect(b).toMatchObject({ sequence_loop: false, sequence_random: true, clicks_per_point: 1 });
  });

  it('edge stop', () => {
    expect(backend().edge_stop).toBe(null);
    expect(backend({ edgeStop: true, edgeMarginPx: 8, edgeCornersOnly: true }).edge_stop).toEqual({ margin_px: 8, corners_only: true });
  });

  it('targets', () => {
    expect(backend({ targetKind: 'mouse', button: 'RIGHT' }).target).toEqual({ kind: 'mouse', button: 'RIGHT' });
    expect(backend({ targetKind: 'key', key: 'A', caseSensitive: true }).target).toEqual({ kind: 'key', key: 'A', case_sensitive: true });
  });
});

it('toHotkeyCombo', () => {
  expect(toHotkeyCombo(defaultAutoclickerConfig.hotkey)).toBe(null);
  const mods = { ctrl: true, alt: false, shift: false, win: false };
  expect(toHotkeyCombo({ ...mods, trigger: { kind: 'key', vk: 0x74, label: 'F5' } })).toEqual({ ...mods, trigger: { kind: 'key', vk: 0x74 } });
  expect(toHotkeyCombo({ ...mods, trigger: { kind: 'mouse', button: 'x1', label: 'Mouse4' } })).toEqual({ ...mods, trigger: { kind: 'mouse', button: 'x1' } });
});

describe('applyAutoclickerConfig', () => {
  beforeEach(() => applyAutoclickerConfig(cfg()));

  it('mutates in place', () => {
    const live = autoclicker;
    applyAutoclickerConfig(cfg({ rate: 42 }));
    expect(live.rate).toBe(42);
    expect(autoclicker).toBe(live);
  });

  it('replaces instead of merging', () => {
    applyAutoclickerConfig({ rate: 7 });
    expect(autoclicker.unit).toBe(defaultAutoclickerConfig.unit);
    applyAutoclickerConfig(cfg({ positionMode: 'fixed', posX: 500 }));
    applyAutoclickerConfig(cfg({ rate: 3 }));
    expect(autoclicker.positionMode).toBe('cursor');
    expect(autoclicker.posX).toBe(defaultAutoclickerConfig.posX);
  });

  it('drops bad points', () => {
    applyAutoclickerConfig(cfg({ points: [{ x: 5, y: 6 }, { x: 'a', y: 1 }, null] as any }));
    expect(autoclicker.points).toEqual([{ x: 5, y: 6 }]);
  });

  it('clone round-trip', () => {
    const state = {
      positionMode: 'sequence',
      basePositionMode: 'fixed',
      showMarkers: false,
      showPointMarkers: true,
      pickMulti: true,
      mapScreen: '1',
      rate: 12,
      hotkey: { ctrl: true, alt: false, shift: false, win: false, trigger: { kind: 'key', vk: 0x74, label: 'F5' } },
    } as const;
    applyAutoclickerConfig(cfg(state as any));
    const saved = JSON.parse(JSON.stringify(cloneAutoclickerConfig()));
    applyAutoclickerConfig(cfg({ rate: 99 }));
    applyAutoclickerConfig(saved);
    expect(autoclicker).toMatchObject(state);
    expect(autoclicker.hotkey).not.toBe(saved.hotkey);
  });

  it('upgrades old marker toggles', () => {
    applyAutoclickerConfig({ positionMode: 'fixed', showMarkers: true });
    expect(autoclicker).toMatchObject({ basePositionMode: 'fixed', showPointMarkers: true });
    applyAutoclickerConfig({ positionMode: 'sequence' });
    expect(autoclicker.basePositionMode).toBe('cursor');
  });
});

it('save persists and notifies', () => {
  const seen: number[] = [];
  const unsubscribe = onAutoclickerConfigChange(() => seen.push(autoclicker.rate));
  autoclicker.rate = 8;
  saveAutoclickerConfig();
  expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).rate).toBe(8);
  unsubscribe();
  autoclicker.rate = 9;
  saveAutoclickerConfig();
  expect(seen).toEqual([8]);
});
