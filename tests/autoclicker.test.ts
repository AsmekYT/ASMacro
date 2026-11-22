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

function baseConfig(): AutoclickerConfig {
  return JSON.parse(JSON.stringify(defaultAutoclickerConfig));
}

describe('loadAutoclickerConfig', () => {
  beforeEach(() => localStorage.clear());

  it('returns defaults when nothing is stored', () => {
    const cfg = loadAutoclickerConfig();
    expect(cfg).toEqual(defaultAutoclickerConfig);
  });

  it('falls back to defaults on corrupt JSON', () => {
    localStorage.setItem(STORAGE_KEY, '{not json');
    const cfg = loadAutoclickerConfig();
    expect(cfg).toEqual(defaultAutoclickerConfig);
  });

  it('fills in a missing new field with its default', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ rate: 42 }));
    const cfg = loadAutoclickerConfig();
    expect(cfg.rate).toBe(42);
    expect(cfg.unit).toBe(defaultAutoclickerConfig.unit);
    expect(cfg.hotkey).toEqual(defaultAutoclickerConfig.hotkey);
  });

  it('migrates an old fixedPos config to the fixed position mode', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ fixedPos: true, posX: 12, posY: 34 }));
    const cfg = loadAutoclickerConfig();
    expect(cfg.positionMode).toBe('fixed');
    expect(cfg.posX).toBe(12);
  });

  it('keeps the cursor mode for an old config without fixedPos', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ fixedPos: false }));
    expect(loadAutoclickerConfig().positionMode).toBe('cursor');
  });

  it('merges a partial hotkey against defaults', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ hotkey: { ctrl: true } }));
    const cfg = loadAutoclickerConfig();
    expect(cfg.hotkey.ctrl).toBe(true);
    expect(cfg.hotkey.trigger).toBe(null);
  });
});

describe('saveAutoclickerConfig persistence', () => {
  it('round-trips through localStorage', () => {
    autoclicker.rate = 77;
    saveAutoclickerConfig();
    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!).rate).toBe(77);
  });
});

describe('clampCps', () => {
  it('clamps above the 500 ceiling', () => {
    expect(clampCps(9999)).toBe(MAX_CPS);
  });

  it('floors non-positive or non-finite values', () => {
    expect(clampCps(0)).toBeGreaterThan(0);
    expect(clampCps(-5)).toBeGreaterThan(0);
    expect(clampCps(NaN)).toBeGreaterThan(0);
  });

  it('passes through in-range values', () => {
    expect(clampCps(10)).toBe(10);
  });
});

describe('toBackendConfig', () => {
  it('converts 60/minute to 1 cps', () => {
    const cfg = baseConfig();
    cfg.rate = 60; cfg.unit = 'minute';
    const backend = toBackendConfig(cfg) as any;
    expect(backend.cps_min).toBeCloseTo(1.0);
    expect(backend.cps_max).toBeCloseTo(1.0);
  });

  it('converts 3600/hour to 1 cps', () => {
    const cfg = baseConfig();
    cfg.rate = 3600; cfg.unit = 'hour';
    const backend = toBackendConfig(cfg) as any;
    expect(backend.cps_min).toBeCloseTo(1.0);
  });

  it('converts per-day units', () => {
    const cfg = baseConfig();
    cfg.rate = 86400; cfg.unit = 'day';
    const backend = toBackendConfig(cfg) as any;
    expect(backend.cps_min).toBeCloseTo(1.0);
  });

  it('clamps an absurd rate to the 500 cps ceiling', () => {
    const cfg = baseConfig();
    cfg.rate = 999999; cfg.unit = 'second';
    const backend = toBackendConfig(cfg) as any;
    expect(backend.cps_min).toBe(MAX_CPS);
  });

  it('swaps an inverted random-rate range', () => {
    const cfg = baseConfig();
    cfg.randomRate = true; cfg.unit = 'second';
    cfg.rateMin = 50; cfg.rateMax = 5;
    const backend = toBackendConfig(cfg) as any;
    expect(backend.cps_min).toBeLessThanOrEqual(backend.cps_max);
  });

  it('turns a zero click limit into null, not 0', () => {
    const cfg = baseConfig();
    cfg.limitClicks = 0;
    const backend = toBackendConfig(cfg) as any;
    expect(backend.limit_clicks).toBe(null);
  });

  it('passes through a positive click limit', () => {
    const cfg = baseConfig();
    cfg.limitClicks = 500;
    const backend = toBackendConfig(cfg) as any;
    expect(backend.limit_clicks).toBe(500);
  });

  it('turns a zero time limit into null, not 0', () => {
    const cfg = baseConfig();
    cfg.limitSeconds = 0;
    const backend = toBackendConfig(cfg) as any;
    expect(backend.limit_ms).toBe(null);
  });

  it('omits position unless the fixed mode is selected', () => {
    const cfg = baseConfig();
    cfg.positionMode = 'cursor';
    expect((toBackendConfig(cfg) as any).position).toBe(null);
    cfg.positionMode = 'fixed'; cfg.posX = 100; cfg.posY = 200;
    expect((toBackendConfig(cfg) as any).position).toEqual([100, 200]);
  });

  it('sends the click points only in sequence mode', () => {
    const cfg = baseConfig();
    cfg.points = [{ x: 10, y: 20 }, { x: 30, y: 40 }];
    cfg.positionMode = 'fixed';
    expect((toBackendConfig(cfg) as any).points).toBe(null);
    cfg.positionMode = 'sequence';
    expect((toBackendConfig(cfg) as any).points).toEqual([[10, 20], [30, 40]]);
  });

  it('sends null points when the sequence is empty, so the backend falls back to the cursor', () => {
    const cfg = baseConfig();
    cfg.positionMode = 'sequence'; cfg.points = [];
    const backend = toBackendConfig(cfg) as any;
    expect(backend.points).toBe(null);
    expect(backend.position).toBe(null);
  });

  it('forwards the sequence options and floors clicks per point at 1', () => {
    const cfg = baseConfig();
    cfg.positionMode = 'sequence'; cfg.points = [{ x: 1, y: 2 }];
    cfg.sequenceLoop = false; cfg.sequenceRandom = true; cfg.clicksPerPoint = 0;
    const backend = toBackendConfig(cfg) as any;
    expect(backend.sequence_loop).toBe(false);
    expect(backend.sequence_random).toBe(true);
    expect(backend.clicks_per_point).toBe(1);
  });

  it('omits edge_stop unless enabled', () => {
    const cfg = baseConfig();
    expect((toBackendConfig(cfg) as any).edge_stop).toBe(null);
    cfg.edgeStop = true; cfg.edgeMarginPx = 8; cfg.edgeCornersOnly = true;
    expect((toBackendConfig(cfg) as any).edge_stop).toEqual({ margin_px: 8, corners_only: true });
  });

  it('builds a mouse target', () => {
    const cfg = baseConfig();
    cfg.targetKind = 'mouse'; cfg.button = 'RIGHT';
    expect((toBackendConfig(cfg) as any).target).toEqual({ kind: 'mouse', button: 'RIGHT' });
  });

  it('builds a key target with case sensitivity', () => {
    const cfg = baseConfig();
    cfg.targetKind = 'key'; cfg.key = 'A'; cfg.caseSensitive = true;
    expect((toBackendConfig(cfg) as any).target).toEqual({ kind: 'key', key: 'A', case_sensitive: true });
  });
});

describe('toHotkeyCombo', () => {
  it('returns null when no trigger is set', () => {
    expect(toHotkeyCombo(defaultAutoclickerConfig.hotkey)).toBe(null);
  });

  it('serializes a keyboard trigger', () => {
    const h = { ctrl: true, alt: false, shift: false, win: false, trigger: { kind: 'key' as const, vk: 0x74, label: 'F5' } };
    expect(toHotkeyCombo(h)).toEqual({ ctrl: true, alt: false, shift: false, win: false, trigger: { kind: 'key', vk: 0x74 } });
  });

  it('serializes a mouse trigger', () => {
    const h = { ctrl: false, alt: false, shift: false, win: false, trigger: { kind: 'mouse' as const, button: 'x1' as const, label: 'Mouse4' } };
    expect(toHotkeyCombo(h)).toEqual({ ctrl: false, alt: false, shift: false, win: false, trigger: { kind: 'mouse', button: 'x1' } });
  });
});

describe('applyAutoclickerConfig', () => {
  beforeEach(() => { applyAutoclickerConfig(baseConfig()); });

  it('mutates the live config in place, since the UI holds a reference to it', () => {
    const live = autoclicker;
    applyAutoclickerConfig({ ...baseConfig(), rate: 42 });
    expect(live.rate).toBe(42);
    expect(autoclicker).toBe(live);
  });

  it('fills missing fields from the defaults so a partial saved config cannot corrupt the runtime', () => {
    applyAutoclickerConfig({ rate: 7 });
    expect(autoclicker.rate).toBe(7);
    expect(autoclicker.unit).toBe(defaultAutoclickerConfig.unit);
    expect(autoclicker.hotkey).toEqual(defaultAutoclickerConfig.hotkey);
  });

  it('drops the previous macro settings instead of merging them', () => {
    applyAutoclickerConfig({ ...baseConfig(), positionMode: 'fixed', posX: 500 });
    applyAutoclickerConfig({ ...baseConfig(), rate: 3 });
    expect(autoclicker.positionMode).toBe('cursor');
    expect(autoclicker.posX).toBe(defaultAutoclickerConfig.posX);
  });

  it('drops malformed points instead of trusting the saved payload', () => {
    applyAutoclickerConfig({ ...baseConfig(), points: [{ x: 5, y: 6 }, { x: 'a', y: 1 }, null] as any });
    expect(autoclicker.points).toEqual([{ x: 5, y: 6 }]);
  });

  it('round-trips through cloneAutoclickerConfig without sharing references', () => {
    applyAutoclickerConfig({ ...baseConfig(), rate: 12, hotkey: { ctrl: true, alt: false, shift: false, win: false, trigger: { kind: 'key', vk: 0x74, label: 'F5' } } });
    const snapshot = cloneAutoclickerConfig();
    applyAutoclickerConfig({ ...baseConfig(), rate: 99 });

    expect(snapshot.rate).toBe(12);
    applyAutoclickerConfig(snapshot);
    expect(autoclicker.rate).toBe(12);
    expect(autoclicker.hotkey.trigger).toEqual({ kind: 'key', vk: 0x74, label: 'F5' });
    expect(autoclicker.hotkey).not.toBe(snapshot.hotkey);
  });
});

describe('onAutoclickerConfigChange', () => {
  it('notifies subscribers on save so the current macro can persist the config', () => {
    const seen: number[] = [];
    const unsubscribe = onAutoclickerConfigChange(() => seen.push(autoclicker.rate));

    autoclicker.rate = 8;
    saveAutoclickerConfig();
    unsubscribe();
    autoclicker.rate = 9;
    saveAutoclickerConfig();

    expect(seen).toEqual([8]);
  });
});

describe('per-macro autoclicker state', () => {
  it('keeps every panel choice through a macro save and load', () => {
    applyAutoclickerConfig({
      ...defaultAutoclickerConfig,
      positionMode: 'sequence',
      basePositionMode: 'fixed',
      showMarkers: false,
      showPointMarkers: true,
      pickMulti: true,
      mapScreen: '1',
    });
    const saved = JSON.parse(JSON.stringify(cloneAutoclickerConfig()));
    applyAutoclickerConfig(defaultAutoclickerConfig);
    applyAutoclickerConfig(saved);
    expect(autoclicker).toMatchObject({
      positionMode: 'sequence',
      basePositionMode: 'fixed',
      showMarkers: false,
      showPointMarkers: true,
      pickMulti: true,
      mapScreen: '1',
    });
  });

  it('upgrades macros saved before the marker toggles were split', () => {
    applyAutoclickerConfig({ positionMode: 'fixed', showMarkers: true });
    expect(autoclicker.basePositionMode).toBe('fixed');
    expect(autoclicker.showPointMarkers).toBe(true);
    applyAutoclickerConfig({ positionMode: 'sequence' });
    expect(autoclicker.basePositionMode).toBe('cursor');
  });
});
