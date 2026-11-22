import { VK_MAP } from './vkMap';

type HotkeyComboPayload = {
    ctrl: boolean;
    alt: boolean;
    shift: boolean;
    win: boolean;
    trigger: { kind: 'key'; vk: number };
};

const MOD_ALIASES: Record<string, keyof Omit<HotkeyComboPayload, 'trigger'>> = {
    ctrl: 'ctrl', control: 'ctrl', commandorcontrol: 'ctrl', cmdorctrl: 'ctrl',
    alt: 'alt', option: 'alt', altgr: 'alt',
    shift: 'shift',
    super: 'win', meta: 'win', win: 'win', cmd: 'win', command: 'win',
};

const PUNCT_VK: Record<string, number> = Object.fromEntries(Object.entries({
    ',': 'Comma', '.': 'Period', '/': 'Slash', ';': 'Semicolon', "'": 'Quote',
    '[': 'BracketLeft', ']': 'BracketRight', '\\': 'Backslash', '-': 'Minus', '=': 'Equal', '`': 'Backquote',
}).map(([ch, code]) => [ch, VK_MAP[code]!]));

export function keyToVk(key: string): number | null {
    if (!key) return null;
    if (key.length === 1) {
        const c = key.toUpperCase();
        if (c >= 'A' && c <= 'Z') return 0x41 + (c.charCodeAt(0) - 65);
        if (c >= '0' && c <= '9') return 0x30 + (c.charCodeAt(0) - 48);
        return PUNCT_VK[key] ?? null;
    }
    return VK_MAP[key] ?? VK_MAP[`Key${key.toUpperCase()}`] ?? null;
}

export function parseHotkeyCombo(accel: string): HotkeyComboPayload | null {
    const parts = accel.split('+').map(p => p.trim()).filter(Boolean);
    if (parts.length === 0) return null;

    const combo = { ctrl: false, alt: false, shift: false, win: false };
    let key: string | null = null;

    for (const part of parts) {
        const mod = MOD_ALIASES[part.toLowerCase()];
        if (mod) { combo[mod] = true; continue; }
        key = part;
    }

    if (key === null) return null;
    const vk = keyToVk(key);
    if (vk === null) return null;

    return { ...combo, trigger: { kind: 'key', vk } };
}
