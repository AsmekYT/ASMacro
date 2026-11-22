import { describe, it, expect, beforeEach } from 'vitest';
import { settings, defaultSettings, saveSettings, blockDelay } from '../src/settings';

describe('blockDelay', () => {
  beforeEach(() => {
    settings.humanization.enabled = false;
    settings.humanization.variancePct = defaultSettings.humanization.variancePct;
  });

  it('exact without humanization', () => {
    settings.blockDelayMs = 100;
    expect(blockDelay()).toBe(100);
    settings.humanization.enabled = true;
    settings.blockDelayMs = 0;
    expect(blockDelay()).toBe(0);
  });

  it('stays within variance', () => {
    settings.humanization.enabled = true;
    settings.humanization.variancePct = 20;
    settings.blockDelayMs = 1000;
    for (let i = 0; i < 50; i++) expect(blockDelay()).toBeGreaterThanOrEqual(800);
    for (let i = 0; i < 50; i++) expect(blockDelay()).toBeLessThanOrEqual(1200);
    settings.humanization.variancePct = 80;
    settings.blockDelayMs = 1;
    for (let i = 0; i < 50; i++) expect(blockDelay()).toBeGreaterThanOrEqual(0);
  });
});

it('saveSettings', () => {
  settings.blockDelayMs = 77;
  saveSettings();
  expect(JSON.parse(localStorage.getItem('asmacro_settings_v1')!).blockDelayMs).toBe(77);
});
