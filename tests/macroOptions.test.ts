import { describe, it, expect, vi } from 'vitest';
import { activationOf, defaultActivation, macroShortcuts, canRunManually, newMacroDoc, type MacroActivation } from '../src/storage';

vi.mock('@tauri-apps/plugin-global-shortcut', () => ({ register: vi.fn(), unregister: vi.fn() }));
const { collectMacroHotkeys } = await import('../src/app/hotkeys');

const withActivation = (id: string, activation: MacroActivation) => ({ ...newMacroDoc(id, id), activation });

describe('activationOf', () => {
  it('defaults to manual', () => {
    expect(activationOf(newMacroDoc('m1', 'Main')).mode).toBe('manual');
    expect(activationOf(undefined)).toEqual(defaultActivation);
  });

  it('fills missing fields', () => {
    const doc = withActivation('m2', { mode: 'shortcut', shortcut: 'Ctrl+Shift+R' });
    expect(activationOf(doc)).toEqual({ ...defaultActivation, mode: 'shortcut', shortcut: 'Ctrl+Shift+R' });
  });
});

describe('shortcuts per mode', () => {
  it('manual', () => {
    const a = activationOf(withActivation('m', { mode: 'manual' }));
    expect(macroShortcuts(a)).toBeNull();
    expect(canRunManually(a)).toBe(true);
  });

  it('shortcut', () => {
    const a = activationOf(withActivation('m', { mode: 'shortcut', shortcut: 'F9', stopShortcut: 'F10' }));
    expect(macroShortcuts(a)).toEqual({ start: 'F9', stop: 'F10' });
  });

  it('auto', () => {
    const auto = activationOf(withActivation('m', { mode: 'auto' }));
    expect(macroShortcuts(auto)).toBeNull();
    expect(canRunManually(auto)).toBe(false);
    const both = { ...auto, autoShortcut: true };
    expect(macroShortcuts(both)).toEqual({ start: 'F7', stop: 'F8' });
    expect(canRunManually(both)).toBe(true);
  });

  it('collects bindings and clashes', () => {
    const { bindings, clashes } = collectMacroHotkeys([
      withActivation('a', { mode: 'shortcut', shortcut: 'F9', stopShortcut: 'F10' }),
      withActivation('b', { mode: 'shortcut', shortcut: 'f9', stopShortcut: 'F11' }),
      withActivation('c', { mode: 'manual', shortcut: 'F12' }),
    ]);
    expect(bindings).toEqual([
      { id: 'a', action: 'start', combo: 'F9' },
      { id: 'a', action: 'stop', combo: 'F10' },
      { id: 'b', action: 'stop', combo: 'F11' },
    ]);
    expect(clashes).toEqual(['f9']);
  });
});
