import { settings } from './settings';

export function resolveThemeMode(): 'dark' | 'light' {
    if (settings.theme !== 'system') return settings.theme;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true ? 'dark' : 'light';
}

export function applyTheme() {
    document.documentElement.dataset.theme = resolveThemeMode();
}

export function applyUiScale() {
    const scale = Math.max(50, Math.min(200, settings.uiScale || 100));
    document.documentElement.style.fontSize = `${scale}%`;
}

export function initTheme() {
    applyTheme();
    applyUiScale();
    window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if (settings.theme === 'system') applyTheme();
    });
}
