import { describe, it, expect, beforeEach } from 'vitest';
import { settings, defaultSettings, intensityPresets, saveSettings, blockDelay } from '../src/settings';

describe('intensityPresets', () => {
  it('has increasing jitter and variance from low to high', () => {
    expect(intensityPresets.low.jitterPx).toBeLessThan(intensityPresets.medium.jitterPx);
    expect(intensityPresets.medium.jitterPx).toBeLessThan(intensityPresets.high.jitterPx);
    expect(intensityPresets.low.variancePct).toBeLessThan(intensityPresets.medium.variancePct);
    expect(intensityPresets.medium.variancePct).toBeLessThan(intensityPresets.high.variancePct);
  });
});

describe('blockDelay', () => {
  beforeEach(() => {
    settings.blockDelayMs = defaultSettings.blockDelayMs;
    settings.humanization.enabled = false;
    settings.humanization.variancePct = defaultSettings.humanization.variancePct;
  });

  it('returns the base delay exactly when humanization is disabled', () => {
    settings.blockDelayMs = 100;
    expect(blockDelay()).toBe(100);
  });

  it('returns 0 when the base delay is 0, regardless of humanization', () => {
    settings.blockDelayMs = 0;
    settings.humanization.enabled = true;
    expect(blockDelay()).toBe(0);
  });

  it('varies within variancePct when humanization is enabled', () => {
    settings.blockDelayMs = 1000;
    settings.humanization.enabled = true;
    settings.humanization.variancePct = 20;
    for (let i = 0; i < 50; i++) {
      const d = blockDelay();
      expect(d).toBeGreaterThanOrEqual(800);
      expect(d).toBeLessThanOrEqual(1200);
    }
  });

  it('never returns a negative delay', () => {
    settings.blockDelayMs = 1;
    settings.humanization.enabled = true;
    settings.humanization.variancePct = 80;
    for (let i = 0; i < 50; i++) {
      expect(blockDelay()).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('saveSettings persistence', () => {
  it('round-trips through localStorage', () => {
    settings.blockDelayMs = 77;
    saveSettings();
    const raw = localStorage.getItem('asmacro_settings_v1');
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.blockDelayMs).toBe(77);
  });
});
