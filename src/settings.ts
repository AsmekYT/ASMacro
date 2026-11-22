import { invoke } from '@tauri-apps/api/core';
import { reportError } from './ui/toast';
import { t } from './i18n';

export type HumanizationIntensity = 'low' | 'medium' | 'high' | 'custom';
export type Theme = 'dark' | 'light' | 'system';
export type LanguagePref = string;

export type AutoActivationScope = 'current' | 'all';

export type AppSettings = {
    autoActivationScope: AutoActivationScope;
    minimizeToTray: boolean;
    windowOnRun: 'none' | 'minimize' | 'hide';
    blockDelayMs: number;
    failsafe: boolean;
    maxLoopIterations: number;
    startWithSystem: boolean;
    startMinimized: boolean;
    alwaysOnTop: boolean;
    theme: Theme;
    language: LanguagePref;
    uiScale: number;
    checkUpdatesOnStart: boolean;
    humanization: {
        enabled: boolean;
        intensity: HumanizationIntensity;
        speedMult: number;
        jitterPx: number;
        variancePct: number;
        overshoot: boolean;
    };
};

const SETTINGS_KEY = 'asmacro_settings_v1';

export const defaultSettings: AppSettings = {
    autoActivationScope: 'current',
    minimizeToTray: true,
    windowOnRun: 'none',
    blockDelayMs: 50,
    failsafe: true,
    maxLoopIterations: 0,
    startWithSystem: true,
    startMinimized: false,
    alwaysOnTop: false,
    theme: 'system',
    language: 'auto',
    uiScale: 100,
    checkUpdatesOnStart: true,
    humanization: {
        enabled: false,
        intensity: 'medium',
        speedMult: 1.0,
        jitterPx: 2,
        variancePct: 20,
        overshoot: true,
    },
};

export const intensityPresets: Record<Exclude<HumanizationIntensity, 'custom'>, { jitterPx: number; variancePct: number; overshoot: boolean }> = {
    low: { jitterPx: 1, variancePct: 10, overshoot: false },
    medium: { jitterPx: 2, variancePct: 20, overshoot: true },
    high: { jitterPx: 4, variancePct: 35, overshoot: true },
};

export const settings: AppSettings = loadSettings();

function loadSettings(): AppSettings {
    try {
        const raw = localStorage.getItem(SETTINGS_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            return {
                ...defaultSettings,
                ...parsed,
                humanization: { ...defaultSettings.humanization, ...(parsed.humanization || {}) },
            };
        }
    } catch (e) {}
    return JSON.parse(JSON.stringify(defaultSettings));
}

export function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { reportError(e, t('error.storageFull')); }
}

export async function applySettingsToBackend() {
    try {
        await invoke('set_execution_config', {
            humanization: {
                enabled: settings.humanization.enabled,
                speed_mult: settings.humanization.speedMult,
                jitter_px: settings.humanization.jitterPx,
                variance_pct: settings.humanization.variancePct,
                overshoot: settings.humanization.overshoot,
            },
            failsafe: settings.failsafe,
        });
    } catch (e) { console.error('Failed to apply execution config', e); }
}

export function blockDelay(): number {
    const base = Math.max(0, settings.blockDelayMs);
    if (!settings.humanization.enabled || base === 0) return base;
    const v = settings.humanization.variancePct / 100;
    const factor = 1 + (Math.random() * 2 - 1) * v;
    return Math.max(0, Math.round(base * factor));
}
