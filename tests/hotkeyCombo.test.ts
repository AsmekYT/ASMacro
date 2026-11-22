import { describe, it, expect } from 'vitest';
import { parseHotkeyCombo, keyToVk } from '../src/hotkeyCombo';

describe('keyToVk', () => {
    it('maps letters and digits', () => {
        expect(keyToVk('A')).toBe(0x41);
        expect(keyToVk('z')).toBe(0x5a);
        expect(keyToVk('0')).toBe(0x30);
    });

    it('maps named keys', () => {
        expect(keyToVk('F5')).toBe(0x74);
        expect(keyToVk('F6')).toBe(0x75);
        expect(keyToVk('Space')).toBe(0x20);
        expect(keyToVk('ArrowUp')).toBe(0x26);
    });

    it('maps punctuation', () => {
        expect(keyToVk(',')).toBe(0xbc);
        expect(keyToVk('`')).toBe(0xc0);
    });

    it('returns null for unknown keys', () => {
        expect(keyToVk('Fn')).toBeNull();
        expect(keyToVk('')).toBeNull();
    });
});

describe('parseHotkeyCombo', () => {
    it('parses a bare key', () => {
        expect(parseHotkeyCombo('F5')).toEqual({
            ctrl: false, alt: false, shift: false, win: false,
            trigger: { kind: 'key', vk: 0x74 },
        });
    });

    it('parses modifiers', () => {
        expect(parseHotkeyCombo('Ctrl+Shift+R')).toEqual({
            ctrl: true, alt: false, shift: true, win: false,
            trigger: { kind: 'key', vk: 0x52 },
        });
    });

    it('accepts accelerator aliases', () => {
        const combo = parseHotkeyCombo('CommandOrControl+Alt+Super+F12');
        expect(combo).toEqual({
            ctrl: true, alt: true, shift: false, win: true,
            trigger: { kind: 'key', vk: 0x7b },
        });
    });

    it('returns null when the trigger key is unknown', () => {
        expect(parseHotkeyCombo('Ctrl+Fn')).toBeNull();
        expect(parseHotkeyCombo('Ctrl')).toBeNull();
        expect(parseHotkeyCombo('')).toBeNull();
    });
});
