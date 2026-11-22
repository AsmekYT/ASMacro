import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { reportError } from './ui/toast';
import { t } from './i18n';

export type FrequencyUnit = 'second' | 'minute' | 'hour' | 'day';
export type MouseButton = 'LEFT' | 'RIGHT' | 'MIDDLE' | 'BACK' | 'FORWARD';
export type Activation = 'toggle' | 'hold';
export type PositionMode = 'cursor' | 'fixed' | 'sequence';

export type ClickPoint = { x: number; y: number };

type HotkeyTrigger =
    | { kind: 'key'; vk: number; label: string }
    | { kind: 'mouse'; button: 'x1' | 'x2' | 'middle'; label: string };

export type AutoclickerHotkey = {
    ctrl: boolean;
    alt: boolean;
    shift: boolean;
    win: boolean;
    trigger: HotkeyTrigger | null;
};

export type AutoclickerConfig = {
    targetKind: 'mouse' | 'key';
    button: MouseButton;
    key: string;
    caseSensitive: boolean;

    rate: number;
    randomRate: boolean;
    rateMin: number;
    rateMax: number;
    unit: FrequencyUnit;

    activation: Activation;
    hotkey: AutoclickerHotkey;

    advanced: boolean;
    dutyCycle: boolean;
    holdMinMs: number;
    holdMaxMs: number;
    doubleClick: boolean;
    doubleGapMs: number;
    positionMode: PositionMode;
    basePositionMode: 'cursor' | 'fixed';
    posX: number;
    posY: number;
    points: ClickPoint[];
    sequenceLoop: boolean;
    sequenceRandom: boolean;
    clicksPerPoint: number;
    showMarkers: boolean;
    showPointMarkers: boolean;
    pickMulti: boolean;
    mapScreen: string;
    limitClicks: number;
    limitSeconds: number;
    edgeStop: boolean;
    edgeMarginPx: number;
    edgeCornersOnly: boolean;
};

const STORAGE_KEY = 'asmacro_autoclicker_v1';
export const MAX_CPS = 500;

export const defaultAutoclickerConfig: AutoclickerConfig = {
    targetKind: 'mouse',
    button: 'LEFT',
    key: 'F',
    caseSensitive: false,

    rate: 10,
    randomRate: false,
    rateMin: 5,
    rateMax: 15,
    unit: 'second',

    activation: 'toggle',
    hotkey: { ctrl: false, alt: false, shift: false, win: false, trigger: null },

    advanced: false,
    dutyCycle: false,
    holdMinMs: 10,
    holdMaxMs: 30,
    doubleClick: false,
    doubleGapMs: 60,
    positionMode: 'cursor',
    basePositionMode: 'cursor',
    posX: 0,
    posY: 0,
    points: [],
    sequenceLoop: true,
    sequenceRandom: false,
    clicksPerPoint: 1,
    showMarkers: false,
    showPointMarkers: false,
    pickMulti: false,
    mapScreen: 'auto',
    limitClicks: 0,
    limitSeconds: 0,
    edgeStop: false,
    edgeMarginPx: 5,
    edgeCornersOnly: false,
};

function normalizePoints(saved: unknown): ClickPoint[] {
    if (!Array.isArray(saved)) return [];
    return saved
        .map(p => {
            const x = Math.round(Number((p as ClickPoint)?.x));
            const y = Math.round(Number((p as ClickPoint)?.y));
            return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
        })
        .filter((p): p is ClickPoint => p !== null);
}

function migratePositionMode(parsed: Record<string, unknown>): PositionMode {
    const mode = parsed.positionMode;
    if (mode === 'cursor' || mode === 'fixed' || mode === 'sequence') return mode;
    return parsed.fixedPos === true ? 'fixed' : 'cursor';
}

function migrateBasePosition(parsed: Record<string, unknown>): 'cursor' | 'fixed' {
    const base = parsed.basePositionMode;
    if (base === 'cursor' || base === 'fixed') return base;
    return migratePositionMode(parsed) === 'fixed' ? 'fixed' : 'cursor';
}

function sanitize(raw: unknown): Partial<AutoclickerConfig> {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const src = raw as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, def] of Object.entries(defaultAutoclickerConfig)) {
        const val = src[key];
        if (val === undefined || val === null) continue;
        if (Array.isArray(def) ? Array.isArray(val) : typeof val === typeof def) out[key] = val;
    }
    return out as Partial<AutoclickerConfig>;
}

function mergeHotkey(saved: unknown): AutoclickerHotkey {
    const h = (saved ?? {}) as Partial<AutoclickerHotkey>;
    return { ...defaultAutoclickerConfig.hotkey, ...h };
}

export function normalizeAutoclickerConfig(raw: unknown): AutoclickerConfig {
    const parsed: Record<string, unknown> = sanitize(raw);
    const legacy = { ...parsed, fixedPos: (raw as { fixedPos?: unknown } | null)?.fixedPos };
    return {
        ...JSON.parse(JSON.stringify(defaultAutoclickerConfig)),
        ...parsed,
        hotkey: mergeHotkey(parsed.hotkey),
        positionMode: migratePositionMode(legacy),
        basePositionMode: migrateBasePosition(legacy),
        showPointMarkers: (parsed.showPointMarkers ?? parsed.showMarkers ?? false) as boolean,
        points: normalizePoints(parsed.points),
    };
}

export function loadAutoclickerConfig(): AutoclickerConfig {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) return normalizeAutoclickerConfig(JSON.parse(raw));
    } catch (e) {}
    return normalizeAutoclickerConfig({});
}

export const autoclicker: AutoclickerConfig = loadAutoclickerConfig();

const configListeners: (() => void)[] = [];

export function onAutoclickerConfigChange(fn: () => void): () => void {
    configListeners.push(fn);
    return () => { const i = configListeners.indexOf(fn); if (i >= 0) configListeners.splice(i, 1); };
}

export function saveAutoclickerConfig() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(autoclicker)); } catch (e) { reportError(e, t('error.storageFull')); }
    configListeners.forEach(fn => fn());
}

export function applyAutoclickerConfig(raw: unknown) {
    Object.assign(autoclicker, normalizeAutoclickerConfig(raw));
}

export function cloneAutoclickerConfig(): AutoclickerConfig {
    return JSON.parse(JSON.stringify(autoclicker));
}

function perSecond(rate: number, unit: FrequencyUnit): number {
    const div = { second: 1, minute: 60, hour: 3600, day: 86400 }[unit];
    return rate / div;
}

export function clampCps(v: number): number {
    if (!Number.isFinite(v) || v <= 0) return 0.01;
    return Math.min(MAX_CPS, v);
}

export function toBackendConfig(c: AutoclickerConfig): unknown {
    let cpsMin: number;
    let cpsMax: number;
    if (c.randomRate) {
        cpsMin = clampCps(perSecond(c.rateMin, c.unit));
        cpsMax = clampCps(perSecond(c.rateMax, c.unit));
        if (cpsMin > cpsMax) [cpsMin, cpsMax] = [cpsMax, cpsMin];
    } else {
        cpsMin = cpsMax = clampCps(perSecond(c.rate, c.unit));
    }

    const sequencePoints = c.positionMode === 'sequence' ? normalizePoints(c.points) : [];

    const target = c.targetKind === 'mouse'
        ? { kind: 'mouse', button: c.button }
        : { kind: 'key', key: c.key, case_sensitive: c.caseSensitive };

    return {
        target,
        cps_min: cpsMin,
        cps_max: cpsMax,
        hold_ms_min: c.dutyCycle ? Math.max(0, c.holdMinMs) : 10,
        hold_ms_max: c.dutyCycle ? Math.max(0, c.holdMaxMs) : 10,
        double_click: c.doubleClick,
        double_gap_ms: Math.max(0, c.doubleGapMs),
        position: c.positionMode === 'fixed' ? [Math.round(c.posX), Math.round(c.posY)] : null,
        points: sequencePoints.length ? sequencePoints.map(p => [p.x, p.y]) : null,
        sequence_loop: c.sequenceLoop,
        sequence_random: c.sequenceRandom,
        clicks_per_point: Math.max(1, Math.round(c.clicksPerPoint || 1)),
        limit_clicks: c.limitClicks > 0 ? Math.round(c.limitClicks) : null,
        limit_ms: c.limitSeconds > 0 ? Math.round(c.limitSeconds * 1000) : null,
        edge_stop: c.edgeStop ? { margin_px: Math.round(c.edgeMarginPx), corners_only: c.edgeCornersOnly } : null,
    };
}

export function effectiveCps(c: AutoclickerConfig): { min: number; max: number } {
    const b = toBackendConfig(c) as { cps_min: number; cps_max: number };
    return { min: b.cps_min, max: b.cps_max };
}

export function toHotkeyCombo(h: AutoclickerHotkey): unknown {
    if (!h.trigger) return null;
    const trigger = h.trigger.kind === 'key'
        ? { kind: 'key', vk: h.trigger.vk }
        : { kind: 'mouse', button: h.trigger.button };
    return { ctrl: h.ctrl, alt: h.alt, shift: h.shift, win: h.win, trigger };
}

async function startAutoclicker(): Promise<void> {
    await invoke('start_autoclicker', { config: toBackendConfig(autoclicker) });
}

async function stopAutoclicker(): Promise<void> {
    await invoke('stop_autoclicker');
}

export async function updateAutoclickerConfig(): Promise<void> {
    await invoke('update_autoclicker_config', { config: toBackendConfig(autoclicker) });
}

export async function getAutoclickerStatus(): Promise<{ running: boolean; clicks: number; elapsedMs: number }> {
    const r = await invoke<{ running: boolean; clicks: number; elapsed_ms: number }>('autoclicker_status');
    return { running: r.running, clicks: r.clicks, elapsedMs: r.elapsed_ms };
}

export async function applyAutoclickerHotkey(): Promise<void> {
    await invoke('set_autoclicker_hotkey', { combo: toHotkeyCombo(autoclicker.hotkey) });
}

let acRunning = false;
let acHeld = false;
const runningListeners = new Set<(running: boolean) => void>();

export function isAutoclickerRunning(): boolean {
    return acRunning;
}

export function onAutoclickerRunningChange(fn: (running: boolean) => void): () => void {
    runningListeners.add(fn);
    return () => { runningListeners.delete(fn); };
}

function setRunning(v: boolean) {
    if (acRunning === v) return;
    acRunning = v;
    runningListeners.forEach(fn => fn(v));
}

export async function toggleAutoclicker(): Promise<void> {
    if (acRunning) {
        try { await stopAutoclicker(); setRunning(false); } catch (e) { reportError(e, t('error.unexpected')); }
        return;
    }
    try { await startAutoclicker(); setRunning(true); } catch (e) { reportError(e, t('ac.cannotStart')); }
}

async function handleHotkeyEvent(pressed: boolean) {
    if (autoclicker.activation === 'hold') {
        if (pressed) {
            if (acHeld) return;
            acHeld = true;
            try { await startAutoclicker(); setRunning(true); } catch (e) { acHeld = false; reportError(e, t('ac.cannotStart')); }
        } else {
            acHeld = false;
            await stopAutoclicker().catch(e => reportError(e, t('error.unexpected')));
            setRunning(false);
        }
    } else {
        if (!pressed) return;
        await toggleAutoclicker();
    }
}

let runtimeInitialized = false;

export function initAutoclickerRuntime() {
    if (runtimeInitialized) return;
    runtimeInitialized = true;
    listen<{ state: string }>('autoclicker-hotkey', (event) => {
        void handleHotkeyEvent(event.payload.state === 'Pressed');
    });
    listen<{ running: boolean; reason: string | null; clicks: number }>('autoclicker-state', (event) => {
        setRunning(event.payload.running);
    });
}
