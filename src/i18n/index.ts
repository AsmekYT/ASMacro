import { invoke } from '@tauri-apps/api/core';

export type Locale = {
    language: { code: string; name: string; match?: string[] };
    strings: Record<string, string>;
};

export type LanguageInfo = { code: string; name: string };

const FALLBACK = 'en';
const LANG_KEY = 'asmacro_lang_v1';

const locales = new Map<string, Locale>();
let currentLang = FALLBACK;

function isLocale(v: unknown): v is Locale {
    const l = v as Locale;
    return typeof l?.language?.code === 'string' && l.language.code !== ''
        && typeof l.language.name === 'string'
        && typeof l.strings === 'object' && l.strings !== null;
}

export function addLocale(l: Locale): void {
    const prev = locales.get(l.language.code);
    locales.set(l.language.code, prev
        ? { language: { ...prev.language, ...l.language }, strings: { ...prev.strings, ...l.strings } }
        : l);
}

const bundled = import.meta.glob<Locale>('./locales/*.json', { eager: true, import: 'default' });
Object.values(bundled).forEach(addLocale);

async function loadUserLocales(): Promise<void> {
    let files: string[] = [];
    try { files = await invoke<string[]>('user_locales'); } catch { return; }
    for (const text of files) {
        try {
            const l: unknown = JSON.parse(text);
            if (isLocale(l)) addLocale(l);
            else console.warn('Translation file skipped: missing language.code, language.name or strings');
        } catch (e) {
            console.warn('Translation file is not valid JSON', e);
        }
    }
}

export function availableLanguages(): LanguageInfo[] {
    return [...locales.values()]
        .map(l => ({ code: l.language.code, name: l.language.name }))
        .sort((a, b) => a.name.localeCompare(b.name));
}

function isLang(v: unknown): v is string {
    return typeof v === 'string' && locales.has(v);
}

function langFromTag(tag: string | null | undefined): string | null {
    const t = (tag ?? '').toLowerCase().replace('_', '-');
    if (!t) return null;
    for (const l of locales.values()) {
        const prefixes = l.language.match ?? [l.language.code];
        if (prefixes.some(p => t.startsWith(p.toLowerCase()))) return l.language.code;
    }
    return null;
}

function detectBrowserLang(): string {
    try {
        const tags = [navigator.language, ...(navigator.languages ?? [])];
        for (const tag of tags) {
            const lang = langFromTag(tag);
            if (lang) return lang;
        }
    } catch {}
    return FALLBACK;
}

async function detectSystemLang(): Promise<string | null> {
    try {
        const tag = await invoke<string | null>('system_language');
        return langFromTag(tag);
    } catch {}
    return null;
}

export async function detectInstallerLang(): Promise<string | null> {
    try {
        const v = await invoke<string | null>('installer_language');
        if (isLang(v)) return v;
    } catch {}
    return null;
}

export function getLang(): string {
    return currentLang;
}

export function setLang(lang: string, persist: boolean = true): void {
    currentLang = isLang(lang) ? lang : FALLBACK;
    if (persist) {
        try { localStorage.setItem(LANG_KEY, currentLang); } catch {}
    }
    invoke('set_ui_language', { strings: locales.get(currentLang)?.strings ?? {} }).catch(() => {});
}

export async function initLang(pref: string): Promise<string> {
    await loadUserLocales();
    if (pref !== 'auto' && isLang(pref)) {
        setLang(pref, false);
        return pref;
    }
    try { localStorage.removeItem(LANG_KEY); } catch {}
    const resolved = (await detectSystemLang()) ?? detectBrowserLang();
    setLang(resolved, false);
    return resolved;
}

export function t(key: string, params?: Record<string, string | number>): string {
    let str = locales.get(currentLang)?.strings[key] ?? locales.get(FALLBACK)?.strings[key] ?? key;
    if (params) {
        for (const [k, v] of Object.entries(params)) {
            str = str.split(`{${k}}`).join(String(v));
        }
    }
    return str;
}

export function applyI18n(root: ParentNode = document): void {
    root.querySelectorAll<HTMLElement>('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (key) el.textContent = t(key);
    });
    root.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach(el => {
        const key = el.getAttribute('data-i18n-title');
        if (key) el.title = t(key);
    });
    root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[data-i18n-placeholder]').forEach(el => {
        const key = el.getAttribute('data-i18n-placeholder');
        if (key) el.placeholder = t(key);
    });
}
